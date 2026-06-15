import test from 'node:test'
import assert from 'node:assert/strict'

import { maxHangerSpacingFt } from './hangerSpacing.mjs'

test('maxHangerSpacingFt returns the NFPA-13 max spacing for supported pipe sizes', () => {
  assert.equal(maxHangerSpacingFt(1), 10)
  assert.equal(maxHangerSpacingFt(1.25), 12)
  assert.equal(maxHangerSpacingFt(1.5), 14)
  assert.equal(maxHangerSpacingFt(2), 16)
  assert.equal(maxHangerSpacingFt(2.5), 18)
  assert.equal(maxHangerSpacingFt(3), 20)
  assert.equal(maxHangerSpacingFt(4), 24)
  assert.equal(maxHangerSpacingFt(6), 30)
})

test('maxHangerSpacingFt returns 0 for unsupported pipe sizes', () => {
  assert.equal(maxHangerSpacingFt(5), 0)
  assert.equal(maxHangerSpacingFt(0.75), 0)
})
