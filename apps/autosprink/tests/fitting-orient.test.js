import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOCAL_OUTLET_AXIS,
  LOCAL_RUN_AXIS,
  connectionPortsFor,
  createFittingPlacement,
  fittingRotationMatrix,
  normalizeRunAxis,
  transformVector,
} from '../src/engine/fitting-orient.js';

function approxVec(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} length`);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) < 1e-6,
      `${label}[${index}] expected ${expected[index]} got ${value}`,
    );
  });
}

test('maps local run/outlet basis onto a branch tee drop take-off', () => {
  const hostAxis = normalizeRunAxis([18, 0, 0]);
  const outletAxis = [0, 0, -1];
  const matrix = fittingRotationMatrix(hostAxis, outletAxis);
  approxVec(transformVector(matrix, LOCAL_RUN_AXIS), hostAxis, 'runAxis');
  approxVec(transformVector(matrix, LOCAL_OUTLET_AXIS), outletAxis, 'outletAxis');
});

test('maps local run/outlet basis onto a cross-main tee drop take-off', () => {
  const hostAxis = normalizeRunAxis([0, 12, 0]);
  const outletAxis = [0, 0, -1];
  const matrix = fittingRotationMatrix(hostAxis, outletAxis);
  approxVec(transformVector(matrix, LOCAL_RUN_AXIS), hostAxis, 'runAxis');
  approxVec(transformVector(matrix, LOCAL_OUTLET_AXIS), outletAxis, 'outletAxis');
});

test('builds connection port metadata with world axes for fittings', () => {
  const placement = createFittingPlacement('fitting_tee', normalizeRunAxis([9, 0, 0]), [0, 0, -1]);
  assert.equal(placement.connectionPorts.length, 3);
  const outlet = placement.connectionPorts.find((port) => port.id === 'outlet');
  assert.ok(outlet, 'outlet port exists');
  approxVec(outlet.worldAxis, [0, 0, -1], 'outlet worldAxis');
  assert.equal(connectionPortsFor('fitting_cross').length, 4);
});
