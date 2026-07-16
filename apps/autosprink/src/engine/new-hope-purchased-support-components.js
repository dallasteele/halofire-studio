import { evaluateExactPartAssembly } from '../components/exact-assembly-fit.js'

const EXPECTED_QUOTE_SHA = '844981467740F66D9847B356C2B44BE7CB8D0F77825B453E40C9FACD3B1659DB'
const EXPECTED_VICTAULIC_ARCHIVE_SHA = 'B467AFEF240738F478E5C55F48639064B66AD9036D103FE7F7D2FC7034A20495'
const EXPECTED_FIG69_RFA_SHA = 'B079BA1D50E1F96279E96561208AAA25918472793F4029B261448A2B0D557F17'
const EXPECTED_FIG69_CATALOG_SHA = '69DDBD5E3C87C50142AABBC71A17B4BE089249FE1858202B4C8F5751D4D91061'
const EXPECTED_ASBUILT_SHA = 'ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B'
const EXPECTED_ASBUILT_RENDER_SHA = 'A921601967128BC8192CAA20A36149F0A0205497879577950342B5B39405B4A2'

const EXPECTED_SAMMY_CAD_ARCHIVES = Object.freeze({
  'SWDR_IGS.zip': {
    byteLength: 9678,
    sha256: '3FC47622361E3A3DBB98E46B5E2F85487977A7A8ED6EEC8D87B5D0835A2304E5',
  },
  'SWDR_DWG.zip': {
    byteLength: 18849,
    sha256: 'F4DD626997860A4C0A3F0E4D30392712144DE03F8F7E464FFABDFB5146D97547',
  },
})

const EXPECTED_SAMMY_CAD_FILES = Object.freeze({
  'SWDR.igs': {
    byteLength: 99056,
    sha256: 'EF67A6869314B08220F0C2F831B95D5951110E139D36CC8D41FF54BB3EBEF7BA',
  },
  'SWDR.dwg': {
    byteLength: 50920,
    sha256: 'DAD6BCD2C048FF121A68F65E20D4A42F8AB54FC4BCEBC1DA2862DE7CEB5B46EC',
  },
})

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

const EXPECTED_ASC_SEISMIC_SOURCES = Object.freeze({
  AF730: {
    officialProductUrl: 'https://www.asc-es.com/products/af730-longitudinal-lateral-seismic-clamp',
    officialSubmittalUrl: 'https://www.asc-es.com/resource/AF730%20Longitudinal%20%26%20Lateral%20Seismic%20Clamp%20Submittal',
    fileName: 'AF730-submittal.pdf',
    byteLength: 489980,
    sha256: 'D25616C54C860C83D2977C18B56FCD72BEAAE7E8A15F160D94109090AE487A12',
    pageCount: 4,
    revision: 'SS-SUB-AF730-v04 20221228',
    sourceClassification: 'dimensioned-submittal-and-product-views',
  },
  AF035: {
    officialProductUrl: 'https://www.asc-es.com/products/af035-model-k-brace-clamp',
    officialSubmittalUrl: 'https://www.asc-es.com/resource/AF035%20Model%20K%20Brace%20Clamp%20Submittal',
    fileName: 'AF035-submittal.pdf',
    byteLength: 1121589,
    sha256: '9D3B56ED9FA9B201C977D9B7A874208E77DEE780A4817CC31F0DBA724AF3D24F',
    pageCount: 6,
    revision: 'SS-SUB-AF035-v03 20220408',
    sourceClassification: 'installation-and-load-submittal-without-complete-part-dimensions',
  },
  AF076: {
    officialProductUrl: 'https://www.asc-es.com/products/af076-sway-brace-swivel-attachment',
    officialSubmittalUrl: 'https://www.asc-es.com/resource/AF076%20Sway%20Brace%20Swivel%20Attachment%20Submittal',
    fileName: 'AF076-submittal.pdf',
    byteLength: 489529,
    sha256: '8FE56DC39DF9214DD10BBB3D86660C649811FF9B0F110DB423FA9AD49A1D9AB6',
    pageCount: 4,
    revision: 'SS-SUB-AF076-v05 20260421',
    sourceClassification: 'dimensioned-submittal-and-installation-views',
  },
  AF779: {
    officialProductUrl: 'https://www.asc-es.com/products/af779-multi-connector-adapter',
    officialSubmittalUrl: 'https://www.asc-es.com/resource/AF779%20Multi-Connector%20Adapter%20Submittal',
    fileName: 'AF779-submittal.pdf',
    byteLength: 526542,
    sha256: 'D72A8BA0A5393805FA5981B345B8B77439186A6D46F2C63A3871DDD4C475B29A',
    pageCount: 2,
    revision: 'SS-SUB-AF779-v02 20220412',
    sourceClassification: 'dimensioned-submittal-and-installation-views',
  },
})

const EXPECTED_ASC_QUOTE_VARIANTS = Object.freeze({
  AF730: [
    { productNumber: '0502005708', servicePipeSizeIn: 2.5, braceMemberSizeRangeIn: [1, 2], finish: 'plain', quantity: 2, aIn: 9.2, bIn: 1.5, yIn: 1.91 },
    { productNumber: '0502005710', servicePipeSizeIn: 3, braceMemberSizeRangeIn: [1, 2], finish: 'plain', quantity: 5, aIn: 9.8, bIn: 1.5, yIn: 1.91 },
    { productNumber: '0502005712', servicePipeSizeIn: 4, braceMemberSizeRangeIn: [1, 2], finish: 'plain', quantity: 1, aIn: 10.8, bIn: 1.5, yIn: 1.91 },
  ],
  AF035: [
    { productNumber: '0502000408', servicePipeSizeIn: 2.5, braceMemberSizeIn: 1, quantity: 31 },
    { productNumber: '0502000410', servicePipeSizeIn: 3, braceMemberSizeIn: 1, quantity: 17 },
    { productNumber: '0502000414', servicePipeSizeIn: 4, braceMemberSizeIn: 1, quantity: 1 },
  ],
  AF076: [
    { productNumber: '0502000830', braceMemberSizeRangeIn: [1, 2], anchorSizeIn: 0.5, finish: 'plain', quantity: 57 },
  ],
  AF779: [
    { productNumber: '0500604541', catalogSize: 2, mountingBoltIn: 0.5, structureFastenerCount: 2, structureFastenerDiameterIn: 0.5, h1DiameterIn: 0.56, h2DiameterIn: 0.56, finish: 'plain', quantity: 57 },
  ],
})

const EXPECTED_ASC_MATING_REQUIREMENTS = Object.freeze({
  AF730: {
    servicePipeClampRequired: true,
    braceMemberMustBottomAgainstJawBackWall: true,
    braceMemberStandard: 'Schedule 40 NPS pipe',
    torqueOffFastenersRequired: true,
  },
  AF035: {
    servicePipeClampRequired: true,
    braceMemberStandard: 'Schedule 40 NPS pipe',
    minimumBracePipeExtensionPastCastHoopsIn: 1,
    setScrewBottomOutRequired: true,
  },
  AF076: {
    braceMemberMustBottomAgainstJawBackWall: true,
    braceMemberStandard: 'Schedule 40 NPS pipe',
    structureOrListedStructuralAttachmentRequired: true,
    af779ListedCombination: true,
    minimumExposedCrossBoltThreads: 1,
    torqueOffFastenerRequired: true,
  },
  AF779: {
    af076ListedCombination: true,
    twoStructureFastenersRequired: true,
    braceAttachmentThroughH1Required: true,
    structureSubstrateAndFastenerManufacturerEvidenceRequired: true,
  },
})

const EXPECTED_EXACT_ASSEMBLY_REQUIREMENTS_DIGEST =
  'E919A915F430D90B8A2C20922399F080B853C65D94936BD22810D7B8000A3D23'
const EXPECTED_EXACT_ASSEMBLY_BLOCKERS = Object.freeze([
  'EXACT_ASSEMBLY_PART_GEOMETRY_UNVERIFIED',
  'EXACT_ASSEMBLY_INSTANCE_COVERAGE_INCOMPLETE',
  'EXACT_ASSEMBLY_CONNECTION_FIT_UNVERIFIED',
  'EXACT_ASSEMBLY_STRUCTURE_ATTACHMENT_UNVERIFIED',
  'EXACT_ASSEMBLY_SOLID_KERNEL_RECEIPT_MISSING',
  'EXACT_ASSEMBLY_SCENE_COLLISION_RECEIPT_MISSING',
])
const EXPECTED_CAD_CORPUS_DATABASE_SHA =
  '5C2AC127B37D570EDF73F097B1C4EEB1DF338D65F4EF3C8F3046B867C2828546'
const EXPECTED_CAD_CORPUS_QUERY_RECEIPT_SHA =
  '90942136B10470713116CFF57CBD6BB491DA2B5064F21F8310A81704037A05ED'
const EXPECTED_CAD_FILE_COUNTS = Object.freeze({
  '.dwg': 1526,
  '.dxf': 1,
  '.ifc': 3,
  '.rfa': 8,
  '.rvt': 92,
  '.stp': 1,
})
const EXPECTED_ASC_CAD_TARGETS = Object.freeze([
  '0502005710',
  '0502005708',
  '0502005712',
  '0502000410',
  '0502000408',
  '0502000414',
  '0500604541',
  '0502000830',
])

const issue = (code, message, entityId = null) => ({
  severity: 'blocking',
  code,
  message,
  entityId,
})

export function buildNewHopeExactSupportAssemblyCandidate(source = {}) {
  const verification = source.exactAssemblyVerification || {}
  const partDefinitions = (Array.isArray(source.components) ? source.components : []).map(
    (component) => ({
      productNumber: component.productNumber,
      manufacturer: component.manufacturer,
      model: component.model,
      requiredQuantity: component.quantity,
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
    }),
  )
  return {
    artifactType: 'halofire.exact-part-assembly.v1',
    assemblyId: verification.assemblyId,
    coordinateUnits: verification.coordinateUnits,
    sourceDigestSha256: verification.requirementsDigestSha256,
    requirements: {
      productNumbers: partDefinitions.map((part) => part.productNumber),
      requiredInstalledUnitCount: verification.requiredInstalledUnitCount,
      connectionKinds: verification.requiredConnectionKinds,
    },
    partDefinitions,
    instances: verification.installedInstances || [],
    connections: verification.connections || [],
    supports: verification.structureAttachments || [],
    receipts: verification.kernelReceipts || [],
  }
}

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

  const installedDetail = source.installedDetailControl
  if (
    installedDetail?.fileName !== 'New Hope BGC - Brigham City UT_as builts.pdf' ||
    installedDetail?.sha256 !== EXPECTED_ASBUILT_SHA ||
    installedDetail?.byteLength !== 19209229 ||
    installedDetail?.pageCount !== 4 ||
    installedDetail?.physicalPage !== 1 ||
    installedDetail?.sheet !== 'FP0.1' ||
    installedDetail?.renderSha256 !== EXPECTED_ASBUILT_RENDER_SHA ||
    installedDetail?.renderPixelWidth !== 6120 ||
    installedDetail?.renderPixelHeight !== 3960 ||
    JSON.stringify(installedDetail?.callouts) !==
      JSON.stringify(['WOOD SIDE SAMMY SCREW', 'WOOD VERTICAL SAMMY SCREW']) ||
    installedDetail?.detailSubstrate !== 'wood' ||
    installedDetail?.purchaseDescriptionSubstrate !== 'steel' ||
    installedDetail?.substrateApplicationConflictResolved !== false
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_SAMMY_INSTALLED_DETAIL_CONFLICT_INVALID',
        'As-built FP0.1 must retain both wood Sammy details and the unresolved conflict with the purchased side-steel anchor description.',
        'SWDR1-1/2',
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
    sammyConflict?.manufacturerFamilyCadAcquired !== true ||
    sammyConflict?.manufacturerExactPartCadAcquired !== false ||
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

  const sammyCad = acquisition?.sammy
  const sammyArchives = new Map(
    (sammyCad?.archives || []).map((entry) => [entry.fileName, entry]),
  )
  const sammyFiles = new Map(
    (sammyCad?.extractedFiles || []).map((entry) => [entry.fileName, entry]),
  )
  const sammyArchiveInvalid = Object.entries(EXPECTED_SAMMY_CAD_ARCHIVES).some(
    ([fileName, expected]) => {
      const actualFile = sammyArchives.get(fileName)
      return (
        actualFile?.byteLength !== expected.byteLength ||
        actualFile?.sha256 !== expected.sha256
      )
    },
  )
  const sammyFileInvalid = Object.entries(EXPECTED_SAMMY_CAD_FILES).some(
    ([fileName, expected]) => {
      const actualFile = sammyFiles.get(fileName)
      return (
        actualFile?.byteLength !== expected.byteLength ||
        actualFile?.sha256 !== expected.sha256
      )
    },
  )
  if (
    JSON.stringify(sammyCad?.officialProductUrls) !==
      JSON.stringify(EXPECTED_SAMMY_CANDIDATES.map((entry) => entry.officialProductUrl)) ||
    sammyCad?.officialAssetBaseUrl !==
      'https://fastening-solutions.itwbuildex.com/Asset/' ||
    sammyArchives.size !== Object.keys(EXPECTED_SAMMY_CAD_ARCHIVES).length ||
    sammyFiles.size !== Object.keys(EXPECTED_SAMMY_CAD_FILES).length ||
    sammyArchiveInvalid ||
    sammyFileInvalid ||
    sammyCad?.manufacturerAuthoredFamilyCadAcquired !== true ||
    sammyCad?.sourceClassification !== 'line-art-and-application-drawings'
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_SAMMY_CAD_SOURCE_INVALID',
        'The official ITW SWDR family IGS/DWG archives and extracted file hashes must remain exact and explicitly classified as line art.',
        'SWDR1-1/2',
      ),
    )
  }
  if (
    sammyCad?.partNumberSpecificGeometryVerified !== false ||
    sammyCad?.threeDimensionalSolidVerified !== false ||
    sammyCad?.threadFormGeometryVerified !== false ||
    sammyCad?.candidateSelectionResolved !== false ||
    sammyCad?.installedSubstrateApplicationResolved !== false
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_SAMMY_CAD_VERIFICATION_BOUNDARY_INVALID',
        'Family line art cannot promote a candidate identity, substrate application, part-number solid, or thread form.',
        'SWDR1-1/2',
      ),
    )
  }

  const ascSeismic = acquisition?.ascSeismicBracing
  const ascSources = new Map(
    (ascSeismic?.sources || []).map((entry) => [entry.figure, entry]),
  )
  const invalidAscSource = Object.entries(EXPECTED_ASC_SEISMIC_SOURCES).some(
    ([figure, expected]) => {
      const actualSource = ascSources.get(figure)
      return Object.entries(expected).some(
        ([key, value]) => actualSource?.[key] !== value,
      )
    },
  )
  if (
    ascSeismic?.manufacturer !== 'ASC Engineered Solutions / AFCON' ||
    ascSeismic?.officialAssemblyRule !==
      'ASC Engineered Solutions brand bracing components are designed to be compatible only with other ASC Engineered Solutions brand bracing components for a listed seismic bracing assembly.' ||
    ascSeismic?.officialSourceCount !== 4 ||
    ascSources.size !== Object.keys(EXPECTED_ASC_SEISMIC_SOURCES).length ||
    invalidAscSource
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_ASC_SEISMIC_SOURCE_INVALID',
        'AF730, AF035, AF076, and AF779 must retain their exact official ASC product URLs, submittal hashes, page counts, revisions, and source classifications.',
        'ASC seismic bracing',
      ),
    )
  }

  const invalidAscVariant = Object.entries(EXPECTED_ASC_QUOTE_VARIANTS).some(
    ([figure, expected]) =>
      JSON.stringify(ascSources.get(figure)?.quoteBoundVariants) !== JSON.stringify(expected),
  )
  const af779Purchase = actual.get('0500604541')
  if (
    invalidAscVariant ||
    ascSeismic?.quoteVariantIdentityVerified !== true ||
    af779Purchase?.model !==
      'AF779 size 2; 1/2-inch mounting bolt; two 1/2-inch structure fasteners'
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_ASC_SEISMIC_VARIANT_INVALID',
        'Each ASC seismic item must retain its quote-bound service-pipe, brace-pipe, fastener, finish, quantity, and AF779 catalog-size identity.',
        'ASC seismic bracing',
      ),
    )
  }

  const af076 = ascSources.get('AF076')
  const af779 = ascSources.get('AF779')
  const invalidAscMatingRule = Object.entries(EXPECTED_ASC_MATING_REQUIREMENTS).some(
    ([figure, expected]) =>
      JSON.stringify(ascSources.get(figure)?.matingRequirements) !== JSON.stringify(expected),
  )
  if (
    invalidAscMatingRule ||
    JSON.stringify(af076?.publishedDimensionsIn) !==
      JSON.stringify({ a: 1, b: 1.83, c: 1.25, d: 1.38, x: 2.25, l: 4.58, y: 0.762 }) ||
    JSON.stringify(af779?.publishedDimensionsIn) !==
      JSON.stringify({ length: 12, legHeight: 2, legDepth: 2, thickness: 0.25, h2CenterSpacing: 9, h1CenterFromEnd: 6, h2CenterFromEnd: 1.5 }) ||
    ascSeismic?.publishedAssemblyRulesReady !== true
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_ASC_SEISMIC_MATING_RULE_INVALID',
        'ASC mating rules must preserve brace insertion, jaw bottom-out, minimum extension, H1/H2, structure attachment, exposed-thread, and torque-off requirements.',
        'ASC seismic bracing',
      ),
    )
  }

  if (
    af779?.productNumberControl?.officialPriceSheetUrl !==
      'https://s3.us-east-2.amazonaws.com/asc-es.com/price-sheets/pdf/PH-7.21-pdf.pdf' ||
    af779?.productNumberControl?.fileName !== 'ASC-PH-7.21-price-sheet.pdf' ||
    af779?.productNumberControl?.byteLength !== 6091710 ||
    af779?.productNumberControl?.sha256 !==
      '813118B2D9417B6A25D021D1ADAD9064A7EFE3ADA284CB3A0AF5E113735A5DBA' ||
    af779?.productNumberControl?.physicalPage !== 108 ||
    af779?.productNumberControl?.renderSha256 !==
      'E5F896BC48BCFA6C9E32628A868957EF4A97139E949CC51718BB2BC79A4F9CC0' ||
    af779?.productNumberControl?.mapsProductNumberToCatalogSize !== true
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_AF779_PRODUCT_SIZE_INVALID',
        'ASC price-sheet page 108 must continue to map purchased product 0500604541 to AF779 catalog size 2.',
        '0500604541',
      ),
    )
  }

  const falseAscPromotion = [...ascSources.values()].some(
    (entry) =>
      entry?.partNumberSpecificSolidAcquired !== false ||
      entry?.completeManufacturingDimensionsReady !== false ||
      entry?.fastenerThreadGeometryReady !== false ||
      entry?.matingAssemblyVerified !== false,
  )
  if (
    falseAscPromotion ||
    ascSeismic?.partNumberSpecificSolidCoverageComplete !== false ||
    ascSeismic?.completeManufacturingDimensionCoverage !== false ||
    ascSeismic?.fastenerThreadSolidCoverage !== false ||
    ascSeismic?.braceMemberInsertionVerified !== false ||
    ascSeismic?.structureAttachmentVerified !== false ||
    ascSeismic?.collisionAnalysisVerified !== false ||
    ascSeismic?.listedAssemblyFitVerified !== false
  ) {
    issues.push(
      issue(
        'NH_SUPPORT_ASC_SEISMIC_VERIFICATION_BOUNDARY_INVALID',
        'Published ASC dimensions and installation rules cannot promote exact solids, thread geometry, insertion, structure attachment, collisions, or listed assembly fit without CAD-kernel evidence.',
        'ASC seismic bracing',
      ),
    )
  }

  const fig69HangerQuantity = Object.keys(EXPECTED_FIG69_VARIANTS).reduce(
    (sum, productNumber) => sum + (actual.get(productNumber)?.quantity || 0),
    0,
  )
  const sammyAnchorQuantity = actual.get('SWDR1-1/2')?.quantity || 0
  if (fig69HangerQuantity !== 212 || sammyAnchorQuantity !== 212) {
    issues.push(
      issue(
        'NH_SUPPORT_HANGER_ANCHOR_QUANTITY_PARITY_INVALID',
        'The quote must retain 212 Fig. 69 hangers and 212 Sammy anchors without treating quantity parity as installed identity proof.',
      ),
    )
  }

  const exactAssemblyVerification = source.exactAssemblyVerification
  const exactAssemblyRequirementsReady = (
    exactAssemblyVerification?.artifactType ===
      'halofire.new-hope-exact-support-assembly-requirements.v1' &&
    exactAssemblyVerification?.assemblyId === 'new-hope-support-and-seismic-assembly' &&
    exactAssemblyVerification?.coordinateUnits === 'inch' &&
    exactAssemblyVerification?.requirementsDigestSha256 ===
      EXPECTED_EXACT_ASSEMBLY_REQUIREMENTS_DIGEST &&
    exactAssemblyVerification?.requiredPartDefinitionCount === 16 &&
    exactAssemblyVerification?.requiredInstalledUnitCount === 977 &&
    JSON.stringify(exactAssemblyVerification?.requiredConnectionKinds) ===
      JSON.stringify(['threaded', 'brace-insertion', 'clamp', 'bolted']) &&
    JSON.stringify(exactAssemblyVerification?.requiredReceiptKinds) ===
      JSON.stringify(['solid-kernel-fit', 'scene-placement-collision']) &&
    Array.isArray(exactAssemblyVerification?.trustedReceiptDigests) &&
    exactAssemblyVerification.trustedReceiptDigests.length === 0 &&
    Array.isArray(exactAssemblyVerification?.trustedGeometryDigests) &&
    exactAssemblyVerification.trustedGeometryDigests.length === 0 &&
    Array.isArray(exactAssemblyVerification?.trustedDimensionAuditDigests) &&
    exactAssemblyVerification.trustedDimensionAuditDigests.length === 0 &&
    Array.isArray(exactAssemblyVerification?.installedInstances) &&
    exactAssemblyVerification.installedInstances.length === 0 &&
    Array.isArray(exactAssemblyVerification?.connections) &&
    exactAssemblyVerification.connections.length === 0 &&
    Array.isArray(exactAssemblyVerification?.structureAttachments) &&
    exactAssemblyVerification.structureAttachments.length === 0 &&
    Array.isArray(exactAssemblyVerification?.kernelReceipts) &&
    exactAssemblyVerification.kernelReceipts.length === 0 &&
    exactAssemblyVerification?.releaseOnCatalogImagesOrGeneratedProxies === false &&
    exactAssemblyVerification?.releaseOnUntrustedCallerFlags === false
  )
  if (!exactAssemblyRequirementsReady) {
    issues.push(issue(
      'NH_SUPPORT_EXACT_ASSEMBLY_REQUIREMENTS_INVALID',
      'The New Hope assembly gate must retain all 16 part definitions, 977 installed units, four connection kinds, and trusted solid/scene receipt requirements.',
    ))
  }

  const exactAssemblyFit = evaluateExactPartAssembly(
    buildNewHopeExactSupportAssemblyCandidate(source),
    {
      trustedReceiptDigests: exactAssemblyVerification?.trustedReceiptDigests,
      trustedGeometryDigests: exactAssemblyVerification?.trustedGeometryDigests,
      trustedDimensionAuditDigests: exactAssemblyVerification?.trustedDimensionAuditDigests,
    },
  )
  const exactAssemblyGateReady = (
    exactAssemblyFit.status === 'blocked' &&
    JSON.stringify(exactAssemblyFit.blockerCodes) ===
      JSON.stringify(EXPECTED_EXACT_ASSEMBLY_BLOCKERS) &&
    exactAssemblyFit.metrics.requiredPartDefinitionCount === 16 &&
    exactAssemblyFit.metrics.partDefinitionCount === 16 &&
    exactAssemblyFit.metrics.exactPartDefinitionCount === 0 &&
    exactAssemblyFit.metrics.sourceTrustedPartDefinitionCount === 0 &&
    exactAssemblyFit.metrics.requiredInstalledUnitCount === 977 &&
    exactAssemblyFit.metrics.installedInstanceCount === 0 &&
    exactAssemblyFit.metrics.connectionCount === 0 &&
    exactAssemblyFit.metrics.supportAttachmentCount === 0 &&
    exactAssemblyFit.metrics.trustedReceiptCount === 0 &&
    exactAssemblyFit.exactSourceGeometryReady === false &&
    exactAssemblyFit.sourceTrustReady === false &&
    exactAssemblyFit.threadSolidsReady === false &&
    exactAssemblyFit.installedInstanceCoverageReady === false &&
    exactAssemblyFit.connectionFitReady === false &&
    exactAssemblyFit.structureAttachmentReady === false &&
    exactAssemblyFit.solidKernelReceiptReady === false &&
    exactAssemblyFit.sceneCollisionReceiptReady === false &&
    exactAssemblyFit.assemblyReleaseReady === false
  )
  if (!exactAssemblyGateReady) {
    issues.push(issue(
      'NH_SUPPORT_EXACT_ASSEMBLY_GATE_INVALID',
      'The reusable exact-part verifier must reject missing exact solids, threads, installed instances, connection fits, structure attachments, and trusted kernel receipts.',
    ))
  }

  const cadAudit = source.indexedCadSourceAudit
  const ascCadAudit = cadAudit?.ascConnectedContent
  const indexedCadCorpusAuditReady = (
    cadAudit?.artifactType === 'halofire.new-hope-indexed-support-cad-source-audit.v1' &&
    cadAudit?.databasePath === 'E:/ClaudeBot/halofire-autobid/db/halofire_bids.db' &&
    cadAudit?.databaseByteLength === 444063744 &&
    cadAudit?.databaseSha256 === EXPECTED_CAD_CORPUS_DATABASE_SHA &&
    cadAudit?.indexedFileCount === 455150 &&
    JSON.stringify(cadAudit?.cadFileCounts) === JSON.stringify(EXPECTED_CAD_FILE_COUNTS) &&
    cadAudit?.exactTargetFilenameOrPathMatchCount === 0 &&
    cadAudit?.genericProxyCatalogRowCount === 18 &&
    cadAudit?.genericProxiesEligibleForExactGeometry === false &&
    cadAudit?.queryReceiptSha256 === EXPECTED_CAD_CORPUS_QUERY_RECEIPT_SHA &&
    ascCadAudit?.officialLibraryUrl === 'https://www.asc-es.com/asc-connected-content' &&
    ascCadAudit?.multiCadRequestUrl ===
      'https://bim-catalog.asc-es.com/rfc?name=bim-cad-content-library' &&
    JSON.stringify(ascCadAudit?.advertisedThreeDimensionalFormats) ===
      JSON.stringify(['STEP AP214', 'STEP AP203', 'DXF', 'IGES', 'SAT 7.0', 'SAT 3.0', 'VRML', 'VDAFS', 'Revit Family']) &&
    JSON.stringify(ascCadAudit?.quoteProductNumbersSearched) ===
      JSON.stringify(EXPECTED_ASC_CAD_TARGETS) &&
    ascCadAudit?.liveMultiCadMatchCount === 0 &&
    ascCadAudit?.requestRequiresEmail === true &&
    ascCadAudit?.externalRequestAuthorized === false &&
    ascCadAudit?.requestSubmitted === false &&
    ascCadAudit?.exactCadDownloadedCount === 0 &&
    cadAudit?.exactManufacturerCadCoverageReady === false &&
    cadAudit?.odaInspectionReady === false &&
    cadAudit?.solidKernelConversionReady === false
  )
  if (!indexedCadCorpusAuditReady) {
    issues.push(issue(
      'NH_SUPPORT_INDEXED_CAD_SOURCE_AUDIT_INVALID',
      'The 455,150-file indexed corpus and current ASC MultiCAD source audit must stay hash-bound and fail closed until exact manufacturer CAD is acquired.',
    ))
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
    boundary?.manufacturerAuthoredSammyFamilyCadAcquired !== true ||
    boundary?.sammyCadIsLineArtOnly !== true ||
    boundary?.sammyPartNumberSpecificSolidReady !== false ||
    boundary?.sammyProjectSubstrateConflictResolved !== false ||
    boundary?.sammyThreadFormGeometryReady !== false ||
    boundary?.ascSeismicQuoteVariantIdentityReady !== true ||
    boundary?.ascSeismicPublishedAssemblyRulesReady !== true ||
    boundary?.ascSeismicPartNumberSpecificSolidCoverageComplete !== false ||
    boundary?.ascSeismicFastenerThreadSolidCoverageComplete !== false ||
    boundary?.ascSeismicStructureAttachmentVerified !== false ||
    boundary?.ascSeismicCollisionAnalysisVerified !== false ||
    boundary?.ascSeismicListedAssemblyFitVerified !== false ||
    boundary?.exactAssemblyPartDefinitionsReady !== false ||
    boundary?.exactAssemblySourceTrustReady !== false ||
    boundary?.exactAssemblyInstalledInstanceCoverageReady !== false ||
    boundary?.exactAssemblyConnectionFitReady !== false ||
    boundary?.exactAssemblyStructureAttachmentReady !== false ||
    boundary?.exactAssemblySolidKernelReceiptReady !== false ||
    boundary?.exactAssemblySceneCollisionReceiptReady !== false ||
    boundary?.exactAssemblyReleaseReady !== false ||
    boundary?.indexedCadCorpusAuditReady !== true ||
    boundary?.manufacturerCadExternalRequestReady !== false ||
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
      sammyCandidateCount: purchaseReady ? EXPECTED_SAMMY_CANDIDATES.length : 0,
      sammyOfficialCadArchiveCount: purchaseReady
        ? Object.keys(EXPECTED_SAMMY_CAD_ARCHIVES).length
        : 0,
      sammyInstalledDetailCalloutCount: purchaseReady
        ? installedDetail.callouts.length
        : 0,
      hangerAnchorQuantityParityCount: purchaseReady ? sammyAnchorQuantity : 0,
      ascSeismicOfficialSourceCount: purchaseReady
        ? Object.keys(EXPECTED_ASC_SEISMIC_SOURCES).length
        : 0,
      ascSeismicQuoteBoundProductCount: purchaseReady
        ? Object.values(EXPECTED_ASC_QUOTE_VARIANTS).reduce(
          (sum, variants) => sum + variants.length,
          0,
        )
        : 0,
      ascSeismicDimensionedFamilyCount: purchaseReady ? 3 : 0,
      exactAssemblyRequiredPartDefinitionCount: purchaseReady
        ? exactAssemblyFit.metrics.requiredPartDefinitionCount
        : 0,
      exactAssemblyRequiredInstalledUnitCount: purchaseReady
        ? exactAssemblyFit.metrics.requiredInstalledUnitCount
        : 0,
      exactAssemblyInstalledInstanceCount: purchaseReady
        ? exactAssemblyFit.metrics.installedInstanceCount
        : 0,
      exactAssemblySourceTrustedPartDefinitionCount: purchaseReady
        ? exactAssemblyFit.metrics.sourceTrustedPartDefinitionCount
        : 0,
      indexedCadCorpusFileCount: purchaseReady ? cadAudit.indexedFileCount : 0,
      indexedCadCorpusCadFileCount: purchaseReady
        ? Object.values(cadAudit.cadFileCounts).reduce((sum, count) => sum + count, 0)
        : 0,
      indexedCadCorpusExactTargetMatchCount: purchaseReady
        ? cadAudit.exactTargetFilenameOrPathMatchCount
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
    manufacturerAuthoredSammyFamilyCadAcquired: purchaseReady,
    sammyCadLineArtOnly: purchaseReady,
    sammyProjectSubstrateConflictResolved: false,
    sammyPartNumberSpecificSolidReady: false,
    sammyThreadFormGeometryReady: false,
    hangerAnchorQuantityParityReady: purchaseReady,
    ascSeismicQuoteVariantIdentityReady: purchaseReady,
    ascSeismicPublishedAssemblyRulesReady: purchaseReady,
    ascSeismicPartNumberSpecificSolidCoverageComplete: false,
    ascSeismicFastenerThreadSolidCoverageComplete: false,
    ascSeismicStructureAttachmentVerified: false,
    ascSeismicCollisionAnalysisVerified: false,
    ascSeismicListedAssemblyFitVerified: false,
    exactAssemblyBlockerCodes: exactAssemblyFit.blockerCodes,
    exactAssemblyPartDefinitionsReady: false,
    exactAssemblySourceTrustReady: false,
    exactAssemblyInstalledInstanceCoverageReady: false,
    exactAssemblyConnectionFitReady: false,
    exactAssemblyStructureAttachmentReady: false,
    exactAssemblySolidKernelReceiptReady: false,
    exactAssemblySceneCollisionReceiptReady: false,
    exactAssemblyReleaseReady: false,
    indexedCadCorpusAuditReady: purchaseReady && indexedCadCorpusAuditReady,
    manufacturerCadExternalRequestReady: false,
    manufacturerCadCoverageComplete: false,
    exactManufacturerGeometryReady: false,
    exactThreadSolidsReady: false,
    verifiedMatingAssembliesReady: false,
    blenderInstalledSupportGeometryReady: false,
    supportModelReleaseReady: false,
  }
}
