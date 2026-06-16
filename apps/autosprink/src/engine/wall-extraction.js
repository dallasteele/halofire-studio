/**
 * wall-extraction.js — reconstruct REAL wall paths from plan ink.
 *
 * Classical line workflow:
 *   1) normalize near-axis-aligned line segments;
 *   2) merge fragmented collinear face lines;
 *   3) pair near-parallel faces into double-line wall strips;
 *   4) join collinear centerline strips into continuous wall paths.
 *
 * The output is wall PATHS backed by real input linework. No bbox wall fabrication.
 * When only one wall face survives, the path is kept as single-face evidence so the
 * caller can still trace the plan ink instead of inventing a box around the footprint.
 */

const DEFAULTS = Object.freeze({
  axisTolFt: 0.04,
  faceCoordTolFt: 0.2,
  faceGapFt: 1.0,
  minFaceRunFt: 2.0,
  minWallThicknessFt: 0.35,
  maxWallThicknessFt: 3.0,
  minOverlapFt: 2.0,
  centerCoordTolFt: 0.35,
  thicknessTolFt: 0.35,
  wallGapFt: 1.0,
  minWallRunFt: 2.0,
  includeSingleFaces: true,
});

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4;
}

function axisOf(seg, axisTolFt) {
  if (!seg || !Array.isArray(seg.a) || !Array.isArray(seg.b)) return null;
  const dx = Number(seg.b[0]) - Number(seg.a[0]);
  const dy = Number(seg.b[1]) - Number(seg.a[1]);
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < axisTolFt && ady < axisTolFt) return null;
  if (adx < axisTolFt) return 'V';
  if (ady < axisTolFt) return 'H';
  return 'D';
}

function normalizeSegments(segments, axisTolFt) {
  const horizontal = [];
  const vertical = [];
  let diagonalDropped = 0;
  let degenerateDropped = 0;
  for (const seg of Array.isArray(segments) ? segments : []) {
    const axis = axisOf(seg, axisTolFt);
    if (axis === 'D') {
      diagonalDropped += 1;
      continue;
    }
    if (!axis) {
      degenerateDropped += 1;
      continue;
    }
    if (axis === 'H') {
      horizontal.push({
        axis,
        coord: (Number(seg.a[1]) + Number(seg.b[1])) / 2,
        lo: Math.min(Number(seg.a[0]), Number(seg.b[0])),
        hi: Math.max(Number(seg.a[0]), Number(seg.b[0])),
      });
    } else {
      vertical.push({
        axis,
        coord: (Number(seg.a[0]) + Number(seg.b[0])) / 2,
        lo: Math.min(Number(seg.a[1]), Number(seg.b[1])),
        hi: Math.max(Number(seg.a[1]), Number(seg.b[1])),
      });
    }
  }
  return { horizontal, vertical, diagonalDropped, degenerateDropped };
}

function mergeFaceRuns(faceSegs, coordTolFt, gapFt, minFaceRunFt) {
  const buckets = new Map();
  for (const seg of faceSegs) {
    const key = Math.round(seg.coord / coordTolFt);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(seg);
  }
  const merged = [];
  for (const segs of buckets.values()) {
    segs.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
    let lo = segs[0].lo;
    let hi = segs[0].hi;
    let coordSum = segs[0].coord;
    let count = 1;
    const flush = () => {
      if (hi - lo >= minFaceRunFt) {
        merged.push({
          axis: segs[0].axis,
          coord: coordSum / count,
          lo,
          hi,
          lengthFt: hi - lo,
        });
      }
    };
    for (let i = 1; i < segs.length; i += 1) {
      const seg = segs[i];
      if (seg.lo <= hi + gapFt) {
        hi = Math.max(hi, seg.hi);
        coordSum += seg.coord;
        count += 1;
        continue;
      }
      flush();
      lo = seg.lo;
      hi = seg.hi;
      coordSum = seg.coord;
      count = 1;
    }
    flush();
  }
  merged.sort((a, b) => a.coord - b.coord || a.lo - b.lo || a.hi - b.hi);
  return merged;
}

function overlapFt(a, b) {
  return Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
}

function buildPairCandidates(faceRuns, opts) {
  const candidates = [];
  for (let i = 0; i < faceRuns.length; i += 1) {
    for (let j = i + 1; j < faceRuns.length; j += 1) {
      const left = faceRuns[i];
      const right = faceRuns[j];
      const separationFt = right.coord - left.coord;
      if (separationFt > opts.maxWallThicknessFt) break;
      if (separationFt < opts.minWallThicknessFt) continue;
      const overlap = overlapFt(left, right);
      if (overlap < opts.minOverlapFt) continue;
      candidates.push({
        i,
        j,
        overlapFt: overlap,
        separationFt,
        score: overlap - separationFt * 0.25,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.overlapFt - a.overlapFt || a.separationFt - b.separationFt);
  return candidates;
}

function pairFaceRuns(faceRuns, opts) {
  const candidates = buildPairCandidates(faceRuns, opts);
  const used = new Set();
  const strips = [];
  for (const candidate of candidates) {
    if (used.has(candidate.i) || used.has(candidate.j)) continue;
    const left = faceRuns[candidate.i];
    const right = faceRuns[candidate.j];
    used.add(candidate.i);
    used.add(candidate.j);
    strips.push({
      axis: left.axis,
      coord: (left.coord + right.coord) / 2,
      lo: Math.max(left.lo, right.lo),
      hi: Math.min(left.hi, right.hi),
      thicknessFt: candidate.separationFt,
      sourceFaces: 2,
      source: 'paired-double-line',
    });
  }
  if (opts.includeSingleFaces) {
    for (let i = 0; i < faceRuns.length; i += 1) {
      if (used.has(i)) continue;
      const run = faceRuns[i];
      strips.push({
        axis: run.axis,
        coord: run.coord,
        lo: run.lo,
        hi: run.hi,
        thicknessFt: null,
        sourceFaces: 1,
        source: 'single-face',
      });
    }
  }
  strips.sort((a, b) => a.coord - b.coord || a.lo - b.lo || a.hi - b.hi);
  return strips;
}

function mergeWallStrips(strips, opts) {
  const groups = [];
  for (const strip of strips) {
    const group = groups.find((g) => (
      g.axis === strip.axis
      && Math.abs(g.coord - strip.coord) <= opts.centerCoordTolFt
      && (
        (g.thicknessFt == null && strip.thicknessFt == null)
        || (g.thicknessFt != null && strip.thicknessFt != null && Math.abs(g.thicknessFt - strip.thicknessFt) <= opts.thicknessTolFt)
      )
    ));
    if (group) {
      group.items.push(strip);
      continue;
    }
    groups.push({
      axis: strip.axis,
      coord: strip.coord,
      thicknessFt: strip.thicknessFt,
      items: [strip],
    });
  }

  const runs = [];
  for (const group of groups) {
    group.items.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
    let lo = group.items[0].lo;
    let hi = group.items[0].hi;
    let coordSum = group.items[0].coord;
    let coordCount = 1;
    let thicknessSum = group.items[0].thicknessFt ?? 0;
    let thicknessCount = group.items[0].thicknessFt == null ? 0 : 1;
    let sourceFaces = group.items[0].sourceFaces;
    let source = group.items[0].source;
    const flush = () => {
      const lengthFt = hi - lo;
      if (lengthFt < opts.minWallRunFt) return;
      const coord = coordSum / coordCount;
      const thicknessFt = thicknessCount > 0 ? thicknessSum / thicknessCount : null;
      runs.push(group.axis === 'H'
        ? {
            a: [round(lo), round(coord)],
            b: [round(hi), round(coord)],
            axis: 'H',
            lengthFt: round(lengthFt),
            ...(thicknessFt != null ? { thicknessFt: round(thicknessFt) } : {}),
            sourceFaces,
            source,
          }
        : {
            a: [round(coord), round(lo)],
            b: [round(coord), round(hi)],
            axis: 'V',
            lengthFt: round(lengthFt),
            ...(thicknessFt != null ? { thicknessFt: round(thicknessFt) } : {}),
            sourceFaces,
            source,
          });
    };
    for (let i = 1; i < group.items.length; i += 1) {
      const strip = group.items[i];
      if (strip.lo <= hi + opts.wallGapFt) {
        hi = Math.max(hi, strip.hi);
        coordSum += strip.coord;
        coordCount += 1;
        if (strip.thicknessFt != null) {
          thicknessSum += strip.thicknessFt;
          thicknessCount += 1;
        }
        sourceFaces = Math.max(sourceFaces, strip.sourceFaces);
        if (source === 'single-face' && strip.source !== 'single-face') source = strip.source;
        continue;
      }
      flush();
      lo = strip.lo;
      hi = strip.hi;
      coordSum = strip.coord;
      coordCount = 1;
      thicknessSum = strip.thicknessFt ?? 0;
      thicknessCount = strip.thicknessFt == null ? 0 : 1;
      sourceFaces = strip.sourceFaces;
      source = strip.source;
    }
    flush();
  }

  runs.sort((a, b) => (a.axis < b.axis ? -1 : a.axis > b.axis ? 1 : 0) || a.a[0] - b.a[0] || a.a[1] - b.a[1]);
  return runs;
}

/**
 * PURE. Extract faithful wall paths from real plan line segments.
 *
 * @param {Array<{a:[number,number], b:[number,number]}>} segments
 * @param {Object} [opts]
 * @returns {{
 *   runs: Array<{a:[number,number], b:[number,number], axis:'H'|'V', lengthFt:number, thicknessFt?:number, sourceFaces:number, source:string}>,
 *   meta: Object
 * }}
 */
export function extractWallRuns(segments, opts = {}) {
  const params = {
    axisTolFt: Number.isFinite(opts.axisTolFt) ? opts.axisTolFt : DEFAULTS.axisTolFt,
    faceCoordTolFt: Number.isFinite(opts.faceCoordTolFt) ? opts.faceCoordTolFt : DEFAULTS.faceCoordTolFt,
    faceGapFt: Number.isFinite(opts.faceGapFt) ? opts.faceGapFt : DEFAULTS.faceGapFt,
    minFaceRunFt: Number.isFinite(opts.minFaceRunFt) ? opts.minFaceRunFt : DEFAULTS.minFaceRunFt,
    minWallThicknessFt: Number.isFinite(opts.minWallThicknessFt) ? opts.minWallThicknessFt : DEFAULTS.minWallThicknessFt,
    maxWallThicknessFt: Number.isFinite(opts.maxWallThicknessFt) ? opts.maxWallThicknessFt : DEFAULTS.maxWallThicknessFt,
    minOverlapFt: Number.isFinite(opts.minOverlapFt) ? opts.minOverlapFt : DEFAULTS.minOverlapFt,
    centerCoordTolFt: Number.isFinite(opts.centerCoordTolFt) ? opts.centerCoordTolFt : DEFAULTS.centerCoordTolFt,
    thicknessTolFt: Number.isFinite(opts.thicknessTolFt) ? opts.thicknessTolFt : DEFAULTS.thicknessTolFt,
    wallGapFt: Number.isFinite(opts.wallGapFt) ? opts.wallGapFt : DEFAULTS.wallGapFt,
    minWallRunFt: Number.isFinite(opts.minWallRunFt) ? opts.minWallRunFt : DEFAULTS.minWallRunFt,
    includeSingleFaces: opts.includeSingleFaces ?? DEFAULTS.includeSingleFaces,
  };

  const normalized = normalizeSegments(segments, params.axisTolFt);
  const horizontalFaces = mergeFaceRuns(normalized.horizontal, params.faceCoordTolFt, params.faceGapFt, params.minFaceRunFt);
  const verticalFaces = mergeFaceRuns(normalized.vertical, params.faceCoordTolFt, params.faceGapFt, params.minFaceRunFt);
  const horizontalStrips = pairFaceRuns(horizontalFaces, params);
  const verticalStrips = pairFaceRuns(verticalFaces, params);
  const runs = mergeWallStrips(horizontalStrips.concat(verticalStrips), params);
  const pairedRuns = runs.filter((run) => run.sourceFaces >= 2).length;
  const singleFaceRuns = runs.filter((run) => run.sourceFaces === 1).length;

  return {
    runs,
    meta: {
      inputSegments: Array.isArray(segments) ? segments.length : 0,
      horizontal: normalized.horizontal.length,
      vertical: normalized.vertical.length,
      diagonalDropped: normalized.diagonalDropped,
      degenerateDropped: normalized.degenerateDropped,
      faceRuns: horizontalFaces.length + verticalFaces.length,
      pairedRuns,
      singleFaceRuns,
      runCount: runs.length,
      totalRunLengthFt: round(runs.reduce((sum, run) => sum + run.lengthFt, 0)),
      params,
      method: 'classical line reconstruction: merge collinear face lines, pair near-parallel faces into double-line walls, join collinear centerline strips into wall paths',
      provenance: 'reconstructed from real plan line segments — needs-verification; wall paths follow observed ink, never a fabricated bbox wall shell.',
      needsVerification: true,
    },
  };
}
