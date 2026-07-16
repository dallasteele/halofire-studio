const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_QUOTE_SHA = 'B663D9C2492F50C244D83B886556CF5E5C09F6005325BCF670C906C66D1D6014'

const EXPECTED_PARTS = Object.freeze({
  'asc-sci-3201-1in-black': {
    role: 'threaded-90-elbow',
    nativeAutoSprinkItemCode: 1096,
    purchaseDescription: 'DI 1 90 SCREWED BEND',
    purchaseProductNumber: '0840000004',
    purchasedQuantity: 57,
    figure: '3201',
    nominalSizesIn: [1, 1],
    primaryDimensionKey: 'centerToEndA',
    primaryDimensionIn: 1.5,
    publishedWeightLb: 0.62,
    officialImageSha256: '42840C46CDB8A9313E331C9FA6219E7CF24E8C0A529E3C195CD7EA5FD4D0EA56',
  },
  'asc-sci-3221r-1x3_4-black': {
    role: 'threaded-reducer',
    nativeAutoSprinkItemCode: 1149,
    purchaseDescription: 'DI 1X3/4 SCREWED RED CPLG',
    purchaseProductNumber: '0840010763',
    purchasedQuantity: 18,
    figure: '3221R',
    nominalSizesIn: [1, 0.75],
    primaryDimensionKey: 'overallLengthA',
    primaryDimensionIn: 1.69,
    publishedWeightLb: 0.53,
    officialImageSha256: '059351AB29BC76A52F6042CAF36097FD9041E4D66D8D7E105C8DD3AF6BA4262B',
  },
})

const issue = (code, message, entityId = null) => ({
  severity: 'blocking',
  code,
  message,
  entityId,
})

/**
 * Validate the project purchase-to-manufacturer crosswalk for the two New Hope
 * terminal fitting families. This deliberately proves component identity and
 * one published primary dimension per part; it does not infer installation
 * takeout or a manufacturing-exact secondary envelope.
 */
export function evaluateNewHopeThreadedTerminalCatalogParts(source = {}) {
  const issues = []

  if (
    source.projectId !== EXPECTED_PROJECT_ID ||
    source.artifactType !== 'halofire.new-hope-threaded-terminal-catalog-parts.v1'
  ) {
    issues.push(
      issue(
        'NH_TERMINAL_CATALOG_PROJECT_INVALID',
        'The catalog crosswalk must remain bound to the New Hope v1 evidence artifact.',
      ),
    )
  }
  const purchase = source.projectPurchaseEvidence
  if (
    purchase?.sha256 !== EXPECTED_QUOTE_SHA ||
    purchase?.quoteNumber !== '0133820' ||
    purchase?.quoteDate !== '2025-02-21' ||
    purchase?.physicalPage !== 2 ||
    purchase?.pageCount !== 3
  ) {
    issues.push(
      issue(
        'NH_TERMINAL_CATALOG_QUOTE_INVALID',
        'The exact New Hope fabrication quote identity and page evidence must match.',
      ),
    )
  }

  const partById = new Map((source.parts || []).map((part) => [part.catalogPartId, part]))
  const resolvedParts = []
  for (const [catalogPartId, expected] of Object.entries(EXPECTED_PARTS)) {
    const part = partById.get(catalogPartId)
    if (
      part?.role !== expected.role ||
      part?.nativeAutoSprinkItemCode !== expected.nativeAutoSprinkItemCode ||
      part?.purchaseDescription !== expected.purchaseDescription ||
      part?.purchaseProductNumber !== expected.purchaseProductNumber ||
      part?.purchasedQuantity !== expected.purchasedQuantity ||
      part?.manufacturer !== 'ASC Engineered Solutions' ||
      part?.brand !== 'SCI' ||
      part?.figure !== expected.figure ||
      JSON.stringify(part?.nominalSizesIn) !== JSON.stringify(expected.nominalSizesIn) ||
      part?.connection !== 'FNPT x FNPT' ||
      part?.material !== 'ASTM A536 Grade 65-45-12 ductile iron' ||
      part?.finish !== 'black' ||
      part?.maxWorkingPressurePsi !== 500 ||
      part?.publishedDimensionsIn?.[expected.primaryDimensionKey] !== expected.primaryDimensionIn ||
      part?.publishedWeightLb !== expected.publishedWeightLb ||
      part?.officialImageSha256 !== expected.officialImageSha256 ||
      !part?.officialProductUrl?.startsWith('https://') ||
      !part?.officialSubmittalUrl?.startsWith('https://')
    ) {
      issues.push(
        issue(
          'NH_TERMINAL_CATALOG_PART_INVALID',
          `${catalogPartId} must retain its exact quote, ASC/SCI identity, and published primary dimension.`,
          catalogPartId,
        ),
      )
      continue
    }
    resolvedParts.push({
      catalogPartId,
      role: part.role,
      nativeAutoSprinkItemCode: part.nativeAutoSprinkItemCode,
      manufacturer: part.manufacturer,
      brand: part.brand,
      figure: part.figure,
      purchaseProductNumber: part.purchaseProductNumber,
      nominalSizesIn: part.nominalSizesIn,
      publishedDimensionsIn: part.publishedDimensionsIn,
      officialProductUrl: part.officialProductUrl,
      officialSubmittalUrl: part.officialSubmittalUrl,
    })
  }

  const boundary = source.modelingBoundary
  if (
    boundary?.manufacturerPartIdentityReady !== true ||
    boundary?.manufacturerPrimaryDimensionsReady !== true ||
    boundary?.officialProductImageProfileReady !== true ||
    boundary?.manufacturerSecondaryEnvelopeReady !== false ||
    boundary?.exactInternalThreadFormReady !== false ||
    boundary?.exactThreadEngagementReady !== false ||
    boundary?.exactFittingTakeoutReady !== false
  ) {
    issues.push(
      issue(
        'NH_TERMINAL_CATALOG_BOUNDARY_INVALID',
        'The catalog proof must keep secondary envelope, thread form, engagement, and installed takeout fail-closed.',
      ),
    )
  }

  const ready = issues.length === 0 && resolvedParts.length === 2
  return {
    artifactType: 'halofire.new-hope-threaded-terminal-catalog-parts-result.v1',
    projectId: source.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    parts: ready ? resolvedParts : [],
    metrics: {
      catalogPartCount: ready ? 2 : 0,
      quoteBoundPartCount: ready ? 2 : 0,
      manufacturerPrimaryDimensionCount: ready ? 2 : 0,
    },
    catalogPartIdentityReady: ready,
    manufacturerPrimaryDimensionsReady: ready,
    blenderCatalogComponentGeometryReady: false,
    manufacturerSecondaryEnvelopeReady: false,
    exactInternalThreadFormReady: false,
    exactThreadEngagementReady: false,
    exactFittingTakeoutReady: false,
    exactBuildingPlacementReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  }
}
