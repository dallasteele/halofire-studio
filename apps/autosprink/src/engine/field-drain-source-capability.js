/**
 * Evaluates whether one project's own source corpus is sufficient to emit a
 * field-drain route.  It deliberately treats completed projects as method
 * calibration only: their geometry can never satisfy another project's gate.
 */

const SHA256 = /^[a-f0-9]{64}$/i;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const EVIDENCE_STATES = new Set([
  'no-project-drain-evidence',
  'field-resolution-required',
  'source-resolved',
]);

const issue = (code, message, refs = []) => ({ severity: 'blocking', code, message, refs });
const pointIsFinite = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y);

function validateReceipt(receipt, issues) {
  if (receipt?.artifactType !== 'halofire.field-drain-source-capability-receipt.v1') {
    issues.push(issue('FIELD_DRAIN_RECEIPT_TYPE_INVALID', 'A versioned field-drain source-capability receipt is required.'));
  }
  if (!PROJECT_ID.test(receipt?.projectId || '')) {
    issues.push(issue('FIELD_DRAIN_PROJECT_ID_INVALID', 'The field-drain receipt must have a valid project identity.'));
  }

  const documents = Array.isArray(receipt?.sourceDocuments) ? receipt.sourceDocuments : [];
  const documentIds = new Set();
  for (const document of documents) {
    if (!document?.id || documentIds.has(document.id) || !SHA256.test(document.sha256 || '') || !document.role) {
      issues.push(issue('FIELD_DRAIN_SOURCE_DOCUMENT_INVALID', 'Each source document needs a unique id, role, and SHA-256 digest.', [document?.id].filter(Boolean)));
    }
    documentIds.add(document?.id);
  }
  if (!documents.length) issues.push(issue('FIELD_DRAIN_SOURCE_DOCUMENTS_MISSING', 'A project-specific source-document receipt is required.'));

  const drainEvidence = receipt?.drainEvidence;
  if (!EVIDENCE_STATES.has(drainEvidence?.state)) {
    issues.push(issue('FIELD_DRAIN_EVIDENCE_STATE_INVALID', 'Drain evidence must explicitly be absent, field-resolution-required, or source-resolved.'));
  }
  const sourceRefs = Array.isArray(drainEvidence?.sourceRefs) ? drainEvidence.sourceRefs : [];
  if (sourceRefs.some((id) => !documentIds.has(id))) {
    issues.push(issue('FIELD_DRAIN_SOURCE_REFERENCE_INVALID', 'Drain evidence may reference only documents from the same project receipt.', sourceRefs));
  }
  return { documents, documentIds, drainEvidence, sourceRefs };
}

function validateCandidateRoute(receipt, candidate, sourceContext, issues) {
  if (!candidate) {
    issues.push(issue('FIELD_DRAIN_SOURCE_RESOLVED_ROUTE_MISSING', 'Source-resolved drain evidence still requires an emitted, source-bound route candidate.'));
    return;
  }
  if (candidate.projectId !== receipt.projectId) {
    issues.push(issue('FIELD_DRAIN_CROSS_PROJECT_GEOMETRY_REJECTED', 'Drain geometry must originate from the same project as its source-capability receipt.', [candidate.projectId, receipt.projectId].filter(Boolean)));
  }
  const sourceDocument = sourceContext.documents.find((document) => document.id === candidate.sourceDocumentId);
  if (!sourceDocument || !SHA256.test(candidate.sourceDigest || '') || candidate.sourceDigest !== sourceDocument.sha256) {
    issues.push(issue('FIELD_DRAIN_CANDIDATE_SOURCE_DIGEST_INVALID', 'A drain route candidate must cite one same-project source document and its exact SHA-256 digest.', [candidate?.sourceDocumentId].filter(Boolean)));
  }
  const segments = Array.isArray(candidate.routeSegments) ? candidate.routeSegments : [];
  const segmentIds = new Set();
  if (!segments.length) issues.push(issue('FIELD_DRAIN_ROUTE_SEGMENTS_MISSING', 'A source-resolved drain route needs at least one source-bound segment.'));
  for (const segment of segments) {
    if (!segment?.id || segmentIds.has(segment.id) || !pointIsFinite(segment.fromPdfPt) || !pointIsFinite(segment.toPdfPt)
      || segment.sourceDigest !== candidate.sourceDigest) {
      issues.push(issue('FIELD_DRAIN_ROUTE_SEGMENT_INVALID', 'Every route segment needs a unique id, finite source coordinates, and the candidate source digest.', [segment?.id].filter(Boolean)));
    }
    segmentIds.add(segment?.id);
  }
}

/**
 * Returns a truthful capability result for one project and an optional drain
 * route candidate.  A passed result means only that the candidate is bound to
 * its project source; it never conveys permit, fabrication, or field approval.
 */
export function evaluateFieldDrainSourceCapability(receipt, candidate = null) {
  const issues = [];
  const sourceContext = validateReceipt(receipt, issues);
  const state = sourceContext.drainEvidence?.state;

  if (state === 'no-project-drain-evidence') {
    issues.push(issue('FIELD_DRAIN_SOURCE_EVIDENCE_ABSENT', 'No project-specific drain source exists. Do not infer or emit drain geometry.', [receipt?.projectId].filter(Boolean)));
    if (candidate?.routeSegments?.length) issues.push(issue('FIELD_DRAIN_UNSOURCED_GEOMETRY_REJECTED', 'A project with no drain source cannot accept route geometry.'));
  } else if (state === 'field-resolution-required') {
    issues.push(issue('FIELD_DRAIN_ROUTE_FIELD_RESOLUTION_REQUIRED', 'The source requires field routing or low-point location. Exact drain geometry remains blocked.', sourceContext.sourceRefs));
    if (candidate?.routeSegments?.length) issues.push(issue('FIELD_DRAIN_FIELD_ROUTE_PROMOTION_REJECTED', 'Field-resolution-required evidence cannot be promoted into an exact route before same-project field evidence is received.'));
  } else if (state === 'source-resolved') {
    validateCandidateRoute(receipt, candidate, sourceContext, issues);
  }

  const routeGeometryReady = issues.length === 0 && state === 'source-resolved';
  return {
    artifactType: 'halofire.field-drain-source-capability-result.v1',
    projectId: receipt?.projectId ?? null,
    status: routeGeometryReady ? 'passed' : 'blocked',
    routeGeometryReady,
    crossProjectGeometryTransferAllowed: false,
    issues,
    limitations: [
      'A passed source-capability result does not establish drainage grade, installation, fabrication, permit, AHJ, or employee-use readiness.',
      'Geometry from a completed or calibration project cannot satisfy this project receipt.'
    ],
    nextAction: routeGeometryReady
      ? 'Run the downstream drainage-grade and installation-evidence gates.'
      : 'Acquire project-specific source evidence or preserve the source-required field-resolution hold.'
  };
}
