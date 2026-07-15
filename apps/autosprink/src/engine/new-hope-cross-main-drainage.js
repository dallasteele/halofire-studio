/**
 * Source-bound drainage orientation for the complete New Hope FP2.0 cross-main tree.
 * Inputs combine the sealed approved plan, governed roles, canonical topology,
 * operational low points, approved hydraulic calculation elevations, and the
 * independently verified mirrored side-branch high junctions. The result orients
 * all cross-main edges into low-point-01, low-point-04, or the dry-valve/base-of-
 * riser return path. It emits minimum grade falls only; upper absolute Z, exact
 * pipe-centerline elevations, fittings, and field drain routes remain unresolved.
 */

const EXPECTED_PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5';
const EXPECTED_CALC_SHA = 'D70FA475A0DD32B22B134D2D6161435D9E769D659B320C6F25A3D908AE70D719';
const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut';
const EXPECTED_SEGMENTS = ['pipe-002', 'pipe-003', 'pipe-004', 'pipe-005', 'pipe-006', 'pipe-030', 'pipe-031', 'pipe-058', 'pipe-059', 'pipe-060', 'pipe-061', 'pipe-062', 'pipe-063', 'pipe-064', 'pipe-067'];
const EXPECTED_TERMINALS = ['canonical-node-002', 'canonical-node-009', 'canonical-node-054', 'canonical-node-056'];
const EXPECTED_JUNCTIONS = ['canonical-node-007', 'canonical-node-125'];
const EXPECTED_HIGH_POINTS = Object.freeze({ lower: 'canonical-node-138', upper: 'canonical-node-131', cmk: 'canonical-node-009' });
const EXPECTED_PATHS = Object.freeze([
  { id: 'lower-high-to-low-point-01', highNodeId: 'canonical-node-138', sinkNodeId: 'canonical-node-054', sinkId: 'low-point-01', expectedEdgeCount: 4 },
  { id: 'lower-high-to-riser-return', highNodeId: 'canonical-node-138', sinkNodeId: 'canonical-node-002', sinkId: 'riser-return', expectedEdgeCount: 16 },
  { id: 'upper-high-to-low-point-04', highNodeId: 'canonical-node-131', sinkNodeId: 'canonical-node-056', sinkId: 'low-point-04', expectedEdgeCount: 4 },
  { id: 'upper-high-to-riser-return', highNodeId: 'canonical-node-131', sinkNodeId: 'canonical-node-002', sinkId: 'riser-return', expectedEdgeCount: 10 },
  { id: 'cmk-high-to-riser-return', highNodeId: 'canonical-node-009', sinkNodeId: 'canonical-node-002', sinkId: 'riser-return', expectedEdgeCount: 7 },
]);

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });
const round = (value, digits = 6) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
const sorted = (values) => [...values].sort();

function sourceNodeToCanonical(canonicalTopology, sourceNodeId) {
  return canonicalTopology?.nodes?.find((node) => node.memberNodeIds?.includes(sourceNodeId))?.id || null;
}

function buildRoleGraph(canonicalTopology, governedSkeleton, role) {
  const roleBySegmentId = new Map((governedSkeleton?.primaryAssignments || []).map((entry) => [entry.sourceSegmentId, entry.systemRole]));
  const edges = (canonicalTopology?.edges || []).filter((edge) => roleBySegmentId.get(edge.sourceSegmentId) === role);
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

function uniquePath(adjacency, fromNodeId, toNodeId) {
  const previous = new Map([[fromNodeId, null]]);
  const queue = [fromNodeId];
  while (queue.length) {
    const nodeId = queue.shift();
    if (nodeId === toNodeId) break;
    for (const next of adjacency.get(nodeId) || []) {
      if (previous.has(next.nodeId)) continue;
      previous.set(next.nodeId, { nodeId, edge: next.edge });
      queue.push(next.nodeId);
    }
  }
  if (!previous.has(toNodeId)) return { nodeIds: [], edges: [] };
  const nodeIds = [toNodeId];
  const edges = [];
  let current = toNodeId;
  while (current !== fromNodeId) {
    const prior = previous.get(current);
    edges.push(prior.edge);
    current = prior.nodeId;
    nodeIds.push(current);
  }
  return { nodeIds: nodeIds.reverse(), edges: edges.reverse() };
}

function calculationElevations(hydraulicRoutes) {
  const elevationByCanonicalNodeId = new Map();
  for (const route of hydraulicRoutes || []) {
    const canonicalByCalculation = new Map((route?.planNodeBindings || []).map((entry) => [entry.calculationNodeId, entry.canonicalNodeId]));
    for (const leg of route?.pipeTableLegs || []) {
      for (const [calculationNodeId, elevationFt] of [[leg.node1, leg.elevation1Ft], [leg.node2, leg.elevation2Ft]]) {
        const canonicalNodeId = canonicalByCalculation.get(calculationNodeId);
        if (!canonicalNodeId || !Number.isFinite(elevationFt)) continue;
        if (!elevationByCanonicalNodeId.has(canonicalNodeId)) elevationByCanonicalNodeId.set(canonicalNodeId, new Set());
        elevationByCanonicalNodeId.get(canonicalNodeId).add(elevationFt);
      }
    }
  }
  return new Map([...elevationByCanonicalNodeId].map(([nodeId, elevations]) => [nodeId, [...elevations].sort((a, b) => a - b)]));
}

function hasDryValveBaseOfRiserLeg(hydraulicRoutes) {
  return (hydraulicRoutes || []).some((route) => {
    const canonicalByCalculation = new Map((route?.planNodeBindings || []).map((entry) => [entry.calculationNodeId, entry.canonicalNodeId]));
    return (route?.pipeTableLegs || []).some((leg) => canonicalByCalculation.get(leg.node1) === 'canonical-node-002'
      && leg.elevation1Ft === 11.5
      && leg.elevation2Ft === 5.458333
      && leg.notes?.includes('DPV')
      && leg.notes?.includes('BOR'));
  });
}

export function evaluateNewHopeCrossMainDrainage({
  pipeVectors,
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
  hydraulicRoutes,
  sideBranchDrainage,
}) {
  const issues = [];
  if (pipeVectors?.projectId !== EXPECTED_PROJECT_ID
    || canonicalTopology?.projectId !== EXPECTED_PROJECT_ID
    || governedSkeleton?.projectId !== EXPECTED_PROJECT_ID
    || operationalAnnotations?.projectId !== EXPECTED_PROJECT_ID
    || (hydraulicRoutes || []).some((route) => route?.projectId !== EXPECTED_PROJECT_ID)) {
    issues.push(issue('NH_CROSS_MAIN_PROJECT_IDENTITY_INVALID', 'All cross-main drainage inputs must identify the New Hope project.'));
  }
  if (pipeVectors?.source?.sha256 !== EXPECTED_PLAN_SHA || pipeVectors?.source?.sheet !== 'FP2.0' || pipeVectors?.source?.physicalPage !== 5) {
    issues.push(issue('NH_CROSS_MAIN_PLAN_SOURCE_INVALID', 'Cross-main drainage must remain bound to the exact approved FP2.0 source page.'));
  }
  if ((hydraulicRoutes || []).length !== 3 || (hydraulicRoutes || []).some((route) => route?.sourceBindings?.approvedPlan?.sha256 !== EXPECTED_PLAN_SHA || route?.sourceBindings?.hydraulicCalculation?.sha256 !== EXPECTED_CALC_SHA)) {
    issues.push(issue('NH_CROSS_MAIN_CALCULATION_SOURCE_INVALID', 'Cross-main elevation anchors require all three sealed approved FP2.0 calculation bindings.'));
  }
  if (!governedSkeleton?.primaryPipeRoleAssignmentReady) {
    issues.push(issue('NH_CROSS_MAIN_ROLE_ASSIGNMENT_NOT_READY', 'Source segments must pass governed cross-main role assignment before drainage orientation.'));
  }
  if (!governedSkeleton?.fabricationLineRoleBindingReady || !governedSkeleton?.separatedCrossingEvidenceReady) {
    issues.push(issue('NH_CROSS_MAIN_FABRICATION_LINE_BINDING_INVALID', 'CMK and the BL48/CMI separated crossing require exact field-set and fabrication-listing evidence before cross-main topology is accepted.'));
  }
  const crossMainGrade = operationalAnnotations?.gradeRequirements?.find((entry) => entry.id === 'grade-cross-mains');
  if (crossMainGrade?.pipeRole !== 'cross-main' || crossMainGrade?.riseInPer10Ft !== 0.25) {
    issues.push(issue('NH_CROSS_MAIN_GRADE_MAGNITUDE_INVALID', 'The approved cross-main grade must remain one-quarter inch every ten feet.'));
  }

  const nodeById = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, node]));
  const crossMainGraph = buildRoleGraph(canonicalTopology, governedSkeleton, 'cross-main');
  const component = collectComponent(crossMainGraph.adjacency, 'canonical-node-002');
  const sourceSegmentIds = sorted(new Set(component.edges.map((edge) => edge.sourceSegmentId)));
  const terminalNodeIds = sorted(component.nodeIds.filter((nodeId) => (crossMainGraph.adjacency.get(nodeId) || []).length === 1));
  const junctionNodeIds = sorted(component.nodeIds.filter((nodeId) => (crossMainGraph.adjacency.get(nodeId) || []).length === 3));
  const cycleRank = component.edges.length - component.nodeIds.length + 1;
  if (component.nodeIds.length === 0
    || component.nodeIds.length !== 35
    || component.edges.length !== 34
    || cycleRank !== 0
    || JSON.stringify(sourceSegmentIds) !== JSON.stringify(sorted(EXPECTED_SEGMENTS))
    || JSON.stringify(terminalNodeIds) !== JSON.stringify(sorted(EXPECTED_TERMINALS))
    || JSON.stringify(junctionNodeIds) !== JSON.stringify(sorted(EXPECTED_JUNCTIONS))) {
    issues.push(issue('NH_CROSS_MAIN_COMPONENT_TOPOLOGY_INVALID', 'The cross main must remain the exact 35-node, 34-edge acyclic source tree with CMK, two three-way junctions, and four source terminals.'));
  }

  const lowPointById = new Map((operationalAnnotations?.lowPointAnchors || []).map((entry) => [entry.id, entry]));
  for (const [lowPointId, expectedNodeId] of [['low-point-01', 'canonical-node-054'], ['low-point-04', 'canonical-node-056']]) {
    const lowPoint = lowPointById.get(lowPointId);
    const boundNodes = new Set((lowPoint?.boundPrimaryNodeIds || []).map((sourceNodeId) => sourceNodeToCanonical(canonicalTopology, sourceNodeId)).filter(Boolean));
    if (lowPoint?.rawText !== 'LOW POINT TIE IN DRAIN' || !boundNodes.has(expectedNodeId)) {
      issues.push(issue('NH_CROSS_MAIN_LOW_POINT_BINDING_INVALID', `${lowPointId} no longer binds its exact cross-main terminal.`, lowPointId));
    }
  }

  const supplyAnchor = operationalAnnotations?.supplyAnchor;
  const supplyAnchorNodeId = sourceNodeToCanonical(canonicalTopology, supplyAnchor?.boundPrimaryNodeId);
  const sourceFeedGraph = buildRoleGraph(canonicalTopology, governedSkeleton, 'source-feed');
  const supplyToCrossMain = sourceFeedGraph.edges.find((edge) => [edge.fromNodeId, edge.toNodeId].includes(supplyAnchorNodeId) && [edge.fromNodeId, edge.toNodeId].includes('canonical-node-002'));
  if (supplyAnchor?.rawText !== 'SUPPLY FROM RISER ROOM' || supplyAnchorNodeId !== 'canonical-node-001' || !supplyToCrossMain) {
    issues.push(issue('NH_CROSS_MAIN_RISER_SOURCE_BINDING_INVALID', 'The cross-main source terminal must remain connected to the exact SUPPLY FROM RISER ROOM anchor through the governed source feed.'));
  }

  const sideSystems = new Map((sideBranchDrainage?.branchSystems || []).map((entry) => [entry.id, entry]));
  if (!sideBranchDrainage?.sideBranchLineGradeDirectionReady
    || sideSystems.get('lower-side-branch-system')?.trunkTerminalNodeId !== EXPECTED_HIGH_POINTS.lower
    || sideSystems.get('upper-side-branch-system')?.trunkTerminalNodeId !== EXPECTED_HIGH_POINTS.upper) {
    issues.push(issue('NH_CROSS_MAIN_HIGH_JUNCTION_BINDING_INVALID', 'The lower and upper cross-main high junctions must remain the independently verified side-branch trunk terminals.'));
  }

  const elevationByNodeId = calculationElevations(hydraulicRoutes);
  const exactElevationRequirements = new Map([
    ['canonical-node-002', [11.5]],
    ['canonical-node-054', [18.375]],
    ['canonical-node-138', [20.5]],
    ['canonical-node-142', [20.5, 21.5]],
  ]);
  for (const [nodeId, expectedElevations] of exactElevationRequirements) {
    if (JSON.stringify(elevationByNodeId.get(nodeId)) !== JSON.stringify(expectedElevations)) {
      issues.push(issue('NH_CROSS_MAIN_CALCULATION_ELEVATION_INVALID', `${nodeId} no longer has its exact approved calculation elevation anchor.`, nodeId));
    }
  }
  if (!hasDryValveBaseOfRiserLeg(hydraulicRoutes)) {
    issues.push(issue('NH_CROSS_MAIN_RISER_RETURN_INVALID', 'The 11.5-foot riser node must retain its approved descending DPV/BOR calculation leg.'));
  }

  const directedByEdgeId = new Map();
  const pathProfiles = [];
  for (const expectedPath of EXPECTED_PATHS) {
    const path = uniquePath(crossMainGraph.adjacency, expectedPath.highNodeId, expectedPath.sinkNodeId);
    if (path.edges.length !== expectedPath.expectedEdgeCount) {
      issues.push(issue('NH_CROSS_MAIN_PATH_TOPOLOGY_INVALID', `${expectedPath.id} no longer matches its exact source-tree path.`, expectedPath.id));
    }
    path.edges.forEach((edge, index) => {
      const highNodeId = path.nodeIds[index];
      const lowNodeId = path.nodeIds[index + 1];
      const existing = directedByEdgeId.get(edge.id);
      if (existing && (existing.highNodeId !== highNodeId || existing.lowNodeId !== lowNodeId)) {
        issues.push(issue('NH_CROSS_MAIN_DIRECTION_CONFLICT', 'Two source-bound drainage paths assign conflicting directions to one cross-main edge.', edge.id));
        return;
      }
      directedByEdgeId.set(edge.id, {
        edgeId: edge.id,
        sourceSegmentId: edge.sourceSegmentId,
        highNodeId,
        lowNodeId,
        highPdfPt: nodeById.get(highNodeId)?.pdfPt,
        lowPdfPt: nodeById.get(lowNodeId)?.pdfPt,
        planLengthFt: edge.planLengthFt,
        minimumRequiredDropIn: round(edge.planLengthFt * crossMainGrade?.riseInPer10Ft / 10),
        drainageOutletId: expectedPath.sinkId,
      });
    });
    const planRunLengthFt = path.edges.reduce((sum, edge) => sum + edge.planLengthFt, 0);
    pathProfiles.push({
      id: expectedPath.id,
      highNodeId: expectedPath.highNodeId,
      sinkNodeId: expectedPath.sinkNodeId,
      sinkId: expectedPath.sinkId,
      planRunLengthFt: round(planRunLengthFt),
      minimumRequiredDropIn: round(planRunLengthFt * crossMainGrade?.riseInPer10Ft / 10),
      highCalculationElevationFt: elevationByNodeId.get(expectedPath.highNodeId)?.[0] ?? null,
      sinkCalculationElevationFt: elevationByNodeId.get(expectedPath.sinkNodeId)?.[0] ?? null,
      absoluteEndpointElevationsReady: elevationByNodeId.has(expectedPath.highNodeId) && elevationByNodeId.has(expectedPath.sinkNodeId),
    });
  }
  if (directedByEdgeId.size !== 34 || component.edges.some((edge) => !directedByEdgeId.has(edge.id))) {
    issues.push(issue('NH_CROSS_MAIN_EDGE_COVERAGE_INCOMPLETE', 'Every cross-main edge must have one non-conflicting source-bound drainage direction.'));
  }

  const ready = issues.length === 0;
  return {
    artifactType: 'halofire.new-hope-cross-main-drainage-result.v1',
    projectId: pipeVectors?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    sourceSegmentIds,
    terminalNodeIds,
    junctionNodeId: 'canonical-node-125',
    junctionNodeIds,
    highPointNodeIds: [EXPECTED_HIGH_POINTS.lower, EXPECTED_HIGH_POINTS.upper, EXPECTED_HIGH_POINTS.cmk],
    directedEdges: [...directedByEdgeId.values()],
    pathProfiles,
    calculationElevationAnchors: [...exactElevationRequirements].map(([nodeId]) => ({ nodeId, elevationsFt: elevationByNodeId.get(nodeId) || [] })),
    metrics: {
      canonicalNodeCount: component.nodeIds.length,
      canonicalEdgeCount: component.edges.length,
      directedEdgeCount: directedByEdgeId.size,
      sourceSegmentCount: sourceSegmentIds.length,
      terminalCount: terminalNodeIds.length,
      highPointCount: 3,
      drainageOutletCount: 3,
      pathProfileCount: pathProfiles.length,
      calculationElevationAnchorCount: [...exactElevationRequirements].filter(([nodeId]) => elevationByNodeId.has(nodeId)).length,
    },
    crossMainSourceTopologyReady: ready,
    crossMainHighPointBindingReady: ready,
    crossMainLowPointBindingReady: ready,
    crossMainRiserReturnReady: ready,
    crossMainGradeMagnitudeReady: ready,
    crossMainGradeDirectionReady: ready,
    crossMainRelativeGradeProfilesReady: ready,
    cmkLineBindingReady: ready,
    cmkHighPointBindingReady: ready,
    cmkHighPointAbsoluteZReady: false,
    upperHighPointAbsoluteZReady: false,
    exactPipeCenterlineZReady: false,
    centralLoopDirectionReady: false,
    wholeFp20GradeDirectionReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}
