const PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut';
const ARTIFACT_TYPE = 'halofire.new-hope-wet-level1-network-evidence.v1';
const FIELD_SHA = '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5';
const ASBUILT_SHA = 'ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B';
const FAB_SHA = 'A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9';
const SEIDB_SHA = '0B64077B62673459C11D2CBC303258C1DD3F0C75735A07BFFA903BAEE79D6135';
const VECTOR_FINGERPRINT = 'ebf9cccee2f87cca';
const HEAD_FINGERPRINT = '404e9b7a323f1c1f';
const NATIVE_FINGERPRINT = '49038b8ef1140714';
const BRANCH_LINES = Object.freeze(Array.from({ length: 47 }, (_, index) => `BL${String(index + 1).padStart(2, '0')}`));
const NATIVE_LINES = Object.freeze([...BRANCH_LINES, 'CMA', 'CMB', 'CMC'].sort());
const SCHEDULE = Object.freeze([
  Object.freeze({ manufacturer: 'Tyco', sin: 'TY3231', model: 'TY-FRB', type: 'pendent', quantity: 164 }),
  Object.freeze({ manufacturer: 'Victaulic', sin: 'V3506', model: 'VS1', type: 'pendent', quantity: 6 }),
  Object.freeze({ manufacturer: 'Tyco', sin: 'TY3131', model: 'TY-FRB', type: 'upright', quantity: 4 }),
]);
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
    + `${Number(row.toPdfPt?.x).toFixed(6)},${Number(row.toPdfPt?.y).toFixed(6)}`
  )).join('|'));
}

function headFingerprint(heads) {
  return fnv1a64(heads.map((row) => (
    `${row.id}:${Number(row.pdfPt?.x).toFixed(6)},${Number(row.pdfPt?.y).toFixed(6)},`
    + `${Number(row.crossSourceResidualPt).toFixed(6)}`
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
  const ids = vectors.map((row) => row.id);
  const expectedIds = Array.from({ length: 300 }, (_, index) => `wet-vector-${String(index + 1).padStart(3, '0')}`);
  if (
    vectors.length !== 300
    || !same(ids, expectedIds)
    || vectors.some((row) => row.crossSourceResidualPt !== 0 || !(row.lengthFt > 0))
    || vectorFingerprint(vectors) !== VECTOR_FINGERPRINT
    || evidence?.fingerprints?.wetPipeVectorsFnv1a64 !== VECTOR_FINGERPRINT
  ) {
    issues.push(issue('NH_WET_LEVEL1_PIPE_GEOMETRY_INVALID', 'wetPipeVectors', 'All 300 exact field-to-as-built wet pipe vectors and their fixed geometry fingerprint are required.'));
  }
}

function validateHeads(evidence, issues) {
  const heads = evidence?.sprinklerHeads ?? [];
  const expectedIds = Array.from({ length: 174 }, (_, index) => `wet-head-${String(index + 1).padStart(3, '0')}`);
  if (
    heads.length !== 174
    || !same(heads.map((row) => row.id), expectedIds)
    || heads.some((row) => row.headType !== null || row.headTypeAssignmentStatus !== 'schedule-quantity-known-coordinate-assignment-unresolved')
    || heads.some((row) => !(row.crossSourceResidualPt >= 0 && row.crossSourceResidualPt <= 0.01))
    || headFingerprint(heads) !== HEAD_FINGERPRINT
    || evidence?.fingerprints?.sprinklerHeadsFnv1a64 !== HEAD_FINGERPRINT
    || !same(evidence?.sprinklerSchedule, SCHEDULE)
    || evidence?.sprinklerSchedule?.reduce((sum, row) => sum + row.quantity, 0) !== 174
  ) {
    issues.push(issue('NH_WET_LEVEL1_HEAD_EVIDENCE_INVALID', 'sprinklerHeads', 'All 174 cross-source head positions and the 164/6/4 source schedule are required without guessing per-coordinate head types.'));
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
    claims?.wetSystemNetwork2dReady !== true
    || claims?.sprinklerHeadPositions2dReady !== true
    || claims?.sprinklerScheduleQuantitiesReady !== true
    || claims?.nativeFabricationTakeoffReady !== true
    || claims?.pieceToPlanVectorMappingReady !== false
    || claims?.headTypeAssignmentReady !== false
    || claims?.pipeDirectionReady !== false
    || claims?.pipeGradeReady !== false
    || claims?.installedElevationReady !== false
    || claims?.wetSystemInstallation3dReady !== false
    || claims?.fabricationReleaseReady !== false
    || claims?.fieldReleaseReady !== false
  ) {
    issues.push(issue('NH_WET_LEVEL1_FALSE_PROMOTION', 'claims', 'Unproven piece mapping, head assignment, direction, grade, installed elevation, 3D installation, fabrication, and field release must remain false.'));
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
    wetSystemNetwork2dReady: passed,
    sprinklerHeadPositions2dReady: passed,
    nativeFabricationTakeoffReady: passed,
    pieceToPlanVectorMappingReady: false,
    headTypeAssignmentReady: false,
    pipeDirectionReady: false,
    pipeGradeReady: false,
    installedElevationReady: false,
    wetSystemInstallation3dReady: false,
    fabricationReleaseReady: false,
    fieldReleaseReady: false,
  };
}

export default { validateNewHopeWetLevel1NetworkEvidence };
