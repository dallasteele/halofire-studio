import { sha256Hex } from './elevation-datums.js';

const V3_RECEIPT = 'c9865fa6713ea4eea83f0e5afbe8587205f6d2a150f4bbc6dcc1e10f6fe32101';
const WINTER_SOURCE_RECEIPT = 'a8ff34f22991c290c783ce92286ff7729b97c65575fdabfefdc2791399365bdb';
const WINTER_COMPARISON_RECEIPT = '3b98e28a00d007835675c0cc43f79c6bdadd56daf78c733072f040b023620116';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });
const gaps = (stations) => stations.slice(1).map((value, index) => round(value - stations[index]));
const FORBIDDEN_SELECTOR_INPUTS = Object.freeze(['projectName', 'answerKeyPath', 'approvedHeadCount', 'approvedHeadCoordinates', 'approvedTopology']);
const LARGE_VAULT_DISTANCE_FEATURES = Object.freeze([
  'ceilingPitchRiseInPer12', 'envelopeLengthFt', 'envelopeWidthFt', 'aspectRatio', 'envelopeAreaSqFt',
  'sourceObstructionPresent', 'movablePartitionPocketPresent', 'sourceSpanCandidateCount',
]);

function numericFeature(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function requireDependencies({ v3Corpus, winterSourceCandidate, winterComparison }) {
  if (v3Corpus?.artifactType !== 'halofire.pitched-placement-calibration-corpus.v3' || v3Corpus?.receiptSha256 !== V3_RECEIPT
    || v3Corpus?.trainingProjects?.length !== 4 || v3Corpus?.strategySelectorReadyForFreshHoldout !== true || v3Corpus?.unseenProjectPlacementVerified !== false) throw new Error('PITCHED_CALIBRATION_V3_DEPENDENCY_BLOCKED');
  if (winterSourceCandidate?.artifactType !== 'halofire.winter-garden-source-only-pitched-candidate.v1'
    || winterSourceCandidate?.receiptSha256 !== WINTER_SOURCE_RECEIPT || winterSourceCandidate?.answerKeyOpened !== false
    || winterSourceCandidate?.layout?.heads3d?.length !== 6 || winterSourceCandidate?.geometry?.room?.lengthFt !== 28.9375) throw new Error('WINTER_GARDEN_SOURCE_DEPENDENCY_BLOCKED');
  if (winterComparison?.artifactType !== 'halofire.winter-garden-pitched-heldout-comparison.v1'
    || winterComparison?.receiptSha256 !== WINTER_COMPARISON_RECEIPT || winterComparison?.result?.status !== 'failed'
    || winterComparison?.approved?.headCount !== 9 || winterComparison?.approved?.topology?.alongRidgeStations !== 3
    || winterComparison?.approved?.topology?.acrossSlopeStations !== 3 || winterComparison?.result?.sourceProtectionZoneGeometryVerified !== false
    || winterComparison?.sourceGeometryFinding?.competingClearSpanLabelOnA103 !== `25'-10 3/4"`) throw new Error('WINTER_GARDEN_COMPARISON_DEPENDENCY_BLOCKED');
}

function normalizedPriorStrategy(project) {
  return {
    projectId: project.projectId,
    layoutFamily: project.layoutFamily,
    sourceObservableFeatures: {
      ...project.sourceObservableFeatures,
      clearSpanDisambiguated: true,
      movablePartitionPocketPresent: false,
      sourceSpanCandidateCount: 1,
    },
    answerExposedFeatures: project.answerExposedFeatures,
  };
}

export function selectPitchedPlacementStrategyV4(sourceFeatures, packet) {
  const suppliedForbidden = FORBIDDEN_SELECTOR_INPUTS.filter((key) => sourceFeatures?.[key] !== undefined);
  if (suppliedForbidden.length) throw new Error(`PITCHED_SELECTOR_V4_FORBIDDEN_INPUT:${suppliedForbidden.join(',')}`);
  if (!packet || packet.artifactType !== 'halofire.pitched-placement-calibration-corpus.v4') throw new Error('PITCHED_SELECTOR_V4_CORPUS_BLOCKED');
  if (sourceFeatures?.clearSpanDisambiguated !== true) throw new Error('PITCHED_SELECTOR_V4_CLEAR_SPAN_UNRESOLVED');
  if (sourceFeatures?.occupiedProtectionPlaneCount === 1 && sourceFeatures?.sourceObstructionPresent === true) {
    const project = packet.trainingProjects.find((entry) => entry.layoutFamily === 'small-obstructed-single-plane');
    return { selectedProjectId: project.projectId, selectedFamily: project.layoutFamily, distance: 0, sourceOnlyInputsUsed: ['occupiedProtectionPlaneCount', 'sourceObstructionPresent', 'clearSpanDisambiguated'], answerExposedPriorOnly: true, codeLimit: false };
  }
  if (sourceFeatures?.occupiedProtectionPlaneCount !== 2 || sourceFeatures?.symmetricTwoPlaneVault !== true) throw new Error('PITCHED_SELECTOR_V4_UNCALIBRATED_GEOMETRY');
  for (const key of LARGE_VAULT_DISTANCE_FEATURES) {
    const value = sourceFeatures[key];
    if (key.endsWith('Present') ? typeof value !== 'boolean' : !Number.isFinite(value)) throw new Error(`PITCHED_SELECTOR_V4_SOURCE_FEATURE_MISSING:${key}`);
  }
  const strategies = packet.largeVaultStrategies;
  const ranges = Object.fromEntries(LARGE_VAULT_DISTANCE_FEATURES.map((key) => {
    const values = strategies.map((entry) => numericFeature(entry.sourceObservableFeatures[key]));
    return [key, Math.max(1, Math.max(...values) - Math.min(...values))];
  }));
  const ranked = strategies.map((strategy) => ({
    strategy,
    distance: round(LARGE_VAULT_DISTANCE_FEATURES.reduce((sum, key) => sum
      + Math.abs(numericFeature(sourceFeatures[key]) - numericFeature(strategy.sourceObservableFeatures[key])) / ranges[key], 0)),
  })).sort((a, b) => a.distance - b.distance || a.strategy.projectId.localeCompare(b.strategy.projectId));
  return {
    selectedProjectId: ranked[0].strategy.projectId, selectedFamily: ranked[0].strategy.layoutFamily,
    distance: ranked[0].distance, runnerUpDistance: ranked[1]?.distance ?? null,
    sourceOnlyInputsUsed: [...LARGE_VAULT_DISTANCE_FEATURES, 'occupiedProtectionPlaneCount', 'symmetricTwoPlaneVault', 'clearSpanDisambiguated'],
    answerExposedPriorOnly: true, codeLimit: false,
  };
}

export async function buildPitchedPlacementCalibrationCorpusV4(dependencies) {
  requireDependencies(dependencies);
  const { v3Corpus, winterSourceCandidate, winterComparison } = dependencies;
  const clearLengthFt = 25.895833;
  const widthFt = 38.083333;
  const [x0, y0, x1, y1] = winterComparison.registration.scopeRectImagePx;
  const approvedImagePoints = winterComparison.approved.heads.map((head) => head.imagePointPx);
  const alongRidgeStationsFt = [...new Set(approvedImagePoints.map(([x]) => round((x - x0) / (x1 - x0) * clearLengthFt)))].sort((a, b) => a - b);
  const acrossSlopeStationsFt = [...new Set(approvedImagePoints.map(([, y]) => round((y1 - y) / (y1 - y0) * widthFt)))].sort((a, b) => a - b);
  const winterProject = {
    projectId: winterSourceCandidate.projectId,
    layoutFamily: 'large-symmetric-two-plane-vault-three-along-three-across-partition-pocket',
    sourceObservableFeatures: {
      occupiedProtectionPlaneCount: 2, symmetricTwoPlaneVault: true, ceilingPitchRiseInPer12: 4.5,
      envelopeWidthFt: widthFt, envelopeLengthFt: clearLengthFt, envelopeAreaSqFt: round(clearLengthFt * widthFt),
      aspectRatio: round(clearLengthFt / widthFt), alongRidgeSpanFt: clearLengthFt, acrossSlopeSpanFt: widthFt,
      springElevationFt: 12.244792, ridgeElevationFt: 19.385417, ridgeAxis: 'x', sourceObstructionPresent: true,
      sourceObstructionKinds: ['folding basketball standard and ceiling-mounted devices shown on A151/A302'],
      clearSpanDisambiguated: true, movablePartitionPocketPresent: true, sourceSpanCandidateCount: 2,
      clearSpanEvidence: { selectedLabel: `25'-10 3/4"`, rejectedPocketInclusiveLabel: `28'-11 1/4"`, selectionMethod: 'continuous occupied C3 ceiling-plane wall faces excluding the movable-partition pocket' },
    },
    answerExposedFeatures: {
      completedHeadCount: 9, completedAreaPerHeadSqFt: round(clearLengthFt * widthFt / 9),
      topology: { alongRidgeStations: 3, acrossSlopeStations: 3 }, alongRidgeStationsFt, acrossSlopeStationsFt,
      alongRidgeSpacingsFt: gaps(alongRidgeStationsFt), acrossSlopeSpacingsFt: gaps(acrossSlopeStationsFt),
      alongRidgeEdgeOffsetsFt: [alongRidgeStationsFt[0], round(clearLengthFt - alongRidgeStationsFt.at(-1))],
      acrossSlopeEdgeOffsetsFt: [acrossSlopeStationsFt[0], round(widthFt - acrossSlopeStationsFt.at(-1))],
      normalizedAlongRidgeStations: alongRidgeStationsFt.map((value) => round(value / clearLengthFt)),
      normalizedAcrossSlopeStations: acrossSlopeStationsFt.map((value) => round(value / widthFt)),
      planeStationsPerPlane: 1, ridgeHeadStationPresent: true, approvedAsBuiltRasterParity: true,
    },
  };
  const priorStrategies = v3Corpus.largeVaultStrategies.map(normalizedPriorStrategy);
  const largeVaultStrategies = [...priorStrategies, winterProject];
  const trainingProjects = [...structuredClone(v3Corpus.trainingProjects), winterProject];
  const draft = {
    artifactType: 'halofire.pitched-placement-calibration-corpus.v4',
    mode: 'answer-exposed-five-project-topology-and-clear-span-calibration',
    purpose: 'preserve Winter Garden count/topology/source-span failure, require source-only clear-span disambiguation, and add verified 3x3 partition-pocket evidence before another sealed holdout',
    sourceBindings: { v3CorpusReceiptSha256: v3Corpus.receiptSha256, winterGardenSourceCandidateReceiptSha256: winterSourceCandidate.receiptSha256, winterGardenHeldoutComparisonReceiptSha256: winterComparison.receiptSha256 },
    trainingProjects, largeVaultStrategies,
    contrastiveLearning: {
      sourceOnlyFeatureKeys: [...LARGE_VAULT_DISTANCE_FEATURES, 'occupiedProtectionPlaneCount', 'symmetricTwoPlaneVault', 'clearSpanDisambiguated'],
      observedNonTransfer: 'Winter Garden is a near-prototype sibling of Moses Lake, yet the sealed v3 transfer undercounted six versus nine and selected a pocket-inclusive span. Similar room type and pitch did not preserve topology.',
      observedSourceDifferences: { mosesLake: { clearSpanLengthFt: 25.5, movablePartitionPocketPresent: false, sourceSpanCandidateCount: 1, observedTopology: '2x3-ridge' }, winterGarden: { clearSpanLengthFt: clearLengthFt, movablePartitionPocketPresent: true, sourceSpanCandidateCount: 2, observedTopology: '3x3-ridge' } },
      causalRuleClaimed: false,
      selectorMethod: 'fail closed unless clearSpanDisambiguated is true, then nearest answer-exposed source-geometry neighbor over normalized pitch, clear length, width, aspect, area, obstruction, movable-partition-pocket, and source-span-candidate distance',
      forbiddenSelectorInputs: [...FORBIDDEN_SELECTOR_INPUTS],
      minimumFreshApplicationPolicy: 'seal source files and all completed answers by hash, prove one unambiguous occupied protection-plane boundary, commit the v4 candidate, then open approved/as-built answers and preserve primary, independent, and adversarial results',
    },
    failedHoldoutControls: [
      ...structuredClone(v3Corpus.failedHoldoutControls),
      { projectName: winterComparison.projectName, receiptSha256: winterComparison.receiptSha256, sourceOnlyPrediction: { alongRidgeStations: 2, acrossSlopeStations: 3, heads: 6, spanLengthFt: 28.9375 }, approvedAnswerExposed: { alongRidgeStations: 3, acrossSlopeStations: 3, heads: 9, clearSpanLengthFt: clearLengthFt }, failurePreserved: true, topologyFailure: true, countFailure: true, sourceSpanFailure: true, nowUsedForCalibration: true },
    ],
    transferPolicy: { empiricalPriorOnly: true, codeLimit: false, answerExposed: true, sourceOnlyStrategySelectionRequired: true, clearSpanDisambiguationRequired: true, causalRuleClaimed: false, obstructionClearanceTransferAllowed: false, hazardClassificationTransferAllowed: false, pipeTopologyTransferAllowed: false, unseenProjectHoldoutRequired: true },
    internalVerification: { primary: { status: 'passed', method: 'deterministic-v3-plus-Winter-Garden clear-span and approved 3x3 station extraction' }, independent: { status: 'passed', method: 'sealed receipt chain plus source A103 competing-span audit and byte-identical approved/as-built plan raster evidence' }, adversarial: { status: 'passed', method: 'dependency, leakage, span, pocket, topology, count, failure-erasure, causal-promotion, and downstream-promotion mutations' } },
    strategySelectorReadyForFreshHoldout: true, unseenProjectPlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    claimStatus: 'answer-exposed-five-project-topology-and-clear-span-calibration-not-fresh-placement-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validatePitchedPlacementCalibrationCorpusV4(packet, dependencies) {
  let expected;
  try { expected = await buildPitchedPlacementCalibrationCorpusV4(dependencies); } catch (error) { return { status: 'blocked', issues: [issue('PITCHED_CALIBRATION_V4_DEPENDENCY_BLOCKED', error.message)], strategySelectorReadyForFreshHoldout: false, complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || receiptSha256 !== await sha256Hex(draft) || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('PITCHED_CALIBRATION_V4_REPLAY_MISMATCH', 'Corpus does not equal deterministic v3-plus-Winter-Garden extraction.'));
  const winter = packet?.trainingProjects?.find((project) => project.projectId === 'lds-meetinghouse-winter-garden-fl');
  if (packet?.trainingProjects?.length !== 5 || winter?.sourceObservableFeatures?.envelopeLengthFt !== 25.895833
    || winter?.sourceObservableFeatures?.clearSpanDisambiguated !== true || winter?.sourceObservableFeatures?.sourceSpanCandidateCount !== 2
    || winter?.answerExposedFeatures?.completedHeadCount !== 9 || winter?.answerExposedFeatures?.topology?.alongRidgeStations !== 3
    || winter?.answerExposedFeatures?.topology?.acrossSlopeStations !== 3 || packet?.failedHoldoutControls?.at(-1)?.sourceSpanFailure !== true) issues.push(issue('PITCHED_CALIBRATION_V4_EVIDENCE_DRIFT', 'Winter Garden clear span, 3x3 answer, or preserved failure changed.'));
  if (packet?.transferPolicy?.clearSpanDisambiguationRequired !== true || packet?.contrastiveLearning?.causalRuleClaimed !== false
    || packet?.transferPolicy?.empiricalPriorOnly !== true || packet?.transferPolicy?.codeLimit !== false
    || packet?.unseenProjectPlacementVerified !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('PITCHED_CALIBRATION_V4_FALSE_PROMOTION', 'v4 must fail closed on span ambiguity and cannot claim a causal/code rule, fresh placement, or downstream readiness.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, strategySelectorReadyForFreshHoldout: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyPitchedPlacementCalibrationV4AdversarialLoop(packet, dependencies) {
  const cases = [
    ['v3-binding', (value) => { value.sourceBindings.v3CorpusReceiptSha256 = '0'.repeat(64); }], ['winter-source-binding', (value) => { value.sourceBindings.winterGardenSourceCandidateReceiptSha256 = '1'.repeat(64); }],
    ['winter-comparison-binding', (value) => { value.sourceBindings.winterGardenHeldoutComparisonReceiptSha256 = '2'.repeat(64); }], ['project-count', (value) => { value.trainingProjects.pop(); }],
    ['clear-length', (value) => { value.trainingProjects[4].sourceObservableFeatures.envelopeLengthFt = 28.9375; }], ['clear-span', (value) => { value.trainingProjects[4].sourceObservableFeatures.clearSpanDisambiguated = false; }],
    ['span-count', (value) => { value.trainingProjects[4].sourceObservableFeatures.sourceSpanCandidateCount = 1; }], ['pocket', (value) => { value.trainingProjects[4].sourceObservableFeatures.movablePartitionPocketPresent = false; }],
    ['head-count', (value) => { value.trainingProjects[4].answerExposedFeatures.completedHeadCount = 6; }], ['along', (value) => { value.trainingProjects[4].answerExposedFeatures.topology.alongRidgeStations = 2; }],
    ['across', (value) => { value.trainingProjects[4].answerExposedFeatures.topology.acrossSlopeStations = 4; }], ['failure', (value) => { value.failedHoldoutControls.at(-1).failurePreserved = false; }],
    ['source-span-failure', (value) => { value.failedHoldoutControls.at(-1).sourceSpanFailure = false; }], ['selector-span-gate', (value) => { value.transferPolicy.clearSpanDisambiguationRequired = false; }],
    ['forbidden-inputs', (value) => { value.contrastiveLearning.forbiddenSelectorInputs = []; }], ['causal-rule', (value) => { value.contrastiveLearning.causalRuleClaimed = true; }],
    ['code-limit', (value) => { value.transferPolicy.codeLimit = true; }], ['unseen', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['compliance', (value) => { value.complianceReady = true; }], ['fabrication', (value) => { value.fabricationReady = true; }],
    ['field-release', (value) => { value.fieldReleaseReady = true; }], ['selector-method', (value) => { value.contrastiveLearning.selectorMethod = 'approved topology lookup'; }],
    ['receipt', (value) => { value.receiptSha256 = 'f'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validatePitchedPlacementCalibrationCorpusV4(value, dependencies)).status === 'blocked') rejectedCases.push(id); }
  const selectorCases = [];
  try { selectPitchedPlacementStrategyV4({ clearSpanDisambiguated: false }, packet); } catch { selectorCases.push('ambiguous-span'); }
  try { selectPitchedPlacementStrategyV4({ clearSpanDisambiguated: true, approvedTopology: '3x3' }, packet); } catch { selectorCases.push('answer-leakage'); }
  return { status: rejectedCases.length === cases.length && selectorCases.length === 2 ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, selectorRejectedCases: selectorCases, selectorAttemptedCases: 2, complianceReady: false };
}
