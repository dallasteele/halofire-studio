/**
 * Generated relative drainage schedule for New Hope attic lines BL48 and BL49.
 * The field set and AutoSPRINK fabrication listing correct CMK.01-.03 to a
 * cross main, prove CMK.03's two branch outlets at canonical-node-010, and
 * prove BL48.02 crosses CMI without a fitting or outlet. BL49 is a real loop:
 * the generated design selects its far fabricated merge as the relative high
 * junction and grades both arms back to the sole CMK feed. Absolute Z and the
 * four attached arm-overs are delegated to the downstream threaded evidence
 * gate. Absolute pipe-centerline Z remains intentionally unresolved.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut';
const EXPECTED_PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5';
const EXPECTED_FIELD_SET_SHA = '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5';
const EXPECTED_LISTING_SHA = '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734';
const EXPECTED_FAB_SHA = 'A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9';
const EXPECTED_SEGMENTS = ['pipe-007', 'pipe-010', 'pipe-011', 'pipe-012', 'pipe-013', 'pipe-014', 'pipe-015', 'pipe-018', 'pipe-019', 'pipe-026', 'pipe-027'];
const EXPECTED_TERMINALS = ['canonical-node-029', 'canonical-node-032', 'canonical-node-047'];
const EXPECTED_LOOP_NODES = ['canonical-node-011', 'canonical-node-019', 'canonical-node-020', 'canonical-node-030', 'canonical-node-031', 'canonical-node-044', 'canonical-node-045', 'canonical-node-046'];
const EXPECTED_LOOP_EDGES = ['source-edge-015', 'source-edge-016', 'source-edge-025', 'source-edge-026', 'source-edge-040', 'source-edge-041', 'source-edge-042', 'source-edge-043'];
const EXPECTED_ARM_OVERS = ['source-edge-021', 'source-edge-022', 'source-edge-030', 'source-edge-031'];
const PATHS = Object.freeze([
  { id: 'bl49-high-via-lower-arm-to-feed', nodeIds: ['canonical-node-029', 'canonical-node-028', 'canonical-node-030', 'canonical-node-046', 'canonical-node-045', 'canonical-node-044', 'canonical-node-019', 'canonical-node-011', 'canonical-node-010'], edgeIds: ['source-edge-023', 'source-edge-024', 'source-edge-043', 'source-edge-042', 'source-edge-041', 'source-edge-040', 'source-edge-015', 'source-edge-009'], lineName: 'BL49' },
  { id: 'bl49-high-via-upper-arm-to-feed', nodeIds: ['canonical-node-029', 'canonical-node-028', 'canonical-node-030', 'canonical-node-031', 'canonical-node-020', 'canonical-node-011', 'canonical-node-010'], edgeIds: ['source-edge-023', 'source-edge-024', 'source-edge-025', 'source-edge-026', 'source-edge-016', 'source-edge-009'], lineName: 'BL49' },
  { id: 'bl48-south-terminal-to-feed', nodeIds: ['canonical-node-032', 'canonical-node-026', 'canonical-node-033', 'canonical-node-024', 'canonical-node-021', 'canonical-node-022', 'canonical-node-018', 'canonical-node-010'], edgeIds: ['source-edge-027', 'source-edge-028', 'source-edge-029', 'source-edge-020', 'source-edge-017', 'source-edge-018', 'source-edge-014'], lineName: 'BL48' },
  { id: 'bl48-west-terminal-to-feed', nodeIds: ['canonical-node-047', 'canonical-node-048', 'canonical-node-049', 'canonical-node-050', 'canonical-node-023', 'canonical-node-021', 'canonical-node-022', 'canonical-node-018', 'canonical-node-010'], edgeIds: ['source-edge-044', 'source-edge-045', 'source-edge-046', 'source-edge-047', 'source-edge-019', 'source-edge-017', 'source-edge-018', 'source-edge-014'], lineName: 'BL48' },
]);

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });
const sorted = (values) => [...values].sort();
const round = (value, digits = 6) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);

function buildRoleGraph(canonicalTopology, governedSkeleton, role) {
  const roleBySegmentId = new Map((governedSkeleton?.primaryAssignments || []).map((entry) => [entry.sourceSegmentId, entry.systemRole]));
  const edges = (canonicalTopology?.edges || []).filter((edge) => roleBySegmentId.get(edge.sourceSegmentId) === role);
  const adjacency = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, []]));
  for (const edge of edges) {
    adjacency.get(edge.fromNodeId)?.push({ edge, nodeId: edge.toNodeId });
    adjacency.get(edge.toNodeId)?.push({ edge, nodeId: edge.fromNodeId });
  }
  return { adjacency, edges };
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

function cycleCore(component) {
  const adjacency = new Map(component.nodeIds.map((nodeId) => [nodeId, []]));
  for (const edge of component.edges) {
    adjacency.get(edge.fromNodeId).push({ nodeId: edge.toNodeId, edge });
    adjacency.get(edge.toNodeId).push({ nodeId: edge.fromNodeId, edge });
  }
  const degree = new Map([...adjacency].map(([nodeId, entries]) => [nodeId, entries.length]));
  const queue = [...degree].filter(([, value]) => value === 1).map(([nodeId]) => nodeId);
  while (queue.length) {
    const nodeId = queue.shift();
    if (degree.get(nodeId) !== 1) continue;
    degree.set(nodeId, 0);
    for (const next of adjacency.get(nodeId)) {
      if (degree.get(next.nodeId) > 0) {
        degree.set(next.nodeId, degree.get(next.nodeId) - 1);
        if (degree.get(next.nodeId) === 1) queue.push(next.nodeId);
      }
    }
  }
  const nodeIds = [...degree].filter(([, value]) => value > 0).map(([nodeId]) => nodeId);
  const nodeSet = new Set(nodeIds);
  const edgeIds = component.edges.filter((edge) => nodeSet.has(edge.fromNodeId) && nodeSet.has(edge.toNodeId)).map((edge) => edge.id);
  return { nodeIds: sorted(nodeIds), edgeIds: sorted(edgeIds) };
}

export function evaluateNewHopeCentralBranchDrainage({ pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations }) {
  const issues = [];
  const lineEvidence = operationalAnnotations?.fabricationLineEvidence;
  if (pipeVectors?.projectId !== EXPECTED_PROJECT_ID || canonicalTopology?.projectId !== EXPECTED_PROJECT_ID || governedSkeleton?.projectId !== EXPECTED_PROJECT_ID || operationalAnnotations?.projectId !== EXPECTED_PROJECT_ID) {
    issues.push(issue('NH_CENTRAL_BRANCH_PROJECT_IDENTITY_INVALID', 'All central-branch inputs must identify the New Hope project.'));
  }
  if (pipeVectors?.source?.sha256 !== EXPECTED_PLAN_SHA || pipeVectors?.source?.sheet !== 'FP2.0' || pipeVectors?.source?.physicalPage !== 5) {
    issues.push(issue('NH_CENTRAL_BRANCH_PLAN_SOURCE_INVALID', 'Central-branch drainage must remain bound to the exact approved FP2.0 source page.'));
  }
  if (lineEvidence?.fieldSet?.sha256 !== EXPECTED_FIELD_SET_SHA
    || lineEvidence?.fabricationListing?.sha256 !== EXPECTED_LISTING_SHA
    || lineEvidence?.fabricationArchive?.sha256 !== EXPECTED_FAB_SHA
    || !governedSkeleton?.fabricationLineRoleBindingReady
    || !governedSkeleton?.separatedCrossingEvidenceReady) {
    issues.push(issue('NH_CENTRAL_BRANCH_FABRICATION_SOURCE_INVALID', 'BL48/BL49 and CMK topology require the exact field set, listing PDF, FAB archive, and governed line bindings.'));
  }
  const branchGrade = operationalAnnotations?.gradeRequirements?.find((entry) => entry.id === 'grade-branch-lines');
  if (branchGrade?.pipeRole !== 'branch-line' || branchGrade?.riseInPer10Ft !== 0.5) {
    issues.push(issue('NH_CENTRAL_BRANCH_GRADE_MAGNITUDE_INVALID', 'The approved branch-line grade must remain one-half inch every ten feet.'));
  }

  const cmk = lineEvidence?.primaryLineBindings?.find((entry) => entry.lineName === 'CMK');
  const bl48 = lineEvidence?.centralBranchLines?.find((entry) => entry.lineName === 'BL48');
  const bl49 = lineEvidence?.centralBranchLines?.find((entry) => entry.lineName === 'BL49');
  const crossing = lineEvidence?.separatedCrossings?.find((entry) => entry.canonicalNodeId === 'canonical-node-022');
  if (cmk?.branchOutletCanonicalNodeId !== 'canonical-node-010'
    || cmk?.systemConnectionCanonicalNodeId !== 'canonical-node-007'
    || bl48?.feedCanonicalNodeId !== 'canonical-node-010'
    || bl49?.feedCanonicalNodeId !== 'canonical-node-010'
    || bl49?.lowJunctionCanonicalNodeId !== 'canonical-node-011'
    || bl49?.selectedHighJunctionCanonicalNodeId !== 'canonical-node-030') {
    issues.push(issue('NH_CENTRAL_BRANCH_FEED_HIGH_BINDING_INVALID', 'CMK.03 must feed BL48/BL49 at canonical-node-010 and BL49 must retain its selected far high junction at canonical-node-030.'));
  }
  if (crossing?.branchPieceId !== 'BL48.02' || crossing?.branchPieceOutletCount !== 0 || crossing?.crossMainSourceSegmentId !== 'pipe-062' || crossing?.branchLineSourceSegmentId !== 'pipe-013') {
    issues.push(issue('NH_CENTRAL_BRANCH_FALSE_CROSSING_INVALID', 'The BL48.02/CMI crossing at canonical-node-022 must remain explicitly non-connecting.'));
  }

  const branchGraph = buildRoleGraph(canonicalTopology, governedSkeleton, 'branch-line');
  const component = collectComponent(branchGraph.adjacency, 'canonical-node-010');
  const sourceSegmentIds = sorted(new Set(component.edges.map((edge) => edge.sourceSegmentId)));
  const terminalNodeIds = sorted(component.nodeIds.filter((nodeId) => (branchGraph.adjacency.get(nodeId) || []).length === 1));
  const cycleRank = component.edges.length - component.nodeIds.length + 1;
  const core = cycleCore(component);
  if (component.nodeIds.length !== 23
    || component.edges.length !== 23
    || cycleRank !== 1
    || JSON.stringify(sourceSegmentIds) !== JSON.stringify(EXPECTED_SEGMENTS)
    || JSON.stringify(terminalNodeIds) !== JSON.stringify(EXPECTED_TERMINALS)
    || JSON.stringify(core.nodeIds) !== JSON.stringify(EXPECTED_LOOP_NODES)
    || JSON.stringify(core.edgeIds) !== JSON.stringify(EXPECTED_LOOP_EDGES)) {
    issues.push(issue('NH_CENTRAL_BRANCH_COMPONENT_TOPOLOGY_INVALID', 'BL48/BL49 must remain the exact 23-node, 23-edge component with one eight-edge fabricated loop and three source terminals.'));
  }

  const componentNodeSet = new Set(component.nodeIds);
  const armOverEdges = (canonicalTopology?.edges || []).filter((edge) => {
    const assignment = governedSkeleton?.primaryAssignments?.find((entry) => entry.sourceSegmentId === edge.sourceSegmentId);
    return assignment?.systemRole === 'arm-over' && (componentNodeSet.has(edge.fromNodeId) || componentNodeSet.has(edge.toNodeId));
  });
  if (JSON.stringify(sorted(armOverEdges.map((edge) => edge.id))) !== JSON.stringify(EXPECTED_ARM_OVERS)) {
    issues.push(issue('NH_CENTRAL_BRANCH_ARM_OVER_SET_INVALID', 'The central BL48/BL49 component must retain its exact four attached arm-over edges.'));
  }

  const nodeById = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, node]));
  const edgeById = new Map(component.edges.map((edge) => [edge.id, edge]));
  const directedByEdgeId = new Map();
  const pathProfiles = [];
  for (const path of PATHS) {
    let planRunLengthFt = 0;
    path.edgeIds.forEach((edgeId, index) => {
      const edge = edgeById.get(edgeId);
      const highNodeId = path.nodeIds[index];
      const lowNodeId = path.nodeIds[index + 1];
      if (!edge || ![edge.fromNodeId, edge.toNodeId].includes(highNodeId) || ![edge.fromNodeId, edge.toNodeId].includes(lowNodeId)) {
        issues.push(issue('NH_CENTRAL_BRANCH_PATH_TOPOLOGY_INVALID', `${path.id} no longer matches its exact fabricated source path.`, edgeId));
        return;
      }
      planRunLengthFt += edge.planLengthFt;
      const existing = directedByEdgeId.get(edgeId);
      if (existing && (existing.highNodeId !== highNodeId || existing.lowNodeId !== lowNodeId)) {
        issues.push(issue('NH_CENTRAL_BRANCH_DIRECTION_CONFLICT', 'Two generated drainage paths assign conflicting directions to one central branch edge.', edgeId));
        return;
      }
      directedByEdgeId.set(edgeId, {
        edgeId,
        sourceSegmentId: edge.sourceSegmentId,
        lineName: path.lineName,
        highNodeId,
        lowNodeId,
        highPdfPt: nodeById.get(highNodeId)?.pdfPt,
        lowPdfPt: nodeById.get(lowNodeId)?.pdfPt,
        planLengthFt: edge.planLengthFt,
        minimumRequiredDropIn: round(edge.planLengthFt * branchGrade?.riseInPer10Ft / 10),
        drainageOutletId: 'cmk-riser-return',
      });
    });
    pathProfiles.push({
      id: path.id,
      lineName: path.lineName,
      highNodeId: path.nodeIds[0],
      sinkNodeId: 'canonical-node-010',
      sinkId: 'cmk-riser-return',
      planRunLengthFt: round(planRunLengthFt),
      minimumRequiredDropIn: round(planRunLengthFt * branchGrade?.riseInPer10Ft / 10),
      absoluteEndpointElevationsReady: false,
    });
  }
  if (directedByEdgeId.size !== 23 || component.edges.some((edge) => !directedByEdgeId.has(edge.id))) {
    issues.push(issue('NH_CENTRAL_BRANCH_EDGE_COVERAGE_INCOMPLETE', 'Every BL48/BL49 branch-line edge must have one non-conflicting generated drainage direction.'));
  }

  const ready = issues.length === 0;
  return {
    artifactType: 'halofire.new-hope-central-branch-drainage-result.v1',
    projectId: pipeVectors?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    sourceSegmentIds,
    terminalNodeIds,
    loopCore: core,
    feedNodeId: 'canonical-node-010',
    selectedLoopHighNodeId: 'canonical-node-030',
    separatedCrossingNodeId: 'canonical-node-022',
    directedEdges: [...directedByEdgeId.values()],
    pathProfiles,
    unresolvedArmOverEdges: armOverEdges.map((edge) => ({ edgeId: edge.id, sourceSegmentId: edge.sourceSegmentId, fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId })),
    metrics: {
      canonicalNodeCount: component.nodeIds.length,
      canonicalEdgeCount: component.edges.length,
      directedEdgeCount: directedByEdgeId.size,
      sourceSegmentCount: sourceSegmentIds.length,
      cycleRank,
      loopCoreEdgeCount: core.edgeIds.length,
      pathProfileCount: pathProfiles.length,
      unresolvedArmOverEdgeCount: armOverEdges.length,
    },
    centralBranchSourceTopologyReady: ready,
    centralBranchFabricationLineBindingReady: ready,
    centralBranchSeparatedCrossingReady: ready,
    centralBranchGeneratedGradeDirectionReady: ready,
    centralBranchRelativeGradeProfilesReady: ready,
    centralLoopDirectionReady: ready,
    selectedLoopHighPointAbsoluteZReady: false,
    centralBranchArmOverDrainageReady: false,
    exactPipeCenterlineZReady: false,
    wholeFp20GradeDirectionReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}
