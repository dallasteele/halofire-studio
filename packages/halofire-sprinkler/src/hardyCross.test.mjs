import test from 'node:test';
import assert from 'node:assert/strict';

import { balanceLoops } from './hardyCross.mjs';

test('balanceLoops converges a symmetric one-loop split to the known 50/50 solution', () => {
  const loop = {
    segments: [
      { id: 'ab', Q: 80, d: 4, len: 100, type: 'main' },
      { id: 'bc', Q: 80, d: 4, len: 100, type: 'main' },
      { id: 'cd', Q: -20, d: 4, len: 100, type: 'main' },
      { id: 'da', Q: -20, d: 4, len: 100, type: 'main' },
    ],
    initialFlows: [80, 80, -20, -20],
  };

  const result = balanceLoops([loop], 1e-9);

  assert.equal(result.converged, true);
  assert.ok(result.maxResidual < 1e-9);
  assert.ok(Math.abs(result.flows.ab - 50) < 1e-6);
  assert.ok(Math.abs(result.flows.bc - 50) < 1e-6);
  assert.ok(Math.abs(result.flows.cd + 50) < 1e-6);
  assert.ok(Math.abs(result.flows.da + 50) < 1e-6);
});
