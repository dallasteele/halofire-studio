import test from 'node:test'
import assert from 'node:assert/strict'

import { headsForArea, maxCoverageSqFtPerHead } from './coverage.mjs'

test('returns the NFPA coverage cap for Light hazard', () => {
  assert.equal(maxCoverageSqFtPerHead('Light'), 150)
})

test('returns the NFPA coverage cap for Ordinary hazard', () => {
  assert.equal(maxCoverageSqFtPerHead('Ordinary'), 175)
})

test('returns the NFPA coverage cap for Extra hazard', () => {
  assert.equal(maxCoverageSqFtPerHead('Extra'), 225)
})

test('rejects unknown hazard classes', () => {
  assert.throws(
    () => maxCoverageSqFtPerHead('Residential'),
    /Unknown hazard class: Residential/,
  )
})

test('rounds up head count for partial Ordinary coverage', () => {
  assert.equal(headsForArea(1000, 'Ordinary'), 6)
})

test('returns the exact head count when area divides evenly', () => {
  assert.equal(headsForArea(300, 'Light'), 2)
})
