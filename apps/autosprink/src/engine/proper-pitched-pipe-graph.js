/**
 * Production acceptance contract for source-bound pitched-roof pipe layouts.
 *
 * A row of sprinkler heads, a colored polyline, or a hydraulically connected
 * sketch is not a proper pipe layout. This gate requires the plan geometry,
 * flow topology, dry-pipe grade, elevations, fittings, drainage, sizes, and
 * riser closure to agree on one project-specific graph.
 */

const ROLES = new Set(['riser', 'cross-main', 'branch-line', 'arm-over', 'drop', 'sprig', 'drain']);
const FITTINGS = new Set(['tee', 'elbow-90', 'elbow-45', 'coupling', 'reducer', 'cap', 'union', 'riser-transition', 'drain-valve', 'drum-drip']);
const round = (value, digits = 6) => Number(value.toFixed(digits));
const blocking = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });
const finitePoint = (point) => point && Number.isFinite(point.xFt) && Number.isFinite(point.yFt);
const distance2d = (a, b) => Math.hypot(b.xFt - a.xFt, b.yFt - a.yFt);
const bearingDeg = (a, b) => (Math.atan2(b.yFt - a.yFt, b.xFt - a.xFt) * 180 / Math.PI + 360) % 360;

function connectedFrom(adjacency, start) {
  if (!start || !adjacency.has(start)) return new Set();
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const node = queue.shift();
    for (const next of adjacency.get(node) || []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

function directedReachable(edges, start) {
  const adjacency = new Map();
  for (const edge of edges) {
    const from = edge?.flow?.fromNodeId;
    const to = edge?.flow?.toNodeId;
    if (!from || !to) continue;
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(to);
  }
  const seen = new Set(start ? [start] : []);
  const queue = start ? [start] : [];
  while (queue.length) {
    const node = queue.shift();
    for (const next of adjacency.get(node) || []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

/** Evaluate one project-specific pipe graph. This function never repairs or infers missing facts. */
export function evaluateProperPitchedPipeGraph(graph) {
  const issues = [];
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const nodeById = new Map();
  const adjacency = new Map();
  const degree = new Map();
  const incidentDiameters = new Map();

  if (graph?.artifactType !== 'halofire.source-bound-pitched-pipe-graph.v1') issues.push(blocking('PIPE_GRAPH_IDENTITY_MISSING', 'The source-bound pitched pipe graph identity is missing.'));
  if (!graph?.projectId || !Array.isArray(graph?.sourceBindings) || graph.sourceBindings.length === 0 || graph.sourceBindings.some((binding) => !binding?.sha256 || !binding?.sheet)) issues.push(blocking('PIPE_GRAPH_SOURCE_BINDING_MISSING', 'Project, source hash, and source sheet bindings are required.'));
  if (nodes.length === 0 || edges.length === 0) issues.push(blocking('PIPE_GRAPH_EMPTY', 'The pipe graph must contain source-bound nodes and edges.'));

  for (const node of nodes) {
    if (!node?.id || nodeById.has(node.id)) { issues.push(blocking('PIPE_NODE_ID_INVALID', 'Every pipe node needs a unique identity.', node?.id)); continue; }
    nodeById.set(node.id, node);
    adjacency.set(node.id, new Set());
    degree.set(node.id, 0);
    incidentDiameters.set(node.id, new Set());
    if (!finitePoint(node.plan)) issues.push(blocking('PIPE_NODE_PLAN_XY_MISSING', 'Every node needs scaled plan coordinates.', node.id));
    if (!Number.isFinite(node.elevationFt)) issues.push(blocking('PIPE_NODE_ELEVATION_MISSING', 'Every node needs a project-specific pipe centerline elevation.', node.id));
    if (!node.sourceRef) issues.push(blocking('PIPE_NODE_SOURCE_REF_MISSING', 'Every node needs a source location reference.', node.id));
    if ((node.kind === 'sprinkler' || node.kind === 'sprinkler-junction') && !node.hydraulicNodeId) issues.push(blocking('PIPE_HYDRAULIC_NODE_ID_MISSING', 'Every sprinkler connection needs its project hydraulic identity.', node.id));
  }

  for (const edge of edges) {
    const from = nodeById.get(edge?.fromNodeId);
    const to = nodeById.get(edge?.toNodeId);
    if (!edge?.id || !from || !to || from === to) { issues.push(blocking('PIPE_EDGE_ENDPOINT_INVALID', 'Every edge needs two distinct existing graph nodes.', edge?.id)); continue; }
    adjacency.get(from.id).add(to.id); adjacency.get(to.id).add(from.id);
    degree.set(from.id, degree.get(from.id) + 1); degree.set(to.id, degree.get(to.id) + 1);
    if (Number.isFinite(edge.nominalDiameterIn)) {
      incidentDiameters.get(from.id).add(edge.nominalDiameterIn);
      incidentDiameters.get(to.id).add(edge.nominalDiameterIn);
    }
    if (!ROLES.has(edge.role)) issues.push(blocking('PIPE_EDGE_ROLE_MISSING', 'Every edge needs a governed pipe role.', edge.id));
    if (!Number.isFinite(edge.nominalDiameterIn) || edge.nominalDiameterIn <= 0) issues.push(blocking('PIPE_EDGE_NOMINAL_SIZE_MISSING', 'Every edge needs a nominal fabrication diameter.', edge.id));
    if (!edge.sourceRef) issues.push(blocking('PIPE_EDGE_SOURCE_REF_MISSING', 'Every edge needs a source vector or annotation reference.', edge.id));

    if (from.plan && to.plan) {
      const lengthFt = distance2d(from.plan, to.plan);
      const bearing = bearingDeg(from.plan, to.plan);
      if (!Number.isFinite(edge.planLengthFt) || Math.abs(edge.planLengthFt - lengthFt) > 0.02) issues.push(blocking('PIPE_EDGE_PLAN_LENGTH_MISMATCH', 'Edge plan length does not close against scaled endpoints.', edge.id));
      if (!Number.isFinite(edge.planDirectionBearingDeg) || Math.abs((((edge.planDirectionBearingDeg - bearing) % 360) + 540) % 360 - 180) > 0.25) issues.push(blocking('PIPE_EDGE_PLAN_DIRECTION_MISMATCH', 'Edge plan direction does not close against its ordered endpoints.', edge.id));
    }

    if (edge?.flow?.fromNodeId !== from.id || edge?.flow?.toNodeId !== to.id || !edge?.flow?.sourceRef) issues.push(blocking('PIPE_EDGE_FLOW_DIRECTION_MISSING', 'Hydraulic flow direction must be source-proved separately from plan direction.', edge.id));

    if (graph.systemType === 'dry' && edge.role !== 'riser' && edge.role !== 'drop' && edge.role !== 'sprig') {
      const grade = edge.grade;
      if (!Number.isFinite(grade?.riseInPer10Ft) || grade.riseInPer10Ft <= 0) issues.push(blocking('PIPE_EDGE_GRADE_MAGNITUDE_MISSING', 'Dry horizontal pipe needs its role-specific grade magnitude.', edge.id));
      if (!grade?.highNodeId || !grade?.lowNodeId || grade.highNodeId === grade.lowNodeId || !grade?.sourceRef) issues.push(blocking('PIPE_EDGE_GRADE_DIRECTION_MISSING', 'Grade direction and its source must be explicit.', edge.id));
      else if (!new Set([from.id, to.id]).has(grade.highNodeId) || !new Set([from.id, to.id]).has(grade.lowNodeId)) issues.push(blocking('PIPE_EDGE_GRADE_ENDPOINT_INVALID', 'Grade endpoints must match the pipe edge.', edge.id));
      else if (Number.isFinite(from.elevationFt) && Number.isFinite(to.elevationFt) && Number.isFinite(edge.planLengthFt) && Number.isFinite(grade.riseInPer10Ft)) {
        const high = nodeById.get(grade.highNodeId);
        const low = nodeById.get(grade.lowNodeId);
        if (high.elevationFt <= low.elevationFt) issues.push(blocking('PIPE_EDGE_GRADE_SIGN_MISMATCH', 'The declared high end is not above the declared low end.', edge.id));
        const expectedDropFt = grade.riseInPer10Ft / 12 * edge.planLengthFt / 10;
        if (Math.abs((high.elevationFt - low.elevationFt) - expectedDropFt) > 0.02) issues.push(blocking('PIPE_EDGE_GRADE_ELEVATION_MISMATCH', 'Endpoint elevations do not close against the declared grade.', edge.id));
      }
    }
  }

  const sourceNode = nodes.find((node) => node.kind === 'source' || node.kind === 'riser-base');
  if (!sourceNode) issues.push(blocking('PIPE_RISER_SOURCE_MISSING', 'The graph must include the project riser or supply source.'));
  const connected = connectedFrom(adjacency, sourceNode?.id);
  if (sourceNode && connected.size !== nodes.length) issues.push(blocking('PIPE_WHOLE_NETWORK_DISCONNECTED', 'Every pipe node must connect to the project riser/source.'));
  const flowReachable = directedReachable(edges, sourceNode?.id);
  const unreachableSprinklers = nodes.filter((node) => (node.kind === 'sprinkler' || node.kind === 'sprinkler-junction') && !flowReachable.has(node.id));
  if (unreachableSprinklers.length) issues.push(blocking('PIPE_FLOW_PATH_INCOMPLETE', 'Every sprinkler must have a directed hydraulic path from the source.', unreachableSprinklers.map((node) => node.id).join(',')));

  for (const node of nodes) {
    const requiresFitting = (degree.get(node.id) || 0) !== 2 || node.kind === 'sprinkler-junction' || node.kind === 'riser-base' || node.kind === 'low-point' || node.kind === 'drain-destination';
    if (requiresFitting && (!node.fitting || !FITTINGS.has(node.fitting.kind) || !node.fitting.sourceRef)) issues.push(blocking('PIPE_FITTING_IDENTITY_MISSING', 'Endpoints, junctions, transitions, and drains need source-bound fitting identities.', node.id));
    if (node.fitting) {
      const observed = [...(incidentDiameters.get(node.id) || [])].sort((a, b) => a - b);
      const declared = Array.isArray(node.fitting.connectedNominalDiametersIn) ? [...new Set(node.fitting.connectedNominalDiametersIn)].sort((a, b) => a - b) : [];
      if (observed.length !== declared.length || observed.some((diameter, index) => diameter !== declared[index])) issues.push(blocking('PIPE_FITTING_SIZE_TRANSITION_MISMATCH', 'Fitting inlet and outlet sizes must close against every incident pipe diameter.', node.id));
    }
  }

  if (graph.systemType === 'dry') {
    const lowPoints = nodes.filter((node) => node.kind === 'low-point');
    if (lowPoints.length === 0) issues.push(blocking('PIPE_LOW_POINT_MISSING', 'A dry-system graph must identify its low points.'));
    for (const node of lowPoints) {
      const drainEdges = edges.filter((edge) => edge.role === 'drain' && (edge.fromNodeId === node.id || edge.toNodeId === node.id));
      const hasDestination = drainEdges.some((edge) => {
        const other = nodeById.get(edge.fromNodeId === node.id ? edge.toNodeId : edge.fromNodeId);
        return other?.kind === 'drain-destination' && ['drum-drip', 'auxiliary-drain', 'approved-discharge'].includes(other?.drainage?.destinationKind) && Boolean(other?.drainage?.sourceRef);
      });
      if (!hasDestination) issues.push(blocking('PIPE_DRAIN_DESTINATION_MISSING', 'Every dry low point needs a connected, source-bound drain destination.', node.id));
    }
  }

  const uniqueCodes = [...new Set(issues.map((entry) => entry.code))];
  return {
    status: issues.length ? 'blocked' : 'passed',
    issues,
    blockerCodes: uniqueCodes,
    metrics: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      connectedNodeCount: connected.size,
      sprinklerCount: nodes.filter((node) => node.kind === 'sprinkler' || node.kind === 'sprinkler-junction').length,
      flowReachableSprinklerCount: nodes.filter((node) => (node.kind === 'sprinkler' || node.kind === 'sprinkler-junction') && flowReachable.has(node.id)).length,
    },
    properPipeLayoutReady: issues.length === 0,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}

/** Adapt the current New Hope answer-exposed ridge evidence without inventing missing facts. */
export function buildNewHopeProperPipeGraphCandidate(calibration, source) {
  const nodes = (calibration?.branch?.nodes || []).map((node) => ({
    id: node.id,
    kind: 'sprinkler-junction',
    plan: { xFt: node.localFt.x, yFt: node.localFt.y },
    elevationFt: null,
    hydraulicNodeId: null,
    sourceRef: `FP2.0 vector head ${node.approvedPdfCenter.x},${node.approvedPdfCenter.y}`,
    fitting: null,
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = (calibration?.branch?.edges || []).map((edge) => {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    return {
      id: edge.id,
      fromNodeId: edge.from,
      toNodeId: edge.to,
      role: 'branch-line',
      nominalDiameterIn: edge.pipeSizeIn,
      planLengthFt: edge.lengthFt,
      planDirectionBearingDeg: round(bearingDeg(from.plan, to.plan)),
      flow: { fromNodeId: edge.from, toNodeId: edge.to, sourceRef: 'FP2.0 visible west-to-east feed connection' },
      grade: { riseInPer10Ft: calibration.branch.grade.branchLinesRiseInPer10Ft, highNodeId: null, lowNodeId: null, sourceRef: null },
      sourceRef: `FP2.0 approved ridge vector ${edge.id}`,
    };
  });
  return {
    artifactType: 'halofire.source-bound-pitched-pipe-graph.v1',
    projectId: calibration?.projectId,
    systemType: 'dry',
    sourceBindings: [{ role: 'approved-sprinkler-plan', sha256: source?.sources?.approvedFp20?.sha256, sheet: 'FP2.0' }],
    nodes,
    edges,
    answerExposedCalibration: true,
    projectSpecificFactsOnly: true,
  };
}

/** Record what separate completed projects prove without transferring their values into another job. */
export function buildProperPipeCorpusCoverage(newHopeCalibration, winterGardenRegistration) {
  return {
    artifactType: 'halofire.proper-pitched-pipe-corpus-coverage.v1',
    transferProjectSpecificValuesAllowed: false,
    dimensions: {
      scaledPlanXy: Boolean(newHopeCalibration?.exactHeadXyReady),
      nominalFabricationSize: Number.isFinite(newHopeCalibration?.branch?.pipeSizeIn),
      planDirection: Boolean(newHopeCalibration?.branch?.planDirection),
      hydraulicFlowDirection: Boolean(newHopeCalibration?.branch?.visibleHydraulicFlowDirection),
      dryBranchGradeMagnitude: Number.isFinite(newHopeCalibration?.branch?.grade?.branchLinesRiseInPer10Ft),
      dryCrossMainGradeMagnitude: Number.isFinite(newHopeCalibration?.branch?.grade?.crossMainsRiseInPer10Ft),
      projectGradeDirection: Boolean(newHopeCalibration?.branch?.grade?.boundedBranchGradeDirectionReady),
      pitchedRowElevationDatum: Boolean(winterGardenRegistration?.pitchedRowHydraulicDatumRegistrationReady),
      operatingHydraulicEvidence: Boolean(winterGardenRegistration?.operatingSprinklerHydraulicEvidenceReady),
      fullNetworkPipeElevation: Boolean(winterGardenRegistration?.fullNetworkPipeElevationReady),
      perHeadHydraulicIdentity: Boolean(winterGardenRegistration?.perHeadHydraulicIdentityReady),
      lowPointDrainDestination: Boolean(newHopeCalibration?.branch?.drainage?.boundedBranchDrainDestinationReady),
      fittings: Boolean(newHopeCalibration?.branch?.fittingsReady),
      riserClosure: Boolean(newHopeCalibration?.branch?.wholeNetworkTopologyReady),
    },
    properPipeLayoutReady: false,
    fieldReleaseReady: false,
  };
}
