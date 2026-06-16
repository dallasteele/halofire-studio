import test from 'node:test'
import assert from 'node:assert/strict'

import { applyMarkup, sellPrice } from './markup.mjs'

test('applyMarkup returns the cost increased by the margin percentage', () => {
  assert.equal(applyMarkup(100, 20), 120)
})

test('sellPrice matches applyMarkup for the same inputs', () => {
  assert.equal(sellPrice(100, 20), 120)
})
