const EXPECTED_PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5';
const EXPECTED_CALC_SHA = 'D70FA475A0DD32B22B134D2D6161435D9E769D659B320C6F25A3D908AE70D719';
const EXPECTED_ROUTE_21 = Object.freeze(['1052', '1051', '1050', '1049', '1048', '1047', '1046', '67', '118', '414', '560', '554', '25', '1']);
const EXPECTED_PLAN_LEGS = Object.freeze(EXPECTED_ROUTE_21.slice(0, 8).map((node1, index) => `${node1}>${EXPECTED_ROUTE_21[index + 1]}`));
const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const round = (value, digits = 6) => Number(value.toFixed(digits));

function traceExplicitEdgePath(edgeById, startNodeId, edgeIds) {
  const nodeIds = [startNodeId];
  let currentNodeId = startNodeId;
  let visiblePlanLengthPdfPt = 0;
  for (const edgeId of edgeIds) {
    const edge = edgeById.get(edgeId);
    if (!edge) return { errorCode: 'FP20_HYDRAULIC_PLAN_EDGE_UNKNOWN', edgeId };
    const nextNodeId = edge.fromNodeId === currentNodeId
      ? edge.toNodeId
      : edge.toNodeId === currentNodeId ? edge.fromNodeId : null;
    if (!nextNodeId) return { errorCode: 'FP20_HYDRAULIC_PLAN_PATH_DISCONTINUOUS', edgeId };
    currentNodeId = nextNodeId;
    nodeIds.push(currentNodeId);
    visiblePlanLengthPdfPt += edge.lengthPdfPt;
  }
  return {
    nodeIds,
    edgeIds,
    endNodeId: currentNodeId,
    visiblePlanLengthFt: round(visiblePlanLengthPdfPt / 9),
  };
}

export function bindApprovedFp20HydraulicRoute(canonicalTopology, evidence) {
  const issues = [];
  const nodes = Array.isArray(canonicalTopology?.nodes) ? canonicalTopology.nodes : [];
  const edges = Array.isArray(canonicalTopology?.edges) ? canonicalTopology.edges : [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const bindings = Array.isArray(evidence?.planNodeBindings) ? evidence.planNodeBindings : [];
  const bindingByCalcId = new Map();

  if (evidence?.artifactType !== 'halofire.approved-fp20-hydraulic-route-binding.v2' || evidence?.projectId !== canonicalTopology?.projectId || evidence?.remoteAreaId !== '2-1') {
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
    if (!canonicalNode || !binding.leaderTargetPdfPt || distance(canonicalNode.pdfPt, binding.leaderTargetPdfPt) > 6 || !Number.isInteger(binding.sourceTextRef?.blockIndex) || !Number.isInteger(binding.sourceLeaderDrawingIndex)) {
      issues.push(issue('FP20_HYDRAULIC_NODE_BINDING_INVALID', 'Calculation-node label, source leader, leader target, and canonical plan node must close within six PDF points.', binding.calculationNodeId));
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

  const explicitPlanLegBindings = Array.isArray(evidence?.planLegBindings) ? evidence.planLegBindings : [];
  if (explicitPlanLegBindings.length !== EXPECTED_PLAN_LEGS.length || explicitPlanLegBindings.some((leg, index) => `${leg.calculationFromNodeId}>${leg.calculationToNodeId}` !== EXPECTED_PLAN_LEGS[index])) {
    issues.push(issue('FP20_HYDRAULIC_EXPLICIT_PLAN_LEGS_INVALID', 'Every FP2.0-visible calculation leg must provide an explicit source-reviewed canonical edge sequence in calculation-table order.'));
  }
  const planRouteLegs = [];
  const usedEdgeIds = new Set();
  for (const explicitLeg of explicitPlanLegBindings) {
    const legId = `${explicitLeg.calculationFromNodeId}>${explicitLeg.calculationToNodeId}`;
    const from = bindingByCalcId.get(explicitLeg.calculationFromNodeId);
    const to = bindingByCalcId.get(explicitLeg.calculationToNodeId);
    const edgeIds = Array.isArray(explicitLeg.canonicalEdgeIds) ? explicitLeg.canonicalEdgeIds : [];
    if (!from || !to || edgeIds.length === 0 || new Set(edgeIds).size !== edgeIds.length) {
      issues.push(issue('FP20_HYDRAULIC_EXPLICIT_PLAN_LEG_INVALID', 'An explicit plan leg needs bound endpoints and a non-empty, non-repeating canonical edge sequence.', legId));
      continue;
    }
    const traced = traceExplicitEdgePath(edgeById, from.canonicalNodeId, edgeIds);
    if (traced.errorCode) {
      issues.push(issue(traced.errorCode, 'The reviewed canonical edge sequence must exist and remain continuous from its bound calculation node.', `${legId}:${traced.edgeId}`));
      continue;
    }
    if (traced.endNodeId !== to.canonicalNodeId) {
      issues.push(issue('FP20_HYDRAULIC_PLAN_PATH_ENDPOINT_MISMATCH', 'The reviewed canonical edge sequence must terminate at the next calculation node.', legId));
      continue;
    }
    if (JSON.stringify(explicitLeg.canonicalNodeIds) !== JSON.stringify(traced.nodeIds)) {
      issues.push(issue('FP20_HYDRAULIC_PLAN_NODE_SEQUENCE_MISMATCH', 'The persisted canonical node sequence must exactly match the reviewed edge traversal.', legId));
      continue;
    }
    if (edgeIds.some((edgeId) => usedEdgeIds.has(edgeId))) {
      issues.push(issue('FP20_HYDRAULIC_PLAN_EDGE_REUSED', 'Sequential route 2-1 plan legs cannot silently reuse a canonical edge.', legId));
      continue;
    }
    edgeIds.forEach((edgeId) => usedEdgeIds.add(edgeId));
    const pipeTableLeg = legs.find((leg) => `${leg.node1}>${leg.node2}` === legId);
    planRouteLegs.push({
      calculationFromNodeId: explicitLeg.calculationFromNodeId,
      calculationToNodeId: explicitLeg.calculationToNodeId,
      nodeIds: traced.nodeIds,
      edgeIds: traced.edgeIds,
      visiblePlanLengthFt: traced.visiblePlanLengthFt,
      calculationPipeLengthFt: pipeTableLeg?.lengthFt ?? null,
      unresolvedProjectionDeltaFt: Number.isFinite(pipeTableLeg?.lengthFt) ? round(pipeTableLeg.lengthFt - traced.visiblePlanLengthFt) : null,
      routeSelectionMethod: 'explicit-approved-plan-and-hydraulic-table-binding',
    });
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
    route21ExplicitPlanPathReady: ready,
    wholeFp20HydraulicNodeBindingReady: false,
    wholeFp20HydraulicFlowReady: false,
    gradeDirectionReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}
