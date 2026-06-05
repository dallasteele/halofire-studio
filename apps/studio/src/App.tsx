// HaloFire Studio — AppShell. Semantic-landmark layout around the working R3F
// viewer: <header> (brand + Plan/3D segmented control + status chip + provenance
// disclaimer), left <aside> CatalogBrowser, <main> the R3F canvas, right <aside>
// Inspector. Selection state (selectedKey) is shared across the catalog list,
// the 3D PartGallery, and the Inspector — list ↔ mesh stay in sync.
//
// The renderer is UNCHANGED: imperative STLLoader.load in PartViewer, default
// frameloop, OrbitControls/MapControls, click-to-select + emissive highlight.
// This file only restyles the shell and wires shared selection.
//
// HONESTY: every mesh is source="generated" parametric massing. The header
// states plainly these are NOT manufacturer-exact and NOT dimensionally-accurate
// / AHJ / fabrication-ready.

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { Canvas } from '@react-three/fiber';
import {
  normalizeManifest,
  presentParts,
  type PartRecord,
  type RawManifest,
} from './lib/parts-manifest';
import { cameraConfigFor, type ViewMode } from './lib/view-mode';
import { catalogCounts } from './lib/catalog';
import { colors, radii, spacing, typeScale } from './lib/tokens';
import { PartGallery } from './PartViewer';
import { Inspector } from './Inspector';
import { CatalogBrowser } from './CatalogBrowser';

declare global {
  interface Window {
    __studio?: {
      ready: boolean;
      partCount: number;
      presentCount: number;
      viewMode: ViewMode;
      selectedKey: string | null;
    };
  }
}

export function App(): ReactElement {
  const [records, setRecords] = useState<PartRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('perspective');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/parts/parts-manifest.json')
      .then((r) => {
        if (!r.ok) {
          throw new Error(`manifest fetch failed: ${r.status}`);
        }
        return r.json() as Promise<RawManifest>;
      })
      .then((raw) => {
        if (cancelled) return;
        setRecords(normalizeManifest(raw));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const present = useMemo(
    () => (records ? presentParts(records) : []),
    [records],
  );

  const selected = useMemo(
    () => (records ? (records.find((p) => p.key === selectedKey) ?? null) : null),
    [records, selectedKey],
  );

  const counts = useMemo(
    () => (records ? catalogCounts(records) : { present: 0, total: 0 }),
    [records],
  );

  // Expose state for screenshot / E2E verification once parts are loaded.
  useEffect(() => {
    if (!records) return;
    window.__studio = {
      ready: true,
      partCount: records.length,
      presentCount: present.length,
      viewMode,
      selectedKey,
    };
  }, [records, present.length, viewMode, selectedKey]);

  // R3F sizes its canvas via ResizeObserver, which can miss the first measure in
  // headless/SSR-hydrated contexts. Kick one resize after mount so the canvas
  // fills its container reliably (no-op in a normal browser that already sized).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const onSelect = useCallback((part: PartRecord) => {
    setSelectedKey(part.key);
  }, []);

  const cam = useMemo(() => cameraConfigFor(viewMode), [viewMode]);

  return (
    <div style={rootStyle}>
      <header style={headerStyle}>
        <div style={brandStyle}>
          <span aria-hidden="true" style={brandMarkStyle} />
          <span style={brandWordStyle}>
            HaloFire <span style={brandAccentStyle}>Studio</span>
          </span>
        </div>

        <ViewModeControl viewMode={viewMode} onChange={setViewMode} />

        <span style={statusChipStyle} role="status">
          {records ? (
            <>
              <strong style={statusNumStyle}>{counts.present}</strong> present{' '}
              <span style={statusSepStyle}>/</span>{' '}
              <strong style={statusNumStyle}>{counts.total}</strong> catalogued
            </>
          ) : error ? (
            <span style={{ color: colors.danger }}>error: {error}</span>
          ) : (
            'loading manifest…'
          )}
        </span>

        <p style={disclaimerStyle}>
          source: generated · NOT manufacturer-exact · not dimensionally-accurate
          / AHJ / fabrication-ready
        </p>
      </header>

      <div style={bodyStyle}>
        <CatalogBrowser
          records={records ?? []}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />

        <main style={canvasWrapStyle} aria-label="3D part viewer">
          <Canvas
            shadows
            dpr={[1, 2]}
            gl={{ preserveDrawingBuffer: true }}
            camera={{ position: cam.position, up: cam.up, fov: 45 }}
            key={viewMode}
          >
            <color attach="background" args={[colors.bgInset]} />
            <Suspense fallback={null}>
              <PartGallery
                parts={present}
                viewMode={viewMode}
                selectedKey={selectedKey}
                onSelect={onSelect}
              />
            </Suspense>
          </Canvas>
        </main>

        <Inspector part={selected} />
      </div>
    </div>
  );
}

/* ----------------------------------------------- Plan / 3D segmented control */

interface ViewModeControlProps {
  viewMode: ViewMode;
  onChange: (m: ViewMode) => void;
}

/**
 * Accessible segmented control: a radiogroup of two buttons (3D / Plan).
 * Operable by keyboard (Tab to focus the active button, arrows to switch).
 */
function ViewModeControl({ viewMode, onChange }: ViewModeControlProps): ReactElement {
  const options: { mode: ViewMode; label: string }[] = [
    { mode: 'perspective', label: '3D' },
    { mode: 'plan', label: 'Plan' },
  ];

  return (
    <div role="radiogroup" aria-label="Viewer mode" style={segmentStyle}>
      {options.map(({ mode, label }) => {
        const active = viewMode === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(mode)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                onChange('plan');
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                onChange('perspective');
              }
            }}
            style={{
              ...segmentBtnStyle,
              background: active ? colors.interactiveActive : 'transparent',
              color: active ? '#ffffff' : colors.textSecondary,
              fontWeight: active ? 600 : 500,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- styles */

const rootStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'var(--hf-font-ui)',
  color: colors.textPrimary,
  background: colors.bg,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing[5],
  padding: `${spacing[3]} ${spacing[5]}`,
  background: colors.surface,
  borderBottom: `1px solid ${colors.border}`,
  flexWrap: 'wrap',
};

const brandStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing[2],
};

const brandMarkStyle: CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: radii.sm,
  background: `linear-gradient(135deg, ${colors.accent}, #d97742)`,
  boxShadow: `0 0 10px ${colors.accent}66`,
};

const brandWordStyle: CSSProperties = {
  fontSize: typeScale.lg.size,
  fontWeight: 700,
  letterSpacing: '-0.01em',
  color: colors.textPrimary,
};

const brandAccentStyle: CSSProperties = {
  color: colors.accentText,
  fontWeight: 600,
};

const segmentStyle: CSSProperties = {
  display: 'inline-flex',
  background: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.lg,
  padding: spacing[0.5],
  gap: spacing[0.5],
};

const segmentBtnStyle: CSSProperties = {
  border: 'none',
  borderRadius: radii.md,
  padding: `${spacing[1]} ${spacing[4]}`,
  fontSize: typeScale.sm.size,
  transition:
    'background var(--hf-duration-fast) var(--hf-easing-standard), color var(--hf-duration-fast) var(--hf-easing-standard)',
};

const statusChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: spacing[1],
  padding: `${spacing[1]} ${spacing[3]}`,
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.pill,
  fontSize: typeScale.sm.size,
  color: colors.textSecondary,
};

const statusNumStyle: CSSProperties = {
  color: colors.textPrimary,
  fontVariantNumeric: 'tabular-nums',
  fontFamily: 'var(--hf-font-mono)',
};

const statusSepStyle: CSSProperties = {
  color: colors.textMuted,
};

const disclaimerStyle: CSSProperties = {
  marginLeft: 'auto',
  color: colors.accentText,
  fontSize: typeScale.xs.size,
  maxWidth: 420,
  lineHeight: 1.5,
  textAlign: 'right',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'row',
  minHeight: 0,
};

const canvasWrapStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  background: colors.bgInset,
};
