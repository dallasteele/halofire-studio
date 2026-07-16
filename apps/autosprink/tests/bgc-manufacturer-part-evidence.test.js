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
    expect(packet.seismicBraceFamilies.fig980).toMatchObject({
      catalogVariant: '980-3/8',
      publishedMountingHoleDIn: 0.4375,
      exactCatalogVariantIdentityReady: true,
      exactBodySolidReady: false,
    })
    expect(packet.seismicBraceFamilies.fig1001).toMatchObject({
      catalogVariant: '1001-2 X 1',
      bracedPipeNominalDiameterIn: 2,
      bracePipeNominalDiameterIn: 1,
      exactCatalogVariantIdentityReady: true,
      exactBodySolidReady: false,
    })
    expect(result.seismicCatalogVariantIdentityReady).toBe(true)
    expect(result.exactBracketGeometryVerified).toBe(false)
    expect(result.exactThreadGeometryVerified).toBe(false)
    expect(result.matingFitVerified).toBe(false)
  })

  it('separates project-wide coupling selections from unresolved gym positions', async () => {
    const result = await validateBgcManufacturerPartEvidence(packet)
    expect(result.status).toBe('passed')
    expect(packet.approvedCandidateFamilies.crossMainCoupling.projectSelectedInventory).toEqual([
      { style: '009N', nominalDiameterIn: 3, quantity: 27, partNumber: 'L03009NPE0' },
      { style: '75', nominalDiameterIn: 3, quantity: 5, partNumber: 'L030075PE0' },
    ])
    expect(result.couplingProjectInventorySelectionReady).toBe(true)
    expect(result.couplingInstalledPositionSelectionReady).toBe(false)
  })

  it('rejects official coupling CAD until every housing is a closed solid and the connections fit', async () => {
    const result = await validateBgcManufacturerPartEvidence(packet)
    expect(result.status).toBe('passed')
    expect(result.manufacturerCadIdentityResolved).toBe(true)
    expect(packet.cadRecoveryAudit.style009NThreeInch).toMatchObject({
      exactBlockResolved: true,
      shellCount: 10,
      closedShellCount: 0,
      solidCount: 0,
      exactSolidVerified: false,
    })
    expect(packet.cadRecoveryAudit.style75ThreeInch).toMatchObject({
      exactBlockResolved: true,
      shellCount: 8,
      closedShellCount: 2,
      solidCount: 0,
      exactSolidVerified: false,
    })
    expect(Object.values(packet.connectionGeometryGates).every((value) => value === false)).toBe(true)
    expect(result.productionCadExportAllowed).toBe(false)
  })

  it('retains exact-dimension outlet candidates without claiming BGC selection or complete solids', async () => {
    const result = await validateBgcManufacturerPartEvidence(packet)
    expect(result.status).toBe('passed')
    expect(result.gymOutletCandidateDimensionEvidenceReady).toBe(true)
    expect(packet.gymGroovedOutletCandidates.meritTypeC).toMatchObject({
      nominalOutletIn: 1.25,
      perfectFitHeaderIn: 3,
      outletLengthIn: 3,
      insideDiameterIn: 1.368,
      outsideDiameterIn: 1.66,
      wallThicknessIn: 0.14,
      projectSelectionVerified: false,
      exactBodySolidReady: false,
    })
    expect(packet.gymGroovedOutletCandidates.sci61cg1).toMatchObject({
      catalogPartNumber: '61CG1012030',
      productNumber: '4360000040',
      projectSelectionVerified: false,
      exactBodySolidReady: false,
    })
  })

  it('passes all adversarial false-promotion and source-drift mutations', async () => {
    const result = await verifyBgcManufacturerPartAdversarialLoop(packet)
    expect(result).toMatchObject({
      status: 'passed',
      mutationCount: 32,
      escapedMutationCount: 0,
    })
  })
})
