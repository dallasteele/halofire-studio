import { createHash } from 'node:crypto';

const SHA256 = /^[0-9a-f]{64}$/;
const EXPECTED = Object.freeze({
  'mit-riverside-dugout-h': Object.freeze({
    receiptSha256: '9097927301f4502d9d7cfc7d5ad5bd3009f0d9f70f7f241d7f4ffb64bb2a9ab5',
    networkSha256: '5b26cbdc3409a79f8981ad47119765dbc2046c7080b1ae1af4b7928bdf85930d',
    sourceHashes: [
      'c961ffd468c0af1433e93755be4b8b388625824e259f9b52d0b61e44b6792621',
      'dbde3554b995d9ceb16d6829d683306e9a60f2dbc9b05ab87a3c60b548c0538c',
      'b7a8c3c2faceacba6c41437f773af650cdcc84eddc44cc5a88e1e563ac052207',
      '9078f2e439aa01d8dd1c082a36939a217dea7c45ba918b7d52fefbd47cbc33b1',
    ],
    metrics: { nodeCount: 31, pipeCount: 30, activeSprinklerNodeCount: 15, planMappedNodeCount: 24, minimumElevationFt: -3, maximumElevationFt: 12, distinctElevationCount: 10 },
  }),
  'nashville-tn-temple': Object.freeze({
    receiptSha256: 'dcf6f144d19b8b7f9f3fc6b0c96cd73bdd973b822ccfb40dd0b4f0be6630f078',
    networkSha256: 'f4edadcb3c0920f1a7c72072df693310c958abee26f10ee518f0f6f228217dce',
    sourceHashes: [
      '27a79ee420eac08b1fb09b7efbd0f8998f464942bbe0fcc02de26a0629feaef9',
      '4a792a82111588a8c80a6c3fe21867a78a8d4c3a7732be4e5736abd52bc7884a',
      'fa92c6ddbef4e1f25171e48a48e9c320e11121f0963d3931fa3f19baf7296614',
      '53a31d498f7af2844bb52dd9e2d94ce6267eceaf5522b7657e5d7b93afa6b00c',
      'ff6791088204be0d8186f6f81955c357332588cacfd5b9a5c1b0e77aeefffa46',
    ],
    metrics: { nodeCount: 68, pipeCount: 68, activeSprinklerNodeCount: 19, planMappedNodeCount: 0, minimumElevationFt: -3, maximumElevationFt: 14.5, distinctElevationCount: 5 },
  }),
});

function jsonSha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function issue(code, message) {
  return { severity: 'blocking', code, message };
}

function computedMetrics(nodes, pipes, planMappedNodeIds) {
  const elevations = nodes.map((node) => node[1]);
  return {
    nodeCount: nodes.length,
    pipeCount: pipes.length,
    activeSprinklerNodeCount: nodes.filter((node) => node[2] !== null).length,
    planMappedNodeCount: planMappedNodeIds.length,
    minimumElevationFt: Math.min(...elevations),
    maximumElevationFt: Math.max(...elevations),
    distinctElevationCount: new Set(elevations).size,
  };
}

function connectedNodeIds(nodes, pipes, sourceId = 'SRC') {
  const adjacency = new Map(nodes.map(([id]) => [id, new Set()]));
  for (const [, fromId, toId] of pipes) {
    adjacency.get(fromId)?.add(toId);
    adjacency.get(toId)?.add(fromId);
  }
  const visited = new Set();
  const queue = adjacency.has(sourceId) ? [sourceId] : [];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const next of adjacency.get(id) || []) if (!visited.has(next)) queue.push(next);
  }
  return visited;
}

export function validateCompletedHydraulicNetworkVerticalEvidence(packet) {
  const issues = [];
  if (!packet || packet.artifactType !== 'halofire.completed-hydraulic-network-vertical-evidence.v1') {
    return { status: 'blocked', issues: [issue('HYDRAULIC_VERTICAL_SCHEMA_INVALID', 'Completed hydraulic-network vertical evidence schema is invalid.')] };
  }
  const expected = EXPECTED[packet.projectId];
  if (!expected) issues.push(issue('HYDRAULIC_VERTICAL_PROJECT_UNSUPPORTED', `Project ${packet.projectId || 'unknown'} is not a sealed calibration case.`));
  const { receiptSha256, ...draft } = packet;
  if (!SHA256.test(receiptSha256 || '') || jsonSha256(draft) !== receiptSha256 || (expected && receiptSha256 !== expected.receiptSha256)) {
    issues.push(issue('HYDRAULIC_VERTICAL_RECEIPT_MISMATCH', 'The sealed packet receipt does not match its canonical content.'));
  }

  const bindings = Array.isArray(packet.sourceBindings) ? packet.sourceBindings : [];
  const sourceHashes = bindings.map((binding) => binding.sha256);
  const requiredRoles = new Set(['hydraulic-calculation', 'completed-field-plan', 'fabrication-listing']);
  const roles = new Set(bindings.map((binding) => binding.role));
  if (!roles.has('approved-as-built-plan-set') && !roles.has('completed-as-built-plan-set')) requiredRoles.add('completed-as-built-plan-set');
  if (expected && JSON.stringify(sourceHashes) !== JSON.stringify(expected.sourceHashes)) {
    issues.push(issue('HYDRAULIC_VERTICAL_SOURCE_DRIFT', 'Hydraulic, field, as-built, approval, or fabrication source identity changed.'));
  }
  for (const binding of bindings) {
    if (!binding.path || !binding.role || !Number.isInteger(binding.bytes) || binding.bytes <= 0 || !SHA256.test(binding.sha256 || '')) {
      issues.push(issue('HYDRAULIC_VERTICAL_SOURCE_INVALID', `Source binding ${binding.role || 'unknown'} is incomplete.`));
    }
  }
  for (const role of requiredRoles) if (!roles.has(role)) issues.push(issue('HYDRAULIC_VERTICAL_SOURCE_ROLE_MISSING', `Required source role ${role} is missing.`));

  const network = packet.network || {};
  const nodes = Array.isArray(network.nodes) ? network.nodes : [];
  const pipes = Array.isArray(network.pipes) ? network.pipes : [];
  const planMappedNodeIds = Array.isArray(network.planMappedNodeIds) ? network.planMappedNodeIds : [];
  const nodeIds = new Set();
  for (const node of nodes) {
    const valid = Array.isArray(node) && node.length === 3 && typeof node[0] === 'string' && node[0]
      && Number.isFinite(node[1]) && (node[2] === null || (Number.isFinite(node[2]) && node[2] > 0));
    if (!valid || nodeIds.has(node?.[0])) issues.push(issue('HYDRAULIC_VERTICAL_NODE_INVALID', `Hydraulic node ${node?.[0] || 'unknown'} is invalid or duplicated.`));
    else nodeIds.add(node[0]);
  }
  const pipeIds = new Set();
  for (const pipe of pipes) {
    const valid = Array.isArray(pipe) && pipe.length === 4 && Number.isInteger(pipe[0]) && pipe[0] > 0
      && typeof pipe[1] === 'string' && typeof pipe[2] === 'string' && pipe[1] !== pipe[2]
      && nodeIds.has(pipe[1]) && nodeIds.has(pipe[2]) && (pipe[3] === null || (Number.isFinite(pipe[3]) && pipe[3] > 0));
    if (!valid || pipeIds.has(pipe?.[0])) issues.push(issue('HYDRAULIC_VERTICAL_PIPE_INVALID', `Hydraulic pipe ${pipe?.[0] || 'unknown'} is invalid or duplicated.`));
    else pipeIds.add(pipe[0]);
  }
  if (pipes.some((pipe, index) => pipe[0] !== index + 1)) issues.push(issue('HYDRAULIC_VERTICAL_PIPE_SEQUENCE_DRIFT', 'Hydraulic pipe identifiers are not the sealed contiguous sequence.'));
  if (planMappedNodeIds.some((id) => !nodeIds.has(id)) || new Set(planMappedNodeIds).size !== planMappedNodeIds.length) {
    issues.push(issue('HYDRAULIC_VERTICAL_PLAN_NODE_INVALID', 'Plan-mapped hydraulic node identifiers are missing or duplicated.'));
  }
  if (nodes.length && connectedNodeIds(nodes, pipes).size !== nodes.length) issues.push(issue('HYDRAULIC_VERTICAL_TOPOLOGY_DISCONNECTED', 'The hydraulic calculation network is not connected to SRC.'));
  const metrics = nodes.length ? computedMetrics(nodes, pipes, planMappedNodeIds) : null;
  if (!metrics || JSON.stringify(metrics) !== JSON.stringify(network.metrics) || (expected && JSON.stringify(metrics) !== JSON.stringify(expected.metrics))) {
    issues.push(issue('HYDRAULIC_VERTICAL_METRICS_DRIFT', 'Hydraulic node, pipe, active-head, plan-map, or elevation metrics changed.'));
  }
  const networkSha256 = jsonSha256(network);
  if (expected && networkSha256 !== expected.networkSha256) issues.push(issue('HYDRAULIC_VERTICAL_GEOMETRY_DRIFT', 'The sealed node elevations or connected pipe topology changed.'));
  if (packet.hydraulicNetworkVerticalGeometryReady !== true || packet.planNodeCoordinateMappingReady !== false
    || packet.wholeBuildingNetworkElevationReady !== false || packet.exactAsBuiltDeflectorElevationReady !== false
    || packet.fabricationReady !== false || packet.complianceReady !== false) {
    issues.push(issue('HYDRAULIC_VERTICAL_FAIL_CLOSED_STATUS_DRIFT', 'Only hydraulic-calculation vertical geometry may be ready.'));
  }
  return {
    status: issues.length ? 'blocked' : 'passed',
    projectId: packet.projectId,
    projectName: packet.projectName,
    issues,
    metrics,
    receiptSha256,
    networkSha256,
    sourceHashes,
    hydraulicNetworkVerticalGeometryReady: !issues.length,
    planNodeCoordinateMappingReady: false,
    wholeBuildingNetworkElevationReady: false,
    exactAsBuiltDeflectorElevationReady: false,
    fabricationReady: false,
    complianceReady: false,
  };
}

function buildTopologyLayout(nodes, pipes) {
  const adjacency = new Map(nodes.map(([id]) => [id, new Set()]));
  for (const [, fromId, toId] of pipes) {
    adjacency.get(fromId).add(toId);
    adjacency.get(toId).add(fromId);
  }
  const depth = new Map([['SRC', 0]]);
  const queue = ['SRC'];
  while (queue.length) {
    const id = queue.shift();
    for (const next of adjacency.get(id)) {
      if (depth.has(next)) continue;
      depth.set(next, depth.get(id) + 1);
      queue.push(next);
    }
  }
  const byDepth = new Map();
  for (const [id] of nodes) {
    const d = depth.get(id);
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(id);
  }
  const nodeById = new Map(nodes.map((node) => [node[0], node]));
  const points = new Map();
  for (const [d, ids] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    ids.forEach((id, index) => {
      const [, zFt, kFactor] = nodeById.get(id);
      points.set(id, { id, xFt: d * 8, yFt: (index - (ids.length - 1) / 2) * 5, zFt, kFactor, topologyDepth: d });
    });
  }
  return points;
}

function renderElevationSvg(projectName, nodes, pipes) {
  const points = buildTopologyLayout(nodes, pipes);
  const values = [...points.values()];
  const xMax = Math.max(...values.map((point) => point.xFt), 1);
  const zMin = Math.min(...values.map((point) => point.zFt));
  const zMax = Math.max(...values.map((point) => point.zFt));
  const map = (point) => ({ x: 42 + point.xFt / xMax * 916, y: 372 - (point.zFt - zMin) / Math.max(1, zMax - zMin) * 324 });
  const lines = pipes.map(([, fromId, toId]) => {
    const a = map(points.get(fromId)); const b = map(points.get(toId));
    return `<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}"/>`;
  }).join('');
  const marks = values.map((point) => {
    const p = map(point); const active = point.kFactor !== null;
    return `<g data-node-id="${point.id}"><circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${active ? 4 : 2.5}" class="${active ? 'active' : 'node'}"/><title>${point.id} @ ${point.zFt} ft</title></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 410" role="img" aria-label="${projectName} sealed hydraulic network elevation"><style>line{stroke:#38bdf8;stroke-width:1.4}.node{fill:#cbd5e1}.active{fill:#4ade80;stroke:#14532d;stroke-width:1}</style><rect width="1000" height="410" fill="#07111f"/><text x="20" y="24" fill="#e2e8f0" font-family="monospace" font-size="13">${projectName} - hydraulic topology elevation (report Z exact; X topological)</text>${lines}${marks}</svg>`;
}

export function buildCompletedHydraulicNetworkVerticalModel(packet) {
  const validation = validateCompletedHydraulicNetworkVerticalEvidence(packet);
  if (validation.status !== 'passed') return { ...validation, nodes: [], pipes: [], elevationViewSvg: null };
  const points = buildTopologyLayout(packet.network.nodes, packet.network.pipes);
  const nodes = [...points.values()].map((point) => ({ ...point, exactReportElevationReady: true, planCoordinateReady: false }));
  const pointById = new Map(nodes.map((node) => [node.id, node]));
  const pipes = packet.network.pipes.map(([id, fromId, toId, reportedLengthFt]) => {
    const from = pointById.get(fromId); const to = pointById.get(toId);
    return { id, fromId, toId, reportedLengthFt, fromFt: [from.xFt, from.yFt, from.zFt], toFt: [to.xFt, to.yFt, to.zFt], verticalDeltaFt: to.zFt - from.zFt, exactEndpointElevationReady: true, planCoordinateReady: false };
  });
  return {
    ...validation,
    artifactType: 'halofire.completed-hydraulic-network-vertical-model.v1',
    coordinateContract: packet.network.coordinateContract,
    nodes,
    pipes,
    elevationViewSvg: renderElevationSvg(packet.projectName, packet.network.nodes, packet.network.pipes),
  };
}

export function validateCompletedHydraulicNetworkVerticalPortfolio(packets, minimumProjects = 2) {
  const models = (Array.isArray(packets) ? packets : []).map(buildCompletedHydraulicNetworkVerticalModel);
  const projectIds = models.map((model) => model.projectId).filter(Boolean);
  const uniqueProjectIds = new Set(projectIds);
  const issues = models.flatMap((model) => model.issues.map((entry) => ({ ...entry, projectId: model.projectId })));
  if (uniqueProjectIds.size < minimumProjects) issues.push(issue('HYDRAULIC_VERTICAL_PROJECT_COUNT_LOW', `Only ${uniqueProjectIds.size}/${minimumProjects} independent completed projects passed.`));
  if (uniqueProjectIds.size !== projectIds.length) issues.push(issue('HYDRAULIC_VERTICAL_PROJECT_DUPLICATED', 'Completed hydraulic-network project identifiers must be unique.'));
  const readyProjects = models.filter((model) => model.status === 'passed' && model.hydraulicNetworkVerticalGeometryReady).map((model) => model.projectId);
  return {
    status: issues.length ? 'blocked' : 'passed',
    artifactType: 'halofire.completed-hydraulic-network-vertical-portfolio.v1',
    projectCount: uniqueProjectIds.size,
    projects: models,
    featurePromotion: {
      hydraulic_network_vertical_geometry: {
        ready: issues.length === 0 && readyProjects.length >= minimumProjects,
        projectCount: readyProjects.length,
        requiredProjectCount: minimumProjects,
        projects: readyProjects,
      },
    },
    counts: {
      nodes: models.reduce((sum, model) => sum + (model.metrics?.nodeCount || 0), 0),
      pipes: models.reduce((sum, model) => sum + (model.metrics?.pipeCount || 0), 0),
      activeSprinklerNodes: models.reduce((sum, model) => sum + (model.metrics?.activeSprinklerNodeCount || 0), 0),
      planMappedNodes: models.reduce((sum, model) => sum + (model.metrics?.planMappedNodeCount || 0), 0),
    },
    planNodeCoordinateMappingReady: false,
    wholeBuildingNetworkElevationReady: false,
    exactAsBuiltDeflectorElevationReady: false,
    fabricationReady: false,
    complianceReady: false,
    issues,
  };
}
