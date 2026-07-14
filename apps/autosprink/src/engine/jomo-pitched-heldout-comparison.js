import { sha256Hex } from './elevation-datums.js';

const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function sealJomoPitchedHeldoutComparison(value) {
  const draft = structuredClone(value);
  delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateJomoPitchedHeldoutComparison(value) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.jomo-pitched-heldout-comparison.v1') {
    return { status: 'blocked', issues: [issue('JOMO_HELDOUT_SCHEMA_INVALID', 'JOMO held-out comparison identity is invalid.')] };
  }
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) {
    issues.push(issue('JOMO_HELDOUT_RECEIPT_MISMATCH', 'The held-out comparison no longer matches its immutable receipt.'));
  }
  if (value.sequence?.preAnswerCommit !== '5b1f65d2'
    || value.sequence?.sourceCandidateSealedBeforeAnswerOpen !== true
    || value.sequence?.preAnswerCandidateReceiptSha256 !== '68364be6a6efe932b5a99eccb296d6a912bf100ad93ac9d0b48dfa895482c367'
    || value.sequence?.answerExposedBeforeCorrectedImplementation !== true
    || value.sequence?.correctedImplementationEligibleAsFreshHoldout !== false) {
    issues.push(issue('JOMO_HELDOUT_SEQUENCE_VIOLATION', 'The failed pre-answer attempt and post-answer correction boundary must remain explicit.'));
  }
  if (value.answerEvidence?.completedPdfSha256 !== 'ad1639fb83f4dc433492c1918e9a813c898f918d430ac9643fa845cded30f67b'
    || value.answerEvidence?.greatRoom?.headCount !== 6
    || value.answerEvidence?.greatRoom?.rowCount !== 2
    || value.answerEvidence?.greatRoom?.headsPerRow !== 3
    || value.answerEvidence?.greatRoom?.printedCeilingSlopeRiseIn !== 8
    || value.answerEvidence?.greatRoom?.printedCeilingSlopeRunIn !== 12
    || value.answerEvidence?.greatRoom?.printedTopOfVaultFt !== 16) {
    issues.push(issue('JOMO_HELDOUT_ANSWER_EVIDENCE_DRIFT', 'The completed Great Room count, topology, or printed vault controls changed.'));
  }
  if (value.preAnswerResults?.generatedHeadCount !== 6
    || value.preAnswerResults?.generatedRowCount !== 2
    || value.preAnswerResults?.generatedHeadsPerRow !== 3
    || value.preAnswerResults?.generatedPitchRiseIn !== 7
    || value.preAnswerResults?.headCountParityPassed !== true
    || value.preAnswerResults?.rowTopologyParityPassed !== true
    || value.preAnswerResults?.ceilingPitchParityPassed !== false) {
    issues.push(issue('JOMO_HELDOUT_RESULT_DRIFT', 'The pre-answer six-head topology match and 7:12 versus 8:12 elevation failure must both remain recorded.'));
  }
  if (value.heldOutAcceptanceStatus !== 'failed'
    || value.unseenPlanTopologyVerified !== true
    || value.unseenProjectPlacementVerified !== false
    || value.pitchedRoofHeadLayoutReady !== false
    || value.complianceReady !== false
    || value.fabricationReady !== false
    || value.fieldReleaseReady !== false
    || value.requiredNextLoop !== 'run-the-corrected-dimension-authority-algorithm-on-a-fresh-unopened-pitched-project') {
    issues.push(issue('JOMO_HELDOUT_FALSE_ACCEPTANCE', 'An elevation failure cannot promote whole-project placement or downstream readiness.'));
  }
  if (value.internalVerification?.primary?.status !== 'passed'
    || value.internalVerification?.independent?.status !== 'passed'
    || value.internalVerification?.adversarial?.status !== 'passed'
    || value.internalVerification?.adversarial?.rejectedCases?.length < 6) {
    issues.push(issue('JOMO_HELDOUT_LOOPS_INCOMPLETE', 'Primary, independent, and adversarial comparison loops are required.'));
  }
  return {
    status: issues.length ? 'blocked' : 'passed',
    issues,
    heldOutAcceptanceStatus: value.heldOutAcceptanceStatus,
    unseenPlanTopologyVerified: value.unseenPlanTopologyVerified,
    unseenProjectPlacementVerified: false,
    freshHoldoutRequired: true,
    complianceReady: false,
  };
}

export async function verifyJomoPitchedHeldoutAdversarialLoop(packet) {
  const cases = [
    ['sequence', (value) => { value.sequence.answerExposedBeforeCorrectedImplementation = false; }],
    ['answer-count', (value) => { value.answerEvidence.greatRoom.headCount = 7; }],
    ['answer-pitch', (value) => { value.answerEvidence.greatRoom.printedCeilingSlopeRiseIn = 7; }],
    ['hide-failed-pitch', (value) => { value.preAnswerResults.ceilingPitchParityPassed = true; }],
    ['whole-project-pass', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['compliance-pass', (value) => { value.complianceReady = true; }],
  ];
  const rejectedCases = [];
  for (const [name, mutate] of cases) {
    const changed = structuredClone(packet);
    mutate(changed);
    const resealed = await sealJomoPitchedHeldoutComparison(changed);
    const result = await validateJomoPitchedHeldoutComparison(resealed);
    if (result.status === 'blocked') rejectedCases.push(name);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, totalCases: cases.length };
}
