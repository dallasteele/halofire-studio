import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWallRuns,
  extractWallCenterlines,
  pairParallelWallRuns,
} from '../plan-wall-runs.js';

test('extractWallCenterlines merges fragmented single-line segments into one wall run', () => {
  const segments = [
    { a: [0, 10], b: [6, 10] },
    { a: [6.4, 10], b: [12, 10] },
    { a: [12.2, 10], b: [18, 10] },
  ];

  const result = extractWallCenterlines(segments, { gapFt: 0.5, minRunFt: 2 });
  assert.equal(result.runs.length, 1);
  assert.deepEqual(result.runs[0], {
    a: [0, 10],
    b: [18, 10],
    axis: 'H',
    lengthFt: 18,
    source: 'single-line',
  });
});

test('pairParallelWallRuns converts two near-parallel faces into one centerline wall path', () => {
  const segments = [
    { a: [0, 10], b: [20, 10] },
    { a: [0, 11], b: [20, 11] },
    { a: [24, 10], b: [30, 10] },
    { a: [24, 11], b: [30, 11] },
  ];

  const base = buildWallRuns(segments, { gapFt: 0.5, minRunFt: 2 });
  const taggedRuns = base.runs.map((run) => ({ ...run, source: 'single-line' }));
  const result = pairParallelWallRuns(taggedRuns, {
    pairParallelMinFt: 0.5,
    pairParallelMaxFt: 1.5,
    minPairOverlapFt: 4,
    minPairOverlapRatio: 0.9,
    gapFt: 0.5,
    minRunFt: 2,
  });

  assert.equal(result.runs.length, 2);
  assert.deepEqual(result.runs[0], {
    a: [0, 10.5],
    b: [20, 10.5],
    axis: 'H',
    lengthFt: 20,
    thicknessFt: 1,
    source: 'double-line-pair',
  });
  assert.deepEqual(result.runs[1], {
    a: [24, 10.5],
    b: [30, 10.5],
    axis: 'H',
    lengthFt: 6,
    thicknessFt: 1,
    source: 'double-line-pair',
  });
  assert.equal(result.meta.pairedRuns, 2);
});

test('pairParallelWallRuns preserves offset walls when overlap is too small to be one wall', () => {
  const segments = [
    { a: [0, 0], b: [8, 0] },
    { a: [10, 1], b: [18, 1] },
  ];

  const result = extractWallCenterlines(segments, {
    pairParallelMinFt: 0.5,
    pairParallelMaxFt: 1.5,
    minPairOverlapFt: 4,
    minPairOverlapRatio: 0.8,
  });

  assert.equal(result.runs.length, 2);
  assert.equal(result.runs[0].source, 'single-line');
  assert.equal(result.runs[1].source, 'single-line');
});

test('extractWallCenterlines drops diagonals and sub-wall stubs from sample CV segments', () => {
  const segments = [
    { a: [0, 0], b: [12, 0] },
    { a: [12.2, 0], b: [24, 0] },
    { a: [5, 5], b: [6, 5] },
    { a: [10, 10], b: [12, 12] },
  ];

  const result = extractWallCenterlines(segments, { gapFt: 0.5, minRunFt: 2 });
  assert.equal(result.runs.length, 1);
  assert.deepEqual(result.runs[0], {
    a: [0, 0],
    b: [24, 0],
    axis: 'H',
    lengthFt: 24,
    source: 'single-line',
  });
  assert.equal(result.meta.build.diagonalDropped, 1);
  assert.equal(result.meta.build.shortRunsDropped, 1);
});
