/**
 * Real CAD part-mesh loader for the Studio (Stream C).
 *
 * Loads the REAL generated STL mesh for a catalog part key (the R1 pipeline's
 * parts/<key>.stl, indexed by GET /api/parts) and hands back a true-scale
 * three.js BufferGeometry plus an Inspector-ready provenance record. Falls back
 * GRACEFULLY to `geometry: null` when no real mesh exists — the caller keeps
 * rendering its current primitive and shows the provenance note instead.
 *
 * UNIT CONVENTION (true scale — document of record):
 *   - The OpenSCAD emitters (src/components/openscad/generators.js) emit
 *     MILLIMETRES, so every parts/<key>.stl is a millimetre mesh.
 *   - The Studio world is 1 world unit = 1 FOOT (HF-A1-TRUESCALE).
 *   - This module converts mm -> ft by scaling 1/304.8 (MM_PER_FT). No
 *     normalize-to-target-size scaling happens here: a 63.5 mm coupling OD
 *     arrives as 0.2083 ft, exactly its generated dimension.
 *   - Axis: OpenSCAD is Z-up; three.js is Y-up. Geometry is rotated
 *     rotateX(-PI/2) so the part's +Z becomes the world +Y.
 *
 * HONESTY / fail-closed (doctrine, NON-NEGOTIABLE):
 *   - Generated meshes are best-effort parametric massing — explicitly NOT
 *     manufacturer-exact. Every provenance record carries
 *     needsVerification:true and manufacturerExact is forced false unless the
 *     manifest entry is a real catalog/manufacturer source (R4 override).
 *   - Parts with no real mesh (or aliases mapping to none, e.g. escutcheon)
 *     resolve to geometry:null + a 'primitive' provenance — no mesh is ever
 *     fabricated, and nothing here touches the AUTOSPRINK_PARITY gate.
 *
 * Browser-first ES module (imports 'three' via the page importmap) but also
 * Node-importable: STLLoader.parse works on ArrayBuffers without a DOM, and
 * the manifest/STL fetchers are injectable for offline tests.
 */

import { Vector3 } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

/** Millimetres per Studio world unit (1 unit = 1 ft). */
export const MM_PER_FT = 304.8;

export const PART_MESH_DISCLAIMER =
  'Generated part mesh — best-effort parametric massing, NOT manufacturer-exact; ' +
  'no AutoSprink/AutoCAD/AHJ/PE approval. needs-verification.';

/**
 * Studio part-kind -> registry component key. The Studio's primitive builders
 * use informal kinds (the push()/place() vocabulary in autosprink.html); this
 * maps them onto the canonical registry keys the parts manifest understands.
 *
 * Honest gaps (mapped to null ON PURPOSE — primitive fallback, never faked):
 *   - drop_nipple: a nipple is a short pipe; the only pipe meshes are 10-ft
 *     default runs, so reusing them would be wrong-scale. No honest mesh yet.
 *   - escutcheon: no registry entry and no emitter. No honest mesh yet.
 */
export const PART_KEY_ALIASES = Object.freeze({
  sprinkler_head: 'head_pendent',
  head: 'head_pendent',
  rigid_coupling: 'grooved_coupling', // one grooved-coupling massing serves both
  flexible_coupling: 'grooved_coupling', // until distinct rigid/flex models exist
  coupling: 'fitting_coupling',
  branch_tee: 'fitting_tee',
  tee: 'fitting_tee',
  elbow: 'fitting_elbow_90',
  hanger_ring: 'hanger',
  band_hanger: 'hanger',
  drop_nipple: null, // no honest generated mesh — primitive fallback
  escutcheon: null, // no honest generated mesh — primitive fallback
});

/** Resolve a Studio part kind or registry key to a canonical registry key (or null). */
export function resolvePartKey(kindOrKey) {
  const k = String(kindOrKey == null ? '' : kindOrKey).trim();
  if (!k) return null;
  if (Object.prototype.hasOwnProperty.call(PART_KEY_ALIASES, k)) return PART_KEY_ALIASES[k];
  return k; // assume it is already a registry key; the manifest decides if it exists
}

/** Only real catalog/manufacturer sources may ever claim manufacturer-exact. */
const REAL_PART_SOURCES = new Set(['catalog', 'manufacturer']);

/** Build the Inspector-ready provenance record for a manifest entry (or a gap). */
function provenanceFor(requestedKey, key, entry, status) {
  const source = entry && typeof entry.source === 'string' ? entry.source : 'missing';
  const manufacturerExact = Boolean(
    entry && REAL_PART_SOURCES.has(source) && entry.manufacturerExact === true,
  );
  return Object.freeze({
    requestedKey: String(requestedKey),
    key: key || null,
    status, // 'mesh' | 'primitive'
    source: status === 'mesh' ? source : 'primitive',
    manufacturerExact,
    needsVerification: true, // ALWAYS — flag-don't-gate
    note:
      status === 'mesh'
        ? PART_MESH_DISCLAIMER
        : 'No real part mesh available for this part — rendered as a marked primitive. needs-verification.',
  });
}

/**
 * Tiny LRU for parsed geometries: Map insertion order, refresh-on-get, evict
 * the oldest (and dispose its GPU buffers) past capacity.
 */
class GeometryLru {
  constructor(capacity) {
    this.capacity = Math.max(1, capacity | 0);
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      const evicted = this.map.get(oldest);
      this.map.delete(oldest);
      if (evicted && evicted.geometry && typeof evicted.geometry.dispose === 'function') {
        evicted.geometry.dispose();
      }
    }
  }
}

/** Default manifest fetcher: the same authenticated /api/parts the Studio uses. */
async function defaultFetchManifest() {
  const r = await fetch('/api/parts', {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error(`GET /api/parts -> ${r.status}`);
  return r.json();
}

/** Default STL fetcher: static mount serves parts/<key>.stl at the site root. */
async function defaultLoadStlBuffer(file) {
  const r = await fetch('/' + String(file).replace(/^\/+/, ''), { credentials: 'include' });
  if (!r.ok) throw new Error(`GET /${file} -> ${r.status}`);
  return r.arrayBuffer();
}

/**
 * Parse + convert an STL ArrayBuffer to a true-scale, Y-up BufferGeometry.
 * mm -> ft (1/304.8), OpenSCAD Z-up -> three Y-up, optional recentring so the
 * caller can place the part at a point.
 */
export function toStudioGeometry(arrayBuffer, opts = {}) {
  const center = opts.center !== false; // default true
  const geo = new STLLoader().parse(arrayBuffer);
  geo.rotateX(-Math.PI / 2); // Z-up (OpenSCAD) -> Y-up (three)
  const s = 1 / MM_PER_FT; // TRUE SCALE: mm -> ft, no normalize-to-target
  geo.scale(s, s, s);
  geo.computeBoundingBox();
  if (center) {
    const c = geo.boundingBox.getCenter(new Vector3());
    geo.translate(-c.x, -c.y, -c.z);
    geo.computeBoundingBox();
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Create a part-mesh loader.
 *
 * @param {{
 *   fetchManifest?: () => Promise<object>,   // GET /api/parts shape
 *   loadStlBuffer?: (file:string) => Promise<ArrayBuffer>,
 *   cacheSize?: number,
 * }} [opts]  Injectable for tests / smoke (offline, no server needed).
 *
 * loader.load(kindOrKey, {center?}) ->
 *   Promise<{ geometry: BufferGeometry|null, provenance: {...} }>
 *   geometry === null  => caller KEEPS its primitive (graceful fallback) and
 *   surfaces provenance.note in the Inspector.
 */
export function createPartMeshLoader(opts = {}) {
  const fetchManifest =
    typeof opts.fetchManifest === 'function' ? opts.fetchManifest : defaultFetchManifest;
  const loadStlBuffer =
    typeof opts.loadStlBuffer === 'function' ? opts.loadStlBuffer : defaultLoadStlBuffer;
  const cache = new GeometryLru(Number.isFinite(opts.cacheSize) ? opts.cacheSize : 24);

  let manifestPromise = null;
  const inflight = new Map(); // cacheKey -> Promise (dedupe concurrent loads)

  async function manifest() {
    if (!manifestPromise) {
      manifestPromise = fetchManifest().catch((err) => {
        manifestPromise = null; // allow retry after a failed fetch
        throw err;
      });
    }
    return manifestPromise;
  }

  async function loadUncached(requestedKey, key, cacheOpts) {
    let entry = null;
    try {
      const m = await manifest();
      entry = (m && Array.isArray(m.components) ? m.components : []).find(
        (c) => c && c.key === key && c.present === true && c.file && c.format === 'stl',
      ) || null;
    } catch {
      entry = null; // manifest unavailable -> primitive fallback, never throw to render path
    }
    if (!entry) return { geometry: null, provenance: provenanceFor(requestedKey, key, null, 'primitive') };
    try {
      const buf = await loadStlBuffer(entry.file);
      const geometry = toStudioGeometry(buf, cacheOpts);
      return { geometry, provenance: provenanceFor(requestedKey, key, entry, 'mesh') };
    } catch {
      // Fetch/parse failure -> graceful primitive fallback (no fabricated mesh).
      return { geometry: null, provenance: provenanceFor(requestedKey, key, null, 'primitive') };
    }
  }

  return {
    /** Resolve + load the real mesh for a part kind/key (LRU-cached, deduped). */
    async load(kindOrKey, loadOpts = {}) {
      const key = resolvePartKey(kindOrKey);
      if (!key) {
        return { geometry: null, provenance: provenanceFor(kindOrKey, null, null, 'primitive') };
      }
      const center = loadOpts.center !== false;
      const cacheKey = `${key}|center:${center}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;
      if (inflight.has(cacheKey)) return inflight.get(cacheKey);
      const p = loadUncached(kindOrKey, key, { center }).then((result) => {
        inflight.delete(cacheKey);
        if (result.geometry) cache.set(cacheKey, result); // only cache real meshes
        return result;
      });
      inflight.set(cacheKey, p);
      return p;
    },
    /** Expose alias resolution for callers that label primitives. */
    resolvePartKey,
  };
}

/** Shared default loader for the Studio page (uses /api/parts + static /parts). */
export const partMeshes = createPartMeshLoader();
