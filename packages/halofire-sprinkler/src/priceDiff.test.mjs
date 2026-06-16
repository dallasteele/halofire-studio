import test from 'node:test'
import assert from 'node:assert/strict'

import { diffPriceSheets } from './priceDiff.mjs'

test('empty inputs return empty arrays and no pct changes', () => {
  assert.deepEqual(diffPriceSheets([], []), {
    changed: [],
    added: [],
    removed: [],
    pctChangeBySku: {},
  })
})

test('same rows return no changes', () => {
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

test('price change triggers changed', () => {
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

test('new sku triggers added', () => {
  assert.deepEqual(
    diffPriceSheets([{ sku: 'A', priceUsd: 10 }], [
      { sku: 'A', priceUsd: 10 },
      { sku: 'B', priceUsd: 7 },
    ]),
    {
      changed: [],
      added: [{ sku: 'B', priceUsd: 7 }],
      removed: [],
      pctChangeBySku: {},
    },
  )
})

test('missing sku triggers removed', () => {
  assert.deepEqual(
    diffPriceSheets(
      [
        { sku: 'A', priceUsd: 10 },
        { sku: 'B', priceUsd: 7 },
      ],
      [{ sku: 'A', priceUsd: 10 }],
    ),
    {
      changed: [],
      added: [],
      removed: [{ sku: 'B', priceUsd: 7 }],
      pctChangeBySku: {},
    },
  )
})

test('pctChangeBySku computes correctly for changed skus only', () => {
  const result = diffPriceSheets(
    [
      { sku: 'A', priceUsd: 10 },
      { sku: 'B', priceUsd: 5 },
    ],
    [
      { sku: 'A', priceUsd: 15 },
      { sku: 'B', priceUsd: 5 },
    ],
  )

  assert.equal(result.pctChangeBySku.A, 50)
  assert.equal('B' in result.pctChangeBySku, false)
})
