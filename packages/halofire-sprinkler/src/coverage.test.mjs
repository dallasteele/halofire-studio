import test from 'node:test'
import assert from 'node:assert/strict'

import { minHeadsForRoom } from './coverage.mjs'

test('computes minimum heads by NFPA-13 hazard class coverage cap', () => {
  assert.equal(minHeadsForRoom(450, 'light'), 2)
  assert.equal(minHeadsForRoom(225, 'light'), 1)
  assert.equal(minHeadsForRoom(226, 'light'), 2)
  assert.equal(minHeadsForRoom(400, 'ordinary_i'), 4)
  assert.equal(minHeadsForRoom(100, 'extra_ii'), 1)
  assert.equal(minHeadsForRoom(101, 'extra_ii'), 2)
})

test('rejects invalid inputs', () => {
  assert.throws(() => minHeadsForRoom(0, 'light'), TypeError)
  assert.throws(() => minHeadsForRoom(450, 'bogus'), TypeError)
})
