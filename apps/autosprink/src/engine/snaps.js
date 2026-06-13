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

export const SNAP_TYPES = ['grid', 'endpoint', 'midpoint', 'intersection', 'perpendicular'];

// Priority when several candidates tie within tolerance — geometric snaps beat
// the grid (a user reaching for an endpoint shouldn't get pulled to a grid dot).
const PRIORITY = { endpoint: 5, intersection: 4, midpoint: 3, perpendicular: 2, grid: 1 };

export function defaultSnapState() {
  return { grid: true, endpoint: true, midpoint: true, intersection: true, perpendicular: false, gridSize: 1, tolFt: 1.5 };
}

// Collect candidate snap points from the model's plan-space line segments.
// segments: [{ a:[x,y], b:[x,y] }]. Derived from cadModel pipes (from/to) by the caller.
export function snapCandidates(point, segments, state) {
  const cands = [];
  const enabled = state || defaultSnapState();
  const segs = segments || [];

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
      if (foot) cands.push({ type: 'perpendicular', p: foot });
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
export function snap(point, segments, state) {
  const enabled = state || defaultSnapState();
  const tol = enabled.tolFt > 0 ? enabled.tolFt : 1.5;
  const cands = snapCandidates(point, segments, enabled);
  let best = null, bestScore = Infinity;
  for (const c of cands) {
    const d = dist(point, c.p);
    if (d > tol) continue;
    // score: distance, tie-broken by snap priority (lower score wins).
    const score = d - PRIORITY[c.type] * 1e-4;
    if (score < bestScore) { bestScore = score; best = { p: c.p.slice(), type: c.type, dist: d }; }
  }
  if (best) return { p: best.p, type: best.type, snapped: true, dist: best.dist };
  return { p: point.slice(), type: null, snapped: false, dist: 0 };
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

// ── pure geometry ──
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

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
// drawing vector to the nearest 90° axis from a start point.
export function orthoConstrain(start, point) {
  const dx = point[0] - start[0], dy = point[1] - start[1];
  if (Math.abs(dx) >= Math.abs(dy)) return [point[0], start[1]];
  return [start[0], point[1]];
}
