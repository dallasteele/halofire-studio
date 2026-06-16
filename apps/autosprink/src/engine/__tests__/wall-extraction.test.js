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

test('extractWallRuns handles fragmented horizontal and vertical double-line walls in one sample set', () => {
  const segments = [
    { a: [0, 0], b: [8, 0] },
    { a: [8.3, 0], b: [16, 0] },
    { a: [0, 0.6], b: [7.7, 0.6] },
    { a: [8, 0.6], b: [16, 0.6] },
    { a: [20, 2], b: [20, 10] },
    { a: [20, 10.3], b: [20, 18] },
    { a: [20.7, 2], b: [20.7, 9.8] },
    { a: [20.7, 10], b: [20.7, 18] },
    { a: [4, 4], b: [5, 5] },
    { a: [30, 30], b: [30, 30] },
  ];

  const result = extractWallRuns(segments, {
    faceGapFt: 0.5,
    minOverlapFt: 4,
    maxWallThicknessFt: 1.2,
    includeSingleFaces: false,
  });

  assert.equal(result.meta.diagonalDropped, 1);
  assert.equal(result.meta.degenerateDropped, 1);
  assert.equal(result.meta.pairedRuns, 2);
  assert.equal(result.meta.singleFaceRuns, 0);
  assert.deepEqual(result.runs, [
    {
      a: [0, 0.3],
      b: [16, 0.3],
      axis: 'H',
      lengthFt: 16,
      thicknessFt: 0.6,
      sourceFaces: 2,
      source: 'paired-double-line',
    },
    {
      a: [20.35, 2],
      b: [20.35, 18],
      axis: 'V',
      lengthFt: 16,
      thicknessFt: 0.7,
      sourceFaces: 2,
      source: 'paired-double-line',
    },
  ]);
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

test('extractWallRuns keeps doorway-sized single-face gaps split', () => {
  const segments = [
    { a: [0, 0], b: [10, 0] },
    { a: [0, 0.5], b: [10, 0.5] },
    { a: [20, 8], b: [28, 8] },
    { a: [32.5, 8], b: [40, 8] },
  ];

  const result = extractWallRuns(segments, {
    faceGapFt: 1,
    wallGapFt: 1,
    maxWallThicknessFt: 1,
    includeSingleFaces: true,
  });

  assert.equal(result.meta.pairedRuns, 1);
  assert.equal(result.meta.singleFaceRuns, 2);
  assert.deepEqual(result.runs, [
    {
      a: [0, 0.25],
      b: [10, 0.25],
      axis: 'H',
      lengthFt: 10,
      thicknessFt: 0.5,
      sourceFaces: 2,
      source: 'paired-double-line',
    },
    {
      a: [20, 8],
      b: [28, 8],
      axis: 'H',
      lengthFt: 8,
      sourceFaces: 1,
      source: 'single-face',
    },
    {
      a: [32.5, 8],
      b: [40, 8],
      axis: 'H',
      lengthFt: 7.5,
      sourceFaces: 1,
      source: 'single-face',
    },
  ]);
});
