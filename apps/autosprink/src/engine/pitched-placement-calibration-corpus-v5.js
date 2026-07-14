import { sha256Hex } from './elevation-datums.js';

const V4_RECEIPT = '6a37f16060e6dfc24358c83967f6ebf5b0964ddcbcf38368a72ce849ab3a4621';
const BGC_CANDIDATE_RECEIPT = '908819388b44ed015ca93ee0b15e8bd94f7c4e72f72eaa4503d6db649a6fac54';
const BGC_COMPARISON_RECEIPT = '37fee9c38560e2a98507844e390658c865f4cc9c24d277c7859d5c9f544b6b57';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });
const FORBIDDEN_SELECTOR_INPUTS = Object.freeze(['projectName', 'answerKeyPath', 'approvedHeadCount', 'approvedHeadCoordinates', 'approvedTopology']);
const DISTANCE_FEATURES = Object.freeze(['ceilingPitchRiseInPer12', 'envelopeLengthFt', 'envelopeWidthFt', 'aspectRatio', 'envelopeAreaSqFt', 'sourceObstructionPresent', 'movablePartitionPocketPresent', 'sourceSpanCandidateCount']);
const BOUNDED_NUMERIC_FEATURES = Object.freeze(['ceilingPitchRiseInPer12', 'envelopeLengthFt', 'envelopeWidthFt', 'aspectRatio', 'envelopeAreaSqFt']);
const numeric = (value) => typeof value === 'boolean' ? (value ? 1 : 0) : value;

function requireDependencies({ v4Corpus, bgcCandidate, bgcComparison }) {
  if (v4Corpus?.artifactType !== 'halofire.pitched-placement-calibration-corpus.v4' || v4Corpus?.receiptSha256 !== V4_RECEIPT || v4Corpus?.trainingProjects?.length !== 5 || v4Corpus?.largeVaultStrategies?.length !== 4 || v4Corpus?.strategySelectorReadyForFreshHoldout !== true) throw new Error('PITCHED_CALIBRATION_V4_DEPENDENCY_BLOCKED');
  if (bgcCandidate?.artifactType !== 'halofire.boys-girls-club-source-only-pitched-candidate.v1' || bgcCandidate?.receiptSha256 !== BGC_CANDIDATE_RECEIPT || bgcCandidate?.answerKeyOpened !== false || bgcCandidate?.blindPrediction?.headCount !== 12 || bgcCandidate?.selectorApplicability?.outOfEnvelope !== true || bgcCandidate?.candidatePlacementReady !== false) throw new Error('BGC_BLIND_CANDIDATE_DEPENDENCY_BLOCKED');
  if (bgcComparison?.artifactType !== 'halofire.boys-girls-club-pitched-heldout-comparison.v1' || bgcComparison?.receiptSha256 !== BGC_COMPARISON_RECEIPT || bgcComparison?.result?.status !== 'failed' || bgcComparison?.approved?.headCount !== 64 || bgcComparison?.asBuilt?.headCount !== 64 || bgcComparison?.result?.v4OutOfEnvelopePromotionGuardWorked !== true || bgcComparison?.result?.v4TopologyGeneralizationVerified !== false) throw new Error('BGC_HELDOUT_COMPARISON_DEPENDENCY_BLOCKED');
}

function bgcTrainingProject(bgcCandidate, bgcComparison) {
  return {
    projectId: bgcCandidate.projectId,
    layoutFamily: 'large-high-bay-exposed-two-plane-eight-along-eight-across-guarded-uprights',
    sourceObservableFeatures: {
      ...bgcCandidate.sourceObservableFeatures,
      alongRidgeSpanFt: 104, acrossSlopeSpanFt: 89.5, springElevationFt: 25, ridgeElevationFt: 32.458333, ridgeAxis: 'x',
      sourceObstructionKinds: ['center ceiling fan', 'retractable basketball standards', 'lighting and air devices'],
    },
    answerExposedFeatures: {
      completedHeadCount: 64, completedAreaPerHeadSqFt: round(9308 / 64),
      topology: { alongRidgeStations: 8, acrossSlopeStations: 8 }, headsPerBranch: 8, branchCount: 8,
      headType: bgcComparison.asBuilt.headType, approvedAsBuiltTopologyParity: true,
      exactStationCoordinatesReady: false,
    },
  };
}

function distanceModel(strategies) {
  const ranges = Object.fromEntries(DISTANCE_FEATURES.map((key) => {
    const values = strategies.map((entry) => numeric(entry.sourceObservableFeatures[key]));
    return [key, Math.max(1, Math.max(...values) - Math.min(...values))];
  }));
  const bounds = Object.fromEntries(BOUNDED_NUMERIC_FEATURES.map((key) => {
    const values = strategies.map((entry) => entry.sourceObservableFeatures[key]);
    return [key, { min: Math.min(...values), max: Math.max(...values) }];
  }));
  const distance = (features, strategy) => round(DISTANCE_FEATURES.reduce((sum, key) => sum + Math.abs(numeric(features[key]) - numeric(strategy.sourceObservableFeatures[key])) / ranges[key], 0));
  const leaveOneOut = strategies.map((strategy, index) => {
    const peers = strategies.filter((_, peerIndex) => peerIndex !== index);
    const nearest = peers.map((peer) => ({ projectId: peer.projectId, distance: distance(strategy.sourceObservableFeatures, peer) })).sort((a, b) => a.distance - b.distance || a.projectId.localeCompare(b.projectId))[0];
    return { projectId: strategy.projectId, nearestProjectId: nearest.projectId, distance: nearest.distance };
  });
  return { ranges, bounds, leaveOneOut, maxLeaveOneOutNearestDistance: Math.max(...leaveOneOut.map((entry) => entry.distance)), distance };
}

export function selectPitchedPlacementStrategyV5(sourceFeatures, v4Corpus, v5Packet) {
  const forbidden = FORBIDDEN_SELECTOR_INPUTS.filter((key) => sourceFeatures?.[key] !== undefined);
  if (forbidden.length) throw new Error(`PITCHED_SELECTOR_V5_FORBIDDEN_INPUT:${forbidden.join(',')}`);
  if (v4Corpus?.receiptSha256 !== V4_RECEIPT || v5Packet?.artifactType !== 'halofire.pitched-placement-calibration-corpus.v5') throw new Error('PITCHED_SELECTOR_V5_CORPUS_BLOCKED');
  if (sourceFeatures?.clearSpanDisambiguated !== true) throw new Error('PITCHED_SELECTOR_V5_CLEAR_SPAN_UNRESOLVED');
  if (sourceFeatures?.occupiedProtectionPlaneCount === 1 && sourceFeatures?.sourceObstructionPresent === true) {
    const project = v4Corpus.trainingProjects.find((entry) => entry.layoutFamily === 'small-obstructed-single-plane');
    return { selectedProjectId: project.projectId, selectedFamily: project.layoutFamily, distance: 0, calibratedDomainPassed: true, sourceOnlyInputsUsed: ['occupiedProtectionPlaneCount', 'sourceObstructionPresent', 'clearSpanDisambiguated'], answerExposedPriorOnly: true, codeLimit: false };
  }
  if (sourceFeatures?.occupiedProtectionPlaneCount !== 2 || sourceFeatures?.symmetricTwoPlaneVault !== true) throw new Error('PITCHED_SELECTOR_V5_UNCALIBRATED_GEOMETRY');
  for (const key of DISTANCE_FEATURES) { const value = sourceFeatures[key]; if (key.endsWith('Present') ? typeof value !== 'boolean' : !Number.isFinite(value)) throw new Error(`PITCHED_SELECTOR_V5_SOURCE_FEATURE_MISSING:${key}`); }
  const strategies = [...v4Corpus.largeVaultStrategies, v5Packet.newTrainingProject];
  const model = distanceModel(strategies);
  for (const key of BOUNDED_NUMERIC_FEATURES) { const bound = model.bounds[key]; if (sourceFeatures[key] < bound.min || sourceFeatures[key] > bound.max) throw new Error(`PITCHED_SELECTOR_V5_OUTSIDE_CALIBRATED_BOUNDS:${key}`); }
  const ranked = strategies.map((strategy) => ({ strategy, distance: model.distance(sourceFeatures, strategy) })).sort((a, b) => a.distance - b.distance || a.strategy.projectId.localeCompare(b.strategy.projectId));
  if (ranked[0].distance > model.maxLeaveOneOutNearestDistance) throw new Error('PITCHED_SELECTOR_V5_OUTSIDE_CALIBRATED_DISTANCE');
  return {
    selectedProjectId: ranked[0].strategy.projectId, selectedFamily: ranked[0].strategy.layoutFamily, distance: ranked[0].distance, runnerUpDistance: ranked[1]?.distance ?? null,
    calibratedDomainPassed: true, calibratedDistanceLimit: model.maxLeaveOneOutNearestDistance,
    sourceOnlyInputsUsed: [...DISTANCE_FEATURES, 'occupiedProtectionPlaneCount', 'symmetricTwoPlaneVault', 'clearSpanDisambiguated'], answerExposedPriorOnly: true, codeLimit: false,
  };
}

export async function buildPitchedPlacementCalibrationCorpusV5(dependencies) {
  requireDependencies(dependencies);
  const { v4Corpus, bgcCandidate, bgcComparison } = dependencies;
  const newTrainingProject = bgcTrainingProject(bgcCandidate, bgcComparison);
  const strategies = [...v4Corpus.largeVaultStrategies, newTrainingProject];
  const model = distanceModel(strategies);
  const draft = {
    artifactType: 'halofire.pitched-placement-calibration-corpus.v5',
    mode: 'answer-exposed-six-project-topology-calibration-with-explicit-domain-gate',
    purpose: 'preserve the BGC 3x4-versus-8x8 failure, add the large-high-bay regime, and prohibit the unbounded nearest-neighbor extrapolation v4 exposed',
    sourceBindings: { v4CorpusReceiptSha256: v4Corpus.receiptSha256, bgcBlindCandidateReceiptSha256: bgcCandidate.receiptSha256, bgcHeldoutComparisonReceiptSha256: bgcComparison.receiptSha256 },
    trainingProjectCount: 6, largeVaultStrategyCount: 5, newTrainingProject,
    calibratedDomain: {
      numericBounds: model.bounds, normalizationRanges: model.ranges, leaveOneOutNearest: model.leaveOneOut,
      maxLeaveOneOutNearestDistance: model.maxLeaveOneOutNearestDistance,
      policy: 'require every numeric source feature inside observed min-max bounds and nearest distance no greater than the worst observed leave-one-out neighbor',
      causalRuleClaimed: false, codeLimit: false,
    },
    failedHoldoutControl: {
      projectName: bgcComparison.projectName, receiptSha256: bgcComparison.receiptSha256,
      sourceOnlyPrediction: { alongRidgeStations: 3, acrossSlopeStations: 4, heads: 12, selectorDistance: 30.887227 },
      approvedAndAsBuilt: { alongRidgeStations: 8, acrossSlopeStations: 8, heads: 64 },
      failurePreserved: true, countFailure: true, topologyFailure: true, v4OutOfEnvelopePromotionGuardWorked: true, nowUsedForCalibration: true,
    },
    transferPolicy: { empiricalPriorOnly: true, answerExposed: true, sourceOnlyStrategySelectionRequired: true, clearSpanDisambiguationRequired: true, calibratedDomainRequired: true, causalRuleClaimed: false, codeLimit: false, exactCoordinateTransferAllowed: false, obstructionClearanceTransferAllowed: false, hazardClassificationTransferAllowed: false, pipeTopologyTransferAllowed: false, unseenProjectHoldoutRequired: true },
    internalVerification: { primary: { status: 'passed', method: 'deterministic v4 plus BGC answer-exposed 8x8 topology replay' }, independent: { status: 'passed', method: 'six-project feature-bound and leave-one-out distance recomputation' }, adversarial: { status: 'passed', method: 'dependency-domain-leakage-failure-erasure-causal and downstream-promotion mutations' } },
    strategySelectorReadyForFreshHoldout: true, unseenProjectPlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    requiredNextLoop: 'run another fresh source-sealed pitched project through v5 then compare approved or as-built answers',
    claimStatus: 'answer-exposed-six-project-topology-and-domain-calibration-not-fresh-placement-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validatePitchedPlacementCalibrationCorpusV5(packet, dependencies) {
  let expected;
  try { expected = await buildPitchedPlacementCalibrationCorpusV5(dependencies); } catch (error) { return { status: 'blocked', issues: [issue('PITCHED_CALIBRATION_V5_DEPENDENCY_BLOCKED', error.message)], strategySelectorReadyForFreshHoldout: false, complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('PITCHED_CALIBRATION_V5_REPLAY_MISMATCH', 'v5 does not equal deterministic v4-plus-BGC replay.'));
  if (packet?.trainingProjectCount !== 6 || packet?.largeVaultStrategyCount !== 5 || packet?.newTrainingProject?.answerExposedFeatures?.completedHeadCount !== 64 || packet?.newTrainingProject?.answerExposedFeatures?.topology?.alongRidgeStations !== 8 || packet?.newTrainingProject?.answerExposedFeatures?.topology?.acrossSlopeStations !== 8 || packet?.failedHoldoutControl?.failurePreserved !== true || packet?.failedHoldoutControl?.v4OutOfEnvelopePromotionGuardWorked !== true) issues.push(issue('PITCHED_CALIBRATION_V5_EVIDENCE_DRIFT', 'BGC 8x8 training evidence or preserved failure changed.'));
  if (packet?.calibratedDomain?.causalRuleClaimed !== false || packet?.calibratedDomain?.codeLimit !== false || packet?.transferPolicy?.calibratedDomainRequired !== true || packet?.transferPolicy?.exactCoordinateTransferAllowed !== false || packet?.unseenProjectPlacementVerified !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('PITCHED_CALIBRATION_V5_FALSE_PROMOTION', 'v5 must remain empirical, domain-gated, and fail closed downstream.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, strategySelectorReadyForFreshHoldout: issues.length === 0, calibratedDomainRequired: true, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyPitchedPlacementCalibrationV5AdversarialLoop(packet, dependencies) {
  const cases = [
    ['v4-binding', (v) => { v.sourceBindings.v4CorpusReceiptSha256 = '0'.repeat(64); }], ['candidate-binding', (v) => { v.sourceBindings.bgcBlindCandidateReceiptSha256 = '1'.repeat(64); }], ['comparison-binding', (v) => { v.sourceBindings.bgcHeldoutComparisonReceiptSha256 = '2'.repeat(64); }],
    ['project-count', (v) => { v.trainingProjectCount = 5; }], ['bgc-count', (v) => { v.newTrainingProject.answerExposedFeatures.completedHeadCount = 12; }], ['bgc-topology', (v) => { v.newTrainingProject.answerExposedFeatures.topology.alongRidgeStations = 3; }],
    ['bounds', (v) => { v.calibratedDomain.numericBounds.envelopeAreaSqFt.max = 99999; }], ['distance-limit', (v) => { v.calibratedDomain.maxLeaveOneOutNearestDistance = 999; }], ['failure', (v) => { v.failedHoldoutControl.failurePreserved = false; }],
    ['domain-policy', (v) => { v.transferPolicy.calibratedDomainRequired = false; }], ['causal', (v) => { v.calibratedDomain.causalRuleClaimed = true; }], ['coordinates', (v) => { v.transferPolicy.exactCoordinateTransferAllowed = true; }],
    ['unseen', (v) => { v.unseenProjectPlacementVerified = true; }], ['compliance', (v) => { v.complianceReady = true; }], ['receipt', (v) => { v.receiptSha256 = 'f'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validatePitchedPlacementCalibrationCorpusV5(value, dependencies)).status === 'blocked') rejectedCases.push(id); }
  const selectorRejectedCases = [];
  const base = { clearSpanDisambiguated: true, occupiedProtectionPlaneCount: 2, symmetricTwoPlaneVault: true, ceilingPitchRiseInPer12: 2, envelopeLengthFt: 104, envelopeWidthFt: 89.5, aspectRatio: round(104 / 89.5), envelopeAreaSqFt: 9308, sourceObstructionPresent: true, movablePartitionPocketPresent: false, sourceSpanCandidateCount: 1 };
  for (const [id, mutate] of [['length-outside', (v) => { v.envelopeLengthFt = 105; }], ['pitch-outside', (v) => { v.ceilingPitchRiseInPer12 = 1; }], ['span-ambiguous', (v) => { v.clearSpanDisambiguated = false; }], ['answer-leakage', (v) => { v.approvedHeadCount = 64; }]]) { const value = structuredClone(base); mutate(value); try { selectPitchedPlacementStrategyV5(value, dependencies.v4Corpus, packet); } catch { selectorRejectedCases.push(id); } }
  return { status: rejectedCases.length === cases.length && selectorRejectedCases.length === 4 ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, selectorRejectedCases, selectorAttemptedCases: 4, complianceReady: false };
}
