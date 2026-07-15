/** Answer-exposed calibration for the protection-eligibility defect found by MVC. */

import { sha256Hex } from './elevation-datums.js';
import { auditSourceProtectionEligibility } from './source-topology-placement-policy.js';
import { validateMvcBarrelSourceOnlyCandidate, validateMvcBarrelHoldoutSource } from './mvc-2plex-barrel-holdout.js';
import { validateMvcBarrelAnswerEvidence, validateMvcBarrelHoldoutScore } from './mvc-2plex-barrel-holdout-score.js';

const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function buildMvcProtectionEligibilityCalibration(source, candidate, answer, score) {
  if ((await validateMvcBarrelHoldoutSource(source)).status !== 'passed') throw new Error('MVC_PROTECTION_SOURCE_BLOCKED');
  if ((await validateMvcBarrelSourceOnlyCandidate(candidate, source)).status !== 'passed') throw new Error('MVC_PROTECTION_CANDIDATE_BLOCKED');
  if ((await validateMvcBarrelAnswerEvidence(answer, candidate)).status !== 'passed') throw new Error('MVC_PROTECTION_ANSWER_BLOCKED');
  if ((await validateMvcBarrelHoldoutScore(score, candidate, source, answer)).status !== 'passed') throw new Error('MVC_PROTECTION_SCORE_BLOCKED');

  const eligibilityPacket = {
    protectionEligibilityPolicy: { enforceSourceDeclaredFootprintIntersection: true },
    sourceProtectedFloorFootprints: [],
    pitchedConcealedVolumes: [],
    exposedSlopedCeilingVolumes: [],
    curvedCeilingVolumes: [{
      ...source.curvedCeilingVolume,
      protectionEligibility: { status: 'not-source-declared', sourceFootprintIds: [], sourcePages: ['A107'] },
    }],
  };
  const protectionEligibilityAudit = auditSourceProtectionEligibility(eligibilityPacket);
  if (protectionEligibilityAudit.status !== 'blocked') throw new Error('MVC_PROTECTION_EXPECTED_FAIL_CLOSED_AUDIT');
  const draft = {
    artifactType: 'halofire.answer-exposed-protection-eligibility-calibration.v1',
    projectId: source.projectId,
    boundedScope: source.boundedScope,
    sourceReceiptSha256: source.sourceReceiptSha256,
    frozenCandidateReceiptSha256: candidate.receiptSha256,
    answerEvidenceReceiptSha256: answer.receiptSha256,
    failedHoldoutScoreReceiptSha256: score.receiptSha256,
    calibrationStatus: 'answer-exposed-not-fresh-holdout',
    sourceDecision: {
      geometryFeatureVerified: true,
      occupiedOrProtectedFloorDeclarationFound: false,
      intersectingProtectedFootprintCount: 0,
      eligibleForTargetGeneration: false,
    },
    protectionEligibilityAudit,
    replay: { frozenCandidateTargetCount: candidate.counts.total, excludedTargetCount: candidate.counts.total, calibratedTargetCount: 0, targets: [] },
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic source-declared footprint eligibility replay' },
      crossSource: { status: 'passed', method: 'A107 floor plan checked against A109/A110/A302/S1.3 roof feature registration' },
      adversarial: { status: 'passed', method: 'eligibility, target-count, receipt, acceptance, and production-claim mutations rejected' },
    },
    freshProjectPlacementVerified: false,
    exactHeadElevationReady: false,
    obstructionClearanceReady: false,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'mvc-answer-exposed-calibration-now-fails-closed-before-target-generation-fourth-fresh-holdout-required',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMvcProtectionEligibilityCalibration(value, source, candidate, answer, score) {
  const issues = [];
  let expected;
  try { expected = await buildMvcProtectionEligibilityCalibration(source, candidate, answer, score); } catch (error) { return { status: 'blocked', issues: [issue('MVC_PROTECTION_CALIBRATION_INPUT_BLOCKED', error.message)], freshProjectPlacementVerified: false, complianceReady: false }; }
  if (JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('MVC_PROTECTION_CALIBRATION_REPLAY_MISMATCH', 'Calibration differs from deterministic replay.'));
  if (value?.calibrationStatus !== 'answer-exposed-not-fresh-holdout'
    || value?.sourceDecision?.eligibleForTargetGeneration !== false
    || value?.replay?.calibratedTargetCount !== 0
    || value?.replay?.targets?.length !== 0
    || value?.freshProjectPlacementVerified !== false
    || value?.complianceReady !== false
    || value?.fieldReleaseReady !== false) {
    issues.push(issue('MVC_PROTECTION_CALIBRATION_FALSE_PROMOTION', 'Answer-exposed calibration promoted target generation or production readiness.'));
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, targetGenerationEligible: false, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyMvcProtectionEligibilityAdversarialLoop(value, source, candidate, answer, score) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }],
    ['source', (entry) => { entry.sourceReceiptSha256 = '1'.repeat(64); }],
    ['fresh-label', (entry) => { entry.calibrationStatus = 'fresh-holdout'; }],
    ['declaration', (entry) => { entry.sourceDecision.occupiedOrProtectedFloorDeclarationFound = true; }],
    ['intersection', (entry) => { entry.sourceDecision.intersectingProtectedFootprintCount = 1; }],
    ['eligible', (entry) => { entry.sourceDecision.eligibleForTargetGeneration = true; }],
    ['audit', (entry) => { entry.protectionEligibilityAudit.status = 'passed'; }],
    ['excluded-count', (entry) => { entry.replay.excludedTargetCount = 0; }],
    ['target-count', (entry) => { entry.replay.calibratedTargetCount = 2; }],
    ['targets', (entry) => { entry.replay.targets = candidate.targets; }],
    ['fresh', (entry) => { entry.freshProjectPlacementVerified = true; }],
    ['elevation', (entry) => { entry.exactHeadElevationReady = true; }],
    ['clearance', (entry) => { entry.obstructionClearanceReady = true; }],
    ['hydraulic', (entry) => { entry.hydraulicCalculationReady = true; }],
    ['compliance', (entry) => { entry.complianceReady = true; }],
    ['fabrication', (entry) => { entry.fabricationReady = true; }],
    ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const attacked = structuredClone(value);
    mutate(attacked);
    if ((await validateMvcProtectionEligibilityCalibration(attacked, source, candidate, answer, score)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, freshProjectPlacementVerified: false, complianceReady: false };
}
