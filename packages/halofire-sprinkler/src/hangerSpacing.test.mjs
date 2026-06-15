import test from 'node:test'
import assert from 'node:assert/strict'

import { maxHangerSpacingFt } from './hangerSpacing.mjs'

test('returns the NFPA 13 max hanger spacing for 1.5 in pipe', () => {
  assert.equal(maxHangerSpacingFt(1.5), 8)
})

test('returns the NFPA 13 max hanger spacing for 2 in pipe', () => {
  assert.equal(maxHangerSpacingFt(2), 10)
})

test('returns the table value for 1/2 in pipe', () => {
  assert.equal(maxHangerSpacingFt(0.5), 4)
})
