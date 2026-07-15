/** Source-bound dry-pipe grade envelope for the completed New Hope north-east ridge branch. */

const EXPECTED_PLAN_SHA = '5a770222363228c2766605a695fee9b6cb1f7b49c296204e09b691100253d9d5';
const EXPECTED_HEAD_SOURCE_IDS = Object.freeze(['head-040', 'head-042', 'head-044', 'head-046', 'head-048', 'head-050', 'head-052']);
const EXPECTED_CANONICAL_NODE_IDS_WEST_TO_EAST = Object.freeze([
  'canonical-node-106', 'canonical-node-105', 'canonical-node-104', 'canonical-node-103',
  'canonical-node-116', 'canonical-node-115', 'canonical-node-114', 'canonical-node-113',
]);
const EXPECTED_CANONICAL_EDGE_IDS_WEST_TO_EAST = Object.freeze([
  'source-edge-096', 'source-edge-095', 'source-edge-094', 'source-edge-107',
  'source-edge-106', 'source-edge-105', 'source-edge-104',
]);
const EXPECTED_HEAD_CANONICAL_NODE_IDS_WEST_TO_EAST = Object.freeze([
  'canonical-node-106', 'canonical-node-105', 'canonical-node-104', 'canonical-node-116',
  'canonical-node-115', 'canonical-node-114', 'canonical-node-113',
]);

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });
const round = (value, digits = 6) => Number(value.toFixed(digits));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function sourceNodeToCanonical(canonicalTopology, sourceNodeId) {
  return canonicalTopology?.nodes?.find((node) => node.memberNodeIds?.includes(sourceNodeId))?.id || null;
}

function buildAdjacency(canonicalTopology) {
  const adjacency = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, []]));
  for (const edge of canonicalTopology?.edges || []) {
    adjacency.get(edge.fromNodeId)?.push({ nodeId: edge.toNodeId, lengthFt: edge.planLengthFt });
    adjacency.get(edge.toNodeId)?.push({ nodeId: edge.fromNodeId, lengthFt: edge.planLengthFt });
  }
  return adjacency;
}

function distancesFrom(adjacency, sourceNodeIds) {
  const distances = new Map([...adjacency.keys()].map((nodeId) => [nodeId, Number.POSITIVE_INFINITY]));
  const queue = [];
  for (const nodeId of sourceNodeIds) {
    distances.set(nodeId, 0);
    queue.push({ nodeId, distanceFt: 0 });
  }
  while (queue.length) {
    queue.sort((a, b) => a.distanceFt - b.distanceFt);
    const current = queue.shift();
    if (current.distanceFt !== distances.get(current.nodeId)) continue;
    for (const next of adjacency.get(current.nodeId) || []) {
      const candidate = current.distanceFt + next.lengthFt;
      if (candidate < distances.get(next.nodeId)) {
        distances.set(next.nodeId, candidate);
        queue.push({ nodeId: next.nodeId, distanceFt: candidate });
      }
    }
  }
  return distances;
}

export function evaluateNewHopeRidgeBranchGradeEnvelope({
  pipeVectors,
  canonicalTopology,
  operationalAnnotations,
  atticSource,
  atticCalibration,
  answerEvidence,
}) {
  const issues = [];
  if (pipeVectors?.projectId !== 'new-hope-crisis-center-brigham-city-ut'
    || canonicalTopology?.projectId !== pipeVectors?.projectId
    || operationalAnnotations?.projectId !== pipeVectors?.projectId
    || atticSource?.projectId !== pipeVectors?.projectId
    || atticCalibration?.projectId !== pipeVectors?.projectId
    || answerEvidence?.projectId !== pipeVectors?.projectId) {
    issues.push(issue('NH_RIDGE_GRADE_PROJECT_IDENTITY_INVALID', 'All grade-envelope inputs must identify the same New Hope project.'));
  }
  if (answerEvidence?.approvedAnswer?.sha256 !== EXPECTED_PLAN_SHA
    || answerEvidence?.answerRegistration?.sourceFeatureId !== 'north-east-occupied-wing-gable-core'
    || answerEvidence?.answerRegistration?.approvedPdfRender?.widthPx !== 6048
    || answerEvidence?.answerRegistration?.approvedPdfRender?.heightPx !== 4320
    || JSON.stringify(answerEvidence?.answerRegistration?.approvedPdfRender?.featureBoundsPx) !== JSON.stringify({ x: 2400, y: 1035, width: 775, height: 1090 })) {
    issues.push(issue('NH_RIDGE_GRADE_ANSWER_REGISTRATION_INVALID', 'The approved FP2.0 feature registration changed.'));
  }
  if (atticSource?.feature?.id !== 'north-east-occupied-wing-gable-core'
    || atticSource?.feature?.branchline?.source !== 'approved-field-as-built-consensus'
    || atticSource?.feature?.branchline?.spacingFt !== 6
    || atticSource?.feature?.ridgeDatumZFt !== 21.208333
    || atticCalibration?.modelSelection?.sin !== 'TY4180'
    || atticCalibration?.modelSelection?.deflectorBelowPeakIn?.min !== 16
    || atticCalibration?.modelSelection?.deflectorBelowPeakIn?.max !== 22
    || atticCalibration?.heads?.length !== 7) {
    issues.push(issue('NH_RIDGE_GRADE_SOURCE_OR_MANUFACTURER_INVALID', 'The seven-head ridge consensus or bound TY4180 vertical criteria changed.'));
  }

  const planHeads = EXPECTED_HEAD_SOURCE_IDS.map((headId) => pipeVectors?.sprinklers?.find((head) => head.id === headId));
  const expectedCenters = [1236.9, 1290.9, 1344.9, 1398.9, 1452.9, 1506.899, 1560.903];
  if (planHeads.some((head, index) => !head || head.symbolType !== 'BB1' || head.centerPdfPt.y !== 798.45 || Math.abs(head.centerPdfPt.x - expectedCenters[index]) > 0.001)) {
    issues.push(issue('NH_RIDGE_GRADE_HEAD_REGISTRATION_INVALID', 'The seven approved BB1 vector centers changed.'));
  }

  const nodeById = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, node]));
  const edgeById = new Map((canonicalTopology?.edges || []).map((edge) => [edge.id, edge]));
  for (let index = 0; index < EXPECTED_CANONICAL_EDGE_IDS_WEST_TO_EAST.length; index += 1) {
    const edge = edgeById.get(EXPECTED_CANONICAL_EDGE_IDS_WEST_TO_EAST[index]);
    const fromNodeId = EXPECTED_CANONICAL_NODE_IDS_WEST_TO_EAST[index];
    const toNodeId = EXPECTED_CANONICAL_NODE_IDS_WEST_TO_EAST[index + 1];
    if (!edge || !([edge.fromNodeId, edge.toNodeId].includes(fromNodeId) && [edge.fromNodeId, edge.toNodeId].includes(toNodeId))) {
      issues.push(issue('NH_RIDGE_GRADE_EXPLICIT_PLAN_PATH_INVALID', 'The explicit west-to-east ridge path no longer follows the approved canonical edges.', EXPECTED_CANONICAL_EDGE_IDS_WEST_TO_EAST[index]));
    }
  }
  for (let index = 0; index < planHeads.length; index += 1) {
    const node = nodeById.get(EXPECTED_HEAD_CANONICAL_NODE_IDS_WEST_TO_EAST[index]);
    if (!node || !planHeads[index] || distance(node.pdfPt, planHeads[index].centerPdfPt) > 0.01) {
      issues.push(issue('NH_RIDGE_GRADE_HEAD_TO_CANONICAL_NODE_INVALID', 'An approved ridge head no longer binds its exact canonical plan node.', EXPECTED_HEAD_SOURCE_IDS[index]));
    }
  }

  const lowPoints = (operationalAnnotations?.lowPointAnchors || []).map((anchor) => ({
    id: anchor.id,
    canonicalNodeIds: [...new Set(anchor.boundPrimaryNodeIds.map((sourceNodeId) => sourceNodeToCanonical(canonicalTopology, sourceNodeId)).filter(Boolean))],
  }));
  const lowPoint04 = lowPoints.find((entry) => entry.id === 'low-point-04');
  if (lowPoints.length !== 4 || JSON.stringify(lowPoint04?.canonicalNodeIds) !== JSON.stringify(['canonical-node-056'])) {
    issues.push(issue('NH_RIDGE_GRADE_LOW_POINT_BINDING_INVALID', 'The source-proved low-point-04 anchor must remain bound to canonical-node-056.'));
  }
  const adjacency = buildAdjacency(canonicalTopology);
  const distanceByLowPoint = lowPoints.map((entry) => ({ ...entry, distances: distancesFrom(adjacency, entry.canonicalNodeIds) }));
  const drainageAudit = EXPECTED_HEAD_CANONICAL_NODE_IDS_WEST_TO_EAST.map((nodeId, index) => {
    const candidates = distanceByLowPoint.map((entry) => ({ lowPointId: entry.id, distanceFt: entry.distances.get(nodeId) })).sort((a, b) => a.distanceFt - b.distanceFt);
    return {
      headId: atticCalibration?.heads?.[index]?.id,
      canonicalNodeId: nodeId,
      nearestLowPointId: candidates[0]?.lowPointId,
      distanceToLowPoint04Ft: round(candidates.find((entry) => entry.lowPointId === 'low-point-04')?.distanceFt || 0),
      alternateLowPointMarginFt: round((candidates[1]?.distanceFt || 0) - (candidates[0]?.distanceFt || 0)),
    };
  });
  if (drainageAudit.some((entry) => entry.nearestLowPointId !== 'low-point-04' || entry.alternateLowPointMarginFt < 70)) {
    issues.push(issue('NH_RIDGE_GRADE_DRAINAGE_CATCHMENT_AMBIGUOUS', 'Every bounded ridge head must remain uniquely in low-point-04 catchment with at least a 70-foot alternate margin.'));
  }
  const eastTerminalDegree = (adjacency.get('canonical-node-112') || []).length;
  const westSystemContinuationDegree = (adjacency.get('canonical-node-098') || []).length;
  if (eastTerminalDegree !== 1 || westSystemContinuationDegree !== 2 || !edgeById.has('source-edge-103') || !edgeById.has('source-edge-097')) {
    issues.push(issue('NH_RIDGE_GRADE_TERMINAL_TO_SYSTEM_TOPOLOGY_INVALID', 'The ridge must remain terminal at the east cap and connected to the system only through its west continuation.'));
  }

  const gradeRiseInPer10Ft = operationalAnnotations?.gradeRequirements?.find((entry) => entry.pipeRole === 'branch-line')?.riseInPer10Ft;
  if (gradeRiseInPer10Ft !== 0.5) issues.push(issue('NH_RIDGE_GRADE_MAGNITUDE_INVALID', 'The branch grade must remain one-half inch every ten feet.'));
  const permittedRange = atticCalibration?.heads?.[0]?.permittedDeflectorZRangeFt;
  const permittedRangeReady = Number.isFinite(permittedRange?.min) && Number.isFinite(permittedRange?.max) && permittedRange.max > permittedRange.min;
  if (!permittedRangeReady) {
    issues.push(issue('NH_RIDGE_GRADE_DEFLECTOR_RANGE_INVALID', 'The bound TY4180 deflector range must provide finite minimum and maximum elevations.'));
  }
  if (atticCalibration?.heads?.some((head) => JSON.stringify(head.permittedDeflectorZRangeFt) !== JSON.stringify(permittedRange))) {
    issues.push(issue('NH_RIDGE_GRADE_DEFLECTOR_RANGE_INCONSISTENT', 'All seven heads must share the bound TY4180 ridge deflector range.'));
  }
  const gradeRiseFtPerHeadSpacing = gradeRiseInPer10Ft / 12 * (atticSource?.feature?.branchline?.spacingFt / 10);
  const totalRiseFt = gradeRiseFtPerHeadSpacing * 6;
  const lowEndpointSelectionRangeFt = permittedRangeReady && Number.isFinite(totalRiseFt) ? { min: permittedRange.min, max: round(permittedRange.max - totalRiseFt) } : null;
  const headElevationEnvelopes = (atticCalibration?.heads || []).map((head, index) => ({
    headId: head.id,
    sourcePlanHeadId: EXPECTED_HEAD_SOURCE_IDS[index],
    canonicalNodeId: EXPECTED_HEAD_CANONICAL_NODE_IDS_WEST_TO_EAST[index],
    planPdfPt: planHeads[index]?.centerPdfPt,
    stationFtFromWestLowEnd: index * 6,
    minimumDeflectorZFt: lowEndpointSelectionRangeFt ? round(permittedRange.min + gradeRiseFtPerHeadSpacing * index) : null,
    maximumDeflectorZFt: lowEndpointSelectionRangeFt ? round(lowEndpointSelectionRangeFt.max + gradeRiseFtPerHeadSpacing * index) : null,
  }));
  const ready = issues.length === 0;
  return {
    artifactType: 'halofire.new-hope-ridge-branch-grade-envelope-result.v1',
    projectId: pipeVectors?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    boundedFeatureId: atticSource?.feature?.id,
    gradeDirection: 'east-high-to-west-low',
    drainCatchmentAnchorId: 'low-point-04',
    terminalEastNodeId: 'canonical-node-112',
    systemContinuationWestNodeId: 'canonical-node-098',
    canonicalNodeIdsHighToLow: [...EXPECTED_CANONICAL_NODE_IDS_WEST_TO_EAST].reverse(),
    canonicalEdgeIdsHighToLow: [...EXPECTED_CANONICAL_EDGE_IDS_WEST_TO_EAST].reverse(),
    drainageAudit,
    gradeRiseInPer10Ft,
    gradeRiseFtPerHeadSpacing: round(gradeRiseFtPerHeadSpacing),
    totalHeadRowRiseFt: round(totalRiseFt),
    totalHeadRowRiseIn: round(totalRiseFt * 12),
    lowEndpointSelectionRangeFt,
    headElevationEnvelopes,
    boundedBranchPlanPathReady: ready,
    boundedBranchGradeMagnitudeReady: ready,
    boundedBranchGradeDirectionReady: ready,
    boundedBranchDrainCatchmentReady: ready,
    boundedDeflectorGradeEnvelopeReady: ready,
    exactDeflectorElevationsReady: false,
    exactPipeCenterlineZReady: false,
    exactDrainRouteReady: false,
    wholeFp20GradeDirectionReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}
