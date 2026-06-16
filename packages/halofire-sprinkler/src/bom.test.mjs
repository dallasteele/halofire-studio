import test from 'node:test'
import assert from 'node:assert/strict'

import { bomFromCounts } from './bom.mjs'

test('builds a four-line BOM from aggregate counts', () => {
  assert.deepEqual(bomFromCounts({ pipeFt: 20, fittings: 5, heads: 3, hangers: 2 }), [
    { item: 'pipe', qty: 20, unit: 'ft' },
    { item: 'fittings', qty: 5, unit: 'ea' },
    { item: 'heads', qty: 3, unit: 'ea' },
    { item: 'hangers', qty: 2, unit: 'ea' },
  ])
})
