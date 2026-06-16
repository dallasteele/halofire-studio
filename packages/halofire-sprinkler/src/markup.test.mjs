import test from 'node:test'
import assert from 'node:assert/strict'

import { applyMarkup, sellPrice } from './markup.mjs'

test('applyMarkup adds the requested margin percentage', () => {
  assert.equal(applyMarkup(100, 20), 120)
})

test('sellPrice returns the marked-up sale amount', () => {
  assert.equal(sellPrice(50, 15), 57.5)
})

test('negative margin returns a lower price', () => {
  assert.equal(sellPrice(100, -10), 90)
})

test('zero margin returns the original cost', () => {
  assert.equal(sellPrice(42, 0), 42)
})
