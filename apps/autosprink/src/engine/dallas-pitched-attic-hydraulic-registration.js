/**
 * Registers the reviewed Dallas attic hydraulic calculation to the matching
 * reviewed/as-built FP-1.4 remote-area geometry. The completed job is a
 * calibration reference: mapped active heads and branch sizes are verified,
 * while unregistered network geometry and generated-design compliance remain
 * fail-closed.
 */
import { z } from 'zod';
import { sha256Hex } from './elevation-datums.js';

const SHA256 = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const close = (left, right, tolerance = 1e-8) => Math.abs(left - right) <= tolerance;
const sourceSchema = z.object({
  role: z.enum(['reviewed-hydraulic-calculation', 'reviewed-sprinkler-plan-set', 'completed-as-built-plan-set']),
  path: z.string().min(1), bytes: z.number().int().positive(), sha256: z.string().regex(SHA256), physicalPages: z.array(z.number().int().positive()).min(1),
}).strict();
const headSchema = z.object({
  nodeId: z.enum(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9']),
  headFamily: z.enum(['TYCO-TY3180-ATTIC-BB1', 'TYCO-TY3183-ATTIC-SD1']), planPointPt: z.tuple([z.number().finite(), z.number().finite()]),
  elevationFt: z.number().positive(), kFactor: z.literal(5.6), pressurePsi: z.number().positive(), actualFlowGpm: z.number().positive(),
  designDensityGpmPerSqFt: z.literal(0.1), coverageSqFt: z.literal(250), requiredPressurePsi: z.literal(20),
}).strict();
const pipeSchema = z.object({
  id: z.number().int().positive(), fromNodeId: z.string().min(1), toNodeId: z.string().min(1), planLengthFt: z.number().positive(),
  reportLengthFt: z.number().positive(), nominalDiameterIn: z.literal(2), actualInsideDiameterIn: z.literal(2.157),
  planSizeText: z.literal('2 inch'), matchMode: z.literal('scaled-plan-centerline-plus-hydraulic-report'),
}).strict();
const packetSchema = z.object({
  artifactType: z.literal('halofire.dallas-pitched-attic-hydraulic-registration.v1'), projectId: z.literal('dallas-temple-pitched-attic'),
  projectName: z.literal('TCOJC Temple - Dallas TX'), verifiedAt: z.string().min(1), sourceBindings: z.array(sourceSchema).length(3),
  upstreamReceipts: z.object({ dallasPitchedFabricationMapping: z.string().regex(SHA256), pitchedRoofCrossProjectEvidence: z.string().regex(SHA256) }).strict(),
  plan: z.object({
    sheetId: z.literal('FP-1.4'), physicalPageNumber: z.literal(5), pageSizePt: z.tuple([z.literal(3024), z.literal(2160)]),
    printedScale: z.literal('1/8 inch = 1 foot'), printedScalePtPerFt: z.literal(9), roofSlopeRiseInPer12: z.literal(4), remoteAreaNumber: z.literal(5),
    remoteAreaCrop: z.object({ clipPt: z.tuple([z.literal(1050), z.literal(650), z.literal(1620), z.literal(1320)]), matrixScale: z.literal(4), colorspace: z.literal('gray'), reviewedSampleSha256: z.string().regex(SHA256), asBuiltSampleSha256: z.string().regex(SHA256), pixelDifferenceCount: z.literal(0) }).strict(),
  }).strict(),
  hydraulicSystem: z.object({
    occupancy: z.literal('LIGHT HAZARD'), systemType: z.literal('DRY SYSTEM'), remoteAreaNumber: z.literal(5), operatingSprinklerCount: z.literal(9),
    designDensityGpmPerSqFt: z.literal(0.1), hoseAllowanceGpm: z.literal(100), systemFlowGpm: z.literal(234.913), totalDemandGpm: z.literal(334.913),
    requiredPressurePsi: z.literal(46.453), availableSafetyMarginPsi: z.literal(10.419), drySystemVolumeGal: z.literal(415), maximumVelocityFps: z.literal(5.56),
  }).strict(),
  independentPlanSummary: z.object({ operatingSprinklerCount: z.literal(9), totalDemandGpm: z.literal(334.91), requiredPressurePsi: z.literal(46.45), safetyFactorPsi: z.literal(10.42), drySystemVolumeGal: z.literal(415) }).strict(),
  heads: z.array(headSchema).length(9), junctions: z.array(z.object({ nodeId: z.literal('701'), planPointPt: z.tuple([z.number().finite(), z.number().finite()]), elevationFt: z.literal(42), pressurePsi: z.literal(20.12) }).strict()).length(1),
  mappedBranchPipes: z.array(pipeSchema).length(8), historicalReview: z.object({ reviewedForApplicableCodesAndStandards: z.literal(true), reviewDate: z.literal('2021-06-16'), role: z.literal('professional-engineer-review-of-completed-reference'), generatedDesignApproval: z.literal(false) }).strict(),
  activePitchedHydraulicPlanRegistrationReady: z.literal(true), perHeadPitchedHydraulicIdentityReady: z.literal(true), mappedPitchedBranchNominalSizeReady: z.literal(true),
  historicalCompletedReferenceReviewReady: z.literal(true), fullHydraulicPlanRegistrationReady: z.literal(false), fullNetworkNominalPipeSizeReady: z.literal(false),
  wholeBuildingNetworkElevationReady: z.literal(false), exactAsBuiltDeflectorElevationReady: z.literal(false), obstructionClearanceReady: z.literal(false),
  fabricationReady: z.literal(false), generatedDesignComplianceReady: z.literal(false), complianceReady: z.literal(false), limitations: z.array(z.string().min(1)).min(4),
  receiptSha256: z.string(),
}).strict();

const EXPECTED_SOURCES = Object.freeze({
  'reviewed-hydraulic-calculation': ['1398effb82f6f8bdc8a2a7d40e044ab593362497f0bbf4daf15218bff9a1b88d', 433769, 8],
  'reviewed-sprinkler-plan-set': ['29eab59ce166a9c1241e54c406b3a190f1330d22cbf5242eb518d11fa48f8bbf', 6800785, 1],
  'completed-as-built-plan-set': ['39ef506decf2f9a963cf5ed1ffee4b8f63998da12a8aa7e4e34c5433fd242ea7', 6198530, 1],
});
const EXPECTED_RECEIPTS = Object.freeze({ dallasPitchedFabricationMapping: '23f52e7ed0f1d82514f5c6d39d6ef168c0c2976c40b0a41cadb94a4704ced1b4', pitchedRoofCrossProjectEvidence: '771f40cf93c9d17f5a071d59ca0ef06246df1dfe0873ab5bb51db4d5baff8090' });
const EXPECTED_HEADS = Object.freeze([
  ['A1', 'TYCO-TY3180-ATTIC-BB1', 1489, 1049.25, 42, 20.2, 25.17], ['A2', 'TYCO-TY3180-ATTIC-BB1', 1435, 1049.25, 42, 20.11, 25.11],
  ['A3', 'TYCO-TY3180-ATTIC-BB1', 1381, 1049.25, 42, 20.1, 25.11], ['A4', 'TYCO-TY3180-ATTIC-BB1', 1327, 1049.25, 42, 20.04, 25.07],
  ['A5', 'TYCO-TY3180-ATTIC-BB1', 1273, 1049.25, 42, 20, 25.04], ['A6', 'TYCO-TY3180-ATTIC-BB1', 1219, 1049.25, 42, 20, 25.04],
  ['A7', 'TYCO-TY3180-ATTIC-BB1', 1165, 1049.25, 42, 20.06, 25.08], ['A8', 'TYCO-TY3183-ATTIC-SD1', 1364, 1210.625, 29, 28.02, 29.64],
  ['A9', 'TYCO-TY3183-ATTIC-SD1', 1310, 1210.625, 29, 28.02, 29.64],
]);
const EXPECTED_PIPES = Object.freeze([
  [1, 'A1', 'A2', 6], [2, 'A2', 'A3', 6], [3, 'A3', '701', 3], [4, '701', 'A4', 3],
  [5, 'A4', 'A5', 6], [6, 'A5', 'A6', 6], [7, 'A6', 'A7', 6], [8, 'A8', 'A9', 6],
]);

export async function sealDallasPitchedAtticHydraulicRegistration(value) {
  const draft = structuredClone(value); delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateDallasPitchedAtticHydraulicRegistration(input) {
  const parsed = packetSchema.safeParse(input);
  if (!parsed.success) return { status: 'blocked', issues: [issue('DALLAS_PITCHED_HYDRAULIC_SCHEMA_INVALID', parsed.error.issues[0]?.message || 'Registration schema is invalid.')], complianceReady: false };
  const packet = parsed.data; const issues = []; const { receiptSha256, ...draft } = packet;
  if (!SHA256.test(receiptSha256) || await sha256Hex(draft) !== receiptSha256) issues.push(issue('DALLAS_PITCHED_HYDRAULIC_RECEIPT_MISMATCH', 'Registration content no longer matches its sealed receipt.'));
  for (const source of packet.sourceBindings) {
    const expected = EXPECTED_SOURCES[source.role];
    if (!expected || source.sha256 !== expected[0] || source.bytes !== expected[1] || source.physicalPages.length !== expected[2]) issues.push(issue('DALLAS_PITCHED_HYDRAULIC_SOURCE_DRIFT', `Source ${source.role} changed identity or page coverage.`));
  }
  if (JSON.stringify(packet.upstreamReceipts) !== JSON.stringify(EXPECTED_RECEIPTS)) issues.push(issue('DALLAS_PITCHED_HYDRAULIC_UPSTREAM_RECEIPT_DRIFT', 'Pitched fabrication or cross-project roof evidence changed.'));
  const crop = packet.plan.remoteAreaCrop;
  if (crop.reviewedSampleSha256 !== '566e25a1cb40e1b579bbb66bfcea14d2fdac9799b0b449df7c5067494bdea6a4' || crop.asBuiltSampleSha256 !== crop.reviewedSampleSha256 || crop.pixelDifferenceCount !== 0) issues.push(issue('DALLAS_PITCHED_HYDRAULIC_LIFECYCLE_CROP_DRIFT', 'Reviewed and as-built FP-1.4 remote-area geometry no longer matches pixel-for-pixel.'));
  const expectedSystem = { occupancy: 'LIGHT HAZARD', systemType: 'DRY SYSTEM', remoteAreaNumber: 5, operatingSprinklerCount: 9, designDensityGpmPerSqFt: 0.1, hoseAllowanceGpm: 100, systemFlowGpm: 234.913, totalDemandGpm: 334.913, requiredPressurePsi: 46.453, availableSafetyMarginPsi: 10.419, drySystemVolumeGal: 415, maximumVelocityFps: 5.56 };
  if (JSON.stringify(packet.hydraulicSystem) !== JSON.stringify(expectedSystem)) issues.push(issue('DALLAS_PITCHED_HYDRAULIC_SYSTEM_DRIFT', 'Reviewed dry-attic hydraulic system summary changed.'));
  if (!close(packet.independentPlanSummary.totalDemandGpm, packet.hydraulicSystem.totalDemandGpm, 0.005) || !close(packet.independentPlanSummary.requiredPressurePsi, packet.hydraulicSystem.requiredPressurePsi, 0.005) || !close(packet.independentPlanSummary.safetyFactorPsi, packet.hydraulicSystem.availableSafetyMarginPsi, 0.005) || packet.independentPlanSummary.operatingSprinklerCount !== packet.hydraulicSystem.operatingSprinklerCount || packet.independentPlanSummary.drySystemVolumeGal !== packet.hydraulicSystem.drySystemVolumeGal) issues.push(issue('DALLAS_PITCHED_HYDRAULIC_PLAN_SUMMARY_DISAGREES', 'Independent FP-1.4 summary does not reproduce the reviewed calculation within printed rounding.'));
  for (const [nodeId, family, x, y, elevationFt, pressurePsi, flowGpm] of EXPECTED_HEADS) {
    const head = packet.heads.find((entry) => entry.nodeId === nodeId);
    if (!head || head.headFamily !== family || !close(head.planPointPt[0], x) || !close(head.planPointPt[1], y) || head.elevationFt !== elevationFt || head.pressurePsi !== pressurePsi || head.actualFlowGpm !== flowGpm) issues.push(issue('DALLAS_PITCHED_HYDRAULIC_HEAD_IDENTITY_DRIFT', `Mapped active head ${nodeId} no longer matches FP-1.4 and the reviewed report.`));
  }
  if (new Set(packet.heads.map((entry) => entry.nodeId)).size !== 9) issues.push(issue('DALLAS_PITCHED_HYDRAULIC_HEAD_DUPLICATED', 'All nine active hydraulic heads must be unique.'));
  const points = new Map(packet.heads.map((head) => [head.nodeId, head.planPointPt])); points.set('701', packet.junctions[0].planPointPt);
  let maximumLengthResidualFt = 0;
  for (const [id, from, to, lengthFt] of EXPECTED_PIPES) {
    const pipe = packet.mappedBranchPipes.find((entry) => entry.id === id); const a = points.get(from); const b = points.get(to);
    const scaledPlanLengthFt = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) / packet.plan.printedScalePtPerFt : Infinity;
    const residualFt = Math.abs(scaledPlanLengthFt - lengthFt); maximumLengthResidualFt = Math.max(maximumLengthResidualFt, residualFt);
    if (!pipe || pipe.fromNodeId !== from || pipe.toNodeId !== to || pipe.planLengthFt !== lengthFt || pipe.reportLengthFt !== lengthFt || residualFt > 0.001) issues.push(issue('DALLAS_PITCHED_HYDRAULIC_PIPE_REGISTRATION_DRIFT', `Mapped branch pipe ${id} no longer reproduces its scaled plan and report length.`));
  }
  if (!packet.historicalReview.reviewedForApplicableCodesAndStandards || packet.historicalReview.generatedDesignApproval || packet.generatedDesignComplianceReady || packet.complianceReady) issues.push(issue('DALLAS_PITCHED_HYDRAULIC_FALSE_COMPLIANCE_PROMOTION', 'Completed-reference review must never promote a newly generated design to compliance.'));
  return {
    status: issues.length ? 'blocked' : 'passed', artifactType: packet.artifactType, projectId: packet.projectId, projectName: packet.projectName, receiptSha256, issues,
    sourceBindings: packet.sourceBindings, plan: packet.plan, hydraulicSystem: packet.hydraulicSystem, independentPlanSummary: packet.independentPlanSummary, heads: packet.heads, junctions: packet.junctions, mappedBranchPipes: packet.mappedBranchPipes, historicalReview: packet.historicalReview,
    metrics: { mappedActiveHeadCount: packet.heads.length, mappedBranchPipeCount: packet.mappedBranchPipes.length, mappedNominalDiameterClassCount: 1, mappedInsideDiameterClassCount: 1, elevationClassCount: new Set(packet.heads.map((head) => head.elevationFt)).size, elevationRangeFt: Math.max(...packet.heads.map((head) => head.elevationFt)) - Math.min(...packet.heads.map((head) => head.elevationFt)), maximumPlanToReportLengthResidualFt: maximumLengthResidualFt },
    activePitchedHydraulicPlanRegistrationReady: issues.length === 0, perHeadPitchedHydraulicIdentityReady: issues.length === 0, mappedPitchedBranchNominalSizeReady: issues.length === 0, historicalCompletedReferenceReviewReady: issues.length === 0,
    fullHydraulicPlanRegistrationReady: false, fullNetworkNominalPipeSizeReady: false, wholeBuildingNetworkElevationReady: false, exactAsBuiltDeflectorElevationReady: false, obstructionClearanceReady: false, fabricationReady: false, generatedDesignComplianceReady: false, complianceReady: false, limitations: packet.limitations,
  };
}

function renderTopView(model) {
  const circles = model.heads3d.map((head) => `<g><circle cx="${head.planPointPt[0]}" cy="${head.planPointPt[1]}" r="8"/><text x="${head.planPointPt[0] + 11}" y="${head.planPointPt[1] - 9}">${head.nodeId}</text></g>`).join('');
  const lines = model.branchPipes3d.map((pipe) => `<line x1="${pipe.fromPlanPointPt[0]}" y1="${pipe.fromPlanPointPt[1]}" x2="${pipe.toPlanPointPt[0]}" y2="${pipe.toPlanPointPt[1]}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="1080 820 500 470" role="img" aria-label="Dallas completed pitched attic hydraulic top view"><style>rect{fill:#07111f}line{stroke:#a78bfa;stroke-width:4}circle{fill:#22d3ee;stroke:#e2e8f0;stroke-width:2}text{fill:#e2e8f0;font:12px monospace}</style><rect x="1080" y="820" width="500" height="470"/>${lines}${circles}</svg>`;
}

function renderElevationView(model) {
  const minimum = Math.min(...model.heads3d.map((head) => head.zFt)); const maximum = Math.max(...model.heads3d.map((head) => head.zFt));
  const y = (z) => 250 - (z - minimum) / Math.max(1, maximum - minimum) * 180;
  const groups = [...new Set(model.heads3d.map((head) => head.zFt))].sort((a, b) => b - a).map((z, index) => `<g><line x1="100" y1="${y(z)}" x2="660" y2="${y(z)}"/><text x="100" y="${y(z) - 10}">${model.heads3d.filter((head) => head.zFt === z).map((head) => head.nodeId).join(', ')} at ${z.toFixed(2)} ft</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 300" role="img" aria-label="Dallas completed pitched attic hydraulic elevation view"><style>rect{fill:#07111f}line{stroke:#a78bfa;stroke-width:5}text{fill:#e2e8f0;font:12px monospace}</style><rect width="760" height="300"/>${groups}</svg>`;
}

export async function buildDallasPitchedAtticHydraulicModel(packet) {
  const validation = await validateDallasPitchedAtticHydraulicRegistration(packet);
  if (validation.status !== 'passed') return { status: 'blocked', issues: validation.issues, complianceReady: false };
  const points = new Map(validation.heads.map((head) => [head.nodeId, head.planPointPt])); points.set('701', validation.junctions[0].planPointPt);
  const elevations = new Map(validation.heads.map((head) => [head.nodeId, head.elevationFt])); elevations.set('701', 42);
  const heads3d = validation.heads.map((head) => ({ ...head, xFt: head.planPointPt[0] / 9, yFt: head.planPointPt[1] / 9, zFt: head.elevationFt, hydraulicIdentityReady: true }));
  const branchPipes3d = validation.mappedBranchPipes.map((pipe) => ({ ...pipe, fromPlanPointPt: points.get(pipe.fromNodeId), toPlanPointPt: points.get(pipe.toNodeId), fromFt: [points.get(pipe.fromNodeId)[0] / 9, points.get(pipe.fromNodeId)[1] / 9, elevations.get(pipe.fromNodeId)], toFt: [points.get(pipe.toNodeId)[0] / 9, points.get(pipe.toNodeId)[1] / 9, elevations.get(pipe.toNodeId)], mappedNominalSizeReady: true }));
  const model = { status: 'passed', artifactType: 'halofire.dallas-pitched-attic-hydraulic-model3d.v1', projectId: validation.projectId, heads3d, branchPipes3d, metrics: validation.metrics, activePitchedHydraulicPlanRegistrationReady: true, perHeadPitchedHydraulicIdentityReady: true, mappedPitchedBranchNominalSizeReady: true, historicalCompletedReferenceReviewReady: true, fullHydraulicPlanRegistrationReady: false, fullNetworkNominalPipeSizeReady: false, wholeBuildingNetworkElevationReady: false, exactAsBuiltDeflectorElevationReady: false, obstructionClearanceReady: false, fabricationReady: false, generatedDesignComplianceReady: false, complianceReady: false, residuals: ['unregistered_hydraulic_nodes_and_feed_network', 'exact_as_built_deflector_elevations_not_field_measured', 'obstruction_clearances_not_per_head_reproduced', 'completed_reference_review_is_not_generated_design_compliance'] };
  return { ...model, views: { topSvg: renderTopView(model), elevationSvg: renderElevationView(model) } };
}

/** Promotes only the common capability reproduced by Dallas and Winter Garden. */
export function validateCompletedPitchedHydraulicPortfolio(dallasValidation, winterGardenValidation, minimumProjects = 2) {
  const validations = [dallasValidation, winterGardenValidation]; const passed = validations.filter((entry) => entry?.status === 'passed'); const ids = [...new Set(passed.map((entry) => entry.projectId))]; const issues = [];
  if (passed.length !== validations.length) issues.push(issue('PITCHED_HYDRAULIC_PROJECT_BLOCKED', 'Every selected completed-project registration must pass.'));
  if (ids.length < minimumProjects) issues.push(issue('PITCHED_HYDRAULIC_PROJECT_COUNT_LOW', `Only ${ids.length}/${minimumProjects} independent completed projects passed.`));
  const commonProjects = passed.filter((entry) => entry.activePitchedHydraulicPlanRegistrationReady || entry.pitchedRowHydraulicDatumRegistrationReady).map((entry) => entry.projectId);
  const perHeadProjects = passed.filter((entry) => entry.perHeadPitchedHydraulicIdentityReady).map((entry) => entry.projectId);
  const nominalSizeProjects = passed.filter((entry) => entry.mappedPitchedBranchNominalSizeReady).map((entry) => entry.projectId);
  const completedReferenceProjects = passed.filter((entry) => entry.historicalCompletedReferenceReviewReady || entry.operatingSprinklerHydraulicEvidenceReady).map((entry) => entry.projectId);
  return {
    status: issues.length ? 'blocked' : 'passed', projectCount: ids.length, projectIds: ids, projects: passed.map((entry) => ({ projectId: entry.projectId, status: entry.status })),
    featurePromotion: {
      pitched_hydraulic_geometry_registration: { ready: issues.length === 0 && commonProjects.length >= minimumProjects, projectCount: commonProjects.length, requiredProjectCount: minimumProjects, projects: commonProjects },
      per_head_pitched_hydraulic_identity: { ready: perHeadProjects.length >= minimumProjects, projectCount: perHeadProjects.length, requiredProjectCount: minimumProjects, projects: perHeadProjects },
      mapped_pitched_branch_nominal_size: { ready: nominalSizeProjects.length >= minimumProjects, projectCount: nominalSizeProjects.length, requiredProjectCount: minimumProjects, projects: nominalSizeProjects },
      completed_pitched_hydraulic_reference: { ready: issues.length === 0 && completedReferenceProjects.length >= minimumProjects, projectCount: completedReferenceProjects.length, requiredProjectCount: minimumProjects, projects: completedReferenceProjects },
      generated_pitched_design_compliance: { ready: false, projectCount: 0, requiredProjectCount: minimumProjects, projects: [] },
    },
    complianceReady: false, issues,
  };
}

export async function verifyDallasPitchedAtticHydraulicAdversarialLoop(packet, winterGardenValidation) {
  const mutations = {
    receiptDriftRejected: async (draft) => { draft.receiptSha256 = '0'.repeat(64); return draft; },
    sourceSubstitutionRejected: async (draft) => { draft.sourceBindings[0].sha256 = '0'.repeat(64); return sealDallasPitchedAtticHydraulicRegistration(draft); },
    lifecycleCropDriftRejected: async (draft) => { draft.plan.remoteAreaCrop.asBuiltSampleSha256 = '0'.repeat(64); return sealDallasPitchedAtticHydraulicRegistration(draft); },
    headIdentityDriftRejected: async (draft) => { draft.heads[0].nodeId = 'A2'; return sealDallasPitchedAtticHydraulicRegistration(draft); },
    planScaleDriftRejected: async (draft) => { draft.heads[0].planPointPt[0] += 9; return sealDallasPitchedAtticHydraulicRegistration(draft); },
    nominalInsideDiameterSubstitutionRejected: async (draft) => { draft.mappedBranchPipes[0].actualInsideDiameterIn = 2; return sealDallasPitchedAtticHydraulicRegistration(draft); },
    falseCompliancePromotionRejected: async (draft) => { draft.complianceReady = true; return sealDallasPitchedAtticHydraulicRegistration(draft); },
  };
  const results = {};
  for (const [name, mutate] of Object.entries(mutations)) results[name] = (await validateDallasPitchedAtticHydraulicRegistration(await mutate(structuredClone(packet)))).status === 'blocked';
  const validDallas = await validateDallasPitchedAtticHydraulicRegistration(packet);
  const duplicate = validateCompletedPitchedHydraulicPortfolio(validDallas, { ...winterGardenValidation, projectId: validDallas.projectId });
  results.duplicateProjectRejected = duplicate.status === 'blocked';
  return { status: Object.values(results).every(Boolean) ? 'passed' : 'blocked', ...results };
}
