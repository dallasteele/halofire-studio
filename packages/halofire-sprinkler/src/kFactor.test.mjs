import test from 'node:test'
import assert from 'node:assert/strict'

import { flowGpm, pressureForFlow } from './kFactor.mjs'

test('flowGpm returns K times the square root of pressure', () => {
  assert.equal(flowGpm(100, 100), 1000)
})

test('pressureForFlow returns pressure required for the target flow', () => {
  assert.equal(pressureForFlow(100, 1000), 100)
})
