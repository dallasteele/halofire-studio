import test from 'node:test'
import assert from 'node:assert/strict'

import { flowGpm, pressureForFlow } from './kFactor.mjs'

test('flowGpm returns K times the square root of pressure', () => {
  assert.equal(flowGpm(100, 100), 1000)
})

test('pressureForFlow returns the squared flow-to-K ratio', () => {
  assert.equal(pressureForFlow(100, 1000), 100)
})

test('flowGpm and pressureForFlow are inverse relationships', () => {
  const pressurePsi = pressureForFlow(5.6, 28)
  assert.equal(pressurePsi, 25)
  assert.equal(flowGpm(5.6, pressurePsi), 28)
})
