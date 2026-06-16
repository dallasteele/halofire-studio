import test from 'node:test'
import assert from 'node:assert/strict'

import { checkCoverage } from './checkCoverage.mjs'

test('returns ok for 18ft light hazard spacing', () => {
  assert.deepEqual(checkCoverage(18, 'light'), { ok: true, violations: [] })
})

test('reports oversized coverage for 25ft light hazard spacing', () => {
  assert.deepEqual(checkCoverage(25, 'light'), {
    ok: false,
    violations: ['head spacing too large'],
  })
})

test('reports undersized coverage for 8ft extra hazard spacing', () => {
  assert.deepEqual(checkCoverage(8, 'extra'), {
    ok: false,
    violations: ['head spacing too small'],
  })
})

test('throws TypeError for non-number spacing input', () => {
  assert.throws(() => checkCoverage('18', 'light'), TypeError)
})

test('throws TypeError for invalid hazardClass input', () => {
  assert.throws(() => checkCoverage(18, 'ordinary_i'), TypeError)
})
