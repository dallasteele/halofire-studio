import test from 'node:test';
import assert from 'node:assert/strict';

import { equivalentLengthFt, totalEquivalentLength } from './fittingLoss.mjs';

test('equivalentLengthFt returns the requested NFPA-13 constants for known fitting types', () => {
  assert.equal(equivalentLengthFt('90° elbow', 2), 10);
  assert.equal(equivalentLengthFt('45° elbow', 2), 5);
  assert.equal(equivalentLengthFt('tee', 4), 10);
  assert.equal(equivalentLengthFt('gate valve', 2), 15);
  assert.equal(equivalentLengthFt('swing check', 6), 15);
});

test('totalEquivalentLength sums equivalent lengths in feet across fittings', () => {
  const total = totalEquivalentLength([
    { fittingType: '90° elbow', pipeSizeIn: 2 },
    { fittingType: '45° elbow', pipeSizeIn: 2 },
    { fittingType: 'tee', pipeSizeIn: 4 },
    { fittingType: 'gate valve', pipeSizeIn: 2 },
    { fittingType: 'swing check', pipeSizeIn: 6 },
  ]);

  assert.equal(total, 55);
});

test('equivalentLengthFt throws for unknown fitting types', () => {
  assert.throws(() => equivalentLengthFt('butterfly valve', 2), /Unknown fitting type/);
});

test('equivalentLengthFt throws for invalid pipe sizes', () => {
  assert.throws(() => equivalentLengthFt('90° elbow', 0), /Invalid pipe size/);
  assert.throws(() => equivalentLengthFt('90° elbow', Number.NaN), /Invalid pipe size/);
});
