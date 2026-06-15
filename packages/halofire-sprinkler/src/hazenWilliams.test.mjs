import test from 'node:test';
import assert from 'node:assert/strict';

import { frictionLossPsiPerFt } from './hazenWilliams.mjs';

test('returns 0 for zero flow', () => {
  assert.equal(frictionLossPsiPerFt(0, 2, 130), 0);
});

test('matches Hazen-Williams hand calculation for 100 gpm, 2 in ID, C=130', () => {
  assert.ok(
    Math.abs(frictionLossPsiPerFt(100, 2, 130) - 0.09513211543086375) < 1e-12,
  );
});

test('throws for non-positive diameter and C', () => {
  assert.throws(() => frictionLossPsiPerFt(100, 0, 130), /pipeInnerDiaIn/);
  assert.throws(() => frictionLossPsiPerFt(100, 2, 0), /C must be greater than 0/);
});
