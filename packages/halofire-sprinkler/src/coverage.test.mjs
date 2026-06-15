import test from 'node:test'
import assert from 'node:assert/strict'

import { headsForArea, maxCoverageSqFtPerHead } from './coverage.mjs'

test('maxCoverageSqFtPerHead returns the static NFPA coverage cap per hazard class', () => {
  assert.equal(maxCoverageSqFtPerHead('Light'), 150)
  assert.equal(maxCoverageSqFtPerHead('Ordinary'), 125)
  assert.equal(maxCoverageSqFtPerHead('Extra'), 100)
})

test('headsForArea divides area by the hazard-class max coverage', () => {
  assert.equal(headsForArea(300, 'Light'), 2)
  assert.equal(headsForArea(250, 'Ordinary'), 2)
  assert.equal(headsForArea(500, 'Extra'), 5)
})

test('unknown hazard classes fail explicitly', () => {
  assert.throws(() => maxCoverageSqFtPerHead('Residential'), {
    name: 'RangeError',
    message: 'Unknown hazard class: Residential',
  })
})
