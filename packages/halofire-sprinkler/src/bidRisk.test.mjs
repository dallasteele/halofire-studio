import test from 'node:test'
import assert from 'node:assert/strict'

import { bidRiskFlags } from './bidRisk.mjs'

test('bidRiskFlags returns neutral risk at the benchmark total', () => {
  assert.deepEqual(
    bidRiskFlags({ sellUsd: 1000, benchmarkUsdPerHead: 10, heads: 100 }),
    { underbid: false, overbid: false, deltaPct: 0 },
  )
})
