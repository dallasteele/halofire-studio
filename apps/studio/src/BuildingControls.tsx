// HaloFire Studio — BUILDING controls (React DOM, LEFT panel in building mode).
//
// Loads a VECTOR bid PDF, extracts wall polylines into a building footprint, and
// drives BuildingScene. Controls:
//   - a file input to load a vector PDF,
//   - a REQUIRED operator scale input (feet per PDF point — never guessed),
//   - a page selector,
//   - a "Load sample" button that feeds the committed segments fixture directly
//     (with its known scale) so a screenshot deterministically shows a footprint
//     WITHOUT the huge 1881 file,
//   - an areaSqft / wall-count / bbox readout, and
//   - a PROMINENT honesty disclaimer.
//
// HONESTY (hard): the footprint is BEST-EFFORT vector-geometry extraction. The
// scale is operator/drawing-supplied; extraction THROWS without it. The building is
// labeled NOT AHJ / PE-sealed / code-compliant / permit / for-construction. We do
// NOT fabricate a footprint when no usable wall geometry is found.

import {
  useId,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// Vite resolves the worker bundle to a URL we hand to GlobalWorkerOptions.
import PdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {
  loadPdfVectorPage,
  segmentsToFootprint,
  type FootprintResult,
  type PdfjsLike,
  type VectorSegment,
} from './lib/pdf-building';
import {
  segmentFloorPlanViaSam,
  reconstructFootprintFromSam,
  type SamInvoker,
} from './lib/sam-floorplan';
import { colors, radii, spacing, typeScale } from './lib/tokens';

// Wire the pdfjs worker for the browser once at module load.
pdfjs.GlobalWorkerOptions.workerSrc = PdfWorkerUrl;

/** Public URL of the committed deterministic sample (served from public/). */
const SAMPLE_URL = '/samples/room-segments.json';

export const BUILDING_DISCLAIMER =
  'BEST-EFFORT VECTOR-GEOMETRY EXTRACTION ONLY. This building footprint is traced ' +
  'from the plan’s own vector wall linework. The PDF-point→feet scale is ' +
  'OPERATOR / DRAWING-supplied and is never guessed. It is NOT AHJ-approved, NOT ' +
  'PE-sealed, NOT code-compliant, and NOT a permit / for-construction drawing. No ' +
  'accuracy or parity is claimed. Engage a licensed fire-protection engineer for ' +
  'any real design.';

/** Shown when no SAM endpoint is configured (the honest default). */
export const SAM_UNAVAILABLE_MESSAGE =
  'SAM endpoint not configured — raster fallback unavailable (vector PDFs work via the lane above)';

export interface BuildingControlsProps {
  /** Operator-supplied feet-per-PDF-point scale (REQUIRED for vector extraction). */
  scaleFtPerPt: number;
  onScaleChange: (s: number) => void;
  pageIndex: number;
  onPageChange: (p: number) => void;
  heightFt: number;
  onHeightChange: (h: number) => void;
  /** Called with the extracted footprint (or null to clear). */
  onFootprint: (fp: FootprintResult | null) => void;
  /** Current footprint for the readout (null when none loaded). */
  footprint: FootprintResult | null;
  /**
   * T48 raster-fallback: operator-supplied feet-per-IMAGE-PIXEL scale (REQUIRED for
   * SAM segmentation; never guessed).
   */
  rasterScaleFtPerPx: number;
  onRasterScaleChange: (s: number) => void;
  /**
   * INJECTED SAM invoker. undefined => SAM DISABLED (the honest default): the
   * raster fallback is gated unavailable. A real invoker enables segment.
   */
  samInvoker?: SamInvoker;
}

export function BuildingControls({
  scaleFtPerPt,
  onScaleChange,
  pageIndex,
  onPageChange,
  heightFt,
  onHeightChange,
  onFootprint,
  footprint,
  rasterScaleFtPerPx,
  onRasterScaleChange,
  samInvoker,
}: BuildingControlsProps): ReactElement {
  const ids = useId();
  const scaleId = `${ids}-scale`;
  const pageId = `${ids}-page`;
  const heightId = `${ids}-h`;
  const fileId = `${ids}-file`;
  const rasterScaleId = `${ids}-rscale`;
  const imageId = `${ids}-image`;

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The raster image the operator picked (name only; bytes are not sent by default).
  const [rasterImageRef, setRasterImageRef] = useState<string | null>(null);

  const scaleValid = Number.isFinite(scaleFtPerPt) && scaleFtPerPt > 0;
  const rasterScaleValid = Number.isFinite(rasterScaleFtPerPx) && rasterScaleFtPerPx > 0;
  const samAvailable = typeof samInvoker === 'function';

  async function handleFile(file: File): Promise<void> {
    setError(null);
    setStatus(null);
    if (!scaleValid) {
      setError('Enter a positive operator scale (ft per PDF point) before loading a PDF — the scale is operator-supplied and never guessed.');
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const page = await loadPdfVectorPage(bytes, pageIndex, pdfjs as unknown as PdfjsLike, {
        scale: scaleFtPerPt,
      });
      // Segments already in feet (scale applied upstream) -> footprint at 1 ft/unit.
      const fp = segmentsToFootprint(page.segments, { scaleFtPerUnit: 1 });
      onFootprint(fp);
      if (fp.empty) {
        setStatus(`No usable wall geometry on page ${pageIndex + 1} (${page.count} raw segments). Nothing fabricated.`);
      } else {
        setStatus(`Extracted footprint from page ${pageIndex + 1} (${page.count} raw segments).`);
      }
    } catch (e: unknown) {
      onFootprint(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSample(): Promise<void> {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(SAMPLE_URL);
      if (!res.ok) throw new Error(`sample fetch failed: ${res.status}`);
      const sample = (await res.json()) as {
        scaleFtPerUnit: number;
        segments: VectorSegment[];
      };
      // Feed segmentsToFootprint directly with the sample's KNOWN scale.
      const fp = segmentsToFootprint(sample.segments, {
        scaleFtPerUnit: sample.scaleFtPerUnit,
      });
      onFootprint(fp);
      setStatus(`Loaded bundled sample (${sample.segments.length} wall segments).`);
    } catch (e: unknown) {
      onFootprint(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // T48 raster fallback: segment a SCANNED/RASTER plan via SAM (2D mask only), then
  // reconstruct the footprint through the SAME T47 path. Gated: with no SAM endpoint
  // configured (samInvoker undefined) the button is disabled and we say so plainly —
  // we never pretend a SAM run happened.
  async function handleSamSegment(): Promise<void> {
    setError(null);
    setStatus(null);
    if (!samAvailable) {
      setError(SAM_UNAVAILABLE_MESSAGE);
      return;
    }
    if (!rasterScaleValid) {
      setError(
        'Enter a positive operator scale (ft per image pixel) before segmenting — the scale is operator-supplied and never guessed.',
      );
      return;
    }
    setBusy(true);
    try {
      const seg = await segmentFloorPlanViaSam({
        invoker: samInvoker,
        imageRef: rasterImageRef ?? undefined,
        scaleFtPerPx: rasterScaleFtPerPx,
      });
      // reconstructFootprintFromSam handles both ok and skipped honestly (no fabrication).
      const fp = reconstructFootprintFromSam(seg, { scaleFtPerPx: rasterScaleFtPerPx });
      onFootprint(fp);
      if (fp.empty) {
        const reason = seg.ok ? 'no usable mask' : seg.reason;
        setStatus(`SAM segmentation produced no usable building mask (${reason}). Nothing fabricated.`);
      } else {
        setStatus('Reconstructed footprint from SAM raster segmentation (2D mask only — raster-segmented, not vector-exact).');
      }
    } catch (e: unknown) {
      onFootprint(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside style={panelStyle} aria-label="Building extraction controls">
      <h2 style={headingStyle}>Building</h2>

      <div style={fieldGroupStyle}>
        <div style={fieldWrapStyle}>
          <label htmlFor={scaleId} style={labelStyle}>
            Operator scale (ft / PDF point) — required
          </label>
          <input
            id={scaleId}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.001}
            value={scaleFtPerPt}
            onChange={(e) => onScaleChange(Number(e.target.value))}
            style={{
              ...inputStyle,
              borderColor: scaleValid ? colors.border : colors.danger,
            }}
            aria-invalid={!scaleValid}
          />
          <p style={hintStyle}>
            Operator/drawing-supplied — NEVER guessed. e.g. 0.148148 for 3/32&quot; =
            1&apos;-0&quot;, or 0.125 for 1pt = 0.125 ft.
          </p>
        </div>

        <div style={fieldWrapStyle}>
          <label htmlFor={pageId} style={labelStyle}>
            Page (1-based)
          </label>
          <input
            id={pageId}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={pageIndex + 1}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 1) onPageChange(Math.round(n) - 1);
            }}
            style={inputStyle}
          />
        </div>

        <div style={fieldWrapStyle}>
          <label htmlFor={heightId} style={labelStyle}>
            Wall height (ft)
          </label>
          <input
            id={heightId}
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            step={1}
            value={heightFt}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 1) onHeightChange(Math.min(200, Math.round(n)));
            }}
            style={inputStyle}
          />
        </div>

        <div style={fieldWrapStyle}>
          <label htmlFor={fileId} style={labelStyle}>
            Load vector PDF
          </label>
          <input
            id={fileId}
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
            style={fileInputStyle}
          />
        </div>

        <button
          type="button"
          onClick={() => void handleSample()}
          disabled={busy}
          style={sampleBtnStyle}
        >
          {busy ? 'Loading…' : 'Load sample footprint'}
        </button>
      </div>

      {/* T48 raster-fallback lane (SCANNED / RASTER plans with no vector layer). */}
      <div style={rasterSectionStyle} aria-label="Raster plan fallback (SAM)">
        <h3 style={subHeadingStyle}>Raster fallback (SAM)</h3>
        <p style={hintStyle}>
          For SCANNED / RASTER plans with NO vector layer. SAM produces a 2D segmentation
          MASK ONLY (not 3D); its outline becomes the footprint. Vector PDFs should use the
          lane above.
        </p>

        <div style={fieldWrapStyle}>
          <label htmlFor={rasterScaleId} style={labelStyle}>
            Operator scale (ft / image pixel) — required
          </label>
          <input
            id={rasterScaleId}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.001}
            value={rasterScaleFtPerPx}
            onChange={(e) => onRasterScaleChange(Number(e.target.value))}
            style={{
              ...inputStyle,
              borderColor: rasterScaleValid ? colors.border : colors.danger,
            }}
            aria-invalid={!rasterScaleValid}
          />
          <p style={hintStyle}>Operator-supplied — NEVER guessed. e.g. 0.1 for 1px = 0.1 ft.</p>
        </div>

        <div style={fieldWrapStyle}>
          <label htmlFor={imageId} style={labelStyle}>
            Raster plan image
          </label>
          <input
            id={imageId}
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              setRasterImageRef(f ? f.name : null);
            }}
            style={fileInputStyle}
          />
        </div>

        <button
          type="button"
          onClick={() => void handleSamSegment()}
          disabled={busy || !samAvailable}
          aria-disabled={busy || !samAvailable}
          title={samAvailable ? undefined : SAM_UNAVAILABLE_MESSAGE}
          style={{
            ...sampleBtnStyle,
            background: samAvailable ? colors.interactiveActive : colors.surfaceRaised,
            color: samAvailable ? '#ffffff' : colors.textMuted,
            cursor: samAvailable && !busy ? 'pointer' : 'not-allowed',
          }}
        >
          {busy ? 'Segmenting…' : 'Segment (SAM)'}
        </button>

        {!samAvailable ? (
          <p style={statusLineStyle} role="status">
            {SAM_UNAVAILABLE_MESSAGE}
          </p>
        ) : null}
      </div>

      {error ? (
        <p style={errorStyle} role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p style={statusLineStyle} role="status">
          {status}
        </p>
      ) : null}

      <dl style={readoutStyle} aria-live="polite">
        <Readout
          label="Area"
          value={footprint && !footprint.empty ? `${Math.round(footprint.areaSqft)} ft²` : '—'}
        />
        <Readout
          label="Bbox"
          value={
            footprint && !footprint.empty
              ? `${footprint.bboxFt.w.toFixed(1)} × ${footprint.bboxFt.l.toFixed(1)} ft`
              : '—'
          }
        />
        <Readout
          label="Walls"
          value={footprint ? String(footprint.wallSegmentCount) : '—'}
        />
        <Readout
          label="Network"
          value={footprint ? String(footprint.networkSegmentCount) : '—'}
        />
        <Readout label="Method" value={footprint ? footprint.method : '—'} />
      </dl>

      <p style={disclaimerStyle} role="note">
        <strong style={disclaimerStrongStyle}>Best-effort only.</strong>{' '}
        {BUILDING_DISCLAIMER}
      </p>
    </aside>
  );
}

function Readout({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div style={readoutRowStyle}>
      <dt style={labelStyle}>{label}</dt>
      <dd style={readoutValueStyle}>{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------- styles */

const panelStyle: CSSProperties = {
  width: 320,
  flex: '0 0 320px',
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[4],
  minHeight: 0,
  overflowY: 'auto',
  padding: `${spacing[4]} ${spacing[5]}`,
  background: colors.surface,
  borderRight: `1px solid ${colors.border}`,
  color: colors.textPrimary,
  fontSize: typeScale.sm.size,
  boxSizing: 'border-box',
};

const headingStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  margin: 0,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: colors.textMuted,
  fontWeight: 600,
};

const subHeadingStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  margin: 0,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: colors.textSecondary,
  fontWeight: 600,
};

const rasterSectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[3],
  padding: `${spacing[3]} ${spacing[4]}`,
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
};

const fieldGroupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[4],
};

const fieldWrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
};

const labelStyle: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.sm.size,
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: `${spacing[2]} ${spacing[3]}`,
  background: colors.bg,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  fontSize: typeScale.sm.size,
  boxSizing: 'border-box',
};

const fileInputStyle: CSSProperties = {
  width: '100%',
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
};

const sampleBtnStyle: CSSProperties = {
  border: `1px solid ${colors.borderStrong}`,
  background: colors.interactiveActive,
  color: '#ffffff',
  borderRadius: radii.md,
  padding: `${spacing[2]} ${spacing[3]}`,
  fontSize: typeScale.sm.size,
  fontWeight: 600,
  cursor: 'pointer',
};

const hintStyle: CSSProperties = {
  margin: `${spacing[1]} 0 0`,
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
};

const statusLineStyle: CSSProperties = {
  margin: 0,
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
};

const errorStyle: CSSProperties = {
  margin: 0,
  color: colors.danger,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
};

const readoutStyle: CSSProperties = {
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
  padding: `${spacing[3]} ${spacing[4]}`,
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
};

const readoutRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  margin: 0,
  gap: spacing[3],
};

const readoutValueStyle: CSSProperties = {
  margin: 0,
  color: colors.textPrimary,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  fontFamily: 'var(--hf-font-mono)',
};

const disclaimerStyle: CSSProperties = {
  margin: 0,
  background: '#2a1f12',
  border: `1px solid #5a3c1a`,
  color: colors.accentText,
  borderRadius: radii.md,
  padding: `${spacing[3]} ${spacing[3]}`,
  lineHeight: 1.6,
  fontSize: typeScale.xs.size,
};

const disclaimerStrongStyle: CSSProperties = {
  color: colors.accent,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
