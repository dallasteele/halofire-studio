import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateNewHopePurchasedSupportComponents } from '../src/engine/new-hope-purchased-support-components.js'

const source = JSON.parse(
  fs.readFileSync(
    new URL('../src/data/new-hope-purchased-support-components.json', import.meta.url),
    'utf8',
  ),
)

describe('New Hope purchased support components', () => {
  it('binds all purchased support lines while excluding non-exact geometry', () => {
    const result = evaluateNewHopePurchasedSupportComponents(source)
    expect(result.status).toBe('purchase-identity-passed-model-blocked')
    expect(result.issues).toEqual([])
    expect(result.metrics).toEqual({
      purchasedSupportLineCount: 16,
      purchasedSupportUnitCount: 977,
    })
    expect(result.purchaseIdentityReady).toBe(true)
    expect(result.manufacturerAuthoredAb2SourceAcquired).toBe(true)
    expect(result.manufacturerCadCoverageComplete).toBe(false)
    expect(result.exactManufacturerGeometryReady).toBe(false)
    expect(result.exactThreadSolidsReady).toBe(false)
    expect(result.verifiedMatingAssembliesReady).toBe(false)
    expect(result.blenderInstalledSupportGeometryReady).toBe(false)
    expect(result.supportModelReleaseReady).toBe(false)
  })

  it('rejects missing lines, quantity drift, generic substitution, and false geometry promotion', () => {
    const missing = structuredClone(source)
    missing.components.pop()
    expect(evaluateNewHopePurchasedSupportComponents(missing).blockerCodes).toContain(
      'NH_SUPPORT_PURCHASE_LINE_INVALID',
    )

    const drift = structuredClone(source)
    drift.components[0].quantity = 151
    expect(evaluateNewHopePurchasedSupportComponents(drift).blockerCodes).toContain(
      'NH_SUPPORT_PURCHASE_LINE_INVALID',
    )

    const generic = structuredClone(source)
    generic.approvedSubmittalControl.geometryInterchangeableWithoutProductSpecificEvidence = true
    expect(evaluateNewHopePurchasedSupportComponents(generic).blockerCodes).toContain(
      'NH_SUPPORT_SUBMITTAL_SUBSTITUTION_INVALID',
    )

    const falseGreen = structuredClone(source)
    falseGreen.modelingBoundary.exactThreadSolidsReady = true
    const result = evaluateNewHopePurchasedSupportComponents(falseGreen)
    expect(result.blockerCodes).toContain('NH_SUPPORT_MODELING_BOUNDARY_INVALID')
    expect(result.supportModelReleaseReady).toBe(false)

    const badArchive = structuredClone(source)
    badArchive.manufacturerCadAcquisition.sourceArchive.sha256 = 'BAD'
    expect(evaluateNewHopePurchasedSupportComponents(badArchive).blockerCodes).toContain(
      'NH_SUPPORT_AB2_CAD_SOURCE_INVALID',
    )

    const badRfa = structuredClone(source)
    badRfa.manufacturerCadAcquisition.sourceFiles[0].sha256 = 'BAD'
    expect(evaluateNewHopePurchasedSupportComponents(badRfa).blockerCodes).toContain(
      'NH_SUPPORT_AB2_CAD_SOURCE_INVALID',
    )

    const unverifiedPromotion = structuredClone(source)
    unverifiedPromotion.manufacturerCadAcquisition.geometryExtractionVerified = true
    expect(
      evaluateNewHopePurchasedSupportComponents(unverifiedPromotion).blockerCodes,
    ).toContain('NH_SUPPORT_AB2_CAD_VERIFICATION_BOUNDARY_INVALID')
  })
})
