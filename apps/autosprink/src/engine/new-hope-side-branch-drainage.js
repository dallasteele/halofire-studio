/**
 * Source-bound drainage for the mirrored seven-head FP2.0 side-branch systems.
 * Inputs are the sealed approved-plan vectors, canonical topology, governed pipe
 * roles, and source-preserved low-point/grade annotations. The result validates
 * both complete source components, directs only their branch-line edges toward
 * low-point-02/03, and emits relative trunk-grade profiles. Arm-over drainage
 * and every absolute pipe elevation remain blocked because plan XY does not
 * prove their vertical offsets.
 */

const EXPECTED_PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5';
const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut';
const EXPECTED_SYSTEMS = Object.freeze([
  {
    id: 'lower-side-branch-system',
    lowPointId: 'low-point-02',
    rootNodeId: 'canonical-node-014',
    trunkTerminalNodeId: 'canonical-node-138',
    componentTerminalNodeIds: ['canonical-node-014', 'canonical-node-094', 'canonical-node-122', 'canonical-node-138'],
    sourceSegmentIds: ['pipe-008', 'pipe-022', 'pipe-024', 'pipe-028', 'pipe-036', 'pipe-042', 'pipe-046', 'pipe-056', 'pipe-065'],
    componentEdgeCount: 16,
    componentNodeCount: 17,
    branchLineEdgeCount: 14,
    armOverEdgeCount: 2,
    sprinklerCount: 7,
  },
  {
    id: 'upper-side-branch-system',
    lowPointId: 'low-point-03',
    rootNodeId: 'canonical-node-017',
    trunkTerminalNodeId: 'canonical-node-131',
    componentTerminalNodeIds: ['canonical-node-017', 'canonical-node-096', 'canonical-node-124', 'canonical-node-131'],
    sourceSegmentIds: ['pipe-009', 'pipe-023', 'pipe-025', 'pipe-029', 'pipe-037', 'pipe-043', 'pipe-047', 'pipe-057', 'pipe-066'],
    componentEdgeCount: 16,
    componentNodeCount: 17,
    branchLineEdgeCount: 14,
    armOverEdgeCount: 2,
    sprinklerCount: 7,
  },
]);

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });
const round = (value, digits = 6) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
const sorted = (values) => [...values].sort();

function sourceNodeToCanonical(canonicalTopology, sourceNodeId) {
  return canonicalTopology?.nodes?.find((node) => node.memberNodeIds?.includes(sourceNodeId))?.id || null;
}

function buildRoleGraph(canonicalTopology, governedSkeleton, roles) {
  const roleBySegmentId = new Map((governedSkeleton?.primaryAssignments || []).map((entry) => [entry.sourceSegmentId, entry.systemRole]));
  const edges = (canonicalTopology?.edges || []).filter((edge) => roles.includes(roleBySegmentId.get(edge.sourceSegmentId)));
  const adjacency = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, []]));
  for (const edge of edges) {
    adjacency.get(edge.fromNodeId)?.push({ edge, nodeId: edge.toNodeId });
    adjacency.get(edge.toNodeId)?.push({ edge, nodeId: edge.fromNodeId });
  }
  return { adjacency, edges, roleBySegmentId };
}

function collectComponent(adjacency, rootNodeId) {
  const nodeIds = new Set(adjacency.has(rootNodeId) ? [rootNodeId] : []);
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

function distancesFromRoot(adjacency, rootNodeId) {
  const distances = new Map([[rootNodeId, 0]]);
  const queue = [rootNodeId];
  while (queue.length) {
    const nodeId = queue.shift();
    for (const next of adjacency.get(nodeId) || []) {
      if (distances.has(next.nodeId)) continue;
      distances.set(next.nodeId, distances.get(nodeId) + next.edge.planLengthFt);
      queue.push(next.nodeId);
    }
  }
  return distances;
}

export function evaluateNewHopeSideBranchDrainage({
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
    issues.push(issue('NH_SIDE_BRANCH_PROJECT_IDENTITY_INVALID', 'All side-branch drainage inputs must identify the New Hope project.'));
  }
  if (pipeVectors?.source?.sha256 !== EXPECTED_PLAN_SHA || pipeVectors?.source?.sheet !== 'FP2.0' || pipeVectors?.source?.physicalPage !== 5) {
    issues.push(issue('NH_SIDE_BRANCH_PLAN_SOURCE_INVALID', 'Side-branch drainage must remain bound to the exact approved FP2.0 source page.'));
  }
  if (!governedSkeleton?.primaryPipeRoleAssignmentReady) {
    issues.push(issue('NH_SIDE_BRANCH_ROLE_ASSIGNMENT_NOT_READY', 'Source segments must pass governed branch-line and arm-over role assignment before drainage orientation.'));
  }
  const branchGrade = operationalAnnotations?.gradeRequirements?.find((entry) => entry.id === 'grade-branch-lines');
  if (branchGrade?.pipeRole !== 'branch-line' || branchGrade?.riseInPer10Ft !== 0.5) {
    issues.push(issue('NH_SIDE_BRANCH_GRADE_MAGNITUDE_INVALID', 'The approved branch-line grade must remain one-half inch every ten feet.'));
  }

  const nodeById = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, node]));
  const componentGraph = buildRoleGraph(canonicalTopology, governedSkeleton, ['branch-line', 'arm-over']);
  const branchGraph = buildRoleGraph(canonicalTopology, governedSkeleton, ['branch-line']);
  const lowPointById = new Map((operationalAnnotations?.lowPointAnchors || []).map((entry) => [entry.id, entry]));
  const systemResults = [];

  for (const expected of EXPECTED_SYSTEMS) {
    const sourceLowPoint = lowPointById.get(expected.lowPointId);
    const boundRoots = sorted(new Set((sourceLowPoint?.boundPrimaryNodeIds || []).map((sourceNodeId) => sourceNodeToCanonical(canonicalTopology, sourceNodeId)).filter(Boolean)));
    if (sourceLowPoint?.rawText !== 'LOW POINT TIE IN DRAIN' || JSON.stringify(boundRoots) !== JSON.stringify([expected.rootNodeId])) {
      issues.push(issue('NH_SIDE_BRANCH_LOW_POINT_BINDING_INVALID', `${expected.lowPointId} no longer binds its exact canonical root.`, expected.id));
    }

    const component = collectComponent(componentGraph.adjacency, expected.rootNodeId);
    const componentSourceSegmentIds = sorted(new Set(component.edges.map((edge) => edge.sourceSegmentId)));
    const componentTerminalNodeIds = sorted(component.nodeIds.filter((nodeId) => (componentGraph.adjacency.get(nodeId) || []).length === 1));
    const sprinklerIds = sorted(component.nodeIds.flatMap((nodeId) => nodeById.get(nodeId)?.sprinklerIds || []));
    const componentCycleRank = component.edges.length - component.nodeIds.length + 1;
    const branchEdges = component.edges.filter((edge) => componentGraph.roleBySegmentId.get(edge.sourceSegmentId) === 'branch-line');
    const armOverEdges = component.edges.filter((edge) => componentGraph.roleBySegmentId.get(edge.sourceSegmentId) === 'arm-over');
    if (component.edges.length !== expected.componentEdgeCount
      || component.nodeIds.length !== expected.componentNodeCount
      || branchEdges.length !== expected.branchLineEdgeCount
      || armOverEdges.length !== expected.armOverEdgeCount
      || sprinklerIds.length !== expected.sprinklerCount
      || componentCycleRank !== 0
      || JSON.stringify(componentSourceSegmentIds) !== JSON.stringify(sorted(expected.sourceSegmentIds))
      || JSON.stringify(componentTerminalNodeIds) !== JSON.stringify(sorted(expected.componentTerminalNodeIds))) {
      issues.push(issue('NH_SIDE_BRANCH_COMPONENT_TOPOLOGY_INVALID', `${expected.id} must remain the exact source-drawn acyclic seven-head component.`, expected.id));
    }

    const branchComponent = collectComponent(branchGraph.adjacency, expected.rootNodeId);
    const branchCycleRank = branchComponent.edges.length - branchComponent.nodeIds.length + 1;
    const branchTerminalNodeIds = sorted(branchComponent.nodeIds.filter((nodeId) => (branchGraph.adjacency.get(nodeId) || []).length === 1));
    if (branchComponent.edges.length !== expected.branchLineEdgeCount
      || branchCycleRank !== 0
      || JSON.stringify(branchTerminalNodeIds) !== JSON.stringify(sorted([expected.rootNodeId, expected.trunkTerminalNodeId]))) {
      issues.push(issue('NH_SIDE_BRANCH_TRUNK_TOPOLOGY_INVALID', `${expected.id} branch-line trunk must remain one acyclic path from its low point to its source terminal.`, expected.id));
    }

    const distances = distancesFromRoot(branchGraph.adjacency, expected.rootNodeId);
    const directedBranchLineEdges = [];
    for (const edge of branchComponent.edges) {
      const fromDistanceFt = distances.get(edge.fromNodeId);
      const toDistanceFt = distances.get(edge.toNodeId);
      if (!Number.isFinite(fromDistanceFt) || !Number.isFinite(toDistanceFt) || Math.abs(fromDistanceFt - toDistanceFt) < 0.000001) {
        issues.push(issue('NH_SIDE_BRANCH_EDGE_DIRECTION_AMBIGUOUS', 'Every side-branch trunk edge must have one endpoint strictly closer to its source-proved low point.', edge.id));
        continue;
      }
      const highNodeId = fromDistanceFt > toDistanceFt ? edge.fromNodeId : edge.toNodeId;
      const lowNodeId = highNodeId === edge.fromNodeId ? edge.toNodeId : edge.fromNodeId;
      const highDistanceFt = Math.max(fromDistanceFt, toDistanceFt);
      const lowDistanceFt = Math.min(fromDistanceFt, toDistanceFt);
      if (Math.abs((highDistanceFt - lowDistanceFt) - edge.planLengthFt) > 0.00001) {
        issues.push(issue('NH_SIDE_BRANCH_EDGE_NOT_ON_ROOTED_TRUNK', 'A side-branch edge no longer advances monotonically toward its bound low point.', edge.id));
      }
      directedBranchLineEdges.push({
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
    const trunkRunLengthFt = distances.get(expected.trunkTerminalNodeId);
    systemResults.push({
      id: expected.id,
      lowPointId: expected.lowPointId,
      rootNodeId: expected.rootNodeId,
      trunkTerminalNodeId: expected.trunkTerminalNodeId,
      componentTerminalNodeIds,
      sourceSegmentIds: componentSourceSegmentIds,
      componentNodeCount: component.nodeIds.length,
      componentEdgeCount: component.edges.length,
      branchLineEdgeCount: branchEdges.length,
      armOverEdgeCount: armOverEdges.length,
      sprinklerCount: sprinklerIds.length,
      sprinklerIds,
      directedBranchLineEdges,
      unresolvedArmOverEdges: armOverEdges.map((edge) => ({
        edgeId: edge.id,
        sourceSegmentId: edge.sourceSegmentId,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        fromPdfPt: nodeById.get(edge.fromNodeId)?.pdfPt,
        toPdfPt: nodeById.get(edge.toNodeId)?.pdfPt,
        blockerCode: 'NH_SIDE_BRANCH_ARM_OVER_VERTICAL_OFFSET_UNRESOLVED',
      })),
      trunkProfile: {
        terminalNodeId: expected.trunkTerminalNodeId,
        lowPointId: expected.lowPointId,
        planRunLengthFt: round(trunkRunLengthFt),
        requiredRiseFromLowPointIn: round(trunkRunLengthFt * branchGrade?.riseInPer10Ft / 10),
      },
    });
  }

  const ready = issues.length === 0;
  return {
    artifactType: 'halofire.new-hope-side-branch-drainage-result.v1',
    projectId: pipeVectors?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    branchSystems: systemResults,
    metrics: {
      branchSystemCount: systemResults.length,
      componentEdgeCount: systemResults.reduce((sum, entry) => sum + entry.componentEdgeCount, 0),
      directedBranchLineEdgeCount: systemResults.reduce((sum, entry) => sum + entry.directedBranchLineEdges.length, 0),
      unresolvedArmOverEdgeCount: systemResults.reduce((sum, entry) => sum + entry.unresolvedArmOverEdges.length, 0),
      sprinklerCount: systemResults.reduce((sum, entry) => sum + entry.sprinklerCount, 0),
      trunkProfileCount: systemResults.length,
    },
    sideBranchSourceTopologyReady: ready,
    sideBranchLowPointBindingReady: ready,
    sideBranchGradeMagnitudeReady: ready,
    sideBranchLineGradeDirectionReady: ready,
    sideBranchRelativeGradeProfilesReady: ready,
    sideBranchArmOverDrainageReady: false,
    exactPipeCenterlineZReady: false,
    wholeFp20GradeDirectionReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}
