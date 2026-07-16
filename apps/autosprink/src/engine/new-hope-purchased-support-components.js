const EXPECTED_QUOTE_SHA = '844981467740F66D9847B356C2B44BE7CB8D0F77825B453E40C9FACD3B1659DB'
const EXPECTED_VICTAULIC_ARCHIVE_SHA = 'B467AFEF240738F478E5C55F48639064B66AD9036D103FE7F7D2FC7034A20495'

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

  const boundary = source.modelingBoundary
  if (
    boundary?.purchaseIdentityReady !== true ||
    boundary?.genericSupportSubstitutionAllowed !== false ||
    boundary?.manufacturerExactCadAcquired !== false ||
    boundary?.manufacturerAuthoredAb2SourceAcquired !== true ||
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
    },
    purchaseIdentityReady: purchaseReady,
    manufacturerAuthoredAb2SourceAcquired: purchaseReady,
    manufacturerCadCoverageComplete: false,
    exactManufacturerGeometryReady: false,
    exactThreadSolidsReady: false,
    verifiedMatingAssembliesReady: false,
    blenderInstalledSupportGeometryReady: false,
    supportModelReleaseReady: false,
  }
}
