import test from 'node:test';
import assert from 'node:assert/strict';

import { computeHydraulics } from '../hydraulics.js';

const cad = {
  solids: [
    { kind: 'pipe', from: [0, 0, 0], to: [0, 0, 10], diameterIn: 2.067 },
    { kind: 'head', position: [0, 0, 10], kFactor: 5.6 },
  ],
};

test('computeHydraulics includes nfpaReport with a passing structured result', () => {
  const result = computeHydraulics({ model: cad, availablePsi: 65, hazard: 'ordinary' });

  assert.equal(result.nfpaReport.passFail, true);
  assert.deepEqual(result.nfpaReport.violations, []);
  assert.equal(result.nfpaReport.complianceSummary.requiredPsi, result.networkSolve.requiredPsi);
});

test('computeHydraulics includes nfpaReport with passFail false when a check fails', () => {
  const result = computeHydraulics({ model: cad, availablePsi: 1, hazard: 'ordinary' });

  assert.equal(result.nfpaReport.passFail, false);
  assert.ok(result.nfpaReport.violations.some((violation) => violation.code === 'HYDRAULIC_SUPPLY_INADEQUATE'));
  assert.equal(result.nfpaReport.complianceSummary.violationCount, result.nfpaReport.violations.length);
});
