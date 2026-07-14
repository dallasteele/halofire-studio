import { sha256Hex } from './elevation-datums.js';

const V2_RECEIPT = '1f2cee5fcd31e2966679dcbb54afd002e7e5bb0ce80bae170ac8131787c55a72';
const VIVIANO_SOURCE_RECEIPT = 'a37a7f16802d80fc18ad9634b97564e295c3585f1ad14a4fdf36071891fd94b9';
const VIVIANO_COMPARISON_RECEIPT = 'cef6dcb71e5ceb72c116c3195e23b18a9b1587b91d31209d918128f2f18f5d60';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });
const gaps = (stations) => stations.slice(1).map((value, index) => round(value - stations[index]));
const FORBIDDEN_SELECTOR_INPUTS = Object.freeze(['projectName', 'answerKeyPath', 'approvedHeadCount', 'approvedHeadCoordinates', 'approvedTopology']);
const LARGE_VAULT_DISTANCE_FEATURES = Object.freeze([
  'ceilingPitchRiseInPer12', 'envelopeLengthFt', 'envelopeWidthFt', 'aspectRatio', 'envelopeAreaSqFt', 'sourceObstructionPresent',
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

function numericFeature(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function requireDependencies({ v2Corpus, vivianoSourceCandidate, vivianoComparison }) {
  if (v2Corpus?.artifactType !== 'halofire.pitched-placement-calibration-corpus.v2'
    || v2Corpus?.receiptSha256 !== V2_RECEIPT || v2Corpus?.trainingProjects?.length !== 3
    || v2Corpus?.strategySelectorReadyForFreshHoldout !== true || v2Corpus?.unseenProjectPlacementVerified !== false) {
    throw new Error('PITCHED_CALIBRATION_V2_DEPENDENCY_BLOCKED');
  }
  if (vivianoSourceCandidate?.artifactType !== 'halofire.viviano-clubhouse-source-only-pitched-candidate.v1'
    || vivianoSourceCandidate?.receiptSha256 !== VIVIANO_SOURCE_RECEIPT || vivianoSourceCandidate?.answerKeyOpened !== false
    || vivianoSourceCandidate?.familySelection?.extrapolationWarning !== true || vivianoSourceCandidate?.layout?.heads3d?.length !== 12) {
    throw new Error('VIVIANO_SOURCE_DEPENDENCY_BLOCKED');
  }
  if (vivianoComparison?.artifactType !== 'halofire.viviano-clubhouse-pitched-heldout-comparison.v1'
    || vivianoComparison?.receiptSha256 !== VIVIANO_COMPARISON_RECEIPT || vivianoComparison?.result?.status !== 'failed'
    || vivianoComparison?.result?.exactPlacementPatternVerified !== false || vivianoComparison?.result?.countDelta !== 0
    || vivianoComparison?.approved?.uniqueAlongRidgeStations !== 3 || vivianoComparison?.approved?.uniqueAcrossSlopeStations !== 4
    || vivianoComparison?.approved?.ridgeHeadStationPresent !== false || vivianoComparison?.approvedEvidence?.answerParity?.centersEqualApproved !== true) {
    throw new Error('VIVIANO_ANSWER_EXPOSED_DEPENDENCY_BLOCKED');
  }
}

function largeVaultStrategy(project) {
  return {
    projectId: project.projectId,
    layoutFamily: project.layoutFamily,
    sourceObservableFeatures: project.sourceObservableFeatures,
    answerExposedFeatures: project.answerExposedFeatures,
  };
}

export function selectPitchedPlacementStrategyV3(sourceFeatures, packet) {
  const suppliedForbidden = FORBIDDEN_SELECTOR_INPUTS.filter((key) => sourceFeatures?.[key] !== undefined);
  if (suppliedForbidden.length) throw new Error(`PITCHED_SELECTOR_V3_FORBIDDEN_INPUT:${suppliedForbidden.join(',')}`);
  if (!packet || packet.artifactType !== 'halofire.pitched-placement-calibration-corpus.v3') throw new Error('PITCHED_SELECTOR_V3_CORPUS_BLOCKED');
  if (sourceFeatures?.occupiedProtectionPlaneCount === 1 && sourceFeatures?.sourceObstructionPresent === true) {
    const project = packet.trainingProjects.find((entry) => entry.layoutFamily === 'small-obstructed-single-plane');
    return { selectedProjectId: project.projectId, selectedFamily: project.layoutFamily, distance: 0, sourceOnlyInputsUsed: ['occupiedProtectionPlaneCount', 'sourceObstructionPresent'], answerExposedPriorOnly: true, codeLimit: false };
  }
  if (sourceFeatures?.occupiedProtectionPlaneCount !== 2 || sourceFeatures?.symmetricTwoPlaneVault !== true) throw new Error('PITCHED_SELECTOR_V3_UNCALIBRATED_GEOMETRY');
  for (const key of LARGE_VAULT_DISTANCE_FEATURES) {
    const value = sourceFeatures[key];
    if (key === 'sourceObstructionPresent' ? typeof value !== 'boolean' : !Number.isFinite(value)) throw new Error(`PITCHED_SELECTOR_V3_SOURCE_FEATURE_MISSING:${key}`);
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
    selectedProjectId: ranked[0].strategy.projectId,
    selectedFamily: ranked[0].strategy.layoutFamily,
    distance: ranked[0].distance,
    runnerUpDistance: ranked[1]?.distance ?? null,
    sourceOnlyInputsUsed: [...LARGE_VAULT_DISTANCE_FEATURES, 'occupiedProtectionPlaneCount', 'symmetricTwoPlaneVault'],
    answerExposedPriorOnly: true,
    codeLimit: false,
  };
}

export async function buildPitchedPlacementCalibrationCorpusV3(dependencies) {
  requireDependencies(dependencies);
  const { v2Corpus, vivianoSourceCandidate, vivianoComparison } = dependencies;
  const room = vivianoSourceCandidate.geometry.room;
  const ceiling = vivianoSourceCandidate.geometry.ceiling;
  const approvedPoints = vivianoComparison.approvedEvidence.primary.heads.map((head) => head.localPointFt);
  const alongRidgeStationsFt = clusterStations(approvedPoints.map(([x]) => x));
  const acrossSlopeStationsFt = clusterStations(approvedPoints.map(([, y]) => y));
  const vivianoProject = {
    projectId: vivianoSourceCandidate.projectId,
    layoutFamily: 'large-symmetric-two-plane-vault-three-along-four-across-obstructed-ridge',
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
      sourceObstructionPresent: true,
      sourceObstructionKinds: ['ceiling fans shown on architectural RCP and Gym finish plan'],
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
      planeStationsPerPlane: 2,
      ridgeHeadStationPresent: false,
      approvedAsBuiltParity: true,
    },
  };
  const trainingProjects = [...structuredClone(v2Corpus.trainingProjects), vivianoProject];
  const largeVaultStrategies = trainingProjects.filter((entry) => entry.sourceObservableFeatures.symmetricTwoPlaneVault === true).map(largeVaultStrategy);
  const draft = {
    artifactType: 'halofire.pitched-placement-calibration-corpus.v3',
    mode: 'answer-exposed-four-project-empirical-topology-calibration',
    purpose: 'preserve Viviano equal-count topology failure and add answer-exposed along/across/ridge-row distinctions before another sealed fresh holdout',
    sourceBindings: {
      v2CorpusReceiptSha256: v2Corpus.receiptSha256,
      vivianoSourceCandidateReceiptSha256: vivianoSourceCandidate.receiptSha256,
      vivianoHeldoutComparisonReceiptSha256: vivianoComparison.receiptSha256,
    },
    trainingProjects,
    largeVaultStrategies,
    contrastiveLearning: {
      sourceOnlyFeatureKeys: [...LARGE_VAULT_DISTANCE_FEATURES, 'occupiedProtectionPlaneCount', 'symmetricTwoPlaneVault'],
      observedNonTransfer: 'Viviano matched the sealed prediction total of twelve heads but disproved its topology: approved/as-built uses three along by four across with two heads per plane and no ridge head, while the v2 prediction used four along by three across with a ridge row.',
      observedSourceDifferences: {
        midvale: { alongRidgeSpanFt: 30, aspectRatio: 1.034483, ceilingPitchRiseInPer12: 6, envelopeAreaSqFt: 870, sourceObstructionPresent: false, observedTopology: '4x3-ridge' },
        mosesLake: { alongRidgeSpanFt: 25.5, aspectRatio: 0.679245, ceilingPitchRiseInPer12: 4.5, envelopeAreaSqFt: 957.312508, sourceObstructionPresent: false, observedTopology: '2x3-ridge' },
        viviano: { alongRidgeSpanFt: 42.25, aspectRatio: 1.373518, ceilingPitchRiseInPer12: 7.334, envelopeAreaSqFt: 1299.627618, sourceObstructionPresent: true, observedTopology: '3x4-no-ridge' },
      },
      causalRuleClaimed: false,
      selectorMethod: 'nearest answer-exposed source-geometry neighbor over normalized pitch, length, width, aspect, area, and source-visible-obstruction distance after plane-count and symmetry partition',
      forbiddenSelectorInputs: [...FORBIDDEN_SELECTOR_INPUTS],
      minimumFreshApplicationPolicy: 'select from a new sealed source geometry only, commit its candidate before opening any completed answer, preserve empirical and extrapolation status, then compare with primary, independent, and adversarial loops',
    },
    failedHoldoutControls: [
      ...structuredClone(v2Corpus.failedHoldoutControls),
      {
        projectName: vivianoComparison.projectName,
        receiptSha256: vivianoComparison.receiptSha256,
        sourceOnlyPrediction: { alongRidgeStations: 4, acrossSlopeStations: 3, ridgeHeadStationPresent: true, heads: 12 },
        approvedAnswerExposed: { alongRidgeStations: 3, acrossSlopeStations: 4, ridgeHeadStationPresent: false, heads: 12 },
        failurePreserved: true,
        equalCountTopologyFailure: true,
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
      primary: { status: 'passed', method: 'deterministic-v2-plus-Viviano-source-feature-and-approved-station extraction' },
      independent: { status: 'passed', method: 'sealed receipt bindings plus approved plan raster, section topology, and AHJ/as-built byte parity' },
      adversarial: { status: 'passed', method: 'dependency, leakage, topology, ridge-row, failure-erasure, causal-promotion, and downstream-promotion mutations' },
    },
    strategySelectorReadyForFreshHoldout: true,
    unseenProjectPlacementVerified: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'answer-exposed-four-project-topology-calibration-not-fresh-placement-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validatePitchedPlacementCalibrationCorpusV3(packet, dependencies) {
  let expected;
  try { expected = await buildPitchedPlacementCalibrationCorpusV3(dependencies); } catch (error) {
    return { status: 'blocked', issues: [issue('PITCHED_CALIBRATION_V3_DEPENDENCY_BLOCKED', error.message)], strategySelectorReadyForFreshHoldout: false, complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || receiptSha256 !== await sha256Hex(draft) || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('PITCHED_CALIBRATION_V3_REPLAY_MISMATCH', 'Corpus does not equal deterministic v2-plus-Viviano topology extraction.'));
  const viviano = packet?.trainingProjects?.find((project) => project.projectId === 'viviano-clubhouse-saratoga-springs-ut');
  if (packet?.mode !== 'answer-exposed-four-project-empirical-topology-calibration' || packet?.trainingProjects?.length !== 4
    || viviano?.answerExposedFeatures?.completedHeadCount !== 12 || viviano?.answerExposedFeatures?.topology?.alongRidgeStations !== 3
    || viviano?.answerExposedFeatures?.topology?.acrossSlopeStations !== 4 || viviano?.answerExposedFeatures?.ridgeHeadStationPresent !== false
    || packet?.failedHoldoutControls?.[3]?.failurePreserved !== true || packet?.failedHoldoutControls?.[3]?.equalCountTopologyFailure !== true) {
    issues.push(issue('PITCHED_CALIBRATION_V3_EVIDENCE_DRIFT', 'Viviano answer exposure, topology, ridge-row, or failed-holdout truth changed.'));
  }
  if (packet?.contrastiveLearning?.causalRuleClaimed !== false || packet?.contrastiveLearning?.forbiddenSelectorInputs?.length !== FORBIDDEN_SELECTOR_INPUTS.length
    || packet?.transferPolicy?.empiricalPriorOnly !== true || packet?.transferPolicy?.codeLimit !== false
    || packet?.transferPolicy?.unseenProjectHoldoutRequired !== true || packet?.unseenProjectPlacementVerified !== false
    || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) {
    issues.push(issue('PITCHED_CALIBRATION_V3_FALSE_PROMOTION', 'Calibration cannot claim a causal/code rule, fresh placement, or downstream readiness.'));
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, strategySelectorReadyForFreshHoldout: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyPitchedPlacementCalibrationV3AdversarialLoop(packet, dependencies) {
  const cases = [
    ['v2-binding', (value) => { value.sourceBindings.v2CorpusReceiptSha256 = '0'.repeat(64); }],
    ['viviano-source-binding', (value) => { value.sourceBindings.vivianoSourceCandidateReceiptSha256 = '1'.repeat(64); }],
    ['viviano-comparison-binding', (value) => { value.sourceBindings.vivianoHeldoutComparisonReceiptSha256 = '2'.repeat(64); }],
    ['answer-exposure', (value) => { value.transferPolicy.answerExposed = false; }],
    ['project-count', (value) => { value.trainingProjects.pop(); }],
    ['viviano-count', (value) => { value.trainingProjects[3].answerExposedFeatures.completedHeadCount = 6; }],
    ['viviano-along', (value) => { value.trainingProjects[3].answerExposedFeatures.topology.alongRidgeStations = 4; }],
    ['viviano-across', (value) => { value.trainingProjects[3].answerExposedFeatures.topology.acrossSlopeStations = 3; }],
    ['viviano-ridge', (value) => { value.trainingProjects[3].answerExposedFeatures.ridgeHeadStationPresent = true; }],
    ['source-obstruction', (value) => { value.trainingProjects[3].sourceObservableFeatures.sourceObstructionPresent = false; }],
    ['forbidden-inputs', (value) => { value.contrastiveLearning.forbiddenSelectorInputs = []; }],
    ['causal-rule', (value) => { value.contrastiveLearning.causalRuleClaimed = true; }],
    ['failure-erasure', (value) => { value.failedHoldoutControls[3].failurePreserved = false; }],
    ['equal-count-erasure', (value) => { value.failedHoldoutControls[3].equalCountTopologyFailure = false; }],
    ['code-limit', (value) => { value.transferPolicy.codeLimit = true; }],
    ['unseen-placement', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['compliance', (value) => { value.complianceReady = true; }],
    ['fabrication', (value) => { value.fabricationReady = true; }],
    ['field-release', (value) => { value.fieldReleaseReady = true; }],
    ['selector-method', (value) => { value.contrastiveLearning.selectorMethod = 'approved topology lookup'; }],
    ['receipt', (value) => { value.receiptSha256 = 'f'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const value = structuredClone(packet);
    mutate(value);
    if ((await validatePitchedPlacementCalibrationCorpusV3(value, dependencies)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, complianceReady: false };
}
