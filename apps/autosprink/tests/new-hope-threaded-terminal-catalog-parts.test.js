import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateNewHopeThreadedTerminalCatalogParts } from '../src/engine/new-hope-threaded-terminal-catalog-parts.js'

const source = JSON.parse(
  fs.readFileSync(
    new URL('../src/data/new-hope-threaded-terminal-catalog-parts.json', import.meta.url),
    'utf8',
  ),
)

describe('New Hope threaded terminal catalog parts', () => {
  it('binds the project quote to the exact ASC/SCI elbow and reducer primary dimensions', () => {
    const result = evaluateNewHopeThreadedTerminalCatalogParts(source)

    expect(result.status).toBe('passed')
    expect(result.issues).toEqual([])
    expect(result.metrics).toEqual({
      catalogPartCount: 2,
      quoteBoundPartCount: 2,
      manufacturerPrimaryDimensionCount: 2,
      exactAssemblyRequiredPartDefinitionCount: 2,
      exactAssemblyRequiredInstalledUnitCount: 20,
      exactAssemblyInstalledInstanceCount: 0,
    })
    expect(result.parts).toEqual([
      expect.objectContaining({
        figure: '3201',
        purchaseProductNumber: '0840000004',
        nominalSizesIn: [1, 1],
        publishedDimensionsIn: { centerToEndA: 1.5 },
        bodyDimensionStandard: 'ASME B16.3',
        threadStandard: 'ASME B1.20.1',
      }),
      expect.objectContaining({
        figure: '3221R',
        purchaseProductNumber: '0840010763',
        nominalSizesIn: [1, 0.75],
        publishedDimensionsIn: { overallLengthA: 1.69 },
        bodyDimensionStandard: 'ASME B16.3',
        productPageBodyDimensionStandard: 'ASME B16.14',
        bodyDimensionStandardConflict: true,
        threadStandard: 'ASME B1.20.1',
      }),
    ])
    expect(result.catalogPartIdentityReady).toBe(true)
    expect(result.manufacturerPrimaryDimensionsReady).toBe(true)
    expect(result.bodyDimensionStandardsIdentified).toBe(true)
    expect(result.bodyDimensionStandardConflictResolved).toBe(false)
    expect(result.threadStandardIdentified).toBe(true)
    expect(result.exactAssemblyBlockerCodes).toEqual([
      'EXACT_ASSEMBLY_PART_GEOMETRY_UNVERIFIED',
      'EXACT_ASSEMBLY_INSTANCE_COVERAGE_INCOMPLETE',
      'EXACT_ASSEMBLY_CONNECTION_FIT_UNVERIFIED',
      'EXACT_ASSEMBLY_SOLID_KERNEL_RECEIPT_MISSING',
      'EXACT_ASSEMBLY_SCENE_COLLISION_RECEIPT_MISSING',
    ])
    expect(result.exactAssemblyPartDefinitionsReady).toBe(false)
    expect(result.exactAssemblyInstalledInstanceCoverageReady).toBe(false)
    expect(result.exactAssemblyConnectionFitReady).toBe(false)
    expect(result.exactAssemblyReleaseReady).toBe(false)
    expect(result.blenderCatalogComponentGeometryReady).toBe(false)
    expect(result.manufacturerSecondaryEnvelopeReady).toBe(false)
    expect(result.exactInternalThreadFormReady).toBe(false)
    expect(result.exactThreadEngagementReady).toBe(false)
    expect(result.exactFittingTakeoutReady).toBe(false)
    expect(result.properPipeLayoutReady).toBe(false)
    expect(result.fabricationReady).toBe(false)
    expect(result.fieldReleaseReady).toBe(false)
  })

  it('fails closed on quote, product, dimension, image, and boundary mutations', () => {
    const badQuote = structuredClone(source)
    badQuote.projectPurchaseEvidence.sha256 = 'BAD'
    expect(evaluateNewHopeThreadedTerminalCatalogParts(badQuote).blockerCodes).toContain(
      'NH_TERMINAL_CATALOG_QUOTE_INVALID',
    )

    const badProduct = structuredClone(source)
    badProduct.parts[0].purchaseProductNumber = '0840000005'
    expect(evaluateNewHopeThreadedTerminalCatalogParts(badProduct).blockerCodes).toContain(
      'NH_TERMINAL_CATALOG_PART_INVALID',
    )

    const badDimension = structuredClone(source)
    badDimension.parts[1].publishedDimensionsIn.overallLengthA = 1.7
    expect(evaluateNewHopeThreadedTerminalCatalogParts(badDimension).blockerCodes).toContain(
      'NH_TERMINAL_CATALOG_PART_INVALID',
    )

    const badImage = structuredClone(source)
    badImage.parts[0].officialImageSha256 = 'BAD'
    expect(evaluateNewHopeThreadedTerminalCatalogParts(badImage).blockerCodes).toContain(
      'NH_TERMINAL_CATALOG_PART_INVALID',
    )

    const badThreadStandard = structuredClone(source)
    badThreadStandard.parts[0].threadStandard = 'nominal-only'
    expect(evaluateNewHopeThreadedTerminalCatalogParts(badThreadStandard).blockerCodes).toContain(
      'NH_TERMINAL_CATALOG_PART_INVALID',
    )

    const badSubmittalHash = structuredClone(source)
    badSubmittalHash.parts[1].officialSubmittalSha256 = 'BAD'
    expect(evaluateNewHopeThreadedTerminalCatalogParts(badSubmittalHash).blockerCodes).toContain(
      'NH_TERMINAL_CATALOG_PART_INVALID',
    )

    const badAssemblyBoundary = structuredClone(source)
    badAssemblyBoundary.exactAssemblyVerification.structureAttachmentsRequired = true
    expect(
      evaluateNewHopeThreadedTerminalCatalogParts(badAssemblyBoundary).blockerCodes,
    ).toContain('NH_TERMINAL_EXACT_ASSEMBLY_REQUIREMENTS_INVALID')

    const fakeTrustedThreadStandard = structuredClone(source)
    fakeTrustedThreadStandard.exactAssemblyVerification.trustedThreadStandardSourceDigests.push(
      'A'.repeat(64),
    )
    expect(
      evaluateNewHopeThreadedTerminalCatalogParts(fakeTrustedThreadStandard).blockerCodes,
    ).toContain('NH_TERMINAL_EXACT_ASSEMBLY_REQUIREMENTS_INVALID')

    const fakeTrustedThreadGeometry = structuredClone(source)
    fakeTrustedThreadGeometry.exactAssemblyVerification.trustedThreadGeometryDigests.push(
      'B'.repeat(64),
    )
    expect(
      evaluateNewHopeThreadedTerminalCatalogParts(fakeTrustedThreadGeometry).blockerCodes,
    ).toContain('NH_TERMINAL_EXACT_ASSEMBLY_REQUIREMENTS_INVALID')

    const falseGreen = structuredClone(source)
    falseGreen.modelingBoundary.exactFittingTakeoutReady = true
    const blocked = evaluateNewHopeThreadedTerminalCatalogParts(falseGreen)
    expect(blocked.blockerCodes).toContain('NH_TERMINAL_CATALOG_BOUNDARY_INVALID')
    expect(blocked.catalogPartIdentityReady).toBe(false)
    expect(blocked.exactFittingTakeoutReady).toBe(false)
  })
})
