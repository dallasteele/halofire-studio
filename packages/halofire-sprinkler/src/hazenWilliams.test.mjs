import test from 'node:test'
import assert from 'node:assert/strict'

import { frictionLossPsiPerFt } from './hazenWilliams.mjs'

test('frictionLossPsiPerFt matches the Hazen-Williams formula in psi/ft', () => {
  const loss = frictionLossPsiPerFt(100, 1.0, 130)
  assert.ok(Math.abs(loss - 2.7819110082424627) < 1e-12)
})

test('frictionLossPsiPerFt returns zero for zero flow', () => {
  assert.equal(frictionLossPsiPerFt(0, 1.0, 130), 0)
})

test('frictionLossPsiPerFt rejects invalid hydraulic inputs', () => {
  assert.throws(() => frictionLossPsiPerFt(-1, 1.0, 130), /gpm must be >= 0/)
  assert.throws(() => frictionLossPsiPerFt(100, 0, 130), /pipeInnerDiaIn must be > 0/)
  assert.throws(() => frictionLossPsiPerFt(100, 1.0, 0), /C must be > 0/)
})
