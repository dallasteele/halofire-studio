const PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut';
const ARTIFACT_TYPE = 'halofire.new-hope-wet-level1-network-evidence.v2';
const FIELD_SHA = '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5';
const ASBUILT_SHA = 'ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B';
const FAB_SHA = 'A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9';
const SEIDB_SHA = '0B64077B62673459C11D2CBC303258C1DD3F0C75735A07BFFA903BAEE79D6135';
const VECTOR_FINGERPRINT = 'd1f7f223328c026c';
const REJECTED_BLUE_FINGERPRINT = '57b1e6b6caf52a91';
const LEGACY_ANNOTATION_FINGERPRINT = '9caa67de413633ea';
const HEAD_FINGERPRINT = '50dcae26658d3cad';
const NATIVE_FINGERPRINT = '49038b8ef1140714';
const BRANCH_LINES = Object.freeze(Array.from({ length: 47 }, (_, index) => `BL${String(index + 1).padStart(2, '0')}`));
const NATIVE_LINES = Object.freeze([...BRANCH_LINES, 'CMA', 'CMB', 'CMC'].sort());
const SCHEDULE = Object.freeze([
  Object.freeze({ manufacturer: 'Tyco', sin: 'TY3231', model: 'TY-FRB', type: 'pendent', quantity: 164 }),
  Object.freeze({ manufacturer: 'Victaulic', sin: 'V3506', model: 'VS1', type: 'pendent', quantity: 6 }),
  Object.freeze({ manufacturer: 'Tyco', sin: 'TY3131', model: 'TY-FRB', type: 'upright', quantity: 4 }),
]);
const HEAD_TYPE_BY_SIN = Object.freeze(Object.fromEntries(SCHEDULE.map(({ quantity: _quantity, ...headType }) => [
  headType.sin,
  Object.freeze(headType),
])));
const SIZE_TOTALS = Object.freeze([
  Object.freeze({ sizeCode: 13, nominalDiameterIn: 1, pieceCount: 67, cutLengthFt: 62.125 }),
  Object.freeze({ sizeCode: 17, nominalDiameterIn: 1.5, pieceCount: 69, cutLengthFt: 1044.333333 }),
  Object.freeze({ sizeCode: 23, nominalDiameterIn: 2.5, pieceCount: 16, cutLengthFt: 231.083333 }),
  Object.freeze({ sizeCode: 25, nominalDiameterIn: 3, pieceCount: 15, cutLengthFt: 139.791667 }),
]);

const issue = (code, path, message) => ({ severity: 'blocking', code, path, message });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const clone = (value) => JSON.parse(JSON.stringify(value));

function fnv1a64(text) {
  let value = 14695981039346656037n;
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    value ^= BigInt(byte);
    value = BigInt.asUintN(64, value * 1099511628211n);
  }
  return value.toString(16).padStart(16, '0');
}

function vectorFingerprint(vectors) {
  return fnv1a64(vectors.map((row) => (
    `${row.id}:${Number(row.fromPdfPt?.x).toFixed(6)},${Number(row.fromPdfPt?.y).toFixed(6)},`
    + `${Number(row.toPdfPt?.x).toFixed(6)},${Number(row.toPdfPt?.y).toFixed(6)}:`
    + `${row.associatedLineName}:${row.exactPieceId || '-'}:`
    + `${(row.candidatePieces || []).map((piece) => piece.pieceId).join(',')}`
  )).join('|'));
}

function headFingerprint(heads) {
  return fnv1a64(heads.map((row) => (
    `${row.id}:${Number(row.pdfPt?.x).toFixed(6)},${Number(row.pdfPt?.y).toFixed(6)},`
    + `${Number(row.crossSourceResidualPt).toFixed(6)},${row.headType?.sin}`
  )).join('|'));
}

function nativeFingerprint(lines) {
  return fnv1a64(lines.flatMap((line) => line.pieces.map((piece) => (
    `${line.lineName}:${piece.pieceName}:${piece.sizeCode}:`
    + `${Number(piece.cutLengthFt).toFixed(6)}:${piece.outletCount}:${piece.fittingCount}`
  ))).join('|'));
}

function validateSources(evidence, issues) {
  const source = evidence?.sourceBindings;
  if (
    evidence?.artifactType !== ARTIFACT_TYPE
    || evidence?.projectId !== PROJECT_ID
    || source?.fieldInstall?.sha256 !== FIELD_SHA
    || source?.fieldInstall?.sheet !== 'FP1.0'
    || source?.fieldInstall?.physicalPage !== 3
    || source?.asBuilt?.sha256 !== ASBUILT_SHA
    || source?.asBuilt?.sheet !== 'FP1.0'
    || source?.asBuilt?.physicalPage !== 3
    || source?.nativeFab?.archiveSha256 !== FAB_SHA
    || source?.nativeFab?.memberSha256 !== SEIDB_SHA
  ) {
    issues.push(issue('NH_WET_LEVEL1_SOURCE_BINDING_INVALID', 'sourceBindings', 'Field-install, as-built, and native fabrication sources must retain their exact New Hope identities.'));
  }
  if (
    evidence?.registration?.pdfPointsPerFoot !== 9
    || evidence?.registration?.planScale !== '1/8 inch = 1 foot'
    || !same(evidence?.registration?.riserOriginPdfPt, { x: 660.674561, y: 1118.512451 })
  ) {
    issues.push(issue('NH_WET_LEVEL1_REGISTRATION_INVALID', 'registration', 'FP1.0 must remain registered at 9 PDF points per foot to the exact riser origin.'));
  }
}

function validateVectors(evidence, issues) {
  const vectors = evidence?.wetPipeVectors ?? [];
  const rejected = evidence?.rejectedBlueSourceLinework ?? [];
  const ids = vectors.map((row) => row.id);
  const expectedIds = Array.from({ length: 53 }, (_, index) => `threaded-plan-segment-${String(index + 1).padStart(3, '0')}`);
  const expectedRejectedIds = Array.from({ length: 5 }, (_, index) => `rejected-blue-linework-${String(index + 1).padStart(2, '0')}`);
  const exactMappings = vectors.filter((row) => row.mappingStatus === 'exact-singleton-piece');
  const ambiguousMappings = vectors.filter((row) => row.mappingStatus === 'same-line-piece-equivalence-set');
  const metrics = evidence?.metrics;
  const candidateInvalid = vectors.some((row) => (
    row.crossSourceResidualPt !== 0
    || !(row.sourceSpanIn > 0)
    || !(row.lineAssociationDistancePt >= 0 && row.lineAssociationDistancePt <= 45)
    || !(row.lineAssociationUniquenessGapPt >= 4)
    || !row.candidatePieces?.length
    || row.candidatePieces.some((piece) => (
      !piece.pieceId?.startsWith(row.associatedLineName)
      || !(piece.sourceSpanVsCutDeltaIn >= -0.2 && piece.sourceSpanVsCutDeltaIn <= 3.2)
    ))
    || (row.mappingStatus === 'exact-singleton-piece'
      ? row.candidatePieces.length !== 1 || row.exactPieceId !== row.candidatePieces[0].pieceId
      : row.mappingStatus !== 'same-line-piece-equivalence-set'
        || row.candidatePieces.length < 2
        || row.exactPieceId !== null)
  ));
  if (
    vectors.length !== 53
    || !same(ids, expectedIds)
    || exactMappings.length !== 24
    || ambiguousMappings.length !== 29
    || candidateInvalid
    || vectorFingerprint(vectors) !== VECTOR_FINGERPRINT
    || evidence?.fingerprints?.wetPipeVectorsFnv1a64 !== VECTOR_FINGERPRINT
    || metrics?.acceptedThreadedPlanSegmentCount !== 53
    || metrics?.exactThreadedPiecePlanMappingCount !== 24
    || metrics?.ambiguousThreadedPiecePlanSegmentCount !== 29
    || metrics?.crossSourcePipeVectorMatchCount !== 53
    || metrics?.crossSourcePipeMaxResidualPt !== 0
  ) {
    issues.push(issue('NH_WET_LEVEL1_PIPE_GEOMETRY_INVALID', 'wetPipeVectors', 'All 53 accepted diameter-scaled one-inch plan segments must retain exact PDF parity, same-line native cut candidates, ambiguity status, and the fixed semantic fingerprint.'));
  }
  const rejectionReasons = rejected.map((row) => row.rejectionReason);
  if (
    rejected.length !== 5
    || !same(rejected.map((row) => row.id), expectedRejectedIds)
    || rejectionReasons.filter((reason) => reason === 'no-same-line-native-threaded-cut-within-takeout-gate').length !== 4
    || rejectionReasons.filter((reason) => reason === 'field-to-as-built-endpoint-drift-exceeds-0.02-point-gate').length !== 1
    || rejected.filter((row) => row.crossSourceResidualPt > 0.02).length !== 1
    || vectorFingerprint(rejected) !== REJECTED_BLUE_FINGERPRINT
    || evidence?.fingerprints?.rejectedBlueSourceLineworkFnv1a64 !== REJECTED_BLUE_FINGERPRINT
    || metrics?.rejectedBlueSourceLineworkCount !== 5
  ) {
    issues.push(issue('NH_WET_LEVEL1_REJECTED_LINEWORK_INVALID', 'rejectedBlueSourceLinework', 'Four non-reconciling blue strokes and the one field/as-built endpoint drift must remain rejected.'));
  }
  const legacy = evidence?.legacyAnnotationLikeVectorClass;
  if (
    legacy?.fieldCandidateCount !== 300
    || legacy?.asBuiltCandidateCount !== 317
    || legacy?.fieldToAsBuiltExactMatchCount !== 300
    || legacy?.classification !== 'rejected-annotation-dimension-and-symbol-linework-not-pipe-network'
    || legacy?.fingerprintFnv1a64 !== LEGACY_ANNOTATION_FINGERPRINT
    || metrics?.legacyAnnotationLikeVectorCount !== 300
  ) {
    issues.push(issue('NH_WET_LEVEL1_LEGACY_ANNOTATION_REJECTION_INVALID', 'legacyAnnotationLikeVectorClass', 'The former 300-vector black-hairline class must remain explicitly rejected as annotation, dimension, and symbol linework.'));
  }
}

function validateHeads(evidence, issues) {
  const heads = evidence?.sprinklerHeads ?? [];
  const expectedIds = Array.from({ length: 174 }, (_, index) => `wet-head-${String(index + 1).padStart(3, '0')}`);
  const typeCounts = Object.fromEntries(['TY3231', 'V3506', 'TY3131'].map((sin) => [
    sin,
    heads.filter((head) => head.headType?.sin === sin).length,
  ]));
  const symbolRuleInvalid = heads.some((head) => {
    const field = head.symbolEvidence?.fieldInstall;
    const asBuilt = head.symbolEvidence?.asBuilt;
    if (!field || !asBuilt || field.family !== asBuilt.family) return true;
    if (head.headType?.sin === 'TY3131') {
      return field.family !== 'upright-open-circle-center-mark'
        || field.outerBoxPt?.height >= 8.5
        || asBuilt.outerBoxPt?.height >= 8.5;
    }
    if (head.headType?.sin === 'V3506') {
      return field.family !== 'pendent-four-quadrant-fill'
        || field.maxInternalDarkFillRectAreaPt2 < 20
        || asBuilt.maxInternalDarkFillRectAreaPt2 < 20;
    }
    if (head.headType?.sin === 'TY3231') {
      return field.family !== 'pendent-radial-fill'
        || field.outerBoxPt?.height < 8.5
        || asBuilt.outerBoxPt?.height < 8.5
        || field.maxInternalDarkFillRectAreaPt2 >= 20
        || asBuilt.maxInternalDarkFillRectAreaPt2 >= 20;
    }
    return true;
  });
  if (
    heads.length !== 174
    || !same(heads.map((row) => row.id), expectedIds)
    || heads.some((row) => row.headTypeAssignmentStatus !== 'exact-native-symbol-family-cross-source-verified')
    || heads.some((row) => !same(row.headType, HEAD_TYPE_BY_SIN[row.headType?.sin]))
    || !same(typeCounts, { TY3231: 164, V3506: 6, TY3131: 4 })
    || !same(evidence?.metrics?.headTypeCounts, { TY3231: 164, V3506: 6, TY3131: 4 })
    || symbolRuleInvalid
    || heads.some((row) => !(row.crossSourceResidualPt >= 0 && row.crossSourceResidualPt <= 0.01))
    || headFingerprint(heads) !== HEAD_FINGERPRINT
    || evidence?.fingerprints?.sprinklerHeadsFnv1a64 !== HEAD_FINGERPRINT
    || !same(evidence?.sprinklerSchedule, SCHEDULE)
    || evidence?.sprinklerSchedule?.reduce((sum, row) => sum + row.quantity, 0) !== 174
  ) {
    issues.push(issue('NH_WET_LEVEL1_HEAD_EVIDENCE_INVALID', 'sprinklerHeads', 'All 174 cross-source head positions and exact native symbol-family assignments must reconcile to the 164/6/4 source schedule.'));
  }
}

function validateNativeFabrication(evidence, issues) {
  const lines = evidence?.nativeFabricationLines ?? [];
  const pieces = lines.flatMap((line) => line.pieces ?? []);
  const metrics = evidence?.metrics;
  if (
    lines.length !== 50
    || !same(lines.map((line) => line.lineName).sort(), NATIVE_LINES)
    || pieces.length !== 167
    || pieces.reduce((sum, piece) => sum + piece.outletCount, 0) !== 217
    || pieces.reduce((sum, piece) => sum + piece.fittingCount, 0) !== 67
    || Math.abs(pieces.reduce((sum, piece) => sum + piece.cutLengthFt, 0) - 1477.333333) > 0.0001
    || nativeFingerprint(lines) !== NATIVE_FINGERPRINT
    || evidence?.fingerprints?.nativeFabricationFnv1a64 !== NATIVE_FINGERPRINT
    || metrics?.lineFamilyCount !== 50
    || metrics?.pieceCount !== 167
    || metrics?.outletCount !== 217
    || metrics?.fittingRecordCount !== 67
    || Math.abs(metrics?.totalCutLengthFt - 1477.333333) > 0.0001
    || !same(metrics?.sizeTotals, SIZE_TOTALS)
  ) {
    issues.push(issue('NH_WET_LEVEL1_NATIVE_TAKEOFF_INVALID', 'nativeFabricationLines', 'The 50 line families, 167 cut pieces, 217 outlets, 67 fitting records, size totals, and native fingerprint must remain exact.'));
  }
}

function validateTruthBoundary(evidence, issues) {
  const claims = evidence?.claims;
  if (
    claims?.wetSystemNetwork2dReady !== false
    || claims?.sourceTypedThreadedPlanSegmentsReady !== true
    || claims?.legacyAnnotationVectorsRejected !== true
    || claims?.completeThreadedPiecePlanMappingReady !== false
    || claims?.sprinklerHeadPositions2dReady !== true
    || claims?.sprinklerScheduleQuantitiesReady !== true
    || claims?.nativeFabricationTakeoffReady !== true
    || claims?.pieceToPlanVectorMappingReady !== false
    || claims?.headTypeAssignmentReady !== true
    || claims?.pipeDirectionReady !== false
    || claims?.pipeGradeReady !== false
    || claims?.installedElevationReady !== false
    || claims?.wetSystemInstallation3dReady !== false
    || claims?.fabricationReleaseReady !== false
    || claims?.fieldReleaseReady !== false
  ) {
    issues.push(issue('NH_WET_LEVEL1_FALSE_PROMOTION', 'claims', 'Source-typed threaded segments, legacy rejection, and per-head native symbol assignment remain proven, while complete network, piece mapping, direction, grade, elevation, 3D installation, fabrication, and field release remain false.'));
  }
}

export function validateNewHopeWetLevel1NetworkEvidence(evidence) {
  const issues = [];
  validateSources(evidence, issues);
  validateVectors(evidence, issues);
  validateHeads(evidence, issues);
  validateNativeFabrication(evidence, issues);
  validateTruthBoundary(evidence, issues);
  if (!same(evidence?.branchLineLabels, BRANCH_LINES)) {
    issues.push(issue('NH_WET_LEVEL1_BRANCH_LABEL_SET_INVALID', 'branchLineLabels', 'BL01 through BL47 must all be present on the field-install source.'));
  }
  const passed = issues.length === 0;
  return {
    artifactType: 'halofire.new-hope-wet-level1-network-validation-result.v1',
    projectId: PROJECT_ID,
    status: passed ? 'passed' : 'blocked',
    issues,
    sourceBindings: passed ? clone(evidence.sourceBindings) : null,
    wetPipeVectors: passed ? clone(evidence.wetPipeVectors) : [],
    sprinklerHeads: passed ? clone(evidence.sprinklerHeads) : [],
    sprinklerSchedule: passed ? clone(evidence.sprinklerSchedule) : [],
    nativeFabricationLines: passed ? clone(evidence.nativeFabricationLines) : [],
    metrics: passed ? clone(evidence.metrics) : null,
    wetSystemNetwork2dReady: false,
    sourceTypedThreadedPlanSegmentsReady: passed,
    legacyAnnotationVectorsRejected: passed,
    sprinklerHeadPositions2dReady: passed,
    nativeFabricationTakeoffReady: passed,
    pieceToPlanVectorMappingReady: false,
    headTypeAssignmentReady: passed,
    pipeDirectionReady: false,
    pipeGradeReady: false,
    installedElevationReady: false,
    wetSystemInstallation3dReady: false,
    fabricationReleaseReady: false,
    fieldReleaseReady: false,
  };
}

export default { validateNewHopeWetLevel1NetworkEvidence };
