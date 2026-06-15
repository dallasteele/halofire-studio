// HF-W1-SNAP — pure snap engine for the live Studio (drawing + move).
//
// Operates entirely in PLAN coordinates ([x,y] feet; the Studio's true 1u=1ft).
// No THREE, no DOM — the caller converts a viewport pointer to a plan point,
// asks snap() for the best snapped point + a descriptor, and renders the
// indicator. This mirrors AutoSprink's Snaps menu (grid, endpoint, midpoint,
// intersection, perpendicular) at flag-don't-gate fidelity (needs-verification).
//
// Snap types map to the AutoSprink Snaps menu ids the menubar exposes:
//   grid          -> snaps.rounding / snaps.visible-grid
//   endpoint      -> snaps.end-points
//   midpoint      -> snaps.center-point (segment midpoints)
//   intersection  -> snaps.intersections
//   perpendicular -> snaps.perpendicular

// Full AutoSPRINK-style O-snap suite. `node` = head/fitting CENTER snap (NODE/CENTER
// glyph); `extension` = snap ALONG a run's direction past its endpoint (the dashed
// extension line in AutoSPRINK). endpoint/midpoint/intersection/perpendicular as before.
export const SNAP_TYPES = ['grid', 'endpoint', 'midpoint', 'intersection', 'perpendicular', 'node', 'extension'];

// Priority when several candidates tie within tolerance — geometric snaps beat
// the grid (a user reaching for an endpoint shouldn't get pulled to a grid dot).
// node (head/fitting center) ranks with endpoint; extension is a tracking aid so
// it ranks below the hard geometric snaps but above grid.
const PRIORITY = { endpoint: 6, node: 6, intersection: 5, midpoint: 4, perpendicular: 3, extension: 2, grid: 0 };

export function defaultSnapState() {
  return { grid: true, endpoint: true, midpoint: true, intersection: true, perpendicular: true, node: true, extension: true, gridSize: 1, tolFt: 1.5 };
}

// Collect candidate snap points from the model's plan-space line segments + nodes.
// segments: [{ a:[x,y], b:[x,y] }] from pipes/walls.
// nodes:    [{ p:[x,y] }]          head/fitting centers (NODE/CENTER snap).
export function snapCandidates(point, segments, state, nodes) {
  const cands = [];
  const enabled = state || defaultSnapState();
  const segs = Array.isArray(segments) ? segments : [];
  const nds = Array.isArray(nodes) ? nodes : [];

  if (enabled.endpoint) {
    for (const s of segs) {
      cands.push({ type: 'endpoint', p: s.a });
      cands.push({ type: 'endpoint', p: s.b });
    }
  }
  if (enabled.midpoint) {
    for (const s of segs) cands.push({ type: 'midpoint', p: [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2] });
  }
  if (enabled.intersection) {
    for (let i = 0; i < segs.length; i += 1) {
      for (let j = i + 1; j < segs.length; j += 1) {
        const x = segIntersect(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
        if (x) cands.push({ type: 'intersection', p: x });
      }
    }
  }
  if (enabled.perpendicular) {
    for (const s of segs) {
      const foot = perpFoot(point, s.a, s.b);
      // Skip a perpendicular foot that lands on an endpoint or the midpoint of
      // the same segment — those are stronger, named snaps and should own the
      // point (else perp silently shadows endpoint/midpoint near segment ends).
      if (!foot) continue;
      const mid = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
      if (dist(foot, s.a) < 0.05 || dist(foot, s.b) < 0.05 || dist(foot, mid) < 0.05) continue;
      cands.push({ type: 'perpendicular', p: foot });
    }
  }
  if (enabled.node) {
    for (const n of nds) if (Array.isArray(n.p)) cands.push({ type: 'node', p: [n.p[0], n.p[1]], label: n.label });
  }
  if (enabled.extension) {
    // Project the cursor onto the INFINITE line of each run; if that projection
    // falls BEYOND a segment endpoint (i.e. on the extension ray) and the cursor
    // is close to the line, offer it as an extension snap anchored at that
    // endpoint's direction. Carries the originating endpoint so the caller can
    // draw the dashed tracking line back to it.
    for (const s of segs) {
      const ext = extensionPoint(point, s.a, s.b);
      if (ext) cands.push({ type: 'extension', p: ext.p, from: ext.from });
    }
  }
  if (enabled.grid) {
    const g = enabled.gridSize > 0 ? enabled.gridSize : 1;
    cands.push({ type: 'grid', p: [Math.round(point[0] / g) * g, Math.round(point[1] / g) * g] });
  }
  return cands;
}

/**
 * Snap a raw plan point to the best candidate within tolerance.
 * @returns { p:[x,y], type, snapped:boolean } — always returns a point (raw when
 *          nothing is in tolerance), so callers can use the result directly.
 */
export function snap(point, segments, state, nodes) {
  const enabled = state || defaultSnapState();
  const tol = enabled.tolFt > 0 ? enabled.tolFt : 1.5;
  const cands = snapCandidates(point, segments, enabled, nodes);
  let best = null, bestScore = Infinity;
  for (const c of cands) {
    const d = dist(point, c.p);
    if (d > tol) continue;
    // Score = distance MINUS a priority bias, so a higher-priority snap (e.g. an
    // endpoint) within reach beats a marginally-closer low-priority snap (a
    // perpendicular/extension foot, which exists for almost any cursor near a
    // line). The bias is in FEET (0.30 ft per priority rank) — enough that a
    // named point a few inches away wins over a perp foot directly under the
    // cursor, matching AutoSPRINK's "endpoint/mid/intersection own the point".
    const score = d - PRIORITY[c.type] * 0.30;
    if (score < bestScore) { bestScore = score; best = { p: c.p.slice(), type: c.type, dist: d, from: c.from || null, label: c.label || null }; }
  }
  if (best) return { p: best.p, type: best.type, snapped: true, dist: best.dist, from: best.from, label: best.label };
  return { p: point.slice(), type: null, snapped: false, dist: 0, from: null, label: null };
}

// Build plan-space segments from a cadModel (pipes -> [from.xy, to.xy], walls -> [a,b]).
export function segmentsFromModel(model) {
  const segs = [];
  if (!model || !Array.isArray(model.solids)) return segs;
  for (const s of model.solids) {
    if (s.kind === 'pipe' && Array.isArray(s.from) && Array.isArray(s.to)) {
      segs.push({ a: [s.from[0], s.from[1]], b: [s.to[0], s.to[1]] });
    } else if (s.kind === 'wall' && Array.isArray(s.a) && Array.isArray(s.b)) {
      segs.push({ a: s.a.slice(0, 2), b: s.b.slice(0, 2) });
    }
  }
  return segs;
}

// Build plan-space NODE candidates (head + fitting/component CENTERS) from a
// cadModel. These are the AutoSPRINK "node"/"center" snap targets — the precise
// center of a placed sprinkler head or fitting.
export function nodesFromModel(model) {
  const nodes = [];
  if (!model || !Array.isArray(model.solids)) return nodes;
  for (const s of model.solids) {
    if ((s.kind === 'head' || s.kind === 'component' || s.kind === 'fitting' || s.kind === 'riser' || s.kind === 'valve' || s.kind === 'device') && Array.isArray(s.position)) {
      nodes.push({ p: [s.position[0], s.position[1]], label: s.kind });
    } else if (s.kind === 'head' && Array.isArray(s.center)) {
      nodes.push({ p: [s.center[0], s.center[1]], label: 'head' });
    }
  }
  return nodes;
}

// ── pure geometry ──
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

// EXTENSION snap: project `p` onto the INFINITE line through a..b. If the
// projection parameter t is OUTSIDE [0,1] (beyond an endpoint) — i.e. the cursor
// is on the extension ray of the run — and the perpendicular offset from that
// line is within a band, return the on-line projected point plus the endpoint
// the extension grows from. Returns null when the cursor projects onto the body
// of the segment (that's perpendicular/endpoint territory, not extension).
const EXT_BAND_FT = 1.2; // how far off the extended line still counts as "tracking it"
const EXT_MIN_PAST_FT = 0.05; // must be at least this far PAST an endpoint to be an extension
function extensionPoint(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-9) return null;
  const len = Math.sqrt(len2);
  const t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
  // Distance (ft) the projection sits PAST whichever endpoint, in segment units.
  const pastFt = t < 0 ? -t * len : (t - 1) * len;
  if (pastFt < EXT_MIN_PAST_FT) return null; // on the segment body — not an extension
  const fx = a[0] + t * abx, fy = a[1] + t * aby;
  const off = Math.hypot(p[0] - fx, p[1] - fy);
  if (off > EXT_BAND_FT) return null;
  const from = t < 0 ? a : b; // the endpoint the extension line emanates from
  return { p: [fx, fy], from: [from[0], from[1]] };
}

function perpFoot(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-9) return null;
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
  t = Math.max(0, Math.min(1, t)); // clamp to the segment
  return [a[0] + t * abx, a[1] + t * aby];
}

function segIntersect(p1, p2, p3, p4) {
  const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null; // parallel/collinear
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null; // intersection outside both segments
  return [p1[0] + t * d1x, p1[1] + t * d1y];
}

// Orthographic constraint (AutoSprink Orthographic snap, Shift toggles): lock a
// drawing vector to the nearest 90° axis from a start point. Clean H/V: keeps the
// dominant-axis component, zeroes the other (so a near-horizontal drag lands on a
// perfectly horizontal run at the cursor's X, and vice-versa).
export function orthoConstrain(start, point) {
  const dx = point[0] - start[0], dy = point[1] - start[1];
  if (Math.abs(dx) >= Math.abs(dy)) return [point[0], start[1]];
  return [start[0], point[1]];
}

// POLAR tracking constraint (AutoSPRINK Polar Tracking). Lock the drawing vector
// to the nearest multiple of `incDeg` (e.g. 15/22.5/30/45/90), measured CCW from
// +X. The cursor's full distance from `start` is PRESERVED — the point is the
// projection of (point-start) onto the chosen ray, so the run length equals how
// far the cursor reached, exactly like AutoSPRINK. Returns:
//   { p:[x,y], angleDeg, snappedAngleDeg, deltaDeg, lengthFt, onAxis }
// `onAxis` is true when the raw cursor direction is within `bandDeg` of an
// increment — the caller shows the tracking line + angle readout only then,
// matching AutoSPRINK (the polar vector "engages" near an increment, and the
// cursor otherwise follows freely). When `onAxis` is false the raw point is
// returned unchanged so polar never fights a deliberately off-axis drag.
export function polarConstrain(start, point, incDeg, bandDeg) {
  const inc = incDeg > 0 ? incDeg : 90;
  const band = bandDeg > 0 ? bandDeg : inc / 2; // default: full coverage (always engage)
  const dx = point[0] - start[0], dy = point[1] - start[1];
  const len = Math.hypot(dx, dy);
  const rawDeg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  if (len < 1e-6) {
    return { p: [start[0], start[1]], angleDeg: 0, snappedAngleDeg: 0, deltaDeg: 0, lengthFt: 0, onAxis: false };
  }
  const snappedDeg = (Math.round(rawDeg / inc) * inc) % 360;
  // Smallest absolute angular difference (359° vs 1° = 2°, not 358°).
  let delta = Math.abs(rawDeg - snappedDeg);
  if (delta > 180) delta = 360 - delta;
  const onAxis = delta <= band;
  if (!onAxis) {
    return { p: [point[0], point[1]], angleDeg: rawDeg, snappedAngleDeg: snappedDeg, deltaDeg: delta, lengthFt: len, onAxis: false };
  }
  const a = snappedDeg * Math.PI / 180;
  // Project the cursor vector onto the chosen ray so length tracks the cursor.
  const proj = dx * Math.cos(a) + dy * Math.sin(a);
  const L = proj; // signed; for increments < 180 this is the on-axis reach
  return {
    p: [start[0] + Math.cos(a) * L, start[1] + Math.sin(a) * L],
    angleDeg: rawDeg, snappedAngleDeg: snappedDeg, deltaDeg: delta,
    lengthFt: Math.abs(L), onAxis: true,
  };
}
