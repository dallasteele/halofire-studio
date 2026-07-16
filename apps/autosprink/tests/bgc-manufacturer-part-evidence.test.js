import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  validateBgcManufacturerPartEvidence,
  verifyBgcManufacturerPartAdversarialLoop,
} from '../src/engine/bgc-manufacturer-part-evidence.js'

const packet = JSON.parse(fs.readFileSync(
  new URL('../src/data/bgc-manufacturer-part-evidence.json', import.meta.url),
  'utf8',
))

describe('BGC manufacturer and fabricated-part evidence', () => {
  it('rejects the available 1-inch No. 142 CAD for the 1-1/4-inch gym branches', async () => {
    const result = await validateBgcManufacturerPartEvidence(packet)
    expect(result.status).toBe('passed')
    expect(result.sourceEvidenceReady).toBe(true)
    expect(result.wrongPartRejectionReady).toBe(true)
    expect(packet.wrongPartControls.victaulicNo142.rejectedForBgcGym).toBe(true)
    expect(packet.wrongPartControls.victaulicNo142.sizeCompatible).toBe(false)
    expect(result.gymOutletCatalogIdentityReady).toBe(false)
    expect(result.manufacturerPartSolidVerified).toBe(false)
  })

  it('preserves exact BOM material codes while substitutes and body solids stay unresolved', async () => {
    const result = await validateBgcManufacturerPartEvidence(packet)
    expect(result.status).toBe('passed')
    expect(packet.seismicBraceBom.catalogRows).toEqual([
      { quantity: 18, partNumber: '13520712', description: '1/2 in Fig.980 - 3/8 in Universal Swivel' },
      { quantity: 3, partNumber: 'Y379010020', description: '2 in Fig. 1001 Clamp' },
    ])
    expect(packet.seismicBraceBom.unresolvedEquivalentRowCount).toBe(9)
    expect(result.exactBracketGeometryVerified).toBe(false)
    expect(result.exactThreadGeometryVerified).toBe(false)
    expect(result.matingFitVerified).toBe(false)
  })

  it('passes all adversarial false-promotion and source-drift mutations', async () => {
    const result = await verifyBgcManufacturerPartAdversarialLoop(packet)
    expect(result).toMatchObject({
      status: 'passed',
      mutationCount: 20,
      escapedMutationCount: 0,
    })
  })
})
