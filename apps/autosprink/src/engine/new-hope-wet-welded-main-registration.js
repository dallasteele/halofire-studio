const EXPECTED = Object.freeze({
  projectId: 'new-hope-crisis-center-brigham-city-ut',
  fieldSha: '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5',
  asBuiltSha: 'ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B',
  fabSha: 'A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9',
  memberSha: '0B64077B62673459C11D2CBC303258C1DD3F0C75735A07BFFA903BAEE79D6135',
  listingSha: '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734',
  mappingIds: [
    'CMA.01', 'CMA.02', 'CMA.03', 'CMA.04', 'CMA.05', 'CMA.06', 'CMA.07',
    'CMB.01', 'CMB.02', 'CMB.03', 'CMB.04', 'CMB.05', 'CMB.06', 'CMB.07', 'CMB.08', 'CMB.09',
    'CMC.01', 'CMC.02', 'CMC.03', 'CMC.05', 'CMC.06', 'CMC.08', 'CMC.09', 'CMC.11', 'CMC.12', 'CMC.13', 'CMC.14', 'CMC.15',
  ],
  holdoutIds: ['T-1-415', 'T-1-416', 'T-1-421'],
});
const EXPECTED_FINGERPRINT = 'e30b24be391aa692';
const EXPECTED_METRICS = Object.freeze({
  weldedMainDefinitionCount: 29,
  weldedMainListedUnitCount: 31,
  exactFieldPieceLabelCount: 28,
  mappedLabeledUnitCount: 28,
  mappedHeavyCenterlineCount: 25,
  mappedAlternateCenterlineCount: 3,
  unlabeledTypicalHoldoutCount: 3,
  maxPieceLabelToCenterlineDistancePt: 54.613101,
  maxSourceCenterlineVsCutSpanDeltaIn: 5.349121,
  globalListedUnitCount: 169,
  priorMappedWeldedBranchUnitCount: 71,
  combinedMappedUnitCount: 99,
  globalPieceVectorUnmappedUnitCount: 70,
  threadedHoldoutCount: 67,
});
const EXPECTED_REGISTRATION = Object.freeze({
  pdfPointsPerFoot: 9,
  planOriginPdfPt: [660.674561, 1118.512451],
  pieceLabelCenterlineDistanceGatePt: 60,
  pieceLabelCenterlineUniquenessGapPt: 20,
  heavyCutSpanGateIn: 3,
  alternateCutSpanGateIn: 6,
  heavyCenterlineWidthByNominalDiameterIn: { '2.5': 2.06766, 3: 2.48119 },
});

const issue = (code, path, message) => ({ severity: 'blocking', code, path, message });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const close = (left, right, tolerance = 0.00001) => Math.abs(left - right) <= tolerance;
const length = (row) => Math.hypot(row.sourceCenterline.toPdfPt[0] - row.sourceCenterline.fromPdfPt[0], row.sourceCenterline.toPdfPt[1] - row.sourceCenterline.fromPdfPt[1]);
const segmentKey = (row, index) => row?.sourceCenterline?.fromPdfPt && row?.sourceCenterline?.toPdfPt
  ? JSON.stringify([row.sourceCenterline.fromPdfPt, row.sourceCenterline.toPdfPt])
  : `invalid-source-centerline-${index}`;
function fnv1a64(text) { let value = 14695981039346656037n; for (const byte of new TextEncoder().encode(text)) { value ^= BigInt(byte); value = BigInt.asUintN(64, value * 1099511628211n); } return value.toString(16).padStart(16, '0'); }
function fingerprint(evidence) { return fnv1a64(JSON.stringify({ registration: evidence.registration, mappings: evidence.mappings, holdouts: evidence.holdouts, metrics: evidence.metrics })); }

function mappingCloses(row, evidence) {
  if (!row?.sourceCenterline?.fromPdfPt || !row?.sourceCenterline?.toPdfPt || !row?.pieceLabelBoxPdfPt) return false;
  const sourceLengthPt = length(row);
  const expectedWidth = evidence.registration.heavyCenterlineWidthByNominalDiameterIn[String(row.nativeNominalDiameterIn)];
  const heavy = row.sourceCenterline.representation === 'diameter-scaled-heavy-red-centerline'
    && row.sourceCenterline.widthPt === expectedWidth
    && Number.isInteger(row.sourceCenterline.fieldDrawingIndex)
    && Number.isInteger(row.sourceCenterline.asBuiltDrawingIndex)
    && row.sourceCenterline.itemIndex === 0
    && row.mappingBasis === 'exact-field-as-built-label-native-cut-length-and-diameter-scaled-centerline';
  const alternate = row.sourceCenterline.representation === 'red-white-twin-centerline'
    && row.sourceCenterline.widthPt === 0.01389
    && Number.isInteger(row.sourceCenterline.fieldRedDrawingIndex)
    && Number.isInteger(row.sourceCenterline.fieldWhiteDrawingIndex)
    && Number.isInteger(row.sourceCenterline.asBuiltRedDrawingIndex)
    && Number.isInteger(row.sourceCenterline.asBuiltWhiteDrawingIndex)
    && row.sourceCenterline.redItemIndex === 0
    && row.sourceCenterline.whiteItemIndex === 0
    && row.mappingBasis === 'exact-field-as-built-label-native-cut-length-and-red-white-twin-centerline';
  const computedDelta = row.nativeCutLengthFt * 12 - sourceLengthPt / evidence.registration.pdfPointsPerFoot * 12;
  const dimensionException = row.sourceCenterlineVsCutSpanDeltaIn <= evidence.registration.heavyCutSpanGateIn
    || (
      ['CMC.06', 'CMC.08'].includes(row.instanceId)
      && row.printedDimensionEvidence?.normalizedText === '9\'-6 1/2"'
      && row.printedDimensionEvidence?.dimensionIn === 114.5
      && close(row.nativeCutLengthFt * 12, 114.5)
    );
  return (heavy || alternate)
    && row.pieceLabelToCenterlineDistancePt <= evidence.registration.pieceLabelCenterlineDistanceGatePt
    && (row.pieceLabelCenterlineUniquenessGapPt === null || row.pieceLabelCenterlineUniquenessGapPt >= evidence.registration.pieceLabelCenterlineUniquenessGapPt)
    && close(computedDelta, row.sourceCenterlineVsCutSpanDeltaIn)
    && row.sourceCenterlineVsCutSpanDeltaIn > 0
    && row.sourceCenterlineVsCutSpanDeltaIn <= evidence.registration.alternateCutSpanGateIn
    && dimensionException
    && row.nativeStationDirection === null
    && row.nativeStationDirectionStatus === 'unresolved';
}

export function evaluateNewHopeWetWeldedMainRegistrationEvidence(evidence = {}) {
  const issues = [];
  if (
    evidence.artifactType !== 'halofire.new-hope-wet-welded-main-registration-evidence.v1'
    || evidence.projectId !== EXPECTED.projectId
    || evidence.sources?.fieldInstall?.sha256 !== EXPECTED.fieldSha
    || evidence.sources?.asBuilt?.sha256 !== EXPECTED.asBuiltSha
    || evidence.sources?.nativeFab?.archiveSha256 !== EXPECTED.fabSha
    || evidence.sources?.nativeFab?.memberSha256 !== EXPECTED.memberSha
    || evidence.sources?.approvedListing?.sha256 !== EXPECTED.listingSha
  ) issues.push(issue('NH_WET_MAIN_REGISTRATION_SOURCE_INVALID', 'sources', 'Field FP1.0, as-built FP1.0, native FAB, and approved listing identities must remain exact.'));
  if (!same(evidence.registration, EXPECTED_REGISTRATION) || !same(evidence.metrics, EXPECTED_METRICS) || fingerprint(evidence) !== EXPECTED_FINGERPRINT) issues.push(issue('NH_WET_MAIN_REGISTRATION_FINGERPRINT_INVALID', '$', 'The 28 main labels, source mappings, three T-1 holdouts, gates, and global metrics must remain exact.'));
  const mappingIds = evidence.mappings?.map((row) => row.instanceId) ?? [];
  const holdoutIds = evidence.holdouts?.map((row) => row.instanceId) ?? [];
  const sourceSegments = evidence.mappings?.map(segmentKey) ?? [];
  const heavyCount = evidence.mappings?.filter((row) => row.sourceCenterline?.representation === 'diameter-scaled-heavy-red-centerline').length ?? 0;
  const alternateCount = evidence.mappings?.filter((row) => row.sourceCenterline?.representation === 'red-white-twin-centerline').length ?? 0;
  if (!same(mappingIds, EXPECTED.mappingIds) || new Set(mappingIds).size !== 28 || sourceSegments.length !== 28 || new Set(sourceSegments).size !== 28 || heavyCount !== 25 || alternateCount !== 3) issues.push(issue('NH_WET_MAIN_MAPPING_COVERAGE_INVALID', 'mappings', 'Exactly 28 named welded-main pieces must consume 28 unique field/as-built source centerlines: 25 heavy plus three alternate.'));
  if (!same(holdoutIds, EXPECTED.holdoutIds) || new Set(evidence.holdouts?.map((row) => row.nativePipeUniqueId)).size !== 3 || evidence.holdouts?.some((row) => row.pieceId !== 'T-1' || row.reason !== 'typical-definition-has-no-distinct-source-label-or-occurrence-station')) issues.push(issue('NH_WET_MAIN_TYPICAL_HOLDOUT_INVALID', 'holdouts', 'All three distinct native T-1 records must remain explicit unlabeled occurrence-station holdouts.'));
  if (evidence.mappings?.some((row) => !mappingCloses(row, evidence))) issues.push(issue('NH_WET_MAIN_MAPPING_NOT_CLOSED', 'mappings', 'Every mapped welded-main piece requires exact label, source parity, diameter, and native cut-length closure.'));
  const claims = evidence.claims;
  if (
    claims?.fieldWeldedMainLabelInventoryReady !== true
    || claims?.fieldAsBuiltWeldedMainCenterlineParityReady !== true
    || claims?.weldedMainLabeledPieceToPlanMappingReady !== true
    || claims?.completeWeldedMainPieceToPlanMappingReady !== false
    || claims?.pieceToPlanVectorMappingReady !== false
    || claims?.nativeStationDirectionReady !== false
    || claims?.hydraulicFlowDirectionReady !== false
    || claims?.gradeReady !== false
    || claims?.fittingTakeoutReady !== false
    || claims?.installedElevationReady !== false
    || claims?.fabricationReady !== false
    || claims?.fieldReleaseReady !== false
  ) issues.push(issue('NH_WET_MAIN_REGISTRATION_FALSE_PROMOTION', 'claims', 'The 28 labeled plan mappings cannot promote T-1 placement, global mapping, direction, grade, takeout, elevation, fabrication, or field release.'));
  const ready = issues.length === 0;
  return {
    projectId: EXPECTED.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    mappings: ready ? structuredClone(evidence.mappings) : [],
    holdouts: ready ? structuredClone(evidence.holdouts) : [],
    metrics: ready ? structuredClone(evidence.metrics) : null,
    fieldWeldedMainLabelInventoryReady: ready,
    fieldAsBuiltWeldedMainCenterlineParityReady: ready,
    weldedMainLabeledPieceToPlanMappingReady: ready,
    completeWeldedMainPieceToPlanMappingReady: false,
    pieceToPlanVectorMappingReady: false,
    nativeStationDirectionReady: false,
    hydraulicFlowDirectionReady: false,
    gradeReady: false,
    fittingTakeoutReady: false,
    installedElevationReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}

export default { evaluateNewHopeWetWeldedMainRegistrationEvidence };
