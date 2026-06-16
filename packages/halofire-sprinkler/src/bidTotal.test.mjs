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
