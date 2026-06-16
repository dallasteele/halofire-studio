import test from 'node:test';
import assert from 'node:assert/strict';

import { computeHydraulics } from '../hydraulics.js';

test('computeHydraulics returns bidResult with risk-adjusted final bid', () => {
  const result = computeHydraulics({
    hazard: 'light',
    network: {
      headZ: 12,
      mainX: 0,
      mainZ: 13,
      branchZ: 13,
      branchLines: [
        { row: 0, y: 0, startX: 0, endX: 40, headCount: 10, diameterIn: 2 },
      ],
    },
    bomResult: {
      total: 1000,
    },
    projectContext: {
      renovation: true,
      occupiedBuilding: true,
    },
  });

  assert.deepEqual(result.bidResult, {
    totalBid: 1000,
    riskFactor: 0.15,
    finalBid: 1150,
  });
});
