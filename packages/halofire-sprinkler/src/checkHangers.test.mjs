import test from 'node:test'
import assert from 'node:assert/strict'

import { checkHangerSpacing } from './checkHangers.mjs'

test('accepts spacing within the 10ft bucket for 1/2in through 1in pipe', () => {
  assert.deepEqual(checkHangerSpacing(9, 0.5), {
    ok: true,
    maxAllowedFt: 10,
  })

  assert.deepEqual(checkHangerSpacing(10, 1), {
    ok: true,
    maxAllowedFt: 10,
  })
})

test('accepts valid 1/8in pipe increments across the supported range', () => {
  assert.deepEqual(checkHangerSpacing(10, 0.625), {
    ok: true,
    maxAllowedFt: 10,
  })

  assert.deepEqual(checkHangerSpacing(15, 1.25), {
    ok: true,
    maxAllowedFt: 15,
  })

  assert.deepEqual(checkHangerSpacing(15, 2), {
    ok: true,
    maxAllowedFt: 15,
  })
})

test('rejects spacing above the 10ft bucket', () => {
  assert.deepEqual(checkHangerSpacing(10.125, 1), {
    ok: false,
    maxAllowedFt: 10,
  })
})

test('rejects spacing above the 15ft bucket for 1.25in through 2in pipe', () => {
  assert.deepEqual(checkHangerSpacing(16, 1.5), {
    ok: false,
    maxAllowedFt: 15,
  })
})

test('returns ok for spacing at or below the 15ft bucket boundary', () => {
  assert.deepEqual(checkHangerSpacing(12, 1.5), {
    ok: true,
    maxAllowedFt: 15,
  })
})

test('throws on invalid spacing input', () => {
  assert.throws(() => checkHangerSpacing(0, 1), TypeError)
  assert.throws(() => checkHangerSpacing(-1, 1), TypeError)
  assert.throws(() => checkHangerSpacing('9', 1), TypeError)
  assert.throws(() => checkHangerSpacing(Number.NaN, 1), TypeError)
})

test('throws on invalid pipe size input', () => {
  assert.throws(() => checkHangerSpacing(9, 0.49), TypeError)
  assert.throws(() => checkHangerSpacing(9, 2.125), TypeError)
  assert.throws(() => checkHangerSpacing(9, 1.2), TypeError)
  assert.throws(() => checkHangerSpacing(9, '1.25'), TypeError)
})
