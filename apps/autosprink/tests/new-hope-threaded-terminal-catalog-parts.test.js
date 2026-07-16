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
    })
    expect(result.parts).toEqual([
      expect.objectContaining({
        figure: '3201',
        purchaseProductNumber: '0840000004',
        nominalSizesIn: [1, 1],
        publishedDimensionsIn: { centerToEndA: 1.5 },
      }),
      expect.objectContaining({
        figure: '3221R',
        purchaseProductNumber: '0840010763',
        nominalSizesIn: [1, 0.75],
        publishedDimensionsIn: { overallLengthA: 1.69 },
      }),
    ])
    expect(result.catalogPartIdentityReady).toBe(true)
    expect(result.manufacturerPrimaryDimensionsReady).toBe(true)
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

    const falseGreen = structuredClone(source)
    falseGreen.modelingBoundary.exactFittingTakeoutReady = true
    const blocked = evaluateNewHopeThreadedTerminalCatalogParts(falseGreen)
    expect(blocked.blockerCodes).toContain('NH_TERMINAL_CATALOG_BOUNDARY_INVALID')
    expect(blocked.catalogPartIdentityReady).toBe(false)
    expect(blocked.exactFittingTakeoutReady).toBe(false)
  })
})
