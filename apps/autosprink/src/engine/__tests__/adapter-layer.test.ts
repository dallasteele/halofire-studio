import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRoomCad } from '../cad-model.js';
import { computeHydraulics } from '../index.ts';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

test('computeHydraulics returns a structured combined result for a valid pipe network model', () => {
  const model = buildRoomCad({
    name: 'Adapter Bay',
    polygon: rect(60, 40),
    hazard: 'light',
    ceilingHeightFt: 14,
  });

  const result = computeHydraulics(model);

  assert.ok(result);
  assert.equal(typeof result, 'object');
  assert.equal(typeof result.flow, 'number');
  assert.equal(typeof result.pressure, 'number');
  assert.equal(typeof result.headLoss, 'number');
  assert.ok(Number.isFinite(result.flow));
  assert.ok(Number.isFinite(result.pressure));
  assert.ok(Number.isFinite(result.headLoss));

  assert.ok(result.flow > 0);
  assert.ok(result.pressure > 0);
  assert.ok(result.headLoss >= 0);

  assert.ok(result.hazenWilliams);
  assert.ok(result.remoteArea);
  assert.ok(result.hardyCross);
});

test('computeHydraulics rejects a missing model', () => {
  assert.throws(() => computeHydraulics(null), /requires a model/i);
});
