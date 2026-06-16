/**
 * plan-wall-runs.js — RECORE: collapse the fragmented single-band wall SEGMENTS into real
 * wall RUNS, with explicit NON-WALL exclusion, so the extracted "structure" is a plausible
 * count of ACTUAL walls (the envelope + partitions) instead of tens of thousands of ink
 * fragments / dimension / grid / hatch lines.
 *
 * WHY THIS EXISTS (the RECORE failure it fixes):
 *   The prior pipeline rendered `wallsFull` — the UNION of every heavier-than-baseline
 *   lineweight band (41,784 segments for A-101 L1). That union sweeps in dimension strings,
 *   extension lines, grid lines, dashed match-lines, door-swing arcs, furniture and tread
 *   hatch — none of which are walls. A "coverage %" gate passed it because it only asked
 *   "is this pixel covered?", never "is this actually a wall?". Precision was garbage.
 *
 *   Even the cleaner single-band `walls` set (6,858 segs) is FRAGMENTED: a single wall is
 *   drawn as dozens of short collinear pieces (median piece ~1.3 ft). Extruding each piece
 *   makes thousands of stub boxes, not walls.
 *
 * WHAT THIS DOES (pure, deterministic, honest):
 *   1) DROP diagonal segments (door-swing arcs are flattened to short diagonals; true cut
 *      walls on this orthogonal building are axis-aligned). Diagonals are flagged-dropped,
 *      counted, NOT silently discarded.
 *   2) For the surviving horizontal + vertical segments, bucket COLLINEAR pieces (same
 *      perpendicular coordinate within perpTolFt) and MERGE pieces that overlap or are within
 *      gapFt along the line into one continuous RUN.
 *   3) DROP runs shorter than minRunFt (sub-wall stubs: leftover dimension ticks, glyph
 *      strokes), counted as excluded.
 *   The result is a set of axis-aligned wall RUNS {a:[x,y], b:[x,y], axis, lengthFt} in the
 *   SAME plan-feet frame as the input — a plausible building envelope + partition set.
 *
 * HONESTY: this is a geometric reconstruction of walls from vector linework. It is
 * needs-verification — NOT an AHJ/PE/manufacturer-exact/AutoSprink-parity wall model. It
 * does not invent walls: every run is backed by real input segments. Non-wall ink is
 * EXCLUDED, never re-labeled. The excluded counts are reported so the exclusion is auditable.
 */

const DEFAULTS = Object.freeze({
  axisTolFt: 0.04,   // |dx| or |dy| below this => treat the segment as axis-aligned on that axis
  perpTolFt: 0.25,   // collinear pieces share a perpendicular coordinate within this band
  gapFt: 1.0,        // merge pieces whose along-axis gap is <= this (bridges hairline breaks)
  minRunFt: 2.0,     // drop runs shorter than a real wall stub (sub-2ft = dimension tick / glyph)
  pairParallelMinFt: 0.15,  // minimum face-to-face spacing to consider a double-line wall
  pairParallelMaxFt: 1.5,   // maximum face-to-face spacing for double-line pairing
  minPairOverlapFt: 4.0,    // minimum shared span before two faces can become one centerline wall
  minPairOverlapRatio: 0.6, // the overlap must cover most of the shorter face
});

function round(n) { return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4; }

function runCoord(run) { return run.axis === 'H' ? run.a[1] : run.a[0]; }

function runSpan(run) {
  return run.axis === 'H'
    ? [Math.min(run.a[0], run.b[0]), Math.max(run.a[0], run.b[0])]
    : [Math.min(run.a[1], run.b[1]), Math.max(run.a[1], run.b[1])];
}

function overlapSpan(a, b) {
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return hi > lo ? [lo, hi] : null;
}

function spanLen(span) { return Math.max(0, span[1] - span[0]); }

function toRun(axis, coord, lo, hi, extra = {}) {
  return axis === 'H'
    ? { a: [round(lo), round(coord)], b: [round(hi), round(coord)], axis, lengthFt: round(hi - lo), ...extra }
    : { a: [round(coord), round(lo)], b: [round(coord), round(hi)], axis, lengthFt: round(hi - lo), ...extra };
}

/** Classify a segment {a,b} as 'H' (horizontal), 'V' (vertical), 'D' (diagonal), or null (degenerate). */
function axisOf(seg, axisTolFt) {
  if (!seg || !Array.isArray(seg.a) || !Array.isArray(seg.b)) return null;
  const dx = seg.b[0] - seg.a[0];
  const dy = seg.b[1] - seg.a[1];
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx < axisTolFt && ady < axisTolFt) return null; // zero-length / point
  if (adx < axisTolFt) return 'V';
  if (ady < axisTolFt) return 'H';
  return 'D';
}

/**
 * Merge the collinear pieces of one axis ('H' or 'V') into runs.
 * For 'H': perpendicular coord = Y (bucketed), along axis = X. For 'V': perp = X, along = Y.
 * @returns {Array<{coord:number, lo:number, hi:number}>}
 */
function mergeAxisRuns(segs, axis, perpTolFt, gapFt, minRunFt) {
  const perpVal = axis === 'H' ? (s) => (s.a[1] + s.b[1]) / 2 : (s) => (s.a[0] + s.b[0]) / 2;
  const alongSpan = axis === 'H'
    ? (s) => [Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0])]
    : (s) => [Math.min(s.a[1], s.b[1]), Math.max(s.a[1], s.b[1])];
  // Bucket by perpendicular coordinate, snapped to a perpTolFt grid so collinear pieces group.
  const buckets = new Map();
  for (const s of segs) {
    const k = Math.round(perpVal(s) / perpTolFt);
    let arr = buckets.get(k);
    if (!arr) { arr = { perpSum: 0, n: 0, spans: [] }; buckets.set(k, arr); }
    arr.perpSum += perpVal(s); arr.n += 1; arr.spans.push(alongSpan(s));
  }
  const runs = [];
  for (const { perpSum, n, spans } of buckets.values()) {
    const coord = perpSum / n; // mean perpendicular coord of pieces in this bucket
    spans.sort((a, b) => a[0] - b[0]);
    let [lo, hi] = spans[0];
    const flush = () => { if (hi - lo >= minRunFt) runs.push({ coord, lo, hi }); };
    for (let i = 1; i < spans.length; i++) {
      const [s0, s1] = spans[i];
      if (s0 <= hi + gapFt) { if (s1 > hi) hi = s1; }
      else { flush(); lo = s0; hi = s1; }
    }
    flush();
  }
  return runs;
}

/**
 * PURE. Merge fragmented wall segments into wall RUNS, excluding non-wall ink.
 *
 * @param {Array<{a:[number,number], b:[number,number]}>} walls - single-band wall segments (FEET).
 * @param {Object} [opts] - axisTolFt, perpTolFt, gapFt, minRunFt (see DEFAULTS).
 * @returns {{
 *   runs: Array<{a:[number,number], b:[number,number], axis:'H'|'V', lengthFt:number}>,
 *   meta: { inputSegments, horizontal, vertical, diagonalDropped, degenerateDropped,
 *           shortRunsDropped, runCount, totalRunLengthFt, params, method, provenance, needsVerification }
 * }}
 */
export function buildWallRuns(walls, opts = {}) {
  const axisTolFt = Number.isFinite(opts.axisTolFt) ? opts.axisTolFt : DEFAULTS.axisTolFt;
  const perpTolFt = Number.isFinite(opts.perpTolFt) ? opts.perpTolFt : DEFAULTS.perpTolFt;
  const gapFt = Number.isFinite(opts.gapFt) ? opts.gapFt : DEFAULTS.gapFt;
  const minRunFt = Number.isFinite(opts.minRunFt) ? opts.minRunFt : DEFAULTS.minRunFt;

  const input = Array.isArray(walls) ? walls : [];
  const H = [], V = [];
  let diagonalDropped = 0, degenerateDropped = 0;
  for (const s of input) {
    const a = axisOf(s, axisTolFt);
    if (a === 'H') H.push(s);
    else if (a === 'V') V.push(s);
    else if (a === 'D') diagonalDropped += 1;
    else degenerateDropped += 1;
  }

  // Count short-run drops by measuring before/after the minRunFt gate (re-run with min 0).
  const hRunsAll = mergeAxisRuns(H, 'H', perpTolFt, gapFt, 0);
  const vRunsAll = mergeAxisRuns(V, 'V', perpTolFt, gapFt, 0);
  const hRuns = hRunsAll.filter((r) => r.hi - r.lo >= minRunFt);
  const vRuns = vRunsAll.filter((r) => r.hi - r.lo >= minRunFt);
  const shortRunsDropped = (hRunsAll.length - hRuns.length) + (vRunsAll.length - vRuns.length);

  const runs = [];
  for (const r of hRuns) {
    runs.push({ a: [round(r.lo), round(r.coord)], b: [round(r.hi), round(r.coord)], axis: 'H', lengthFt: round(r.hi - r.lo) });
  }
  for (const r of vRuns) {
    runs.push({ a: [round(r.coord), round(r.lo)], b: [round(r.coord), round(r.hi)], axis: 'V', lengthFt: round(r.hi - r.lo) });
  }
  // Deterministic order: by axis, then position.
  runs.sort((p, q) => (p.axis < q.axis ? -1 : p.axis > q.axis ? 1 : 0) || p.a[0] - q.a[0] || p.a[1] - q.a[1]);

  const totalRunLengthFt = round(runs.reduce((acc, r) => acc + r.lengthFt, 0));
  return {
    runs,
    meta: {
      inputSegments: input.length,
      horizontal: H.length,
      vertical: V.length,
      diagonalDropped,
      degenerateDropped,
      shortRunsDropped,
      runCount: runs.length,
      totalRunLengthFt,
      params: { axisTolFt, perpTolFt, gapFt, minRunFt },
      method: 'collinear-merge of single-band cut-wall segments into axis-aligned wall RUNS; ' +
        'diagonals (door-swing arcs/hatch) dropped, sub-minRunFt stubs (dimension ticks/glyphs) dropped',
      provenance: 'reconstructed wall runs from real vector cut-wall segments — needs-verification; ' +
        'NOT AHJ/PE/manufacturer-exact/AutoSprink-parity. Non-wall ink EXCLUDED, never re-labeled.',
      needsVerification: true,
    },
  };
}

/**
 * PURE. Pair near-parallel wall faces into centerline wall paths.
 *
 * This is the next deterministic step after buildWallRuns: the raw linework often
 * contains BOTH faces of a double-line wall. This reducer pairs those faces when
 * they are close, parallel, and substantially overlapping, then emits a centerline
 * run carrying the observed wall thickness. Unpaired runs are preserved so the
 * algorithm never fabricates missing walls.
 *
 * @param {Array<{a:[number,number], b:[number,number], axis:'H'|'V', lengthFt:number}>} runs
 * @param {Object} [opts]
 * @returns {{
 *   runs: Array<{a:[number,number], b:[number,number], axis:'H'|'V', lengthFt:number, thicknessFt?:number, source:string}>,
 *   meta: { inputRuns:number, pairedRuns:number, preservedSingles:number, pairCandidates:number, params:object, needsVerification:true }
 * }}
 */
export function pairParallelWallRuns(runs, opts = {}) {
  const pairParallelMinFt = Number.isFinite(opts.pairParallelMinFt) ? opts.pairParallelMinFt : DEFAULTS.pairParallelMinFt;
  const pairParallelMaxFt = Number.isFinite(opts.pairParallelMaxFt) ? opts.pairParallelMaxFt : DEFAULTS.pairParallelMaxFt;
  const minPairOverlapFt = Number.isFinite(opts.minPairOverlapFt) ? opts.minPairOverlapFt : DEFAULTS.minPairOverlapFt;
  const minPairOverlapRatio = Number.isFinite(opts.minPairOverlapRatio) ? opts.minPairOverlapRatio : DEFAULTS.minPairOverlapRatio;
  const gapFt = Number.isFinite(opts.gapFt) ? opts.gapFt : DEFAULTS.gapFt;
  const minRunFt = Number.isFinite(opts.minRunFt) ? opts.minRunFt : DEFAULTS.minRunFt;

  const input = Array.isArray(runs) ? runs.filter((run) => run && (run.axis === 'H' || run.axis === 'V')) : [];
  const used = new Set();
  const out = [];
  let pairCandidates = 0;
  let pairedRuns = 0;

  for (const axis of ['H', 'V']) {
    const axisRuns = input
      .map((run, index) => ({ run, index }))
      .filter((item) => item.run.axis === axis)
      .sort((a, b) => runCoord(a.run) - runCoord(b.run) || runSpan(a.run)[0] - runSpan(b.run)[0]);

    for (let i = 0; i < axisRuns.length; i += 1) {
      const left = axisRuns[i];
      if (used.has(left.index)) continue;
      const leftCoord = runCoord(left.run);
      const leftSpan = runSpan(left.run);
      let best = null;
      for (let j = i + 1; j < axisRuns.length; j += 1) {
        const right = axisRuns[j];
        if (used.has(right.index)) continue;
        const spacing = runCoord(right.run) - leftCoord;
        if (spacing > pairParallelMaxFt) break;
        if (spacing < pairParallelMinFt) continue;
        const rightSpan = runSpan(right.run);
        const overlap = overlapSpan(leftSpan, rightSpan);
        if (!overlap) continue;
        const overlapFt = spanLen(overlap);
        const shorterFt = Math.min(left.run.lengthFt, right.run.lengthFt);
        const overlapRatio = shorterFt > 0 ? overlapFt / shorterFt : 0;
        if (overlapFt < minPairOverlapFt || overlapRatio < minPairOverlapRatio) continue;
        pairCandidates += 1;
        const score = overlapFt - (spacing * 0.01);
        if (!best || score > best.score) {
          best = { right, spacing, overlap, score };
        }
      }
      if (!best) continue;
      used.add(left.index);
      used.add(best.right.index);
      pairedRuns += 1;
      const centerCoord = (leftCoord + runCoord(best.right.run)) / 2;
      out.push(toRun(axis, centerCoord, best.overlap[0], best.overlap[1], {
        thicknessFt: round(best.spacing),
        source: 'double-line-pair',
      }));
    }
  }

  for (let i = 0; i < input.length; i += 1) {
    if (used.has(i)) continue;
    const run = input[i];
    const span = runSpan(run);
    out.push(toRun(run.axis, runCoord(run), span[0], span[1], {
      ...(Number.isFinite(run.thicknessFt) ? { thicknessFt: run.thicknessFt } : {}),
      source: 'single-line',
    }));
  }

  const rematerialized = out.map((run) => ({ a: run.a, b: run.b }));
  const merged = buildWallRuns(rematerialized, { gapFt, minRunFt, axisTolFt: DEFAULTS.axisTolFt, perpTolFt: DEFAULTS.perpTolFt }).runs;
  const thicknessByKey = new Map();
  for (const run of out) {
    const key = `${run.axis}:${run.a[0]}:${run.a[1]}:${run.b[0]}:${run.b[1]}`;
    thicknessByKey.set(key, run);
  }
  const mergedWithMeta = merged.map((run) => {
    const key = `${run.axis}:${run.a[0]}:${run.a[1]}:${run.b[0]}:${run.b[1]}`;
    const original = thicknessByKey.get(key);
    return {
      ...run,
      ...(original && Number.isFinite(original.thicknessFt) ? { thicknessFt: original.thicknessFt } : {}),
      source: (original && original.source) || 'single-line',
    };
  });

  return {
    runs: mergedWithMeta,
    meta: {
      inputRuns: input.length,
      pairedRuns,
      preservedSingles: input.length - (pairedRuns * 2),
      pairCandidates,
      params: { pairParallelMinFt, pairParallelMaxFt, minPairOverlapFt, minPairOverlapRatio, gapFt, minRunFt },
      needsVerification: true,
    },
  };
}

/**
 * PURE. Convenience extractor for sample vectors -> merged centerline wall paths.
 *
 * @param {Array<{a:[number,number], b:[number,number]}>} walls
 * @param {Object} [opts]
 * @returns {{
 *   runs: Array<{a:[number,number], b:[number,number], axis:'H'|'V', lengthFt:number, thicknessFt?:number, source:string}>,
 *   meta: { build:object, pair:object, needsVerification:true }
 * }}
 */
export function extractWallCenterlines(walls, opts = {}) {
  const build = buildWallRuns(walls, opts);
  const pair = pairParallelWallRuns(build.runs, opts);
  return {
    runs: pair.runs,
    meta: {
      build: build.meta,
      pair: pair.meta,
      needsVerification: true,
    },
  };
}
