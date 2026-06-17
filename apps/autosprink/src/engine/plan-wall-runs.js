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
  orphanTolFt: 3.0,  // drop isolated runs whose endpoints connect to no other run within this radius
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

function hasNearbyEndpoint(runs, runIndex, endpoint, orphanTolFt) {
  for (let i = 0; i < runs.length; i++) {
    if (i === runIndex) continue;
    const other = runs[i];
    const da = Math.hypot(endpoint[0] - other.a[0], endpoint[1] - other.a[1]);
    if (da <= orphanTolFt) return true;
    const db = Math.hypot(endpoint[0] - other.b[0], endpoint[1] - other.b[1]);
    if (db <= orphanTolFt) return true;
  }
  return false;
}

function dropOrphanRuns(runs, orphanTolFt) {
  if (!(orphanTolFt > 0) || runs.length <= 1) return { runs, orphanRunsDropped: 0 };
  const kept = [];
  let orphanRunsDropped = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const keep = hasNearbyEndpoint(runs, i, run.a, orphanTolFt) || hasNearbyEndpoint(runs, i, run.b, orphanTolFt);
    if (keep) kept.push(run);
    else orphanRunsDropped += 1;
  }
  return { runs: kept, orphanRunsDropped };
}

/**
 * PURE. Merge fragmented wall segments into wall RUNS, excluding non-wall ink.
 *
 * @param {Array<{a:[number,number], b:[number,number]}>} walls - single-band wall segments (FEET).
 * @param {Object} [opts] - axisTolFt, perpTolFt, gapFt, minRunFt (see DEFAULTS).
 * @returns {{
 *   runs: Array<{a:[number,number], b:[number,number], axis:'H'|'V', lengthFt:number}>,
 *   meta: { inputSegments, horizontal, vertical, diagonalDropped, degenerateDropped,
 *           shortRunsDropped, orphanRunsDropped, runCount, totalRunLengthFt, params, method, provenance, needsVerification }
 * }}
 */
export function buildWallRuns(walls, opts = {}) {
  const axisTolFt = Number.isFinite(opts.axisTolFt) ? opts.axisTolFt : DEFAULTS.axisTolFt;
  const perpTolFt = Number.isFinite(opts.perpTolFt) ? opts.perpTolFt : DEFAULTS.perpTolFt;
  const gapFt = Number.isFinite(opts.gapFt) ? opts.gapFt : DEFAULTS.gapFt;
  const minRunFt = Number.isFinite(opts.minRunFt) ? opts.minRunFt : DEFAULTS.minRunFt;
  const orphanTolFt = Number.isFinite(opts.orphanTolFt) ? opts.orphanTolFt : DEFAULTS.orphanTolFt;

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
  const orphanFiltered = dropOrphanRuns(runs, orphanTolFt);
  const finalRuns = orphanFiltered.runs;
  // Deterministic order: by axis, then position.
  finalRuns.sort((p, q) => (p.axis < q.axis ? -1 : p.axis > q.axis ? 1 : 0) || p.a[0] - q.a[0] || p.a[1] - q.a[1]);

  const totalRunLengthFt = round(finalRuns.reduce((acc, r) => acc + r.lengthFt, 0));
  return {
    runs: finalRuns,
    meta: {
      inputSegments: input.length,
      horizontal: H.length,
      vertical: V.length,
      diagonalDropped,
      degenerateDropped,
      shortRunsDropped,
      orphanRunsDropped: orphanFiltered.orphanRunsDropped,
      runCount: finalRuns.length,
      totalRunLengthFt,
      params: { axisTolFt, perpTolFt, gapFt, minRunFt, orphanTolFt },
      method: 'collinear-merge of single-band cut-wall segments into axis-aligned wall RUNS; ' +
        'diagonals (door-swing arcs/hatch) dropped, sub-minRunFt stubs (dimension ticks/glyphs) dropped, ' +
        'isolated orphan runs with no endpoint connection within orphanTolFt dropped',
      provenance: 'reconstructed wall runs from real vector cut-wall segments — needs-verification; ' +
        'NOT AHJ/PE/manufacturer-exact/AutoSprink-parity. Non-wall ink EXCLUDED, never re-labeled.',
      needsVerification: true,
    },
  };
}
