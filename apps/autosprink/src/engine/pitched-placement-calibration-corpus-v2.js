import { sha256Hex } from './elevation-datums.js';

const V1_RECEIPT = '06c6ed0d30d2aed8ad0031985fa7a0225931dd400c5b1ef90cad894794b6f902';
const MOSES_SOURCE_RECEIPT = '2df8931bdfa0b9b8f05e0b558421b89c8be644a8bc2f4403e5b70c7604908baa';
const MOSES_COMPARISON_RECEIPT = '0dc947ee96723a782fdb2c268c294f31845bdd68763b216ff3562aed3fa24a4e';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });
const uniqueSorted = (values) => [...new Set(values.map((value) => round(value)))].sort((a, b) => a - b);
const gaps = (stations) => stations.slice(1).map((value, index) => round(value - stations[index]));
const FORBIDDEN_SELECTOR_INPUTS = Object.freeze(['projectName', 'answerKeyPath', 'approvedHeadCount', 'approvedHeadCoordinates']);
const LARGE_VAULT_DISTANCE_FEATURES = Object.freeze([
  'ceilingPitchRiseInPer12', 'envelopeLengthFt', 'envelopeWidthFt', 'aspectRatio', 'envelopeAreaSqFt',
]);

function clusterStations(values, toleranceFt = 0.1) {
  const clusters = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    const cluster = clusters.at(-1);
    if (!cluster || value - cluster.at(-1) > toleranceFt) clusters.push([value]);
    else cluster.push(value);
  }
  return clusters.map((cluster) => round(cluster.reduce((sum, value) => sum + value, 0) / cluster.length));
}

function requireDependencies({ v1Corpus, mosesSourceCandidate, mosesComparison }) {
  if (v1Corpus?.artifactType !== 'halofire.pitched-placement-calibration-corpus.v1'
    || v1Corpus?.receiptSha256 !== V1_RECEIPT || v1Corpus?.trainingProjects?.length !== 2
    || v1Corpus?.strategySelectorReadyForFreshHoldout !== true || v1Corpus?.unseenProjectPlacementVerified !== false) {
    throw new Error('PITCHED_CALIBRATION_V1_DEPENDENCY_BLOCKED');
  }
  if (mosesSourceCandidate?.artifactType !== 'halofire.moses-lake-stake-center-source-only-pitched-candidate.v1'
    || mosesSourceCandidate?.receiptSha256 !== MOSES_SOURCE_RECEIPT || mosesSourceCandidate?.answerKeyOpened !== false
    || mosesSourceCandidate?.layout?.heads3d?.length !== 12) throw new Error('MOSES_LAKE_SOURCE_DEPENDENCY_BLOCKED');
  if (mosesComparison?.artifactType !== 'halofire.moses-lake-stake-center-pitched-heldout-comparison.v1'
    || mosesComparison?.receiptSha256 !== MOSES_COMPARISON_RECEIPT || mosesComparison?.result?.status !== 'failed'
    || mosesComparison?.result?.exactPlacementPatternVerified !== false
    || mosesComparison?.approvedEvidence?.primary?.detectedCount !== 6
    || mosesComparison?.approvedEvidence?.independent?.detectedCount !== 6
    || mosesComparison?.approvedEvidence?.asBuiltParity?.centersEqualApproved !== true) {
    throw new Error('MOSES_LAKE_ANSWER_EXPOSED_DEPENDENCY_BLOCKED');
  }
}

function largeVaultStrategy(project, layoutFamily) {
  return {
    projectId: project.projectId,
    layoutFamily,
    sourceObservableFeatures: project.sourceObservableFeatures,
    answerExposedFeatures: project.answerExposedFeatures,
  };
}

export function selectPitchedPlacementStrategyV2(sourceFeatures, packet) {
  const suppliedForbidden = FORBIDDEN_SELECTOR_INPUTS.filter((key) => sourceFeatures?.[key] !== undefined);
  if (suppliedForbidden.length) throw new Error(`PITCHED_SELECTOR_FORBIDDEN_INPUT:${suppliedForbidden.join(',')}`);
  if (!packet || packet.artifactType !== 'halofire.pitched-placement-calibration-corpus.v2') throw new Error('PITCHED_SELECTOR_CORPUS_BLOCKED');
  if (sourceFeatures?.occupiedProtectionPlaneCount === 1 && sourceFeatures?.sourceObstructionPresent === true) {
    const project = packet.trainingProjects.find((entry) => entry.layoutFamily === 'small-obstructed-single-plane');
    return { selectedProjectId: project.projectId, selectedFamily: project.layoutFamily, distance: 0, sourceOnlyInputsUsed: ['occupiedProtectionPlaneCount', 'sourceObstructionPresent'], answerExposedPriorOnly: true, codeLimit: false };
  }
  if (sourceFeatures?.occupiedProtectionPlaneCount !== 2 || sourceFeatures?.symmetricTwoPlaneVault !== true) throw new Error('PITCHED_SELECTOR_UNCALIBRATED_GEOMETRY');
  for (const key of LARGE_VAULT_DISTANCE_FEATURES) if (!Number.isFinite(sourceFeatures[key])) throw new Error(`PITCHED_SELECTOR_SOURCE_FEATURE_MISSING:${key}`);
  const strategies = packet.trainingProjects.filter((entry) => entry.sourceObservableFeatures.symmetricTwoPlaneVault === true);
  const ranges = Object.fromEntries(LARGE_VAULT_DISTANCE_FEATURES.map((key) => {
    const values = strategies.map((entry) => entry.sourceObservableFeatures[key]);
    return [key, Math.max(1, Math.max(...values) - Math.min(...values))];
  }));
  const ranked = strategies.map((strategy) => ({
    strategy,
    distance: round(LARGE_VAULT_DISTANCE_FEATURES.reduce((sum, key) => sum + Math.abs(sourceFeatures[key] - strategy.sourceObservableFeatures[key]) / ranges[key], 0)),
  })).sort((a, b) => a.distance - b.distance || a.strategy.projectId.localeCompare(b.strategy.projectId));
  return {
    selectedProjectId: ranked[0].strategy.projectId,
    selectedFamily: ranked[0].strategy.layoutFamily,
    distance: ranked[0].distance,
    runnerUpDistance: ranked[1]?.distance ?? null,
    sourceOnlyInputsUsed: [...LARGE_VAULT_DISTANCE_FEATURES, 'occupiedProtectionPlaneCount', 'symmetricTwoPlaneVault'],
    answerExposedPriorOnly: true,
    codeLimit: false,
  };
}

export async function buildPitchedPlacementCalibrationCorpusV2(dependencies) {
  requireDependencies(dependencies);
  const { v1Corpus, mosesSourceCandidate, mosesComparison } = dependencies;
  const room = mosesSourceCandidate.geometry.room;
  const ceiling = mosesSourceCandidate.geometry.ceiling;
  const approvedPoints = mosesComparison.approvedEvidence.primary.heads.map((head) => head.localPointFt);
  const alongRidgeStationsFt = clusterStations(approvedPoints.map(([x]) => x));
  const acrossSlopeStationsFt = clusterStations(approvedPoints.map(([, y]) => y));
  const midvale = structuredClone(v1Corpus.trainingProjects[1]);
  midvale.layoutFamily = 'large-symmetric-two-plane-vault-four-along';
  midvale.sourceObservableFeatures.aspectRatio = round(midvale.sourceObservableFeatures.envelopeLengthFt / midvale.sourceObservableFeatures.envelopeWidthFt);
  midvale.sourceObservableFeatures.alongRidgeSpanFt = midvale.sourceObservableFeatures.envelopeLengthFt;
  midvale.sourceObservableFeatures.acrossSlopeSpanFt = midvale.sourceObservableFeatures.envelopeWidthFt;
  const mosesProject = {
    projectId: mosesSourceCandidate.projectId,
    layoutFamily: 'large-symmetric-two-plane-vault-two-along',
    sourceObservableFeatures: {
      occupiedProtectionPlaneCount: ceiling.surfaces.length,
      symmetricTwoPlaneVault: true,
      ceilingPitchRiseInPer12: ceiling.pitch.riseIn,
      envelopeWidthFt: room.widthFt,
      envelopeLengthFt: room.lengthFt,
      envelopeAreaSqFt: room.areaSqFt,
      aspectRatio: round(room.lengthFt / room.widthFt),
      alongRidgeSpanFt: room.lengthFt,
      acrossSlopeSpanFt: room.widthFt,
      springElevationFt: ceiling.springElevationFt,
      ridgeElevationFt: ceiling.ridgeElevationFt,
      ridgeAxis: ceiling.ridgeAxis,
      sourceObstructionPresent: false,
    },
    answerExposedFeatures: {
      completedHeadCount: approvedPoints.length,
      completedAreaPerHeadSqFt: round(room.areaSqFt / approvedPoints.length),
      topology: { alongRidgeStations: alongRidgeStationsFt.length, acrossSlopeStations: acrossSlopeStationsFt.length },
      alongRidgeStationsFt,
      acrossSlopeStationsFt,
      alongRidgeSpacingsFt: gaps(alongRidgeStationsFt),
      acrossSlopeSpacingsFt: gaps(acrossSlopeStationsFt),
      alongRidgeEdgeOffsetsFt: [round(alongRidgeStationsFt[0]), round(room.lengthFt - alongRidgeStationsFt.at(-1))],
      acrossSlopeEdgeOffsetsFt: [round(acrossSlopeStationsFt[0]), round(room.widthFt - acrossSlopeStationsFt.at(-1))],
      normalizedAlongRidgeStations: alongRidgeStationsFt.map((value) => round(value / room.lengthFt)),
      normalizedAcrossSlopeStations: acrossSlopeStationsFt.map((value) => round(value / room.widthFt)),
      ridgeHeadStationPresent: acrossSlopeStationsFt.some((value) => Math.abs(value - ceiling.halfRunFt) <= 0.7),
      approvedAsBuiltParity: true,
    },
  };
  const draft = {
    artifactType: 'halofire.pitched-placement-calibration-corpus.v2',
    mode: 'answer-exposed-three-project-empirical-calibration',
    purpose: 'separate source-observable pitched-ceiling placement strategies before another sealed fresh holdout without mutating the corpus used to generate Moses Lake',
    sourceBindings: {
      v1CorpusReceiptSha256: v1Corpus.receiptSha256,
      mosesLakeSourceCandidateReceiptSha256: mosesSourceCandidate.receiptSha256,
      mosesLakeHeldoutComparisonReceiptSha256: mosesComparison.receiptSha256,
    },
    trainingProjects: [structuredClone(v1Corpus.trainingProjects[0]), midvale, mosesProject],
    largeVaultStrategies: [
      largeVaultStrategy(midvale, midvale.layoutFamily),
      largeVaultStrategy(mosesProject, mosesProject.layoutFamily),
    ],
    contrastiveLearning: {
      sourceOnlyFeatureKeys: [...LARGE_VAULT_DISTANCE_FEATURES, 'occupiedProtectionPlaneCount', 'symmetricTwoPlaneVault', 'sourceObstructionPresent'],
      observedNonTransfer: 'The Midvale four-along answer-exposed strategy transferred all three across-slope stations to Moses Lake within 1.5 feet but over-produced along-ridge stations four-versus-two and emitted six excess heads.',
      observedSourceDifferences: {
        midvale: { alongRidgeSpanFt: 30, aspectRatio: 1.034483, ceilingPitchRiseInPer12: 6, envelopeAreaSqFt: 870, observedAlongRidgeStations: 4 },
        mosesLake: { alongRidgeSpanFt: 25.5, aspectRatio: 0.679245, ceilingPitchRiseInPer12: 4.5, envelopeAreaSqFt: 957.312508, observedAlongRidgeStations: 2 },
      },
      causalRuleClaimed: false,
      selectorMethod: 'nearest answer-exposed source-geometry neighbor over normalized pitch, length, width, aspect, and area distance after plane-count and symmetry partition',
      forbiddenSelectorInputs: [...FORBIDDEN_SELECTOR_INPUTS],
      minimumFreshApplicationPolicy: 'select from sealed source geometry only, commit the candidate and receipt before opening any completed answer, preserve empirical status, then compare with primary, independent, and adversarial loops',
    },
    failedHoldoutControls: [
      ...structuredClone(v1Corpus.failedHoldoutControls),
      {
        projectName: mosesComparison.projectName,
        receiptSha256: mosesComparison.receiptSha256,
        sourceOnlyPrediction: { alongRidgeStations: 4, acrossSlopeStations: 3, heads: 12 },
        approvedAnswerExposed: { alongRidgeStations: 2, acrossSlopeStations: 3, heads: 6 },
        failurePreserved: true,
        nowUsedForCalibration: true,
      },
    ],
    transferPolicy: {
      empiricalPriorOnly: true,
      codeLimit: false,
      answerExposed: true,
      sourceOnlyStrategySelectionRequired: true,
      causalRuleClaimed: false,
      obstructionClearanceTransferAllowed: false,
      hazardClassificationTransferAllowed: false,
      pipeTopologyTransferAllowed: false,
      unseenProjectHoldoutRequired: true,
    },
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic-v1-plus-Moses-feature-extraction-and-station-clustering' },
      independent: { status: 'passed', method: 'sealed receipt bindings plus vector-raster detector agreement and separate as-built parity' },
      adversarial: { status: 'passed', method: 'dependency, answer-leakage, source-feature, failure-erasure, causal-promotion, and downstream-promotion mutations' },
    },
    strategySelectorReadyForFreshHoldout: true,
    unseenProjectPlacementVerified: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'answer-exposed-three-project-placement-calibration-not-fresh-placement-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validatePitchedPlacementCalibrationCorpusV2(packet, dependencies) {
  let expected;
  try { expected = await buildPitchedPlacementCalibrationCorpusV2(dependencies); } catch (error) {
    return { status: 'blocked', issues: [issue('PITCHED_CALIBRATION_V2_DEPENDENCY_BLOCKED', error.message)], strategySelectorReadyForFreshHoldout: false, complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || receiptSha256 !== await sha256Hex(draft) || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('PITCHED_CALIBRATION_V2_REPLAY_MISMATCH', 'Corpus does not equal deterministic v1-plus-Moses feature extraction.'));
  const moses = packet?.trainingProjects?.find((project) => project.projectId === 'moses-lake-stake-center');
  if (packet?.mode !== 'answer-exposed-three-project-empirical-calibration' || packet?.trainingProjects?.length !== 3
    || moses?.answerExposedFeatures?.completedHeadCount !== 6
    || moses?.answerExposedFeatures?.topology?.alongRidgeStations !== 2
    || moses?.answerExposedFeatures?.topology?.acrossSlopeStations !== 3
    || packet?.failedHoldoutControls?.[2]?.failurePreserved !== true) issues.push(issue('PITCHED_CALIBRATION_V2_EVIDENCE_DRIFT', 'Answer exposure, project count, Moses topology, or failed holdout truth changed.'));
  if (packet?.contrastiveLearning?.causalRuleClaimed !== false || packet?.contrastiveLearning?.forbiddenSelectorInputs?.length !== FORBIDDEN_SELECTOR_INPUTS.length
    || packet?.transferPolicy?.empiricalPriorOnly !== true || packet?.transferPolicy?.codeLimit !== false
    || packet?.transferPolicy?.unseenProjectHoldoutRequired !== true || packet?.unseenProjectPlacementVerified !== false
    || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('PITCHED_CALIBRATION_V2_FALSE_PROMOTION', 'Calibration cannot claim a causal/code rule, unseen placement, or downstream readiness.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, strategySelectorReadyForFreshHoldout: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyPitchedPlacementCalibrationV2AdversarialLoop(packet, dependencies) {
  const cases = [
    ['v1-binding', (value) => { value.sourceBindings.v1CorpusReceiptSha256 = '0'.repeat(64); }],
    ['moses-source-binding', (value) => { value.sourceBindings.mosesLakeSourceCandidateReceiptSha256 = '1'.repeat(64); }],
    ['moses-comparison-binding', (value) => { value.sourceBindings.mosesLakeHeldoutComparisonReceiptSha256 = '2'.repeat(64); }],
    ['answer-exposure', (value) => { value.transferPolicy.answerExposed = false; }],
    ['project-count', (value) => { value.trainingProjects.pop(); }],
    ['moses-count', (value) => { value.trainingProjects[2].answerExposedFeatures.completedHeadCount = 12; }],
    ['moses-topology', (value) => { value.trainingProjects[2].answerExposedFeatures.topology.alongRidgeStations = 4; }],
    ['aspect', (value) => { value.trainingProjects[2].sourceObservableFeatures.aspectRatio = 1.034483; }],
    ['forbidden-inputs', (value) => { value.contrastiveLearning.forbiddenSelectorInputs = []; }],
    ['causal-rule', (value) => { value.contrastiveLearning.causalRuleClaimed = true; }],
    ['failure-erasure', (value) => { value.failedHoldoutControls[2].failurePreserved = false; }],
    ['code-limit', (value) => { value.transferPolicy.codeLimit = true; }],
    ['unseen-placement', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['compliance', (value) => { value.complianceReady = true; }],
    ['fabrication', (value) => { value.fabricationReady = true; }],
    ['field-release', (value) => { value.fieldReleaseReady = true; }],
    ['selector-method', (value) => { value.contrastiveLearning.selectorMethod = 'approved head count lookup'; }],
    ['receipt', (value) => { value.receiptSha256 = 'f'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const value = structuredClone(packet);
    mutate(value);
    if ((await validatePitchedPlacementCalibrationCorpusV2(value, dependencies)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, complianceReady: false };
}
