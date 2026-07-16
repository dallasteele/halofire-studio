import { sha256Hex } from './elevation-datums.js'

const PROJECT_ID = 'boys-girls-club-community-center-brigham-city-ut'
const SOURCE_SEALS = Object.freeze({
  fabricationList: ['7fe066904709725abd407c786b28b87e2b34dbc3071dcf6462b66d11f7e7d141', 862711],
  nativeFab: ['8968b6865194af5c5b64fed81c221958c9fa1c9974754c3e08dd91f0dfc22a52', 16800],
  seismicBom: ['0e7b416df69e961474d8641401fcb7548c66a4eb891af8bd8e22390b54caf6f6', 21406],
  r2MaterialData: ['2e0b3e467a2abcff59faafc5de42fce69d5c8c178c87f6faeae0b8d4932ed6a8', 12745981],
  approvedMaterialData: ['9e7833d014c5b7625310504ce2dbe90613ac36918c02a9fbb3160ba4e7479212', 9897793],
  eatonTolcoCatalog: ['b7f8955fca3bc840b07507d1ee305a37b193d77b0f3cfee7de056e4864d75a13', 12714158],
  haloStandardMeritTeeLet: ['492e5e085182d440c9d882cbd2deec64869af84a27b36307c78731838116080d', 194990],
  victaulic1054: ['c085b8cfccc92e878aa94f0a597f2801751e7e4408067139ce53053ea75fe97d', 2697380],
  victaulicI142: ['c0d125572a871f1f5a0eb2479b5df13da75d47fefe72b314669ee02123e3e110', 253798],
  victaulicIgsCadZip: ['07654e77286b22f44c93d27a6c762b98cb3ff0bfc849a7c6997636d114b0d806', 3940745],
  victaulicNo142Dwg: ['7cf2771c58f1f69b58d04ad9a5391a960847c92fcd8e53d4af1afdf49c59c1dd', 129453],
})
const GYM_PIECES = Object.freeze(['#E.09', '#E.10', '#E.11', '#E.12', '#E.13'])
const GYM_OUTLET_UIDS = Object.freeze([29, 33, 32, 36, 35, 38, 44, 43])

const issue = (code, message, entityId = null) => ({
  severity: 'blocking',
  code,
  message,
  entityId,
})
const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)

function validateSourceSeals(packet, issues) {
  for (const [role, [sha256, bytes]] of Object.entries(SOURCE_SEALS)) {
    const source = packet.sources?.[role]
    if (source?.sha256 !== sha256 || source?.bytes !== bytes) {
      issues.push(issue('BGC_PART_SOURCE_SEAL_DRIFT', `${role} source seal changed.`, role))
    }
  }
  const official = packet.sources?.victaulicOfficialCad
  const fp = official?.fireProtectionPackage
  const ips = official?.ipsPackage
  if (
    official?.listingUrl !== 'https://assets.victaulic.com/assets/uploads/software-content/Autodesk_AutoCAD_3D_Blocks.html' ||
    fp?.group !== 'Adsk_ACAD_FP_3D' ||
    fp?.zipSha256 !== 'dbec3388c3d99c246f3b50d497065cdadf60a92163ccc33c61a7a602e5e25b72' ||
    fp?.zipBytes !== 315440470 ||
    fp?.sourceFileSha256 !== '568dd0dbb5b89fc4b5cd3dfa18413c2f278372853f3dc3a0074f6bacb8230138' ||
    fp?.sourceFileBytes !== 1155487 ||
    fp?.exactThreeInchBlock !== 'Coupling_3 (80)_009-N' ||
    fp?.sourceEntityOwnerHandle !== 294 ||
    fp?.sourceEntityHandle !== 325 ||
    ips?.group !== 'Adsk_ACAD_IPS_3D' ||
    ips?.zipSha256 !== 'b165b72d6f2e1bb1a79e7311f583b1e925fa53d547aacb7cc189a0f122f11e42' ||
    ips?.zipBytes !== 218606231 ||
    ips?.sourceFileSha256 !== 'c6447684cfd900b1719cc9a6c39ad166d71f8260078ead295022d0f6267df9cf' ||
    ips?.sourceFileBytes !== 446173 ||
    ips?.exactThreeInchBlock !== 'Coupling-Flex_3 (80)_75' ||
    ips?.sourceEntityOwnerHandle !== 346 ||
    ips?.sourceEntityHandle !== 377
  ) {
    issues.push(issue('BGC_OFFICIAL_COUPLING_CAD_SOURCE_DRIFT', 'Official Victaulic package, source-file, or exact block identity changed.'))
  }
  const oda = packet.sources?.odaFileConverter
  if (
    oda?.url !== 'https://www.opendesign.com/guestfiles/ODA_FILE_CONVERTER' ||
    oda?.version !== '27.1' ||
    oda?.installerSha256 !== '3d5961f510cf95f398b8e2920899dc8e8c51adecda5b20a40b3d1a29269de81' ||
    oda?.installerBytes !== 28812288
  ) {
    issues.push(issue('BGC_CAD_CONVERTER_SOURCE_DRIFT', 'The audited ODA converter tool seal changed.'))
  }
}

/**
 * Validates project-selected part evidence without promoting catalog families,
 * CAD downloads, or a fabrication abbreviation into an exact installed solid.
 */
export async function validateBgcManufacturerPartEvidence(packet = {}) {
  const issues = []
  const draft = structuredClone(packet)
  const receiptSha256 = draft.receiptSha256
  delete draft.receiptSha256
  const expectedReceiptSha256 = await sha256Hex(draft)
  if (receiptSha256 !== expectedReceiptSha256) {
    issues.push(issue('BGC_PART_RECEIPT_MISMATCH', 'Manufacturer-part evidence receipt changed.'))
  }
  if (
    packet.artifactType !== 'halofire.bgc-manufacturer-part-evidence.v3' ||
    packet.projectId !== PROJECT_ID
  ) {
    issues.push(issue('BGC_PART_PROJECT_INVALID', 'The part evidence must remain bound to BGC.'))
  }
  validateSourceSeals(packet, issues)

  const outlet = packet.gymGroovedOutlet
  if (
    outlet?.lineName !== '#E' ||
    !same(outlet?.pieceIds, GYM_PIECES) ||
    !same(outlet?.nativeOutletUniqueIds, GYM_OUTLET_UIDS) ||
    outlet?.installedQuantity !== 8 ||
    outlet?.projectMaterialSummaryQuantity !== 11 ||
    outlet?.runNominalDiameterIn !== 3 ||
    outlet?.branchNominalDiameterIn !== 1.25 ||
    outlet?.listingToken !== '3 x 1 1/4 GOL (Up:0)' ||
    outlet?.fabricationReportTitle !== 'Welded Mains - Fabrication Report' ||
    outlet?.nativeAttachedFittingCount !== 0 ||
    outlet?.catalogPartNumber !== null ||
    outlet?.manufacturer !== null ||
    outlet?.identityClassification !== 'native-fabricated-grooved-outlet-identity-only'
  ) {
    issues.push(issue('BGC_GOL_PROJECT_IDENTITY_INVALID', 'The eight gym outlets must retain their exact native FAB identities and unresolved catalog body.', '#E'))
  }

  const merit = packet.gymGroovedOutletCandidates?.meritTypeC
  const sci = packet.gymGroovedOutletCandidates?.sci61cg1
  if (
    merit?.manufacturer !== 'Merit / ASC Engineered Solutions' ||
    merit?.family !== 'Weld-Miser Tee-Let Type C' ||
    merit?.nominalOutletIn !== 1.25 ||
    !same(merit?.nominalHeaderRangeIn, [3, 4]) ||
    merit?.perfectFitHeaderIn !== 3 ||
    merit?.outletLengthIn !== 3 ||
    merit?.insideDiameterIn !== 1.368 ||
    merit?.outsideDiameterIn !== 1.66 ||
    merit?.wallThicknessIn !== 0.14 ||
    merit?.projectSelectionVerified !== false ||
    merit?.grooveManufacturingProfileReady !== false ||
    merit?.exactBodySolidReady !== false ||
    sci?.manufacturer !== 'SCI / ASC Engineered Solutions' ||
    sci?.family !== '61CG1 Grooved Weld Outlet' ||
    sci?.catalogPartNumber !== '61CG1012030' ||
    sci?.productNumber !== '4360000040' ||
    sci?.nominalOutletIn !== 1.25 ||
    sci?.nominalHeaderIn !== 3 ||
    sci?.publishedDimensionsIn?.A !== 3 ||
    sci?.publishedDimensionsIn?.B !== 1.38 ||
    sci?.projectSelectionVerified !== false ||
    sci?.grooveManufacturingProfileReady !== false ||
    sci?.exactBodySolidReady !== false
  ) {
    issues.push(issue('BGC_GOL_CANDIDATE_EVIDENCE_INVALID', 'Dimensioned outlet candidates must remain source-bound and unselected for BGC.', '#E'))
  }

  const no142 = packet.wrongPartControls?.victaulicNo142
  if (
    no142?.manufacturer !== 'Victaulic' ||
    no142?.model !== 'No. 142 Welded Outlet' ||
    no142?.officialBranchNominalDiameterIn !== 1 ||
    no142?.officialBranchActualOutsideDiameterIn !== 1.315 ||
    no142?.officialEndToEndIn !== 1 ||
    no142?.bgcRequiredBranchNominalDiameterIn !== 1.25 ||
    no142?.bgcRequiredBranchActualOutsideDiameterIn !== 1.66 ||
    no142?.sizeCompatible !== false ||
    no142?.projectSelectionVerified !== false ||
    no142?.rejectedForBgcGym !== true ||
    no142?.rejectionCode !== 'BRANCH_NOMINAL_SIZE_MISMATCH_1_VS_1_25'
  ) {
    issues.push(issue('BGC_GOL_WRONG_NO142_CONTROL_INVALID', 'Victaulic No. 142 must remain rejected for the 1-1/4-inch BGC gym branches.', 'Victaulic-No-142'))
  }

  const catalogRows = packet.seismicBraceBom?.catalogRows || []
  if (
    !same(catalogRows, [
      { quantity: 18, partNumber: '13520712', description: '1/2 in Fig.980 - 3/8 in Universal Swivel' },
      { quantity: 3, partNumber: 'Y379010020', description: '2 in Fig. 1001 Clamp' },
    ]) ||
    packet.seismicBraceBom?.unresolvedEquivalentRowCount !== 9 ||
    packet.seismicBraceBom?.unresolvedEquivalentQuantity !== 33 ||
    !same(packet.seismicBraceBom?.designBindings, {
      fig980: { releasedPartNumber: '13520712', catalogVariant: '980-3/8', bracePipeNominalDiameterIn: 1, bracePipeSchedule: 40 },
      fig1001: { releasedPartNumber: 'Y379010020', catalogVariant: '1001-2 X 1', bracedPipeNominalDiameterIn: 2, bracePipeNominalDiameterIn: 1, bracePipeSchedule: 40 },
    })
  ) {
    issues.push(issue('BGC_SEISMIC_BOM_SELECTION_INVALID', 'The two exact material codes and nine unresolved equivalent rows must match the released BOM.'))
  }
  const fig980 = packet.seismicBraceFamilies?.fig980
  if (
    fig980?.manufacturer !== 'Eaton B-Line series TOLCO' ||
    fig980?.figure !== '980' ||
    fig980?.r2PhysicalPage !== 154 ||
    fig980?.catalogVariant !== '980-3/8' ||
    fig980?.publishedCommonEnvelopeIn?.A !== 4.5625 ||
    fig980?.publishedCommonEnvelopeIn?.B !== 2.0625 ||
    fig980?.publishedMountingHoleDIn !== 0.4375 ||
    fig980?.exactRodVariantResolved !== true ||
    fig980?.exactMountingHoleDResolved !== true ||
    fig980?.exactCatalogVariantIdentityReady !== true ||
    fig980?.exactBodySolidReady !== false
  ) {
    issues.push(issue('BGC_FIG980_EVIDENCE_INVALID', 'Fig. 980-3/8 identity and mounting hole must be proven without promoting the incomplete body solid.', '13520712'))
  }
  const fig1001 = packet.seismicBraceFamilies?.fig1001
  if (
    fig1001?.manufacturer !== 'Eaton B-Line series TOLCO' ||
    fig1001?.figure !== '1001' ||
    fig1001?.r2PhysicalPage !== 155 ||
    fig1001?.catalogVariant !== '1001-2 X 1' ||
    fig1001?.bracedPipeNominalDiameterIn !== 2 ||
    fig1001?.bracePipeNominalDiameterIn !== 1 ||
    fig1001?.bracePipeSchedule !== 40 ||
    fig1001?.publishedApproxWeightPer100Lb !== 112.6 ||
    fig1001?.exactCatalogVariantIdentityReady !== true ||
    fig1001?.exactBodySolidReady !== false
  ) {
    issues.push(issue('BGC_FIG1001_EVIDENCE_INVALID', 'Fig. 1001-2 X 1 identity must remain bound to the BGC design row without promoting the incomplete body solid.', 'Y379010020'))
  }

  const coupling = packet.approvedCandidateFamilies?.crossMainCoupling
  if (
    !same(coupling?.submittedStyles, ['009N', '109']) ||
    !same(coupling?.projectSelectedInventory, [
      { style: '009N', nominalDiameterIn: 3, quantity: 27, partNumber: 'L03009NPE0' },
      { style: '75', nominalDiameterIn: 3, quantity: 5, partNumber: 'L030075PE0' },
    ]) ||
    coupling?.installedGymBoundaryStyle !== null ||
    coupling?.projectInventorySelectionReady !== true ||
    coupling?.installedPositionSelectionReady !== false ||
    coupling?.exactInstalledCouplingSolidReady !== false
  ) {
    issues.push(issue('BGC_COUPLING_SELECTION_INVALID', 'Project inventory selection must remain distinct from an installed gym-boundary style.'))
  }
  const hanger = packet.approvedCandidateFamilies?.ringHanger
  if (
    hanger?.manufacturer !== 'AFCON' ||
    hanger?.figure !== '300' ||
    hanger?.nominalDiameterIn !== 3 ||
    hanger?.publishedDimensionsIn?.A !== 3.7845 ||
    hanger?.publishedDimensionsIn?.B !== 4.4311 ||
    hanger?.projectManufacturerMappingReady !== false ||
    hanger?.exactInstalledHangerSolidReady !== false
  ) {
    issues.push(issue('BGC_HANGER_FALSE_PROJECT_MAPPING', 'The approved AFCON family must remain separate from an installed hanger selection.'))
  }

  const cadAudit = packet.cadRecoveryAudit
  const style009N = cadAudit?.style009NThreeInch
  const style75 = cadAudit?.style75ThreeInch
  if (
    cadAudit?.sourceFilesRemainUnmodified !== true ||
    cadAudit?.autodeskTrueView2027?.coreEngineOpenedBothSourceFiles !== true ||
    cadAudit?.autodeskTrueView2027?.consoleSaveAsAvailable !== false ||
    cadAudit?.autodeskTrueView2027?.consoleNetloadAvailable !== false ||
    cadAudit?.autodeskTrueView2027?.productionSolidPromoted !== false ||
    style009N?.sourceIdentityResolved !== true ||
    style009N?.exactBlockResolved !== true ||
    style009N?.odaR2010RoundTripCompleted !== true ||
    style009N?.freecadImportValidCompound !== true ||
    style009N?.shellCount !== 10 ||
    style009N?.closedShellCount !== 0 ||
    style009N?.solidCount !== 0 ||
    style009N?.detachedFaceFailuresPresent !== true ||
    style009N?.exactSolidVerified !== false ||
    style009N?.rejectionCode !== 'OPEN_SHELLS_AND_DETACHED_FACE_FAILURES' ||
    style75?.sourceIdentityResolved !== true ||
    style75?.exactBlockResolved !== true ||
    style75?.recoveredAcisBytes !== 68325 ||
    style75?.odaR2010RoundTripCompleted !== true ||
    style75?.freecadImportValidCompound !== true ||
    style75?.shellCount !== 8 ||
    style75?.closedShellCount !== 2 ||
    style75?.solidCount !== 0 ||
    style75?.detachedFaceFailuresPresent !== true ||
    style75?.exactSolidVerified !== false ||
    style75?.rejectionCode !== 'OPEN_HOUSING_SHELLS_AND_DETACHED_FACE_FAILURES' ||
    cadAudit?.productionCadExportAllowed !== false
  ) {
    issues.push(issue('BGC_COUPLING_CAD_TOPOLOGY_AUDIT_INVALID', 'Official coupling CAD must retain its exact source identity and open-shell production rejection.'))
  }

  const connectionGates = packet.connectionGeometryGates
  const requiredFalseConnectionGates = [
    'groovedPipeEndProfileVerified',
    'couplingHousingGrooveSeatVerified',
    'couplingBoltThreadStandardVerified',
    'couplingBoltThreadEngagementVerified',
    'outletBranchGrooveProfileVerified',
    'outletHeaderSaddleCurvatureVerified',
    'bracketFastenerThreadStandardVerified',
    'bracketMountingHoleFitVerified',
    'assemblyInterferenceAndClearanceVerified',
    'watertightMatingAssemblyVerified',
  ]
  if (requiredFalseConnectionGates.some((key) => connectionGates?.[key] !== false)) {
    issues.push(issue('BGC_CONNECTION_GEOMETRY_FALSE_PROMOTION', 'Grooves, threads, engagement, bracket fit, clearance, and watertight mating must remain blocked until measured and verified.'))
  }

  const boundary = packet.modelingBoundary
  if (
    boundary?.sourceEvidenceReady !== true ||
    boundary?.wrongPartRejectionReady !== true ||
    boundary?.catalogMaterialCodeEvidenceReady !== true ||
    boundary?.seismicCatalogVariantIdentityReady !== true ||
    boundary?.gymOutletCandidateDimensionEvidenceReady !== true ||
    boundary?.gymOutletCatalogIdentityReady !== false ||
    boundary?.gymOutletExactBodyGeometryReady !== false ||
    boundary?.gymOutletWeldProfileReady !== false ||
    boundary?.gymOutletBranchTakeoutReady !== false ||
    boundary?.couplingProjectInventorySelectionReady !== true ||
    boundary?.couplingInstalledPositionSelectionReady !== false ||
    boundary?.manufacturerPartSolidVerified !== false ||
    boundary?.exactBracketGeometryVerified !== false ||
    boundary?.exactThreadGeometryVerified !== false ||
    boundary?.threadEngagementAndToleranceVerified !== false ||
    boundary?.matingFitVerified !== false ||
    boundary?.fabricationReady !== false ||
    boundary?.fieldReleaseReady !== false ||
    boundary?.vpsReleaseReady !== false
  ) {
    issues.push(issue('BGC_PART_FALSE_GEOMETRY_PROMOTION', 'Evidence identity cannot promote exact solids, threads, fit, fabrication, field, or VPS readiness.'))
  }

  const ready = issues.length === 0
  return {
    artifactType: 'halofire.bgc-manufacturer-part-evidence-result.v3',
    projectId: packet.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    receiptSha256: expectedReceiptSha256,
    sourceEvidenceReady: ready,
    wrongPartRejectionReady: ready,
    catalogMaterialCodeEvidenceReady: ready,
    seismicCatalogVariantIdentityReady: ready,
    gymOutletCandidateDimensionEvidenceReady: ready,
    couplingProjectInventorySelectionReady: ready,
    manufacturerCadIdentityResolved: ready,
    couplingInstalledPositionSelectionReady: false,
    gymOutletCatalogIdentityReady: false,
    manufacturerPartSolidVerified: false,
    exactBracketGeometryVerified: false,
    exactThreadGeometryVerified: false,
    threadEngagementAndToleranceVerified: false,
    matingFitVerified: false,
    productionCadExportAllowed: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    vpsReleaseReady: false,
  }
}

export async function verifyBgcManufacturerPartAdversarialLoop(packet = {}) {
  const canonical = await validateBgcManufacturerPartEvidence(packet)
  if (canonical.status !== 'passed') {
    return { status: 'blocked', mutationCount: 0, escapedMutationCount: 0, issues: ['BGC_PART_CANONICAL_INVALID'] }
  }
  const mutations = [
    (copy) => { copy.sources.seismicBom.sha256 = '0'.repeat(64) },
    (copy) => { copy.gymGroovedOutlet.branchNominalDiameterIn = 1 },
    (copy) => { copy.gymGroovedOutlet.installedQuantity = 9 },
    (copy) => { copy.gymGroovedOutlet.catalogPartNumber = 'NO142' },
    (copy) => { copy.gymGroovedOutlet.manufacturer = 'Victaulic' },
    (copy) => { copy.wrongPartControls.victaulicNo142.sizeCompatible = true },
    (copy) => { copy.wrongPartControls.victaulicNo142.rejectedForBgcGym = false },
    (copy) => { copy.wrongPartControls.victaulicNo142.officialBranchNominalDiameterIn = 1.25 },
    (copy) => { copy.seismicBraceBom.catalogRows[0].quantity = 17 },
    (copy) => { copy.seismicBraceBom.unresolvedEquivalentRowCount = 0 },
    (copy) => { copy.seismicBraceFamilies.fig980.catalogVariant = '980-1/2' },
    (copy) => { copy.seismicBraceFamilies.fig980.publishedMountingHoleDIn = 0.5625 },
    (copy) => { copy.seismicBraceFamilies.fig980.exactBodySolidReady = true },
    (copy) => { copy.seismicBraceFamilies.fig1001.bracePipeNominalDiameterIn = 1.25 },
    (copy) => { copy.seismicBraceFamilies.fig1001.catalogVariant = '1001-2 X 1 1/4' },
    (copy) => { copy.gymGroovedOutletCandidates.meritTypeC.projectSelectionVerified = true },
    (copy) => { copy.gymGroovedOutletCandidates.sci61cg1.exactBodySolidReady = true },
    (copy) => { copy.approvedCandidateFamilies.crossMainCoupling.projectSelectedInventory[0].quantity = 26 },
    (copy) => { copy.approvedCandidateFamilies.crossMainCoupling.installedGymBoundaryStyle = '009N' },
    (copy) => { copy.approvedCandidateFamilies.ringHanger.projectManufacturerMappingReady = true },
    (copy) => { copy.modelingBoundary.manufacturerPartSolidVerified = true },
    (copy) => { copy.modelingBoundary.exactBracketGeometryVerified = true },
    (copy) => { copy.modelingBoundary.exactThreadGeometryVerified = true },
    (copy) => { copy.modelingBoundary.matingFitVerified = true },
    (copy) => { copy.modelingBoundary.vpsReleaseReady = true },
    (copy) => { copy.sources.victaulicOfficialCad.fireProtectionPackage.sourceFileSha256 = '0'.repeat(64) },
    (copy) => { copy.sources.victaulicOfficialCad.ipsPackage.exactThreeInchBlock = 'Coupling-Flex_4 (100)_75' },
    (copy) => { copy.cadRecoveryAudit.style009NThreeInch.exactSolidVerified = true },
    (copy) => { copy.cadRecoveryAudit.style75ThreeInch.solidCount = 1 },
    (copy) => { copy.cadRecoveryAudit.sourceFilesRemainUnmodified = false },
    (copy) => { copy.connectionGeometryGates.couplingBoltThreadEngagementVerified = true },
    (copy) => { copy.cadRecoveryAudit.productionCadExportAllowed = true },
  ]
  const escaped = []
  for (const [index, mutate] of mutations.entries()) {
    const copy = structuredClone(packet)
    mutate(copy)
    delete copy.receiptSha256
    copy.receiptSha256 = await sha256Hex(copy)
    const result = await validateBgcManufacturerPartEvidence(copy)
    if (result.status !== 'blocked') escaped.push(index)
  }
  return {
    status: escaped.length ? 'blocked' : 'passed',
    mutationCount: mutations.length,
    escapedMutationCount: escaped.length,
    escapedMutationIndexes: escaped,
  }
}
