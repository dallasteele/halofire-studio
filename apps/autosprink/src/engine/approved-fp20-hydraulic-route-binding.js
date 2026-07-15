const EXPECTED_PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5';
const EXPECTED_CALC_SHA = 'D70FA475A0DD32B22B134D2D6161435D9E769D659B320C6F25A3D908AE70D719';
const EXPECTED_ROUTE_21 = Object.freeze(['1052', '1051', '1050', '1049', '1048', '1047', '1046', '67', '118', '414', '560', '554', '25', '1']);
const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function shortestPath(edgeList, start, end) {
  const adjacency = new Map();
  for (const edge of edgeList) {
    if (!adjacency.has(edge.fromNodeId)) adjacency.set(edge.fromNodeId, []);
    if (!adjacency.has(edge.toNodeId)) adjacency.set(edge.toNodeId, []);
    adjacency.get(edge.fromNodeId).push({ nodeId: edge.toNodeId, edgeId: edge.id });
    adjacency.get(edge.toNodeId).push({ nodeId: edge.fromNodeId, edgeId: edge.id });
  }
  const queue = [start];
  const previous = new Map([[start, null]]);
  while (queue.length && !previous.has(end)) {
    const current = queue.shift();
    for (const next of adjacency.get(current) || []) {
      if (previous.has(next.nodeId)) continue;
      previous.set(next.nodeId, { nodeId: current, edgeId: next.edgeId });
      queue.push(next.nodeId);
    }
  }
  if (!previous.has(end)) return null;
  const nodeIds = [end];
  const edgeIds = [];
  let current = end;
  while (current !== start) {
    const prior = previous.get(current);
    edgeIds.unshift(prior.edgeId);
    nodeIds.unshift(prior.nodeId);
    current = prior.nodeId;
  }
  return { nodeIds, edgeIds };
}

export function bindApprovedFp20HydraulicRoute(canonicalTopology, evidence) {
  const issues = [];
  const nodes = Array.isArray(canonicalTopology?.nodes) ? canonicalTopology.nodes : [];
  const edges = Array.isArray(canonicalTopology?.edges) ? canonicalTopology.edges : [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const bindings = Array.isArray(evidence?.planNodeBindings) ? evidence.planNodeBindings : [];
  const bindingByCalcId = new Map();

  if (evidence?.artifactType !== 'halofire.approved-fp20-hydraulic-route-binding.v1' || evidence?.projectId !== canonicalTopology?.projectId || evidence?.remoteAreaId !== '2-1') {
    issues.push(issue('FP20_HYDRAULIC_ROUTE_IDENTITY_INVALID', 'Hydraulic route evidence must identify the same approved FP2.0 project and remote area 2-1.'));
  }
  if (evidence?.sourceBindings?.approvedPlan?.sha256 !== EXPECTED_PLAN_SHA || evidence?.sourceBindings?.approvedPlan?.physicalPage !== 5 || evidence?.sourceBindings?.hydraulicCalculation?.sha256 !== EXPECTED_CALC_SHA || JSON.stringify(evidence?.sourceBindings?.hydraulicCalculation?.physicalPages) !== '[15,16]') {
    issues.push(issue('FP20_HYDRAULIC_ROUTE_SOURCE_INVALID', 'Route 2-1 must stay bound to approved FP2.0 and calculation-table physical pages 15-16.'));
  }
  if (evidence?.calculationDirection !== 'remote-terminal-to-water-source' || evidence?.physicalFlowDirection !== 'water-source-to-remote-terminal' || evidence?.gradeDirectionRelationship !== 'independent-drainage-vector-not-derived-from-hydraulic-flow') {
    issues.push(issue('FP20_DIRECTION_SEMANTICS_INVALID', 'Calculation order, hydraulic flow, and drainage grade must remain three explicit and distinct direction semantics.'));
  }
  if (JSON.stringify(evidence?.calculationNodeIds) !== JSON.stringify(EXPECTED_ROUTE_21)) {
    issues.push(issue('FP20_HYDRAULIC_ROUTE_SEQUENCE_INVALID', 'Remote area 2-1 calculation nodes must preserve the exact table order from 1052 through source node 1.'));
  }

  for (const binding of bindings) {
    if (!binding?.calculationNodeId || bindingByCalcId.has(binding.calculationNodeId)) {
      issues.push(issue('FP20_HYDRAULIC_NODE_BINDING_ID_INVALID', 'Each plan calculation node needs one unique binding.', binding?.calculationNodeId));
      continue;
    }
    bindingByCalcId.set(binding.calculationNodeId, binding);
    const canonicalNode = nodeById.get(binding.canonicalNodeId);
    if (!canonicalNode || !binding.leaderTargetPdfPt || distance(canonicalNode.pdfPt, binding.leaderTargetPdfPt) > 5 || !Number.isInteger(binding.sourceTextRef?.blockIndex) || !Number.isInteger(binding.sourceLeaderDrawingIndex)) {
      issues.push(issue('FP20_HYDRAULIC_NODE_BINDING_INVALID', 'Calculation-node label, source leader, leader target, and canonical plan node must close within five PDF points.', binding.calculationNodeId));
    }
  }
  const expectedPlanIds = EXPECTED_ROUTE_21.slice(0, 9);
  if (bindings.length !== expectedPlanIds.length || expectedPlanIds.some((id) => !bindingByCalcId.has(id))) {
    issues.push(issue('FP20_HYDRAULIC_PLAN_NODE_SET_INCOMPLETE', 'Route 2-1 needs the nine source-proved calculation-node bindings visible on FP2.0.'));
  }
  if (JSON.stringify(evidence?.externalRiserNodeIds) !== JSON.stringify(EXPECTED_ROUTE_21.slice(9))) {
    issues.push(issue('FP20_EXTERNAL_RISER_NODE_SET_INVALID', 'Calculation nodes below the FP2.0 plan boundary must remain explicit external riser/source nodes.'));
  }

  const legs = Array.isArray(evidence?.pipeTableLegs) ? evidence.pipeTableLegs : [];
  const expectedLegs = EXPECTED_ROUTE_21.slice(0, -1).map((node1, index) => `${node1}>${EXPECTED_ROUTE_21[index + 1]}`);
  if (legs.length !== expectedLegs.length || legs.some((leg, index) => `${leg.node1}>${leg.node2}` !== expectedLegs[index])) {
    issues.push(issue('FP20_HYDRAULIC_PIPE_TABLE_LEGS_INVALID', 'Route 2-1 pipe-table legs must be complete and remain in source calculation order.'));
  }
  for (const leg of legs) {
    if (![leg.elevation1Ft, leg.elevation2Ft, leg.nominalDiameterIn, leg.actualDiameterIn, leg.totalFlowGpm, leg.lengthFt, leg.cFactor, leg.fittingEquivalentLengthFt].every(Number.isFinite) || !leg.notes) {
      issues.push(issue('FP20_HYDRAULIC_PIPE_TABLE_FIELD_MISSING', 'Every calculation leg needs endpoint elevations, sizes, flow, length, C factor, fitting length, and notes.', `${leg.node1}>${leg.node2}`));
    }
  }

  const planRouteLegs = [];
  for (let index = 0; index < expectedPlanIds.length - 1; index += 1) {
    const from = bindingByCalcId.get(expectedPlanIds[index]);
    const to = bindingByCalcId.get(expectedPlanIds[index + 1]);
    if (!from || !to) continue;
    const path = shortestPath(edges, from.canonicalNodeId, to.canonicalNodeId);
    if (!path) issues.push(issue('FP20_HYDRAULIC_PLAN_PATH_MISSING', 'Each adjacent calculation-node pair must map onto the canonical FP2.0 graph.', `${from.calculationNodeId}>${to.calculationNodeId}`));
    else planRouteLegs.push({ calculationFromNodeId: from.calculationNodeId, calculationToNodeId: to.calculationNodeId, ...path });
  }

  const calculationNodeIds = Array.isArray(evidence?.calculationNodeIds) ? evidence.calculationNodeIds : [];
  const physicalFlowNodeIds = [...calculationNodeIds].reverse();
  const physicalFlowLegs = [...legs].reverse().map((leg) => ({
    fromCalculationNodeId: leg.node2,
    toCalculationNodeId: leg.node1,
    totalFlowGpm: leg.totalFlowGpm,
    nominalDiameterIn: leg.nominalDiameterIn,
    fromElevationFt: leg.elevation2Ft,
    toElevationFt: leg.elevation1Ft,
    calculationTableOrderReversed: true,
  }));
  const ready = issues.length === 0 && planRouteLegs.length === 8 && physicalFlowLegs.length === 13;
  return {
    artifactType: 'halofire.approved-fp20-hydraulic-route-binding-result.v1',
    projectId: evidence?.projectId,
    remoteAreaId: evidence?.remoteAreaId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    planNodeBindings: bindings,
    planRouteLegs,
    physicalFlowNodeIds,
    physicalFlowLegs,
    metrics: {
      calculationNodeCount: calculationNodeIds.length,
      planBoundCalculationNodeCount: bindings.length,
      externalRiserNodeCount: evidence?.externalRiserNodeIds?.length || 0,
      pipeTableLegCount: legs.length,
      mappedCanonicalEdgeCount: new Set(planRouteLegs.flatMap((entry) => entry.edgeIds)).size,
    },
    route21HydraulicNodeBindingReady: ready,
    route21HydraulicFlowDirectionReady: ready,
    wholeFp20HydraulicNodeBindingReady: false,
    wholeFp20HydraulicFlowReady: false,
    gradeDirectionReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}
