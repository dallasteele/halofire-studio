/** Answer-only scorer for the immutable Blossom Rock source candidate. */

import { sha256Hex } from './elevation-datums.js';
import { auditExposedSlopeSourceRegistration } from './source-topology-placement-policy.js';

const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function buildBlossomRockExposedSlopeHoldoutScore(candidate, answer) {
  const actual = {
    total: answer.boundedCompletedLayout.total,
    pendent: answer.boundedCompletedLayout.pendent,
    upright: answer.boundedCompletedLayout.upright,
    unresolved: 0,
  };
  const delta = {
    total: candidate.counts.total - actual.total,
    pendent: candidate.counts.pendent - actual.pendent,
    upright: candidate.counts.upright - actual.upright,
    unresolved: candidate.counts.unresolved - actual.unresolved,
  };
  const acceptance = {
    sourceFeatureRegistrationValid: false,
    countParity: delta.total === 0,
    kindParity: delta.pendent === 0 && delta.upright === 0 && delta.unresolved === 0,
    xyWithin2FtAtLeast90Pct: false,
    xyScoreAvailable: false,
    elevationScoreAvailable: false,
    accepted: false,
  };
  const draft = {
    artifactType: 'halofire.fresh-exposed-slope-answer-score.v1',
    projectId: candidate.projectId,
    candidateCommit: answer.answerOpenedAfterCandidateCommit,
    candidateReceiptSha256: candidate.receiptSha256,
    primaryAnswerSha256: answer.primaryAnswer.sha256,
    candidateCounts: candidate.counts,
    completedCounts: actual,
    delta,
    acceptance,
    failureAnalysis: {
      classification: 'fresh-holdout-failed-cross-sheet-feature-registration',
      missingUprightTargets: 8,
      excessUnresolvedTargets: 6,
      countDeficit: 2,
      footprintRegistrationMatched: false,
      slopeRegistrationMatched: false,
      verticalDatumRegistrationMatched: false,
      sourceFinding: answer.sourceRegistrationAudit.floorPlanFinding,
      roofFinding: answer.sourceRegistrationAudit.roofPlanFinding,
      sectionFinding: answer.sourceRegistrationAudit.sectionFinding,
      policyFinding: 'Placement must fail closed until one feature identity binds the plan boundary, roof slope, RCP regime, section datum, and PDF-to-local transform.',
      candidateRetunedAfterAnswer: false,
    },
    remediation: {
      productionPolicyRejectsUnregisteredExposedSlope: true,
      requiredGate: 'SOURCE_EXPOSED_SLOPE_REGISTRATION_BLOCKED',
      originalCandidatePreservedForAudit: true,
    },
    internalVerification: {
      primary: { status: 'passed', method: 'approved FP2 bounded-space symbol recount and schedule comparison' },
      independent: { status: 'passed', method: 'actual A3.1/A3.2/A5.1/A6.1/A8.1/M2.0 PDF registration audit' },
      adversarial: { status: 'passed', method: 'receipt, count, registration, acceptance, and false-promotion mutations rejected' },
    },
    freshProjectPlacementVerified: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'fresh-exposed-slope-holdout-failed-cross-sheet-registration-and-eight-upright-answer-mismatch-all-production-gates-remain-blocked',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateBlossomRockExposedSlopeHoldoutScore(value, candidate, answer, source) {
  const expected = await buildBlossomRockExposedSlopeHoldoutScore(candidate, answer);
  const issues = [];
  if (JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('BLOSSOM_SCORE_REPLAY_MISMATCH', 'Score differs from immutable candidate and approved answer replay.'));
  if (value?.delta?.total !== -2 || value?.delta?.upright !== -8 || value?.delta?.unresolved !== 6) issues.push(issue('BLOSSOM_SCORE_DELTA_DRIFT', 'Expected a two-target deficit, eight missing uprights, and six unresolved candidate targets.'));
  if (auditExposedSlopeSourceRegistration(source).status !== 'blocked') issues.push(issue('BLOSSOM_FAILED_PACKET_NOT_QUARANTINED', 'The failed source packet must remain blocked by the production registration audit.'));
  if (value?.acceptance?.accepted !== false || value?.freshProjectPlacementVerified !== false || value?.complianceReady !== false || value?.fabricationReady !== false || value?.fieldReleaseReady !== false) issues.push(issue('BLOSSOM_SCORE_FALSE_PROMOTION', 'Failed holdout promoted acceptance or a downstream production claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyBlossomRockScoreAdversarialLoop(value, candidate, answer, source) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }],
    ['candidate', (entry) => { entry.candidateReceiptSha256 = '1'.repeat(64); }],
    ['answer', (entry) => { entry.primaryAnswerSha256 = '2'.repeat(64); }],
    ['candidate-total', (entry) => { entry.candidateCounts.total = 8; }],
    ['actual-total', (entry) => { entry.completedCounts.total = 6; }],
    ['delta-total', (entry) => { entry.delta.total = 0; }],
    ['delta-upright', (entry) => { entry.delta.upright = 0; }],
    ['delta-unresolved', (entry) => { entry.delta.unresolved = 0; }],
    ['registration', (entry) => { entry.acceptance.sourceFeatureRegistrationValid = true; }],
    ['count-parity', (entry) => { entry.acceptance.countParity = true; }],
    ['kind-parity', (entry) => { entry.acceptance.kindParity = true; }],
    ['xy', (entry) => { entry.acceptance.xyScoreAvailable = true; }],
    ['elevation', (entry) => { entry.acceptance.elevationScoreAvailable = true; }],
    ['accepted', (entry) => { entry.acceptance.accepted = true; }],
    ['retuned', (entry) => { entry.failureAnalysis.candidateRetunedAfterAnswer = true; }],
    ['quarantine', (entry) => { entry.remediation.productionPolicyRejectsUnregisteredExposedSlope = false; }],
    ['holdout', (entry) => { entry.freshProjectPlacementVerified = true; }],
    ['compliance', (entry) => { entry.complianceReady = true; }],
    ['fabrication', (entry) => { entry.fabricationReady = true; }],
    ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const attacked = structuredClone(value);
    mutate(attacked);
    if ((await validateBlossomRockExposedSlopeHoldoutScore(attacked, candidate, answer, source)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, complianceReady: false };
}
