/**
 * V2 validation wrapper around the unchanged Building J answer-only scorer.
 *
 * The scoring arithmetic, registered-answer bindings, thresholds, and
 * acceptance policy remain in source-generated-placement-score.js. This file
 * adds only v2 candidate identity and fail-closed result verification.
 */

import { sha256Hex } from './elevation-datums.js';
import { buildMitRiversideBuildingJSourceGeneratedPlacementScore } from './mit-riverside-building-j-source-generated-placement-score.js';

const GENERATION_VERSION = 'source-topology-v2';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function buildMitRiversideBuildingJTopologyPlacementV2Score(candidate, answer, targets) {
  if (candidate?.generationVersion !== GENERATION_VERSION || candidate?.counts?.total !== 68) throw new Error('MIT_J_TOPOLOGY_V2_SCORE_CANDIDATE_IDENTITY_INVALID');
  return buildMitRiversideBuildingJSourceGeneratedPlacementScore(candidate, answer, targets);
}

export async function validateMitRiversideBuildingJTopologyPlacementV2Score(value, candidate, answer, targets) {
  let expected;
  try {
    expected = await buildMitRiversideBuildingJTopologyPlacementV2Score(candidate, answer, targets);
  } catch (error) {
    return { status: 'blocked', issues: [issue('MIT_J_TOPOLOGY_V2_SCORE_DEPENDENCY_BLOCKED', error.message)], buildingJCalibrationScored: false, complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = value || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('MIT_J_TOPOLOGY_V2_SCORE_REPLAY_MISMATCH', 'Score no longer equals the unchanged deterministic answer-only replay.'));
  if (value?.counts?.generated?.total !== 68 || value?.counts?.answer?.total !== 68 || value?.counts?.deltaTotal !== 0 || value?.counts?.generated?.upright !== 53 || value?.counts?.generated?.pendent !== 15) issues.push(issue('MIT_J_TOPOLOGY_V2_SCORE_COUNT_DRIFT', 'V2 generated and answer count or kind parity changed.'));
  if (value?.sequence?.sourceCandidateReceiptSha256 !== candidate?.receiptSha256 || value?.sequence?.sourceCandidateModifiedAfterAnswerOpen !== false || value?.sequence?.answerOpenedByScorerOnly !== true || value?.sequence?.scorerCanGenerateCandidates !== false) issues.push(issue('MIT_J_TOPOLOGY_V2_SCORE_SEQUENCE_INVALID', 'Scorer isolation or sealed v2 candidate binding changed.'));
  if (value?.freshProjectPlacementVerified !== false || value?.complianceReady !== false || value?.fabricationReady !== false || value?.fieldReleaseReady !== false) issues.push(issue('MIT_J_TOPOLOGY_V2_SCORE_FALSE_PROMOTION', 'Calibration promoted a fresh holdout, compliance, fabrication, or release claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, buildingJCalibrationScored: issues.length === 0, sourceGeneratedPlacementVerified: value?.sourceGeneratedPlacementVerified === true && issues.length === 0, complianceReady: false };
}

export async function verifyMitRiversideBuildingJTopologyPlacementV2ScoreAdversarialLoop(value, candidate, answer, targets) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }],
    ['candidate-binding', (entry) => { entry.sequence.sourceCandidateReceiptSha256 = '1'.repeat(64); }],
    ['candidate-mutation', (entry) => { entry.sequence.sourceCandidateModifiedAfterAnswerOpen = true; }],
    ['scorer-generation', (entry) => { entry.sequence.scorerCanGenerateCandidates = true; }],
    ['answer-binding', (entry) => { entry.answerBindings.headCoordinateReceiptSha256 = '2'.repeat(64); }],
    ['target-binding', (entry) => { entry.answerBindings.sourceProtectionTargetReceiptSha256 = '3'.repeat(64); }],
    ['generated-count', (entry) => { entry.counts.generated.total = 69; }],
    ['answer-count', (entry) => { entry.counts.answer.total = 69; }],
    ['threshold-score', (entry) => { entry.xyScore.thresholdMatches[1].matched -= 1; }],
    ['mean-distance', (entry) => { entry.xyScore.meanDistanceFt = 0; }],
    ['residual', (entry) => { entry.residualPairs[0].distanceFt = 0; }],
    ['acceptance', (entry) => { entry.acceptance.accepted = !entry.acceptance.accepted; }],
    ['placement', (entry) => { entry.sourceGeneratedPlacementVerified = !entry.sourceGeneratedPlacementVerified; }],
    ['fresh-holdout', (entry) => { entry.freshProjectPlacementVerified = true; }],
    ['hydraulic', (entry) => { entry.hydraulicCalculationReady = true; }],
    ['compliance', (entry) => { entry.complianceReady = true; }],
    ['fabrication', (entry) => { entry.fabricationReady = true; }],
    ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const attacked = structuredClone(value);
    mutate(attacked);
    if ((await validateMitRiversideBuildingJTopologyPlacementV2Score(attacked, candidate, answer, targets)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, complianceReady: false };
}
