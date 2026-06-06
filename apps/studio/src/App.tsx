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
  manufacturerVerifiedParts,
  type ManufacturerStepManifest,
  type ManufacturerVerifiedPart,
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
import {
  estimateFullFromLayout,
  loadPricebook,
  resolvePriceTable,
  type PriceTable,
} from './lib/bid';
import { BidPanel } from './BidPanel';
import type { FootprintResult } from './lib/pdf-building';
import { buildSamInvoker } from './lib/sam-invoker';
import {
  loadManufacturerCatalog,
  type ManufacturerCatalog,
} from './lib/manufacturer-catalog';
import {
  loadAiPlaceholderManifest,
  resolveCatalogGeometryAll,
  type AiPlaceholderManifest,
  type CatalogGeometry,
} from './lib/catalog-geometry';
import { ManufacturerCatalogPanel } from './ManufacturerCatalogPanel';
import { AddCatalogPanel } from './AddCatalogPanel';
import { ManufacturersPanel } from './ManufacturersPanel';
import {
  loadConnectorRegistry,
  connectorCount as countConnectors,
  connectorsEnabledCount as countConnectorsEnabled,
  type ManufacturerConnector,
} from './lib/manufacturer-connectors';
import {
  loadPartsDb,
  resolveConnectors,
  type PartsDbResult,
} from './lib/parts-db';
import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { SystemPanel } from './SystemPanel';
import { RULE_CONSTANT_COUNT, type HazardClass as Nfpa13HazardClass } from './lib/nfpa13-rules';
import { AssemblyControls } from './AssemblyControls';
import { AssemblyScene } from './AssemblyScene';
import {
  computeAssembly,
  type ResolvedHeadGeometry,
} from './lib/assembly-layout';
import { resolveCatalogGeometry } from './lib/catalog-geometry';

/**
 * Top-level app mode: the existing part gallery, the sprinkler layout tool, the
 * T47 vector-PDF building footprint lane, or the NFPA-13 system-model view.
 */
export type AppMode =
  | 'catalog'
  | 'mfr-catalog'
  | 'system'
  | 'assembly'
  | 'layout'
  | 'building';
const APP_MODES: readonly AppMode[] = [
  'catalog',
  'mfr-catalog',
  'system',
  'assembly',
  'layout',
  'building',
] as const;

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
       * Bottom-line auto-bid ESTIMATE total (USD) for the current layout. Only
       * meaningful in layout mode. This is a BEST-EFFORT estimate from
       * representative prices + standard labor assumptions — NOT a quote, NOT a
       * committed bid, NOT AHJ / PE / permit. Honest by construction.
       */
      bidTotal: number;
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
       * Number of manufacturer-verified parts — standalone imported manufacturer
       * STEP files (T54 import lane) PLUS any legacy part records upgraded by an
       * operator manufacturer-STEP. Each requires a real stepUrl + sha256. After
       * the KSB Etanorm import this is 1. Honest by construction.
       */
      manufacturerVerifiedCount: number;
      /**
       * T54: whether the Add-Catalog UX is mounted + ready (both paths present:
       * the fail-closed SAM drawing->CAD lane and the client-side STEP import
       * affordance). true once the studio shell renders. Honest by construction.
       */
      addCatalogReady: boolean;
      /**
       * Number of records whose modelStatus === "dimensioned_parametric" — i.e.
       * the count of build123d-generated Tier-2 parts. Zero when build123d was
       * unavailable at generation time (shipped manifest is {entries:[]}).
       * Honest by construction.
       */
      dimensionedParametricCount: number;
      /**
       * Number of REAL manufacturer catalog SKU/SIN spec records ingested from
       * public data sheets (public/catalog/manufacturer-catalog.json). Zero when
       * the catalog is missing / failed to load. Honest by construction — these
       * are catalog SPEC records, NOT manufacturer-exact geometry and NOT AHJ /
       * PE / code-certified selections.
       */
      catalogPartCount: number;
      /**
       * Number of catalog SKUs that resolve to REAL 3D geometry (build123d
       * dimensioned-parametric or operator manufacturer-step). SKUs with no real
       * asset resolve to "none" and are NOT counted. Honest by construction.
       */
      skusWithGeometry: number;
      /**
       * Number of AI-placeholder (visual_reference) assets resolved for catalog
       * SKUs. 0 this run: the generate_3d_model image->3D backend is DOWN
       * ([Errno 21] / gateway :19002 unreachable), so NO AI meshes were produced
       * (fail-closed). Honest by construction.
       */
      aiPlaceholderCount: number;
      /**
       * Number of ENCODED (non-null) NFPA-13 code constants in the rules table
       * (nfpa13-rules.RULES), each carrying its citation. Uncertain values are
       * left null with a cite-TODO and are NOT counted here. Honest by
       * construction — a design aid from published values, NOT code compliance.
       */
      systemRuleCount: number;
      /**
       * Number of placed parts (heads + pipes + fittings) in the current
       * system-assembly view. Only meaningful in assembly mode. Honest by
       * construction — a schematic design aid, not a coordinated model.
       */
      assemblyPartCount: number;
      /**
       * Number of sprinkler heads placed in the current assembly
       * (= branchCount * headsPerBranch). Only meaningful in assembly mode.
       */
      assemblyHeadsPlaced: number;
      /**
       * Number of part rows read from the SQLite source-of-truth (public/parts/
       * parts.db) via sql.js. -1 when the DB was unavailable and the studio
       * fail-softed to the JSON loaders. Honest by construction — the DB changes
       * no provenance gate; it is the metadata source-of-truth only.
       */
      dbPartCount: number;
      /**
       * true when the parts.db loaded + queried successfully via sql.js; false when
       * the studio fail-softed to the JSON loaders. Honest by construction.
       */
      dbAvailable: boolean;
      /**
       * Number of per-manufacturer connectors in the registry (researched +
       * user-added). Honest by construction.
       */
      connectorCount: number;
      /**
       * Number of connectors with status "enabled" — genuinely zero-credential
       * ungated sources ONLY (Victaulic, Reliable, Wheatland, Bull Moose). Honest
       * by construction; saving a config does NOT run a live integration.
       */
      connectorsEnabledCount: number;
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
  // Within Manufacturer mode: browse the catalog, the T54 Add-Catalog UX, or the
  // per-manufacturer Connectors settings panel.
  const [mfrView, setMfrView] = useState<'browse' | 'add' | 'connectors'>('browse');
  // SQLite source-of-truth (parts.db via sql.js). Fail-soft: stays "unavailable"
  // and the studio uses the JSON loaders if the DB can't load. dbPartCount is -1
  // until resolved, then the DB row count (or -1 if the DB was unavailable).
  const [dbPartCount, setDbPartCount] = useState<number>(-1);
  const [dbAvailable, setDbAvailable] = useState<boolean>(false);
  // Per-manufacturer connectors (DB first, fail-soft to the committed registry).
  const [connectors, setConnectors] = useState<ManufacturerConnector[]>([]);
  // Sprinkler layout inputs (only used in layout mode).
  const [widthFt, setWidthFt] = useState(40);
  const [lengthFt, setLengthFt] = useState(60);
  const [hazard, setHazard] = useState<HazardClass>('ordinary');
  // System-assembly inputs (only used in assembly mode). Hazard uses the full
  // NFPA-13 5-class enum (distinct from the layout's coarse 3-class enum).
  const [assemblyHeadSku, setAssemblyHeadSku] = useState<string | null>(null);
  const [assemblyHazard, setAssemblyHazard] = useState<Nfpa13HazardClass>('ordinary_1');
  const [assemblyBranchCount, setAssemblyBranchCount] = useState(3);
  const [assemblyHeadsPerBranch, setAssemblyHeadsPerBranch] = useState(4);
  // T47 building (vector-PDF) inputs (only used in building mode).
  const [buildingScaleFtPerPt, setBuildingScaleFtPerPt] = useState(0.125);
  const [buildingPageIndex, setBuildingPageIndex] = useState(0);
  const [buildingHeightFt, setBuildingHeightFt] = useState(12);
  const [footprint, setFootprint] = useState<FootprintResult | null>(null);
  // REAL manufacturer catalog (Tyco / Reliable / … spec records from public data
  // sheets). Fail-soft: a missing/blocked file leaves this null -> 0 SKUs.
  const [mfrCatalog, setMfrCatalog] = useState<ManufacturerCatalog | null>(null);
  // Loaded geometry-source manifests, retained so catalog SKUs can be resolved
  // to real 3D geometry (resolveCatalogGeometryAll). All fail-soft to empty.
  const [mfgStep, setMfgStep] = useState<ManufacturerStepManifest>({ entries: [] });
  const [b123Manifest, setB123Manifest] = useState<Build123dManifest>({ entries: [] });
  // AI placeholder manifest. EMPTY this run — the generate_3d_model image->3D
  // backend is DOWN ([Errno 21] / gateway :19002 unreachable). aiPlaceholderCount
  // is 0 (fail-closed) and stays 0 until a live backend produces real assets.
  const [aiPlaceholder, setAiPlaceholder] = useState<AiPlaceholderManifest>({
    entries: [],
  });

  // Resolved bid price table. Starts as the representative fallback; once the
  // REAL pricebook medians (public/parts/pricebook-medians.json, generated from
  // the imported Victaulic/ARGCO/FFF pricebook) load, this flips to the
  // pricebook-median table. Fail-soft: a missing file keeps the fallback.
  const [priceTable, setPriceTable] = useState<PriceTable>(() => resolvePriceTable(null));
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

    const aiP: Promise<AiPlaceholderManifest> = loadAiPlaceholderManifest(
      typeof fetch === 'function' ? fetch.bind(globalThis) : undefined,
    );

    Promise.all([partsP, mfgP, b123P, aiP])
      .then(([raw, mfg, b123, ai]) => {
        if (cancelled) return;
        setRecords(normalizeManifest(raw, mfg, b123));
        setMfgStep(mfg);
        setB123Manifest(b123);
        setAiPlaceholder(ai);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the REAL pricebook medians (fail-soft to the representative fallback).
  useEffect(() => {
    let cancelled = false;
    loadPricebook(typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)
      .then((book) => {
        if (cancelled) return;
        setPriceTable(resolvePriceTable(book));
      })
      .catch(() => {
        if (cancelled) return;
        setPriceTable(resolvePriceTable(null));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the REAL manufacturer catalog (fail-soft to an empty catalog).
  useEffect(() => {
    let cancelled = false;
    loadManufacturerCatalog(
      typeof fetch === 'function' ? fetch.bind(globalThis) : undefined,
    )
      .then((cat) => {
        if (cancelled) return;
        setMfrCatalog(cat);
      })
      .catch(() => {
        if (cancelled) return;
        setMfrCatalog({
          generatedAt: null,
          disclaimer: null,
          sources: [],
          entries: [],
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the SQLite source-of-truth (parts.db) via sql.js, plus the connector
  // list. FAIL-SOFT: any error leaves the DB unavailable (dbPartCount -1) and the
  // connectors come from the committed registry JSON. The DB changes NO provenance
  // gate — it is the metadata source-of-truth only.
  useEffect(() => {
    let cancelled = false;
    const f =
      typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;
    (async () => {
      let db: PartsDbResult = { ok: false, reason: 'not loaded' };
      try {
        db = await loadPartsDb(
          initSqlJs as never,
          f,
          '/parts/parts.db',
          sqlWasmUrl,
        );
      } catch (e) {
        db = { ok: false, reason: e instanceof Error ? e.message : 'db load error' };
      }
      if (cancelled) return;
      if (db.ok) {
        setDbAvailable(true);
        setDbPartCount(db.partCount());
      } else {
        setDbAvailable(false);
        setDbPartCount(-1);
      }
      // Connectors: DB first, fail-soft to committed registry.
      const { connectors: conns } = await resolveConnectors(db, f);
      if (cancelled) return;
      if (conns.length > 0) {
        setConnectors(conns);
      } else {
        // Last-resort: load the registry directly (so the panel is never empty).
        const reg = await loadConnectorRegistry(f);
        if (!cancelled) setConnectors(reg.connectors);
      }
      if (db.ok) db.close();
    })().catch(() => {
      if (!cancelled) {
        setDbAvailable(false);
        setDbPartCount(-1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const present = useMemo(
    () => (records ? presentParts(records) : []),
    [records],
  );

  const catalogPartCount = mfrCatalog?.entries.length ?? 0;

  // Resolve every catalog SKU to its BEST available 3D geometry by the priority
  // ladder (manufacturer-step > build123d match > ai-placeholder > none). The
  // honest, GX10-independent connection of the ingested SKUs to REAL geometry.
  const catalogGeometry = useMemo(
    () =>
      resolveCatalogGeometryAll(mfrCatalog?.entries ?? [], {
        manufacturerStep: mfgStep,
        build123dParts: b123Manifest,
        aiPlaceholder,
      }),
    [mfrCatalog, mfgStep, b123Manifest, aiPlaceholder],
  );
  const geometryById: Map<string, CatalogGeometry> = catalogGeometry.byId;
  // Count of catalog SKUs that resolved to REAL geometry (anything != "none").
  const skusWithGeometry = catalogGeometry.withGeometry;
  // AI placeholder coverage. 0 this run (backend down, fail-closed).
  const aiPlaceholderCount = aiPlaceholder.entries.length;

  const selected = useMemo(
    () => (records ? (records.find((p) => p.key === selectedKey) ?? null) : null),
    [records, selectedKey],
  );

  const counts = useMemo(
    () => (records ? catalogCounts(records) : { present: 0, total: 0 }),
    [records],
  );

  // STANDALONE imported manufacturer-verified parts (T54): REAL downloaded,
  // licensed manufacturer STEP files surfaced at the top tier. Empty by default;
  // after the KSB Etanorm import the manifest carries one operator-verified entry.
  const manufacturerVerified: ManufacturerVerifiedPart[] = useMemo(
    () => manufacturerVerifiedParts(mfgStep),
    [mfgStep],
  );

  // K (manufacturer-verified) = standalone imported manufacturer parts PLUS legacy
  // part records that earned the upgrade. With the shipped empty manifest this is
  // 0; after the KSB import it is 1. Honest, visible truth.
  const manufacturerVerifiedCount = useMemo(() => {
    const recordUpgrades = records
      ? records.filter((r) => r.modelStatus === 'manufacturer_verified').length
      : 0;
    return manufacturerVerified.length + recordUpgrades;
  }, [records, manufacturerVerified]);

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

  // Head SKU options for assembly mode: catalog entries with a head category.
  const assemblyHeadOptions = useMemo(
    () =>
      (mfrCatalog?.entries ?? []).filter((p) => p.category.startsWith('head')),
    [mfrCatalog],
  );

  // Default the selected assembly head SKU to the first catalog head once loaded.
  useEffect(() => {
    if (assemblyHeadSku === null && assemblyHeadOptions.length > 0) {
      setAssemblyHeadSku(assemblyHeadOptions[0].id);
    }
  }, [assemblyHeadSku, assemblyHeadOptions]);

  // The chosen head SKU's resolved geometry (purely from already-loaded manifests).
  // computeAssembly stays pure: we resolve here and pass the result down.
  const assemblyHeadGeometry: ResolvedHeadGeometry | null = useMemo(() => {
    const part = assemblyHeadOptions.find((p) => p.id === assemblyHeadSku) ?? null;
    if (!part) return null;
    const geo = resolveCatalogGeometry(part, {
      manufacturerStep: mfgStep,
      build123dParts: b123Manifest,
      aiPlaceholder,
    });
    return {
      source: geo.source,
      build123dKey: geo.build123dKey,
      modelStatus: geo.modelStatus,
    };
  }, [assemblyHeadOptions, assemblyHeadSku, mfgStep, b123Manifest, aiPlaceholder]);

  // The computed system assembly (deterministic, pure layout).
  const assembly = useMemo(
    () =>
      computeAssembly({
        headSku: assemblyHeadSku ?? '',
        hazard: assemblyHazard,
        branchCount: assemblyBranchCount,
        headsPerBranch: assemblyHeadsPerBranch,
        headGeometry: assemblyHeadGeometry,
      }),
    [
      assemblyHeadSku,
      assemblyHazard,
      assemblyBranchCount,
      assemblyHeadsPerBranch,
      assemblyHeadGeometry,
    ],
  );

  // Best-effort priced bid ESTIMATE for the current layout (deterministic).
  const bid = useMemo(
    () => estimateFullFromLayout({ widthFt, lengthFt, hazard }, { priceTable }),
    [widthFt, lengthFt, hazard, priceTable],
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
      bidTotal: bid.total,
      manufacturerVerifiedCount,
      dimensionedParametricCount,
      catalogPartCount,
      skusWithGeometry,
      aiPlaceholderCount,
      systemRuleCount: RULE_CONSTANT_COUNT,
      assemblyPartCount: assembly.parts.length,
      assemblyHeadsPlaced: assembly.headsPlaced,
      footprintAreaSqft:
        footprint && !footprint.empty ? footprint.areaSqft : null,
      samAvailable,
      // The Add-Catalog UX is always mounted in mfr-catalog mode and both of its
      // paths exist (fail-closed SAM lane + client-side STEP import). Ready true.
      addCatalogReady: true,
      dbPartCount,
      dbAvailable,
      connectorCount: countConnectors({ generatedAt: null, connectors }),
      connectorsEnabledCount: countConnectorsEnabled({
        generatedAt: null,
        connectors,
      }),
    };
  }, [
    records,
    present.length,
    viewMode,
    selectedKey,
    appMode,
    headCount,
    bid.total,
    manufacturerVerifiedCount,
    dimensionedParametricCount,
    catalogPartCount,
    skusWithGeometry,
    aiPlaceholderCount,
    assembly.parts.length,
    assembly.headsPlaced,
    footprint,
    samAvailable,
    dbPartCount,
    dbAvailable,
    connectors,
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
          {appMode === 'mfr-catalog' ? (
            <>
              <strong style={statusNumStyle}>
                {dbAvailable ? dbPartCount : catalogPartCount}
              </strong>{' '}
              parts {dbAvailable ? 'in DB' : '(catalog)'}{' '}
              <span style={statusSepStyle}>·</span>{' '}
              <strong style={statusNumStyle}>{skusWithGeometry}</strong> with 3D
              geometry <span style={statusSepStyle}>·</span>{' '}
              <strong style={statusNumStyle}>{connectors.length}</strong> connectors
            </>
          ) : appMode === 'system' ? (
            <>
              <strong style={statusNumStyle}>{RULE_CONSTANT_COUNT}</strong>{' '}
              cited NFPA-13 values{' '}
              <span style={statusSepStyle}>·</span> design aid, not code-certified
            </>
          ) : appMode === 'assembly' ? (
            <>
              <strong style={statusNumStyle}>{assembly.headsPlaced}</strong> heads{' '}
              <span style={statusSepStyle}>·</span>{' '}
              <strong style={statusNumStyle}>{assembly.parts.length}</strong> parts{' '}
              <span style={statusSepStyle}>·</span>{' '}
              <strong style={statusNumStyle}>{assembly.spacingFt}</strong> ft spacing{' '}
              <span style={statusSepStyle}>·</span> schematic design aid
            </>
          ) : appMode === 'building' ? (
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
          {appMode === 'mfr-catalog'
            ? 'catalog SPEC records from public manufacturer data sheets · NOT manufacturer-exact geometry · NOT AHJ / PE / code-certified selections'
            : appMode === 'system'
            ? 'design aid based on published NFPA-13 values · NOT a certified hydraulic calculation · NOT AHJ-approved · NOT PE-sealed · NOT for construction'
            : appMode === 'assembly'
            ? 'schematic design-aid assembly from published NFPA-13 spacing + dimensioned-parametric parts · NOT a coordinated/clash-checked model · NOT manufacturer-exact · NOT AHJ / PE-sealed · NOT for construction'
            : appMode === 'building'
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
        ) : appMode === 'mfr-catalog' ? (
          <div style={mfrWrapStyle}>
            <div role="radiogroup" aria-label="Manufacturer view" style={mfrSubNavStyle}>
              <button
                type="button"
                role="radio"
                aria-checked={mfrView === 'browse'}
                onClick={() => setMfrView('browse')}
                style={{
                  ...segmentBtnStyle,
                  background: mfrView === 'browse' ? colors.interactiveActive : 'transparent',
                  color: mfrView === 'browse' ? '#ffffff' : colors.textSecondary,
                  fontWeight: mfrView === 'browse' ? 600 : 500,
                }}
              >
                Browse catalog
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mfrView === 'add'}
                onClick={() => setMfrView('add')}
                data-testid="add-catalog-toggle"
                style={{
                  ...segmentBtnStyle,
                  background: mfrView === 'add' ? colors.interactiveActive : 'transparent',
                  color: mfrView === 'add' ? '#ffffff' : colors.textSecondary,
                  fontWeight: mfrView === 'add' ? 600 : 500,
                }}
              >
                Add Catalog
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mfrView === 'connectors'}
                onClick={() => setMfrView('connectors')}
                data-testid="connectors-toggle"
                style={{
                  ...segmentBtnStyle,
                  background: mfrView === 'connectors' ? colors.interactiveActive : 'transparent',
                  color: mfrView === 'connectors' ? '#ffffff' : colors.textSecondary,
                  fontWeight: mfrView === 'connectors' ? 600 : 500,
                }}
              >
                Connectors
              </button>
            </div>
            {mfrView === 'add' ? (
              <AddCatalogPanel samInvoker={samInvoker} />
            ) : mfrView === 'connectors' ? (
              <ManufacturersPanel connectors={connectors} />
            ) : (
              <ManufacturerCatalogPanel
                catalog={mfrCatalog}
                geometryById={geometryById}
                verifiedParts={manufacturerVerified}
              />
            )}
          </div>
        ) : appMode === 'system' ? (
          <SystemPanel catalog={mfrCatalog} />
        ) : appMode === 'assembly' ? (
          <>
            <AssemblyControls
              headSku={assemblyHeadSku}
              hazard={assemblyHazard}
              branchCount={assemblyBranchCount}
              headsPerBranch={assemblyHeadsPerBranch}
              headOptions={assemblyHeadOptions}
              assembly={assembly}
              onHeadSkuChange={setAssemblyHeadSku}
              onHazardChange={setAssemblyHazard}
              onBranchCountChange={setAssemblyBranchCount}
              onHeadsPerBranchChange={setAssemblyHeadsPerBranch}
            />

            <main style={canvasWrapStyle} aria-label="System assembly viewer">
              <Canvas
                shadows
                dpr={[1, 2]}
                gl={{ preserveDrawingBuffer: true }}
                camera={{
                  position: [
                    assembly.spacingFt * 2.2,
                    assembly.spacingFt * 1.8 + 6,
                    assembly.spacingFt * 2.2,
                  ],
                  up: [0, 1, 0],
                  fov: 50,
                }}
                key={`assembly-${viewMode}-${assembly.parts.length}-${assembly.spacingFt}`}
              >
                <Suspense fallback={null}>
                  <AssemblyScene assembly={assembly} viewMode={viewMode} />
                </Suspense>
              </Canvas>
            </main>
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

            <BidPanel bid={bid} />
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
    { mode: 'mfr-catalog', label: 'Manufacturer' },
    { mode: 'system', label: 'System' },
    { mode: 'assembly', label: 'Assembly' },
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

const mfrWrapStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  background: colors.bg,
};

const mfrSubNavStyle: CSSProperties = {
  display: 'inline-flex',
  alignSelf: 'flex-start',
  gap: spacing[0.5],
  margin: spacing[3],
  background: colors.bgInset,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.lg,
  padding: spacing[0.5],
};
