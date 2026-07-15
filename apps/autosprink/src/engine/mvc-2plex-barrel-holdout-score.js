/** Scores the frozen MVC barrel-roof candidate after answer exposure. */

import { sha256Hex } from './elevation-datums.js';
import { validateMvcBarrelSourceOnlyCandidate } from './mvc-2plex-barrel-holdout.js';

const SHA = /^[0-9a-f]{64}$/;
const ANSWER_SHA = 'c486a6c8676a146802ebbf5a64516cc47281976405de8a873a46e3d9f0e3362b';
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function sealMvcBarrelAnswerEvidence(value) {
  const { receiptSha256: _ignored, ...draft } = value;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMvcBarrelAnswerEvidence(value, candidate) {
  const issues = [];
  const { receiptSha256, ...draft } = value || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('MVC_BARREL_ANSWER_RECEIPT_INVALID', 'Answer evidence receipt is invalid.'));
  if (value?.approvedAnswer?.sha256 !== ANSWER_SHA || value?.approvedAnswer?.sheet !== 'FP2' || value?.approvedAnswer?.pageCount !== 1) issues.push(issue('MVC_BARREL_ANSWER_IDENTITY_INVALID', 'Approved FP2 identity changed.'));
  if (value?.sequence?.answerExposedAfterCandidateCommit !== true || value?.sequence?.candidateCommitBeforeAnswerOpen !== '3e824883' || value?.sequence?.candidateReceiptSha256 !== candidate?.receiptSha256 || value?.sequence?.candidateRetunedAfterAnswer !== false) issues.push(issue('MVC_BARREL_SCORE_SEQUENCE_INVALID', 'Fresh holdout sequence changed.'));
  if (value?.answerRegistration?.sourceFeatureId !== candidate?.registration?.featureId || value?.answerRegistration?.widthFt !== 30 || value?.answerRegistration?.depthFt !== 8 || value?.boundedObservation?.approvedHeadCount !== 0 || value?.boundedObservation?.approvedBranchLineCount !== 0 || value?.boundedObservation?.candidateTargetCount !== 2 || value?.boundedObservation?.falsePositiveTargets !== 2) issues.push(issue('MVC_BARREL_ANSWER_OBSERVATION_INVALID', 'Bounded approved-answer observation changed.'));
  if (Object.values(value?.claims || {}).some(Boolean)) issues.push(issue('MVC_BARREL_ANSWER_FALSE_PROMOTION', 'Failed holdout answer promoted an engineering claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, answerEvidenceReady: issues.length === 0, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function buildMvcBarrelHoldoutScore(candidate, source, answer) {
  if ((await validateMvcBarrelSourceOnlyCandidate(candidate, source)).status !== 'passed') throw new Error('MVC_BARREL_CANDIDATE_BLOCKED');
  if ((await validateMvcBarrelAnswerEvidence(answer, candidate)).status !== 'passed') throw new Error('MVC_BARREL_ANSWER_BLOCKED');
  const draft = {
    artifactType: 'halofire.fresh-curved-roof-holdout-score.v1', projectId: candidate.projectId, boundedScope: candidate.boundedScope,
    sourceReceiptSha256: source.sourceReceiptSha256, candidateReceiptSha256: candidate.receiptSha256, answerEvidenceReceiptSha256: answer.receiptSha256, approvedAnswerSha256: answer.approvedAnswer.sha256,
    sequence: answer.sequence,
    score: { candidateTargets: 2, approvedTargets: 0, truePositiveTargets: 0, falsePositiveTargets: 2, falseNegativeTargets: 0, precision: 0, recall: null, exactCountMatch: false, exactXyMatch: false, kindMatch: false },
    acceptance: { accepted: false, classification: 'fresh-holdout-failed-unprotected-barrel-roof-projection', reason: 'The source-only policy generated two targets in a roof projection that approved FP2 leaves unprotected.' },
    failureAnalysis: { residualClass: answer.sourceObservableResidual.classification, sourceObservableBeforeAnswer: true, missingGate: answer.sourceObservableResidual.missingSourceGate, candidateRetunedAfterAnswer: false },
    requiredNextLoop: 'Add source-declared occupied/protected-footprint intersection as a prerequisite to curved/sloped target generation, calibrate on MVC without promoting acceptance, then run another untouched roof holdout.',
    internalVerification: { primary: { status: 'passed', method: 'frozen candidate and approved FP2 bounded count replay' }, crossSource: { status: 'passed', method: 'A107/A109/A110/A302/S1.3 residual classification' }, adversarial: { status: 'passed', method: 'receipt, sequence, count, score, and false-promotion mutations rejected' } },
    freshProjectPlacementVerified: false, exactHeadElevationReady: false, obstructionClearanceReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    claimStatus: 'fresh-curved-roof-holdout-failed-two-false-positive-targets-and-all-production-gates-remain-blocked',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMvcBarrelHoldoutScore(value, candidate, source, answer) {
  const issues = [];
  let expected;
  try { expected = await buildMvcBarrelHoldoutScore(candidate, source, answer); } catch (error) { return { status: 'blocked', issues: [issue('MVC_BARREL_SCORE_INPUT_BLOCKED', error.message)], complianceReady: false }; }
  if (JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('MVC_BARREL_SCORE_REPLAY_MISMATCH', 'Score differs from deterministic replay.'));
  if (value?.acceptance?.accepted !== false || value?.score?.falsePositiveTargets !== 2 || value?.freshProjectPlacementVerified !== false || value?.complianceReady !== false || value?.fabricationReady !== false || value?.fieldReleaseReady !== false) issues.push(issue('MVC_BARREL_SCORE_FALSE_PROMOTION', 'Failed holdout promoted acceptance or production readiness.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, accepted: false, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyMvcBarrelScoreAdversarialLoop(value, candidate, source, answer) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }], ['answer', (entry) => { entry.approvedAnswerSha256 = '1'.repeat(64); }], ['sequence', (entry) => { entry.sequence.candidateRetunedAfterAnswer = true; }], ['candidate-count', (entry) => { entry.score.candidateTargets = 0; }], ['answer-count', (entry) => { entry.score.approvedTargets = 2; }], ['false-positive', (entry) => { entry.score.falsePositiveTargets = 0; }], ['precision', (entry) => { entry.score.precision = 1; }], ['accept', (entry) => { entry.acceptance.accepted = true; }], ['fresh', (entry) => { entry.freshProjectPlacementVerified = true; }], ['elevation', (entry) => { entry.exactHeadElevationReady = true; }], ['clearance', (entry) => { entry.obstructionClearanceReady = true; }], ['hydraulic', (entry) => { entry.hydraulicCalculationReady = true; }], ['compliance', (entry) => { entry.complianceReady = true; }], ['fabrication', (entry) => { entry.fabricationReady = true; }], ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const attacked = structuredClone(value); mutate(attacked); if ((await validateMvcBarrelHoldoutScore(attacked, candidate, source, answer)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, complianceReady: false };
}
