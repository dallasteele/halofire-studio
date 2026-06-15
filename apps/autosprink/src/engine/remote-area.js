// ── REMOTE-AREA boundary tool + design demand (NFPA-13 density/area method) ──
//
// The "remote area" (a.k.a. hydraulically most-demanding area) is the patch of
// ceiling the sprinkler system must protect simultaneously for the design fire.
// NFPA-13 §19 (density/area method) sizes it: for a hazard you pick a DESIGN
// DENSITY (gpm per square foot) and a DESIGN AREA of operation (sq ft). The heads
// whose coverage falls in that area must each discharge at least
//     q_min = density (gpm/ft^2) * coverage_area_per_head (ft^2)
// and the whole set is the hydraulic DEMAND the supply must satisfy at the most-
// remote head's required pressure.
//
// This module provides the *interactive* piece: the user DRAWS a boundary
// (polygon or rectangle, in plan x/y feet — the same coordinate frame heads use),
// we identify which heads fall INSIDE it (point-in-polygon), compute the drawn
// area (shoelace), look up the hazard's density, and produce:
//   - areaSqFt          the drawn boundary area
//   - flowingHeads      the heads inside (the design set)
//   - densityGpmFt2     the NFPA-13 design density for the hazard
//   - perHeadAreaFt2    coverage area apportioned to each flowing head
//   - requiredHeadFlowGpm  density * per-head coverage area (NFPA min per head)
//   - demandGpm         area-density demand (density * areaSqFt) — the area demand
//
// The flowingHeads predicate it returns plugs straight into network-solve's
// opts.flowingHeads so the H-W solve runs on JUST the remote-area subset (the
// real NFPA design basis) instead of the all-heads-open worst-case envelope.
//
// PURE + DETERMINISTIC. No DOM, no THREE, no camera. Numbers are validated
// against hand calcs in tests/remote-area.test.js.
//
// HONESTY: density/area values below are the public NFPA-13 design curves for
// the common hazard classes (non-storage, smooth ceiling). They are an
// ENGINEERING AID — the AHJ/PE selects the governing curve, hose allowance, and
// safety factor for the actual occupancy. NOT PE-stamped. Verify before permit.

import { getHazardRule } from './sprinkler-layout.js';
import { buildGraph } from './network-solve.js';

// ---------------------------------------------------------------------------
// NFPA-13 density/area design curves (gpm/ft^2 @ design area in ft^2).
// These are the conventional textbook design points for each hazard class used
// for a hand hydraulic calc. The density is the controlling number for demand;
// the design area is the default boundary size the user can snap the draw to.
// (Light hazard 0.10 @ 1500; Ordinary Group 1 0.15 @ 1500, Group 2 0.20 @ 1500;
//  Extra Group 1 0.30 @ 2500, Group 2 0.40 @ 2500.) Wet-pipe basis.
// ---------------------------------------------------------------------------
export const DENSITY_CURVES = Object.freeze({
  light: { label: 'Light Hazard', densityGpmFt2: 0.10, designAreaSqFt: 1500 },
  ordinary: { label: 'Ordinary Hazard (Gp 2)', densityGpmFt2: 0.20, designAreaSqFt: 1500 },
  'ordinary-1': { label: 'Ordinary Hazard Gp 1', densityGpmFt2: 0.15, designAreaSqFt: 1500 },
  'ordinary-2': { label: 'Ordinary Hazard Gp 2', densityGpmFt2: 0.20, designAreaSqFt: 1500 },
  extra: { label: 'Extra Hazard (Gp 2)', densityGpmFt2: 0.40, designAreaSqFt: 2500 },
  'extra-1': { label: 'Extra Hazard Gp 1', densityGpmFt2: 0.30, designAreaSqFt: 2500 },
  'extra-2': { label: 'Extra Hazard Gp 2', densityGpmFt2: 0.40, designAreaSqFt: 2500 },
});

const DEFAULT_HAZARD = 'ordinary';

/** Resolve the design density/area for a hazard key (fail-soft to ordinary). */
export function getDensityCurve(hazard) {
  const key = String(hazard || DEFAULT_HAZARD).toLowerCase();
  return DENSITY_CURVES[key] || DENSITY_CURVES[DEFAULT_HAZARD];
}

function round(n, p = 2) {
  const f = 10 ** p;
  return Math.round((n + Number.EPSILON) * f) / f;
}

// ---------------------------------------------------------------------------
// Geometry: shoelace area + point-in-polygon (ray cast), both in plan x/y.
// ---------------------------------------------------------------------------

/**
 * Signed-area magnitude of a simple polygon via the shoelace formula.
 * @param {Array<{x:number,y:number}|[number,number]>} poly closed-or-open ring
 * @returns {number} area in the polygon's units^2 (>= 0)
 */
export function polygonArea(poly) {
  const pts = normalizeRing(poly);
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * Point-in-polygon by ray casting (even-odd rule). Points exactly on an edge are
 * treated as inside (NFPA boundary is inclusive — a head on the line counts).
 * @param {{x:number,y:number}} pt
 * @param {Array} poly ring of {x,y} or [x,y]
 * @returns {boolean}
 */
export function pointInPolygon(pt, poly) {
  const pts = normalizeRing(poly);
  if (pts.length < 3) return false;
  const x = pt.x, y = pt.y;
  // on-edge test first (inclusive boundary)
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (onSegment(x, y, a.x, a.y, b.x, b.y)) return true;
  }
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    const intersect = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function onSegment(px, py, ax, ay, bx, by, tol = 1e-6) {
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (Math.abs(cross) > tol * Math.max(1, Math.hypot(bx - ax, by - ay))) return false;
  const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
  if (dot < -tol) return false;
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  if (dot - len2 > tol) return false;
  return true;
}

/** Accept [{x,y}|[x,y]] or rectangle {x0,y0,x1,y1}; return [{x,y}] ring. */
function normalizeRing(poly) {
  if (!poly) return [];
  if (!Array.isArray(poly) && poly.x0 != null && poly.x1 != null) {
    return rectRing(poly);
  }
  if (!Array.isArray(poly)) return [];
  return poly
    .map((p) => (Array.isArray(p) ? { x: Number(p[0]), y: Number(p[1]) } : { x: Number(p.x), y: Number(p.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** Rectangle {x0,y0,x1,y1} -> CCW ring of 4 corners. */
export function rectRing(rect) {
  const x0 = Math.min(Number(rect.x0), Number(rect.x1));
  const x1 = Math.max(Number(rect.x0), Number(rect.x1));
  const y0 = Math.min(Number(rect.y0), Number(rect.y1));
  const y1 = Math.max(Number(rect.y0), Number(rect.y1));
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

// ---------------------------------------------------------------------------
// Head extraction + per-head coverage area.
// ---------------------------------------------------------------------------

function headsOf(model) {
  const out = [];
  if (!model || !Array.isArray(model.solids)) return out;
  model.solids.forEach((s, i) => {
    if (!s || s.kind !== 'head' || !Array.isArray(s.position)) return;
    const x = Number(s.position[0]);
    const y = Number(s.position[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    out.push({ x, y, z: Number(s.position[2]) || 0, solid: s, hazard: s.hazard, _idx: i });
  });
  return out;
}

/**
 * Per-head coverage area (ft^2) used to apportion density -> per-head flow.
 * Preference order: explicit per-head s.coverageAreaSqFt, else the hazard max
 * area per head (NFPA spacing rule), else the design area / head count. We use
 * the hazard max-area-per-head as the conservative apportionment so each head's
 * required flow = density * that head's protected footprint.
 */
function perHeadCoverageFt2(head, model, fallbackHazard) {
  if (head.solid && Number(head.solid.coverageAreaSqFt) > 0) return Number(head.solid.coverageAreaSqFt);
  const hazardKey = head.hazard || (model && model.sizing && model.sizing.hazard) || fallbackHazard || DEFAULT_HAZARD;
  try { return getHazardRule(hazardKey).maxAreaSqFt; } catch (_) { return getHazardRule('ordinary').maxAreaSqFt; }
}

// ---------------------------------------------------------------------------
// The remote-area computation.
// ---------------------------------------------------------------------------

/**
 * Compute the remote-area design demand from a drawn boundary.
 *
 * @param {object} model    cadModel ({solids:[...], sizing?:{hazard}})
 * @param {Array|object} boundary  polygon ring [{x,y}|[x,y]] OR rect {x0,y0,x1,y1}
 * @param {object} [opts]
 *   @param {string} [opts.hazard]  hazard class override (else model.sizing.hazard)
 *   @param {number} [opts.densityGpmFt2]  density override (else hazard curve)
 * @returns {{
 *   areaSqFt:number, drawnAreaSqFt:number,
 *   flowingHeads:Array<{x,y,_idx,perHeadAreaFt2,requiredFlowGpm}>,
 *   flowingHeadCount:number, totalHeadCount:number,
 *   densityGpmFt2:number, hazard:string, hazardLabel:string,
 *   requiredHeadFlowGpm:number, demandGpm:number, areaDemandGpm:number,
 *   designAreaSqFt:number, boundaryKind:string, vertices:number,
 *   predicate:Function, disclaimer:string
 * }}
 */
export function computeRemoteArea(model, boundary, opts = {}) {
  const ring = normalizeRing(boundary);
  const isRect = !Array.isArray(boundary) && boundary && boundary.x0 != null;
  const drawnAreaSqFt = round(polygonArea(ring));

  const hazardKey = String(opts.hazard || (model && model.sizing && model.sizing.hazard) || DEFAULT_HAZARD).toLowerCase();
  const curve = getDensityCurve(hazardKey);
  const density = Number(opts.densityGpmFt2) > 0 ? Number(opts.densityGpmFt2) : curve.densityGpmFt2;

  const allHeads = headsOf(model);
  const insideIdx = new Set();
  const flowingHeads = [];
  let perHeadFlowSum = 0;
  for (const h of allHeads) {
    if (ring.length >= 3 && pointInPolygon({ x: h.x, y: h.y }, ring)) {
      insideIdx.add(h._idx);
      const areaFt2 = perHeadCoverageFt2(h, model, hazardKey);
      const reqFlow = round(density * areaFt2);
      perHeadFlowSum += reqFlow;
      flowingHeads.push({
        x: round(h.x), y: round(h.y), z: round(h.z), _idx: h._idx,
        perHeadAreaFt2: round(areaFt2), requiredFlowGpm: reqFlow,
      });
    }
  }

  // requiredHeadFlowGpm = the controlling per-head minimum (max apportioned head
  // flow inside the area — the one the most-remote head must at least deliver).
  const requiredHeadFlowGpm = flowingHeads.length
    ? round(Math.max(...flowingHeads.map((h) => h.requiredFlowGpm)))
    : 0;

  // areaDemandGpm = density * drawn area (the classic density/area demand floor).
  const areaDemandGpm = round(density * drawnAreaSqFt);
  // demandGpm = the discrete head demand (Σ per-head min flow) when heads exist
  // in the area; otherwise fall back to the continuous area-density demand. The
  // discrete sum is what actually flows through the pipe network.
  const demandGpm = flowingHeads.length ? round(perHeadFlowSum) : areaDemandGpm;

  // The predicate the H-W solver uses to flow ONLY the heads inside the boundary.
  const predicate = (solid, headObj) => {
    if (solid && insideIdx.has(modelIndexOf(model, solid))) return true;
    // also match by index attached to the graph head when available
    if (headObj && headObj.solid && insideIdx.has(modelIndexOf(model, headObj.solid))) return true;
    // geometric fallback: test the head's stored position against the ring
    const pos = (solid && solid.position) || (headObj && headObj.position);
    if (Array.isArray(pos) && ring.length >= 3) {
      return pointInPolygon({ x: Number(pos[0]), y: Number(pos[1]) }, ring);
    }
    return false;
  };

  return {
    // CHUNK contract fields
    areaSqFt: drawnAreaSqFt,
    flowingHeads,
    densityGpmFt2: round(density, 4),
    demandGpm,
    // richer real numbers
    drawnAreaSqFt,
    flowingHeadCount: flowingHeads.length,
    totalHeadCount: allHeads.length,
    requiredHeadFlowGpm,
    areaDemandGpm,
    perHeadFlowSumGpm: round(perHeadFlowSum),
    hazard: hazardKey,
    hazardLabel: curve.label,
    designAreaSqFt: curve.designAreaSqFt,
    boundaryKind: isRect ? 'rectangle' : 'polygon',
    vertices: ring.length,
    // true when this area was auto-selected (most-remote, NFPA-13 default) rather
    // than drawn by the user — surfaced in the UI/report as "auto-remote".
    autoSelected: opts.autoSelected === true,
    predicate,
    disclaimer: 'ENGINEERING AID — NFPA-13 density/area design demand, NOT AHJ/PE-stamped. AHJ/PE selects the governing curve, hose allowance, and safety factor. Verify before permit.',
  };
}

/** Resolve the solids index of a head solid (identity match). */
function modelIndexOf(model, solid) {
  if (!model || !Array.isArray(model.solids)) return -1;
  return model.solids.indexOf(solid);
}

/**
 * Convenience: compute the remote area AND run the network H-W solve on JUST the
 * flowing-head subset, returning both. The caller passes a solveFn (so this pure
 * module never imports the solver and stays dependency-light); typically
 * solveFn = (model, opts) => solveNetwork(model, opts).
 *
 * @returns {{ remoteArea:object, solve:object }}
 */
export function solveRemoteArea(model, boundary, solveFn, opts = {}) {
  const remoteArea = computeRemoteArea(model, boundary, opts);
  const solveOpts = {
    ...opts,
    flowingHeads: remoteArea.predicate,
  };
  const solve = typeof solveFn === 'function' ? solveFn(model, solveOpts) : null;
  return { remoteArea, solve };
}

// ---------------------------------------------------------------------------
// AUTO remote-area selection — the NFPA-13 most-hydraulically-remote design area
// when the user has NOT drawn a boundary. This is what makes the DEFAULT solve
// basis the code design demand instead of the all-heads-open worst-case envelope.
//
// NFPA-13 §19/§23: the design area is a CONTIGUOUS rectangle of the hazard's
// design area (e.g. 1500 ft² ordinary, 2500 ft² extra) located over the
// hydraulically MOST-REMOTE heads — the heads with the greatest path resistance
// (greatest pipe-length distance) from the supply. AutoSPRINK & hand calcs both
// build a roughly rectangular contiguous block (typically ~1.2× the branch-line
// spacing on the long axis) at the far end of the most-remote branch lines.
//
// Strategy (pure, deterministic, label-independent):
//   1. Build the real pipe graph and BFS from the supply to get each head's
//      tree-distance (= path resistance) from the source.
//   2. Pick the single most-remote head as the SEED (greatest distance).
//   3. Grow a CONTIGUOUS axis-aligned rectangle of the hazard design area
//      around the seed, biased toward the far (high-distance) side, capturing a
//      compact block of the most-remote heads. The rectangle dimensions follow
//      NFPA practice: long axis = 1.2·√(designArea) along the branch-line run.
//   4. Return the boundary rect + autoSelected:true so computeRemoteArea() can
//      derive the per-head design flow on exactly that contiguous subset.
//
// HONESTY: this is an automatic, geometry-derived selection of the remote area
// for a DEFAULT realistic design point — an ENGINEERING AID, NOT a PE/AHJ
// determination of the governing area. The user can always draw an explicit
// boundary (which overrides this) or toggle all-heads-open worst-case.
// ---------------------------------------------------------------------------

/** Head tree-distance (path resistance) from the supply over the real graph. */
export function headDistancesFromSupply(model) {
  const graph = buildGraph(model, {});
  const { nodes, edges } = graph;
  // find supply node = lowest-Z node with highest edge degree (mirrors solver)
  let minZ = Infinity;
  for (const n of nodes.values()) minZ = Math.min(minZ, n.z);
  let source = null;
  for (const n of nodes.values()) {
    if (Math.abs(n.z - minZ) <= 0.05) {
      if (!source || n.edges.length > source.edges.length) source = n;
    }
  }
  const dist = new Map();
  if (source) {
    dist.set(source.key, 0);
    const queue = [source.key];
    const visited = new Set([source.key]);
    while (queue.length) {
      const nk = queue.shift();
      const node = nodes.get(nk);
      for (const ei of node.edges) {
        const e = edges[ei];
        const other = e.a === nk ? e.b : e.a;
        if (other === nk || visited.has(other)) continue;
        visited.add(other);
        dist.set(other, (dist.get(nk) || 0) + e.length);
        queue.push(other);
      }
    }
  }
  // attach distance to each head (by its node coincidence)
  const q = 0.05;
  const keyOf = (p) => `${Math.round(p[0] / q)}|${Math.round(p[1] / q)}|${Math.round(p[2] / q)}`;
  const heads = [];
  (Array.isArray(model && model.solids) ? model.solids : []).forEach((s, i) => {
    if (!s || s.kind !== 'head' || !Array.isArray(s.position)) return;
    const x = Number(s.position[0]); const y = Number(s.position[1]); const z = Number(s.position[2]) || 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const d = dist.get(keyOf([x, y, z]));
    heads.push({ x, y, z, _idx: i, distFt: Number.isFinite(d) ? d : null });
  });
  return { heads, hasSource: !!source };
}

/**
 * Auto-select the NFPA-13 most-remote design-area boundary (a contiguous rect).
 *
 * @param {object} model cadModel
 * @param {object} [opts]
 *   @param {string} [opts.hazard]  hazard class (else model.sizing.hazard)
 *   @param {number} [opts.designAreaSqFt]  override the hazard design area
 * @returns {{ boundary:{x0,y0,x1,y1}|null, autoSelected:boolean,
 *   seed:object|null, designAreaSqFt:number, hazard:string,
 *   flowingHeadCount:number, reason:string }}
 */
export function autoRemoteArea(model, opts = {}) {
  const hazardKey = String(opts.hazard || (model && model.sizing && model.sizing.hazard) || DEFAULT_HAZARD).toLowerCase();
  const curve = getDensityCurve(hazardKey);
  const designAreaSqFt = Number(opts.designAreaSqFt) > 0 ? Number(opts.designAreaSqFt) : curve.designAreaSqFt;

  const { heads, hasSource } = headDistancesFromSupply(model);
  if (!heads.length) {
    return { boundary: null, autoSelected: false, seed: null, designAreaSqFt, hazard: hazardKey, flowingHeadCount: 0, reason: 'no heads in model' };
  }

  // SEED = the most-remote head (greatest path resistance). Fall back to the head
  // farthest from the head-cloud centroid if the graph has no source (degenerate).
  let seed = null;
  const haveDist = heads.some((h) => h.distFt != null);
  if (haveDist) {
    for (const h of heads) {
      if (h.distFt == null) continue;
      if (!seed || h.distFt > seed.distFt) seed = h;
    }
  } else {
    const cx = heads.reduce((a, h) => a + h.x, 0) / heads.length;
    const cy = heads.reduce((a, h) => a + h.y, 0) / heads.length;
    for (const h of heads) {
      const d = Math.hypot(h.x - cx, h.y - cy);
      if (!seed || d > (seed._fallbackD || -1)) { seed = h; seed._fallbackD = d; }
    }
  }

  // Rectangle dimensions: NFPA practice puts the long axis (1.2·√area) along the
  // branch-line direction. We don't always know branch orientation, so size a
  // rectangle with the conventional 1.2 long / (area/long) short aspect and
  // align the long axis to the model's wider head-extent axis (the run direction).
  const longSide = 1.2 * Math.sqrt(designAreaSqFt);
  const shortSide = designAreaSqFt / longSide;
  const xs = heads.map((h) => h.x); const ys = heads.map((h) => h.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  // long axis follows the wider span (branch lines usually run the long way)
  const longIsX = spanX >= spanY;
  const halfLong = longSide / 2;
  const halfShort = shortSide / 2;
  const w = longIsX ? halfLong : halfShort;   // half-width  (x)
  const h2 = longIsX ? halfShort : halfLong;  // half-height (y)

  // Center the box on the most-remote CONTIGUOUS block: start at the seed, then
  // shift the center toward the mean of the design-area's worth of nearest
  // most-remote heads so the box sits on a real cluster (contiguous), not half
  // off the edge of the plan. Take the N nearest heads to the seed where N ≈
  // designArea / per-head footprint, and center on their centroid (clamped so the
  // seed stays inside the box — the most-remote head MUST be in the design area).
  let perHeadFt2 = 130;
  try { perHeadFt2 = getHazardRule(hazardKey).maxAreaSqFt; } catch (_) { /* default */ }
  const targetCount = Math.max(1, Math.round(designAreaSqFt / perHeadFt2));
  const near = heads
    .map((hd) => ({ hd, d: Math.hypot(hd.x - seed.x, hd.y - seed.y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, targetCount)
    .map((o) => o.hd);
  let ccx = near.reduce((a, hd) => a + hd.x, 0) / near.length;
  let ccy = near.reduce((a, hd) => a + hd.y, 0) / near.length;
  // clamp center so the seed (most-remote head) remains inside the rectangle
  ccx = Math.min(seed.x + w, Math.max(seed.x - w, ccx));
  ccy = Math.min(seed.y + h2, Math.max(seed.y - h2, ccy));

  const boundary = { x0: ccx - w, y0: ccy - h2, x1: ccx + w, y1: ccy + h2 };

  // count heads inside (so the caller can confirm a real contiguous block landed)
  const ring = rectRing(boundary);
  let inside = 0;
  for (const hd of heads) { if (pointInPolygon({ x: hd.x, y: hd.y }, ring)) inside += 1; }

  return {
    boundary,
    autoSelected: true,
    seed: { x: round(seed.x), y: round(seed.y), z: round(seed.z), _idx: seed._idx, distFt: seed.distFt != null ? round(seed.distFt) : null },
    designAreaSqFt,
    hazard: hazardKey,
    hazardLabel: curve.label,
    densityGpmFt2: curve.densityGpmFt2,
    flowingHeadCount: inside,
    longSideFt: round(longSide),
    shortSideFt: round(shortSide),
    basedOnPathResistance: haveDist,
    reason: haveDist
      ? 'most-remote head by supply path-resistance; contiguous hazard design-area rectangle'
      : 'no graph source — fell back to farthest-from-centroid seed',
  };
}
