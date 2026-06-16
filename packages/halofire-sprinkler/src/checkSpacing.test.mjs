import test from 'node:test'
import assert from 'node:assert/strict'

import { checkSpacing } from './checkSpacing.mjs'

test('returns ok when light hazard spacing is within limits', () => {
  assert.deepEqual(checkSpacing([[0, 0], [16, 0]], 'light'), {
    ok: true,
    tooClose: [],
    tooFar: [],
  })
})

test('marks heads too far apart for light hazard spacing', () => {
  assert.deepEqual(checkSpacing([[0, 0], [25, 0]], 'light'), {
    ok: false,
    tooClose: [],
    tooFar: [0, 1],
  })
})

test('marks heads too close together for extra hazard spacing', () => {
  assert.deepEqual(checkSpacing([[0, 0], [8, 0]], 'extra'), {
    ok: false,
    tooClose: [0, 1],
    tooFar: [],
  })
})

test('treats ordinary hazard like light hazard limits', () => {
  assert.deepEqual(checkSpacing([[0, 0], [15, 0]], 'ordinary'), {
    ok: true,
    tooClose: [],
    tooFar: [],
  })
})

test('collects unique head indices across multiple out-of-range pairs', () => {
  assert.deepEqual(checkSpacing([[0, 0], [9, 0], [30, 0]], 'extra'), {
    ok: false,
    tooClose: [0, 1],
    tooFar: [0, 1, 2],
  })
})

test('throws on invalid head coordinates input', () => {
  assert.throws(() => checkSpacing('bad', 'light'), TypeError)
  assert.throws(() => checkSpacing([[0, 'x']], 'light'), TypeError)
  assert.throws(() => checkSpacing([[0]], 'light'), TypeError)
})

test('throws on invalid hazard class input', () => {
  assert.throws(() => checkSpacing([[0, 0], [16, 0]], 'ordinary_i'), TypeError)
})
