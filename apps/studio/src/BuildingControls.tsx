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

export interface BuildingControlsProps {
  /** Operator-supplied feet-per-PDF-point scale (REQUIRED for extraction). */
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
}: BuildingControlsProps): ReactElement {
  const ids = useId();
  const scaleId = `${ids}-scale`;
  const pageId = `${ids}-page`;
  const heightId = `${ids}-h`;
  const fileId = `${ids}-file`;

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scaleValid = Number.isFinite(scaleFtPerPt) && scaleFtPerPt > 0;

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
