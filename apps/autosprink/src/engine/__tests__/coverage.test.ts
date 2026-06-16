import test from 'node:test';
import assert from 'node:assert/strict';

import { computeHydraulics } from '../index.ts';

function headModel(positions, hazard = 'ordinary') {
  return {
    hazardClass: hazard,
    sprinklerLayout: positions.map(([x, y], index) => ({
      name: `h${index}`,
      x,
      y,
      z: 8,
    })),
  };
}

test('computeHydraulics returns a compliant coverageResult for a known tiled layout', () => {
  const points = [];
  for (let x = 0; x < 3; x += 1) {
    for (let y = 0; y < 3; y += 1) points.push([x * 10, y * 10]);
  }

  const result = computeHydraulics(headModel(points, 'ordinary'));

  assert.equal(result.coverageResult.isCompliant, true);
  assert.equal(result.coverageResult.coveragePercent, 100);
  assert.deepEqual(result.coverageResult.missingZones, []);
});

test('computeHydraulics exposes missing coverage zones for a known gap layout', () => {
  const result = computeHydraulics(headModel([[0, 0], [28, 0]], 'ordinary'));

  assert.equal(result.coverageResult.isCompliant, false);
  assert.equal(typeof result.coverageResult.coveragePercent, 'number');
  assert.ok(result.coverageResult.coveragePercent < 100);
  assert.ok(result.coverageResult.missingZones.length > 0);
});
