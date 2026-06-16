import test from 'node:test'
import assert from 'node:assert/strict'

import { bomFromCounts } from './bom.mjs'

test('returns BOM line items with the expected order, quantities, and units', () => {
  assert.deepEqual(bomFromCounts({ pipeFt: 20, fittings: 5, heads: 3, hangers: 2 }), [
    { item: 'pipe', qty: 20, unit: 'ft' },
    { item: 'fittings', qty: 5, unit: 'ea' },
    { item: 'heads', qty: 3, unit: 'ea' },
    { item: 'hangers', qty: 2, unit: 'ea' },
  ])
})

test('maps each supported count input to its corresponding BOM line item', () => {
  const actual = bomFromCounts({ pipeFt: 11, fittings: 7, heads: 4, hangers: 9 })

  assert.equal(actual[0].qty, 11)
  assert.equal(actual[0].unit, 'ft')
  assert.equal(actual[1].qty, 7)
  assert.equal(actual[1].unit, 'ea')
  assert.equal(actual[2].qty, 4)
  assert.equal(actual[2].unit, 'ea')
  assert.equal(actual[3].qty, 9)
  assert.equal(actual[3].unit, 'ea')
})
