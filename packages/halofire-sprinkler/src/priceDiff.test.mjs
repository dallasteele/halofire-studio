import test from 'node:test'
import assert from 'node:assert/strict'

import { diffPriceSheets } from './priceDiff.mjs'

test('returns the required changed-row acceptance case', () => {
  assert.deepEqual(
    diffPriceSheets([{ sku: 'A', priceUsd: 10 }], [{ sku: 'A', priceUsd: 12 }]),
    {
      changed: [{ sku: 'A', priceUsd: 12 }],
      added: [],
      removed: [],
      pctChangeBySku: { A: 20 },
    },
  )
})

test('reports added and removed skus separately', () => {
  assert.deepEqual(
    diffPriceSheets(
      [
        { sku: 'A', priceUsd: 10 },
        { sku: 'B', priceUsd: 5 },
      ],
      [
        { sku: 'A', priceUsd: 10 },
        { sku: 'C', priceUsd: 7 },
      ],
    ),
    {
      changed: [],
      added: [{ sku: 'C', priceUsd: 7 }],
      removed: [{ sku: 'B', priceUsd: 5 }],
      pctChangeBySku: {},
    },
  )
})

test('omits unchanged rows from changed and pctChangeBySku', () => {
  assert.deepEqual(
    diffPriceSheets(
      [{ sku: 'A', priceUsd: 10 }],
      [{ sku: 'A', priceUsd: 10 }],
    ),
    {
      changed: [],
      added: [],
      removed: [],
      pctChangeBySku: {},
    },
  )
})
