import assert from 'node:assert/strict'
import test from 'node:test'

import { hydraulicReport } from './nfpaReport.mjs'

test('hydraulicReport returns the accepted rounded NFPA report shape', () => {
  assert.deepStrictEqual(
    hydraulicReport({ demandGpm: 10, demandPsi: 20, safetyMarginPct: 10 }),
    {
      demandGpm: 10,
      demandPsi: 20,
      safetyMarginPct: 10,
      requiredPressurePsi: 22,
      totalPressurePsi: 42,
      flowRateGpm: 10,
      pressureDropPsi: 20,
    },
  )
})

test('hydraulicReport rounds all derived and passthrough values to 2 decimals', () => {
  assert.deepStrictEqual(
    hydraulicReport({
      demandGpm: 10.126,
      demandPsi: 20.555,
      safetyMarginPct: 10.444,
    }),
    {
      demandGpm: 10.13,
      demandPsi: 20.56,
      safetyMarginPct: 10.44,
      requiredPressurePsi: 22.7,
      totalPressurePsi: 43.26,
      flowRateGpm: 10.13,
      pressureDropPsi: 20.56,
    },
  )
})
