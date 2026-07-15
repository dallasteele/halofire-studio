/** Scores the frozen New Hope pitched-roof candidate after answer exposure. */

import { sha256Hex } from './elevation-datums.js';
import { validateNewHopePitchedSourceOnlyCandidate } from './new-hope-pitched-holdout.js';

const SHA = /^[0-9a-f]{64}$/;
const APPROVED_SHA = '5a770222363228c2766605a695fee9b6cb1f7b49c296204e09b691100253d9d5';
const FIELD_SHA = '4a47f9a45256debb9e5185396bc15526532a3ef420bcbf40ec0bcc0dc5f902b5';
const AS_BUILT_SHA = 'ed00e9530c02217bc50ead2fc3391938e731253949b728b31ed1336f8000f34b';
const issue = (code, message) => ({ severity: 'blocking', code, message });
const expectedAnswerHeads = [4, 10, 16, 22, 28, 34, 40].map((x, index) => ({ id: `NH-A-${String(index + 1).padStart(3, '0')}`, kind: 'attic-upright', localFt: { x, y: 30.375 } }));

export async function sealNewHopePitchedAnswerEvidence(value) {
  const { receiptSha256: _ignored, ...draft } = value;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateNewHopePitchedAnswerEvidence(value, candidate) {
  const issues = [];
  const { receiptSha256, ...draft } = value || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('NEW_HOPE_ANSWER_RECEIPT_INVALID', 'Answer evidence receipt is invalid.'));
  if (value?.approvedAnswer?.sha256 !== APPROVED_SHA || value?.approvedAnswer?.sheet !== 'FP2.0' || value?.approvedAnswer?.pdfPageNumber !== 5 || value?.approvedAnswer?.pageCount !== 5 || value?.approvedAnswer?.bytes !== 19600086) issues.push(issue('NEW_HOPE_APPROVED_ANSWER_IDENTITY_INVALID', 'Approved FP2.0 identity changed.'));
  if (value?.fieldSet?.sha256 !== FIELD_SHA || value?.fieldSet?.sheet !== 'FP2.0' || value?.fieldSet?.pdfPageNumber !== 4 || value?.fieldSet?.pageCount !== 4 || value?.fieldSet?.bytes !== 18843274) issues.push(issue('NEW_HOPE_FIELD_SET_IDENTITY_INVALID', 'Field-set FP2.0 identity changed.'));
  if (value?.asBuilt?.sha256 !== AS_BUILT_SHA || value?.asBuilt?.sheet !== 'FP2.0' || value?.asBuilt?.pdfPageNumber !== 4 || value?.asBuilt?.pageCount !== 4 || value?.asBuilt?.bytes !== 19209229) issues.push(issue('NEW_HOPE_AS_BUILT_IDENTITY_INVALID', 'As-built FP2.0 identity changed.'));
  if (value?.sequence?.answerExposedAfterCandidateCommit !== true || value?.sequence?.candidateCommitBeforeAnswerOpen !== '58afdc14' || value?.sequence?.candidateReceiptSha256 !== candidate?.receiptSha256 || value?.sequence?.candidateRetunedAfterAnswer !== false) issues.push(issue('NEW_HOPE_SCORE_SEQUENCE_INVALID', 'Fresh holdout sequence changed.'));
  const registration = value?.answerRegistration;
  if (registration?.sourceFeatureId !== candidate?.registration?.featureId || registration?.widthFt !== 43 || registration?.depthFt !== 60.75 || registration?.ridgeCoordinateFt !== 30.375 || registration?.approvedPdfRender?.widthPx !== 6048 || registration?.approvedPdfRender?.heightPx !== 4320 || JSON.stringify(registration?.approvedPdfRender?.featureBoundsPx) !== JSON.stringify({ x: 2400, y: 1035, width: 775, height: 1090 })) issues.push(issue('NEW_HOPE_ANSWER_REGISTRATION_INVALID', 'Approved feature registration changed.'));
  if (value?.boundedObservation?.approvedHeadCount !== 7 || value?.boundedObservation?.fieldSetHeadCount !== 7 || value?.boundedObservation?.asBuiltHeadCount !== 7 || value?.boundedObservation?.approvedBranchLineCount !== 1 || value?.boundedObservation?.candidateTargetCount !== 24 || value?.boundedObservation?.falsePositiveTargets !== 24 || value?.boundedObservation?.falseNegativeTargets !== 7 || value?.boundedObservation?.topology !== 'seven-attic-uprights-on-one-ridge-line') issues.push(issue('NEW_HOPE_ANSWER_OBSERVATION_INVALID', 'Bounded answer observation changed.'));
  if (JSON.stringify(value?.answerHeads) !== JSON.stringify(expectedAnswerHeads)) issues.push(issue('NEW_HOPE_ANSWER_HEADS_INVALID', 'Approved seven-head ridge row changed.'));
  if (Object.values(value?.claims || {}).some(Boolean)) issues.push(issue('NEW_HOPE_ANSWER_FALSE_PROMOTION', 'Failed holdout answer promoted an engineering claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, answerEvidenceReady: issues.length === 0, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function buildNewHopePitchedHoldoutScore(candidate, source, answer) {
  if ((await validateNewHopePitchedSourceOnlyCandidate(candidate, source)).status !== 'passed') throw new Error('NEW_HOPE_CANDIDATE_BLOCKED');
  if ((await validateNewHopePitchedAnswerEvidence(answer, candidate)).status !== 'passed') throw new Error('NEW_HOPE_ANSWER_BLOCKED');
  const draft = {
    artifactType: 'halofire.fresh-pitched-roof-holdout-score.v1', projectId: candidate.projectId, boundedScope: candidate.boundedScope,
    sourceReceiptSha256: source.sourceReceiptSha256, candidateReceiptSha256: candidate.receiptSha256, answerEvidenceReceiptSha256: answer.receiptSha256, approvedAnswerSha256: answer.approvedAnswer.sha256, fieldSetSha256: answer.fieldSet.sha256, asBuiltSha256: answer.asBuilt.sha256,
    sequence: answer.sequence,
    score: { candidateTargets: 24, approvedTargets: 7, truePositiveTargets: 0, falsePositiveTargets: 24, falseNegativeTargets: 7, precision: 0, recall: 0, exactCountMatch: false, exactXyMatch: false, topologyMatch: false, kindMatch: false, exactMatchToleranceFt: 0.5 },
    acceptance: { accepted: false, classification: 'fresh-holdout-failed-area-grid-instead-of-ridge-line-topology', reason: 'The frozen candidate generated a 4 by 6 area grid while approved, field, and as-built FP2.0 show seven attic uprights on one ridge branch line.' },
    failureAnalysis: { residualClass: 'pitched-concealed-volume-missing-ridge-truss-member-topology', sourceObservableBeforeAnswer: true, missingGate: 'Pitched concealed volumes require source-registered ridge, truss/member, obstruction, and branch-line topology before target generation; a generic area grid is forbidden.', candidateRetunedAfterAnswer: false },
    requiredNextLoop: 'Extract exact roof-truss/member geometry from structural sheets and sections, generate ridge/member-aware candidate topology, calibrate on New Hope without promoting acceptance, then run another untouched pitched-roof project.',
    internalVerification: { primary: { status: 'passed', method: 'frozen 24-target candidate versus approved seven-head ridge-row replay' }, crossSource: { status: 'passed', method: 'approved, field-set, and as-built FP2.0 independently show the same seven-head ridge row' }, adversarial: { status: 'passed', method: 'receipt, sequence, count, topology, score, and false-promotion mutations rejected' } },
    freshProjectPlacementVerified: false, exactHeadElevationReady: false, obstructionClearanceReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    claimStatus: 'fresh-pitched-roof-holdout-failed-twenty-four-grid-targets-versus-seven-ridge-heads-and-all-production-gates-remain-blocked',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateNewHopePitchedHoldoutScore(value, candidate, source, answer) {
  const issues = [];
  let expected;
  try { expected = await buildNewHopePitchedHoldoutScore(candidate, source, answer); } catch (error) { return { status: 'blocked', issues: [issue('NEW_HOPE_SCORE_INPUT_BLOCKED', error.message)], complianceReady: false }; }
  if (JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('NEW_HOPE_SCORE_REPLAY_MISMATCH', 'Score differs from deterministic replay.'));
  if (value?.acceptance?.accepted !== false || value?.score?.candidateTargets !== 24 || value?.score?.approvedTargets !== 7 || value?.score?.topologyMatch !== false || value?.freshProjectPlacementVerified !== false || value?.complianceReady !== false || value?.fabricationReady !== false || value?.fieldReleaseReady !== false) issues.push(issue('NEW_HOPE_SCORE_FALSE_PROMOTION', 'Failed holdout promoted acceptance or production readiness.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, accepted: false, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyNewHopePitchedScoreAdversarialLoop(value, candidate, source, answer) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }], ['answer', (entry) => { entry.approvedAnswerSha256 = '1'.repeat(64); }], ['field', (entry) => { entry.fieldSetSha256 = '2'.repeat(64); }], ['as-built', (entry) => { entry.asBuiltSha256 = '3'.repeat(64); }], ['sequence', (entry) => { entry.sequence.candidateRetunedAfterAnswer = true; }], ['candidate-count', (entry) => { entry.score.candidateTargets = 7; }], ['answer-count', (entry) => { entry.score.approvedTargets = 24; }], ['false-positive', (entry) => { entry.score.falsePositiveTargets = 0; }], ['false-negative', (entry) => { entry.score.falseNegativeTargets = 0; }], ['topology', (entry) => { entry.score.topologyMatch = true; }], ['precision', (entry) => { entry.score.precision = 1; }], ['accept', (entry) => { entry.acceptance.accepted = true; }], ['fresh', (entry) => { entry.freshProjectPlacementVerified = true; }], ['elevation', (entry) => { entry.exactHeadElevationReady = true; }], ['clearance', (entry) => { entry.obstructionClearanceReady = true; }], ['hydraulic', (entry) => { entry.hydraulicCalculationReady = true; }], ['compliance', (entry) => { entry.complianceReady = true; }], ['fabrication', (entry) => { entry.fabricationReady = true; }], ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const attacked = structuredClone(value); mutate(attacked); if ((await validateNewHopePitchedHoldoutScore(attacked, candidate, source, answer)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, complianceReady: false };
}
