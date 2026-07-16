const EXPECTED_QUOTE_SHA = '844981467740F66D9847B356C2B44BE7CB8D0F77825B453E40C9FACD3B1659DB'
const EXPECTED_VICTAULIC_ARCHIVE_SHA = 'B467AFEF240738F478E5C55F48639064B66AD9036D103FE7F7D2FC7034A20495'
const EXPECTED_FIG69_RFA_SHA = 'B079BA1D50E1F96279E96561208AAA25918472793F4029B261448A2B0D557F17'
const EXPECTED_FIG69_CATALOG_SHA = '69DDBD5E3C87C50142AABBC71A17B4BE089249FE1858202B4C8F5751D4D91061'

const EXPECTED_AB2_SOURCE_FILES = Object.freeze({
  'Sprinkler-Victaulic-Conc_Pendent_VicFlex-AB2.rfa': {
    byteLength: 1970176,
    sha256: '1B9A437132D846ADE3ED67B5BBEA2D43D1F01D4D9BCD693A64967F0F5E91178C',
  },
  'Sprinkler-Victaulic-Recessed_Pendent_VicFlex-AB2.rfa': {
    byteLength: 3104768,
    sha256: '75F0AAC075483B6EF43F032F59E3A949B109A1759ED7B53CF0B6241D6C0AD27C',
  },
})

const EXPECTED_COMPONENTS = Object.freeze({
  A240AB200N: 152,
  '3/8X10P': 230,
  '0500301692': 25,
  '0500301742': 97,
  '0500301759': 14,
  '0500301767': 48,
  '0500301775': 28,
  'SWDR1-1/2': 212,
  '0502005710': 5,
  '0502005708': 2,
  '0502005712': 1,
  '0502000410': 17,
  '0502000408': 31,
  '0502000414': 1,
  '0500604541': 57,
  '0502000830': 57,
})

const EXPECTED_FIG69_VARIANTS = Object.freeze({
  '0500301692': [
    { pipeSizeIn: 0.5, maxLoadLb: 300, weightLb: 0.1, rodSizeAIn: 0.375, bIn: 2.875, cIn: 2, fIn: 1.5625, gWidthIn: 0.625 },
    { pipeSizeIn: 0.75, maxLoadLb: 300, weightLb: 0.1, rodSizeAIn: 0.375, bIn: 2.75, cIn: 1.875, fIn: 1.3125, gWidthIn: 0.625 },
    { pipeSizeIn: 1, maxLoadLb: 300, weightLb: 0.1, rodSizeAIn: 0.375, bIn: 2.5625, cIn: 1.6875, fIn: 1, gWidthIn: 0.625 },
  ],
  '0500301742': [
    { pipeSizeIn: 1.5, maxLoadLb: 300, weightLb: 0.1, rodSizeAIn: 0.375, bIn: 2.75, cIn: 1.875, fIn: 0.875, gWidthIn: 0.625 },
  ],
  '0500301759': [
    { pipeSizeIn: 2, maxLoadLb: 300, weightLb: 0.11, rodSizeAIn: 0.375, bIn: 3.25, cIn: 2.375, fIn: 1.125, gWidthIn: 0.625 },
  ],
  '0500301767': [
    { pipeSizeIn: 2.5, maxLoadLb: 525, weightLb: 0.2, rodSizeAIn: 0.375, bIn: 4, cIn: 2.75, fIn: 1.3125, gWidthIn: 0.75 },
  ],
  '0500301775': [
    { pipeSizeIn: 3, maxLoadLb: 525, weightLb: 0.2, rodSizeAIn: 0.375, bIn: 3.8125, cIn: 2.9375, fIn: 1.1875, gWidthIn: 0.75 },
  ],
})

const EXPECTED_SAMMY_CANDIDATES = Object.freeze([
  {
    manufacturerPartNumber: '8056957',
    model: 'SWDR 516',
    rodThread: '3/8-16',
    substrateFastenerThread: '5/16-18',
    substrateFastenerLengthIn: 1.25,
    officialProductUrl:
      'https://fastening-solutions.itwbuildex.com/item/sammys-threaded-rod-anchors-3-8-/sammys-3-8-horizontal-threaded-rod-anchor/8056957',
  },
  {
    manufacturerPartNumber: '8054957',
    model: 'SWDR 1-1/2',
    rodThread: '3/8-16',
    substrateFastenerThread: '12-24',
    substrateFastenerLengthIn: 1.5,
    officialProductUrl:
      'https://fastening-solutions.itwbuildex.com/item/sammys-threaded-rod-anchors-3-8-/sammys-3-8-horizontal-threaded-rod-anchor/8054957',
  },
])

const issue = (code, message, entityId = null) => ({
  severity: 'blocking',
  code,
  message,
  entityId,
})

export function evaluateNewHopePurchasedSupportComponents(source = {}) {
  const issues = []
  if (
    source.artifactType !== 'halofire.new-hope-purchased-support-components.v1' ||
    source.projectId !== 'new-hope-crisis-center-brigham-city-ut'
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_PROJECT_INVALID',
        'Support geometry evidence must remain bound to New Hope.',
      ),
    )
  }

  if (
    source.purchaseEvidence?.sha256 !== EXPECTED_QUOTE_SHA ||
    source.purchaseEvidence?.quoteNumber !== '0133821' ||
    source.purchaseEvidence?.quoteDate !== '2025-02-21' ||
    source.purchaseEvidence?.pageCount !== 4
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_QUOTE_INVALID',
        'The exact four-page New Hope loose-material quote must match.',
      ),
    )
  }

  const actual = new Map(
    (source.components || []).map((component) => [component.productNumber, component]),
  )
  for (const [productNumber, quantity] of Object.entries(EXPECTED_COMPONENTS)) {
    const component = actual.get(productNumber)
    if (
      !component ||
      component.quantity !== quantity ||
      !component.family ||
      !component.model ||
      !component.purchasedDescription
    ) {
      issues.push(
        issue(
          'NH_SUPPORT_PURCHASE_LINE_INVALID',
          `${productNumber} must retain its exact quantity and purchased identity.`,
          productNumber,
        ),
      )
    }
  }
  if (actual.size !== Object.keys(EXPECTED_COMPONENTS).length) {
    issues.push(
      issue(
        'NH_SUPPORT_PURCHASE_SET_INVALID',
        'The support manifest cannot omit or add purchase lines.',
      ),
    )
  }

  const control = source.approvedSubmittalControl
  if (
    control?.shownSupport !== 'AFCON 300 ring hanger' ||
    control?.purchaseEquivalent !== 'Anvil Fig. 69 adjustable swivel ring' ||
    control?.geometryInterchangeableWithoutProductSpecificEvidence !== false
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_SUBMITTAL_SUBSTITUTION_INVALID',
        'The AFCON 300 submittal image cannot be substituted for purchased Anvil Fig. 69 geometry.',
      ),
    )
  }

  const identityConflicts = source.manufacturerIdentityConflicts || []
  const sammyConflict = identityConflicts.find(
    (entry) => entry.quoteProductNumber === 'SWDR1-1/2',
  )
  if (
    identityConflicts.length !== 1 ||
    sammyConflict?.quoteDescription !== 'ITW SWDR 516 1-1/2 SIDE STEEL Sammy' ||
    sammyConflict?.manufacturer !== 'ITW Buildex' ||
    sammyConflict?.status !== 'unresolved' ||
    JSON.stringify(sammyConflict?.candidates) !== JSON.stringify(EXPECTED_SAMMY_CANDIDATES) ||
    sammyConflict?.selectedManufacturerPartNumber !== null ||
    sammyConflict?.manufacturerCadAvailable !== true ||
    sammyConflict?.manufacturerCadAcquired !== false ||
    sammyConflict?.exactGeometryEligible !== false
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_SAMMY_IDENTITY_CONFLICT_INVALID',
        'The conflicting SWDR 516 versus SWDR 1-1/2 manufacturer identities must remain explicit and unresolved until project evidence selects one.',
        'SWDR1-1/2',
      ),
    )
  }

  const acquisition = source.manufacturerCadAcquisition
  const acquiredFiles = new Map(
    (acquisition?.sourceFiles || []).map((entry) => [entry.fileName, entry]),
  )
  const invalidAcquiredFile = Object.entries(EXPECTED_AB2_SOURCE_FILES).some(
    ([fileName, expected]) => {
      const actualFile = acquiredFiles.get(fileName)
      return (
        actualFile?.byteLength !== expected.byteLength ||
        actualFile?.sha256 !== expected.sha256
      )
    },
  )
  if (
    acquisition?.officialLibraryUrl !==
      'https://assets.victaulic.com/assets/uploads/software-content/Autodesk_Revit_MEP.html' ||
    acquisition?.sourceArchive?.fileName !== 'Adsk_Revit_FP_Sprinklers.zip' ||
    acquisition?.sourceArchive?.sha256 !== EXPECTED_VICTAULIC_ARCHIVE_SHA ||
    acquisition?.quoteBoundProductNumber !== 'A240AB200N' ||
    acquisition?.manufacturer !== 'Victaulic' ||
    acquisition?.model !== 'VicFlex AB2 24-inch' ||
    acquisition?.manufacturerAuthoredSourceAcquired !== true ||
    acquisition?.sourceFormat !== 'Autodesk Revit family' ||
    acquiredFiles.size !== Object.keys(EXPECTED_AB2_SOURCE_FILES).length ||
    invalidAcquiredFile
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_AB2_CAD_SOURCE_INVALID',
        'The quote-bound AB2 source must retain the exact official Victaulic archive and RFA hashes.',
        'A240AB200N',
      ),
    )
  }
  if (
    acquisition?.geometryExtractionVerified !== false ||
    acquisition?.publishedDimensionAuditVerified !== false ||
    acquisition?.threadSolidVerified !== false ||
    acquisition?.matingAssemblyVerified !== false ||
    acquisition?.installedPlacementVerified !== false
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_AB2_CAD_VERIFICATION_BOUNDARY_INVALID',
        'Acquiring manufacturer files cannot promote extraction, dimensions, threads, mating, or placement without verification evidence.',
        'A240AB200N',
      ),
    )
  }

  const fig69 = acquisition?.fig69
  const fig69ProductNumbers = Object.keys(EXPECTED_FIG69_VARIANTS)
  if (
    fig69?.officialBimCatalogUrl !==
      'https://bim-catalog.asc-es.com/viewitems/ring-hangers-1/fig--69---adjustable-swivel-ring' ||
    fig69?.officialProductUrl !== 'https://www.asc-es.com/products/69-adjustable-swivel-ring' ||
    fig69?.sourceFile?.fileName !== 'Hanger-Swivel_Ring-Anvil-69_60.rfa' ||
    fig69?.sourceFile?.byteLength !== 204352 ||
    fig69?.sourceFile?.sha256 !== EXPECTED_FIG69_RFA_SHA ||
    fig69?.dimensionSource?.fileName !== 'Anvil-Pipe-Hangers-Supports-Submittal-Catalog.pdf' ||
    fig69?.dimensionSource?.byteLength !== 31616364 ||
    fig69?.dimensionSource?.sha256 !== EXPECTED_FIG69_CATALOG_SHA ||
    fig69?.dimensionSource?.physicalPage !== 45 ||
    fig69?.dimensionSource?.revision !== 'PH-1.18' ||
    JSON.stringify(fig69?.quoteBoundProductNumbers) !== JSON.stringify(fig69ProductNumbers) ||
    fig69?.manufacturerAuthoredSourceAcquired !== true ||
    fig69?.publishedDimensionTableAcquired !== true
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_FIG69_SOURCE_INVALID',
        'Fig. 69 evidence must retain the exact official RFA, catalog hash, page, revision, and quote-bound products.',
        'Fig. 69',
      ),
    )
  }
  if (
    fig69?.projectPipeSizeAssignmentVerified !== false ||
    fig69?.rfaDimensionAuditVerified !== false ||
    fig69?.threadSolidVerified !== false ||
    fig69?.matingAssemblyVerified !== false ||
    fig69?.installedPlacementVerified !== false
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_FIG69_VERIFICATION_BOUNDARY_INVALID',
        'Published Fig. 69 dimensions cannot promote project assignment, RFA audit, threads, mating, or placement.',
        'Fig. 69',
      ),
    )
  }

  for (const [productNumber, expectedVariants] of Object.entries(EXPECTED_FIG69_VARIANTS)) {
    const component = actual.get(productNumber)
    if (JSON.stringify(component?.publishedVariants) !== JSON.stringify(expectedVariants)) {
      issues.push(
        issue(
          'NH_SUPPORT_FIG69_DIMENSION_INVALID',
          `${productNumber} must retain every manufacturer-published Fig. 69 size variant and dimension.`,
          productNumber,
        ),
      )
    }
  }

  const boundary = source.modelingBoundary
  if (
    boundary?.purchaseIdentityReady !== true ||
    boundary?.genericSupportSubstitutionAllowed !== false ||
    boundary?.manufacturerExactCadAcquired !== false ||
    boundary?.manufacturerAuthoredAb2SourceAcquired !== true ||
    boundary?.manufacturerAuthoredFig69SourceAcquired !== true ||
    boundary?.manufacturerPublishedFig69DimensionsReady !== true ||
    boundary?.projectPipeSizeAssignmentForFig69Ready !== false ||
    boundary?.fig69RfaDimensionAuditReady !== false ||
    boundary?.exactFig69ThreadSolidReady !== false ||
    boundary?.fig69MatingAssemblyReady !== false ||
    boundary?.sammyAnchorManufacturerIdentityReady !== false ||
    boundary?.manufacturerCadCoverageComplete !== false ||
    boundary?.fullyDimensionedManufacturingDrawingsAcquired !== false ||
    boundary?.exactThreadSolidsReady !== false ||
    boundary?.verifiedMatingAssembliesReady !== false ||
    boundary?.blenderInstalledSupportGeometryReady !== false
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_MODELING_BOUNDARY_INVALID',
        'Every support must remain excluded until exact CAD or complete manufacturing dimensions and mating proof exist.',
      ),
    )
  }

  const purchaseReady = issues.length === 0
  return {
    artifactType: 'halofire.new-hope-purchased-support-components-result.v1',
    status: purchaseReady ? 'purchase-identity-passed-model-blocked' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    metrics: {
      purchasedSupportLineCount: purchaseReady ? Object.keys(EXPECTED_COMPONENTS).length : 0,
      purchasedSupportUnitCount: purchaseReady
        ? Object.values(EXPECTED_COMPONENTS).reduce((sum, value) => sum + value, 0)
        : 0,
      fig69QuoteProductCount: purchaseReady ? Object.keys(EXPECTED_FIG69_VARIANTS).length : 0,
      fig69PublishedVariantCount: purchaseReady
        ? Object.values(EXPECTED_FIG69_VARIANTS).reduce((sum, variants) => sum + variants.length, 0)
        : 0,
    },
    purchaseIdentityReady: purchaseReady,
    manufacturerAuthoredAb2SourceAcquired: purchaseReady,
    manufacturerAuthoredFig69SourceAcquired: purchaseReady,
    manufacturerPublishedFig69DimensionsReady: purchaseReady,
    projectPipeSizeAssignmentForFig69Ready: false,
    fig69RfaDimensionAuditReady: false,
    exactFig69ThreadSolidReady: false,
    fig69MatingAssemblyReady: false,
    sammyAnchorManufacturerIdentityReady: false,
    manufacturerCadCoverageComplete: false,
    exactManufacturerGeometryReady: false,
    exactThreadSolidsReady: false,
    verifiedMatingAssembliesReady: false,
    blenderInstalledSupportGeometryReady: false,
    supportModelReleaseReady: false,
  }
}
