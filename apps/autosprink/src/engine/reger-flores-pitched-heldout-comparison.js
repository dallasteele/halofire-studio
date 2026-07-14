import { sha256Hex } from './elevation-datums.js';

const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function sealRegerFloresPitchedHeldoutComparison(value) {
  const draft = structuredClone(value);
  delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateRegerFloresPitchedHeldoutComparison(value) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.reger-flores-pitched-heldout-comparison.v1') return { status: 'blocked', issues: [issue('REGER_HELDOUT_SCHEMA_INVALID', 'Reger-Flores held-out comparison identity is invalid.')] };
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('REGER_HELDOUT_RECEIPT_MISMATCH', 'The held-out comparison no longer matches its immutable receipt.'));
  if (value.sequence?.preAnswerCommit !== '79471ecb10c2fcaea9145c755d1306f69614eb75'
    || value.sequence?.sourceCandidateSealedBeforeAnswerOpen !== true
    || value.sequence?.preAnswerCandidateReceiptSha256 !== 'b158c8f3db890e99cefa942f7e9dd1d5594367a49bf457da74de3b78c9b6dd4e'
    || value.sequence?.answerOpenedAfterPreAnswerCommit !== true
    || value.sequence?.correctedImplementationEligibleAsFreshHoldout !== false) issues.push(issue('REGER_HELDOUT_SEQUENCE_VIOLATION', 'The sealed pre-answer candidate and answer-exposure boundary must remain explicit.'));
  const answer = value.answerEvidence;
  const layout = answer?.completedLayout;
  if (answer?.completedPdfSha256 !== 'af45158d0e52a87faa78973b171245d6c772d46d5edccfad0e8410e88c8ffce9'
    || answer?.page !== 1 || answer?.roomLabel !== 'LOUNGE VAULTED'
    || answer?.render?.cropSha256 !== '3e0bf722adc2ffb5e221a29427767bdc50b331e5d33af16d8fa7c14c2cdb22e3'
    || layout?.headCount !== 6 || layout?.slopeColumnCount !== 2 || layout?.ridgeDirectionRowsPerColumn !== 3
    || JSON.stringify(layout?.observedWestSuccessiveSpacingFt) !== '[7.833333,8]'
    || JSON.stringify(layout?.observedEastSuccessiveSpacingFt) !== '[7.833333,8]') issues.push(issue('REGER_HELDOUT_ANSWER_EVIDENCE_DRIFT', 'The completed vaulted lounge count, two columns, three rows, or observed branch spacings changed.'));
  const result = value.preAnswerResults;
  if (result?.generatedHeadCount !== 2 || result?.generatedSlopeColumnCount !== 2 || result?.generatedRidgeDirectionRowsPerColumn !== 1
    || result?.headCountParityPassed !== false || result?.slopeColumnTopologyPassed !== true || result?.ridgeDirectionRepetitionPassed !== false || result?.exactPlanPlacementPassed !== false) issues.push(issue('REGER_HELDOUT_RESULT_DRIFT', 'The two-versus-six count and one-versus-three ridge-row failure must remain recorded.'));
  if (value.heldOutAcceptanceStatus !== 'failed' || value.unseenSlopeColumnTopologyVerified !== true || value.unseenProjectPlacementVerified !== false
    || value.pitchedRoofHeadLayoutReady !== false || value.complianceReady !== false || value.fabricationReady !== false || value.fieldReleaseReady !== false
    || value.requiredNextLoop !== 'calibrate-ridge-direction-repetition-then-run-another-fresh-unopened-pitched-project') issues.push(issue('REGER_HELDOUT_FALSE_ACCEPTANCE', 'A ridge-direction repetition failure cannot promote whole-project placement or downstream readiness.'));
  if (value.internalVerification?.primary?.status !== 'passed' || value.internalVerification?.independent?.status !== 'passed'
    || value.internalVerification?.adversarial?.status !== 'passed' || value.internalVerification?.adversarial?.rejectedCases?.length !== 7) issues.push(issue('REGER_HELDOUT_LOOPS_INCOMPLETE', 'Primary, independent, and seven-case adversarial comparison loops are required.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, heldOutAcceptanceStatus: value.heldOutAcceptanceStatus, unseenSlopeColumnTopologyVerified: value.unseenSlopeColumnTopologyVerified, unseenProjectPlacementVerified: false, freshHoldoutRequired: true, complianceReady: false };
}

export async function verifyRegerFloresPitchedHeldoutAdversarialLoop(packet) {
  const cases = [
    ['sequence', (v) => { v.sequence.answerOpenedAfterPreAnswerCommit = false; }],
    ['answer-count', (v) => { v.answerEvidence.completedLayout.headCount = 2; }],
    ['answer-columns', (v) => { v.answerEvidence.completedLayout.slopeColumnCount = 1; }],
    ['hide-row-failure', (v) => { v.preAnswerResults.ridgeDirectionRepetitionPassed = true; }],
    ['exact-placement-pass', (v) => { v.preAnswerResults.exactPlanPlacementPassed = true; }],
    ['whole-project-pass', (v) => { v.unseenProjectPlacementVerified = true; }],
    ['compliance-pass', (v) => { v.complianceReady = true; }],
  ];
  const rejectedCases = [];
  for (const [name, mutate] of cases) { const changed = structuredClone(packet); mutate(changed); if ((await validateRegerFloresPitchedHeldoutComparison(await sealRegerFloresPitchedHeldoutComparison(changed))).status === 'blocked') rejectedCases.push(name); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, totalCases: cases.length };
}
