import test from 'node:test';
import assert from 'node:assert/strict';

import { detectColumnMarkers } from '../src/engine/structure-from-plan.js';

function filledBlobAt(cx, cy, sizeFt = 1.5) {
  const half = sizeFt / 2;
  const segs = [];
  for (let y = cy - half; y <= cy + half + 1e-9; y += 0.15) {
    segs.push({ x1: cx - half, y1: y, x2: cx + half, y2: y });
  }
  segs.push({ x1: cx - half, y1: cy - half, x2: cx - half, y2: cy + half });
  segs.push({ x1: cx + half, y1: cy - half, x2: cx + half, y2: cy + half });
  return segs;
}

function hollowTickAt(cx, cy) {
  return [
    { x1: cx - 0.75, y1: cy, x2: cx, y2: cy },
    { x1: cx, y1: cy, x2: cx, y2: cy + 0.75 },
    { x1: cx - 0.2, y1: cy - 0.75, x2: cx - 0.2, y2: cy + 0.1 },
    { x1: cx - 0.75, y1: cy + 0.2, x2: cx + 0.1, y2: cy + 0.2 },
  ];
}

test('filled blob gate keeps only solid column markers', () => {
  const candidates = [
    { x: 0, y: 0, id: 'filled-1' },
    { x: 5, y: 0, id: 'filled-2' },
    { x: 10, y: 0, id: 'filled-3' },
    { x: 0, y: 5, id: 'tick-1' },
    { x: 5, y: 5, id: 'tick-2' },
    { x: 10, y: 5, id: 'tick-3' },
    { x: 15, y: 5, id: 'tick-4' },
    { x: 20, y: 5, id: 'tick-5' },
  ];
  const segments = [
    ...filledBlobAt(0, 0),
    ...filledBlobAt(5, 0),
    ...filledBlobAt(10, 0),
    ...hollowTickAt(0, 5),
    ...hollowTickAt(5, 5),
    ...hollowTickAt(10, 5),
    ...hollowTickAt(15, 5),
    ...hollowTickAt(20, 5),
  ];

  const res = detectColumnMarkers(candidates, segments, {});
  assert.equal(res.markers.length, 3);
  assert.deepEqual(res.markers.map((m) => m.id), ['filled-1', 'filled-2', 'filled-3']);
  for (const marker of res.markers) {
    assert.ok(marker.fillRatio >= 0.6);
  }
});
