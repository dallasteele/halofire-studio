/** Source-bound drainage direction and relative grade for the two complete 14-head FP2.0 branch systems. */

const EXPECTED_PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5';
const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut';
const EXPECTED_SYSTEMS = Object.freeze([
  {
    id: 'lower-long-branch-system',
    lowPointId: 'low-point-01',
    rootNodeIds: ['canonical-node-054', 'canonical-node-059'],
    terminalNodeIds: ['canonical-node-079', 'canonical-node-107'],
    sourceSegmentIds: ['pipe-032', 'pipe-035', 'pipe-038', 'pipe-040', 'pipe-048', 'pipe-050', 'pipe-052'],
    edgeCount: 22,
    nodeCount: 23,
    sprinklerCount: 14,
  },
  {
    id: 'upper-long-branch-system',
    lowPointId: 'low-point-04',
    rootNodeIds: ['canonical-node-056'],
    terminalNodeIds: ['canonical-node-083', 'canonical-node-112'],
    sourceSegmentIds: ['pipe-033', 'pipe-034', 'pipe-039', 'pipe-041', 'pipe-049', 'pipe-051', 'pipe-053'],
    edgeCount: 22,
    nodeCount: 23,
    sprinklerCount: 14,
  },
]);

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });
const round = (value, digits = 6) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
const sorted = (values) => [...values].sort();

function sourceNodeToCanonical(canonicalTopology, sourceNodeId) {
  return canonicalTopology?.nodes?.find((node) => node.memberNodeIds?.includes(sourceNodeId))?.id || null;
}

function buildBranchAdjacency(canonicalTopology, governedSkeleton) {
  const roleBySegmentId = new Map((governedSkeleton?.primaryAssignments || []).map((entry) => [entry.sourceSegmentId, entry.systemRole]));
  const branchEdges = (canonicalTopology?.edges || []).filter((edge) => ['branch-line', 'arm-over'].includes(roleBySegmentId.get(edge.sourceSegmentId)));
  const adjacency = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, []]));
  for (const edge of branchEdges) {
    adjacency.get(edge.fromNodeId)?.push({ edge, nodeId: edge.toNodeId });
    adjacency.get(edge.toNodeId)?.push({ edge, nodeId: edge.fromNodeId });
  }
  return { adjacency, branchEdges };
}

function collectComponent(adjacency, rootNodeIds) {
  const nodeIds = new Set(rootNodeIds.filter((nodeId) => adjacency.has(nodeId)));
  const edgeById = new Map();
  const queue = [...nodeIds];
  while (queue.length) {
    const nodeId = queue.shift();
    for (const next of adjacency.get(nodeId) || []) {
      edgeById.set(next.edge.id, next.edge);
      if (!nodeIds.has(next.nodeId)) {
        nodeIds.add(next.nodeId);
        queue.push(next.nodeId);
      }
    }
  }
  return { nodeIds: [...nodeIds], edges: [...edgeById.values()] };
}

function distancesFromRoots(adjacency, rootNodeIds) {
  const distances = new Map([...adjacency.keys()].map((nodeId) => [nodeId, Number.POSITIVE_INFINITY]));
  const queue = [];
  for (const nodeId of rootNodeIds) {
    distances.set(nodeId, 0);
    queue.push({ nodeId, distanceFt: 0 });
  }
  while (queue.length) {
    queue.sort((a, b) => a.distanceFt - b.distanceFt);
    const current = queue.shift();
    if (current.distanceFt !== distances.get(current.nodeId)) continue;
    for (const next of adjacency.get(current.nodeId) || []) {
      const candidate = current.distanceFt + next.edge.planLengthFt;
      if (candidate < distances.get(next.nodeId)) {
        distances.set(next.nodeId, candidate);
        queue.push({ nodeId: next.nodeId, distanceFt: candidate });
      }
    }
  }
  return distances;
}

export function evaluateNewHopeLongBranchDrainage({
  pipeVectors,
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
}) {
  const issues = [];
  if (pipeVectors?.projectId !== EXPECTED_PROJECT_ID
    || canonicalTopology?.projectId !== EXPECTED_PROJECT_ID
    || governedSkeleton?.projectId !== EXPECTED_PROJECT_ID
    || operationalAnnotations?.projectId !== EXPECTED_PROJECT_ID) {
    issues.push(issue('NH_LONG_BRANCH_PROJECT_IDENTITY_INVALID', 'All long-branch drainage inputs must identify the New Hope project.'));
  }
  if (pipeVectors?.source?.sha256 !== EXPECTED_PLAN_SHA
    || pipeVectors?.source?.sheet !== 'FP2.0'
    || pipeVectors?.source?.physicalPage !== 5) {
    issues.push(issue('NH_LONG_BRANCH_PLAN_SOURCE_INVALID', 'Long-branch drainage must remain bound to the exact approved FP2.0 source page.'));
  }
  if (!governedSkeleton?.primaryPipeRoleAssignmentReady) {
    issues.push(issue('NH_LONG_BRANCH_ROLE_ASSIGNMENT_NOT_READY', 'Source segments must pass governed branch-line and cross-main role assignment before drainage orientation.'));
  }
  const branchGrade = operationalAnnotations?.gradeRequirements?.find((entry) => entry.id === 'grade-branch-lines');
  if (branchGrade?.pipeRole !== 'branch-line' || branchGrade?.riseInPer10Ft !== 0.5) {
    issues.push(issue('NH_LONG_BRANCH_GRADE_MAGNITUDE_INVALID', 'The approved branch-line grade must remain one-half inch every ten feet.'));
  }

  const nodeById = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, node]));
  const { adjacency } = buildBranchAdjacency(canonicalTopology, governedSkeleton);
  const lowPointById = new Map((operationalAnnotations?.lowPointAnchors || []).map((entry) => [entry.id, entry]));
  const systemResults = [];

  for (const expected of EXPECTED_SYSTEMS) {
    const sourceLowPoint = lowPointById.get(expected.lowPointId);
    const boundRootNodeIds = sorted(new Set((sourceLowPoint?.boundPrimaryNodeIds || []).map((sourceNodeId) => sourceNodeToCanonical(canonicalTopology, sourceNodeId)).filter(Boolean)));
    if (sourceLowPoint?.rawText !== 'LOW POINT TIE IN DRAIN' || JSON.stringify(boundRootNodeIds) !== JSON.stringify(sorted(expected.rootNodeIds))) {
      issues.push(issue('NH_LONG_BRANCH_LOW_POINT_BINDING_INVALID', `${expected.lowPointId} no longer binds its exact canonical root zone.`, expected.id));
    }

    const component = collectComponent(adjacency, expected.rootNodeIds);
    const sourceSegmentIds = sorted(new Set(component.edges.map((edge) => edge.sourceSegmentId)));
    const sprinklerIds = sorted(component.nodeIds.flatMap((nodeId) => nodeById.get(nodeId)?.sprinklerIds || []));
    const cycleRank = component.edges.length - component.nodeIds.length + 1;
    const rootSet = new Set(expected.rootNodeIds);
    const terminalNodeIds = sorted(component.nodeIds.filter((nodeId) => !rootSet.has(nodeId) && (adjacency.get(nodeId) || []).length === 1));
    if (component.edges.length !== expected.edgeCount
      || component.nodeIds.length !== expected.nodeCount
      || sprinklerIds.length !== expected.sprinklerCount
      || cycleRank !== 0
      || JSON.stringify(sourceSegmentIds) !== JSON.stringify(sorted(expected.sourceSegmentIds))
      || JSON.stringify(terminalNodeIds) !== JSON.stringify(sorted(expected.terminalNodeIds))) {
      issues.push(issue('NH_LONG_BRANCH_COMPONENT_TOPOLOGY_INVALID', `${expected.id} must remain the exact source-drawn acyclic 14-head component with two non-low-point terminals.`, expected.id));
    }

    const distances = distancesFromRoots(adjacency, expected.rootNodeIds);
    const directedEdges = [];
    const lowPointZoneEdgeIds = [];
    for (const edge of component.edges) {
      if (rootSet.has(edge.fromNodeId) && rootSet.has(edge.toNodeId)) {
        lowPointZoneEdgeIds.push(edge.id);
        continue;
      }
      const fromDistanceFt = distances.get(edge.fromNodeId);
      const toDistanceFt = distances.get(edge.toNodeId);
      if (!Number.isFinite(fromDistanceFt) || !Number.isFinite(toDistanceFt) || Math.abs(fromDistanceFt - toDistanceFt) < 0.000001) {
        issues.push(issue('NH_LONG_BRANCH_EDGE_DIRECTION_AMBIGUOUS', 'Every non-low-point-zone branch edge must have one endpoint strictly closer to its source-proved low point.', edge.id));
        continue;
      }
      const highNodeId = fromDistanceFt > toDistanceFt ? edge.fromNodeId : edge.toNodeId;
      const lowNodeId = highNodeId === edge.fromNodeId ? edge.toNodeId : edge.fromNodeId;
      const highDistanceFt = Math.max(fromDistanceFt, toDistanceFt);
      const lowDistanceFt = Math.min(fromDistanceFt, toDistanceFt);
      if (Math.abs((highDistanceFt - lowDistanceFt) - edge.planLengthFt) > 0.00001) {
        issues.push(issue('NH_LONG_BRANCH_EDGE_NOT_ON_ROOTED_TREE_PATH', 'A branch edge no longer advances monotonically toward its bound low-point zone.', edge.id));
      }
      directedEdges.push({
        edgeId: edge.id,
        sourceSegmentId: edge.sourceSegmentId,
        highNodeId,
        lowNodeId,
        highPdfPt: nodeById.get(highNodeId)?.pdfPt,
        lowPdfPt: nodeById.get(lowNodeId)?.pdfPt,
        planLengthFt: edge.planLengthFt,
        requiredDropIn: round(edge.planLengthFt * branchGrade?.riseInPer10Ft / 10),
      });
    }
    const terminalProfiles = expected.terminalNodeIds.map((terminalNodeId) => ({
      terminalNodeId,
      lowPointId: expected.lowPointId,
      planRunLengthFt: round(distances.get(terminalNodeId)),
      requiredRiseFromLowPointIn: round(distances.get(terminalNodeId) * branchGrade?.riseInPer10Ft / 10),
    }));
    systemResults.push({
      id: expected.id,
      lowPointId: expected.lowPointId,
      rootNodeIds: expected.rootNodeIds,
      terminalNodeIds: expected.terminalNodeIds,
      sourceSegmentIds,
      nodeCount: component.nodeIds.length,
      edgeCount: component.edges.length,
      sprinklerCount: sprinklerIds.length,
      sprinklerIds,
      cycleRank,
      directedEdges,
      lowPointZoneEdgeIds,
      terminalProfiles,
    });
  }

  const ready = issues.length === 0;
  return {
    artifactType: 'halofire.new-hope-long-branch-drainage-result.v1',
    projectId: pipeVectors?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    branchSystems: systemResults,
    metrics: {
      branchSystemCount: systemResults.length,
      sourceSegmentCount: new Set(systemResults.flatMap((entry) => entry.sourceSegmentIds)).size,
      canonicalEdgeCount: systemResults.reduce((sum, entry) => sum + entry.edgeCount, 0),
      directedEdgeCount: systemResults.reduce((sum, entry) => sum + entry.directedEdges.length, 0),
      lowPointZoneEdgeCount: systemResults.reduce((sum, entry) => sum + entry.lowPointZoneEdgeIds.length, 0),
      sprinklerCount: systemResults.reduce((sum, entry) => sum + entry.sprinklerCount, 0),
      terminalProfileCount: systemResults.reduce((sum, entry) => sum + entry.terminalProfiles.length, 0),
    },
    longBranchSourceTopologyReady: ready,
    longBranchLowPointBindingReady: ready,
    longBranchGradeMagnitudeReady: ready,
    longBranchGradeDirectionReady: ready,
    longBranchRelativeGradeProfilesReady: ready,
    exactPipeCenterlineZReady: false,
    wholeFp20GradeDirectionReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}
