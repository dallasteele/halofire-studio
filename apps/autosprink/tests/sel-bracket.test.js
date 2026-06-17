import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectionBracketCornerSegments,
  selectionBracketPixelSize,
  selectionBracketViewDepth,
  selectionBracketWorldSize,
} from '../src/engine/sel-bracket.js';

function stubPerspectiveCamera(zFt) {
  return {
    isPerspectiveCamera: true,
    fov: 50,
    position: { x: 0, y: 0, z: zFt },
    target: { x: 0, y: 0, z: 0 },
  };
}

test('selection bracket pixel size stays within the UE-style target band', () => {
  assert.equal(selectionBracketPixelSize({ pixelSize: 2 }), 6);
  assert.equal(selectionBracketPixelSize({ pixelSize: 10 }), 10);
  assert.equal(selectionBracketPixelSize({ pixelSize: 40 }), 12);
});

test('selection bracket world size scales with camera distance so screen size stays constant', () => {
  const target = { x: 0, y: 0, z: 0 };
  const viewportHeightPx = 900;
  const near = selectionBracketWorldSize(stubPerspectiveCamera(5), target, viewportHeightPx, { pixelSize: 10 });
  const far = selectionBracketWorldSize(stubPerspectiveCamera(100), target, viewportHeightPx, { pixelSize: 10 });

  assert.ok(near > 0);
  assert.ok(far > near);
  assert.ok(Math.abs((far / near) - 20) < 1e-6);
});

test('selection bracket view depth follows the camera forward axis', () => {
  const depth = selectionBracketViewDepth(stubPerspectiveCamera(100), { x: 0, y: 0, z: 0 });
  assert.equal(depth, 100);
});

test('selection bracket geometry is UE-style L-corner segments instead of a solid square', () => {
  const segments = selectionBracketCornerSegments({ cornerRatio: 0.34 });
  assert.equal(segments.length, 8);
  for (const seg of segments) {
    assert.equal(seg.length, 6);
    assert.ok(seg[0] === seg[3] || seg[1] === seg[4]);
  }
});
