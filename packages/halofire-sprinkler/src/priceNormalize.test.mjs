import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizePriceSheet } from './priceNormalize.mjs'

test('empty input returns an empty array', () => {
  assert.deepEqual(normalizePriceSheet([]), [])
})

test('invalid price yields priceUsd 0 and unit defaults to EA', () => {
  assert.deepEqual(
    normalizePriceSheet([{ sku: 'ABC', desc: 'Widget', unit: '', price: 'abc' }]),
    [{ sku: 'ABC', desc: 'Widget', unit: 'EA', priceUsd: 0 }],
  )
})

test('missing unit becomes EA and sku/desc are normalized to strings', () => {
  assert.deepEqual(
    normalizePriceSheet([{ sku: 123, desc: null, priceUsd: '19.99' }]),
    [{ sku: '123', desc: '', unit: 'EA', priceUsd: 19.99 }],
  )
})
