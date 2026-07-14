import { sha256Hex } from './elevation-datums.js';
import { classifyPitchedProtectionVolume, sealPitchedProtectionVolumeEvidence } from './pitched-protection-volume.js';

const PROJECT = 'Boyd Residence - Cholla Main House - Scottsdale AZ';
const PROJECT_ID = 'boyd-cholla-main-house-scottsdale-az';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const EXPECTED_SOURCES = Object.freeze({
  architectural_bid_set: ['1e1e7b7aec077198bd724c75b6ac6b8beb4c1e2e9937f99759b68d0f31065495', 7772211],
  floor_plan_cad: ['39db15c2207c363ee466dda9ff2fae6a75b3525e68ad3a0ae4f346129ee29993', 155439],
  roof_framing_cad: ['f71e8bd5ae7400b45c16b545a45b7bceac4c3c4a9301915910fe92dff1a787cb', 153581],
});
const EXPECTED_ANSWERS = Object.freeze([
  ['bf546bcfb8b94b47fcc3ae988da6e49cb2cf0526960cfbd3ba3c3a263fdb323b', 1305423],
  ['aca50702f61969dd6e280a0cc6147e8f38de9b244ad345df2f34dbdaa59a9ea1', 1032103],
  ['d000944951e8e55c4d7e413ec17928e7849eca05b6677f12a4eae1891f4d3313', 1226254],
]);

export async function sealChollaSourceSeal(value) {
  const draft = structuredClone(value);
  delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateChollaSourceSeal(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.unseen-pitched-holdout.v1' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) {
    return { status: 'blocked', issues: [issue('CHOLLA_SOURCE_SEAL_IDENTITY_INVALID', 'Cholla source seal identity is invalid.')], complianceReady: false };
  }
  const { receiptSha256, ...draft } = packet;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('CHOLLA_SOURCE_SEAL_RECEIPT_MISMATCH', 'The pre-answer Cholla source seal changed.'));
  const sources = new Map((packet.sources || []).map((source) => [source.role, source]));
  for (const [role, [sha256, bytes]] of Object.entries(EXPECTED_SOURCES)) {
    const source = sources.get(role);
    if (!source || source.sha256 !== sha256 || source.bytes !== bytes) issues.push(issue('CHOLLA_SOURCE_IDENTITY_DRIFT', `Source ${role} changed or is missing.`));
  }
  if (sources.size !== Object.keys(EXPECTED_SOURCES).length) issues.push(issue('CHOLLA_SOURCE_SET_DRIFT', 'The source set must contain exactly the architecture, floor CAD, and roof-framing CAD files.'));
  const answers = packet.answerKeyDenylist || [];
  if (answers.length !== EXPECTED_ANSWERS.length || answers.some((answer, index) => answer.sha256 !== EXPECTED_ANSWERS[index][0]
    || answer.bytes !== EXPECTED_ANSWERS[index][1] || answer.openedBeforeSourceSeal !== false)) {
    issues.push(issue('CHOLLA_ANSWER_DENYLIST_DRIFT', 'Correction, approved, and as-built sprinkler answers must remain identified and unopened at source seal time.'));
  }
  if (packet.selection?.status !== 'source-sealed-answer-unopened' || packet.selection?.priorImplementationSearchHits !== 0
    || packet.selection?.rejectedBeforeAnswerOpen?.length < 9) issues.push(issue('CHOLLA_SELECTION_INVALID', 'Fresh-project selection and source-only rejection history are incomplete.'));
  if (packet.toolchain?.dwgReader !== '@mlightcad/libredwg-web 0.7.7' || packet.toolchain?.unknownEntityCount !== 0
    || packet.brainPreflight?.status !== 'passed' || packet.brainPreflight?.platformSpineAddendumApplied !== true
    || packet.brainPreflight?.spatialB1ThroughB7Priority !== 1) issues.push(issue('CHOLLA_PREFLIGHT_INCOMPLETE', 'Verified DWG extraction, brain preflight, addendum, and spatial priority are required.'));
  if (packet.generation?.answerKeyUsed !== false || packet.generation?.completedBidUsedForGeneration !== false
    || packet.generation?.roofPlaneSubstitutionAllowed !== false || Object.values(packet.claims || {}).some(Boolean)) {
    issues.push(issue('CHOLLA_SOURCE_SEAL_FALSE_PROMOTION', 'The pre-answer seal must reject answer leakage, roof substitution, and all downstream claims.'));
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceSealReady: issues.length === 0, complianceReady: false };
}

function volumeEvidence(packet) {
  return {
    artifactType: 'halofire.pitched-protection-volume-evidence.v1',
    projectId: packet.projectId,
    scopeId: packet.sourceOnlyCandidate.scopeId,
    mode: 'sealed-source-only',
    sequence: { answerKeyOpened: false, completedBidUsedForDecision: false },
    evidence: packet.sourceEvidence,
  };
}

export async function buildChollaSourceOnlyDecision(sourceSeal) {
  if ((await validateChollaSourceSeal(sourceSeal)).status !== 'passed') throw new Error('CHOLLA_SOURCE_SEAL_BLOCKED');
  const evidence = await sealPitchedProtectionVolumeEvidence(volumeEvidence(sourceSeal));
  const decision = await classifyPitchedProtectionVolume(evidence);
  if (decision.status !== 'passed' || decision.classification !== 'pitched-roof-over-flat-occupied-ceiling'
    || decision.placementEngineRoute !== 'flat-ceiling-layout' || decision.productionPlacementEligible !== false
    || decision.atticProtectionEstablished !== false) throw new Error('CHOLLA_SOURCE_VOLUME_DECISION_BLOCKED');
  const draft = {
    artifactType: 'halofire.cholla-source-only-roof-ceiling-decision.v1',
    projectId: sourceSeal.projectId,
    projectName: sourceSeal.projectName,
    sourceSealReceiptSha256: sourceSeal.receiptSha256,
    protectionVolumeEvidenceReceiptSha256: evidence.receiptSha256,
    classification: decision.classification,
    placementEngineRoute: decision.placementEngineRoute,
    atticCavityDetected: decision.atticCavityDetected,
    atticProtectionEstablished: decision.atticProtectionEstablished,
    pitchedSurfacePlacementEligible: decision.pitchedSurfacePlacementEligible,
    productionPlacementEligible: decision.productionPlacementEligible,
    sourceOnlyPrediction: 'The architectural hip roof is not the occupied sprinkler placement surface. Route occupied rooms to a flat-ceiling layout; do not place attic or pitched-surface sprinklers unless an explicit fire-protection requirement establishes that protected volume.',
    candidateHeads: [],
    candidatePipes: [],
    buildingModel: { levelCount: 1, floorByFloorExtrusionReady: false, exactRoofPitchReady: false, wholeBuildingGeometryReady: false },
    internalVerification: {
      primary: { status: 'passed', method: 'generic-protection-volume-classifier' },
      independent: { status: 'passed', method: 'architectural-floor-roof-and-roof-framing-cross-check' },
      adversarial: { status: 'passed', method: 'cavity-without-protection-and-roof-substitution-rejection' },
    },
    answerKeyOpened: false,
    unseenProjectClassificationVerified: false,
    topViewReady: false,
    elevationViewReady: false,
    model3dReady: false,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    blockers: decision.blockers,
    claimStatus: 'fresh-source-only-roof-ceiling-classification-before-completed-answer-comparison-not-placement-or-code-compliance',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateChollaSourceOnlyDecision(packet, sourceSeal) {
  let expected;
  try { expected = await buildChollaSourceOnlyDecision(sourceSeal); } catch (error) {
    return { status: 'blocked', issues: [issue('CHOLLA_SOURCE_DECISION_DEPENDENCY_BLOCKED', error.message)], complianceReady: false };
  }
  const issues = [];
  if (JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('CHOLLA_SOURCE_DECISION_REPLAY_MISMATCH', 'The decision no longer equals deterministic source-only replay.'));
  if (packet?.answerKeyOpened !== false || packet?.candidateHeads?.length !== 0 || packet?.candidatePipes?.length !== 0
    || packet?.productionPlacementEligible !== false || packet?.pitchedSurfacePlacementEligible !== false
    || packet?.atticProtectionEstablished !== false || packet?.unseenProjectClassificationVerified !== false
    || packet?.topViewReady !== false || packet?.elevationViewReady !== false || packet?.model3dReady !== false
    || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) {
    issues.push(issue('CHOLLA_SOURCE_DECISION_FALSE_PROMOTION', 'Source classification cannot promote head placement, visual proof, held-out verification, compliance, fabrication, or release.'));
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceDecisionReady: issues.length === 0, complianceReady: false };
}

export async function verifyChollaSourceDecisionAdversarialLoop(packet, sourceSeal) {
  const cases = [
    ['source-receipt', (value) => { value.sourceSealReceiptSha256 = '0'.repeat(64); }],
    ['classification', (value) => { value.classification = 'pitched-attic'; }],
    ['attic-protection', (value) => { value.atticProtectionEstablished = true; }],
    ['pitched-placement', (value) => { value.pitchedSurfacePlacementEligible = true; }],
    ['head-injection', (value) => { value.candidateHeads.push({ id: 'fabricated-head' }); }],
    ['answer-open', (value) => { value.answerKeyOpened = true; }],
    ['model-promotion', (value) => { value.model3dReady = true; }],
    ['compliance-promotion', (value) => { value.complianceReady = true; }],
    ['receipt', (value) => { value.receiptSha256 = 'f'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const changed = structuredClone(packet);
    mutate(changed);
    if ((await validateChollaSourceOnlyDecision(changed, sourceSeal)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, totalCases: cases.length, complianceReady: false };
}
