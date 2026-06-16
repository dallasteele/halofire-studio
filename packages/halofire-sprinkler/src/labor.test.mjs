import test from 'node:test'
import assert from 'node:assert/strict'

import { laborHours } from './labor.mjs'

test('laborHours computes qty * rate for a matching item', () => {
  assert.equal(laborHours([{ item: 'pipe', qty: 10, unit: 'ft' }], { pipe: 0.5 }), 5)
})

test('laborHours sums hours across bom line items', () => {
  const bom = [
    { item: 'pipe', qty: 10, unit: 'ft' },
    { item: 'head', qty: 4, unit: 'ea' },
    { item: 'fitting', qty: 6, unit: 'ea' },
  ]
  const ratesByItem = {
    pipe: 0.5,
    head: 1.25,
    fitting: 0.2,
  }

  assert.equal(laborHours(bom, ratesByItem), 11.2)
})

test('laborHours treats missing rates as zero hours', () => {
  const bom = [
    { item: 'pipe', qty: 10, unit: 'ft' },
    { item: 'hanger', qty: 8, unit: 'ea' },
  ]

  assert.equal(laborHours(bom, { pipe: 0.5 }), 5)
})
