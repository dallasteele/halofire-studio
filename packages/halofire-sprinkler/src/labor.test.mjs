import test from 'node:test'
import assert from 'node:assert/strict'

import { laborHours } from './labor.mjs'

test('computes total labor hours from multiple item quantities and rates', () => {
  assert.equal(
    laborHours(
      { pipeFt: 120, fittings: 8, heads: 6 },
      { pipeFt: 0.05, fittings: 0.3, heads: 0.8 },
    ),
    13.2,
  )
})

test('treats missing items or missing rates as zero-hour contributors', () => {
  assert.equal(
    laborHours(
      { pipeFt: 80, fittings: 4, hangers: 10, heads: undefined },
      { pipeFt: 0.05, fittings: 0.25 },
    ),
    5,
  )
})

test('stabilizes floating-point math for direct equality checks', () => {
  assert.equal(
    laborHours(
      { branchPipeFt: 3, drops: 7 },
      { branchPipeFt: 0.1, drops: 0.2 },
    ),
    1.7,
  )
})
