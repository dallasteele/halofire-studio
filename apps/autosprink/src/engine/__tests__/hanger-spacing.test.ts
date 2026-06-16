import test from 'node:test';
import assert from 'node:assert/strict';

import { computeHydraulics } from '../hydraulics.js';

test('computeHydraulics returns a compliant hangerSpacingResult for properly spaced hangers', () => {
  const cadModel = {
    material: 'steel',
    solids: [
      {
        kind: 'pipe',
        name: 'branch-0',
        role: 'branch',
        diameterIn: 2,
        from: [0, 0, 10],
        to: [30, 0, 10],
        hangers: [{ offsetFt: 0 }, { offsetFt: 15 }, { offsetFt: 30 }],
      },
    ],
    network: {
      branchLines: [{ row: 0, y: 0, startX: 0, endX: 30, headCount: 6, diameterIn: 2 }],
      mainX: 0,
      mainZ: 13,
      branchZ: 10,
      headZ: 9,
      totalHeads: 6,
    },
  };

  const result = computeHydraulics({ cadModel, hazard: 'light' });

  assert.deepEqual(result.hangerSpacingResult, {
    spacing: 15,
    requiredCount: 3,
    isCompliant: true,
  });
});
