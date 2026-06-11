/**
 * Colinear PDF stroke clustering (W9B).
 *
 * PDF vector extraction yields thousands of tiny colinear strokes that must
 * merge into wall-candidate runs before scoring (wall-extract-score). Pure
 * geometry; inputs are never mutated.
 */

export interface RawStroke {
  a: { x: number; y: number };
  b: { x: number; y: number };
  widthPt: number;
}

export interface ClusteredRun {
  a: { x: number; y: number };
  b: { x: number; y: number };
  widthPt: number;
  sourceCount: number;
}

export interface ClusterOpts {
  angleTolDeg?: number;
  gapTolPt?: number;
  offsetTolPt?: number;
}

interface Cluster {
  // Reference infinite line: point p0 + unit direction d.
  p0: { x: number; y: number };
  d: { x: number; y: number };
  angleDeg: number; // direction angle in [0, 180)
  tMin: number;
  tMax: number;
  widthPt: number;
  sourceCount: number;
}

const EPS = 1e-9;

function angleDeg180(dx: number, dy: number): number {
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  deg = ((deg % 180) + 180) % 180;
  return deg;
}

function angleDiff180(a: number, b: number): number {
  const raw = Math.abs(a - b) % 180;
  return Math.min(raw, 180 - raw);
}

function perpOffset(c: Cluster, p: { x: number; y: number }): number {
  const rx = p.x - c.p0.x;
  const ry = p.y - c.p0.y;
  return Math.abs(rx * -c.d.y + ry * c.d.x);
}

function project(c: Cluster, p: { x: number; y: number }): number {
  return (p.x - c.p0.x) * c.d.x + (p.y - c.p0.y) * c.d.y;
}

function strokeFits(
  c: Cluster,
  s: RawStroke,
  angleTolDeg: number,
  gapTolPt: number,
  offsetTolPt: number,
): boolean {
  const sAngle = angleDeg180(s.b.x - s.a.x, s.b.y - s.a.y);
  if (angleDiff180(c.angleDeg, sAngle) > angleTolDeg) return false;
  if (perpOffset(c, s.a) > offsetTolPt || perpOffset(c, s.b) > offsetTolPt) return false;
  const t1 = project(c, s.a);
  const t2 = project(c, s.b);
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  // Overlap or gap at most gapTolPt against the cluster's merged interval.
  return lo <= c.tMax + gapTolPt && hi >= c.tMin - gapTolPt;
}

function clustersFit(
  a: Cluster,
  b: Cluster,
  angleTolDeg: number,
  gapTolPt: number,
  offsetTolPt: number,
): boolean {
  if (angleDiff180(a.angleDeg, b.angleDeg) > angleTolDeg) return false;
  const bStart = { x: b.p0.x + b.tMin * b.d.x, y: b.p0.y + b.tMin * b.d.y };
  const bEnd = { x: b.p0.x + b.tMax * b.d.x, y: b.p0.y + b.tMax * b.d.y };
  if (perpOffset(a, bStart) > offsetTolPt || perpOffset(a, bEnd) > offsetTolPt) return false;
  const t1 = project(a, bStart);
  const t2 = project(a, bEnd);
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  return lo <= a.tMax + gapTolPt && hi >= a.tMin - gapTolPt;
}

function absorbStroke(c: Cluster, s: RawStroke): void {
  const t1 = project(c, s.a);
  const t2 = project(c, s.b);
  c.tMin = Math.min(c.tMin, t1, t2);
  c.tMax = Math.max(c.tMax, t1, t2);
  c.widthPt = Math.max(c.widthPt, s.widthPt);
  c.sourceCount += 1;
}

function absorbCluster(a: Cluster, b: Cluster): void {
  const bStart = { x: b.p0.x + b.tMin * b.d.x, y: b.p0.y + b.tMin * b.d.y };
  const bEnd = { x: b.p0.x + b.tMax * b.d.x, y: b.p0.y + b.tMax * b.d.y };
  const t1 = project(a, bStart);
  const t2 = project(a, bEnd);
  a.tMin = Math.min(a.tMin, t1, t2);
  a.tMax = Math.max(a.tMax, t1, t2);
  a.widthPt = Math.max(a.widthPt, b.widthPt);
  a.sourceCount += b.sourceCount;
}

/** Clusters colinear strokes into merged wall-candidate runs. */
export function clusterColinear(strokes: RawStroke[], opts?: ClusterOpts): ClusteredRun[] {
  const angleTolDeg = opts?.angleTolDeg ?? 2;
  const gapTolPt = opts?.gapTolPt ?? 3;
  const offsetTolPt = opts?.offsetTolPt ?? 1.5;

  const usable = strokes.filter(
    (s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > EPS,
  );

  const clusters: Cluster[] = [];
  for (const s of usable) {
    const fit = clusters.find((c) => strokeFits(c, s, angleTolDeg, gapTolPt, offsetTolPt));
    if (fit) {
      absorbStroke(fit, s);
      continue;
    }
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    const d = { x: (s.b.x - s.a.x) / len, y: (s.b.y - s.a.y) / len };
    clusters.push({
      p0: { x: s.a.x, y: s.a.y },
      d,
      angleDeg: angleDeg180(d.x, d.y),
      tMin: 0,
      tMax: len,
      widthPt: s.widthPt,
      sourceCount: 1,
    });
  }

  // Merge clusters to a fixpoint so chains formed out of input order still join.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        if (clustersFit(clusters[i], clusters[j], angleTolDeg, gapTolPt, offsetTolPt)) {
          absorbCluster(clusters[i], clusters[j]);
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  const runs: ClusteredRun[] = clusters.map((c) => ({
    a: { x: c.p0.x + c.tMin * c.d.x, y: c.p0.y + c.tMin * c.d.y },
    b: { x: c.p0.x + c.tMax * c.d.x, y: c.p0.y + c.tMax * c.d.y },
    widthPt: c.widthPt,
    sourceCount: c.sourceCount,
  }));

  runs.sort((r1, r2) => {
    const len1 = Math.hypot(r1.b.x - r1.a.x, r1.b.y - r1.a.y);
    const len2 = Math.hypot(r2.b.x - r2.a.x, r2.b.y - r2.a.y);
    if (len1 !== len2) return len2 - len1;
    if (r1.a.x !== r2.a.x) return r1.a.x - r2.a.x;
    return r1.a.y - r2.a.y;
  });
  return runs;
}
