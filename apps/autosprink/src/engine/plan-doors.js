/**
 * plan-doors.js — DOOR / OPENING / FIXTURE extraction (W2).
 *
 * The wall extractor (extractSegmentsFromOpList) FLATTENS bezier curves into their endpoint
 * line segment — it deliberately discards curve identity because walls are straight. But a
 * DOOR is drawn as its SWING ARC (a quarter-circle bezier whose radius == the door leaf width)
 * plus a leaf line. To recover doors we re-walk the operator list KEEPING the curve control
 * points, fit a circle to each curve, and accept arcs whose radius is a plausible leaf width
 * (~2-4 ft) swept ~quarter-turn. The arc CENTER is the hinge (= door position); the radius is
 * the width; the start->end vector gives the swing direction; the nearest wall is the host.
 *
 * OPENINGS = gaps in an otherwise-continuous wall run with no door arc (a passage / cased
 * opening). FIXTURES = restroom / mech / elevator / stair space content, located + counted
 * from the segmented rooms + text labels (the comprehension the room segmenter already does).
 *
 * HONESTY: every door/opening/fixture is geometric best-effort, carries provenance + a
 * needs-verification flag, and asserts NOTHING about AHJ / egress / hardware schedules. The
 * arc geometry is REAL (the plan's own bezier control points, CTM-mapped). SAM3 may be used
 * to DISAMBIGUATE unclear arcs/labels (injected invoker) but is never required.
 *
 * Pure core (detectDoors, detectOpenings, detectFixtures, fitCircle) + a thin pdfjs arc walker
 * (extractArcsFromOpList) that mirrors extractSegmentsFromOpList's CTM + dual-form constructPath
 * handling so it works on both legacy (v4) and packed (v6) operator lists.
 */
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

const DRAW_OP = Object.freeze({ moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 });
const DRAW_OP_ARITY = Object.freeze({ 0: 2, 1: 2, 2: 6, 3: 4, 4: 0 });

function round(n) { return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4; }

/**
 * PURE. Fit a circle through three points (arc start, bezier midpoint, arc end). Returns
 * {cx, cy, r} in the input coordinate units, or null if the points are collinear.
 */
export function fitCircle(A, B, C) {
  const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = A[0] * A[0] + A[1] * A[1];
  const b2 = B[0] * B[0] + B[1] * B[1];
  const c2 = C[0] * C[0] + C[1] * C[1];
  const cx = (a2 * (B[1] - C[1]) + b2 * (C[1] - A[1]) + c2 * (A[1] - B[1])) / d;
  const cy = (a2 * (C[0] - B[0]) + b2 * (A[0] - C[0]) + c2 * (B[0] - A[0])) / d;
  return { cx, cy, r: Math.hypot(A[0] - cx, A[1] - cy) };
}

/**
 * Async. Walk a pdfjs operator list and emit ARC primitives (in FEET) by circle-fitting every
 * cubic/quadratic bezier curve. Mirrors extractSegmentsFromOpList's CTM stack + dual constructPath
 * shapes so it runs on both legacy and v6 op lists. Each arc carries
 * {cxFt, cyFt, rFt, startFt:[x,y], endFt:[x,y], sweepDeg, lineWidth}.
 *
 * @param {{fnArray:number[], argsArray:any[]}} opList
 * @param {{scale?:number}} [opts] - scale = feet per PDF unit.
 * @returns {{arcs:Array}}
 */
export function extractArcsFromOpList(opList, opts = {}) {
  const scale = Number.isFinite(opts.scale) ? Number(opts.scale) : 1;
  const fnArray = (opList && opList.fnArray) || [];
  const argsArray = (opList && opList.argsArray) || [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const ctmStack = [];
  let lw = null; const lwStack = [];
  const arcs = [];
  let cur = null; // current point in PAGE space (PDF pt)
  const ap = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
  const mulCtm = (m) => {
    const a = ctm;
    ctm = [a[0]*m[0]+a[2]*m[1], a[1]*m[0]+a[3]*m[1], a[0]*m[2]+a[2]*m[3], a[1]*m[2]+a[3]*m[3], a[0]*m[4]+a[2]*m[5]+a[4], a[1]*m[4]+a[3]*m[5]+a[5]];
  };
  const ctmScale = () => Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1;

  const emitCubic = (p1, p2, p3) => {
    if (!cur) { cur = p3; return; }
    const A = cur, C = p3;
    // bezier midpoint (t=0.5)
    const bx = 0.125 * A[0] + 0.375 * p1[0] + 0.375 * p2[0] + 0.125 * C[0];
    const by = 0.125 * A[1] + 0.375 * p1[1] + 0.375 * p2[1] + 0.125 * C[1];
    const circ = fitCircle(A, [bx, by], C);
    if (circ) {
      let sweep = Math.atan2(C[1] - circ.cy, C[0] - circ.cx) - Math.atan2(A[1] - circ.cy, A[0] - circ.cx);
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      const elw = lw == null ? null : lw * ctmScale();
      arcs.push({
        cxFt: round(circ.cx * scale), cyFt: round(circ.cy * scale), rFt: round(circ.r * scale),
        startFt: [round(A[0] * scale), round(A[1] * scale)], endFt: [round(C[0] * scale), round(C[1] * scale)],
        sweepDeg: round(sweep * 180 / Math.PI), lineWidth: elw,
      });
    }
    cur = p3;
  };
  const emitQuad = (p1, p3) => {
    // promote quadratic to cubic control points then reuse
    if (!cur) { cur = p3; return; }
    const A = cur;
    const c1 = [A[0] + (2 / 3) * (p1[0] - A[0]), A[1] + (2 / 3) * (p1[1] - A[1])];
    const c2 = [p3[0] + (2 / 3) * (p1[0] - p3[0]), p3[1] + (2 / 3) * (p1[1] - p3[1])];
    emitCubic(c1, c2, p3);
  };

  const walkDrawBuffer = (buf) => {
    let i = 0; const n = buf.length;
    while (i < n) {
      const code = buf[i] | 0; const arity = DRAW_OP_ARITY[code];
      if (arity === undefined) break;
      if (code === DRAW_OP.moveTo) cur = ap(buf[i + 1], buf[i + 2]);
      else if (code === DRAW_OP.lineTo) cur = ap(buf[i + 1], buf[i + 2]);
      else if (code === DRAW_OP.curveTo) emitCubic(ap(buf[i + 1], buf[i + 2]), ap(buf[i + 3], buf[i + 4]), ap(buf[i + 5], buf[i + 6]));
      else if (code === DRAW_OP.quadraticCurveTo) emitQuad(ap(buf[i + 1], buf[i + 2]), ap(buf[i + 3], buf[i + 4]));
      // closePath: leave cur (arc detection doesn't need the closing line)
      i += 1 + arity;
    }
  };
  const walkLegacy = (subOps, coords) => {
    let c = 0;
    for (const sub of subOps) {
      if (sub === OPS.moveTo) { cur = ap(coords[c], coords[c + 1]); c += 2; }
      else if (sub === OPS.lineTo) { cur = ap(coords[c], coords[c + 1]); c += 2; }
      else if (sub === OPS.curveTo) { emitCubic(ap(coords[c], coords[c + 1]), ap(coords[c + 2], coords[c + 3]), ap(coords[c + 4], coords[c + 5])); c += 6; }
      else if (sub === OPS.curveTo2 || sub === OPS.curveTo3) { emitQuad(ap(coords[c], coords[c + 1]), ap(coords[c + 2], coords[c + 3])); c += 4; }
      else if (sub === OPS.rectangle) { c += 4; cur = null; }
      else if (sub === OPS.closePath) { /* keep cur */ }
    }
  };
  const dispatch = (args) => {
    const a0 = args[0], a1 = args[1];
    if (Array.isArray(a1) && a1[0] && typeof a1[0] !== 'number' && typeof a1[0].length === 'number') { walkDrawBuffer(a1[0]); return; }
    if (Array.isArray(a0) && Array.isArray(a1)) { walkLegacy(a0, a1); return; }
    if (a0 && typeof a0.length === 'number' && a1 && typeof a1.length === 'number' && typeof a0 !== 'string' && typeof a1 !== 'string') { walkLegacy(Array.from(a0), Array.from(a1)); }
  };

  for (let k = 0; k < fnArray.length; k++) {
    const fn = fnArray[k]; const args = argsArray[k] || [];
    if (fn === OPS.save) { ctmStack.push(ctm.slice()); lwStack.push(lw); }
    else if (fn === OPS.restore) { if (ctmStack.length) ctm = ctmStack.pop(); if (lwStack.length) lw = lwStack.pop(); }
    else if (fn === OPS.transform) { if (args.length >= 6) mulCtm([args[0], args[1], args[2], args[3], args[4], args[5]]); }
    else if (fn === OPS.setLineWidth) { lw = args[0]; }
    else if (fn === OPS.moveTo) cur = ap(args[0], args[1]);
    else if (fn === OPS.lineTo) cur = ap(args[0], args[1]);
    else if (fn === OPS.curveTo) emitCubic(ap(args[0], args[1]), ap(args[2], args[3]), ap(args[4], args[5]));
    else if (fn === OPS.curveTo2 || fn === OPS.curveTo3) emitQuad(ap(args[0], args[1]), ap(args[2], args[3]));
    else if (fn === OPS.constructPath) dispatch(args);
  }
  return { arcs };
}

const segLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** Distance from point P to segment S, in the same units. */
function pointSegDist(px, py, s) {
  const vx = s.x2 - s.x1, vy = s.y2 - s.y1;
  const wx = px - s.x1, wy = py - s.y1;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return dist(px, py, s.x1, s.y1);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return dist(px, py, s.x2, s.y2);
  const t = c1 / c2;
  return dist(px, py, s.x1 + t * vx, s.y1 + t * vy);
}

/**
 * PURE. Detect DOORS from arc primitives + wall segments.
 *
 * Accept arcs whose radius is a plausible leaf width (minWidthFt..maxWidthFt) swept a roughly
 * quarter turn (|sweep| in minSweepDeg..maxSweepDeg). The arc center is the HINGE (door
 * position). Deduplicate hinges within dedupFt (the same swing is often drawn as 2-3 overlapping
 * beziers + a mirrored leaf). For each kept door, find the NEAREST wall segment within
 * hostWallMaxFt as the host wall, and derive the swing direction from start->end about the hinge.
 *
 * @param {Array} arcs - from extractArcsFromOpList (FEET).
 * @param {Array<{a:[x,y],b:[x,y]}|{x1,y1,x2,y2}>} walls - wall segments in FEET.
 * @param {Object} [opts]
 * @returns {{doors:Array, note:string}}
 */
export function detectDoors(arcs, walls = [], opts = {}) {
  const minWidthFt = Number.isFinite(opts.minWidthFt) ? opts.minWidthFt : 1.8;
  const maxWidthFt = Number.isFinite(opts.maxWidthFt) ? opts.maxWidthFt : 4.5;
  const minSweepDeg = Number.isFinite(opts.minSweepDeg) ? opts.minSweepDeg : 55;
  const maxSweepDeg = Number.isFinite(opts.maxSweepDeg) ? opts.maxSweepDeg : 115;
  const dedupFt = Number.isFinite(opts.dedupFt) ? opts.dedupFt : 1.2;
  const hostWallMaxFt = Number.isFinite(opts.hostWallMaxFt) ? opts.hostWallMaxFt : 3.0;
  const note =
    'Geometric door detection: swing ARCS (bezier curves circle-fit to a ~2-4 ft leaf radius ' +
    'swept ~quarter turn) recovered from the plan vector ops; arc center = hinge = door position, ' +
    'radius = leaf width, start->end = swing. Nearest wall within 3 ft = host. Best-effort, ' +
    'deterministic; NOT a verified door/hardware schedule; NOT AHJ/egress parity. needs-verification.';

  // normalize walls to {x1,y1,x2,y2}
  const wsegs = (Array.isArray(walls) ? walls : []).map((w) => (
    w && w.a && w.b ? { x1: w.a[0], y1: w.a[1], x2: w.b[0], y2: w.b[1] } : w
  )).filter((w) => w && Number.isFinite(w.x1));

  const cand = (Array.isArray(arcs) ? arcs : []).filter((a) =>
    Number.isFinite(a.rFt) && a.rFt >= minWidthFt && a.rFt <= maxWidthFt &&
    Math.abs(a.sweepDeg) >= minSweepDeg && Math.abs(a.sweepDeg) <= maxSweepDeg);

  // dedup by hinge centroid (cx,cy) within dedupFt and similar radius.
  const uniq = [];
  for (const a of cand) {
    const dup = uniq.find((u) => dist(u.cxFt, u.cyFt, a.cxFt, a.cyFt) <= dedupFt && Math.abs(u.rFt - a.rFt) <= 0.7);
    if (!dup) uniq.push(a);
  }

  const doors = [];
  for (const a of uniq) {
    // host wall = nearest wall to the hinge.
    let host = null, hostD = Infinity, hostIdx = -1;
    for (let i = 0; i < wsegs.length; i++) {
      const d = pointSegDist(a.cxFt, a.cyFt, wsegs[i]);
      if (d < hostD) { hostD = d; host = wsegs[i]; hostIdx = i; }
    }
    const onWall = host && hostD <= hostWallMaxFt;
    // swing direction unit vector (hinge -> arc end), and leaf orientation (hinge -> arc start).
    const sdx = a.endFt[0] - a.cxFt, sdy = a.endFt[1] - a.cyFt;
    const ldx = a.startFt[0] - a.cxFt, ldy = a.startFt[1] - a.cyFt;
    const ang = Math.atan2(sdy, sdx) * 180 / Math.PI;
    doors.push({
      kind: 'door',
      position: [round(a.cxFt), round(a.cyFt)],
      width: round(a.rFt),
      swingDir: [round(sdx / (Math.hypot(sdx, sdy) || 1)), round(sdy / (Math.hypot(sdx, sdy) || 1))],
      leafDir: [round(ldx / (Math.hypot(ldx, ldy) || 1)), round(ldy / (Math.hypot(ldx, ldy) || 1))],
      swingAngleDeg: round(ang),
      sweepDeg: round(a.sweepDeg),
      hostWall: onWall ? hostIdx : null,
      hostWallDistFt: round(hostD),
      onWall: !!onWall,
      evidence: 'swing-arc(circle-fit,leaf-radius,quarter-sweep)',
      confidence: onWall ? 'medium' : 'low',
      provenance: 'extracted (vector PDF bezier arc, CTM-mapped) — needs-verification',
      needsVerification: true,
    });
  }
  doors.sort((p, q) => p.position[0] - q.position[0] || p.position[1] - q.position[1]);
  return { doors, note };
}

/**
 * PURE. Detect OPENINGS (cased openings / passages): gaps of openGapMinFt..openGapMaxFt in an
 * otherwise-collinear wall run that have NO door arc on them. Honest + conservative: we only
 * report a gap as an opening when it sits between two near-collinear wall ends and no detected
 * door hinge lies within the gap. This is best-effort; flagged needs-verification.
 *
 * @param {Array<{a,b}|{x1,y1,x2,y2}>} walls FEET
 * @param {Array} doors - detected doors (to exclude door gaps)
 * @param {Object} [opts]
 * @returns {{openings:Array, note:string}}
 */
export function detectOpenings(walls = [], doors = [], opts = {}) {
  const gapMin = Number.isFinite(opts.openGapMinFt) ? opts.openGapMinFt : 2.5;
  const gapMax = Number.isFinite(opts.openGapMaxFt) ? opts.openGapMaxFt : 8;
  const collinTolFt = Number.isFinite(opts.collinTolFt) ? opts.collinTolFt : 0.75;
  const note =
    'Geometric opening detection: gaps (2.5-8 ft) between two near-collinear wall ends with no ' +
    'door arc on them = cased opening / passage. Best-effort, deterministic; needs-verification.';
  // A real cased opening is a gap in a SUBSTANTIAL wall run — require both flanking segments to be
  // at least minFlankFt long (drops the spurious collinear-jog pairs that flood a dense wall set).
  const minFlankFt = Number.isFinite(opts.minFlankFt) ? opts.minFlankFt : 3;
  const wsegs = (Array.isArray(walls) ? walls : []).map((w) => (
    w && w.a && w.b ? { x1: w.a[0], y1: w.a[1], x2: w.b[0], y2: w.b[1] } : w
  )).filter((w) => w && Number.isFinite(w.x1) && segLen(w) >= minFlankFt);

  const doorPts = (Array.isArray(doors) ? doors : []).map((d) => d.position);
  const openings = [];
  // Bucket walls by orientation+offset so we only compare collinear neighbours (cheap, deterministic).
  for (let i = 0; i < wsegs.length; i++) {
    const wi = wsegs[i];
    const ax = Math.atan2(wi.y2 - wi.y1, wi.x2 - wi.x1);
    for (let j = i + 1; j < wsegs.length; j++) {
      const wj = wsegs[j];
      const bx = Math.atan2(wj.y2 - wj.y1, wj.x2 - wj.x1);
      const da = Math.abs(((ax - bx + Math.PI) % Math.PI));
      if (da > 0.08 && da < Math.PI - 0.08) continue; // not parallel
      // nearest endpoints between the two segments
      const ends = [[wi.x2, wi.y2, wj.x1, wj.y1], [wi.x1, wi.y1, wj.x2, wj.y2], [wi.x2, wi.y2, wj.x2, wj.y2], [wi.x1, wi.y1, wj.x1, wj.y1]];
      let best = null;
      for (const [px, py, qx, qy] of ends) {
        const g = dist(px, py, qx, qy);
        if (g >= gapMin && g <= gapMax) {
          // collinearity: midpoint of gap must lie ~on segment i's infinite line
          const mx = (px + qx) / 2, my = (py + qy) / 2;
          const perp = pointSegDist(mx, my, { x1: wi.x1 - (wi.x2 - wi.x1) * 5, y1: wi.y1 - (wi.y2 - wi.y1) * 5, x2: wi.x2 + (wi.x2 - wi.x1) * 5, y2: wi.y2 + (wi.y2 - wi.y1) * 5 });
          if (perp <= collinTolFt) {
            const hasDoor = doorPts.some((dp) => dist(dp[0], dp[1], mx, my) <= Math.max(gapMax, 4));
            if (!hasDoor && (!best || g < best.gap)) best = { mx, my, gap: g };
          }
        }
      }
      if (best) {
        openings.push({ kind: 'opening', position: [round(best.mx), round(best.my)], width: round(best.gap), evidence: 'collinear-wall-gap(no-arc)', confidence: 'low', needsVerification: true });
      }
    }
  }
  // dedup by position within 2ft
  const uniq = [];
  for (const o of openings) { if (!uniq.some((u) => dist(u.position[0], u.position[1], o.position[0], o.position[1]) <= 2)) uniq.push(o); }
  uniq.sort((p, q) => p.position[0] - q.position[0] || p.position[1] - q.position[1]);
  return { openings: uniq, note };
}

const FIXTURE_KINDS = Object.freeze([
  { kind: 'restroom', re: /\bREST\s*ROOM\b|\bTOILET\b|\bW\.?C\.?\b|\bBATH(ROOM)?\b|\bLAV\b|\bURINAL\b/i },
  { kind: 'elevator', re: /\bELEV(ATOR)?\b|\bLIFT\b/i },
  { kind: 'stair', re: /\bSTAIR(WELL|CASE|S)?\b/i },
  { kind: 'mech', re: /\bMECH(ANICAL)?\b|\bBOILER\b|\bFAN\s*ROOM\b|\bHVAC\b|\bMEP\b/i },
  { kind: 'elec', re: /\bELEC(TRICAL)?\b|\bSWITCHGEAR\b|\bIDF\b|\bMDF\b|\bTRANSFORMER\b/i },
  { kind: 'trash', re: /\bTRASH\b|\bREFUSE\b|\bGARBAGE\b|\bRECYCL/i },
]);

/**
 * PURE. Detect FIXTURES / building cores as labeled space content: restroom / mech / elevator /
 * stair / elec / trash, located from (a) rooms already classified those kinds by the segmenter,
 * and (b) text-label tokens whose position falls inside a room (the symbol's room). Each fixture
 * is at minimum COUNTED + LOCATED (centroid). Best-effort; needs-verification.
 *
 * @param {Array<{poly,kind,label}>} rooms - segmented rooms (FEET)
 * @param {Array<{text,xFt,yFt}>} labels - text labels in FEET
 * @param {Array} stairs - already-detected stair cores (FEET)
 * @returns {{fixtures:Array, counts:Object, note:string}}
 */
export function detectFixtures(rooms = [], labels = [], stairs = []) {
  const note =
    'Fixture/core detection: restroom/mech/elevator/stair/elec/trash space content located + ' +
    'counted from segmented-room kinds and text-label tokens inside rooms. Best-effort, ' +
    'deterministic; NOT a verified fixture schedule; NOT AHJ/PE parity. needs-verification.';
  const polyCentroid = (poly) => {
    let sx = 0, sy = 0; for (const p of poly) { sx += p[0]; sy += p[1]; } return [round(sx / poly.length), round(sy / poly.length)];
  };
  const polyBbox = (poly) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const p of poly) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
    return { minX: a, minY: b, maxX: c, maxY: d };
  };
  const classify = (text) => { const t = String(text || ''); for (const { kind, re } of FIXTURE_KINDS) if (re.test(t)) return kind; return null; };

  const fixtures = [];
  const seen = new Set();
  const pushFix = (kind, centroid, source, label) => {
    const key = `${kind}:${Math.round(centroid[0])}:${Math.round(centroid[1])}`;
    if (seen.has(key)) return;
    seen.add(key);
    fixtures.push({ kind: 'fixture', fixtureKind: kind, position: centroid, source, label: label || null, confidence: source === 'room-kind' ? 'medium' : 'low', needsVerification: true });
  };

  // (a) from room kinds
  for (const r of (Array.isArray(rooms) ? rooms : [])) {
    const fk = classify(r.kind) || (['restroom', 'elevator', 'stair', 'mech', 'elec', 'trash'].includes(r.kind) ? r.kind : null);
    if (fk && Array.isArray(r.poly) && r.poly.length) pushFix(fk, polyCentroid(r.poly), 'room-kind', r.label);
  }
  // (b) from label tokens inside a room (the symbol's enclosing space)
  const roomBoxes = (Array.isArray(rooms) ? rooms : []).filter((r) => Array.isArray(r.poly) && r.poly.length).map((r) => ({ bbox: polyBbox(r.poly), centroid: polyCentroid(r.poly) }));
  for (const lab of (Array.isArray(labels) ? labels : [])) {
    const fk = classify(lab.text);
    if (!fk) continue;
    const host = roomBoxes.find((rb) => lab.xFt >= rb.bbox.minX && lab.xFt <= rb.bbox.maxX && lab.yFt >= rb.bbox.minY && lab.yFt <= rb.bbox.maxY);
    pushFix(fk, host ? host.centroid : [round(lab.xFt), round(lab.yFt)], host ? 'label-in-room' : 'label', lab.text);
  }
  // (c) stair cores as fixtures (location from bbox/centroid)
  for (const s of (Array.isArray(stairs) ? stairs : [])) {
    const c = s.centroidFt || (s.bbox ? [round((s.bbox.minX + s.bbox.maxX) / 2), round((s.bbox.minY + s.bbox.maxY) / 2)] : null);
    if (c) pushFix('stair', c, 'stair-core', null);
  }

  const counts = fixtures.reduce((acc, f) => { acc[f.fixtureKind] = (acc[f.fixtureKind] || 0) + 1; return acc; }, {});
  fixtures.sort((p, q) => p.position[0] - q.position[0] || p.position[1] - q.position[1]);
  return { fixtures, counts, note };
}
