import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRoomCad } from '../cad-model.js';
import { computeHydraulics } from '../hydraulics.js';
import { generateSprinklerBid } from '../sprinkler-layout.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

test('computeHydraulics includes structured submittalData exports', () => {
  const room = { name: 'Bay', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 };
  const cadModel = buildRoomCad(room);
  const bid = generateSprinklerBid({ name: 'Bay', units: 'ft', rooms: [room] });

  const result = computeHydraulics({ model: cadModel, bid, hazard: 'light' });

  const expectedSprinklers = cadModel.solids.filter((solid) => solid.kind === 'head').length;
  const expectedPipeLength = Math.round(
    cadModel.solids
      .filter((solid) => solid.kind === 'pipe')
      .reduce((sum, solid) => {
        const [ax, ay, az] = solid.from || [0, 0, 0];
        const [bx, by, bz] = solid.to || [0, 0, 0];
        return sum + Math.hypot(bx - ax, by - ay, bz - az);
      }, 0) * 1000,
  ) / 1000;

  assert.equal(result.submittalData.summary.totalSprinklers, expectedSprinklers);
  assert.equal(result.submittalData.summary.totalPipeLength, expectedPipeLength);
  assert.equal(result.submittalData.summary.totalCost, bid.pricing.total);
  assert.ok(Array.isArray(result.submittalData.drawings));
  assert.ok(Array.isArray(result.submittalData.attachments));
});
