import { createHash } from 'node:crypto';

const SHA256 = /^[0-9a-f]{64}$/;
const EXPECTED = Object.freeze({
  'mit-riverside-dugout-h': Object.freeze({
    receiptSha256: 'f55c6805791595fde04307a89a1eb8a3d3e9ac369938eb17e6bdb8f2bd574e8f',
    registrationSha256: 'f174cc7113053e7002d493ddb1aa05236380f547971670033a78df7cbb20603b',
    sourceHashes: ['c961ffd468c0af1433e93755be4b8b388625824e259f9b52d0b61e44b6792621', 'dbde3554b995d9ceb16d6829d683306e9a60f2dbc9b05ab87a3c60b548c0538c', 'b7a8c3c2faceacba6c41437f773af650cdcc84eddc44cc5a88e1e563ac052207'],
    metrics: { mappedActiveNodeCount: 15, minimumElevationFt: 9, maximumElevationFt: 12, distinctElevationCount: 3, runCheckCount: 12 },
  }),
  'sierra-marana-di-mezzanine': Object.freeze({
    receiptSha256: 'c17c825ffdc8aaced3b354ae2bdcef1753ead5d02ae66afb1461e6c3507f17e3',
    registrationSha256: 'a2d48761e9eab9b82a8e65a70be98628f8f355d33ba8edbacb6e4215e336c668',
    sourceHashes: ['20950b877ab29c19c330ece6c82f5e30cb3dff2d173633af3183a73cc0a37961', 'acfed39df052ce8549a7ea62608c012755eb4c5c6593027d4e074bb85d1072e0', '680d90c13e50bad3a4ef055c1628b46e6becb898cfe8d54386e662aff8eb3351'],
    metrics: { mappedActiveNodeCount: 11, minimumElevationFt: 9.5, maximumElevationFt: 9.5, distinctElevationCount: 1, runCheckCount: 7 },
  }),
});

function jsonSha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function issue(code, message) {
  return { severity: 'blocking', code, message };
}

function computedMetrics(nodes, runs) {
  const z = nodes.map((node) => node[3]);
  return {
    mappedActiveNodeCount: nodes.length,
    minimumElevationFt: Math.min(...z),
    maximumElevationFt: Math.max(...z),
    distinctElevationCount: new Set(z).size,
    runCheckCount: runs.length,
  };
}

function planRunResiduals(registration) {
  const scale = registration.printedScalePtPerFt;
  const byId = new Map(registration.activeNodes.map((node) => [node[0], node]));
  return registration.activeRunChecks.map(([fromId, toId, reportLengthFt]) => {
    const from = byId.get(fromId); const to = byId.get(toId);
    if (!from || !to) return { fromId, toId, reportLengthFt, planChordFt: null, residualFt: Infinity };
    const planChordFt = Math.hypot(to[1] - from[1], to[2] - from[2]) / scale;
    return { fromId, toId, reportLengthFt, planChordFt, residualFt: Math.abs(planChordFt - reportLengthFt) };
  });
}

export function validateCompletedActiveHydraulicPlanRegistration(packet) {
  const issues = [];
  if (!packet || packet.artifactType !== 'halofire.completed-active-hydraulic-plan-registration.v1') {
    return { status: 'blocked', issues: [issue('ACTIVE_HYDRAULIC_PLAN_SCHEMA_INVALID', 'Completed active-hydraulic plan registration schema is invalid.')] };
  }
  const expected = EXPECTED[packet.projectId];
  if (!expected) issues.push(issue('ACTIVE_HYDRAULIC_PLAN_PROJECT_UNSUPPORTED', `Project ${packet.projectId || 'unknown'} is not a sealed calibration case.`));
  const { receiptSha256, ...draft } = packet;
  if (!SHA256.test(receiptSha256 || '') || jsonSha256(draft) !== receiptSha256 || (expected && receiptSha256 !== expected.receiptSha256)) {
    issues.push(issue('ACTIVE_HYDRAULIC_PLAN_RECEIPT_MISMATCH', 'The sealed registration receipt does not match its canonical content.'));
  }

  const bindings = Array.isArray(packet.sourceBindings) ? packet.sourceBindings : [];
  const sourceHashes = bindings.map((binding) => binding.sha256);
  const roles = new Set(bindings.map((binding) => binding.role));
  if (!roles.has('hydraulic-calculation') || (!roles.has('completed-field-plan') && !roles.has('completed-as-built-plan-set'))) {
    issues.push(issue('ACTIVE_HYDRAULIC_PLAN_SOURCE_ROLE_MISSING', 'A hydraulic calculation and a completed plan source are required.'));
  }
  if (expected && JSON.stringify(sourceHashes) !== JSON.stringify(expected.sourceHashes)) {
    issues.push(issue('ACTIVE_HYDRAULIC_PLAN_SOURCE_DRIFT', 'Hydraulic, completed-plan, or approval source identity changed.'));
  }
  for (const binding of bindings) {
    if (!binding.path || !binding.role || !Number.isInteger(binding.bytes) || binding.bytes <= 0 || !SHA256.test(binding.sha256 || '')) {
      issues.push(issue('ACTIVE_HYDRAULIC_PLAN_SOURCE_INVALID', `Source binding ${binding.role || 'unknown'} is incomplete.`));
    }
  }

  const registration = packet.registration || {};
  const nodes = Array.isArray(registration.activeNodes) ? registration.activeNodes : [];
  const runs = Array.isArray(registration.activeRunChecks) ? registration.activeRunChecks : [];
  if (registration.coordinateSpace !== 'pdf-points-top-left' || registration.printedScalePtPerFt !== 9
    || !Array.isArray(registration.pageSizePt) || registration.pageSizePt[0] !== 2592 || registration.pageSizePt[1] !== 1728
    || registration.anchorClass !== 'vector-sprinkler-outer-ring-center') {
    issues.push(issue('ACTIVE_HYDRAULIC_PLAN_COORDINATE_CONTRACT_DRIFT', 'The sealed PDF coordinate, scale, page, or vector-anchor contract changed.'));
  }
  const ids = new Set();
  for (const node of nodes) {
    const valid = Array.isArray(node) && node.length === 5 && typeof node[0] === 'string' && node[0]
      && Number.isFinite(node[1]) && node[1] >= 0 && node[1] <= registration.pageSizePt?.[0]
      && Number.isFinite(node[2]) && node[2] >= 0 && node[2] <= registration.pageSizePt?.[1]
      && Number.isFinite(node[3]) && Number.isFinite(node[4]) && node[4] > 0;
    if (!valid || ids.has(node?.[0])) issues.push(issue('ACTIVE_HYDRAULIC_PLAN_NODE_INVALID', `Active hydraulic node ${node?.[0] || 'unknown'} is invalid or duplicated.`));
    else ids.add(node[0]);
  }
  for (const run of runs) {
    const valid = Array.isArray(run) && run.length === 3 && ids.has(run[0]) && ids.has(run[1]) && run[0] !== run[1]
      && Number.isFinite(run[2]) && run[2] > 0;
    if (!valid) issues.push(issue('ACTIVE_HYDRAULIC_PLAN_RUN_INVALID', `Active hydraulic run ${run?.[0] || 'unknown'}-${run?.[1] || 'unknown'} is invalid.`));
  }
  const residuals = nodes.length && Number.isFinite(registration.printedScalePtPerFt) ? planRunResiduals(registration) : [];
  const maxResidualFt = residuals.length ? Math.max(...residuals.map((entry) => entry.residualFt)) : Infinity;
  if (!Number.isFinite(registration.maximumPlanToReportRunResidualFt) || maxResidualFt > registration.maximumPlanToReportRunResidualFt + 1e-9) {
    issues.push(issue('ACTIVE_HYDRAULIC_PLAN_RUN_RESIDUAL_HIGH', 'Plan vector chords do not satisfy the sealed HASS run-length cross-check tolerance.'));
  }
  const metrics = nodes.length ? computedMetrics(nodes, runs) : null;
  if (!metrics || JSON.stringify(metrics) !== JSON.stringify(packet.metrics) || (expected && JSON.stringify(metrics) !== JSON.stringify(expected.metrics))) {
    issues.push(issue('ACTIVE_HYDRAULIC_PLAN_METRICS_DRIFT', 'Mapped active-node, elevation, or run-check metrics changed.'));
  }
  const registrationSha256 = jsonSha256(registration);
  if (expected && registrationSha256 !== expected.registrationSha256) {
    issues.push(issue('ACTIVE_HYDRAULIC_PLAN_GEOMETRY_DRIFT', 'The sealed active-node plan coordinates or report elevations changed.'));
  }
  if (packet.activeHydraulicPlanRegistrationReady !== true || packet.fullHydraulicPlanRegistrationReady !== false
    || packet.wholeBuildingNetworkElevationReady !== false || packet.exactAsBuiltDeflectorElevationReady !== false
    || packet.fabricationReady !== false || packet.complianceReady !== false) {
    issues.push(issue('ACTIVE_HYDRAULIC_PLAN_FAIL_CLOSED_STATUS_DRIFT', 'Only active hydraulic sprinkler plan registration may be ready.'));
  }
  return {
    status: issues.length ? 'blocked' : 'passed', projectId: packet.projectId, projectName: packet.projectName,
    issues, metrics, residuals, maxResidualFt, receiptSha256, registrationSha256, sourceHashes,
    activeHydraulicPlanRegistrationReady: !issues.length,
    fullHydraulicPlanRegistrationReady: false, wholeBuildingNetworkElevationReady: false,
    exactAsBuiltDeflectorElevationReady: false, fabricationReady: false, complianceReady: false,
  };
}

function renderViews(packet) {
  const nodes = packet.registration.activeNodes.map(([id, xPt, yPt, zFt, kFactor]) => ({ id, xPt, yPt, zFt, kFactor }));
  const minX = Math.min(...nodes.map((node) => node.xPt)); const maxX = Math.max(...nodes.map((node) => node.xPt));
  const minY = Math.min(...nodes.map((node) => node.yPt)); const maxY = Math.max(...nodes.map((node) => node.yPt));
  const minZ = Math.min(...nodes.map((node) => node.zFt)); const maxZ = Math.max(...nodes.map((node) => node.zFt));
  const px = (x) => 34 + (x - minX) / Math.max(1, maxX - minX) * 532;
  const py = (y) => 274 - (y - minY) / Math.max(1, maxY - minY) * 238;
  const pz = (z) => 274 - (z - minZ) / Math.max(1, maxZ - minZ) * 238;
  const marks = nodes.map((node) => `<g data-node-id="${node.id}"><circle cx="${px(node.xPt).toFixed(2)}" cy="${py(node.yPt).toFixed(2)}" r="5"/><text x="${(px(node.xPt) + 7).toFixed(2)}" y="${(py(node.yPt) - 5).toFixed(2)}">${node.id}</text></g>`).join('');
  const elevationMarks = nodes.map((node, index) => `<g data-node-id="${node.id}"><circle cx="${(34 + index / Math.max(1, nodes.length - 1) * 532).toFixed(2)}" cy="${pz(node.zFt).toFixed(2)}" r="5"/><title>${node.id} @ ${node.zFt} ft</title></g>`).join('');
  const style = '<style>circle{fill:#4ade80;stroke:#14532d;stroke-width:1.3}text{fill:#e2e8f0;font:9px monospace}</style><rect width="600" height="300" fill="#07111f"/>';
  return {
    planSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" role="img" aria-label="${packet.projectName} registered active hydraulic sprinkler plan">${style}<text x="18" y="20">${packet.projectName} - exact plan anchors</text>${marks}</svg>`,
    elevationSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" role="img" aria-label="${packet.projectName} registered active hydraulic sprinkler elevation">${style}<text x="18" y="20">${packet.projectName} - exact HASS Z</text>${elevationMarks}</svg>`,
  };
}

export function buildCompletedActiveHydraulicPlanModel(packet) {
  const validation = validateCompletedActiveHydraulicPlanRegistration(packet);
  if (validation.status !== 'passed') return { ...validation, nodes: [], views: null };
  const [pageWidthPt, pageHeightPt] = packet.registration.pageSizePt;
  const scale = packet.registration.printedScalePtPerFt;
  return {
    ...validation, artifactType: 'halofire.completed-active-hydraulic-plan-model.v1',
    coordinateContract: 'sheet-scale X/Y from completed plan plus exact HASS report Z; active sprinkler nodes only',
    nodes: packet.registration.activeNodes.map(([id, xPt, yPt, zFt, kFactor]) => ({ id, sourcePointPt: [xPt, yPt], sheetPointFt: [xPt / scale, (pageHeightPt - yPt) / scale, zFt], kFactor, exactPlanAnchorReady: true, exactReportElevationReady: true })),
    pageSizeFt: [pageWidthPt / scale, pageHeightPt / scale], views: renderViews(packet),
  };
}

export function validateCompletedActiveHydraulicPlanPortfolio(packets, minimumProjects = 2) {
  const projects = (Array.isArray(packets) ? packets : []).map(buildCompletedActiveHydraulicPlanModel);
  const projectIds = projects.map((project) => project.projectId).filter(Boolean);
  const uniqueProjectIds = new Set(projectIds);
  const issues = projects.flatMap((project) => project.issues.map((entry) => ({ ...entry, projectId: project.projectId })));
  if (uniqueProjectIds.size < minimumProjects) issues.push(issue('ACTIVE_HYDRAULIC_PLAN_PROJECT_COUNT_LOW', `Only ${uniqueProjectIds.size}/${minimumProjects} independent completed projects passed.`));
  if (uniqueProjectIds.size !== projectIds.length) issues.push(issue('ACTIVE_HYDRAULIC_PLAN_PROJECT_DUPLICATED', 'Completed active-hydraulic plan project identifiers must be unique.'));
  const ready = projects.filter((project) => project.status === 'passed' && project.activeHydraulicPlanRegistrationReady).map((project) => project.projectId);
  return {
    status: issues.length ? 'blocked' : 'passed', artifactType: 'halofire.completed-active-hydraulic-plan-portfolio.v1',
    projectCount: uniqueProjectIds.size, projects,
    featurePromotion: { active_hydraulic_sprinkler_plan_registration: { ready: issues.length === 0 && ready.length >= minimumProjects, projectCount: ready.length, requiredProjectCount: minimumProjects, projects: ready } },
    counts: { activeSprinklerNodes: projects.reduce((sum, project) => sum + (project.metrics?.mappedActiveNodeCount || 0), 0), runChecks: projects.reduce((sum, project) => sum + (project.metrics?.runCheckCount || 0), 0) },
    fullHydraulicPlanRegistrationReady: false, wholeBuildingNetworkElevationReady: false,
    exactAsBuiltDeflectorElevationReady: false, fabricationReady: false, complianceReady: false, issues,
  };
}
