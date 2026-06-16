import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWallRuns } from '../plan-wall-runs.js';

function seg(a, b) {
  return { a, b };
}

test('buildWallRuns pairs double-line wall ink and merges collinear centerlines into wall paths', () => {
  const segments = [
    seg([0, 10], [4, 10]),
    seg([4.2, 10], [8.1, 10]),
    seg([8.3, 10], [12, 10]),
    seg([0.1, 10.5], [3.9, 10.5]),
    seg([4, 10.5], [8, 10.5]),
    seg([8.2, 10.5], [12.2, 10.5]),

    seg([20, 0], [20, 4.1]),
    seg([20, 4.4], [20, 8.2]),
    seg([20, 8.4], [20, 12]),
    seg([20.6, 0.1], [20.6, 4]),
    seg([20.6, 4.3], [20.6, 8.1]),
    seg([20.6, 8.3], [20.6, 12.2]),

    seg([30, 30], [36, 30]),

    seg([50, 50], [50.7, 50.7]),
    seg([60, 60], [61, 60]),
  ];

  const { runs, meta } = buildWallRuns(segments, {
    gapFt: 0.5,
    pairMaxSepFt: 1,
    minPairOverlapFt: 3,
    minRunFt: 2,
    fallbackThicknessFt: 0.5,
  });

  assert.equal(runs.length, 3);
  assert.deepEqual(runs, [
    {
      a: [0.1, 10.25],
      b: [12, 10.25],
      axis: 'H',
      lengthFt: 11.9,
      thicknessFt: 0.5,
      source: 'double-line-pair',
    },
    {
      a: [30, 30],
      b: [36, 30],
      axis: 'H',
      lengthFt: 6,
      thicknessFt: 0.5,
      source: 'single-edge-fallback',
    },
    {
      a: [20.3, 0.1],
      b: [20.3, 12],
      axis: 'V',
      lengthFt: 11.9,
      thicknessFt: 0.6,
      source: 'double-line-pair',
    },
  ]);

  assert.equal(meta.doubleLinePairs, 2);
  assert.equal(meta.doubleLineWalls, 2);
  assert.equal(meta.singleEdgeWalls, 1);
  assert.equal(meta.diagonalDropped, 1);
  assert.equal(meta.shortRunsDropped, 1);
});
