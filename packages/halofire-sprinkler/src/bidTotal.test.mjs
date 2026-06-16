import test from 'node:test'
import assert from 'node:assert/strict'

import { bidTotal } from './bidTotal.mjs'

test('bidTotal returns cost and sell from material labor and margin inputs', () => {
  assert.deepEqual(
    bidTotal({
      materialUsd: 100,
      laborHours: 5,
      laborRateUsd: 30,
      marginPct: 20,
    }),
    { cost: 250, sell: 300 },
  )
})

test('bidTotal returns zero totals when material labor and margin are zero', () => {
  assert.deepEqual(
    bidTotal({
      materialUsd: 0,
      laborHours: 0,
      laborRateUsd: 0,
      marginPct: 0,
    }),
    { cost: 0, sell: 0 },
  )
})

test('bidTotal applies labor and margin for extended bid totals', () => {
  assert.deepEqual(
    bidTotal({
      materialUsd: 200,
      laborHours: 10,
      laborRateUsd: 25,
      marginPct: 15,
    }),
    { cost: 450, sell: 517.5 },
  )
})
