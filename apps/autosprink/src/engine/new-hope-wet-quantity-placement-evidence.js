const EXPECTED = Object.freeze({
  projectId: 'new-hope-crisis-center-brigham-city-ut',
  fieldSha: '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5',
  asBuiltSha: 'ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B',
  listingSha: '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734',
  fabSha: 'A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9',
  memberSha: '0B64077B62673459C11D2CBC303258C1DD3F0C75735A07BFFA903BAEE79D6135',
});
const EXPECTED_DEFINITIONS = Object.freeze([
  Object.freeze({ pieceId: 'BL34.01', lineName: 'BL34', listingPhysicalPage: 32, listingQuantity: 2, nativePipeUniqueId: 539, nativeCutLengthFt: 14.916666666666666, printedDimensionText: "14'-11", printedDimensionIn: 179, outletIds: [541, 540], outletDistancesFt: [4.4281093808796825, 14.428109380879683], instanceIds: ['BL34.01-A', 'BL34.01-B'] }),
  Object.freeze({ pieceId: 'BL35.01', lineName: 'BL35', listingPhysicalPage: 33, listingQuantity: 2, nativePipeUniqueId: 535, nativeCutLengthFt: 13.291666666666666, printedDimensionText: "13'-3½", printedDimensionIn: 159.5, outletIds: [537, 536], outletDistancesFt: [6.010725202188409, 12.802391868855075], instanceIds: ['BL35.01-A', 'BL35.01-B'] }),
]);
const EXPECTED_FINGERPRINT = '656317655ee2a7a0';
const issue = (code, path, message) => ({ severity: 'blocking', code, path, message });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const close = (left, right, tolerance = 0.000001) => Math.abs(left - right) <= tolerance;
function fnv1a64(text) { let value = 14695981039346656037n; for (const byte of new TextEncoder().encode(text)) { value ^= BigInt(byte); value = BigInt.asUintN(64, value * 1099511628211n); } return value.toString(16).padStart(16, '0'); }
function fingerprint(evidence) { return fnv1a64(JSON.stringify({ registration: evidence.registration, definitions: evidence.definitions, metrics: evidence.metrics })); }

function normalizedDefinitions(definitions) {
  return definitions.map((definition) => ({
    pieceId: definition.pieceId,
    lineName: definition.lineName,
    listingPhysicalPage: definition.listingPhysicalPage,
    listingQuantity: definition.listingQuantity,
    nativePipeUniqueId: definition.nativePipeUniqueId,
    nativeCutLengthFt: definition.nativeCutLengthFt,
    printedDimensionText: definition.printedDimensionText,
    printedDimensionIn: definition.printedDimensionIn,
    outletIds: definition.nativeOutlets?.map((outlet) => outlet.uniqueId) ?? [],
    outletDistancesFt: definition.nativeOutlets?.map((outlet) => outlet.distanceFt) ?? [],
    instanceIds: definition.instances?.map((instance) => instance.instanceId) ?? [],
  }));
}

function registrationIsClosed(definition, instance, pdfPointsPerFoot, gateIn) {
  const outlets = definition.nativeOutlets ?? [];
  const heads = instance.mappedOutletHeads ?? [];
  if (outlets.length !== 2 || heads.length !== 2) return false;
  if (!same(heads.map((head) => head.outletUniqueId), outlets.map((outlet) => outlet.uniqueId))) return false;
  const centerline = instance.sourceCenterline;
  if (!centerline || centerline.itemIndex !== 0 || !close(centerline.widthPt, 1.24059, 0.000001)) return false;
  if (!close(centerline.fromPdfPt[1], centerline.toPdfPt[1]) || heads.some((head) => !close(head.pdfPt[1], centerline.fromPdfPt[1]) || head.crossSourceResidualPt !== 0)) return false;
  if (heads.some((head) => head.pdfPt[0] < centerline.fromPdfPt[0] || head.pdfPt[0] > centerline.toPdfPt[0])) return false;

  const origins = heads.map((head, index) => head.pdfPt[0] - outlets[index].distanceFt * pdfPointsPerFoot);
  const origin = origins.reduce((sum, value) => sum + value, 0) / origins.length;
  const residualsIn = heads.map((head, index) => (head.pdfPt[0] - (origin + outlets[index].distanceFt * pdfPointsPerFoot)) / pdfPointsPerFoot * 12);
  const maxResidualIn = Math.max(...residualsIn.map(Math.abs));
  const cutEnd = origin + definition.nativeCutLengthFt * pdfPointsPerFoot;
  const cutVector = instance.fabricationCutVector;
  const sourceSpanIn = (centerline.toPdfPt[0] - centerline.fromPdfPt[0]) / pdfPointsPerFoot * 12;
  const spanDeltaIn = definition.nativeCutLengthFt * 12 - sourceSpanIn;
  return maxResidualIn <= gateIn
    && close(instance.maxOutletResidualIn, maxResidualIn, 0.000001)
    && close(cutVector.fromPdfPt[0], origin, 0.000001)
    && close(cutVector.toPdfPt[0], cutEnd, 0.000001)
    && close(cutVector.fromPdfPt[1], centerline.fromPdfPt[1])
    && close(cutVector.toPdfPt[1], centerline.fromPdfPt[1])
    && close(instance.sourceCenterlineVsCutSpanDeltaIn, spanDeltaIn, 0.000001)
    && centerline.fromPdfPt[0] > origin
    && centerline.toPdfPt[0] < cutEnd
    && spanDeltaIn > 1.5 && spanDeltaIn < 2;
}

export function evaluateNewHopeWetQuantityPlacementEvidence(evidence = {}) {
  const issues = [];
  if (evidence.artifactType !== 'halofire.new-hope-wet-quantity-placement-evidence.v2' || evidence.projectId !== EXPECTED.projectId || evidence.sources?.fieldInstall?.sha256 !== EXPECTED.fieldSha || evidence.sources?.fieldInstall?.sheet !== 'FP1.0' || evidence.sources?.fieldInstall?.physicalPage !== 3 || evidence.sources?.asBuilt?.sha256 !== EXPECTED.asBuiltSha || evidence.sources?.asBuilt?.sheet !== 'FP1.0' || evidence.sources?.asBuilt?.physicalPage !== 3 || evidence.sources?.approvedListing?.sha256 !== EXPECTED.listingSha || evidence.sources?.nativeFab?.archiveSha256 !== EXPECTED.fabSha || evidence.sources?.nativeFab?.memberSha256 !== EXPECTED.memberSha) issues.push(issue('NH_WET_QUANTITY_SOURCE_INVALID', 'sources', 'Field FP1.0, as-built FP1.0, approved listing, and native FAB identities must remain exact.'));
  const definitions = evidence.definitions ?? [];
  const registration = evidence.registration ?? {};
  const instances = definitions.flatMap((definition) => (definition.instances ?? []).map((instance) => ({ definition, instance })));
  if (!same(normalizedDefinitions(definitions), EXPECTED_DEFINITIONS) || definitions.some((definition) => definition.instances?.length !== definition.listingQuantity || !close(definition.nativeCutLengthFt * 12, definition.printedDimensionIn, 0.00001)) || registration.pdfPointsPerFoot !== 9 || !same(registration.planOriginPdfPt, [660.674561, 1118.512451]) || registration.outletResidualGateIn !== 0.25 || fingerprint(evidence) !== EXPECTED_FINGERPRINT) issues.push(issue('NH_WET_QUANTITY_PLACEMENT_INVALID', 'definitions', 'Both repeated BL34.01 and BL35.01 definitions require exact field/as-built vectors, native outlets, source heads, and cut-vector registration.'));
  if (instances.length !== 4 || instances.some(({ definition, instance }) => !registrationIsClosed(definition, instance, registration.pdfPointsPerFoot, registration.outletResidualGateIn))) issues.push(issue('NH_WET_QUANTITY_REGISTRATION_NOT_CLOSED', 'definitions[].instances', 'Every repeated instance must close both native outlet stations to the field/as-built head centers inside the source centerline residual gate.'));
  const metrics = evidence.metrics;
  if (!same(metrics, { quantityExpandedDefinitionCount: 2, quantityExpandedInstanceCount: 4, mappedNativeOutletCount: 8, maxOutletResidualIn: 0.010417, globalListedUnitCount: 169, scopedMappedUnitCount: 4 })) issues.push(issue('NH_WET_QUANTITY_METRICS_INVALID', 'metrics', 'Scoped quantity, outlet, residual, and global coverage metrics must remain exact.'));
  const claims = evidence.claims;
  if (claims?.quantityExpandedLineLabelAnchorsReady !== true || claims?.quantityExpandedPrintedDimensionsReady !== true || claims?.quantityExpandedPieceEndpointMappingReady !== true || claims?.scopedPieceToPlanVectorMappingReady !== true || claims?.listingQuantityExpansionReady !== true || claims?.pieceToPlanVectorMappingReady !== false || claims?.fabricationReady !== false || claims?.fieldReleaseReady !== false) issues.push(issue('NH_WET_QUANTITY_FALSE_PROMOTION', 'claims', 'The four scoped vectors may pass, but global piece mapping, fabrication, and field release must remain fail-closed.'));
  const ready = issues.length === 0;
  return {
    projectId: EXPECTED.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    definitions: ready ? structuredClone(definitions) : [],
    metrics: ready ? structuredClone(metrics) : null,
    quantityExpandedLineLabelAnchorsReady: ready,
    quantityExpandedPrintedDimensionsReady: ready,
    quantityExpandedPieceEndpointMappingReady: ready,
    scopedPieceToPlanVectorMappingReady: ready,
    listingQuantityExpansionReady: ready,
    pieceToPlanVectorMappingReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}

export default { evaluateNewHopeWetQuantityPlacementEvidence };
