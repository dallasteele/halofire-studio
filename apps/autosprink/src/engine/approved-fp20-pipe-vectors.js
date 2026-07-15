/**
 * Deterministic acceptance for the vector geometry exposed by New Hope's
 * approved FP2.0 answer sheet. This gate proves extraction fidelity only. It
 * deliberately does not promote plan vectors into a fabrication/compliance
 * graph until size, role, flow, grade direction, elevation, fittings, drains,
 * and riser topology close on the same project.
 */

const EXPECTED_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5';
const EXPECTED_PIPE_CLASSES = Object.freeze({ 'red-pipe': 40, 'black-pipe': 15, 'navy-arm-over': 12 });
const EXPECTED_HEAD_CLASSES = Object.freeze({ BB1: 58, SD1: 6, 'TY-FRB': 4 });
const EXPECTED_PIPE_STYLE = Object.freeze({
  'red-pipe': [0.753, 0, 0],
  'black-pipe': [0, 0, 0],
  'navy-arm-over': [0, 0, 0.502],
});

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });
const finitePoint = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const round = (value, digits = 6) => Number(value.toFixed(digits));
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const sameRgb = (actual, expected) => Array.isArray(actual) && actual.length === 3 && actual.every((value, index) => Math.abs(value - expected[index]) <= 0.0005);

function pointToSegmentDistance(point, segment) {
  const a = segment.fromPdfPt;
  const b = segment.toPdfPt;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function segmentDistance(a, b) {
  return Math.min(
    pointToSegmentDistance(a.fromPdfPt, b),
    pointToSegmentDistance(a.toPdfPt, b),
    pointToSegmentDistance(b.fromPdfPt, a),
    pointToSegmentDistance(b.toPdfPt, a),
  );
}

function topologyClosure(segments, evidence, issues) {
  const configuredTolerance = evidence?.topologyClosure?.automaticJoinTolerancePdfPt;
  const links = Array.isArray(evidence?.topologyClosure?.explicitMaskedTurnLinks) ? evidence.topologyClosure.explicitMaskedTurnLinks : [];
  if (configuredTolerance !== 6) issues.push(issue('FP20_TOPOLOGY_TOLERANCE_INVALID', 'Automatic source-vector joining is fixed at 6 PDF points; broad snapping can fabricate pipe connections.'));
  const expectedLinks = new Map([
    ['lower-central-main-turn', ['pipe-065', 'pipe-067']],
    ['upper-central-main-turn', ['pipe-066', 'pipe-060']],
  ]);
  const parent = segments.map((_, index) => index);
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) { const next = parent[value]; parent[value] = root; value = next; }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  const indexById = new Map(segments.map((segment, index) => [segment.id, index]));
  if (configuredTolerance === 6) {
    for (let i = 0; i < segments.length; i += 1) {
      for (let j = 0; j < i; j += 1) if (segmentDistance(segments[i], segments[j]) <= configuredTolerance) union(i, j);
    }
  }
  if (links.length !== 2) issues.push(issue('FP20_TOPOLOGY_EXPLICIT_LINK_COUNT_INVALID', 'Exactly two source-proved masked central turns are required; generic gap filling is forbidden.'));
  for (const link of links) {
    const expected = expectedLinks.get(link?.id);
    const fromIndex = indexById.get(link?.fromSegmentId);
    const toIndex = indexById.get(link?.toSegmentId);
    if (!expected || !expected.includes(link?.fromSegmentId) || !expected.includes(link?.toSegmentId) || link.fromSegmentId === link.toSegmentId || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || !link.sourceRef) {
      issues.push(issue('FP20_TOPOLOGY_EXPLICIT_LINK_INVALID', 'Masked-turn links must bind the exact approved central segment pairs with source references.', link?.id));
      continue;
    }
    const measuredGap = segmentDistance(segments[fromIndex], segments[toIndex]);
    if (!Number.isFinite(link.gapPdfPt) || Math.abs(measuredGap - link.gapPdfPt) > 0.002 || measuredGap <= 6 || measuredGap > 9) issues.push(issue('FP20_TOPOLOGY_EXPLICIT_GAP_MISMATCH', 'Explicit masked-turn gap must close against the approved endpoints and stay outside automatic tolerance.', link.id));
    union(fromIndex, toIndex);
  }
  const connectedPipeVectorCount = segments.length ? segments.filter((_, index) => find(index) === find(0)).length : 0;
  if (connectedPipeVectorCount !== segments.length) issues.push(issue('FP20_SOURCE_TOPOLOGY_DISCONNECTED', 'Every extracted approved pipe vector must close into one source topology.'));
  return { connectedPipeVectorCount, explicitMaskedTurnCount: links.length };
}

function increment(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function compareCounts(actual, expected) {
  return Object.keys({ ...actual, ...expected }).every((key) => actual[key] === expected[key]);
}

export function evaluateApprovedFp20PipeVectors(evidence) {
  const issues = [];
  const segments = Array.isArray(evidence?.pipeSegments) ? evidence.pipeSegments : [];
  const sprinklers = Array.isArray(evidence?.sprinklers) ? evidence.sprinklers : [];
  const segmentById = new Map();
  const pipeClassCounts = {};
  const sprinklerClassCounts = {};

  if (evidence?.artifactType !== 'halofire.approved-fp20-pipe-vector-evidence.v1' || evidence?.projectId !== 'new-hope-crisis-center-brigham-city-ut') issues.push(issue('FP20_VECTOR_IDENTITY_INVALID', 'The project-specific approved FP2.0 vector identity changed.'));
  if (evidence?.source?.sha256 !== EXPECTED_SHA || evidence?.source?.sheet !== 'FP2.0' || evidence?.source?.physicalPage !== 5) issues.push(issue('FP20_VECTOR_SOURCE_BINDING_INVALID', 'The extraction must remain bound to the exact approved FP2.0 source page and hash.'));
  if (evidence?.source?.pageBoxPdfPt?.width !== 3024 || evidence?.source?.pageBoxPdfPt?.height !== 2160 || Math.abs(evidence?.planRegistration?.pdfPtPerFt - 8.999890909) > 0.000001) issues.push(issue('FP20_VECTOR_PLAN_REGISTRATION_INVALID', 'The approved page box or plan scale registration changed.'));

  for (const segment of segments) {
    if (!segment?.id || segmentById.has(segment.id)) { issues.push(issue('FP20_PIPE_SEGMENT_ID_INVALID', 'Every extracted pipe vector needs a unique identity.', segment?.id)); continue; }
    segmentById.set(segment.id, segment);
    increment(pipeClassCounts, segment.strokeClass);
    if (!EXPECTED_PIPE_STYLE[segment.strokeClass] || !sameRgb(segment.strokeRgb, EXPECTED_PIPE_STYLE[segment.strokeClass]) || segment.strokeWidthPdfPt !== 0.014 || segment.whiteMaskTwin !== true) issues.push(issue('FP20_PIPE_STYLE_SIGNATURE_INVALID', 'Every pipe vector must preserve its approved stroke and white-mask twin signature.', segment.id));
    if (!finitePoint(segment.fromPdfPt) || !finitePoint(segment.toPdfPt)) { issues.push(issue('FP20_PIPE_SEGMENT_GEOMETRY_INVALID', 'Every pipe vector needs two finite PDF-space endpoints.', segment.id)); continue; }
    const measuredLength = distance(segment.fromPdfPt, segment.toPdfPt);
    if (measuredLength <= 0.5 || !Number.isFinite(segment.lengthPdfPt) || Math.abs(measuredLength - segment.lengthPdfPt) > 0.002) issues.push(issue('FP20_PIPE_SEGMENT_LENGTH_INVALID', 'Pipe vector length must close against its source endpoints and exclude degenerate marks.', segment.id));
    for (const point of [segment.fromPdfPt, segment.toPdfPt]) {
      if (point.x < 0 || point.x > 3024 || point.y < 0 || point.y > 2160) issues.push(issue('FP20_PIPE_SEGMENT_OUTSIDE_PAGE', 'Pipe vector endpoints must remain inside the approved sheet.', segment.id));
    }
    if (!Number.isInteger(segment.drawingIndex)) issues.push(issue('FP20_PIPE_SOURCE_REF_MISSING', 'Every pipe vector needs its replayable source drawing index.', segment.id));
  }

  if (!compareCounts(pipeClassCounts, EXPECTED_PIPE_CLASSES)) issues.push(issue('FP20_PIPE_CLASS_COUNT_MISMATCH', 'The approved extraction must contain 40 red, 15 black, and 12 navy arm-over vectors.'));
  const topology = topologyClosure(segments, evidence, issues);

  for (const sprinkler of sprinklers) {
    increment(sprinklerClassCounts, sprinkler?.symbolType);
    if (!finitePoint(sprinkler?.centerPdfPt) || !Number.isInteger(sprinkler?.drawingIndex)) { issues.push(issue('FP20_HEAD_SOURCE_GEOMETRY_INVALID', 'Every approved sprinkler needs a PDF center and source drawing index.', sprinkler?.id)); continue; }
    const expectedItems = sprinkler.symbolType === 'BB1' ? 25 : sprinkler.symbolType === 'SD1' ? 23 : sprinkler.symbolType === 'TY-FRB' ? 21 : null;
    if (sprinkler.symbolItemCount !== expectedItems || sprinkler.symbolStrokeWidthPdfPt !== 0.4 || Math.abs(sprinkler.symbolBoundsPdfPt?.width - 9) > 0.01 || sprinkler.symbolBoundsPdfPt?.height < 8 || sprinkler.symbolBoundsPdfPt?.height > 9.01) issues.push(issue('FP20_HEAD_SYMBOL_SIGNATURE_INVALID', 'Sprinkler type must close against the approved vector-symbol signature.', sprinkler?.id));
    const distances = segments.map((segment) => ({ segment, distance: pointToSegmentDistance(sprinkler.centerPdfPt, segment) })).sort((a, b) => a.distance - b.distance || a.segment.id.localeCompare(b.segment.id));
    const nearest = distances[0];
    if (!nearest || nearest.distance > 1.5) issues.push(issue('FP20_HEAD_PIPE_PATH_MISSING', 'Every approved sprinkler must land on a source-extracted pipe or arm-over path.', sprinkler?.id));
    else {
      if (sprinkler.nearestPipeSegmentId !== nearest.segment.id) issues.push(issue('FP20_HEAD_PIPE_BINDING_MISMATCH', 'The stored nearest pipe binding must match recomputed source geometry.', sprinkler?.id));
      if (!Number.isFinite(sprinkler.pipeDistancePdfPt) || Math.abs(nearest.distance - sprinkler.pipeDistancePdfPt) > 0.002) issues.push(issue('FP20_HEAD_PIPE_DISTANCE_MISMATCH', 'Head-to-pipe distance must close against recomputed source geometry.', sprinkler?.id));
    }
  }

  if (!compareCounts(sprinklerClassCounts, EXPECTED_HEAD_CLASSES)) issues.push(issue('FP20_HEAD_CLASS_COUNT_MISMATCH', 'The approved legend must close at 58 BB1, 6 SD1, and 4 TY-FRB sprinklers.'));
  const totalLengthPdfPt = segments.reduce((sum, segment) => sum + (Number.isFinite(segment.lengthPdfPt) ? segment.lengthPdfPt : 0), 0);
  const uniqueCodes = [...new Set(issues.map((entry) => entry.code))];
  return {
    status: issues.length ? 'blocked' : 'passed',
    issues,
    blockerCodes: uniqueCodes,
    metrics: {
      pipeVectorCount: segments.length,
      sprinklerCount: sprinklers.length,
      pipeClassCounts,
      sprinklerClassCounts,
      totalVisiblePipeLengthFt: round(totalLengthPdfPt / evidence?.planRegistration?.pdfPtPerFt, 3),
      maximumHeadToPipeDistancePdfPt: round(Math.max(0, ...sprinklers.map((head) => head.pipeDistancePdfPt || 0)), 3),
      connectedPipeVectorCount: topology.connectedPipeVectorCount,
      explicitMaskedTurnCount: topology.explicitMaskedTurnCount,
    },
    vectorExtractionReady: issues.length === 0,
    sourceTopologyConnected: issues.length === 0 && topology.connectedPipeVectorCount === segments.length,
    properPipeLayoutReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}

export function pdfPointToRegisteredPlanFt(evidence, point) {
  const registration = evidence.planRegistration;
  return {
    xFt: round(registration.origin.localFt.x + (point.x - registration.origin.pdfPt.x) / registration.pdfPtPerFt),
    yFt: round(registration.origin.localFt.y + (point.y - registration.origin.pdfPt.y) / registration.pdfPtPerFt),
  };
}
