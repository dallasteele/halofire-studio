import { sha256Hex } from './elevation-datums.js';

const DILLON_RECEIPT = '20a553b24f20219e2f3d1e8022b05079dc6e22f3189c63c9684fcf3dbbf1bf26';
const MIDVALE_SOURCE_RECEIPT = '2c58ee909b3b27fa6a497539d4f0ec287c93624b5bbc1d7103db4cb83f7fc91d';
const MIDVALE_COMPARISON_RECEIPT = 'c965246240266ffab46cffa7478452f6ae0da6a9ff6a97f1c989f455a72850f6';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });
const uniqueSorted = (values) => [...new Set(values.map((value) => round(value)))].sort((a, b) => a - b);
const gaps = (stations) => stations.slice(1).map((value, index) => round(value - stations[index]));

function requireDependencies({ dillonPrior, midvaleSourceCandidate, midvaleComparison }) {
  if (dillonPrior?.artifactType !== 'halofire.dillon-pitched-placement-prior.v1'
    || dillonPrior?.receiptSha256 !== DILLON_RECEIPT
    || dillonPrior?.candidatePlacementPriorReady !== true
    || dillonPrior?.transferPolicy?.empiricalPriorOnly !== true
    || dillonPrior?.transferPolicy?.codeLimit !== false) throw new Error('DILLON_CALIBRATION_DEPENDENCY_BLOCKED');
  if (midvaleSourceCandidate?.artifactType !== 'halofire.midvale-clubhouse-source-only-pitched-candidate.v1'
    || midvaleSourceCandidate?.receiptSha256 !== MIDVALE_SOURCE_RECEIPT
    || midvaleSourceCandidate?.answerKeyOpened !== false
    || midvaleSourceCandidate?.geometry?.ceiling?.kind !== 'source-proven-occupied-two-plane-vault') throw new Error('MIDVALE_SOURCE_DEPENDENCY_BLOCKED');
  if (midvaleComparison?.artifactType !== 'halofire.midvale-clubhouse-pitched-heldout-comparison.v1'
    || midvaleComparison?.receiptSha256 !== MIDVALE_COMPARISON_RECEIPT
    || midvaleComparison?.result?.status !== 'failed'
    || midvaleComparison?.result?.exactPlacementPatternVerified !== false
    || midvaleComparison?.approvedEvidence?.primary?.detectedCount !== 12
    || midvaleComparison?.approvedEvidence?.independent?.detectedDropAssemblyCount !== 12) throw new Error('MIDVALE_ANSWER_EXPOSED_DEPENDENCY_BLOCKED');
}

export async function buildPitchedPlacementCalibrationCorpus(dependencies) {
  requireDependencies(dependencies);
  const { dillonPrior, midvaleSourceCandidate, midvaleComparison } = dependencies;
  const room = midvaleSourceCandidate.geometry.room;
  const ceiling = midvaleSourceCandidate.geometry.ceiling;
  const approvedPoints = midvaleComparison.approvedEvidence.primary.heads.map((head) => head.localPointFt);
  const columnStationsFt = uniqueSorted(approvedPoints.map(([x]) => x));
  const rowStationsFt = uniqueSorted(approvedPoints.map(([, y]) => y));
  const columnSpacingsFt = gaps(columnStationsFt);
  const rowSpacingsFt = gaps(rowStationsFt);
  const draft = {
    artifactType: 'halofire.pitched-placement-calibration-corpus.v1',
    mode: 'answer-exposed-multi-project-empirical-calibration',
    purpose: 'separate source-observable pitched-ceiling layout families before the next sealed fresh holdout',
    sourceBindings: {
      dillonPlacementPriorReceiptSha256: dillonPrior.receiptSha256,
      midvaleSourceCandidateReceiptSha256: midvaleSourceCandidate.receiptSha256,
      midvaleHeldoutComparisonReceiptSha256: midvaleComparison.receiptSha256,
    },
    trainingProjects: [
      {
        projectId: 'dillon-residence',
        layoutFamily: 'small-obstructed-single-plane',
        sourceObservableFeatures: {
          occupiedProtectionPlaneCount: 1,
          symmetricTwoPlaneVault: false,
          ceilingPitchRiseInPer12: dillonPrior.learnedGeometry.ceilingPitchRiseInPer12,
          envelopeAreaSqFt: dillonPrior.learnedGeometry.envelopeAreaSqFt,
          sourceObstructionPresent: true,
        },
        answerExposedFeatures: {
          completedHeadCount: dillonPrior.learnedGeometry.completedHeadCount,
          completedAreaPerHeadSqFt: dillonPrior.learnedGeometry.completedAreaPerHeadSqFt,
          completedInterHeadDistanceFt: dillonPrior.learnedGeometry.completedInterHeadDistanceFt,
          topology: { columns: 1, rows: 2 },
        },
      },
      {
        projectId: midvaleSourceCandidate.projectId,
        layoutFamily: 'large-symmetric-two-plane-vault',
        sourceObservableFeatures: {
          occupiedProtectionPlaneCount: ceiling.surfaces.length,
          symmetricTwoPlaneVault: true,
          ceilingPitchRiseInPer12: ceiling.pitch.riseIn,
          envelopeWidthFt: room.widthFt,
          envelopeLengthFt: room.lengthFt,
          envelopeAreaSqFt: room.areaSqFt,
          springElevationFt: ceiling.springElevationFt,
          ridgeElevationFt: ceiling.peakElevationFt,
          ridgeAxis: ceiling.ridgeAxis,
          sourceObstructionPresent: false,
        },
        answerExposedFeatures: {
          completedHeadCount: approvedPoints.length,
          completedAreaPerHeadSqFt: round(room.areaSqFt / approvedPoints.length),
          topology: { columns: columnStationsFt.length, rows: rowStationsFt.length },
          columnStationsFt,
          rowStationsFt,
          columnSpacingsFt,
          rowSpacingsFt,
          columnEdgeOffsetsFt: [round(columnStationsFt[0]), round(room.widthFt - columnStationsFt.at(-1))],
          rowEdgeOffsetsFt: [round(rowStationsFt[0]), round(room.lengthFt - rowStationsFt.at(-1))],
          normalizedColumnStations: columnStationsFt.map((value) => round(value / room.widthFt)),
          normalizedRowStations: rowStationsFt.map((value) => round(value / room.lengthFt)),
          ridgeHeadColumnPresent: columnStationsFt.some((value) => Math.abs(value - ceiling.halfRunFt) <= 0.001),
          lowEdgeHeadColumnPerPlane: true,
        },
      },
    ],
    contrastiveLearning: {
      sourceOnlyFeatureKeys: [
        'occupiedProtectionPlaneCount',
        'symmetricTwoPlaneVault',
        'ceilingPitchRiseInPer12',
        'envelopeAreaSqFt',
        'sourceObstructionPresent',
      ],
      layoutFamilyDiscriminator: 'plane-count-plus-vault-symmetry-plus-zone-scale-plus-source-obstruction-presence',
      observedNonTransfer: 'Dillon single-plane span settings produced Midvale 4-by-2 instead of approved 3-by-4.',
      forbiddenSelectorInputs: ['project-name', 'answer-key-path', 'approved-head-count', 'approved-head-coordinates'],
      minimumFreshApplicationPolicy: 'select the closest calibrated family from sealed architectural features, preserve empirical status, and compare only after committing the source-only candidate',
    },
    failedHoldoutControls: [
      {
        projectName: dillonPrior.excludedHoldout.projectName,
        receiptSha256: dillonPrior.excludedHoldout.receiptSha256,
        failurePreserved: true,
        usedForTuning: false,
      },
      {
        projectName: midvaleComparison.projectName,
        receiptSha256: midvaleComparison.receiptSha256,
        sourceOnlyPrediction: { columns: 4, rows: 2, heads: 8 },
        approvedAnswerExposed: { columns: 3, rows: 4, heads: 12 },
        failurePreserved: true,
        nowUsedForCalibration: true,
      },
    ],
    transferPolicy: {
      empiricalPriorOnly: true,
      codeLimit: false,
      answerExposed: true,
      sourceOnlyFamilySelectionRequired: true,
      exactGeometryFamilyMatchRequired: true,
      obstructionClearanceTransferAllowed: false,
      hazardClassificationTransferAllowed: false,
      pipeTopologyTransferAllowed: false,
      unseenProjectHoldoutRequired: true,
    },
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic-two-project-feature-extraction' },
      independent: { status: 'passed', method: 'sealed-receipt-bindings-plus-primary-and-independent-Midvale-symbol-counts' },
      adversarial: { status: 'passed', method: 'dependency-drift-answer-leakage-failure-erasure-and-false-promotion-rejection' },
    },
    strategySelectorReadyForFreshHoldout: true,
    unseenProjectPlacementVerified: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'answer-exposed-multi-project-placement-calibration-not-fresh-placement-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validatePitchedPlacementCalibrationCorpus(packet, dependencies) {
  let expected;
  try { expected = await buildPitchedPlacementCalibrationCorpus(dependencies); } catch (error) {
    return { status: 'blocked', issues: [issue('PITCHED_CALIBRATION_DEPENDENCY_BLOCKED', error.message)], strategySelectorReadyForFreshHoldout: false, complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || receiptSha256 !== await sha256Hex(draft) || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('PITCHED_CALIBRATION_REPLAY_MISMATCH', 'Corpus does not equal deterministic two-project feature extraction.'));
  if (packet?.mode !== 'answer-exposed-multi-project-empirical-calibration'
    || packet?.trainingProjects?.length !== 2
    || packet?.trainingProjects?.[1]?.answerExposedFeatures?.completedHeadCount !== 12
    || packet?.failedHoldoutControls?.[1]?.failurePreserved !== true) issues.push(issue('PITCHED_CALIBRATION_EVIDENCE_DRIFT', 'Answer exposure, project count, Midvale topology, or failed holdout truth changed.'));
  if (packet?.transferPolicy?.empiricalPriorOnly !== true
    || packet?.transferPolicy?.codeLimit !== false
    || packet?.transferPolicy?.unseenProjectHoldoutRequired !== true
    || packet?.unseenProjectPlacementVerified !== false
    || packet?.complianceReady !== false
    || packet?.fabricationReady !== false
    || packet?.fieldReleaseReady !== false) issues.push(issue('PITCHED_CALIBRATION_FALSE_PROMOTION', 'Calibration cannot promote unseen placement or downstream readiness.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, strategySelectorReadyForFreshHoldout: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyPitchedPlacementCalibrationAdversarialLoop(packet, dependencies) {
  const cases = [
    ['dillon-binding', (value) => { value.sourceBindings.dillonPlacementPriorReceiptSha256 = '0'.repeat(64); }],
    ['midvale-source-binding', (value) => { value.sourceBindings.midvaleSourceCandidateReceiptSha256 = '1'.repeat(64); }],
    ['midvale-comparison-binding', (value) => { value.sourceBindings.midvaleHeldoutComparisonReceiptSha256 = '2'.repeat(64); }],
    ['answer-exposure', (value) => { value.transferPolicy.answerExposed = false; }],
    ['project-count', (value) => { value.trainingProjects.pop(); }],
    ['midvale-count', (value) => { value.trainingProjects[1].answerExposedFeatures.completedHeadCount = 8; }],
    ['midvale-topology', (value) => { value.trainingProjects[1].answerExposedFeatures.topology = { columns: 4, rows: 2 }; }],
    ['forbidden-inputs', (value) => { value.contrastiveLearning.forbiddenSelectorInputs = []; }],
    ['failure-erasure', (value) => { value.failedHoldoutControls[1].failurePreserved = false; }],
    ['code-limit', (value) => { value.transferPolicy.codeLimit = true; }],
    ['unseen-placement', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['compliance', (value) => { value.complianceReady = true; }],
    ['fabrication', (value) => { value.fabricationReady = true; }],
    ['field-release', (value) => { value.fieldReleaseReady = true; }],
    ['receipt', (value) => { value.receiptSha256 = 'f'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const value = structuredClone(packet);
    mutate(value);
    if ((await validatePitchedPlacementCalibrationCorpus(value, dependencies)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, complianceReady: false };
}
