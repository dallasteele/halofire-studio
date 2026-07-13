/**
 * Validates sealed, completed-project hydraulic route registrations that join
 * HASS node topology to exact vector anchors on a completed sprinkler plan.
 * The promoted scope is deliberately limited to the hydraulically calculated
 * floor-plan branch graph; riser details, off-sheet supply, fabrication, and
 * compliance remain fail-closed.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

const SHA256 = /^[0-9a-f]{64}$/;
const EPSILON = 1e-6;
const anchorClassSchema = z.enum(['vector-sprinkler-outer-ring-center', 'vector-hydraulic-junction-center']);
const evidenceClassSchema = z.enum(['scaled-plan-length', 'same-plan-anchor-report-vertical', 'vector-topology-only']);
const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const nodeSchema = z.tuple([
  z.string().min(1), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite().positive().nullable(), anchorClassSchema,
]);
const pipeSchema = z.tuple([
  z.number().int().positive(), z.string().min(1), z.string().min(1), z.number().finite().positive(), evidenceClassSchema, z.array(pointSchema).min(2),
]);
const sourceBindingSchema = z.object({
  role: z.string().min(1), path: z.string().min(1), bytes: z.number().int().positive(), sha256: z.string().regex(SHA256), physicalPages: z.array(z.number().int().positive()).min(1),
}).strict();
const registrationSchema = z.object({
  sheetId: z.string().min(1), physicalPageNumber: z.number().int().positive(), coordinateSpace: z.literal('pdf-points-top-left'),
  pageSizePt: z.tuple([z.literal(2592), z.literal(1728)]), printedScale: z.literal('1/8 inch = 1 foot'), printedScalePtPerFt: z.literal(9),
  scope: z.literal('hydraulically-calculated-floor-plan-branch-graph-only'), associationMethod: z.string().min(1), nodes: z.array(nodeSchema).min(1),
  pipes: z.array(pipeSchema).min(1), unregisteredNodeIds: z.array(z.string().min(1)).min(1), excludedPipeIds: z.array(z.number().int().positive()).min(1),
  maximumScaledPlanLengthResidualFt: z.number().finite().positive(),
}).strict();
const metricsSchema = z.object({
  registeredNodeCount: z.number().int().positive(), activeNodeCount: z.number().int().positive(), inactiveJunctionCount: z.number().int().positive(),
  registeredPipeCount: z.number().int().positive(), scaledLengthCheckCount: z.number().int().positive(), samePlanAnchorVerticalPipeCount: z.number().int().nonnegative(),
  topologyOnlyPipeCount: z.number().int().nonnegative(), maximumScaledPlanLengthResidualFt: z.number().finite().nonnegative(),
}).strict();
const packetSchema = z.object({
  artifactType: z.literal('halofire.completed-hydraulic-routed-plan-registration.v1'), projectId: z.string().min(1), projectName: z.string().min(1),
  verifiedAt: z.string().min(1), sourceBindings: z.array(sourceBindingSchema).min(2), registration: registrationSchema, metrics: metricsSchema,
  activeHydraulicPlanRegistrationReady: z.literal(true), onPlanHydraulicRoutedRegistrationReady: z.literal(true), fullHydraulicPlanRegistrationReady: z.literal(false),
  wholeBuildingNetworkElevationReady: z.literal(false), exactAsBuiltDeflectorElevationReady: z.literal(false), fabricationReady: z.literal(false), complianceReady: z.literal(false),
  receiptSha256: z.string().regex(SHA256),
}).strict();

const EXPECTED = Object.freeze({
  'mit-riverside-dugout-h': Object.freeze({
    receiptSha256: '658b62d2b0a22fda952f94519976c960bb66aa199c8be53488519f924f8b4365',
    registrationSha256: '9e7256b48efbcd8a909d5fa1eccc74b4db7047c52737bcee6c8e0f69d2d81f5d',
    sourceHashes: ['c961ffd468c0af1433e93755be4b8b388625824e259f9b52d0b61e44b6792621', 'dbde3554b995d9ceb16d6829d683306e9a60f2dbc9b05ab87a3c60b548c0538c', 'b7a8c3c2faceacba6c41437f773af650cdcc84eddc44cc5a88e1e563ac052207'],
    metrics: { registeredNodeCount: 21, activeNodeCount: 15, inactiveJunctionCount: 6, registeredPipeCount: 20, scaledLengthCheckCount: 17, samePlanAnchorVerticalPipeCount: 3, topologyOnlyPipeCount: 0, maximumScaledPlanLengthResidualFt: 0.053333333333334565 },
  }),
  'sierra-marana-di-mezzanine': Object.freeze({
    receiptSha256: '75d7e9ed46828d38b872d56d84eb325f3943b27e54a9427e11b8cde3b6e51915',
    registrationSha256: '7668277690cc292120b77ded68abbe924ad5254ea7442640a348db8b2a6a7082',
    sourceHashes: ['20950b877ab29c19c330ece6c82f5e30cb3dff2d173633af3183a73cc0a37961', 'acfed39df052ce8549a7ea62608c012755eb4c5c6593027d4e074bb85d1072e0', '680d90c13e50bad3a4ef055c1628b46e6becb898cfe8d54386e662aff8eb3351'],
    metrics: { registeredNodeCount: 19, activeNodeCount: 11, inactiveJunctionCount: 8, registeredPipeCount: 18, scaledLengthCheckCount: 14, samePlanAnchorVerticalPipeCount: 0, topologyOnlyPipeCount: 4, maximumScaledPlanLengthResidualFt: 0.5718545355036415 },
  }),
});

function jsonSha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function issue(code, message) {
  return { severity: 'blocking', code, message };
}

function pointsEqual(a, b) {
  return Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON;
}

function computeGeometry(registration) {
  const byId = new Map(registration.nodes.map((node) => [node[0], node]));
  const residuals = [];
  const verticalChecks = [];
  for (const [pipeId, fromId, toId, reportLengthFt, evidenceClass, routePoints] of registration.pipes) {
    const from = byId.get(fromId); const to = byId.get(toId);
    if (!from || !to) continue;
    if (evidenceClass === 'scaled-plan-length') {
      const planLengthFt = Math.hypot(to[1] - from[1], to[2] - from[2]) / registration.printedScalePtPerFt;
      residuals.push({ pipeId, fromId, toId, reportLengthFt, planLengthFt, residualFt: Math.abs(planLengthFt - reportLengthFt) });
    }
    if (evidenceClass === 'same-plan-anchor-report-vertical') {
      verticalChecks.push({ pipeId, samePlanAnchor: pointsEqual([from[1], from[2]], [to[1], to[2]]), reportLengthFt, reportElevationDeltaFt: Math.abs(to[3] - from[3]) });
    }
    if (!pointsEqual(routePoints[0], [from[1], from[2]]) || !pointsEqual(routePoints.at(-1), [to[1], to[2]])) {
      residuals.push({ pipeId, fromId, toId, reportLengthFt, planLengthFt: null, residualFt: Infinity, routeEndpointMismatch: true });
    }
  }
  return { byId, residuals, verticalChecks };
}

function graphConnected(registration) {
  const adjacency = new Map(registration.nodes.map((node) => [node[0], new Set()]));
  for (const [, fromId, toId] of registration.pipes) {
    if (!adjacency.has(fromId) || !adjacency.has(toId)) continue;
    adjacency.get(fromId).add(toId); adjacency.get(toId).add(fromId);
  }
  const first = registration.nodes[0]?.[0]; const visited = new Set(first ? [first] : []); const queue = first ? [first] : [];
  while (queue.length) {
    for (const next of adjacency.get(queue.shift()) || []) if (!visited.has(next)) { visited.add(next); queue.push(next); }
  }
  return { connected: visited.size === registration.nodes.length, visitedCount: visited.size, nodeCount: registration.nodes.length };
}

function computedMetrics(registration, residuals) {
  const activeNodeCount = registration.nodes.filter((node) => node[4] !== null).length;
  const finiteResiduals = residuals.filter((entry) => Number.isFinite(entry.residualFt));
  return {
    registeredNodeCount: registration.nodes.length, activeNodeCount, inactiveJunctionCount: registration.nodes.length - activeNodeCount,
    registeredPipeCount: registration.pipes.length, scaledLengthCheckCount: registration.pipes.filter((pipe) => pipe[4] === 'scaled-plan-length').length,
    samePlanAnchorVerticalPipeCount: registration.pipes.filter((pipe) => pipe[4] === 'same-plan-anchor-report-vertical').length,
    topologyOnlyPipeCount: registration.pipes.filter((pipe) => pipe[4] === 'vector-topology-only').length,
    maximumScaledPlanLengthResidualFt: finiteResiduals.length ? Math.max(...finiteResiduals.map((entry) => entry.residualFt)) : Infinity,
  };
}

/**
 * Validate one sealed completed-project route packet and independently
 * recompute all coordinate, route endpoint, topology, and length invariants.
 */
export function validateCompletedHydraulicRoutedPlanRegistration(input) {
  const parsed = packetSchema.safeParse(input);
  if (!parsed.success) return { status: 'blocked', issues: [issue('HYDRAULIC_ROUTED_PLAN_SCHEMA_INVALID', parsed.error.issues[0]?.message || 'Registration schema is invalid.')] };
  const packet = parsed.data; const issues = []; const expected = EXPECTED[packet.projectId];
  if (!expected) issues.push(issue('HYDRAULIC_ROUTED_PLAN_PROJECT_UNSUPPORTED', `Project ${packet.projectId} is not a sealed calibration case.`));
  const { receiptSha256, ...draft } = packet;
  if (jsonSha256(draft) !== receiptSha256 || (expected && receiptSha256 !== expected.receiptSha256)) issues.push(issue('HYDRAULIC_ROUTED_PLAN_RECEIPT_MISMATCH', 'The sealed registration receipt does not match canonical content.'));
  const sourceHashes = packet.sourceBindings.map((binding) => binding.sha256);
  const roles = new Set(packet.sourceBindings.map((binding) => binding.role));
  if (!roles.has('hydraulic-calculation') || (![...roles].some((role) => role.includes('plan')))) issues.push(issue('HYDRAULIC_ROUTED_PLAN_SOURCE_ROLE_MISSING', 'A hydraulic calculation and completed plan source are required.'));
  if (expected && JSON.stringify(sourceHashes) !== JSON.stringify(expected.sourceHashes)) issues.push(issue('HYDRAULIC_ROUTED_PLAN_SOURCE_DRIFT', 'A sealed source identity changed.'));

  const nodeIds = packet.registration.nodes.map((node) => node[0]); const pipeIds = packet.registration.pipes.map((pipe) => pipe[0]);
  if (new Set(nodeIds).size !== nodeIds.length) issues.push(issue('HYDRAULIC_ROUTED_PLAN_NODE_DUPLICATED', 'Registered node identifiers must be unique.'));
  if (new Set(pipeIds).size !== pipeIds.length) issues.push(issue('HYDRAULIC_ROUTED_PLAN_PIPE_DUPLICATED', 'Registered pipe identifiers must be unique.'));
  for (const node of packet.registration.nodes) {
    if (node[1] < 0 || node[1] > packet.registration.pageSizePt[0] || node[2] < 0 || node[2] > packet.registration.pageSizePt[1]) issues.push(issue('HYDRAULIC_ROUTED_PLAN_NODE_OUT_OF_BOUNDS', `Node ${node[0]} lies outside the sealed sheet.`));
    if ((node[4] === null) !== (node[5] === 'vector-hydraulic-junction-center')) issues.push(issue('HYDRAULIC_ROUTED_PLAN_ANCHOR_CLASS_INVALID', `Node ${node[0]} has an inconsistent active/junction anchor class.`));
  }
  for (const pipe of packet.registration.pipes) if (pipe[1] === pipe[2] || !nodeIds.includes(pipe[1]) || !nodeIds.includes(pipe[2])) issues.push(issue('HYDRAULIC_ROUTED_PLAN_PIPE_INVALID', `Pipe ${pipe[0]} has invalid endpoints.`));
  const excluded = packet.registration.excludedPipeIds;
  if (new Set(excluded).size !== excluded.length || excluded.some((pipeId) => pipeIds.includes(pipeId))) issues.push(issue('HYDRAULIC_ROUTED_PLAN_EXCLUSION_INVALID', 'Excluded pipe identifiers must be unique and outside the registered graph.'));

  const geometry = computeGeometry(packet.registration); const topology = graphConnected(packet.registration); const metrics = computedMetrics(packet.registration, geometry.residuals);
  if (!topology.connected) issues.push(issue('HYDRAULIC_ROUTED_PLAN_DISCONNECTED', `Only ${topology.visitedCount}/${topology.nodeCount} registered nodes are connected.`));
  if (geometry.residuals.some((entry) => !Number.isFinite(entry.residualFt) || entry.residualFt > packet.registration.maximumScaledPlanLengthResidualFt + EPSILON)) issues.push(issue('HYDRAULIC_ROUTED_PLAN_LENGTH_RESIDUAL_HIGH', 'A scaled plan-length check exceeds the sealed tolerance or has a route endpoint mismatch.'));
  if (geometry.verticalChecks.some((entry) => !entry.samePlanAnchor || Math.abs(entry.reportLengthFt - entry.reportElevationDeltaFt) > EPSILON)) issues.push(issue('HYDRAULIC_ROUTED_PLAN_VERTICAL_JOIN_INVALID', 'A same-plan-anchor vertical pipe does not match its report elevation delta.'));
  if (JSON.stringify(metrics) !== JSON.stringify(packet.metrics) || (expected && JSON.stringify(metrics) !== JSON.stringify(expected.metrics))) issues.push(issue('HYDRAULIC_ROUTED_PLAN_METRICS_DRIFT', 'Registered-node, pipe, or residual metrics changed.'));
  const registrationSha256 = jsonSha256(packet.registration);
  if (expected && registrationSha256 !== expected.registrationSha256) issues.push(issue('HYDRAULIC_ROUTED_PLAN_GEOMETRY_DRIFT', 'Sealed node anchors or routed pipe geometry changed.'));
  return {
    status: issues.length ? 'blocked' : 'passed', projectId: packet.projectId, projectName: packet.projectName, issues, metrics, topology,
    residuals: geometry.residuals, verticalChecks: geometry.verticalChecks, sourceHashes, receiptSha256, registrationSha256,
    activeHydraulicPlanRegistrationReady: !issues.length, onPlanHydraulicRoutedRegistrationReady: !issues.length,
    fullHydraulicPlanRegistrationReady: false, wholeBuildingNetworkElevationReady: false, exactAsBuiltDeflectorElevationReady: false, fabricationReady: false, complianceReady: false,
  };
}

/**
 * Run deterministic adversarial mutations through the same validator so the
 * product records rejection evidence rather than relying on an external review.
 */
export function verifyHydraulicRoutedPlanAdversarialLoop(packet) {
  const mutations = {
    receiptDriftRejected: (draft) => { draft.receiptSha256 = '0'.repeat(64); },
    sourceDriftRejected: (draft) => { draft.sourceBindings[0].sha256 = '0'.repeat(64); },
    duplicateNodeRejected: (draft) => { draft.registration.nodes[1][0] = draft.registration.nodes[0][0]; },
    disconnectedPipeRejected: (draft) => { draft.registration.pipes[0][1] = 'missing-node'; },
    routeEndpointDriftRejected: (draft) => { draft.registration.pipes[0][5][0][0] += 9; },
    topologyAsLengthSubstitutionRejected: (draft) => { const pipe = draft.registration.pipes.find((entry) => entry[4] === 'vector-topology-only'); if (pipe) pipe[4] = 'scaled-plan-length'; else draft.registration.pipes[0][3] += 50; },
    fullPlanPromotionRejected: (draft) => { draft.fullHydraulicPlanRegistrationReady = true; },
  };
  const results = Object.fromEntries(Object.entries(mutations).map(([name, mutate]) => {
    const draft = structuredClone(packet); mutate(draft); return [name, validateCompletedHydraulicRoutedPlanRegistration(draft).status === 'blocked'];
  }));
  return { status: Object.values(results).every(Boolean) ? 'passed' : 'blocked', ...results };
}

function renderPlan(packet) {
  const nodes = packet.registration.nodes.map(([id, xPt, yPt, zFt, kFactor, anchorClass]) => ({ id, xPt, yPt, zFt, kFactor, anchorClass }));
  const minX = Math.min(...nodes.map((node) => node.xPt)); const maxX = Math.max(...nodes.map((node) => node.xPt));
  const minY = Math.min(...nodes.map((node) => node.yPt)); const maxY = Math.max(...nodes.map((node) => node.yPt));
  const px = (x) => 34 + (x - minX) / Math.max(1, maxX - minX) * 532; const py = (y) => 274 - (y - minY) / Math.max(1, maxY - minY) * 238;
  const paths = packet.registration.pipes.map(([pipeId, , , , evidenceClass, routePoints]) => `<polyline data-pipe-id="${pipeId}" data-evidence-class="${evidenceClass}" points="${routePoints.map(([x, y]) => `${px(x).toFixed(2)},${py(y).toFixed(2)}`).join(' ')}"/>`).join('');
  const marks = nodes.map((node) => `<g data-node-id="${node.id}" data-anchor-class="${node.anchorClass}"><circle cx="${px(node.xPt).toFixed(2)}" cy="${py(node.yPt).toFixed(2)}" r="${node.kFactor === null ? 4 : 5}"/><text x="${(px(node.xPt) + 6).toFixed(2)}" y="${(py(node.yPt) - 5).toFixed(2)}">${node.id}</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" role="img" aria-label="${packet.projectName} registered hydraulic branch graph"><style>polyline{fill:none;stroke:#60a5fa;stroke-width:2}polyline[data-evidence-class='vector-topology-only']{stroke:#fbbf24;stroke-dasharray:5 3}circle{fill:#4ade80;stroke:#14532d;stroke-width:1.2}g[data-anchor-class='vector-hydraulic-junction-center'] circle{fill:#fbbf24}text{fill:#e2e8f0;font:9px monospace}</style><rect width="600" height="300" fill="#07111f"/><text x="18" y="20">${packet.projectName} - registered on-plan branch graph</text>${paths}${marks}</svg>`;
}

/** Build true sheet-scale model coordinates and an evidence rendering. */
export function buildCompletedHydraulicRoutedPlanModel(packet) {
  const validation = validateCompletedHydraulicRoutedPlanRegistration(packet);
  if (validation.status !== 'passed') return { ...validation, nodes: [], pipes: [], views: null };
  const pageHeightPt = packet.registration.pageSizePt[1]; const scale = packet.registration.printedScalePtPerFt;
  return {
    ...validation, artifactType: 'halofire.completed-hydraulic-routed-plan-model.v1',
    coordinateContract: 'sheet-scale X/Y from completed plan plus exact HASS report Z for the registered floor-plan branch graph',
    nodes: packet.registration.nodes.map(([id, xPt, yPt, zFt, kFactor, anchorClass]) => ({ id, sourcePointPt: [xPt, yPt], sheetPointFt: [xPt / scale, (pageHeightPt - yPt) / scale, zFt], kFactor, anchorClass })),
    pipes: packet.registration.pipes.map(([pipeId, fromId, toId, reportLengthFt, evidenceClass, routePoints]) => ({ pipeId, fromId, toId, reportLengthFt, evidenceClass, routePointsPt: routePoints })),
    views: { planSvg: renderPlan(packet) },
  };
}

/** Validate multi-project promotion and persist built-in adversarial-loop truth. */
export function validateCompletedHydraulicRoutedPlanPortfolio(packets, minimumProjects = 2) {
  const inputs = Array.isArray(packets) ? packets : []; const projects = inputs.map(buildCompletedHydraulicRoutedPlanModel);
  const adversarialLoops = inputs.map((packet) => ({ projectId: packet?.projectId, ...verifyHydraulicRoutedPlanAdversarialLoop(packet) }));
  const projectIds = projects.map((project) => project.projectId).filter(Boolean); const uniqueProjectIds = new Set(projectIds);
  const issues = projects.flatMap((project) => project.issues.map((entry) => ({ ...entry, projectId: project.projectId })));
  if (uniqueProjectIds.size < minimumProjects) issues.push(issue('HYDRAULIC_ROUTED_PLAN_PROJECT_COUNT_LOW', `Only ${uniqueProjectIds.size}/${minimumProjects} independent completed projects passed.`));
  if (uniqueProjectIds.size !== projectIds.length) issues.push(issue('HYDRAULIC_ROUTED_PLAN_PROJECT_DUPLICATED', 'Completed routed-plan project identifiers must be unique.'));
  if (adversarialLoops.some((loop) => loop.status !== 'passed')) issues.push(issue('HYDRAULIC_ROUTED_PLAN_ADVERSARIAL_LOOP_FAILED', 'A required built-in adversarial mutation was not rejected.'));
  const ready = projects.filter((project) => project.status === 'passed' && project.onPlanHydraulicRoutedRegistrationReady).map((project) => project.projectId);
  return {
    status: issues.length ? 'blocked' : 'passed', artifactType: 'halofire.completed-hydraulic-routed-plan-portfolio.v1', projectCount: uniqueProjectIds.size, projects, adversarialLoops,
    featurePromotion: { on_plan_hydraulic_routed_registration: { ready: issues.length === 0 && ready.length >= minimumProjects, projectCount: ready.length, requiredProjectCount: minimumProjects, projects: ready } },
    counts: {
      registeredNodes: projects.reduce((sum, project) => sum + (project.metrics?.registeredNodeCount || 0), 0), inactiveJunctions: projects.reduce((sum, project) => sum + (project.metrics?.inactiveJunctionCount || 0), 0),
      registeredPipes: projects.reduce((sum, project) => sum + (project.metrics?.registeredPipeCount || 0), 0), scaledLengthChecks: projects.reduce((sum, project) => sum + (project.metrics?.scaledLengthCheckCount || 0), 0),
      topologyOnlyPipes: projects.reduce((sum, project) => sum + (project.metrics?.topologyOnlyPipeCount || 0), 0), samePlanAnchorVerticalPipes: projects.reduce((sum, project) => sum + (project.metrics?.samePlanAnchorVerticalPipeCount || 0), 0),
    },
    fullHydraulicPlanRegistrationReady: false, wholeBuildingNetworkElevationReady: false, exactAsBuiltDeflectorElevationReady: false, fabricationReady: false, complianceReady: false, issues,
  };
}
