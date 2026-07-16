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
      fig69QuoteProductCount: 5,
      fig69PublishedVariantCount: 7,
      sammyCandidateCount: 2,
      sammyOfficialCadArchiveCount: 2,
      sammyInstalledDetailCalloutCount: 2,
      hangerAnchorQuantityParityCount: 212,
      ascSeismicOfficialSourceCount: 4,
      ascSeismicQuoteBoundProductCount: 8,
      ascSeismicDimensionedFamilyCount: 3,
    })
    expect(result.purchaseIdentityReady).toBe(true)
    expect(result.manufacturerAuthoredAb2SourceAcquired).toBe(true)
    expect(result.manufacturerAuthoredFig69SourceAcquired).toBe(true)
    expect(result.manufacturerPublishedFig69DimensionsReady).toBe(true)
    expect(result.projectPipeSizeAssignmentForFig69Ready).toBe(false)
    expect(result.fig69RfaDimensionAuditReady).toBe(false)
    expect(result.exactFig69ThreadSolidReady).toBe(false)
    expect(result.fig69MatingAssemblyReady).toBe(false)
    expect(result.sammyAnchorManufacturerIdentityReady).toBe(false)
    expect(result.manufacturerAuthoredSammyFamilyCadAcquired).toBe(true)
    expect(result.sammyCadLineArtOnly).toBe(true)
    expect(result.sammyProjectSubstrateConflictResolved).toBe(false)
    expect(result.sammyPartNumberSpecificSolidReady).toBe(false)
    expect(result.sammyThreadFormGeometryReady).toBe(false)
    expect(result.hangerAnchorQuantityParityReady).toBe(true)
    expect(result.ascSeismicQuoteVariantIdentityReady).toBe(true)
    expect(result.ascSeismicPublishedAssemblyRulesReady).toBe(true)
    expect(result.ascSeismicPartNumberSpecificSolidCoverageComplete).toBe(false)
    expect(result.ascSeismicFastenerThreadSolidCoverageComplete).toBe(false)
    expect(result.ascSeismicStructureAttachmentVerified).toBe(false)
    expect(result.ascSeismicCollisionAnalysisVerified).toBe(false)
    expect(result.ascSeismicListedAssemblyFitVerified).toBe(false)
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

    const badFig69Rfa = structuredClone(source)
    badFig69Rfa.manufacturerCadAcquisition.fig69.sourceFile.sha256 = 'BAD'
    expect(evaluateNewHopePurchasedSupportComponents(badFig69Rfa).blockerCodes).toContain(
      'NH_SUPPORT_FIG69_SOURCE_INVALID',
    )

    const badFig69Dimension = structuredClone(source)
    badFig69Dimension.components.find(
      (component) => component.productNumber === '0500301767',
    ).publishedVariants[0].bIn = 4.01
    expect(
      evaluateNewHopePurchasedSupportComponents(badFig69Dimension).blockerCodes,
    ).toContain('NH_SUPPORT_FIG69_DIMENSION_INVALID')

    const falseFig69Assignment = structuredClone(source)
    falseFig69Assignment.manufacturerCadAcquisition.fig69.projectPipeSizeAssignmentVerified = true
    expect(
      evaluateNewHopePurchasedSupportComponents(falseFig69Assignment).blockerCodes,
    ).toContain('NH_SUPPORT_FIG69_VERIFICATION_BOUNDARY_INVALID')

    const falseSammyResolution = structuredClone(source)
    falseSammyResolution.manufacturerIdentityConflicts[0].status = 'resolved'
    falseSammyResolution.manufacturerIdentityConflicts[0].selectedManufacturerPartNumber = '8056957'
    falseSammyResolution.manufacturerIdentityConflicts[0].exactGeometryEligible = true
    expect(
      evaluateNewHopePurchasedSupportComponents(falseSammyResolution).blockerCodes,
    ).toContain('NH_SUPPORT_SAMMY_IDENTITY_CONFLICT_INVALID')

    const badAsbuilt = structuredClone(source)
    badAsbuilt.installedDetailControl.sha256 = 'BAD'
    expect(evaluateNewHopePurchasedSupportComponents(badAsbuilt).blockerCodes).toContain(
      'NH_SUPPORT_SAMMY_INSTALLED_DETAIL_CONFLICT_INVALID',
    )

    const falseSubstrateResolution = structuredClone(source)
    falseSubstrateResolution.installedDetailControl.substrateApplicationConflictResolved = true
    expect(
      evaluateNewHopePurchasedSupportComponents(falseSubstrateResolution).blockerCodes,
    ).toContain('NH_SUPPORT_SAMMY_INSTALLED_DETAIL_CONFLICT_INVALID')

    const badSammyCad = structuredClone(source)
    badSammyCad.manufacturerCadAcquisition.sammy.archives[0].sha256 = 'BAD'
    expect(evaluateNewHopePurchasedSupportComponents(badSammyCad).blockerCodes).toContain(
      'NH_SUPPORT_SAMMY_CAD_SOURCE_INVALID',
    )

    const falseSammySolid = structuredClone(source)
    falseSammySolid.manufacturerCadAcquisition.sammy.threeDimensionalSolidVerified = true
    falseSammySolid.manufacturerCadAcquisition.sammy.threadFormGeometryVerified = true
    expect(evaluateNewHopePurchasedSupportComponents(falseSammySolid).blockerCodes).toContain(
      'NH_SUPPORT_SAMMY_CAD_VERIFICATION_BOUNDARY_INVALID',
    )

    const badAscSource = structuredClone(source)
    badAscSource.manufacturerCadAcquisition.ascSeismicBracing.sources[0].sha256 = 'BAD'
    expect(evaluateNewHopePurchasedSupportComponents(badAscSource).blockerCodes).toContain(
      'NH_SUPPORT_ASC_SEISMIC_SOURCE_INVALID',
    )

    const badAscVariant = structuredClone(source)
    badAscVariant.manufacturerCadAcquisition.ascSeismicBracing.sources
      .find((entry) => entry.figure === 'AF730').quoteBoundVariants[0].servicePipeSizeIn = 3
    expect(evaluateNewHopePurchasedSupportComponents(badAscVariant).blockerCodes).toContain(
      'NH_SUPPORT_ASC_SEISMIC_VARIANT_INVALID',
    )

    const badAf779ProductSize = structuredClone(source)
    badAf779ProductSize.manufacturerCadAcquisition.ascSeismicBracing.sources
      .find((entry) => entry.figure === 'AF779').productNumberControl.physicalPage = 107
    expect(evaluateNewHopePurchasedSupportComponents(badAf779ProductSize).blockerCodes).toContain(
      'NH_SUPPORT_AF779_PRODUCT_SIZE_INVALID',
    )

    const badMatingRule = structuredClone(source)
    badMatingRule.manufacturerCadAcquisition.ascSeismicBracing.sources
      .find((entry) => entry.figure === 'AF035')
      .matingRequirements.minimumBracePipeExtensionPastCastHoopsIn = 0.5
    expect(evaluateNewHopePurchasedSupportComponents(badMatingRule).blockerCodes).toContain(
      'NH_SUPPORT_ASC_SEISMIC_MATING_RULE_INVALID',
    )

    const falseAscFit = structuredClone(source)
    falseAscFit.manufacturerCadAcquisition.ascSeismicBracing.sources
      .find((entry) => entry.figure === 'AF076').matingAssemblyVerified = true
    falseAscFit.manufacturerCadAcquisition.ascSeismicBracing.listedAssemblyFitVerified = true
    expect(evaluateNewHopePurchasedSupportComponents(falseAscFit).blockerCodes).toContain(
      'NH_SUPPORT_ASC_SEISMIC_VERIFICATION_BOUNDARY_INVALID',
    )
  })
})
