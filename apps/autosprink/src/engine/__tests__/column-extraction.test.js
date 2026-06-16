import test from 'node:test';
import assert from 'node:assert/strict';

import { detectColumnMarkers, detectColumns } from '../structure-from-plan.js';

function byPosition(a, b) {
  return a.x - b.x || a.y - b.y;
}

function filledMarkerBlob(cx, cy) {
  const segs = [];
  for (let row = -2; row <= 2; row += 1) {
    segs.push({ x1: cx - 0.6, y1: cy + row * 0.18, x2: cx + 0.6, y2: cy + row * 0.18 });
  }
  for (let col = -2; col <= 2; col += 1) {
    segs.push({ x1: cx + col * 0.18, y1: cy - 0.6, x2: cx + col * 0.18, y2: cy + 0.6 });
  }
  return segs;
}

test('detectColumnMarkers keeps one marker per filled blob at the true blob position', () => {
  const expected = [
    { x: 12, y: 18 },
    { x: 43.2, y: 18.4 },
    { x: 43.1, y: 47.9 },
  ];
  const segments = expected.flatMap(({ x, y }) => filledMarkerBlob(x, y));
  const { markers } = detectColumnMarkers(segments, {
    markerRadiusFt: 1.4,
    minMarkerSegs: 6,
    markerMaxLenFt: 1.5,
  });

  assert.equal(markers.length, expected.length);
  assert.deepEqual(
    markers.map((marker) => ({ x: marker.x, y: marker.y })),
    [...expected].sort(byPosition),
  );
});

test('detectColumns emits one standing column per real marker and never fills the grid', () => {
  const grid = {
    xs: [12, 28, 43, 59],
    ys: [18, 33, 48],
    labels: { cols: ['1', '2', '3', '4'], rows: ['A', 'B', 'C'] },
  };
  const expected = [
    { x: 12, y: 18, grid: { col: '1', row: 'A' } },
    { x: 43.2, y: 18.4, grid: { col: '3', row: 'A' } },
    { x: 43.1, y: 47.9, grid: { col: '3', row: 'C' } },
  ];
  const segments = expected.flatMap(({ x, y }) => filledMarkerBlob(x, y));
  const { columns } = detectColumns(grid, segments, [], {
    markerRadiusFt: 1.4,
    minMarkerSegs: 6,
    markerMaxLenFt: 1.5,
    snapRadiusFt: 1.2,
  });

  assert.equal(columns.length, expected.length);
  assert.deepEqual(
    columns.map((column) => ({ x: column.x, y: column.y, grid: column.grid })),
    [...expected].sort(byPosition),
  );
  assert.ok(columns.every((column) => column.markerSegs >= 10));
});
