import test from 'node:test';
import assert from 'node:assert/strict';

import { extractWallRuns } from '../wall-extraction.js';

test('extractWallRuns pairs double-line faces and merges collinear spans into wall paths', () => {
  const segments = [
    { a: [0, 0], b: [0, 4] },
    { a: [0, 4.4], b: [0, 10] },
    { a: [1, 0], b: [1, 10] },
    { a: [5, 20], b: [10, 20] },
    { a: [10.4, 20], b: [16, 20] },
    { a: [5, 21], b: [16, 21] },
    { a: [30, 30], b: [30.5, 30.5] },
  ];

  const result = extractWallRuns(segments, {
    faceGapFt: 0.5,
    minOverlapFt: 3,
    includeSingleFaces: false,
  });

  assert.deepEqual(result.runs, [
    {
      a: [5, 20.5],
      b: [16, 20.5],
      axis: 'H',
      lengthFt: 11,
      thicknessFt: 1,
      sourceFaces: 2,
      source: 'paired-double-line',
    },
    {
      a: [0.5, 0],
      b: [0.5, 10],
      axis: 'V',
      lengthFt: 10,
      thicknessFt: 1,
      sourceFaces: 2,
      source: 'paired-double-line',
    },
  ]);
  assert.equal(result.meta.diagonalDropped, 1);
  assert.equal(result.meta.pairedRuns, 2);
  assert.equal(result.meta.singleFaceRuns, 0);
});

test('extractWallRuns keeps single-face wall evidence instead of fabricating a bbox wall', () => {
  const segments = [
    { a: [40, 3], b: [40, 9] },
    { a: [60, 0], b: [60.25, 0.25] },
  ];

  const result = extractWallRuns(segments, {
    includeSingleFaces: true,
    minFaceRunFt: 2,
  });

  assert.deepEqual(result.runs, [
    {
      a: [40, 3],
      b: [40, 9],
      axis: 'V',
      lengthFt: 6,
      sourceFaces: 1,
      source: 'single-face',
    },
  ]);
  assert.equal(result.meta.diagonalDropped, 1);
  assert.equal(result.meta.singleFaceRuns, 1);
});
