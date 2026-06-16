import test from 'node:test';
import assert from 'node:assert/strict';

import { selectRemoteArea } from './remoteArea.mjs';

function hazenWilliamsLoss({ Q, d, len, C = 130 }) {
  return 4.52 * Math.pow(Q, 1.85) / (Math.pow(C, 1.85) * Math.pow(d, 4.87)) * len;
}

test('selectRemoteArea returns the highest-demand path with gpm, psi, and headsOpen', () => {
  const heads = [
    {
      id: 'H-1',
      path: [
        {
          headId: 'H-1',
          Q: 300,
          d: 2.5,
          len: 20,
          C: 120,
          fittings: [{ fittingType: '45° elbow', pipeSizeIn: 2.5 }],
        },
      ],
    },
    {
      id: 'H-2',
      path: [
        {
          headId: 'H-1',
          Q: 300,
          d: 2.5,
          len: 30,
          C: 120,
          fittings: [{ fittingType: 'tee', pipeSizeIn: 2.5 }],
        },
        {
          headId: 'H-2',
          Q: 300,
          d: 2,
          len: 10,
          C: 120,
          fittings: [{ fittingType: '90° elbow', pipeSizeIn: 2 }],
        },
      ],
    },
  ];

  const result = selectRemoteArea(heads, 1500, 0.2);
  const expectedPsi =
    hazenWilliamsLoss({ Q: 300, d: 2.5, len: 40, C: 120 }) +
    hazenWilliamsLoss({ Q: 300, d: 2, len: 20, C: 120 });

  assert.equal(result.gpm, 300);
  assert.ok(Math.abs(result.psi - expectedPsi) < 1e-12);
  assert.deepEqual(result.headsOpen, ['H-1', 'H-2']);
});

test('selectRemoteArea rejects empty head arrays and invalid density inputs', () => {
  assert.throws(() => selectRemoteArea([], 1500, 0.2), /heads must be a non-empty array/);
  assert.throws(() => selectRemoteArea([{ id: 'H-1', path: [{ Q: 1, d: 1, len: 1 }] }], 0, 0.2), /areaSqFt must be a positive number/);
  assert.throws(() => selectRemoteArea([{ id: 'H-1', path: [{ Q: 1, d: 1, len: 1 }] }], 1500, 0), /densityGpmPerSqFt must be a positive number/);
});
