import { extractArcsFromOpList } from './plan-doors.js';
import { extractSegmentsFromOpList } from './pdf-floorplan.js';

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function segLen(s) {
  return Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
}

function normalizeWall(w, index) {
  if (w && Array.isArray(w.a) && Array.isArray(w.b)) {
    return { x1: Number(w.a[0]), y1: Number(w.a[1]), x2: Number(w.b[0]), y2: Number(w.b[1]), index };
  }
  if (w && Number.isFinite(w.x1) && Number.isFinite(w.y1) && Number.isFinite(w.x2) && Number.isFinite(w.y2)) {
    return { x1: Number(w.x1), y1: Number(w.y1), x2: Number(w.x2), y2: Number(w.y2), index };
  }
  return null;
}

function normalizeSegment(s) {
  if (!s || !Number.isFinite(s.x1) || !Number.isFinite(s.y1) || !Number.isFinite(s.x2) || !Number.isFinite(s.y2)) {
    return null;
  }
  return { x1: Number(s.x1), y1: Number(s.y1), x2: Number(s.x2), y2: Number(s.y2) };
}

function pointSegDist(px, py, s) {
  const vx = s.x2 - s.x1;
  const vy = s.y2 - s.y1;
  const wx = px - s.x1;
  const wy = py - s.y1;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return dist(px, py, s.x1, s.y1);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return dist(px, py, s.x2, s.y2);
  const t = c1 / c2;
  return dist(px, py, s.x1 + t * vx, s.y1 + t * vy);
}

function angleDelta(a, b) {
  const mod = Math.abs(a - b) % Math.PI;
  return Math.min(mod, Math.abs(Math.PI - mod));
}

function resolveOpList(pageOrOpList) {
  if (pageOrOpList && Array.isArray(pageOrOpList.fnArray) && Array.isArray(pageOrOpList.argsArray)) return pageOrOpList;
  if (pageOrOpList && pageOrOpList.opList && Array.isArray(pageOrOpList.opList.fnArray)) return pageOrOpList.opList;
  return null;
}

function segmentToVectors(seg) {
  const len = segLen(seg) || 1;
  return {
    dir: [(seg.x2 - seg.x1) / len, (seg.y2 - seg.y1) / len],
    len,
  };
}

function findLeafSegment(arc, segments, opts) {
  const endpointTolFt = Number.isFinite(opts.endpointTolFt) ? Number(opts.endpointTolFt) : 0.35;
  const lineRadiusTolFt = Number.isFinite(opts.lineRadiusTolFt) ? Number(opts.lineRadiusTolFt) : 0.9;
  const centerTolFt = Number.isFinite(opts.centerTolFt) ? Number(opts.centerTolFt) : 0.75;
  let best = null;
  for (const seg of segments) {
    const len = segLen(seg);
    if (Math.abs(len - arc.rFt) > lineRadiusTolFt) continue;
    const dStart1 = dist(seg.x1, seg.y1, arc.startFt[0], arc.startFt[1]);
    const dStart2 = dist(seg.x2, seg.y2, arc.startFt[0], arc.startFt[1]);
    const dEnd1 = dist(seg.x1, seg.y1, arc.endFt[0], arc.endFt[1]);
    const dEnd2 = dist(seg.x2, seg.y2, arc.endFt[0], arc.endFt[1]);
    const nearArc = Math.min(dStart1, dStart2, dEnd1, dEnd2);
    if (nearArc > endpointTolFt) continue;

    const shared = nearArc === dStart1 ? { x: seg.x1, y: seg.y1 }
      : nearArc === dStart2 ? { x: seg.x2, y: seg.y2 }
        : nearArc === dEnd1 ? { x: seg.x1, y: seg.y1 }
          : { x: seg.x2, y: seg.y2 };
    const other = (shared.x === seg.x1 && shared.y === seg.y1)
      ? { x: seg.x2, y: seg.y2 }
      : { x: seg.x1, y: seg.y1 };
    const centerD = dist(other.x, other.y, arc.cxFt, arc.cyFt);
    if (centerD > centerTolFt) continue;

    const score = nearArc + centerD + Math.abs(len - arc.rFt);
    if (!best || score < best.score) best = { seg, shared, hinge: other, score };
  }
  return best;
}

function findWallGap(arc, walls, opts) {
  const gapTolFt = Number.isFinite(opts.gapTolFt) ? Number(opts.gapTolFt) : 1;
  const gapProximityFt = Number.isFinite(opts.gapProximityFt) ? Number(opts.gapProximityFt) : 1;
  const parallelTolRad = Number.isFinite(opts.parallelTolRad) ? Number(opts.parallelTolRad) : 0.18;
  const chord = {
    x1: arc.startFt[0],
    y1: arc.startFt[1],
    x2: arc.endFt[0],
    y2: arc.endFt[1],
  };
  const chordMidX = (chord.x1 + chord.x2) / 2;
  const chordMidY = (chord.y1 + chord.y2) / 2;
  const chordLen = segLen(chord);
  const chordAngle = Math.atan2(chord.y2 - chord.y1, chord.x2 - chord.x1);
  let best = null;

  for (let i = 0; i < walls.length; i++) {
    const a = walls[i];
    const aAngle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
    for (let j = i + 1; j < walls.length; j++) {
      const b = walls[j];
      const bAngle = Math.atan2(b.y2 - b.y1, b.x2 - b.x1);
      if (angleDelta(aAngle, chordAngle) > parallelTolRad || angleDelta(bAngle, chordAngle) > parallelTolRad) continue;
      const pairs = [
        { p: { x: a.x1, y: a.y1 }, q: { x: b.x1, y: b.y1 } },
        { p: { x: a.x1, y: a.y1 }, q: { x: b.x2, y: b.y2 } },
        { p: { x: a.x2, y: a.y2 }, q: { x: b.x1, y: b.y1 } },
        { p: { x: a.x2, y: a.y2 }, q: { x: b.x2, y: b.y2 } },
      ];
      for (const pair of pairs) {
        const gap = { x1: pair.p.x, y1: pair.p.y, x2: pair.q.x, y2: pair.q.y };
        const gapLen = segLen(gap);
        if (Math.abs(gapLen - chordLen) > gapTolFt) continue;
        if (angleDelta(Math.atan2(gap.y2 - gap.y1, gap.x2 - gap.x1), chordAngle) > parallelTolRad) continue;
        const midX = (gap.x1 + gap.x2) / 2;
        const midY = (gap.y1 + gap.y2) / 2;
        if (dist(midX, midY, chordMidX, chordMidY) > gapProximityFt) continue;
        const score = dist(midX, midY, chordMidX, chordMidY) + Math.abs(gapLen - chordLen);
        if (!best || score < best.score) {
          best = {
            walls: [a.index, b.index],
            gap,
            gapWidthFt: gapLen,
            score,
          };
        }
      }
    }
  }
  return best;
}

export function detectDoorsFromOpList(opList, walls = [], opts = {}) {
  const scale = Number.isFinite(opts.scale) ? Number(opts.scale) : 1;
  const minRadiusFt = Number.isFinite(opts.minRadiusFt) ? Number(opts.minRadiusFt) : 2;
  const maxRadiusFt = Number.isFinite(opts.maxRadiusFt) ? Number(opts.maxRadiusFt) : 3.5;
  const minSweepDeg = Number.isFinite(opts.minSweepDeg) ? Number(opts.minSweepDeg) : 60;
  const maxSweepDeg = Number.isFinite(opts.maxSweepDeg) ? Number(opts.maxSweepDeg) : 120;
  const dedupFt = Number.isFinite(opts.dedupFt) ? Number(opts.dedupFt) : 0.5;

  const arcs = extractArcsFromOpList(opList, { scale }).arcs.filter((arc) =>
    Number.isFinite(arc.rFt)
    && arc.rFt >= minRadiusFt
    && arc.rFt <= maxRadiusFt
    && Math.abs(arc.sweepDeg) >= minSweepDeg
    && Math.abs(arc.sweepDeg) <= maxSweepDeg);
  const segments = extractSegmentsFromOpList(opList, { scale }).segments.map(normalizeSegment).filter(Boolean);
  const normalizedWalls = (Array.isArray(walls) ? walls : []).map(normalizeWall).filter(Boolean);
  const uniqueArcs = [];

  for (const arc of arcs) {
    if (uniqueArcs.some((seen) => dist(seen.cxFt, seen.cyFt, arc.cxFt, arc.cyFt) <= dedupFt && Math.abs(seen.rFt - arc.rFt) <= 0.5)) {
      continue;
    }
    uniqueArcs.push(arc);
  }

  const doors = [];
  for (const arc of uniqueArcs) {
    const leaf = findLeafSegment(arc, segments, opts);
    if (!leaf) continue;
    const gap = findWallGap(arc, normalizedWalls, opts);
    if (!gap) continue;
    const swingDx = arc.endFt[0] - arc.cxFt;
    const swingDy = arc.endFt[1] - arc.cyFt;
    const swingMag = Math.hypot(swingDx, swingDy) || 1;
    const leafDx = leaf.shared.x - leaf.hinge.x;
    const leafDy = leaf.shared.y - leaf.hinge.y;
    const leafMag = Math.hypot(leafDx, leafDy) || 1;
    doors.push({
      kind: 'door',
      position: [round(arc.cxFt), round(arc.cyFt)],
      width: round(arc.rFt),
      swingDir: [round(swingDx / swingMag), round(swingDy / swingMag)],
      leafDir: [round(leafDx / leafMag), round(leafDy / leafMag)],
      sweepDeg: round(arc.sweepDeg),
      hostWalls: gap.walls,
      wallGap: {
        center: [round((gap.gap.x1 + gap.gap.x2) / 2), round((gap.gap.y1 + gap.gap.y2) / 2)],
        widthFt: round(gap.gapWidthFt),
      },
      evidence: 'arc+adjacent-line+wall-gap',
      confidence: 'medium',
      needsVerification: true,
    });
  }

  doors.sort((a, b) => a.position[0] - b.position[0] || a.position[1] - b.position[1]);
  return doors;
}

export async function extractDoorsFromPdf(page, walls = [], opts = {}) {
  const opList = resolveOpList(page);
  if (opList) return detectDoorsFromOpList(opList, walls, opts);
  if (!page || typeof page.getOperatorList !== 'function') {
    throw new Error('extractDoorsFromPdf requires a pdfjs page or operator list');
  }
  const resolvedOpList = await page.getOperatorList();
  const scale = Number.isFinite(opts.scale) ? Number(opts.scale) : Number(page.scale);
  return detectDoorsFromOpList(resolvedOpList, walls, Number.isFinite(scale) ? { ...opts, scale } : opts);
}

export default extractDoorsFromPdf;
