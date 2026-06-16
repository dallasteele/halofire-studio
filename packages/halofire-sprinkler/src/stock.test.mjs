import test from 'node:test'
import assert from 'node:assert/strict'

import { pipeStockAndCouplings } from './stock.mjs'

test('counts full stock sticks and joints for an exact multiple', () => {
  assert.deepEqual(pipeStockAndCouplings(10, 5), { sticks: 2, couplings: 1 })
})

test('rounds up partial runs to a full stick and coupling count', () => {
  assert.deepEqual(pipeStockAndCouplings(11, 5), { sticks: 3, couplings: 2 })
})
