import { describe, expect, test } from 'bun:test'

import { _internals } from '../SystemOptimizer'

describe('SystemOptimizer.nextSize', () => {
  test('steps exactly one schedule up', () => {
    expect(_internals.nextSize(1)).toBe(1.25)
    expect(_internals.nextSize(1.25)).toBe(1.5)
    expect(_internals.nextSize(1.5)).toBe(2)
    expect(_internals.nextSize(2)).toBe(2.5)
  })

  test('between sizes rounds up to the next standard', () => {
    // 0.9 → 1 (next in PIPE_SIZES ≥ 0.9)
    expect(_internals.nextSize(0.9)).toBe(1.25)
  })

  test('top-of-range or nullish returns null', () => {
    expect(_internals.nextSize(8)).toBeNull()
    expect(_internals.nextSize(99)).toBeNull()
    expect(_internals.nextSize(null)).toBeNull()
    expect(_internals.nextSize(undefined)).toBeNull()
  })
})
