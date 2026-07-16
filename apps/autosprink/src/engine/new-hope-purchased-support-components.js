const EXPECTED_QUOTE_SHA = '844981467740F66D9847B356C2B44BE7CB8D0F77825B453E40C9FACD3B1659DB'

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

  const boundary = source.modelingBoundary
  if (
    boundary?.purchaseIdentityReady !== true ||
    boundary?.genericSupportSubstitutionAllowed !== false ||
    boundary?.manufacturerExactCadAcquired !== false ||
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
    exactManufacturerGeometryReady: false,
    exactThreadSolidsReady: false,
    verifiedMatingAssembliesReady: false,
    blenderInstalledSupportGeometryReady: false,
    supportModelReleaseReady: false,
  }
}
