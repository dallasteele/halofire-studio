/**
 * plan-wall-runs.js — reconstruct wall centerlines from real plan ink.
 *
 * Pipeline, all pure and deterministic:
 *   1) classify extracted vector segments by axis, dropping diagonals / degenerate ink;
 *   2) merge collinear fragments on the same ink line into longer single-line runs;
 *   3) pair near-parallel runs into double-line walls using overlap + separation tests;
 *   4) turn each pair into a centerline wall run with the measured wall thickness;
 *   5) keep only unpaired single-line runs that are substantial enough to plausibly be
 *      a wall edge, tagging them as single-edge fallback instead of pretending they were
 *      measured double-line walls;
 *   6) merge collinear centerline runs into the final wall paths the 3D builder extrudes.
 *
 * Honesty: every returned wall path is backed by real vector ink. We never fabricate a bbox
 * shell. Double-line walls carry their measured thickness; single-edge fallback walls carry a
 * conservative default thickness and are explicitly counted in metadata.
 */

const DEFAULTS = Object.freeze({
  axisTolFt: 0.04,
  perpTolFt: 0.25,
  gapFt: 1.0,
  minRunFt: 2.0,
  pairMinSepFt: 0.15,
  pairMaxSepFt: 1.5,
  pairPerpTolFt: 0.25,
  minPairOverlapFt: 3.0,
  minPairOverlapRatio: 0.6,
  fallbackThicknessFt: 0.5,
});

function round(n) { return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4; }

function axisOf(seg, axisTolFt) {
  if (!seg || !Array.isArray(seg.a) || !Array.isArray(seg.b)) return null;
  const dx = seg.b[0] - seg.a[0];
  const dy = seg.b[1] - seg.a[1];
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx < axisTolFt && ady < axisTolFt) return null;
  if (adx < axisTolFt) return 'V';
  if (ady < axisTolFt) return 'H';
  return 'D';
}

function buildSingleLineRuns(segs, axis, perpTolFt, gapFt, minRunFt) {
  if (!segs.length) return { runs: [], shortDropped: 0 };
  const perpVal = axis === 'H' ? (s) => (s.a[1] + s.b[1]) / 2 : (s) => (s.a[0] + s.b[0]) / 2;
  const alongSpan = axis === 'H'
    ? (s) => [Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0])]
    : (s) => [Math.min(s.a[1], s.b[1]), Math.max(s.a[1], s.b[1])];
  const buckets = new Map();
  for (const s of segs) {
    const pv = perpVal(s);
    const key = Math.round(pv / perpTolFt);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { perpSum: 0, n: 0, spans: [] }; buckets.set(key, bucket); }
    bucket.perpSum += pv;
    bucket.n += 1;
    bucket.spans.push(alongSpan(s));
  }
  const runs = [];
  let shortDropped = 0;
  for (const { perpSum, n, spans } of buckets.values()) {
    const coord = perpSum / n;
    spans.sort((a, b) => a[0] - b[0]);
    let [lo, hi] = spans[0];
    const flush = () => {
      const len = hi - lo;
      if (len >= minRunFt) runs.push({ axis, coord, lo, hi, lengthFt: len });
      else shortDropped += 1;
    };
    for (let i = 1; i < spans.length; i++) {
      const [s0, s1] = spans[i];
      if (s0 <= hi + gapFt) hi = Math.max(hi, s1);
      else { flush(); lo = s0; hi = s1; }
    }
    flush();
  }
  return { runs, shortDropped };
}

function overlapStats(a, b) {
  const lo = Math.max(a.lo, b.lo);
  const hi = Math.min(a.hi, b.hi);
  const overlap = hi - lo;
  if (overlap <= 0) return { overlap: 0, lo, hi, ratio: 0 };
  const shorter = Math.min(a.lengthFt, b.lengthFt);
  return { overlap, lo, hi, ratio: shorter > 0 ? overlap / shorter : 0 };
}

function pairParallelRuns(runs, opts) {
  const {
    pairMinSepFt,
    pairMaxSepFt,
    pairPerpTolFt,
    minPairOverlapFt,
    minPairOverlapRatio,
    fallbackThicknessFt,
  } = opts;
  const sorted = [...runs].sort((a, b) => a.coord - b.coord || a.lo - b.lo || a.hi - b.hi);
  const paired = new Set();
  const walls = [];
  let pairCount = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (paired.has(i)) continue;
    const a = sorted[i];
    let bestJ = -1;
    let bestScore = -Infinity;
    let bestSpan = null;
    for (let j = i + 1; j < sorted.length; j++) {
      if (paired.has(j)) continue;
      const b = sorted[j];
      const sep = Math.abs(b.coord - a.coord);
      if (sep > pairMaxSepFt + pairPerpTolFt) break;
      if (sep < pairMinSepFt || sep > pairMaxSepFt) continue;
      const span = overlapStats(a, b);
      if (span.overlap < minPairOverlapFt || span.ratio < minPairOverlapRatio) continue;
      const score = span.overlap - Math.abs(sep - fallbackThicknessFt) * 0.25;
      if (score > bestScore) {
        bestScore = score;
        bestJ = j;
        bestSpan = span;
      }
    }
    if (bestJ >= 0) {
      const b = sorted[bestJ];
      paired.add(i);
      paired.add(bestJ);
      pairCount += 1;
      walls.push({
        axis: a.axis,
        coord: (a.coord + b.coord) / 2,
        lo: bestSpan.lo,
        hi: bestSpan.hi,
        lengthFt: bestSpan.overlap,
        thicknessFt: Math.abs(a.coord - b.coord),
        source: 'double-line-pair',
      });
      continue;
    }
    walls.push({
      axis: a.axis,
      coord: a.coord,
      lo: a.lo,
      hi: a.hi,
      lengthFt: a.lengthFt,
      thicknessFt: fallbackThicknessFt,
      source: 'single-edge-fallback',
    });
  }
  return { walls, pairCount };
}

function mergeCenterlineWalls(walls, axis, perpTolFt, gapFt, minRunFt) {
  if (!walls.length) return [];
  const sorted = [...walls].sort((a, b) => a.coord - b.coord || a.lo - b.lo || a.hi - b.hi);
  const groups = [];
  for (const wall of sorted) {
    const last = groups[groups.length - 1];
    if (
      last &&
      Math.abs(wall.coord - last.coord) <= perpTolFt &&
      Math.abs(wall.thicknessFt - last.thicknessFt) <= perpTolFt &&
      wall.lo <= last.hi + gapFt &&
      wall.source === last.source
    ) {
      last.hi = Math.max(last.hi, wall.hi);
      last.lo = Math.min(last.lo, wall.lo);
      last.coord = (last.coord * last.count + wall.coord) / (last.count + 1);
      last.thicknessFt = (last.thicknessFt * last.count + wall.thicknessFt) / (last.count + 1);
      last.count += 1;
    } else {
      groups.push({ ...wall, count: 1 });
    }
  }
  return groups
    .map((g) => ({ ...g, lengthFt: g.hi - g.lo }))
    .filter((g) => g.lengthFt >= minRunFt)
    .map((g) => ({
      a: axis === 'H' ? [round(g.lo), round(g.coord)] : [round(g.coord), round(g.lo)],
      b: axis === 'H' ? [round(g.hi), round(g.coord)] : [round(g.coord), round(g.hi)],
      axis,
      lengthFt: round(g.lengthFt),
      thicknessFt: round(g.thicknessFt),
      source: g.source,
    }));
}

export function buildWallRuns(walls, opts = {}) {
  const axisTolFt = Number.isFinite(opts.axisTolFt) ? opts.axisTolFt : DEFAULTS.axisTolFt;
  const perpTolFt = Number.isFinite(opts.perpTolFt) ? opts.perpTolFt : DEFAULTS.perpTolFt;
  const gapFt = Number.isFinite(opts.gapFt) ? opts.gapFt : DEFAULTS.gapFt;
  const minRunFt = Number.isFinite(opts.minRunFt) ? opts.minRunFt : DEFAULTS.minRunFt;
  const pairMinSepFt = Number.isFinite(opts.pairMinSepFt) ? opts.pairMinSepFt : DEFAULTS.pairMinSepFt;
  const pairMaxSepFt = Number.isFinite(opts.pairMaxSepFt) ? opts.pairMaxSepFt : DEFAULTS.pairMaxSepFt;
  const pairPerpTolFt = Number.isFinite(opts.pairPerpTolFt) ? opts.pairPerpTolFt : DEFAULTS.pairPerpTolFt;
  const minPairOverlapFt = Number.isFinite(opts.minPairOverlapFt) ? opts.minPairOverlapFt : DEFAULTS.minPairOverlapFt;
  const minPairOverlapRatio = Number.isFinite(opts.minPairOverlapRatio) ? opts.minPairOverlapRatio : DEFAULTS.minPairOverlapRatio;
  const fallbackThicknessFt = Number.isFinite(opts.fallbackThicknessFt) ? opts.fallbackThicknessFt : DEFAULTS.fallbackThicknessFt;

  const input = Array.isArray(walls) ? walls : [];
  const H = [], V = [];
  let diagonalDropped = 0, degenerateDropped = 0;
  for (const s of input) {
    const axis = axisOf(s, axisTolFt);
    if (axis === 'H') H.push(s);
    else if (axis === 'V') V.push(s);
    else if (axis === 'D') diagonalDropped += 1;
    else degenerateDropped += 1;
  }

  const hSingles = buildSingleLineRuns(H, 'H', perpTolFt, gapFt, minRunFt);
  const vSingles = buildSingleLineRuns(V, 'V', perpTolFt, gapFt, minRunFt);

  const hPaired = pairParallelRuns(hSingles.runs, {
    pairMinSepFt,
    pairMaxSepFt,
    pairPerpTolFt,
    minPairOverlapFt,
    minPairOverlapRatio,
    fallbackThicknessFt,
  });
  const vPaired = pairParallelRuns(vSingles.runs, {
    pairMinSepFt,
    pairMaxSepFt,
    pairPerpTolFt,
    minPairOverlapFt,
    minPairOverlapRatio,
    fallbackThicknessFt,
  });

  const runs = [
    ...mergeCenterlineWalls(hPaired.walls, 'H', pairPerpTolFt, gapFt, minRunFt),
    ...mergeCenterlineWalls(vPaired.walls, 'V', pairPerpTolFt, gapFt, minRunFt),
  ].sort((p, q) => (p.axis < q.axis ? -1 : p.axis > q.axis ? 1 : 0) || p.a[0] - q.a[0] || p.a[1] - q.a[1]);

  const doubleLineCount = runs.filter((r) => r.source === 'double-line-pair').length;
  const singleEdgeCount = runs.filter((r) => r.source === 'single-edge-fallback').length;
  const totalRunLengthFt = round(runs.reduce((acc, r) => acc + r.lengthFt, 0));

  return {
    runs,
    meta: {
      inputSegments: input.length,
      horizontal: H.length,
      vertical: V.length,
      diagonalDropped,
      degenerateDropped,
      shortRunsDropped: hSingles.shortDropped + vSingles.shortDropped,
      singleLineRuns: hSingles.runs.length + vSingles.runs.length,
      doubleLinePairs: hPaired.pairCount + vPaired.pairCount,
      doubleLineWalls: doubleLineCount,
      singleEdgeWalls: singleEdgeCount,
      runCount: runs.length,
      totalRunLengthFt,
      params: {
        axisTolFt,
        perpTolFt,
        gapFt,
        minRunFt,
        pairMinSepFt,
        pairMaxSepFt,
        pairPerpTolFt,
        minPairOverlapFt,
        minPairOverlapRatio,
        fallbackThicknessFt,
      },
      method:
        'classical wall reconstruction from real vector linework: axis classify -> collinear line merge -> near-parallel double-line pairing -> centerline wall-path merge; diagonals and sub-min runs dropped',
      provenance:
        'reconstructed wall paths from real vector cut-wall segments — needs-verification; NOT AHJ/PE/manufacturer-exact/AutoSprink-parity. Double-line walls carry measured thickness; fallback single-edge walls remain explicitly tagged.',
      needsVerification: true,
    },
  };
}
