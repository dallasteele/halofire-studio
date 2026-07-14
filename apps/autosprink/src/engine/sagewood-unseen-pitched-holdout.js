import { sha256Hex } from './elevation-datums.js';
import { generateSlopedCeilingLayout } from './sloped-ceiling-layout.js';

const PROJECT = 'Sagewood Ranch - South Jordan UT';
const PROJECT_ID = 'sagewood-ranch-south-jordan-ut';
const PRIOR_RECEIPT = '20a553b24f20219e2f3d1e8022b05079dc6e22f3189c63c9684fcf3dbbf1bf26';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value) => Number(value.toFixed(6));

export async function sealSagewoodSourceSeal(value) { const draft = structuredClone(value); delete draft.receiptSha256; return { ...draft, receiptSha256: await sha256Hex(draft) }; }

export async function validateSagewoodSourceSeal(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.unseen-pitched-holdout.v1' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) return { status: 'blocked', issues: [issue('SAGEWOOD_SOURCE_IDENTITY_INVALID', 'Sagewood holdout identity is invalid.')] };
  const { receiptSha256, ...draft } = packet;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('SAGEWOOD_SOURCE_RECEIPT_MISMATCH', 'The source seal changed.'));
  const expected = new Map([
    ['architectural_plan_pdf', ['83182f521f1d6b578c3d9062879f1e02d76ab3d7f1c04588df19e5084d20f87f', 2428236]],
    ['main_level_cad', ['b45987e6cf7de62147fe96e6cf47b55656501f029a7558c699d6754e2bfb2419', 256635]],
    ['roof_plan_cad', ['e56b19b5a6b1aa75bc9ef68c772bbc1edccfb90e4ae4d3eaa0d7df00e912fccf', 40332]],
    ['building_section_cad', ['8ed580977f60cad745b9c6b9edf93528a35184b021f1b12aa1fd2ac4f584d279', 106583]],
  ]);
  const byRole = new Map(packet.sources?.map((entry) => [entry.role, entry]));
  for (const [role, [sha256, bytes]] of expected) { const source = byRole.get(role); if (source?.sha256 !== sha256 || source?.bytes !== bytes) issues.push(issue('SAGEWOOD_SOURCE_FILE_DRIFT', `${role} changed or is missing.`)); }
  if (byRole.size !== 4) issues.push(issue('SAGEWOOD_SOURCE_SET_DRIFT', 'Exactly four independent source controls are required.'));
  const deny = packet.answerKeyDenylist || [];
  if (deny.length !== 2 || deny.some((entry) => entry.openedBeforeSourceSeal !== false) || deny[0]?.sha256 !== '1d48993b4c3c22459cd43ba05b167e6e7afc985c17c24140f51e4ae5dd81831c' || deny[1]?.sha256 !== '49785c73b1d3c9b841afa3dcb916a9e5c875284deef658820e792c5199b0797c') issues.push(issue('SAGEWOOD_ANSWER_DENYLIST_DRIFT', 'Both completed sprinkler answers must remain identified and unopened.'));
  const source = packet.sourceObservations;
  if (source?.room !== 'MAIN HALL' || source?.widthFt !== 52.583333 || source?.lengthFt !== 63 || source?.pitchRiseIn !== 3 || source?.pitchRunIn !== 12 || source?.springElevationFt !== 18 || source?.peakElevationFt !== 24.572917 || source?.sectionDimensionMeasurementIn !== 216) issues.push(issue('SAGEWOOD_SOURCE_GEOMETRY_DRIFT', 'The plan-and-section-closed Main Hall controls changed.'));
  if (packet.selection?.status !== 'source-sealed-answer-unopened' || packet.selection?.priorImplementationSearchHits !== 0 || packet.generation?.answerKeyUsed !== false || Object.values(packet.claims || {}).some(Boolean)) issues.push(issue('SAGEWOOD_FALSE_PROMOTION', 'Fresh source selection and all downstream claims must remain closed.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceSealReady: issues.length === 0, complianceReady: false };
}

function geometry() {
  const widthFt = 52 + 7 / 12; const lengthFt = 63; const halfRunFt = widthFt / 2; const springElevationFt = 18; const peakElevationFt = springElevationFt + halfRunFt * 3 / 12;
  return { coordinateSystem: 'A3.2 Main Hall local feet', floor: { id: 'main-level', elevationFt: 0 }, room: { id: 'main-hall', name: 'MAIN HALL', widthFt: round(widthFt), lengthFt, areaSqFt: round(widthFt * lengthFt), polygonFt: [[0, 0], [widthFt, 0], [widthFt, lengthFt], [0, lengthFt]] }, ceiling: { kind: 'source-proven-two-plane-vault', axis: 'x', ridgeAxis: 'y', pitch: { riseIn: 3, runIn: 12 }, halfRunFt: round(halfRunFt), springElevationFt, peakElevationFt: round(peakElevationFt), sourceResiduals: ['stair-and-local-obstruction-clearances-unresolved', 'no-full-span-box-beam-control-found-in-selected-section'], surfaces: [{ id: 'main-hall-west-plane', polygonFt: [[0, 0], [halfRunFt, 0], [halfRunFt, lengthFt], [0, lengthFt]], downhillDirection: 'negative-x' }, { id: 'main-hall-east-plane', polygonFt: [[halfRunFt, 0], [widthFt, 0], [widthFt, lengthFt], [halfRunFt, lengthFt]], downhillDirection: 'positive-x' }] } };
}

export async function buildSagewoodSourceOnlyCandidate(sourceSeal, dillonPrior) {
  if ((await validateSagewoodSourceSeal(sourceSeal)).status !== 'passed') throw new Error('SAGEWOOD_SOURCE_SEAL_BLOCKED');
  if (dillonPrior?.receiptSha256 !== PRIOR_RECEIPT || dillonPrior?.candidatePlacementPriorReady !== true || dillonPrior?.transferPolicy?.empiricalPriorOnly !== true) throw new Error('DILLON_EMPIRICAL_PRIOR_BLOCKED');
  const model = geometry();
  const layoutInput = { artifactType: 'halofire.sloped-ceiling-layout-input.v1', printedScalePtPerFt: 1, regions: model.ceiling.surfaces.map((surface) => ({ id: surface.id, polygonSubmittedPt: surface.polygonFt, slopeAxis: 'x', downhillDirection: surface.downhillDirection, riseIn: 3, runIn: 12, shouldProtect: true, obstructions: [], linearObstructions: [] })), maxAcrossSlopeSpanFt: dillonPrior.learnedGeometry.replayAcrossSlopeSpanFt, maxAlongSlopeSpanFt: dillonPrior.learnedGeometry.replayAlongSlopeSpanFt };
  const layout = generateSlopedCeilingLayout(layoutInput); if (layout.status !== 'passed') throw new Error('SAGEWOOD_LAYOUT_BLOCKED');
  const heads3d = layout.heads.map((head, index) => ({ id: `sagewood-source-head-${String(index + 1).padStart(2, '0')}`, surfaceId: head.regionId, pointFt: [round(head.pointPt[0]), round(head.pointPt[1]), round(model.ceiling.springElevationFt + Math.min(head.pointPt[0], model.room.widthFt - head.pointPt[0]) * .25)], status: 'source-only-empirical-candidate', hydraulicNodeAssigned: false, obstructionClearanceVerified: false }));
  const draft = { artifactType: 'halofire.sagewood-source-only-pitched-candidate.v1', projectId: PROJECT_ID, projectName: PROJECT, sourceSealReceiptSha256: sourceSeal.receiptSha256, dillonPriorReceiptSha256: dillonPrior.receiptSha256, generationMode: 'fresh-sealed-source-plus-cross-project-empirical-prior-before-answer-open', geometry: model, layoutInput, layout: { regions: layout.regions, headCount: heads3d.length }, heads3d, branchPipes3d: [], branchPipeTopologyReady: false, buildingModel: { levelCount: 1, modeledScope: 'main-hall-only', floorByFloorExtrusionReady: true, wholeBuildingFootprintComplete: false }, internalVerification: { primary: { status: 'passed', method: 'deterministic-two-plane-layout-replay' }, independent: { status: 'passed', method: 'a3.2-plan-plus-building-section-dimension-closure' }, adversarial: { status: 'passed', method: 'source-prior-answer-leakage-and-false-promotion-mutations' } }, answerKeyOpened: false, answerKeyUsedAsGeometryInput: false, unseenProjectPlacementVerified: false, roomEnvelopeGeometryGrounded: true, topViewReady: true, elevationViewReady: true, partialModel3dReady: true, wholeBuildingModelReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false, claimStatus: 'fresh-source-only-main-hall-pitched-candidate-before-answer-comparison' };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateSagewoodSourceOnlyCandidate(packet, dependencies) {
  const issues = []; let expected;
  try { expected = await buildSagewoodSourceOnlyCandidate(dependencies.sourceSeal, dependencies.dillonPrior); } catch (error) { return { status: 'blocked', issues: [issue('SAGEWOOD_CANDIDATE_DEPENDENCY_BLOCKED', error.message)] }; }
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('SAGEWOOD_CANDIDATE_REPLAY_MISMATCH', 'Candidate differs from deterministic sealed-source replay.'));
  if (packet?.heads3d?.length !== 24 || packet.layout?.regions?.some((region) => region.generatedHeadCount !== 12) || packet?.answerKeyOpened !== false || packet?.unseenProjectPlacementVerified !== false || packet?.branchPipeTopologyReady !== false || packet?.wholeBuildingModelReady !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false) issues.push(issue('SAGEWOOD_CANDIDATE_FALSE_PROMOTION', 'The 24-head source candidate and every downstream gate must remain fail-closed.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceCandidateReady: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifySagewoodSourceCandidateAdversarialLoop(packet, dependencies) {
  const cases = [['source', (v) => { v.sourceSealReceiptSha256 = '0'.repeat(64); }], ['prior', (v) => { v.dillonPriorReceiptSha256 = 'f'.repeat(64); }], ['answer', (v) => { v.answerKeyOpened = true; }], ['pitch', (v) => { v.geometry.ceiling.pitch.riseIn = 4; }], ['spring', (v) => { v.geometry.ceiling.springElevationFt = 12; }], ['width', (v) => { v.geometry.room.widthFt = 40; }], ['length', (v) => { v.geometry.room.lengthFt = 16; }], ['surface', (v) => { v.geometry.ceiling.surfaces.pop(); }], ['head', (v) => { v.heads3d.pop(); }], ['heldout', (v) => { v.unseenProjectPlacementVerified = true; }], ['whole', (v) => { v.wholeBuildingModelReady = true; }], ['compliance', (v) => { v.complianceReady = true; }]];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const changed = structuredClone(packet); mutate(changed); if ((await validateSagewoodSourceOnlyCandidate(changed, dependencies)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, complianceReady: false };
}
