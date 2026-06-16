import test from 'node:test'
import assert from 'node:assert/strict'

import * as checkCoverageModule from './checkCoverage.mjs'
import { checkCoverage } from './checkCoverage.mjs'

test('exports only checkCoverage from the ESM module', () => {
  assert.deepEqual(Object.keys(checkCoverageModule), ['checkCoverage'])
  assert.equal(typeof checkCoverageModule.checkCoverage, 'function')
  assert.equal('default' in checkCoverageModule, false)
})

test('returns ok for in-range light hazard spacing', () => {
  assert.deepEqual(checkCoverage(18, 'light'), { ok: true, violations: [] })
})

test('reports oversized light hazard spacing', () => {
  assert.deepEqual(checkCoverage(25, 'light'), {
    ok: false,
    violations: ['head spacing too large'],
  })
})

test('reports undersized extra hazard spacing', () => {
  assert.deepEqual(checkCoverage(8, 'extra'), {
    ok: false,
    violations: ['head spacing too small'],
  })
})

test('accepts boundary values', () => {
  assert.deepEqual(checkCoverage(15, 'light'), { ok: true, violations: [] })
  assert.deepEqual(checkCoverage(20, 'ordinary'), { ok: true, violations: [] })
  assert.deepEqual(checkCoverage(10, 'extra'), { ok: true, violations: [] })
  assert.deepEqual(checkCoverage(15, 'extra'), { ok: true, violations: [] })
})

test('throws TypeError for invalid spacing inputs', () => {
  assert.throws(() => checkCoverage(0, 'light'), TypeError)
  assert.throws(() => checkCoverage(-1, 'light'), TypeError)
  assert.throws(() => checkCoverage(Number.NaN, 'light'), TypeError)
  assert.throws(() => checkCoverage('18', 'light'), TypeError)
})

test('throws TypeError for invalid hazard class inputs', () => {
  assert.throws(() => checkCoverage(18, 'ordinary_i'), TypeError)
  assert.throws(() => checkCoverage(18, 'LIGHT'), TypeError)
  assert.throws(() => checkCoverage(18, ''), TypeError)
})
