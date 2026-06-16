import assert from 'node:assert/strict'
import test from 'node:test'

import { bidRiskFlags } from './bidRisk.mjs'

test('bidRiskFlags returns neutral risk at the benchmark total', () => {
  assert.deepEqual(
    bidRiskFlags({ sellUsd: 1000, benchmarkUsdPerHead: 10, heads: 100 }),
    { underbid: false, overbid: false, deltaPct: 0 },
  )
})

test('bidRiskFlags flags an underbid below the benchmark total', () => {
  assert.deepEqual(
    bidRiskFlags({ sellUsd: 950, benchmarkUsdPerHead: 10, heads: 100 }),
    { underbid: true, overbid: false, deltaPct: -5 },
  )
})

test('bidRiskFlags flags an overbid above the benchmark total', () => {
  assert.deepEqual(
    bidRiskFlags({ sellUsd: 1050, benchmarkUsdPerHead: 10, heads: 100 }),
    { underbid: false, overbid: true, deltaPct: 5 },
  )
})
