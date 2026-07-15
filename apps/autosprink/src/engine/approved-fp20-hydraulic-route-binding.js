const EXPECTED_PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5';
const EXPECTED_CALC_SHA = 'D70FA475A0DD32B22B134D2D6161435D9E769D659B320C6F25A3D908AE70D719';

const REMOTE_AREAS = Object.freeze({
  '2-1': {
    physicalPages: [15, 16],
    routes: [
      { routeId: '1', calculationNodeIds: ['1052', '1051', '1050', '1049', '1048', '1047', '1046', '67', '118', '414', '560', '554', '25', '1'] },
    ],
    planNodeIds: ['1052', '1051', '1050', '1049', '1048', '1047', '1046', '67', '118'],
    externalNodeIds: ['414', '560', '554', '25', '1'],
  },
  '2-2': {
    physicalPages: [23, 24, 25],
    routes: [
      { routeId: '1', calculationNodeIds: ['725', '58', '57', '50', '118', '414', '560', '554', '25', '1'] },
      { routeId: '2', calculationNodeIds: ['722', '57'] },
      { routeId: '3', calculationNodeIds: ['731', '730', '729', '728', '182', '67', '58'] },
      { routeId: '4', calculationNodeIds: ['718', '50'] },
      { routeId: '5', calculationNodeIds: ['733', '734', '182'] },
      { routeId: '6', calculationNodeIds: ['28', '32', '25'] },
    ],
    planNodeIds: ['725', '58', '57', '50', '118', '722', '731', '730', '729', '728', '182', '67', '718', '733', '734'],
    externalNodeIds: ['414', '560', '554', '25', '1', '28', '32'],
  },
  '2-3': {
    physicalPages: [31, 32],
    routes: [
      { routeId: '1', calculationNodeIds: ['822', '62', '63', '54', '118', '414', '560', '554', '25', '1'] },
      { routeId: '2', calculationNodeIds: ['820', '63'] },
      { routeId: '3', calculationNodeIds: ['818', '819', '823', '824', '62'] },
      { routeId: '4', calculationNodeIds: ['821', '818'] },
      { routeId: '5', calculationNodeIds: ['28', '32', '25'] },
    ],
    planNodeIds: ['822', '62', '63', '54', '118', '820', '818', '819', '823', '824', '821'],
    externalNodeIds: ['414', '560', '554', '25', '1', '28', '32'],
  },
});

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const round = (value, digits = 6) => Number(value.toFixed(digits));
const legKey = (routeId, node1, node2) => `${routeId}:${node1}>${node2}`;

function expectedLegs(definition) {
  return definition.routes.flatMap((route) => route.calculationNodeIds.slice(0, -1).map((node1, index) => ({
    routeId: route.routeId,
    node1,
    node2: route.calculationNodeIds[index + 1],
  })));
}

function expectedPlanLegs(definition) {
  const planNodeIds = new Set(definition.planNodeIds);
  return expectedLegs(definition).filter((leg) => planNodeIds.has(leg.node1) && planNodeIds.has(leg.node2));
}

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
  const definition = REMOTE_AREAS[evidence?.remoteAreaId];
  const nodes = Array.isArray(canonicalTopology?.nodes) ? canonicalTopology.nodes : [];
  const edges = Array.isArray(canonicalTopology?.edges) ? canonicalTopology.edges : [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const bindings = Array.isArray(evidence?.planNodeBindings) ? evidence.planNodeBindings : [];
  const bindingByCalcId = new Map();

  if (!definition || evidence?.artifactType !== 'halofire.approved-fp20-hydraulic-route-binding.v3' || evidence?.projectId !== canonicalTopology?.projectId) {
    issues.push(issue('FP20_HYDRAULIC_ROUTE_IDENTITY_INVALID', 'Hydraulic route evidence must identify the same approved FP2.0 project and a supported remote area.'));
  }
  if (!definition || evidence?.sourceBindings?.approvedPlan?.sha256 !== EXPECTED_PLAN_SHA || evidence?.sourceBindings?.approvedPlan?.physicalPage !== 5 || evidence?.sourceBindings?.hydraulicCalculation?.sha256 !== EXPECTED_CALC_SHA || JSON.stringify(evidence?.sourceBindings?.hydraulicCalculation?.physicalPages) !== JSON.stringify(definition.physicalPages)) {
    issues.push(issue('FP20_HYDRAULIC_ROUTE_SOURCE_INVALID', 'Each remote area must stay bound to approved FP2.0 and its exact calculation-table physical pages.'));
  }
  if (evidence?.calculationDirection !== 'remote-terminal-to-water-source' || evidence?.physicalFlowDirection !== 'water-source-to-remote-terminal' || evidence?.gradeDirectionRelationship !== 'independent-drainage-vector-not-derived-from-hydraulic-flow') {
    issues.push(issue('FP20_DIRECTION_SEMANTICS_INVALID', 'Calculation order, hydraulic flow, and drainage grade must remain three explicit and distinct direction semantics.'));
  }
  if (!definition || JSON.stringify(evidence?.calculationRoutes) !== JSON.stringify(definition.routes)) {
    issues.push(issue('FP20_HYDRAULIC_ROUTE_SEQUENCE_INVALID', 'Every calculation route must preserve its exact AutoSPRINK table node order.'));
  }

  for (const binding of bindings) {
    if (!binding?.calculationNodeId || bindingByCalcId.has(binding.calculationNodeId)) {
      issues.push(issue('FP20_HYDRAULIC_NODE_BINDING_ID_INVALID', 'Each plan calculation node needs one unique binding.', binding?.calculationNodeId));
      continue;
    }
    bindingByCalcId.set(binding.calculationNodeId, binding);
    const canonicalNode = nodeById.get(binding.canonicalNodeId);
    if (!canonicalNode || !binding.leaderTargetPdfPt || distance(canonicalNode.pdfPt, binding.leaderTargetPdfPt) > 6 || !Number.isInteger(binding.sourceTextRef?.blockIndex) || !Number.isInteger(binding.sourceTextRef?.lineIndex) || !Number.isInteger(binding.sourceTextRef?.wordIndex) || !Number.isInteger(binding.sourceLeaderDrawingIndex)) {
      issues.push(issue('FP20_HYDRAULIC_NODE_BINDING_INVALID', 'Calculation-node label, source leader, leader target, and canonical plan node must close within six PDF points.', binding.calculationNodeId));
    }
  }
  if (!definition || bindings.length !== definition.planNodeIds.length || definition.planNodeIds.some((id) => !bindingByCalcId.has(id))) {
    issues.push(issue('FP20_HYDRAULIC_PLAN_NODE_SET_INCOMPLETE', 'The remote area needs every source-proved calculation-node binding visible on FP2.0.'));
  }
  if (!definition || JSON.stringify(evidence?.externalNodeIds) !== JSON.stringify(definition.externalNodeIds)) {
    issues.push(issue('FP20_EXTERNAL_NODE_SET_INVALID', 'Calculation nodes below or outside the FP2.0 plan boundary must remain explicit external riser, source, or hydrant nodes.'));
  }

  const legs = Array.isArray(evidence?.pipeTableLegs) ? evidence.pipeTableLegs : [];
  const expectedPipeLegs = definition ? expectedLegs(definition) : [];
  if (legs.length !== expectedPipeLegs.length || legs.some((leg, index) => legKey(leg.routeId, leg.node1, leg.node2) !== legKey(expectedPipeLegs[index]?.routeId, expectedPipeLegs[index]?.node1, expectedPipeLegs[index]?.node2))) {
    issues.push(issue('FP20_HYDRAULIC_PIPE_TABLE_LEGS_INVALID', 'Pipe-table legs must be complete and remain in source route and calculation order.'));
  }
  const pipeLegByKey = new Map();
  for (const leg of legs) {
    pipeLegByKey.set(legKey(leg.routeId, leg.node1, leg.node2), leg);
    if (![leg.elevation1Ft, leg.elevation2Ft, leg.nominalDiameterIn, leg.actualDiameterIn, leg.totalFlowGpm, leg.lengthFt, leg.cFactor, leg.fittingEquivalentLengthFt].every(Number.isFinite) || !leg.notes) {
      issues.push(issue('FP20_HYDRAULIC_PIPE_TABLE_FIELD_MISSING', 'Every calculation leg needs endpoint elevations, sizes, flow, length, C factor, fitting length, and notes.', legKey(leg.routeId, leg.node1, leg.node2)));
    }
  }

  const expectedVisibleLegs = definition ? expectedPlanLegs(definition) : [];
  const explicitPlanLegBindings = Array.isArray(evidence?.planLegBindings) ? evidence.planLegBindings : [];
  if (explicitPlanLegBindings.length !== expectedVisibleLegs.length || explicitPlanLegBindings.some((leg, index) => legKey(leg.routeId, leg.calculationFromNodeId, leg.calculationToNodeId) !== legKey(expectedVisibleLegs[index]?.routeId, expectedVisibleLegs[index]?.node1, expectedVisibleLegs[index]?.node2))) {
    issues.push(issue('FP20_HYDRAULIC_EXPLICIT_PLAN_LEGS_INVALID', 'Every FP2.0-visible calculation leg must provide an explicit source-reviewed plan projection in calculation-table order.'));
  }
  const planRouteLegs = [];
  const usedEdgeIds = new Set();
  for (const explicitLeg of explicitPlanLegBindings) {
    const id = legKey(explicitLeg.routeId, explicitLeg.calculationFromNodeId, explicitLeg.calculationToNodeId);
    const from = bindingByCalcId.get(explicitLeg.calculationFromNodeId);
    const to = bindingByCalcId.get(explicitLeg.calculationToNodeId);
    const edgeIds = Array.isArray(explicitLeg.canonicalEdgeIds) ? explicitLeg.canonicalEdgeIds : [];
    const pipeTableLeg = pipeLegByKey.get(id);
    if (!from || !to || !pipeTableLeg) {
      issues.push(issue('FP20_HYDRAULIC_EXPLICIT_PLAN_LEG_INVALID', 'An explicit plan leg needs bound calculation and pipe-table endpoints.', id));
      continue;
    }
    if (explicitLeg.pathKind === 'vertical-at-canonical-node') {
      const validVertical = from.canonicalNodeId === to.canonicalNodeId
        && edgeIds.length === 0
        && JSON.stringify(explicitLeg.canonicalNodeIds) === JSON.stringify([from.canonicalNodeId])
        && explicitLeg.axisEvidence === 'coincident-plan-node-with-calculation-elevation-delta'
        && pipeTableLeg.lengthFt > 0
        && pipeTableLeg.elevation1Ft !== pipeTableLeg.elevation2Ft;
      if (!validVertical) {
        issues.push(issue('FP20_HYDRAULIC_VERTICAL_PLAN_LEG_INVALID', 'A same-XY leg must be explicitly proved by coincident plan binding and a non-zero calculation elevation delta.', id));
        continue;
      }
      planRouteLegs.push({
        routeId: explicitLeg.routeId,
        calculationFromNodeId: explicitLeg.calculationFromNodeId,
        calculationToNodeId: explicitLeg.calculationToNodeId,
        nodeIds: [from.canonicalNodeId],
        edgeIds: [],
        visiblePlanLengthFt: 0,
        calculationPipeLengthFt: pipeTableLeg.lengthFt,
        unresolvedProjectionDeltaFt: pipeTableLeg.lengthFt,
        pathKind: explicitLeg.pathKind,
        routeSelectionMethod: 'explicit-approved-plan-and-hydraulic-table-binding',
      });
      continue;
    }
    if (explicitLeg.pathKind !== 'source-plan-edge-sequence' || edgeIds.length === 0 || new Set(edgeIds).size !== edgeIds.length) {
      issues.push(issue('FP20_HYDRAULIC_EXPLICIT_PLAN_LEG_INVALID', 'A plan-projected leg needs a non-empty, non-repeating reviewed canonical edge sequence.', id));
      continue;
    }
    const traced = traceExplicitEdgePath(edgeById, from.canonicalNodeId, edgeIds);
    if (traced.errorCode) {
      issues.push(issue(traced.errorCode, 'The reviewed canonical edge sequence must exist and remain continuous from its bound calculation node.', `${id}:${traced.edgeId}`));
      continue;
    }
    if (traced.endNodeId !== to.canonicalNodeId) {
      issues.push(issue('FP20_HYDRAULIC_PLAN_PATH_ENDPOINT_MISMATCH', 'The reviewed canonical edge sequence must terminate at the next calculation node.', id));
      continue;
    }
    if (JSON.stringify(explicitLeg.canonicalNodeIds) !== JSON.stringify(traced.nodeIds)) {
      issues.push(issue('FP20_HYDRAULIC_PLAN_NODE_SEQUENCE_MISMATCH', 'The persisted canonical node sequence must exactly match the reviewed edge traversal.', id));
      continue;
    }
    if (edgeIds.some((edgeId) => usedEdgeIds.has(edgeId))) {
      issues.push(issue('FP20_HYDRAULIC_PLAN_EDGE_REUSED', 'One remote-area calculation tree cannot silently reuse a canonical edge in separate table legs.', id));
      continue;
    }
    edgeIds.forEach((edgeId) => usedEdgeIds.add(edgeId));
    planRouteLegs.push({
      routeId: explicitLeg.routeId,
      calculationFromNodeId: explicitLeg.calculationFromNodeId,
      calculationToNodeId: explicitLeg.calculationToNodeId,
      nodeIds: traced.nodeIds,
      edgeIds: traced.edgeIds,
      visiblePlanLengthFt: traced.visiblePlanLengthFt,
      calculationPipeLengthFt: pipeTableLeg.lengthFt,
      unresolvedProjectionDeltaFt: round(pipeTableLeg.lengthFt - traced.visiblePlanLengthFt),
      pathKind: explicitLeg.pathKind,
      routeSelectionMethod: 'explicit-approved-plan-and-hydraulic-table-binding',
    });
  }

  const calculationRoutes = Array.isArray(evidence?.calculationRoutes) ? evidence.calculationRoutes : [];
  const physicalFlowRoutes = calculationRoutes.map((route) => ({ routeId: route.routeId, calculationTableOrderReversed: true, nodeIds: [...route.calculationNodeIds].reverse() }));
  const physicalFlowLegs = calculationRoutes.flatMap((route) => legs.filter((leg) => leg.routeId === route.routeId).reverse().map((leg) => ({
    routeId: route.routeId,
    fromCalculationNodeId: leg.node2,
    toCalculationNodeId: leg.node1,
    totalFlowGpm: leg.totalFlowGpm,
    nominalDiameterIn: leg.nominalDiameterIn,
    fromElevationFt: leg.elevation2Ft,
    toElevationFt: leg.elevation1Ft,
    calculationTableOrderReversed: true,
  })));
  const calculationNodeIds = [...new Set(calculationRoutes.flatMap((route) => route.calculationNodeIds))];
  const ready = issues.length === 0 && planRouteLegs.length === expectedVisibleLegs.length && physicalFlowLegs.length === expectedPipeLegs.length;
  const result = {
    artifactType: 'halofire.approved-fp20-hydraulic-route-binding-result.v2',
    projectId: evidence?.projectId,
    remoteAreaId: evidence?.remoteAreaId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    planNodeBindings: bindings,
    planRouteLegs,
    physicalFlowRoutes,
    physicalFlowNodeIds: physicalFlowRoutes.length === 1 ? physicalFlowRoutes[0].nodeIds : [],
    physicalFlowLegs,
    metrics: {
      calculationRouteCount: calculationRoutes.length,
      calculationNodeCount: calculationNodeIds.length,
      planBoundCalculationNodeCount: bindings.length,
      externalNodeCount: evidence?.externalNodeIds?.length || 0,
      pipeTableLegCount: legs.length,
      planVisibleLegCount: planRouteLegs.length,
      verticalPlanLegCount: planRouteLegs.filter((entry) => entry.pathKind === 'vertical-at-canonical-node').length,
      mappedCanonicalEdgeCount: new Set(planRouteLegs.flatMap((entry) => entry.edgeIds)).size,
    },
    hydraulicNodeBindingReady: ready,
    hydraulicFlowDirectionReady: ready,
    explicitPlanPathReady: ready,
    calculationEndpointElevationEvidenceReady: ready,
    wholeFp20HydraulicNodeBindingReady: false,
    wholeFp20HydraulicFlowReady: false,
    gradeDirectionReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
  if (evidence?.remoteAreaId === '2-1') {
    result.route21HydraulicNodeBindingReady = ready;
    result.route21HydraulicFlowDirectionReady = ready;
    result.route21ExplicitPlanPathReady = ready;
  }
  return result;
}

export function bindApprovedFp20HydraulicRouteSet(canonicalTopology, evidences) {
  const results = (Array.isArray(evidences) ? evidences : []).map((evidence) => bindApprovedFp20HydraulicRoute(canonicalTopology, evidence));
  const expectedAreaIds = Object.keys(REMOTE_AREAS);
  const areaIds = results.map((result) => result.remoteAreaId);
  const issues = [];
  if (JSON.stringify(areaIds) !== JSON.stringify(expectedAreaIds)) issues.push(issue('FP20_REMOTE_AREA_SET_INVALID', 'The approved route set must contain remote areas 2-1, 2-2, and 2-3 exactly once and in source order.'));
  if (results.some((result) => result.status !== 'passed')) issues.push(issue('FP20_REMOTE_AREA_BINDING_BLOCKED', 'Every approved remote-area route binding must pass before the calculation-route set is ready.'));
  const approvedRemoteAreaSetReady = issues.length === 0;
  return {
    artifactType: 'halofire.approved-fp20-hydraulic-route-set-result.v1',
    projectId: canonicalTopology?.projectId,
    status: approvedRemoteAreaSetReady ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set([...issues.map((entry) => entry.code), ...results.flatMap((result) => result.blockerCodes)])],
    remoteAreas: results,
    metrics: {
      remoteAreaCount: results.length,
      calculationRouteCount: results.reduce((sum, result) => sum + result.metrics.calculationRouteCount, 0),
      uniqueCalculationNodeCount: new Set(results.flatMap((result) => result.physicalFlowRoutes.flatMap((route) => route.nodeIds))).size,
      planBoundCalculationNodeCount: results.reduce((sum, result) => sum + result.metrics.planBoundCalculationNodeCount, 0),
      pipeTableLegCount: results.reduce((sum, result) => sum + result.metrics.pipeTableLegCount, 0),
      planVisibleLegCount: results.reduce((sum, result) => sum + result.metrics.planVisibleLegCount, 0),
      mappedCalculatedCanonicalEdgeCount: new Set(results.flatMap((result) => result.planRouteLegs.flatMap((leg) => leg.edgeIds))).size,
    },
    approvedRemoteAreaSetReady,
    approvedRemoteAreaHydraulicFlowReady: approvedRemoteAreaSetReady,
    calculationEndpointElevationEvidenceReady: approvedRemoteAreaSetReady,
    wholeFp20HydraulicNodeBindingReady: false,
    wholeFp20HydraulicFlowReady: false,
    gradeDirectionReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    remainingBlockers: [
      issue('FP20_NON_CALCULATED_EDGES_AWAIT_DIRECTION_BINDING', 'Approved remote-area calculations do not assign hydraulic direction to every primary FP2.0 edge.'),
      issue('FP20_DRAINAGE_GRADE_REQUIRES_ELEVATION_BINDING', 'Hydraulic node elevations do not independently prove high-to-low drainage direction or drain destination.'),
    ],
  };
}
