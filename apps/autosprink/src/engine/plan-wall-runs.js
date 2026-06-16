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
  pairParallelMinFt: 0.5, // observed wall face separation lower bound
  pairParallelMaxFt: 1.5, // observed wall face separation upper bound
  minPairOverlapFt: 4.0,  // paired faces must overlap enough to be a real shared wall span
  minPairOverlapRatio: 0.8, // reject offset/nearby lines that only graze each other
});

function round(n) { return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4; }

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

function cloneRun(run, extra = {}) {
  return {
    a: [run.a[0], run.a[1]],
    b: [run.b[0], run.b[1]],
    axis: run.axis,
    lengthFt: run.lengthFt,
    ...extra,
  };
}

function runCoord(run) {
  return run.axis === 'H' ? run.a[1] : run.a[0];
}

function runSpan(run) {
  return run.axis === 'H'
    ? [Math.min(run.a[0], run.b[0]), Math.max(run.a[0], run.b[0])]
    : [Math.min(run.a[1], run.b[1]), Math.max(run.a[1], run.b[1])];
}

function normalizePairOpts(opts = {}) {
  return {
    gapFt: Number.isFinite(opts.gapFt) ? opts.gapFt : DEFAULTS.gapFt,
    minRunFt: Number.isFinite(opts.minRunFt) ? opts.minRunFt : DEFAULTS.minRunFt,
    pairParallelMinFt: Number.isFinite(opts.pairParallelMinFt) ? opts.pairParallelMinFt : DEFAULTS.pairParallelMinFt,
    pairParallelMaxFt: Number.isFinite(opts.pairParallelMaxFt) ? opts.pairParallelMaxFt : DEFAULTS.pairParallelMaxFt,
    minPairOverlapFt: Number.isFinite(opts.minPairOverlapFt) ? opts.minPairOverlapFt : DEFAULTS.minPairOverlapFt,
    minPairOverlapRatio: Number.isFinite(opts.minPairOverlapRatio) ? opts.minPairOverlapRatio : DEFAULTS.minPairOverlapRatio,
  };
}

function mergeCenterlinePathRuns(runs, opts) {
  const buckets = new Map();
  for (const run of runs) {
    const key = `${run.axis}:${round(runCoord(run))}:${run.source || 'unknown'}:${round(run.thicknessFt || 0)}`;
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(run);
  }

  const merged = [];
  for (const arr of buckets.values()) {
    arr.sort((a, b) => runSpan(a)[0] - runSpan(b)[0] || runSpan(a)[1] - runSpan(b)[1]);
    let current = null;
    const flush = () => {
      if (!current) return;
      if (current.hi - current.lo < opts.minRunFt) return;
      if (current.axis === 'H') {
        merged.push({
          a: [round(current.lo), round(current.coord)],
          b: [round(current.hi), round(current.coord)],
          axis: 'H',
          lengthFt: round(current.hi - current.lo),
          source: current.source,
          ...(current.thicknessFt != null ? { thicknessFt: round(current.thicknessFt) } : {}),
        });
      } else {
        merged.push({
          a: [round(current.coord), round(current.lo)],
          b: [round(current.coord), round(current.hi)],
          axis: 'V',
          lengthFt: round(current.hi - current.lo),
          source: current.source,
          ...(current.thicknessFt != null ? { thicknessFt: round(current.thicknessFt) } : {}),
        });
      }
    };

    for (const run of arr) {
      const [lo, hi] = runSpan(run);
      const coord = runCoord(run);
      if (!current) {
        current = {
          axis: run.axis,
          coord,
          lo,
          hi,
          source: run.source,
          thicknessFt: run.thicknessFt,
        };
        continue;
      }
      if (lo <= current.hi + opts.gapFt) {
        current.hi = Math.max(current.hi, hi);
      } else {
        flush();
        current = {
          axis: run.axis,
          coord,
          lo,
          hi,
          source: run.source,
          thicknessFt: run.thicknessFt,
        };
      }
    }
    flush();
  }

  merged.sort((a, b) => (a.axis < b.axis ? -1 : a.axis > b.axis ? 1 : 0) || a.a[0] - b.a[0] || a.a[1] - b.a[1]);
  return merged;
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
 * PURE. Label merged single-edge wall paths from axis-aligned wall segments.
 * This does not invent centerlines; it just tags the observed merged edge paths.
 */
export function extractWallCenterlines(walls, opts = {}) {
  const built = buildWallRuns(walls, opts);
  const params = normalizePairOpts(opts);
  const singleLineRuns = built.runs.map((run) => cloneRun(run, { source: 'single-line' }));
  const paired = pairParallelWallRuns(singleLineRuns, params);
  return {
    runs: paired.runs,
    meta: {
      build: built.meta,
      pair: paired.meta,
      method: 'buildWallRuns axis merge + optional near-parallel pairing into wall paths',
      needsVerification: true,
    },
  };
}

/**
 * PURE. Pair near-parallel merged runs into one wall centerline when two observed faces
 * overlap enough to plausibly be the same double-line wall. Unpaired runs are preserved.
 */
export function pairParallelWallRuns(runs, opts = {}) {
  const params = normalizePairOpts(opts);
  const input = Array.isArray(runs) ? runs.filter((run) => run && (run.axis === 'H' || run.axis === 'V')) : [];
  const grouped = new Map();
  for (const run of input) {
    let arr = grouped.get(run.axis);
    if (!arr) {
      arr = [];
      grouped.set(run.axis, arr);
    }
    arr.push(run);
  }

  const derived = [];
  let pairedRuns = 0;
  let singleLineFallbacks = 0;

  for (const axis of ['H', 'V']) {
    const axisRuns = grouped.get(axis) || [];
    axisRuns.sort((a, b) => runCoord(a) - runCoord(b) || runSpan(a)[0] - runSpan(b)[0]);
    const used = new Set();
    const candidates = [];

    for (let i = 0; i < axisRuns.length; i += 1) {
      for (let j = i + 1; j < axisRuns.length; j += 1) {
        const a = axisRuns[i];
        const b = axisRuns[j];
        const sep = Math.abs(runCoord(a) - runCoord(b));
        if (sep < params.pairParallelMinFt || sep > params.pairParallelMaxFt) continue;
        const [aLo, aHi] = runSpan(a);
        const [bLo, bHi] = runSpan(b);
        const overlapLo = Math.max(aLo, bLo);
        const overlapHi = Math.min(aHi, bHi);
        const overlapFt = overlapHi - overlapLo;
        if (overlapFt < params.minPairOverlapFt) continue;
        const overlapRatio = overlapFt / Math.min(a.lengthFt, b.lengthFt);
        if (overlapRatio < params.minPairOverlapRatio) continue;
        candidates.push({
          i,
          j,
          sep,
          overlapLo,
          overlapHi,
          overlapFt,
          overlapRatio,
          score: overlapFt - sep,
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score || b.overlapRatio - a.overlapRatio || a.sep - b.sep || a.i - b.i || a.j - b.j);

    for (const cand of candidates) {
      if (used.has(cand.i) || used.has(cand.j)) continue;
      const a = axisRuns[cand.i];
      const b = axisRuns[cand.j];
      used.add(cand.i);
      used.add(cand.j);
      pairedRuns += 1;
      const centerCoord = round((runCoord(a) + runCoord(b)) / 2);
      const thicknessFt = round(Math.abs(runCoord(a) - runCoord(b)));
      if (axis === 'H') {
        derived.push({
          a: [round(cand.overlapLo), centerCoord],
          b: [round(cand.overlapHi), centerCoord],
          axis: 'H',
          lengthFt: round(cand.overlapFt),
          thicknessFt,
          source: 'double-line-pair',
        });
      } else {
        derived.push({
          a: [centerCoord, round(cand.overlapLo)],
          b: [centerCoord, round(cand.overlapHi)],
          axis: 'V',
          lengthFt: round(cand.overlapFt),
          thicknessFt,
          source: 'double-line-pair',
        });
      }
    }

    for (let i = 0; i < axisRuns.length; i += 1) {
      if (used.has(i)) continue;
      singleLineFallbacks += 1;
      derived.push(cloneRun(axisRuns[i], { source: axisRuns[i].source || 'single-line' }));
    }
  }

  const mergedRuns = mergeCenterlinePathRuns(derived, params);
  return {
    runs: mergedRuns,
    meta: {
      inputRuns: input.length,
      pairedRuns,
      singleLineFallbacks,
      params,
      method: 'pair near-parallel merged wall-face runs into centerline wall paths when overlap and thickness are plausible',
      provenance: 'paired runs trace observed double-line walls only; unmatched runs remain backed by single observed edges. needs-verification.',
      needsVerification: true,
    },
  };
}
