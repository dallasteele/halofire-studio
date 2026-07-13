/**
 * Seals completed-project pipe edges that join three independent facts:
 * vector plan X/Y, HASS endpoint elevation Z, and HASS hydraulic inside
 * diameter. The result is deliberately not a nominal-size, fabrication, or
 * whole-plan claim.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

const EPSILON = 1e-6;
const SHA256 = /^[0-9a-f]{64}$/;
const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const nodeSchema = z.tuple([z.string().min(1), z.number().finite(), z.number().finite(), z.number().finite()]);
const edgeSchema = z.tuple([
  z.number().int().positive(), z.string().min(1), z.string().min(1), z.number().positive(), z.number().positive(),
  z.number().int().min(2), z.array(pointSchema).min(2),
]);
const sourceSchema = z.object({
  role: z.string().min(1), path: z.string().min(1), bytes: z.number().int().positive(), sha256: z.string().regex(SHA256),
  physicalPages: z.array(z.number().int().positive()).min(1),
}).strict();
const metricsSchema = z.object({
  registeredNodeCount: z.number().int().positive(), registeredEdgeCount: z.number().int().positive(), diameterClassCount: z.number().int().min(2),
  verticalEdgeCount: z.number().int().nonnegative(), maximumLengthResidualFt: z.number().finite().nonnegative(),
}).strict();
const packetSchema = z.object({
  artifactType: z.literal('halofire.completed-hydraulic-sized-3d-edge-registration.v1'),
  projectId: z.string().min(1), projectName: z.string().min(1), verifiedAt: z.string().min(1), sourceBindings: z.array(sourceSchema).min(2),
  registration: z.object({
    sheetId: z.string().min(1), physicalPageNumber: z.number().int().positive(), pageSizePt: z.tuple([z.literal(2592), z.literal(1728)]),
    printedScalePtPerFt: z.number().positive(), scope: z.literal('hydraulically-calculated-on-plan-pipe-edges-only'),
    diameterMeaning: z.literal('HASS hydraulic inside diameter in inches; not nominal fabrication size'),
    nodes: z.array(nodeSchema).min(2), edges: z.array(edgeSchema).min(2), maximumLengthResidualFt: z.number().positive(),
  }).strict(),
  metrics: metricsSchema,
  hydraulicInsideDiameter3dEdgeRegistrationReady: z.literal(true), nominalPipeSizeReady: z.literal(false),
  fullHydraulicPlanRegistrationReady: z.literal(false), fabricationCutLengthReady: z.literal(false),
  wholeBuildingNetworkElevationReady: z.literal(false), exactAsBuiltDeflectorElevationReady: z.literal(false), complianceReady: z.literal(false),
  limitations: z.array(z.string().min(1)).min(1), receiptSha256: z.string().regex(SHA256),
}).strict();

const EXPECTED = Object.freeze({
  'mit-riverside-dugout-h': Object.freeze({
    receiptSha256: '991667877896f372741a6d6c1434f640c1b7c56266975dd4183ec68ed96eb1a6',
    registrationSha256: 'aa9855b5a182c47adc54f514840a7cf14d70f9dc11b4a8bd99af1b0b53a2ddc1',
    sourceHashes: ['c961ffd468c0af1433e93755be4b8b388625824e259f9b52d0b61e44b6792621', 'dbde3554b995d9ceb16d6829d683306e9a60f2dbc9b05ab87a3c60b548c0538c', 'b7a8c3c2faceacba6c41437f773af650cdcc84eddc44cc5a88e1e563ac052207'],
  }),
  'gmr-ambulance-center-payson': Object.freeze({
    receiptSha256: '894c89d0957be73380d8539f5ef2f79289b5d01fcc68cc1afdd38e20a28ff1c7',
    registrationSha256: 'cd335480c061d66aac2c3c9d9645b2025b0ad218b3acce07addf1c0497cc6fb2',
    sourceHashes: ['6abaa4072d5bf7fe7430419cc3af9070078a64438ff5dbb1c61c3d8691f701a6', '44b34e6d75eb9464e2896e1e8ae395c63248da37db6af1f2117c946b4ce5e4c1', 'de6663d8da4f8bfe15998b17b8f972d05071a6457211c59f33357734a4d9989d', '215045621a9f96fc0cd6cb90f6ecc413560cbab622f7eae64a279a077d510cc5'],
  }),
});

const jsonSha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const issue = (code, message) => ({ severity: 'blocking', code, message });
const close = (a, b, tolerance = EPSILON) => Math.abs(a - b) <= tolerance;
const samePoint = (a, b) => close(a[0], b[0]) && close(a[1], b[1]);

function planPolylineLengthFt(points, scale) {
  let lengthPt = 0;
  for (let index = 1; index < points.length; index += 1) lengthPt += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
  return lengthPt / scale;
}

function compute(packet) {
  const nodes = new Map(packet.registration.nodes.map((node) => [node[0], node]));
  const edgeChecks = packet.registration.edges.map(([pipeId, fromId, toId, reportLengthFt, hydraulicInsideDiameterIn, hassPage, routePoints]) => {
    const from = nodes.get(fromId); const to = nodes.get(toId);
    if (!from || !to) return { pipeId, fromId, toId, reportLengthFt, hydraulicInsideDiameterIn, hassPage, residualFt: Infinity, endpointMismatch: true };
    const planLengthFt = planPolylineLengthFt(routePoints, packet.registration.printedScalePtPerFt);
    const verticalLengthFt = planLengthFt <= EPSILON ? Math.abs(to[3] - from[3]) : 0;
    const checkedLengthFt = planLengthFt <= EPSILON ? verticalLengthFt : planLengthFt;
    return {
      pipeId, fromId, toId, reportLengthFt, hydraulicInsideDiameterIn, hassPage, planLengthFt, verticalLengthFt, checkedLengthFt,
      residualFt: Math.abs(checkedLengthFt - reportLengthFt),
      endpointMismatch: !samePoint(routePoints[0], [from[1], from[2]]) || !samePoint(routePoints.at(-1), [to[1], to[2]]),
    };
  });
  const diameterClasses = [...new Set(packet.registration.edges.map((edge) => edge[4]))].sort((a, b) => a - b);
  const metrics = {
    registeredNodeCount: packet.registration.nodes.length, registeredEdgeCount: packet.registration.edges.length,
    diameterClassCount: diameterClasses.length,
    verticalEdgeCount: packet.registration.edges.filter((edge) => {
      const from = nodes.get(edge[1]); const to = nodes.get(edge[2]);
      return from && to && samePoint([from[1], from[2]], [to[1], to[2]]) && !close(from[3], to[3]);
    }).length,
    maximumLengthResidualFt: Math.max(...edgeChecks.map((entry) => entry.residualFt)),
  };
  return { nodes, edgeChecks, diameterClasses, metrics };
}

function metricsEqual(a, b) {
  return a.registeredNodeCount === b.registeredNodeCount && a.registeredEdgeCount === b.registeredEdgeCount
    && a.diameterClassCount === b.diameterClassCount && a.verticalEdgeCount === b.verticalEdgeCount
    && close(a.maximumLengthResidualFt, b.maximumLengthResidualFt);
}

/** Independently validates source identity, edge topology, XYZ binding, diameter semantics, and reported length projection. */
export function validateCompletedHydraulicSized3dRegistration(input) {
  const parsed = packetSchema.safeParse(input);
  if (!parsed.success) return { status: 'blocked', issues: [issue('HYDRAULIC_SIZED_3D_SCHEMA_INVALID', parsed.error.issues[0]?.message || 'Registration schema is invalid.')] };
  const packet = parsed.data; const issues = []; const expected = EXPECTED[packet.projectId];
  if (!expected) issues.push(issue('HYDRAULIC_SIZED_3D_PROJECT_UNSUPPORTED', `Project ${packet.projectId} is not a sealed completed-job calibration.`));
  const { receiptSha256, ...draft } = packet;
  if (jsonSha256(draft) !== receiptSha256 || (expected && expected.receiptSha256 !== receiptSha256)) issues.push(issue('HYDRAULIC_SIZED_3D_RECEIPT_MISMATCH', 'Canonical packet content or its sealed receipt changed.'));
  const registrationSha256 = jsonSha256(packet.registration);
  if (expected && expected.registrationSha256 !== registrationSha256) issues.push(issue('HYDRAULIC_SIZED_3D_GEOMETRY_DRIFT', 'Sealed XYZ anchors, routes, or HASS diameters changed.'));
  const sourceHashes = packet.sourceBindings.map((binding) => binding.sha256);
  if (expected && JSON.stringify(sourceHashes) !== JSON.stringify(expected.sourceHashes)) issues.push(issue('HYDRAULIC_SIZED_3D_SOURCE_DRIFT', 'A completed-project source identity changed.'));
  const roles = new Set(packet.sourceBindings.map((binding) => binding.role));
  if (!roles.has('hydraulic-calculation') || ![...roles].some((role) => role.includes('plan'))) issues.push(issue('HYDRAULIC_SIZED_3D_SOURCE_ROLE_MISSING', 'A HASS calculation and completed plan source are both required.'));

  const nodeIds = packet.registration.nodes.map((node) => node[0]); const edgeIds = packet.registration.edges.map((edge) => edge[0]);
  if (new Set(nodeIds).size !== nodeIds.length) issues.push(issue('HYDRAULIC_SIZED_3D_NODE_DUPLICATED', 'Node identifiers must be unique.'));
  if (new Set(edgeIds).size !== edgeIds.length) issues.push(issue('HYDRAULIC_SIZED_3D_EDGE_DUPLICATED', 'Pipe identifiers must be unique.'));
  for (const [id, x, y] of packet.registration.nodes) if (x < 0 || y < 0 || x > 2592 || y > 1728) issues.push(issue('HYDRAULIC_SIZED_3D_NODE_OUT_OF_BOUNDS', `Node ${id} is outside the sealed sheet.`));
  for (const edge of packet.registration.edges) if (edge[1] === edge[2] || !nodeIds.includes(edge[1]) || !nodeIds.includes(edge[2])) issues.push(issue('HYDRAULIC_SIZED_3D_EDGE_INVALID', `Pipe ${edge[0]} has invalid endpoints.`));

  const computed = compute(packet);
  if (computed.edgeChecks.some((entry) => entry.endpointMismatch)) issues.push(issue('HYDRAULIC_SIZED_3D_ROUTE_ENDPOINT_MISMATCH', 'A vector route does not terminate at its sealed HASS node anchors.'));
  if (computed.edgeChecks.some((entry) => entry.residualFt > packet.registration.maximumLengthResidualFt + EPSILON)) issues.push(issue('HYDRAULIC_SIZED_3D_LENGTH_RESIDUAL_HIGH', 'A plan or vertical length projection exceeds the sealed HASS tolerance.'));
  if (!metricsEqual(computed.metrics, packet.metrics)) issues.push(issue('HYDRAULIC_SIZED_3D_METRICS_DRIFT', 'Independently recomputed registration metrics changed.'));
  if (computed.diameterClasses.length < 2) issues.push(issue('HYDRAULIC_SIZED_3D_DIAMETER_DIVERSITY_LOW', 'At least two HASS hydraulic diameter classes are required per calibration project.'));
  return {
    status: issues.length ? 'blocked' : 'passed', projectId: packet.projectId, projectName: packet.projectName, issues,
    sourceHashes, receiptSha256, registrationSha256, edgeChecks: computed.edgeChecks, diameterClasses: computed.diameterClasses, metrics: computed.metrics,
    hydraulicInsideDiameter3dEdgeRegistrationReady: issues.length === 0,
    nominalPipeSizeReady: false, fullHydraulicPlanRegistrationReady: false, fabricationCutLengthReady: false,
    wholeBuildingNetworkElevationReady: false, exactAsBuiltDeflectorElevationReady: false, complianceReady: false,
  };
}

function projectRoute3d(packet, edge, nodes) {
  const [, , , , , , points] = edge; const from = nodes.get(edge[1]); const to = nodes.get(edge[2]);
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) lengths.push(lengths.at(-1) + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = lengths.at(-1);
  return points.map(([x, y], index) => {
    const fraction = total <= EPSILON ? index / Math.max(1, points.length - 1) : lengths[index] / total;
    return [x / packet.registration.printedScalePtPerFt, (packet.registration.pageSizePt[1] - y) / packet.registration.printedScalePtPerFt, from[3] + (to[3] - from[3]) * fraction];
  });
}

function renderView(packet, modelEdges, axis) {
  const pointList = modelEdges.flatMap((edge) => edge.routePoints3dFt);
  const hIndex = axis === 'plan' ? 0 : axis === 'side' ? 0 : 1; const vIndex = axis === 'plan' ? 1 : 2;
  const minH = Math.min(...pointList.map((point) => point[hIndex])); const maxH = Math.max(...pointList.map((point) => point[hIndex]));
  const minV = Math.min(...pointList.map((point) => point[vIndex])); const maxV = Math.max(...pointList.map((point) => point[vIndex]));
  const x = (value) => 30 + (value - minH) / Math.max(1, maxH - minH) * 540; const y = (value) => 270 - (value - minV) / Math.max(1, maxV - minV) * 230;
  const paths = modelEdges.map((edge) => `<polyline data-pipe-id="${edge.pipeId}" data-hydraulic-inside-diameter-in="${edge.hydraulicInsideDiameterIn}" points="${edge.routePoints3dFt.map((point) => `${x(point[hIndex]).toFixed(2)},${y(point[vIndex]).toFixed(2)}`).join(' ')}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" role="img" aria-label="${packet.projectName} ${axis} hydraulic sized 3D edge view"><style>polyline{fill:none;stroke:#38bdf8;stroke-linecap:round;stroke-width:3}text{fill:#e2e8f0;font:10px monospace}</style><rect width="600" height="300" fill="#07111f"/><text x="18" y="20">${packet.projectName} - ${axis} - HASS inside diameter, not nominal size</text>${paths}</svg>`;
}

/** Builds sheet-scale XYZ routes and three orthographic evidence views. */
export function buildCompletedHydraulicSized3dModel(packet) {
  const validation = validateCompletedHydraulicSized3dRegistration(packet);
  if (validation.status !== 'passed') return { ...validation, nodes: [], edges: [], views: null };
  const nodes = new Map(packet.registration.nodes.map((node) => [node[0], node]));
  const modelNodes = packet.registration.nodes.map(([id, x, y, z]) => ({ id, sourcePointPt: [x, y], point3dFt: [x / packet.registration.printedScalePtPerFt, (1728 - y) / packet.registration.printedScalePtPerFt, z] }));
  const edges = packet.registration.edges.map((edge) => ({
    pipeId: edge[0], fromId: edge[1], toId: edge[2], reportLengthFt: edge[3], hydraulicInsideDiameterIn: edge[4],
    diameterSemantics: 'hydraulic-inside-diameter-not-nominal-size', hassPhysicalPage: edge[5], routePoints3dFt: projectRoute3d(packet, edge, nodes),
  }));
  return {
    ...validation, artifactType: 'halofire.completed-hydraulic-sized-3d-edge-model.v1',
    coordinateContract: 'completed-plan vector X/Y plus HASS report Z plus HASS hydraulic inside diameter for sealed calculated edges',
    nodes: modelNodes, edges,
    views: { planSvg: renderView(packet, edges, 'plan'), sideSvg: renderView(packet, edges, 'side'), endSvg: renderView(packet, edges, 'end') },
  };
}

/** Runs required rejection mutations through the production validator. */
export function verifyHydraulicSized3dAdversarialLoop(packet) {
  const mutations = {
    receiptDriftRejected: (draft) => { draft.receiptSha256 = '0'.repeat(64); },
    sourceDriftRejected: (draft) => { draft.sourceBindings[0].sha256 = '0'.repeat(64); },
    duplicateEdgeRejected: (draft) => { draft.registration.edges[1][0] = draft.registration.edges[0][0]; },
    routeEndpointDriftRejected: (draft) => { draft.registration.edges[0][6][0][0] += draft.registration.printedScalePtPerFt; },
    endpointZDriftRejected: (draft) => { draft.registration.nodes[0][3] += 1; },
    hydraulicDiameterDriftRejected: (draft) => { draft.registration.edges[0][4] += 0.25; },
    nominalSizeSubstitutionRejected: (draft) => { draft.registration.diameterMeaning = 'nominal fabrication size'; },
    reportedLengthDriftRejected: (draft) => { draft.registration.edges[0][3] += 1; },
    fullPlanPromotionRejected: (draft) => { draft.fullHydraulicPlanRegistrationReady = true; },
    fabricationPromotionRejected: (draft) => { draft.fabricationCutLengthReady = true; },
  };
  const results = Object.fromEntries(Object.entries(mutations).map(([name, mutate]) => {
    const draft = structuredClone(packet); mutate(draft); return [name, validateCompletedHydraulicSized3dRegistration(draft).status === 'blocked'];
  }));
  return { status: Object.values(results).every(Boolean) ? 'passed' : 'blocked', ...results };
}

/** Requires independent completed jobs and built-in adversarial rejection before feature promotion. */
export function validateCompletedHydraulicSized3dPortfolio(packets, minimumProjects = 2) {
  const inputs = Array.isArray(packets) ? packets : []; const projects = inputs.map(buildCompletedHydraulicSized3dModel);
  const adversarialLoops = inputs.map((packet) => ({ projectId: packet?.projectId, ...verifyHydraulicSized3dAdversarialLoop(packet) }));
  const ids = projects.map((project) => project.projectId).filter(Boolean); const uniqueIds = new Set(ids); const issues = projects.flatMap((project) => project.issues.map((entry) => ({ ...entry, projectId: project.projectId })));
  if (uniqueIds.size < minimumProjects) issues.push(issue('HYDRAULIC_SIZED_3D_PROJECT_COUNT_LOW', `Only ${uniqueIds.size}/${minimumProjects} independent completed projects passed.`));
  if (uniqueIds.size !== ids.length) issues.push(issue('HYDRAULIC_SIZED_3D_PROJECT_DUPLICATED', 'Completed-project identifiers must be unique.'));
  if (adversarialLoops.some((loop) => loop.status !== 'passed')) issues.push(issue('HYDRAULIC_SIZED_3D_ADVERSARIAL_LOOP_FAILED', 'A built-in rejection mutation escaped the validator.'));
  const readyProjects = projects.filter((project) => project.status === 'passed' && project.hydraulicInsideDiameter3dEdgeRegistrationReady).map((project) => project.projectId);
  return {
    status: issues.length ? 'blocked' : 'passed', artifactType: 'halofire.completed-hydraulic-sized-3d-edge-portfolio.v1', projectCount: uniqueIds.size, projects, adversarialLoops,
    featurePromotion: { hydraulic_inside_diameter_3d_edge_registration: { ready: issues.length === 0 && readyProjects.length >= minimumProjects, projectCount: readyProjects.length, requiredProjectCount: minimumProjects, projects: readyProjects } },
    counts: { registeredNodes: projects.reduce((sum, project) => sum + (project.metrics?.registeredNodeCount || 0), 0), registeredEdges: projects.reduce((sum, project) => sum + (project.metrics?.registeredEdgeCount || 0), 0), verticalEdges: projects.reduce((sum, project) => sum + (project.metrics?.verticalEdgeCount || 0), 0), diameterObservations: projects.reduce((sum, project) => sum + (project.edges?.length || 0), 0) },
    nominalPipeSizeReady: false, fullHydraulicPlanRegistrationReady: false, fabricationCutLengthReady: false,
    wholeBuildingNetworkElevationReady: false, exactAsBuiltDeflectorElevationReady: false, complianceReady: false, issues,
  };
}
