import { evaluateExactPartAssembly } from '../components/exact-assembly-fit.js'

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_QUOTE_SHA = 'B663D9C2492F50C244D83B886556CF5E5C09F6005325BCF670C906C66D1D6014'
const EXPECTED_ASSEMBLY_REQUIREMENTS_DIGEST =
  '97E184294197ABD9FE62389737FEB040DDE0FE26E1781CA78D194BC382BEF8B6'
const EXPECTED_ASSEMBLY_BLOCKERS = Object.freeze([
  'EXACT_ASSEMBLY_PART_GEOMETRY_UNVERIFIED',
  'EXACT_ASSEMBLY_INSTANCE_COVERAGE_INCOMPLETE',
  'EXACT_ASSEMBLY_CONNECTION_FIT_UNVERIFIED',
  'EXACT_ASSEMBLY_SOLID_KERNEL_RECEIPT_MISSING',
  'EXACT_ASSEMBLY_SCENE_COLLISION_RECEIPT_MISSING',
])

const EXPECTED_PARTS = Object.freeze({
  'asc-sci-3201-1in-black': {
    role: 'threaded-90-elbow',
    nativeAutoSprinkItemCode: 1096,
    purchaseDescription: 'DI 1 90 SCREWED BEND',
    purchaseProductNumber: '0840000004',
    purchasedQuantity: 57,
    figure: '3201',
    terminalAssemblyQuantity: 4,
    nominalSizesIn: [1, 1],
    bodyDimensionStandard: 'ASME B16.3',
    productPageBodyDimensionStandard: 'ASME B16.3',
    bodyDimensionStandardConflict: false,
    officialSubmittalFileName: 'PS-SUB-3201-v01.pdf',
    officialSubmittalByteLength: 467137,
    officialSubmittalSha256: '3BDBAAAFC629808803024E051D4A41D7822E3AF4A98F1286F567C10F795837BD',
    officialSubmittalRevision: 'PS-SUB-3201-v01 20220118',
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
    terminalAssemblyQuantity: 16,
    nominalSizesIn: [1, 0.75],
    bodyDimensionStandard: 'ASME B16.3',
    productPageBodyDimensionStandard: 'ASME B16.14',
    bodyDimensionStandardConflict: true,
    officialSubmittalFileName: 'PS-SUB-3221R-v01.pdf',
    officialSubmittalByteLength: 306382,
    officialSubmittalSha256: 'EC2712780DDE3598100DC83E054269A602249C7B788892FFFA3775D980EAD247',
    officialSubmittalRevision: 'PS-SUB-3221R-v01 20220118',
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

export function buildNewHopeThreadedTerminalExactAssemblyCandidate(source = {}) {
  const verification = source.exactAssemblyVerification || {}
  const expectedByProduct = new Map(
    Object.values(EXPECTED_PARTS).map((part) => [part.purchaseProductNumber, part]),
  )
  const partDefinitions = (source.parts || []).map((part) => ({
    productNumber: part.purchaseProductNumber,
    manufacturer: part.manufacturer,
    model: `${part.brand} Fig. ${part.figure}`,
    requiredQuantity: expectedByProduct.get(part.purchaseProductNumber)?.terminalAssemblyQuantity || 0,
    source: {
      classification: 'unverified-project-source',
      manufacturerPartNumber: null,
      fileSha256: null,
      geometrySha256: null,
      format: null,
      units: verification.coordinateUnits,
      unitScaleVerified: false,
      watertightSolidVerified: false,
      partNumberBound: false,
      publishedDimensionSourceSha256: null,
      dimensionAuditReceiptSha256: null,
      criticalDimensionCount: 0,
      verifiedCriticalDimensionCount: 0,
      maxDimensionResidualIn: null,
      dimensionToleranceIn: null,
    },
    ports: [],
  }))
  return {
    artifactType: 'halofire.exact-part-assembly.v1',
    assemblyId: verification.assemblyId,
    coordinateUnits: verification.coordinateUnits,
    sourceDigestSha256: verification.requirementsDigestSha256,
    requirements: {
      productNumbers: partDefinitions.map((part) => part.productNumber),
      requiredInstalledUnitCount: verification.requiredInstalledUnitCount,
      connectionKinds: verification.requiredConnectionKinds,
      structureAttachmentsRequired: verification.structureAttachmentsRequired,
    },
    partDefinitions,
    instances: verification.installedInstances || [],
    connections: verification.connections || [],
    supports: verification.structureAttachments || [],
    receipts: verification.kernelReceipts || [],
  }
}

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
      part?.bodyDimensionStandard !== expected.bodyDimensionStandard ||
      part?.productPageBodyDimensionStandard !== expected.productPageBodyDimensionStandard ||
      part?.bodyDimensionStandardConflict !== expected.bodyDimensionStandardConflict ||
      part?.officialSubmittalFileName !== expected.officialSubmittalFileName ||
      part?.officialSubmittalByteLength !== expected.officialSubmittalByteLength ||
      part?.officialSubmittalSha256 !== expected.officialSubmittalSha256 ||
      part?.officialSubmittalPageCount !== 1 ||
      part?.officialSubmittalRevision !== expected.officialSubmittalRevision ||
      part?.threadStandard !== 'ASME B1.20.1' ||
      part?.threadForm !== 'NPT' ||
      JSON.stringify(part?.manufacturerTighteningTurnsBeyondHandTight) !==
        JSON.stringify([3, 4]) ||
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
      bodyDimensionStandard: part.bodyDimensionStandard,
      productPageBodyDimensionStandard: part.productPageBodyDimensionStandard,
      bodyDimensionStandardConflict: part.bodyDimensionStandardConflict,
      officialSubmittalFileName: part.officialSubmittalFileName,
      officialSubmittalSha256: part.officialSubmittalSha256,
      officialSubmittalRevision: part.officialSubmittalRevision,
      threadStandard: part.threadStandard,
      threadForm: part.threadForm,
      manufacturerTighteningTurnsBeyondHandTight:
        part.manufacturerTighteningTurnsBeyondHandTight,
      publishedDimensionsIn: part.publishedDimensionsIn,
      officialProductUrl: part.officialProductUrl,
      officialSubmittalUrl: part.officialSubmittalUrl,
    })
  }

  const verification = source.exactAssemblyVerification
  const verificationContractReady =
    verification?.artifactType ===
      'halofire.new-hope-threaded-terminal-exact-assembly-requirements.v1' &&
    verification?.assemblyId === 'new-hope-cmi-threaded-terminal-assembly' &&
    verification?.coordinateUnits === 'inch' &&
    verification?.requirementsDigestSha256 === EXPECTED_ASSEMBLY_REQUIREMENTS_DIGEST &&
    verification?.requiredPartDefinitionCount === 2 &&
    verification?.requiredInstalledUnitCount === 20 &&
    JSON.stringify(verification?.requiredConnectionKinds) === JSON.stringify(['threaded']) &&
    verification?.structureAttachmentsRequired === false &&
    JSON.stringify(verification?.requiredReceiptKinds) ===
      JSON.stringify(['solid-kernel-fit', 'scene-placement-collision']) &&
    ['trustedReceiptDigests', 'trustedGeometryDigests', 'trustedDimensionAuditDigests',
      'trustedThreadStandardSourceDigests', 'trustedThreadGeometryDigests', 'installedInstances',
      'connections', 'structureAttachments', 'kernelReceipts']
      .every((key) => Array.isArray(verification?.[key]) && verification[key].length === 0) &&
    verification?.releaseOnCatalogImagesOrGeneratedProxies === false &&
    verification?.releaseOnUntrustedCallerFlags === false
  if (!verificationContractReady) {
    issues.push(
      issue(
        'NH_TERMINAL_EXACT_ASSEMBLY_REQUIREMENTS_INVALID',
        'The terminal assembly must require two exact part definitions, all twenty installed fittings, threaded fit checks, and trusted solid/scene receipts.',
      ),
    )
  }

  const exactAssemblyFit = evaluateExactPartAssembly(
    buildNewHopeThreadedTerminalExactAssemblyCandidate(source),
    {
      trustedReceiptDigests: verification?.trustedReceiptDigests,
      trustedGeometryDigests: verification?.trustedGeometryDigests,
      trustedDimensionAuditDigests: verification?.trustedDimensionAuditDigests,
      trustedThreadStandardSourceDigests: verification?.trustedThreadStandardSourceDigests,
      trustedThreadGeometryDigests: verification?.trustedThreadGeometryDigests,
    },
  )
  const exactAssemblyGateReady =
    exactAssemblyFit.status === 'blocked' &&
    JSON.stringify(exactAssemblyFit.blockerCodes) === JSON.stringify(EXPECTED_ASSEMBLY_BLOCKERS) &&
    exactAssemblyFit.metrics.requiredPartDefinitionCount === 2 &&
    exactAssemblyFit.metrics.partDefinitionCount === 2 &&
    exactAssemblyFit.metrics.requiredInstalledUnitCount === 20 &&
    exactAssemblyFit.metrics.installedInstanceCount === 0 &&
    exactAssemblyFit.structureAttachmentsRequired === false &&
    exactAssemblyFit.structureAttachmentReady === true &&
    exactAssemblyFit.assemblyReleaseReady === false
  if (!exactAssemblyGateReady) {
    issues.push(
      issue(
        'NH_TERMINAL_EXACT_ASSEMBLY_GATE_INVALID',
        'The reusable exact-part verifier must reject missing body solids, helical NPT, installed placements, mating fit, and trusted kernel receipts.',
      ),
    )
  }

  const boundary = source.modelingBoundary
  if (
    boundary?.manufacturerPartIdentityReady !== true ||
    boundary?.manufacturerPrimaryDimensionsReady !== true ||
    boundary?.officialProductImageProfileReady !== true ||
    boundary?.bodyDimensionStandardsIdentified !== true ||
    boundary?.bodyDimensionStandardConflictResolved !== false ||
    boundary?.threadStandardIdentified !== true ||
    boundary?.completeManufacturingDimensionsAcquired !== false ||
    boundary?.completeStandardThreadTableAcquired !== false ||
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
      exactAssemblyRequiredPartDefinitionCount: ready
        ? exactAssemblyFit.metrics.requiredPartDefinitionCount
        : 0,
      exactAssemblyRequiredInstalledUnitCount: ready
        ? exactAssemblyFit.metrics.requiredInstalledUnitCount
        : 0,
      exactAssemblyInstalledInstanceCount: ready
        ? exactAssemblyFit.metrics.installedInstanceCount
        : 0,
    },
    catalogPartIdentityReady: ready,
    manufacturerPrimaryDimensionsReady: ready,
    bodyDimensionStandardsIdentified: ready,
    bodyDimensionStandardConflictResolved: false,
    threadStandardIdentified: ready,
    exactAssemblyBlockerCodes: exactAssemblyFit.blockerCodes,
    exactAssemblyPartDefinitionsReady: false,
    exactAssemblySourceTrustReady: false,
    exactAssemblyInstalledInstanceCoverageReady: false,
    exactAssemblyConnectionFitReady: false,
    exactAssemblySolidKernelReceiptReady: false,
    exactAssemblySceneCollisionReceiptReady: false,
    exactAssemblyReleaseReady: false,
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
