import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizePriceSheet } from './priceNormalize.mjs'

test('normalizePriceSheet matches the handoff acceptance example', () => {
  assert.deepEqual(normalizePriceSheet([{ sku: 'ABC', desc: 'Widget', unit: 'each', price: '12.99' }]), [
    { sku: 'ABC', desc: 'Widget', unit: 'EA', priceUsd: 12.99 },
  ])
})

test('normalizePriceSheet defaults unit and invalid price values', () => {
  assert.deepEqual(
    normalizePriceSheet([
      { sku: 42, desc: null, price: 'not-a-price' },
      { sku: undefined, desc: 'Bracket', unit: '', priceUsd: Number.NaN },
    ]),
    [
      { sku: '42', desc: '', unit: 'EA', priceUsd: 0 },
      { sku: '', desc: 'Bracket', unit: 'EA', priceUsd: 0 },
    ],
  )
})

test('normalizePriceSheet trims strings and parses common price formatting', () => {
  assert.deepEqual(
    normalizePriceSheet([{ sku: ' ABC ', desc: ' Valve trim ', unit: ' bx ', price: '$1,234.50' }]),
    [{ sku: 'ABC', desc: 'Valve trim', unit: 'BX', priceUsd: 1234.5 }],
  )
})
