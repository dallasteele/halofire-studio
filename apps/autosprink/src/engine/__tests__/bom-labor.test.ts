import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRoomCad } from '../cad-model.js';
import { computeHydraulics } from '../hydraulics.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

test('computeHydraulics returns bomResult with positive cost and labor for valid components', () => {
  const cad = buildRoomCad({
    name: 'Bay',
    polygon: rect(60, 40),
    hazard: 'light',
    ceilingHeightFt: 14,
  });

  const result = computeHydraulics(cad);

  assert.ok(result.bomResult);
  assert.ok(Array.isArray(result.bomResult.items));
  assert.ok(result.bomResult.items.length > 0);
  assert.ok(result.bomResult.totalCost > 0);
  assert.ok(result.bomResult.laborHours > 0);
  assert.equal(result.bomResult.normalizedCost, result.bomResult.totalCost);

  const riser = result.bomResult.items.find((item) => item.key === 'riser_assembly');
  assert.ok(riser);
  assert.equal(riser.quantity, 1);
});
