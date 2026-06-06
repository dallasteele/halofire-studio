// PURE catalog-SKU -> 3D-geometry resolver — no React / three / network imports.
//
// SCOPE: connect each ingested manufacturer catalog SKU (manufacturer-catalog.ts,
// CatalogPart) to the BEST available 3D geometry, by a strict PRIORITY ladder, and
// report the provenance tier (provenance.ts ModelStatus) + whether the result is
// engineering-accurate. This is the GX10-independent path toward "CAD models for
// all parts": real parametric build123d geometry today, manufacturer-STEP when an
// operator drops one in, AI placeholder only when a live backend produced one.
//
// PRIORITY (highest first):
//   1. manufacturer-step  -> manufacturer_verified  (engineeringAccurate=true)
//   2. build123d (match by category + nominalSizeIn) -> dimensioned_parametric
//   3. ai-placeholder     -> visual_reference        (engineeringAccurate=false)
//   4. none               -> null geometry, no tier claim
//
// HONESTY (hard, fail-closed):
//   - engineeringAccurate is true ONLY for manufacturer_verified. Build123d is a
//     dimensioned-parametric APPROXIMATION (real NPT thread size, approximate body
//     massing) — NOT manufacturer-exact, NOT AHJ / PE / code-certified.
//   - ANY uncertainty fails SAFE to a lower tier or to `none`. A catalog SKU with
//     no real asset returns source:"none", modelStatus:null, assetUrl:null — we
//     NEVER guess a tier or fabricate a URL.
//   - The build123d match requires a parametric-VERIFIED entry (real stepUrl +
//     sha256) whose category + nominalSizeIn EXACTLY equal the SKU's. A SKU whose
//     port size is null, or whose (category,size) has no build123d body, drops to
//     the next tier and ultimately to `none`.

import type { CatalogPart } from './manufacturer-catalog';
import type { ModelStatus } from './provenance';
import {
  isParametricVerified,
  type Build123dManifest,
  type Build123dPartEntry,
} from './build123d-parts';
import {
  isOperatorVerified,
  type ManufacturerStepEntry,
  type ManufacturerStepManifest,
} from './manufacturer-step';

/** Where the resolved geometry came from. "none" = no real asset exists yet. */
export type CatalogGeometrySource =
  | 'manufacturer-step'
  | 'build123d'
  | 'ai-placeholder'
  | 'none';

/** One AI-placeholder asset (visual_reference only) produced by a live backend. */
export interface AiPlaceholderEntry {
  /** Catalog SKU id this placeholder is for (matches CatalogPart.id). */
  skuId: string;
  /** URL to the generated mesh asset (glb/obj/etc.). */
  assetUrl: string;
  /** Optional source/citation. */
  sourceUrl?: string;
}

export interface AiPlaceholderManifest {
  entries: AiPlaceholderEntry[];
}

/** Resolution inputs: the available geometry sources, all OPTIONAL / fail-soft. */
export interface CatalogGeometrySources {
  /** Operator-supplied manufacturer-STEP manifest (empty by default). */
  manufacturerStep?: ManufacturerStepManifest | null;
  /** build123d parametric-STEP manifest (the real Tier-2 library). */
  build123dParts?: Build123dManifest | null;
  /** AI placeholder manifest (EMPTY this run — backend down). */
  aiPlaceholder?: AiPlaceholderManifest | null;
}

/** The resolved geometry for one catalog SKU. */
export interface CatalogGeometry {
  /** SKU id this resolution is for. */
  skuId: string;
  /** Which source won the priority ladder. "none" => no geometry. */
  source: CatalogGeometrySource;
  /**
   * Provenance tier of the resolved geometry, or null when source==="none".
   * NEVER a guessed tier — null is the honest "no real asset" answer.
   */
  modelStatus: ModelStatus | null;
  /** URL to the resolved STEP / mesh asset, or null when source==="none". */
  assetUrl: string | null;
  /**
   * True ONLY for manufacturer_verified geometry. build123d
   * (dimensioned_parametric) and ai-placeholder (visual_reference) are NOT
   * engineering-accurate.
   */
  engineeringAccurate: boolean;
  /**
   * The matched build123d part key, when source==="build123d". Lets the UI load
   * the exact STEP file / render it. undefined for other sources.
   */
  build123dKey?: string;
}

/** The honest "no geometry" answer for a SKU. */
function noneGeometry(skuId: string): CatalogGeometry {
  return {
    skuId,
    source: 'none',
    modelStatus: null,
    assetUrl: null,
    engineeringAccurate: false,
  };
}

/**
 * Find a manufacturer-STEP entry for this SKU. Operator-step entries are keyed
 * by catalog part KEY (the part-manifest key, e.g. "head_pendent"), but a
 * catalog SKU can also be matched directly when an operator keys the entry to
 * the SKU id. We accept a match on EITHER the SKU id or the SKU's category, and
 * ONLY when the entry is operator-verified (real stepUrl + sha256). Anything
 * weaker is ignored (fail-safe).
 */
function findManufacturerStep(
  sku: CatalogPart,
  manifest: ManufacturerStepManifest | null | undefined,
): ManufacturerStepEntry | null {
  const entries = manifest?.entries;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  for (const e of entries) {
    if (!isOperatorVerified(e)) continue;
    if (e.key === sku.id || e.key === sku.category) return e;
  }
  return null;
}

/**
 * Find a parametric-verified build123d entry whose category + nominalSizeIn
 * EXACTLY match the SKU's. Requires the SKU to carry a real port nominal size;
 * a null size cannot be matched (fail-safe -> drop to next tier). Only entries
 * carrying BOTH a category and a nominalSizeIn participate (the size-specific
 * head bodies); legacy non-head entries never match a catalog head SKU here.
 */
function findBuild123d(
  sku: CatalogPart,
  manifest: Build123dManifest | null | undefined,
): Build123dPartEntry | null {
  const size = sku.port?.nominalSizeIn;
  if (typeof size !== 'number' || !Number.isFinite(size)) return null;
  const entries = manifest?.entries;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  for (const e of entries) {
    if (!isParametricVerified(e)) continue;
    if (e.category !== sku.category) continue;
    if (typeof e.nominalSizeIn !== 'number') continue;
    if (e.nominalSizeIn === size) return e;
  }
  return null;
}

/** Find an AI placeholder for this SKU id (visual_reference only). */
function findAiPlaceholder(
  sku: CatalogPart,
  manifest: AiPlaceholderManifest | null | undefined,
): AiPlaceholderEntry | null {
  const entries = manifest?.entries;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    if (e.skuId !== sku.id) continue;
    const url = e.assetUrl;
    if (typeof url !== 'string' || url.trim().length === 0) continue;
    return e;
  }
  return null;
}

/**
 * Resolve the BEST available geometry for one catalog SKU by the priority
 * ladder. Returns a fully-typed CatalogGeometry; `none` when no real asset
 * exists. Pure + deterministic; never touches the network and never fabricates.
 */
export function resolveCatalogGeometry(
  sku: CatalogPart,
  sources: CatalogGeometrySources = {},
): CatalogGeometry {
  // 1. manufacturer-step -> manufacturer_verified (the only engineeringAccurate tier).
  const mfg = findManufacturerStep(sku, sources.manufacturerStep);
  if (mfg) {
    return {
      skuId: sku.id,
      source: 'manufacturer-step',
      modelStatus: 'manufacturer_verified',
      assetUrl: mfg.stepUrl,
      engineeringAccurate: true,
    };
  }

  // 2. build123d (category + nominalSizeIn match) -> dimensioned_parametric.
  const b123 = findBuild123d(sku, sources.build123dParts);
  if (b123) {
    return {
      skuId: sku.id,
      source: 'build123d',
      modelStatus: 'dimensioned_parametric',
      assetUrl: b123.stepUrl,
      engineeringAccurate: false,
      build123dKey: b123.key,
    };
  }

  // 3. ai-placeholder -> visual_reference (NEVER engineeringAccurate).
  const ai = findAiPlaceholder(sku, sources.aiPlaceholder);
  if (ai) {
    return {
      skuId: sku.id,
      source: 'ai-placeholder',
      modelStatus: 'visual_reference',
      assetUrl: ai.assetUrl,
      engineeringAccurate: false,
    };
  }

  // 4. none — the honest "no real asset yet" answer.
  return noneGeometry(sku.id);
}

/**
 * Resolve geometry for every SKU and return a Map keyed by SKU id, plus a count
 * of how many resolved to REAL geometry (anything other than "none"). The count
 * is the honest window.__studio.skusWithGeometry value.
 */
export function resolveCatalogGeometryAll(
  skus: readonly CatalogPart[],
  sources: CatalogGeometrySources = {},
): { byId: Map<string, CatalogGeometry>; withGeometry: number } {
  const byId = new Map<string, CatalogGeometry>();
  let withGeometry = 0;
  for (const sku of skus) {
    const geo = resolveCatalogGeometry(sku, sources);
    byId.set(sku.id, geo);
    if (geo.source !== 'none') withGeometry += 1;
  }
  return { byId, withGeometry };
}

/**
 * Fail-soft loader for the AI placeholder manifest. With NO fetch impl, or a
 * fetch that fails / 4xx-5xx / invalid JSON / no entries array, returns an EMPTY
 * manifest. The shipped /parts/ai-placeholder.json is intentionally EMPTY this
 * run (the generate_3d_model backend is down — see ai-3d-invoker.ts).
 */
export async function loadAiPlaceholderManifest(
  fetchImpl?: typeof fetch,
): Promise<AiPlaceholderManifest> {
  const empty: AiPlaceholderManifest = { entries: [] };
  if (typeof fetchImpl !== 'function') return empty;
  try {
    const res = await fetchImpl('/parts/ai-placeholder.json');
    if (!res || !res.ok) return empty;
    const json = (await res.json()) as unknown;
    if (
      !json ||
      typeof json !== 'object' ||
      !Array.isArray((json as { entries?: unknown }).entries)
    ) {
      return empty;
    }
    const entries = (json as { entries: unknown[] }).entries.filter(
      (e): e is AiPlaceholderEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as { skuId?: unknown }).skuId === 'string' &&
        typeof (e as { assetUrl?: unknown }).assetUrl === 'string' &&
        (e as { assetUrl: string }).assetUrl.trim().length > 0,
    );
    return { entries };
  } catch {
    return empty;
  }
}
