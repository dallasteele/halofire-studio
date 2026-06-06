// HaloFire CAD — W8 REAL per-part CAD geometry resolver + in-browser STEP loader.
//
// SCOPE: map every sprinkler-network part (head / tee / elbow / reducer / cross /
// riser / valve / pipe) to its BEST available REAL STEP body — the committed
// build123d parametric library (Tier dimensioned_parametric) or, when an operator
// has dropped a manufacturer STEP locally, the manufacturer body (Tier
// manufacturer_verified) — and decode that STEP into a THREE.BufferGeometry in the
// browser via occt-import-js. This replaces the placeholder glyphs (sphere+cone
// head, box fitting) the CAD viewer drew before.
//
// TWO HALVES, cleanly split:
//   1. resolvePartModel(...) — PURE, deterministic, no React/three/network. Maps a
//      Node|Segment to { stepUrl, source, provenanceTier, build123dKey } by a strict
//      priority ladder, validating the chosen key actually exists in the manifest.
//      Returns null ONLY when truly no model resolves -> the caller draws a clearly
//      flagged PROXY. This half is fully unit-tested.
//   2. loadPartGeometry(stepUrl) — BROWSER-ONLY, async, CACHED by url. Decodes the
//      STEP via occt-import-js (the same proven path as the studio's step-loader),
//      returns a centered+normal'd THREE.BufferGeometry. Repeat urls return the
//      SAME cached geometry instance (perf + instancing). Fail-soft: throws on real
//      load error so the caller can fall back to a proxy.
//
// HONESTY (hard, fail-closed):
//   - build123d bodies are dimensioned_parametric — REAL parametric CAD dimensions,
//     explicitly NOT manufacturer-exact, NOT AHJ / PE / code-certified.
//   - manufacturer-step bodies (operator-supplied, real stepUrl + sha256) are the
//     ONLY manufacturer_verified tier; absent a local .stp we fall back to build123d.
//   - A part that resolves to NO real key returns null. We NEVER fabricate a key or
//     claim a tier we cannot back with a committed STEP file.

import { BufferAttribute, BufferGeometry, Box3, Vector3 } from 'three';
import type { ModelStatus } from '../../../studio/src/lib/provenance';
import {
  isParametricVerified,
  type Build123dManifest,
} from '../../../studio/src/lib/build123d-parts';
import {
  isOperatorVerified,
  type ManufacturerStepManifest,
} from '../../../studio/src/lib/manufacturer-step';
import { resolveCatalogGeometry } from '../../../studio/src/lib/catalog-geometry';
import type { CatalogPart } from './head-catalog';
import type { Node, NodeType, PipeMaterial, Segment } from './model';

/* ------------------------------------------------------------ resolver types */

/** Which geometry library a resolved model came from. */
export type PartModelSource = 'manufacturer-step' | 'build123d';

/** A resolved REAL CAD model for one part. Never returned for a proxy (null). */
export interface ResolvedPartModel {
  /** Public URL to the STEP file the viewer loads (served from /parts/...). */
  stepUrl: string;
  /** Which library it came from. */
  source: PartModelSource;
  /**
   * Provenance tier carried into the UI. 'dimensioned_parametric' for build123d,
   * 'manufacturer_verified' for an operator manufacturer STEP. NEVER a guessed tier.
   */
  provenanceTier: ModelStatus;
  /** The build123d manifest key (when source==='build123d'); manufacturer key otherwise. */
  build123dKey: string;
  /**
   * True ONLY for manufacturer_verified. build123d (dimensioned_parametric) is real
   * dimensioned geometry but NOT manufacturer-exact -> false.
   */
  engineeringAccurate: boolean;
}

/** Inputs to the resolver — all the available geometry libraries + head context. */
export interface ResolvePartOpts {
  /** The committed build123d parametric manifest (the Tier-2 library). */
  build123d?: Build123dManifest | null;
  /** Operator-supplied manufacturer-STEP manifest (local-only; empty by default). */
  manufacturerStep?: ManufacturerStepManifest | null;
  /**
   * The resolved catalog HEAD part for a HEAD node (carries category + port size).
   * When present, the head is resolved by (category, nominalSizeIn) via the SAME
   * catalog-geometry resolver the studio uses. Ignored for non-head parts.
   */
  headPart?: CatalogPart | null;
}

/* -------------------------------------------------- node-type -> build123d key */

/**
 * Default build123d key for each non-head node type. Heads are resolved separately
 * (by catalog category + size). These keys MUST exist in build123d-parts.json — the
 * resolver still validates presence so a missing file fails to a proxy, never a
 * fabricated model.
 *   TEE     -> fitting_tee
 *   ELBOW   -> fitting_elbow_90  (90-degree is the routed turn)
 *   REDUCER -> fitting_reducer
 *   CROSS   -> fitting_cross
 *   SOURCE  -> valve_osy_gate    (the riser's main control valve body)
 *   VALVE   -> valve_osy_gate
 */
export const NODE_TYPE_KEY: Partial<Record<NodeType, string>> = {
  TEE: 'fitting_tee',
  ELBOW: 'fitting_elbow_90',
  REDUCER: 'fitting_reducer',
  CROSS: 'fitting_cross',
  SOURCE: 'valve_osy_gate',
  VALVE: 'valve_osy_gate',
};

/** Pipe material -> build123d pipe key. Steel Sch10 uses the Sch10 body; all else Sch40. */
export function pipeKeyForMaterial(material: PipeMaterial): string {
  return material === 'STEEL_SCH10' ? 'pipe_sch10' : 'pipe_sch40';
}

/**
 * Default head build123d key for a head category + nominal size, matching the keys
 * that exist in build123d-parts.json. The library carries size-specific pendent
 * (0.5 / 0.75 / 1.0), upright (0.5 / 0.75), and sidewall (0.5 / 1.0) bodies; we pick
 * the nearest available size, defaulting to pendent 1/2" — the most common head.
 */
export function headKeyFor(category: string | null | undefined, sizeIn: number | null | undefined): string {
  const cat = (category ?? 'head_pendent').toLowerCase();
  const size = typeof sizeIn === 'number' && Number.isFinite(sizeIn) ? sizeIn : 0.5;
  if (cat.includes('upright')) {
    return size >= 0.75 ? 'head_upright_075' : 'head_upright';
  }
  if (cat.includes('sidewall')) {
    return size >= 1.0 ? 'head_sidewall_100' : 'head_sidewall';
  }
  // pendent (default): 1/2", 3/4", 1"
  if (size >= 1.0) return 'head_pendent_100';
  if (size >= 0.75) return 'head_pendent_075';
  return 'head_pendent';
}

/* --------------------------------------------------------- key existence check */

/**
 * True when a build123d key is present AND parametric-verified (real stepUrl +
 * sha256) in the manifest. The resolver only resolves to a verified key, so a
 * missing/half-baked entry fails SAFE to a proxy.
 */
export function build123dHasKey(
  manifest: Build123dManifest | null | undefined,
  key: string,
): boolean {
  const entries = manifest?.entries;
  if (!Array.isArray(entries)) return false;
  return entries.some((e) => e.key === key && isParametricVerified(e));
}

/** The public step url for a build123d key (served from cad public/parts/build123d). */
export function build123dStepUrl(key: string): string {
  return `/parts/build123d/${key}.step`;
}

/* --------------------------------------------------------------- resolvePartModel */

/**
 * PURE. Resolve the BEST real CAD model for one network part.
 *
 * Priority ladder:
 *   1. HEAD with a resolved CatalogPart -> reuse resolveCatalogGeometry (manufacturer
 *      STEP if an operator supplied one for the SKU, else build123d by category+size).
 *   2. HEAD without a CatalogPart -> default build123d head key by category+size.
 *   3. Non-head node -> NODE_TYPE_KEY[type] (manufacturer-step override by key wins).
 *   4. Segment (pipe) -> pipe_sch10 / pipe_sch40 by material.
 *
 * Returns null ONLY when the chosen key is not present as a verified body in any
 * supplied manifest -> the caller draws a clearly-flagged proxy.
 */
export function resolvePartModel(
  target: Node | Segment,
  opts: ResolvePartOpts = {},
): ResolvedPartModel | null {
  const build123d = opts.build123d ?? null;
  const mfg = opts.manufacturerStep ?? null;

  // --- Segment (pipe run) ---
  if (isSegment(target)) {
    const key = pipeKeyForMaterial(target.material);
    return resolveByKey(key, build123d, mfg);
  }

  // --- Node ---
  const node = target;

  if (node.type === 'HEAD') {
    // 1. A resolved catalog head delegates to the SAME catalog-geometry resolver
    //    the studio uses (manufacturer-step -> build123d -> none).
    if (opts.headPart) {
      const geo = resolveCatalogGeometry(opts.headPart, {
        manufacturerStep: mfg,
        build123dParts: build123d,
      });
      if (geo.source === 'manufacturer-step' && geo.assetUrl && geo.modelStatus) {
        return {
          stepUrl: geo.assetUrl,
          source: 'manufacturer-step',
          provenanceTier: geo.modelStatus,
          build123dKey: opts.headPart.id,
          engineeringAccurate: true,
        };
      }
      if (geo.source === 'build123d' && geo.assetUrl && geo.build123dKey) {
        return {
          stepUrl: geo.assetUrl,
          source: 'build123d',
          provenanceTier: 'dimensioned_parametric',
          build123dKey: geo.build123dKey,
          engineeringAccurate: false,
        };
      }
      // Catalog resolved to none -> fall through to the default-head key below using
      // the catalog part's category/size as hints.
      const key = headKeyFor(opts.headPart.category, opts.headPart.port?.nominalSizeIn ?? null);
      return resolveByKey(key, build123d, mfg);
    }
    // 2. No catalog part -> default head key by category+size.
    const key = headKeyFor(null, null);
    return resolveByKey(key, build123d, mfg);
  }

  // 3. Non-head node by type.
  const key = NODE_TYPE_KEY[node.type];
  if (!key) return null;
  return resolveByKey(key, build123d, mfg);
}

/**
 * Resolve a single build123d key, honoring a manufacturer-step override on the SAME
 * key (operator-verified). Returns null when neither manifest has a verified body.
 */
function resolveByKey(
  key: string,
  build123d: Build123dManifest | null,
  mfg: ManufacturerStepManifest | null,
): ResolvedPartModel | null {
  // Manufacturer STEP keyed to this part-key WINS (manufacturer_verified) when present.
  const mfgEntry = mfg?.entries?.find((e) => e.key === key && isOperatorVerified(e));
  if (mfgEntry) {
    return {
      stepUrl: mfgEntry.stepUrl,
      source: 'manufacturer-step',
      provenanceTier: 'manufacturer_verified',
      build123dKey: key,
      engineeringAccurate: true,
    };
  }
  // build123d parametric body (dimensioned_parametric) when the key exists + verified.
  if (build123dHasKey(build123d, key)) {
    return {
      stepUrl: build123dStepUrl(key),
      source: 'build123d',
      provenanceTier: 'dimensioned_parametric',
      build123dKey: key,
      engineeringAccurate: false,
    };
  }
  return null;
}

/** Type guard: a Segment carries `from`/`to`; a Node carries `type`/`pos`. */
function isSegment(t: Node | Segment): t is Segment {
  return (
    typeof (t as Segment).from === 'string' &&
    typeof (t as Segment).to === 'string' &&
    typeof (t as Segment).material === 'string'
  );
}

/* ---------------------------------------------------- browser STEP geometry load */

/** Shape of one mesh inside the occt-import-js result. */
interface OcctMesh {
  attributes: {
    position: { array: number[] | Float32Array };
    normal?: { array: number[] | Float32Array };
  };
}

/** Shape of the object returned by occt-import-js ReadStepFile. */
interface OcctResult {
  success: boolean;
  meshes: OcctMesh[];
}

/** occt-import-js public entrypoint after the WASM module initializes. */
export interface OcctModule {
  ReadStepFile(content: Uint8Array): OcctResult;
}

/** Factory producing an initialized OcctModule (Emscripten promise factory). */
export type OcctFactory = () => Promise<OcctModule>;

/**
 * Lazy default factory — dynamic import so module load has zero side effects. The
 * occt-import-js WASM is COPIED into public/occt-import-js.wasm so it is served at a
 * stable URL in both dev and the production build; we pass `locateFile` so the
 * Emscripten loader fetches it from there instead of guessing a hashed asset path.
 */
async function defaultOcctFactory(): Promise<OcctModule> {
  const mod = (await import('occt-import-js')) as unknown as {
    default?: (opts?: { locateFile?: (file: string) => string }) => Promise<OcctModule>;
  };
  const init = mod.default;
  if (typeof init !== 'function') {
    throw new Error('occt-import-js default export is not a factory function');
  }
  return init({
    locateFile: (file: string) => (file.endsWith('.wasm') ? '/occt-import-js.wasm' : file),
  });
}

/**
 * Per-url cache. Repeat loads of the SAME stepUrl return the SAME Promise (and thus
 * the SAME resolved BufferGeometry instance) so 28 heads of one SKU share ONE loaded
 * geometry — the perf basis for instancing in the viewer. A failed load is evicted
 * so a later retry can re-attempt.
 */
const geometryCache = new Map<string, Promise<BufferGeometry>>();

/**
 * BROWSER-ONLY. Load + decode a STEP file into a centered, normal'd
 * THREE.BufferGeometry. Cached by url: the same url resolves to the SAME geometry
 * instance every call. Throws on fetch/parse failure (caller falls back to a proxy).
 *
 * The geometry is centered on its bounding-box midpoint and has computed vertex
 * normals so the viewer can scale/orient it freely. It is NOT normalized to a unit
 * size here (the viewer applies a per-family display scale) — dimensions are real mm.
 */
export function loadPartGeometry(
  stepUrl: string,
  fetchImpl?: typeof fetch,
  occtFactory?: OcctFactory,
): Promise<BufferGeometry> {
  if (typeof stepUrl !== 'string' || stepUrl.length === 0) {
    return Promise.reject(new Error('loadPartGeometry: empty url'));
  }
  const cached = geometryCache.get(stepUrl);
  if (cached) return cached;

  const p = decodeStep(stepUrl, fetchImpl, occtFactory).catch((err) => {
    // Evict on failure so a later attempt can retry rather than caching the error.
    geometryCache.delete(stepUrl);
    throw err;
  });
  geometryCache.set(stepUrl, p);
  return p;
}

/** The actual fetch + occt decode + BufferGeometry build (uncached). */
async function decodeStep(
  stepUrl: string,
  fetchImpl?: typeof fetch,
  occtFactory?: OcctFactory,
): Promise<BufferGeometry> {
  const f = fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
  if (typeof f !== 'function') {
    throw new Error('loadPartGeometry: no fetch implementation available');
  }
  const res = await f(stepUrl);
  if (!res.ok) {
    throw new Error(`loadPartGeometry: HTTP ${res.status} for ${stepUrl}`.trim());
  }
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);

  const factory = occtFactory ?? defaultOcctFactory;
  const occt = await factory();
  const result = occt.ReadStepFile(bytes);
  if (!result || !result.success || !Array.isArray(result.meshes) || result.meshes.length === 0) {
    throw new Error('loadPartGeometry: occt-import-js failed to parse STEP file');
  }

  const positionsArrays: Float32Array[] = [];
  const normalsArrays: Float32Array[] = [];
  for (const m of result.meshes) {
    const pos = m.attributes.position.array;
    const nrm = m.attributes.normal?.array;
    positionsArrays.push(pos instanceof Float32Array ? pos : new Float32Array(pos));
    if (nrm) normalsArrays.push(nrm instanceof Float32Array ? nrm : new Float32Array(nrm));
  }
  const positions = concatFloat32(positionsArrays);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  if (normalsArrays.length > 0) {
    const normals = concatFloat32(normalsArrays);
    if (normals.length === positions.length) {
      geo.setAttribute('normal', new BufferAttribute(normals, 3));
    }
  }
  geo.center();
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}

function concatFloat32(parts: Float32Array[]): Float32Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * The normalized display scale (a uniform factor) to draw a loaded geometry at a
 * target size (feet) given its real bounding box. The build123d bodies are in mm;
 * the viewer renders in feet. This keeps a head ~targetFt tall regardless of its
 * real mm extent. PURE helper (no three side effects beyond reading the bbox).
 */
export function displayScaleFor(geo: BufferGeometry, targetFt: number): number {
  geo.computeBoundingBox();
  const box = geo.boundingBox ?? new Box3();
  const size = new Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  return targetFt / maxDim;
}

/** TEST-ONLY: clear the geometry cache (so tests start clean). */
export function __clearPartGeometryCache(): void {
  geometryCache.clear();
}
