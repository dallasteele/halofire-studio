const EXPECTED = Object.freeze({
  projectId: 'new-hope-crisis-center-brigham-city-ut',
  fieldSha: '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5',
  asBuiltSha: 'ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B',
  fabSha: 'A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9',
  memberSha: '0B64077B62673459C11D2CBC303258C1DD3F0C75735A07BFFA903BAEE79D6135',
  registrationIds: ['BL01.02', 'BL06.01', 'BL10.02', 'BL16.01', 'BL19.02', 'BL27.01', 'BL34.01-A', 'BL34.01-B', 'BL35.01-A', 'BL35.01-B', 'BL42.01', 'BL43.01', 'BL44.02', 'BL46.01', 'BL47.01'],
  pieceVectorHoldoutIds: ['BL03.01', 'BL03.02', 'BL04.01', 'BL04.02'],
});
const EXPECTED_FINGERPRINT = '1457d146bbd5a656';
const EXPECTED_METRICS = Object.freeze({
  weldedBranchDefinitionCount: 69,
  weldedBranchUnitCount: 71,
  exactFieldPieceLabelCount: 71,
  fieldAsBuiltHeavyCenterlineCount: 67,
  pieceVectorMappedUnitCount: 67,
  pieceVectorHoldoutCount: 4,
  pieceVectorMappedHeavyCenterlineCount: 67,
  maxPieceVectorCutSpanDeltaIn: 2.096517,
  maxPieceLabelToMappedCenterlineDistancePt: 53.334493,
  registeredUnitCount: 15,
  mappedNativeOutletCount: 36,
  maxOutletResidualIn: 0.194824,
  unresolvedUnitCount: 56,
  unresolvedReasonCounts: {
    'fewer-than-two-unique-native-outlet-stations': 10,
    'native-outlet-head-cut-vector-closure-not-unique': 38,
    'source-centerline-label-association-not-unique': 8,
  },
  globalListedUnitCount: 169,
  globalPieceVectorUnmappedUnitCount: 102,
});
const issue = (code, path, message) => ({ severity: 'blocking', code, path, message });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const close = (left, right, tolerance = 0.00001) => Math.abs(left - right) <= tolerance;
const length = (vector) => Math.hypot(vector.toPdfPt[0] - vector.fromPdfPt[0], vector.toPdfPt[1] - vector.fromPdfPt[1]);
const segmentKey = (row, index) => row?.sourceCenterline?.fromPdfPt && row?.sourceCenterline?.toPdfPt
  ? JSON.stringify([row.sourceCenterline.fromPdfPt, row.sourceCenterline.toPdfPt])
  : `invalid-source-centerline-${index}`;
function fnv1a64(text) { let value = 14695981039346656037n; for (const byte of new TextEncoder().encode(text)) { value ^= BigInt(byte); value = BigInt.asUintN(64, value * 1099511628211n); } return value.toString(16).padStart(16, '0'); }
function fingerprint(evidence) { return fnv1a64(JSON.stringify({ registration: evidence.registration, labelInstances: evidence.labelInstances, pieceVectorMappings: evidence.pieceVectorMappings, pieceVectorHoldouts: evidence.pieceVectorHoldouts, registrations: evidence.registrations, unresolved: evidence.unresolved, metrics: evidence.metrics })); }

function pieceVectorCloses(row, evidence) {
  if (!row?.sourceCenterline?.fromPdfPt || !row?.sourceCenterline?.toPdfPt) return false;
  const sourceLengthPt = length(row.sourceCenterline);
  return row.sourceCenterline?.widthPt === 1.24059
    && Number.isInteger(row.sourceCenterline.fieldDrawingIndex)
    && Number.isInteger(row.sourceCenterline.asBuiltDrawingIndex)
    && row.sourceCenterline.itemIndex === 0
    && row.mappingBasis === 'exhaustive-one-to-one-native-cut-length-and-field-as-built-centerline-bijection'
    && close(row.nativeCutLengthFt * 12 - sourceLengthPt / evidence.registration.pdfPointsPerFoot * 12, row.sourceCenterlineVsCutSpanDeltaIn, 0.00001)
    && row.sourceCenterlineVsCutSpanDeltaIn > 0
    && row.sourceCenterlineVsCutSpanDeltaIn <= evidence.registration.cutSpanGateIn
    && (
      (row.nativeStationDirectionStatus === 'native-outlet-registered' && ['source-drawing-forward', 'source-drawing-reverse'].includes(row.nativeStationDirection))
      || (row.nativeStationDirectionStatus === 'unresolved' && row.nativeStationDirection === null)
    );
}

function registrationCloses(row, evidence) {
  if (!row?.sourceCenterline?.fromPdfPt || !row?.sourceCenterline?.toPdfPt || !row?.fabricationCutVector?.fromPdfPt || !row?.fabricationCutVector?.toPdfPt) return false;
  const sourceLengthPt = length(row.sourceCenterline);
  const cutLengthPt = length(row.fabricationCutVector);
  const residuals = row.mappedOutlets?.map((outlet) => Math.abs(outlet.residualIn)) ?? [];
  const uniqueOutletIds = new Set(row.mappedOutlets?.map((outlet) => outlet.nativeOutletUniqueId));
  return row.sourceCenterline?.widthPt === 1.24059
    && Number.isInteger(row.sourceCenterline.fieldDrawingIndex)
    && Number.isInteger(row.sourceCenterline.asBuiltDrawingIndex)
    && row.sourceCenterline.itemIndex === 0
    && row.pieceLabelToCenterlineDistancePt <= evidence.registration.pieceLabelCenterlineDistanceGatePt
    && row.pieceLabelCenterlineUniquenessGapPt >= evidence.registration.pieceLabelCenterlineUniquenessGapPt
    && residuals.length >= 2
    && uniqueOutletIds.size === residuals.length
    && close(Math.max(...residuals), row.maxOutletResidualIn, 0.000001)
    && row.maxOutletResidualIn <= evidence.registration.outletResidualGateIn
    && close(cutLengthPt / evidence.registration.pdfPointsPerFoot, row.nativeCutLengthFt, 0.000001)
    && close(row.nativeCutLengthFt * 12 - sourceLengthPt / evidence.registration.pdfPointsPerFoot * 12, row.sourceCenterlineVsCutSpanDeltaIn, 0.00001)
    && row.sourceCenterlineVsCutSpanDeltaIn > 0
    && row.sourceCenterlineVsCutSpanDeltaIn <= evidence.registration.cutSpanGateIn
    && ['source-drawing-forward', 'source-drawing-reverse'].includes(row.nativeStationDirection);
}

export function evaluateNewHopeWetWeldedBranchRegistrationEvidence(evidence = {}) {
  const issues = [];
  if (evidence.artifactType !== 'halofire.new-hope-wet-welded-branch-registration-evidence.v2' || evidence.projectId !== EXPECTED.projectId || evidence.sources?.fieldInstall?.sha256 !== EXPECTED.fieldSha || evidence.sources?.asBuilt?.sha256 !== EXPECTED.asBuiltSha || evidence.sources?.nativeFab?.archiveSha256 !== EXPECTED.fabSha || evidence.sources?.nativeFab?.memberSha256 !== EXPECTED.memberSha) issues.push(issue('NH_WET_BRANCH_REGISTRATION_SOURCE_INVALID', 'sources', 'Field FP1.0, as-built FP1.0, and native FAB identities must remain exact.'));
  if (!same(evidence.registration, { pdfPointsPerFoot: 9, planOriginPdfPt: [660.674561, 1118.512451], outletResidualGateIn: 0.25, cutSpanGateIn: 3, pieceLabelCenterlineDistanceGatePt: 12, pieceLabelCenterlineUniquenessGapPt: 2 }) || !same(evidence.metrics, EXPECTED_METRICS) || fingerprint(evidence) !== EXPECTED_FINGERPRINT) issues.push(issue('NH_WET_BRANCH_REGISTRATION_FINGERPRINT_INVALID', '$', 'The 71 labels, 67 piece vectors, 15 direction registrations, holdouts, gates, and coverage metrics must remain exact.'));
  const labelIds = evidence.labelInstances?.map((row) => row.instanceId) ?? [];
  const pieceVectorIds = evidence.pieceVectorMappings?.map((row) => row.instanceId) ?? [];
  const pieceVectorHoldoutIds = evidence.pieceVectorHoldouts?.map((row) => row.instanceId) ?? [];
  const registrationIds = evidence.registrations?.map((row) => row.instanceId) ?? [];
  const unresolvedIds = evidence.unresolved?.map((row) => row.instanceId) ?? [];
  const sourceSegmentKeys = evidence.pieceVectorMappings?.map(segmentKey) ?? [];
  if (labelIds.length !== 71 || new Set(labelIds).size !== 71 || pieceVectorIds.length !== 67 || new Set(pieceVectorIds).size !== 67 || !same(pieceVectorHoldoutIds, EXPECTED.pieceVectorHoldoutIds) || new Set([...pieceVectorIds, ...pieceVectorHoldoutIds]).size !== 71 || sourceSegmentKeys.length !== 67 || new Set(sourceSegmentKeys).size !== 67) issues.push(issue('NH_WET_BRANCH_PIECE_VECTOR_COVERAGE_INVALID', 'pieceVectorMappings', 'Exactly 67 units must consume the 67 heavy field/as-built centerlines once, with the four named BL03/BL04 units held.'));
  if (!same(registrationIds, EXPECTED.registrationIds) || unresolvedIds.length !== 56 || new Set([...registrationIds, ...unresolvedIds]).size !== 71) issues.push(issue('NH_WET_BRANCH_REGISTRATION_COVERAGE_INVALID', 'registrations', 'Exactly 15 named units must retain source-registered native station direction and 56 distinct units must remain direction holdouts.'));
  if (evidence.pieceVectorMappings?.some((row) => !pieceVectorCloses(row, evidence))) issues.push(issue('NH_WET_BRANCH_PIECE_VECTOR_NOT_CLOSED', 'pieceVectorMappings', 'Every mapped unit requires native cut-length closure and one exact field/as-built centerline.'));
  if (evidence.registrations?.some((row) => !registrationCloses(row, evidence))) issues.push(issue('NH_WET_BRANCH_REGISTRATION_NOT_CLOSED', 'registrations', 'Every direction-promoted unit requires a unique label-to-centerline association, two or more native outlet matches, cut-length parity, and residual closure.'));
  const pieceVectorById = new Map((evidence.pieceVectorMappings ?? []).map((row) => [row.instanceId, row]));
  if ((evidence.registrations ?? []).some((row) => {
    const mapped = pieceVectorById.get(row.instanceId);
    return !mapped || !same(mapped.sourceCenterline, row.sourceCenterline) || mapped.nativeStationDirection !== row.nativeStationDirection || mapped.nativeStationDirectionStatus !== 'native-outlet-registered';
  })) issues.push(issue('NH_WET_BRANCH_DIRECTION_VECTOR_BINDING_INVALID', 'registrations', 'Every direction registration must bind the same source centerline in the 67-unit piece-vector mapping.'));
  const claims = evidence.claims;
  if (claims?.weldedBranchLabelInventoryReady !== true || claims?.fieldAsBuiltHeavyCenterlineParityReady !== true || claims?.weldedBranchPieceVectorBijectionReady !== true || claims?.scopedPieceToPlanVectorMappingReady !== true || claims?.scopedFabricationStationDirectionReady !== true || claims?.completeWeldedBranchPieceMappingReady !== false || claims?.pieceToPlanVectorMappingReady !== false || claims?.hydraulicFlowDirectionReady !== false || claims?.gradeReady !== false || claims?.installedElevationReady !== false || claims?.fabricationReady !== false || claims?.fieldReleaseReady !== false) issues.push(issue('NH_WET_BRANCH_REGISTRATION_FALSE_PROMOTION', 'claims', 'The 67-unit scoped vector bijection and 15-unit station direction cannot promote complete mapping, hydraulic direction, grade, elevation, fabrication, or field release.'));
  const ready = issues.length === 0;
  return {
    projectId: EXPECTED.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    pieceVectorMappings: ready ? structuredClone(evidence.pieceVectorMappings) : [],
    pieceVectorHoldouts: ready ? structuredClone(evidence.pieceVectorHoldouts) : [],
    registrations: ready ? structuredClone(evidence.registrations) : [],
    unresolved: ready ? structuredClone(evidence.unresolved) : [],
    metrics: ready ? structuredClone(evidence.metrics) : null,
    weldedBranchLabelInventoryReady: ready,
    fieldAsBuiltHeavyCenterlineParityReady: ready,
    weldedBranchPieceVectorBijectionReady: ready,
    scopedPieceToPlanVectorMappingReady: ready,
    scopedFabricationStationDirectionReady: ready,
    completeWeldedBranchPieceMappingReady: false,
    pieceToPlanVectorMappingReady: false,
    hydraulicFlowDirectionReady: false,
    gradeReady: false,
    installedElevationReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}

export default { evaluateNewHopeWetWeldedBranchRegistrationEvidence };
