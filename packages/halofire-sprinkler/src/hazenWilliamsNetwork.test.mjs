import test from 'node:test';
import assert from 'node:assert/strict';

import { frictionLossForRun } from './hazenWilliamsNetwork.mjs';

const FLOW_EXPONENT = 1.85;
const DIAMETER_EXPONENT = 4.87;
const HAZEN_WILLIAMS_COEFFICIENT = 4.52;

function expectedLoss({ Q, d, len, C = 130 }) {
  return (
    HAZEN_WILLIAMS_COEFFICIENT *
    Math.pow(Q, FLOW_EXPONENT) /
    (Math.pow(C, FLOW_EXPONENT) * Math.pow(d, DIAMETER_EXPONENT)) *
    len
  );
}

test('frictionLossForRun matches a hand-calculated single segment', () => {
  const segment = { Q: 100, d: 2, len: 10, C: 120 };
  const expected = expectedLoss(segment);

  assert.ok(Math.abs(frictionLossForRun([segment]) - expected) < 1e-12);
});

test('frictionLossForRun defaults C to 130 and sums multiple segments', () => {
  const segments = [
    { Q: 80, d: 2.5, len: 12 },
    { Q: 55, d: 1.5, len: 18, C: 140 },
  ];
  const expected = segments.reduce((sum, segment) => sum + expectedLoss(segment), 0);

  assert.ok(Math.abs(frictionLossForRun(segments) - expected) < 1e-12);
});
