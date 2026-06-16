import assert from 'node:assert/strict'
import test from 'node:test'

import * as stockModule from './stock.mjs'
import { pipeStockAndCouplings } from './stock.mjs'

test('exports only pipeStockAndCouplings from the ESM module', () => {
  assert.deepEqual(Object.keys(stockModule), ['pipeStockAndCouplings'])
  assert.equal(typeof stockModule.pipeStockAndCouplings, 'function')
  assert.equal('default' in stockModule, false)
})

test('uses one stick and zero couplings when totalFt is below stockFt', () => {
  assert.deepEqual(pipeStockAndCouplings(9, 10), { sticks: 1, couplings: 0 })
})

test('uses one stick and zero couplings when totalFt equals stockFt', () => {
  assert.deepEqual(pipeStockAndCouplings(10, 10), { sticks: 1, couplings: 0 })
})

test('uses full sticks and one fewer couplings for runs above stockFt', () => {
  assert.deepEqual(pipeStockAndCouplings(20, 10), { sticks: 2, couplings: 1 })
})
