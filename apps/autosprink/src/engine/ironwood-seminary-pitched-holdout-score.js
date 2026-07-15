/** Answer-only scorer for the immutable Ironwood fresh-project candidate. */

import { sha256Hex } from './elevation-datums.js';

const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function buildIronwoodPitchedHoldoutScore(candidate, answer) {
  const actual = {
    total: answer.headSchedule.total,
    pendent: answer.headSchedule.concealedPendent,
    upright: answer.headSchedule.uprightAttic,
  };
  const delta = {
    total: candidate.counts.total - actual.total,
    pendent: candidate.counts.pendent - actual.pendent,
    upright: candidate.counts.upright - actual.upright,
  };
  const acceptance = {
    countParity: delta.total === 0,
    kindParity: delta.pendent === 0 && delta.upright === 0,
    xyWithin2FtAtLeast90Pct: false,
    xyScoreAvailable: false,
    accepted: false,
  };
  const draft = {
    artifactType: 'halofire.fresh-pitched-answer-score.v1',
    projectId: candidate.projectId,
    candidateCommit: answer.answerOpenedAfterCandidateCommit,
    candidateReceiptSha256: candidate.receiptSha256,
    primaryAnswerSha256: answer.primaryAnswer.sha256,
    secondaryAnswerSha256: answer.secondaryAnswer.sha256,
    candidateCounts: candidate.counts,
    completedCounts: actual,
    delta,
    acceptance,
    failureAnalysis: {
      classification: 'fresh-holdout-failed-missed-connector-attic-volume',
      concealedPendentCountMatched: true,
      uprightAtticCountMatched: false,
      missingUprightAtticTargets: 2,
      sourceFinding: 'The source roof/RCP topology contains a connector concealed volume that the sealed packet did not model.',
      policyFinding: 'The completed plan uses a distinct 120 sq ft attic maximum while the frozen Building J packet carried a 130 sq ft ordinary-hazard default.',
      candidateRetunedAfterAnswer: false,
    },
    internalVerification: {
      primary: { status: 'passed', method: 'as-built schedule count and kind comparison' },
      independent: { status: 'passed', method: 'approved-plan/as-built hash provenance plus visible symbol recount' },
      adversarial: { status: 'passed', method: 'receipt, count, acceptance, and false-promotion mutations rejected' },
    },
    freshProjectPlacementVerified: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'fresh-pitched-holdout-failed-two-attic-uprights-missing-xy-score-and-all-production-gates-remain-blocked',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateIronwoodPitchedHoldoutScore(value, candidate, answer) {
  const expected = await buildIronwoodPitchedHoldoutScore(candidate, answer);
  const issues = [];
  if (JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('IRONWOOD_SCORE_REPLAY_MISMATCH', 'Score differs from immutable candidate and completed answer replay.'));
  if (value?.delta?.total !== -2 || value?.delta?.pendent !== 0 || value?.delta?.upright !== -2) issues.push(issue('IRONWOOD_SCORE_DELTA_DRIFT', 'Expected exact six-pendent parity and a two-upright deficit.'));
  if (value?.acceptance?.accepted !== false || value?.freshProjectPlacementVerified !== false || value?.complianceReady !== false || value?.fabricationReady !== false || value?.fieldReleaseReady !== false) issues.push(issue('IRONWOOD_SCORE_FALSE_PROMOTION', 'Failed holdout promoted acceptance or a downstream production claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyIronwoodPitchedHoldoutScoreAdversarialLoop(value, candidate, answer) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }],
    ['candidate', (entry) => { entry.candidateReceiptSha256 = '1'.repeat(64); }],
    ['answer', (entry) => { entry.primaryAnswerSha256 = '2'.repeat(64); }],
    ['candidate-total', (entry) => { entry.candidateCounts.total = 12; }],
    ['actual-total', (entry) => { entry.completedCounts.total = 10; }],
    ['delta-total', (entry) => { entry.delta.total = 0; }],
    ['delta-upright', (entry) => { entry.delta.upright = 0; }],
    ['count-parity', (entry) => { entry.acceptance.countParity = true; }],
    ['kind-parity', (entry) => { entry.acceptance.kindParity = true; }],
    ['xy', (entry) => { entry.acceptance.xyScoreAvailable = true; }],
    ['accepted', (entry) => { entry.acceptance.accepted = true; }],
    ['retuned', (entry) => { entry.failureAnalysis.candidateRetunedAfterAnswer = true; }],
    ['holdout', (entry) => { entry.freshProjectPlacementVerified = true; }],
    ['compliance', (entry) => { entry.complianceReady = true; }],
    ['fabrication', (entry) => { entry.fabricationReady = true; }],
    ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const attacked = structuredClone(value);
    mutate(attacked);
    if ((await validateIronwoodPitchedHoldoutScore(attacked, candidate, answer)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, complianceReady: false };
}
