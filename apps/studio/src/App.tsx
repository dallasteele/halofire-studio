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
import {
  loadManufacturerStepManifest,
  type ManufacturerStepManifest,
} from './lib/manufacturer-step';
import {
  loadBuild123dManifest,
  type Build123dManifest,
} from './lib/build123d-parts';
import { cameraConfigFor, type ViewMode } from './lib/view-mode';
import { catalogCounts } from './lib/catalog';
import { colors, radii, spacing, typeScale } from './lib/tokens';
import { PartGallery } from './PartViewer';
import { Inspector } from './Inspector';
import { CatalogBrowser } from './CatalogBrowser';
import { LayoutControls } from './LayoutControls';
import { LayoutScene } from './LayoutScene';
import { BuildingControls } from './BuildingControls';
import { BuildingScene } from './BuildingScene';
import { layoutHeads, type HazardClass } from './lib/layout';
import type { FootprintResult } from './lib/pdf-building';
import { buildSamInvoker } from './lib/sam-invoker';

/**
 * Top-level app mode: the existing part gallery, the sprinkler layout tool, or the
 * T47 vector-PDF building footprint lane.
 */
export type AppMode = 'catalog' | 'layout' | 'building';
const APP_MODES: readonly AppMode[] = ['catalog', 'layout', 'building'] as const;

declare global {
  interface Window {
    __studio?: {
      ready: boolean;
      partCount: number;
      presentCount: number;
      viewMode: ViewMode;
      selectedKey: string | null;
      /** Active top-level mode: "catalog", "layout", or "building". */
      appMode: AppMode;
      /** Head count of the current layout (only meaningful in layout mode). */
      headCount: number;
      /**
       * Enclosed footprint area (sqft) of the currently loaded building, or null
       * when no building is loaded (or extraction found no usable wall geometry).
       * Only meaningful in building mode. Honest by construction.
       */
      footprintAreaSqft: number | null;
      /**
       * T48: whether the SAM raster-fallback lane is available (a SAM endpoint /
       * invoker is configured). false by default — the studio never silently calls a
       * network/SAM service, and the Building-mode UI says so plainly. Honest by
       * construction.
       */
      samAvailable: boolean;
      /**
       * Number of records whose modelStatus === "manufacturer_verified" — i.e.
       * the count of operator-supplied manufacturer-STEP upgrades. With zero
       * operator entries (the shipped default) this is 0. Honest by construction.
       */
      manufacturerVerifiedCount: number;
      /**
       * Number of records whose modelStatus === "dimensioned_parametric" — i.e.
       * the count of build123d-generated Tier-2 parts. Zero when build123d was
       * unavailable at generation time (shipped manifest is {entries:[]}).
       * Honest by construction.
       */
      dimensionedParametricCount: number;
    };
  }
}

export function App(): ReactElement {
  const [records, setRecords] = useState<PartRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('perspective');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Default "catalog" so existing behavior/tests are unaffected on load.
  const [appMode, setAppMode] = useState<AppMode>('catalog');
  // Sprinkler layout inputs (only used in layout mode).
  const [widthFt, setWidthFt] = useState(40);
  const [lengthFt, setLengthFt] = useState(60);
  const [hazard, setHazard] = useState<HazardClass>('ordinary');
  // T47 building (vector-PDF) inputs (only used in building mode).
  const [buildingScaleFtPerPt, setBuildingScaleFtPerPt] = useState(0.125);
  const [buildingPageIndex, setBuildingPageIndex] = useState(0);
  const [buildingHeightFt, setBuildingHeightFt] = useState(12);
  const [footprint, setFootprint] = useState<FootprintResult | null>(null);
  // T48 raster-fallback (SAM) operator scale: feet per IMAGE PIXEL (never guessed).
  const [rasterScaleFtPerPx, setRasterScaleFtPerPx] = useState(0.1);

  // SAM invoker is DISABLED by default: no bridge URL is configured here, so
  // buildSamInvoker returns undefined and the raster lane is gated unavailable. The
  // studio NEVER silently calls a network/SAM service. (A future build can wire a
  // bridgeUrl from config to enable it; tests inject a mock invoker directly.)
  const samInvoker = useMemo(() => buildSamInvoker(), []);
  const samAvailable = typeof samInvoker === 'function';

  useEffect(() => {
    let cancelled = false;
    // Fetch BOTH the legacy parts manifest and the (default empty)
    // manufacturer-step manifest. The latter fail-softs to an empty manifest
    // on any error, so zero operator entries -> zero upgrades.
    const partsP = fetch('/parts/parts-manifest.json').then((r) => {
      if (!r.ok) {
        throw new Error(`manifest fetch failed: ${r.status}`);
      }
      return r.json() as Promise<RawManifest>;
    });
    const mfgP: Promise<ManufacturerStepManifest> = loadManufacturerStepManifest(
      typeof fetch === 'function' ? fetch.bind(globalThis) : undefined,
    );
    const b123P: Promise<Build123dManifest> = loadBuild123dManifest(
      typeof fetch === 'function' ? fetch.bind(globalThis) : undefined,
    );

    Promise.all([partsP, mfgP, b123P])
      .then(([raw, mfg, b123]) => {
        if (cancelled) return;
        setRecords(normalizeManifest(raw, mfg, b123));
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

  // K (manufacturer-verified) = count of records that earned the upgrade. With
  // the shipped empty manifest this is 0 — the honest, visible truth that no
  // operator entries have been ingested yet.
  const manufacturerVerifiedCount = useMemo(
    () =>
      records
        ? records.filter((r) => r.modelStatus === 'manufacturer_verified').length
        : 0,
    [records],
  );

  // D (dimensioned-parametric) = count of build123d Tier-2 records. Zero when
  // build123d was unavailable at generation time. Honest by construction.
  const dimensionedParametricCount = useMemo(
    () =>
      records
        ? records.filter((r) => r.modelStatus === 'dimensioned_parametric').length
        : 0,
    [records],
  );

  // Head count of the current layout, for verification + the header readout.
  const headCount = useMemo(
    () => layoutHeads({ widthFt, lengthFt, hazard }).count,
    [widthFt, lengthFt, hazard],
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
      appMode,
      headCount,
      manufacturerVerifiedCount,
      dimensionedParametricCount,
      footprintAreaSqft:
        footprint && !footprint.empty ? footprint.areaSqft : null,
      samAvailable,
    };
  }, [
    records,
    present.length,
    viewMode,
    selectedKey,
    appMode,
    headCount,
    manufacturerVerifiedCount,
    dimensionedParametricCount,
    footprint,
    samAvailable,
  ]);

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

  // Layout camera is scaled to the building footprint (1 ft = 1 scene unit), so
  // a 40x60 room is framed in full rather than a corner close-up.
  const layoutCam = useMemo(() => {
    const span = Math.max(widthFt, lengthFt, 10);
    if (viewMode === 'plan') {
      return {
        position: [0, span * 1.3, 0.001] as [number, number, number],
        up: [0, 0, -1] as [number, number, number],
        fov: 45,
      };
    }
    return {
      position: [widthFt * 0.85, span * 0.95, lengthFt * 0.85] as [number, number, number],
      up: [0, 1, 0] as [number, number, number],
      fov: 50,
    };
  }, [widthFt, lengthFt, viewMode]);

  // Building camera, scaled to the extracted footprint bbox (1 ft = 1 unit), so the
  // whole building is framed. Mirrors the layoutCam pattern.
  const buildingSpan = useMemo(() => {
    if (footprint && !footprint.empty) {
      return Math.max(footprint.bboxFt.w, footprint.bboxFt.l, 10);
    }
    return 40;
  }, [footprint]);

  const buildingCam = useMemo(() => {
    if (viewMode === 'plan') {
      return {
        position: [0, buildingSpan * 1.9, 0.001] as [number, number, number],
        up: [0, 0, -1] as [number, number, number],
        fov: 45,
      };
    }
    return {
      position: [buildingSpan * 1.05, buildingSpan * 1.15, buildingSpan * 1.05] as [
        number,
        number,
        number,
      ],
      up: [0, 1, 0] as [number, number, number],
      fov: 50,
    };
  }, [buildingSpan, viewMode]);

  return (
    <div style={rootStyle}>
      <header style={headerStyle}>
        <div style={brandStyle}>
          <span aria-hidden="true" style={brandMarkStyle} />
          <span style={brandWordStyle}>
            HaloFire <span style={brandAccentStyle}>Studio</span>
          </span>
        </div>

        <AppModeControl appMode={appMode} onChange={setAppMode} />

        <ViewModeControl viewMode={viewMode} onChange={setViewMode} />

        <span style={statusChipStyle} role="status">
          {appMode === 'building' ? (
            footprint && !footprint.empty ? (
              <>
                <strong style={statusNumStyle}>{Math.round(footprint.areaSqft)}</strong>{' '}
                ft² <span style={statusSepStyle}>·</span>{' '}
                {footprint.bboxFt.w.toFixed(0)}×{footprint.bboxFt.l.toFixed(0)} ft{' '}
                <span style={statusSepStyle}>·</span>{' '}
                <strong style={statusNumStyle}>{footprint.wallSegmentCount}</strong> walls
              </>
            ) : (
              'no building loaded — load a vector PDF or the sample'
            )
          ) : appMode === 'layout' ? (
            <>
              <strong style={statusNumStyle}>{headCount}</strong> heads{' '}
              <span style={statusSepStyle}>·</span> {widthFt}×{lengthFt} ft{' '}
              <span style={statusSepStyle}>·</span> {hazard}
            </>
          ) : records ? (
            <>
              <strong style={statusNumStyle}>{counts.present}</strong> present{' '}
              <span style={statusSepStyle}>/</span>{' '}
              <strong style={statusNumStyle}>{counts.total}</strong> catalogued{' '}
              <span style={statusSepStyle}>/</span>{' '}
              <strong style={statusNumStyle}>{dimensionedParametricCount}</strong>{' '}
              dimensioned{' '}
              <span style={statusSepStyle}>/</span>{' '}
              <strong style={statusNumStyle}>{manufacturerVerifiedCount}</strong>{' '}
              manufacturer-verified
            </>
          ) : error ? (
            <span style={{ color: colors.danger }}>error: {error}</span>
          ) : (
            'loading manifest…'
          )}
        </span>

        <p style={disclaimerStyle}>
          {appMode === 'building'
            ? footprint && !footprint.empty && footprint.method === 'sam-raster'
              ? 'best-effort SAM raster segmentation (2D mask only) · scale is operator-supplied · raster-segmented, NOT vector-exact / AHJ / PE-sealed / code-compliant · not for construction'
              : 'best-effort vector-geometry extraction · scale is operator-supplied · NOT AHJ / PE-sealed / code-compliant · not for construction'
            : appMode === 'layout'
              ? 'best-effort spacing heuristic · NOT hydraulic / AHJ / PE-sealed / code-compliant · not for construction'
              : 'source: generated · NOT manufacturer-exact · not dimensionally-accurate / AHJ / fabrication-ready'}
        </p>
      </header>

      <div style={bodyStyle}>
        {appMode === 'catalog' ? (
          <>
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
          </>
        ) : appMode === 'layout' ? (
          <>
            <LayoutControls
              widthFt={widthFt}
              lengthFt={lengthFt}
              hazard={hazard}
              onWidthChange={setWidthFt}
              onLengthChange={setLengthFt}
              onHazardChange={setHazard}
            />

            <main style={canvasWrapStyle} aria-label="Sprinkler layout viewer">
              <Canvas
                shadows
                dpr={[1, 2]}
                gl={{ preserveDrawingBuffer: true }}
                camera={{ position: layoutCam.position, up: layoutCam.up, fov: layoutCam.fov }}
                key={`layout-${viewMode}-${widthFt}x${lengthFt}`}
              >
                <Suspense fallback={null}>
                  <LayoutScene
                    widthFt={widthFt}
                    lengthFt={lengthFt}
                    hazard={hazard}
                    viewMode={viewMode}
                  />
                </Suspense>
              </Canvas>
            </main>
          </>
        ) : (
          <>
            <BuildingControls
              scaleFtPerPt={buildingScaleFtPerPt}
              onScaleChange={setBuildingScaleFtPerPt}
              pageIndex={buildingPageIndex}
              onPageChange={setBuildingPageIndex}
              heightFt={buildingHeightFt}
              onHeightChange={setBuildingHeightFt}
              footprint={footprint}
              onFootprint={setFootprint}
              rasterScaleFtPerPx={rasterScaleFtPerPx}
              onRasterScaleChange={setRasterScaleFtPerPx}
              samInvoker={samInvoker}
            />

            <main style={canvasWrapStyle} aria-label="Building footprint viewer">
              <Canvas
                shadows
                dpr={[1, 2]}
                gl={{ preserveDrawingBuffer: true }}
                camera={{ position: buildingCam.position, up: buildingCam.up, fov: buildingCam.fov }}
                key={`building-${viewMode}-${buildingSpan}`}
              >
                <Suspense fallback={null}>
                  {footprint && !footprint.empty ? (
                    <BuildingScene
                      outline={footprint.outline}
                      heightFt={buildingHeightFt}
                      viewMode={viewMode}
                    />
                  ) : null}
                </Suspense>
              </Canvas>
            </main>
          </>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------- Catalog / Layout mode switch */

interface AppModeControlProps {
  appMode: AppMode;
  onChange: (m: AppMode) => void;
}

/**
 * Accessible segmented control (radiogroup) toggling the top-level app mode:
 * Catalog (part gallery) vs. Layout (sprinkler tool). Same keyboard pattern as
 * ViewModeControl: Tab to the active button, arrows to switch.
 */
function AppModeControl({ appMode, onChange }: AppModeControlProps): ReactElement {
  const options: { mode: AppMode; label: string }[] = [
    { mode: 'catalog', label: 'Catalog' },
    { mode: 'layout', label: 'Layout' },
    { mode: 'building', label: 'Building' },
  ];

  return (
    <div role="radiogroup" aria-label="Studio mode" style={segmentStyle}>
      {options.map(({ mode, label }) => {
        const active = appMode === mode;
        const idx = APP_MODES.indexOf(mode);
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
                onChange(APP_MODES[Math.min(APP_MODES.length - 1, idx + 1)]);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                onChange(APP_MODES[Math.max(0, idx - 1)]);
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
