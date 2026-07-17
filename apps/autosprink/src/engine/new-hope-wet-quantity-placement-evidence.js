const EXPECTED = Object.freeze({
  projectId: 'new-hope-crisis-center-brigham-city-ut',
  fieldSha: '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5',
  listingSha: '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734',
  fabSha: 'A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9',
  memberSha: '0B64077B62673459C11D2CBC303258C1DD3F0C75735A07BFFA903BAEE79D6135',
});
const EXPECTED_DEFINITIONS = Object.freeze([
  Object.freeze({ pieceId: 'BL34.01', lineName: 'BL34', listingPhysicalPage: 32, listingQuantity: 2, nativePipeUniqueId: 539, nativeCutLengthFt: 14.916667, printedDimensionText: "14'-11", printedDimensionIn: 179, instanceIds: ['BL34.01-A', 'BL34.01-B'] }),
  Object.freeze({ pieceId: 'BL35.01', lineName: 'BL35', listingPhysicalPage: 33, listingQuantity: 2, nativePipeUniqueId: 535, nativeCutLengthFt: 13.291667, printedDimensionText: "13'-3½", printedDimensionIn: 159.5, instanceIds: ['BL35.01-A', 'BL35.01-B'] }),
]);
const EXPECTED_FINGERPRINT = 'bb5a4a09595f762c';
const issue = (code, path, message) => ({ severity: 'blocking', code, path, message });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function fnv1a64(text) { let value = 14695981039346656037n; for (const byte of new TextEncoder().encode(text)) { value ^= BigInt(byte); value = BigInt.asUintN(64, value * 1099511628211n); } return value.toString(16).padStart(16, '0'); }
function fingerprint(definitions) { return fnv1a64(definitions.flatMap((definition) => definition.instances.map((instance) => `${definition.pieceId}:${instance.instanceId}:${instance.lineLabelBoxPdfPt.join(',')}:${instance.dimensionBoxPdfPt.join(',')}`)).join('|')); }

export function evaluateNewHopeWetQuantityPlacementEvidence(evidence = {}) {
  const issues = [];
  if (evidence.artifactType !== 'halofire.new-hope-wet-quantity-placement-evidence.v1' || evidence.projectId !== EXPECTED.projectId || evidence.sources?.fieldInstall?.sha256 !== EXPECTED.fieldSha || evidence.sources?.fieldInstall?.sheet !== 'FP1.0' || evidence.sources?.fieldInstall?.physicalPage !== 3 || evidence.sources?.approvedListing?.sha256 !== EXPECTED.listingSha || evidence.sources?.nativeFab?.archiveSha256 !== EXPECTED.fabSha || evidence.sources?.nativeFab?.memberSha256 !== EXPECTED.memberSha) issues.push(issue('NH_WET_QUANTITY_SOURCE_INVALID', 'sources', 'Field FP1.0, approved listing, and native FAB identities must remain exact.'));
  const definitions = evidence.definitions ?? [];
  const normalized = definitions.map((definition) => ({ ...Object.fromEntries(Object.keys(EXPECTED_DEFINITIONS[0]).filter((key) => key !== 'instanceIds').map((key) => [key, definition[key]])), instanceIds: definition.instances?.map((instance) => instance.instanceId) ?? [] }));
  if (!same(normalized, EXPECTED_DEFINITIONS) || definitions.some((definition) => definition.instances?.length !== definition.listingQuantity || Math.abs(definition.nativeCutLengthFt * 12 - definition.printedDimensionIn) > 0.00001) || fingerprint(definitions) !== EXPECTED_FINGERPRINT) issues.push(issue('NH_WET_QUANTITY_PLACEMENT_INVALID', 'definitions', 'Both BL34.01 and BL35.01 require two exact field-plan label/dimension anchors matching native length and listing quantity.'));
  const claims = evidence.claims;
  if (claims?.quantityExpandedLineLabelAnchorsReady !== true || claims?.quantityExpandedPrintedDimensionsReady !== true || claims?.quantityExpandedPieceEndpointMappingReady !== false || claims?.pieceToPlanVectorMappingReady !== false || claims?.fabricationReady !== false || claims?.fieldReleaseReady !== false) issues.push(issue('NH_WET_QUANTITY_FALSE_PROMOTION', 'claims', 'Quantity label anchors cannot promote endpoints, vectors, fabrication, or field release.'));
  const ready = issues.length === 0;
  return { projectId: EXPECTED.projectId, status: ready ? 'passed' : 'blocked', issues, definitions: ready ? structuredClone(definitions) : [], quantityExpandedLineLabelAnchorsReady: ready, quantityExpandedPrintedDimensionsReady: ready, quantityExpandedPieceEndpointMappingReady: false, pieceToPlanVectorMappingReady: false, fabricationReady: false, fieldReleaseReady: false };
}

export default { evaluateNewHopeWetQuantityPlacementEvidence };
