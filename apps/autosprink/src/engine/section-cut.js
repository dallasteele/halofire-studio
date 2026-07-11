/**
 * HaloFire SECTION / ELEVATION cut (Phase 4, chunk 2).
 *
 * Given a CAD model (the `solids` array AutoSprink-clone uses: heads with
 * `position:[x,y,z]`, pipes with `from/to:[x,y,z]`, walls with `a/b:[x,y]` +
 * `baseZ`/`heightFt`, columns with `x/y/sizeFt` + `baseZ`/`heightFt`) and a cut
 * PLANE defined by two plan points the user picks on the floor, produce a 2D
 * SECTION/ELEVATION view: everything within a thickness band of the plane is
 * projected onto it, showing TRUE elevations (the vertical axis is real Z/height
 * in feet).
 *
 * Coordinate convention (matches cad-model.js): X/Y are PLAN feet, Z is elevation
 * (0 = floor). Pipes/heads carry Z directly; walls/columns extrude from `baseZ`
 * up by `heightFt`.
 *
 * The section view is a pure 2D entity list in SECTION coordinates:
 *   u = signed distance ALONG the cut line from point A (feet, +toward B)
 *   v = elevation Z (feet, up positive)
 * Each entity is one of:
 *   { type:'line',  kind, role?, a:[u,v], b:[u,v], diameterIn?, name }
 *   { type:'rect',  kind, u0,u1,v0,v1, name }          // wall/column in section (cut or beyond)
 *   { type:'head',  kind:'head', u, v, orientation, name }
 *   { type:'datum', v, label }                          // floor/ceiling elevation guide line
 *
 * Cut vs. beyond: an entity that the plane passes THROUGH (within ~half its own
 * thickness of the plane) is `cut:true` (drawn bold/solid); an entity merely
 * inside the view band but not on the plane is `cut:false` (drawn light, it is
 * "beyond" / background). This is standard section drafting.
 *
 * PURE + deterministic + browser-free. No THREE, no DOM. Unit-tested.
 *
 * HONESTY: this is an engineering aid. The generated elevation is a geometric
 * projection of the reconstructed model — it is NOT a PE-stamped / AHJ section
 * detail. Label it accordingly in any deliverable.
 */

export const SECTION_DISCLAIMER =
  'Engineering aid — generated section/elevation is a geometric projection of the '
  + 'model, NOT an AHJ/PE-stamped detail. Verify before submittal.';

const EPS = 1e-9;

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

/**
 * Build the cut-plane frame from two plan points A,B (each [x,y] in feet).
 * Returns the line origin, the unit ALONG direction (dir), the unit NORMAL
 * (left of dir), and the plan length. Throws-free: returns null if A==B.
 */
export function planeFromPoints(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const ax = Number(a[0]), ay = Number(a[1]), bx = Number(b[0]), by = Number(b[1]);
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (!(len > EPS)) return null;
  const dir = [dx / len, dy / len];     // along the cut line
  const normal = [-dir[1], dir[0]];     // left normal (perpendicular, in plan)
  return { a: [ax, ay], b: [bx, by], dir, normal, lengthFt: len };
}

/** Project a plan point [x,y] into section coords: u = along, s = signed offset from plane. */
function projectPlan(plane, x, y) {
  const dx = x - plane.a[0], dy = y - plane.a[1];
  const u = dx * plane.dir[0] + dy * plane.dir[1];        // distance along the line
  const s = dx * plane.normal[0] + dy * plane.normal[1];  // signed perpendicular offset (depth)
  return { u, s };
}

/** Closest signed-offset of a plan SEGMENT (a->b) to the plane, plus its u-extent. */
function segmentToSection(plane, a, b) {
  const pa = projectPlan(plane, a[0], a[1]);
  const pb = projectPlan(plane, b[0], b[1]);
  return { ua: pa.u, sa: pa.s, ub: pb.u, sb: pb.s };
}

/** Does a value v fall inside [lo,hi] (inclusive, order-agnostic)? */
function inSpan(v, lo, hi) {
  const a = Math.min(lo, hi), b = Math.max(lo, hi);
  return v >= a - EPS && v <= b + EPS;
}

/**
 * Generate a section/elevation from a CAD model + a cut plane.
 *
 * @param {{solids:Array}} cadModel  the live model (currentCadModel)
 * @param {[number,number]} aPlan    plan point A [xFt,yFt]
 * @param {[number,number]} bPlan    plan point B [xFt,yFt]
 * @param {object} [opts]
 *   @param {number} [opts.bandFt=8]   half-thickness of the view band (depth shown behind/in front)
 *   @param {number} [opts.cutTolFt]   how close (perp) an entity must be to count as "cut" (default = wall/col half-thickness, fallback 0.5)
 *   @param {'A->B'|'A<-B'} [opts.look='A->B']  viewing direction (affects which side is "front")
 *   @param {string} [opts.label]      a human label for the section (e.g. 'Section A-A')
 * @returns {{ ok, plane, kind:'section', entities:[...], bounds:{u0,u1,v0,v1}, counts, label, disclaimer, bandFt }}
 */
export function generateSection(cadModel, aPlan, bPlan, opts = {}) {
  const plane = planeFromPoints(aPlan, bPlan);
  if (!plane) {
    return { ok: false, reason: 'invalid cut line (A and B coincide or are non-finite)', kind: 'section', entities: [], counts: {} };
  }
  const solids = (cadModel && Array.isArray(cadModel.solids)) ? cadModel.solids : [];
  const bandFt = Number.isFinite(opts.bandFt) ? Math.abs(opts.bandFt) : 8;
  const baseCutTol = Number.isFinite(opts.cutTolFt) ? Math.abs(opts.cutTolFt) : null;
  const label = opts.label || 'Section';

  const entities = [];
  let vMin = Infinity, vMax = -Infinity, uMin = Infinity, uMax = -Infinity;
  const counts = { walls: 0, columns: 0, pipes: 0, heads: 0, beyond: 0, cut: 0 };

  const noteV = (v) => { if (v < vMin) vMin = v; if (v > vMax) vMax = v; };
  const noteU = (u) => { if (u < uMin) uMin = u; if (u > uMax) uMax = u; };

  for (const s of solids) {
    if (!s || !s.kind) continue;
    if (s.kind === 'wall') {
      addWall(s, plane, bandFt, baseCutTol, entities, counts, noteU, noteV);
    } else if (s.kind === 'column') {
      addColumn(s, plane, bandFt, baseCutTol, entities, counts, noteU, noteV);
    } else if (s.kind === 'pipe') {
      addPipe(s, plane, bandFt, entities, counts, noteU, noteV);
    } else if (s.kind === 'head') {
      addHead(s, plane, bandFt, entities, counts, noteU, noteV);
    }
  }

  // Floor (v=0) + ceiling datum lines spanning the section width, when we have content.
  if (entities.length) {
    const u0 = uMin, u1 = uMax;
    entities.push({ type: 'datum', v: 0, label: 'FLR 0\'', a: [u0, 0], b: [u1, 0] });
    noteV(0);
    // Ceiling datum = tallest wall/column top if present.
    const tops = solids
      .filter((s) => (s.kind === 'wall' || s.kind === 'column') && Number.isFinite(s.heightFt))
      .map((s) => (Number(s.baseZ) || 0) + Number(s.heightFt));
    if (tops.length) {
      const ceil = round(Math.max(...tops));
      entities.push({ type: 'datum', v: ceil, label: 'CLG ' + ceil + "'", a: [u0, ceil], b: [u1, ceil] });
      noteV(ceil);
    }
  }

  if (uMin === Infinity) { uMin = 0; uMax = round(plane.lengthFt); }
  if (vMin === Infinity) { vMin = 0; vMax = 10; }

  return {
    ok: true,
    kind: 'section',
    label,
    plane: {
      a: [round(plane.a[0]), round(plane.a[1])],
      b: [round(plane.b[0]), round(plane.b[1])],
      dir: [round(plane.dir[0]), round(plane.dir[1])],
      normal: [round(plane.normal[0]), round(plane.normal[1])],
      lengthFt: round(plane.lengthFt),
    },
    bandFt,
    entities,
    bounds: { u0: round(uMin), u1: round(uMax), v0: round(vMin), v1: round(vMax) },
    counts,
    disclaimer: SECTION_DISCLAIMER,
  };
}

/** Wall: a vertical box from baseZ..baseZ+heightFt; in section it is a rect over the u-extent
 *  where the wall's plan segment crosses the band, OR a thin cut rect if the plane slices it. */
function addWall(s, plane, bandFt, baseCutTol, entities, counts, noteU, noteV) {
  if (!Array.isArray(s.a) || !Array.isArray(s.b)) return;
  const seg = segmentToSection(plane, s.a, s.b);
  const v0 = Number(s.baseZ) || 0;
  const v1 = v0 + (Number(s.heightFt) || 0);
  if (!(v1 > v0)) return;
  const thick = Number(s.thicknessFt) || 0.5;
  const cutTol = baseCutTol != null ? baseCutTol : Math.max(thick / 2, 0.5);

  // Where (if anywhere) along the wall does it sit within the band depth?
  // Use the segment's signed offsets sa..sb; the part within |s|<=bandFt is visible.
  const visU = clipSegmentByDepth(seg, bandFt);
  if (!visU) return; // wall entirely outside the band

  // Is the plane actually cutting this wall (passes through the depth ~0 within cutTol)?
  const crossesZero = (Math.sign(seg.sa) !== Math.sign(seg.sb)) || Math.min(Math.abs(seg.sa), Math.abs(seg.sb)) <= cutTol;
  const cut = crossesZero;

  if (cut) {
    // The plane slices the wall: draw the wall THICKNESS as a bold rect at the crossing u.
    const uCross = depthZeroU(seg);
    const u0 = uCross - thick / 2, u1 = uCross + thick / 2;
    entities.push({ type: 'rect', kind: 'wall', role: s.type || 'wall', name: s.name, cut: true, u0: round(u0), u1: round(u1), v0: round(v0), v1: round(v1) });
    counts.walls++; counts.cut++;
    noteU(u0); noteU(u1); noteV(v0); noteV(v1);
  } else {
    // Wall is beyond the plane but within the band — draw its elevation footprint (light).
    const u0 = Math.min(visU[0], visU[1]), u1 = Math.max(visU[0], visU[1]);
    if (u1 - u0 < 1e-3) return;
    entities.push({ type: 'rect', kind: 'wall', role: s.type || 'wall', name: s.name, cut: false, u0: round(u0), u1: round(u1), v0: round(v0), v1: round(v1) });
    counts.walls++; counts.beyond++;
    noteU(u0); noteU(u1); noteV(v0); noteV(v1);
  }
}

/** Column: a vertical square post at (x,y). In section: a rect of width sizeFt at its u,
 *  IF the post is within the band depth. Cut if the plane passes within sizeFt/2. */
function addColumn(s, plane, bandFt, baseCutTol, entities, counts, noteU, noteV) {
  if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return;
  const p = projectPlan(plane, s.x, s.y);
  if (Math.abs(p.s) > bandFt) return; // outside the band
  const size = Number(s.sizeFt) || 1;
  const v0 = Number(s.baseZ) || 0;
  const v1 = v0 + (Number(s.heightFt) || 0);
  if (!(v1 > v0)) return;
  const cutTol = baseCutTol != null ? baseCutTol : Math.max(size / 2, 0.5);
  const cut = Math.abs(p.s) <= cutTol;
  const u0 = p.u - size / 2, u1 = p.u + size / 2;
  entities.push({ type: 'rect', kind: 'column', name: s.name, cut, gridLabel: s.gridLabel, u0: round(u0), u1: round(u1), v0: round(v0), v1: round(v1) });
  counts.columns++; if (cut) counts.cut++; else counts.beyond++;
  noteU(u0); noteU(u1); noteV(v0); noteV(v1);
}

/** Pipe: a 3D segment from..to ([x,y,z]). In section: projected line in (u, z). Visible if
 *  EITHER endpoint is within band depth (we clip to the band). Cut if it crosses the plane depth. */
function addPipe(s, plane, bandFt, entities, counts, noteU, noteV) {
  if (!Array.isArray(s.from) || !Array.isArray(s.to)) return;
  const fa = projectPlan(plane, s.from[0], s.from[1]);
  const fb = projectPlan(plane, s.to[0], s.to[1]);
  const za = Number(s.from[2]) || 0, zb = Number(s.to[2]) || 0;
  // Clip the segment to |s| <= bandFt in depth (parametric t in [0,1]).
  const clip = clipParamByDepth(fa.s, fb.s, bandFt);
  if (!clip) return; // entirely outside band
  const [t0, t1] = clip;
  const ua = fa.u + (fb.u - fa.u) * t0, va = za + (zb - za) * t0;
  const ub = fa.u + (fb.u - fa.u) * t1, vb = za + (zb - za) * t1;
  const crossesZero = (Math.sign(fa.s) !== Math.sign(fb.s));
  const minS = Math.min(Math.abs(fa.s), Math.abs(fb.s));
  const cut = crossesZero || minS <= 0.5;
  entities.push({
    type: 'line', kind: 'pipe', role: s.role || null, name: s.name, diameterIn: s.diameterIn || null, cut,
    a: [round(ua), round(va)], b: [round(ub), round(vb)],
  });
  counts.pipes++; if (cut) counts.cut++; else counts.beyond++;
  noteU(ua); noteU(ub); noteV(va); noteV(vb);
}

/** Head: a point at position [x,y,z]. In section: a head glyph at (u, z) if within band. */
function addHead(s, plane, bandFt, entities, counts, noteU, noteV) {
  const pos = s.position; if (!Array.isArray(pos)) return;
  const p = projectPlan(plane, pos[0], pos[1]);
  if (Math.abs(p.s) > bandFt) return;
  const v = Number(pos[2]) || 0;
  const cut = Math.abs(p.s) <= 0.5;
  entities.push({ type: 'head', kind: 'head', name: s.name, orientation: s.orientation || 'pendent', cut, u: round(p.u), v: round(v), depthFt: round(p.s) });
  counts.heads++; if (cut) counts.cut++; else counts.beyond++;
  noteU(p.u); noteV(v);
}

/** Find the u where a section segment's signed depth crosses 0 (linear interp). */
function depthZeroU(seg) {
  const { ua, sa, ub, sb } = seg;
  if (Math.abs(sb - sa) < EPS) return (ua + ub) / 2;
  const t = sa / (sa - sb); // s(t) = sa + t*(sb-sa) = 0
  const tc = Math.max(0, Math.min(1, t));
  return ua + (ub - ua) * tc;
}

/** Clip a plan segment (in section coords) to the depth band; return [u0,u1] of the visible part or null. */
function clipSegmentByDepth(seg, bandFt) {
  const t = clipParamByDepth(seg.sa, seg.sb, bandFt);
  if (!t) return null;
  const [t0, t1] = t;
  return [seg.ua + (seg.ub - seg.ua) * t0, seg.ua + (seg.ub - seg.ua) * t1];
}

/** Clip parameter t in [0,1] of a segment whose depth goes sa->sb so that |s|<=band. Returns [t0,t1] or null. */
function clipParamByDepth(sa, sb, band) {
  // depth(t) = sa + t*(sb-sa), want -band <= depth <= band
  const d = sb - sa;
  if (Math.abs(d) < EPS) {
    return Math.abs(sa) <= band ? [0, 1] : null;
  }
  let tLo = (-band - sa) / d;
  let tHi = (band - sa) / d;
  if (tLo > tHi) { const tmp = tLo; tLo = tHi; tHi = tmp; }
  const t0 = Math.max(0, tLo), t1 = Math.min(1, tHi);
  if (t1 < t0 - EPS) return null;
  return [t0, t1];
}
