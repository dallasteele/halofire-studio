import { sha256Hex } from './elevation-datums.js';

const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function sealSagewoodPitchedHeldoutComparison(value) {
  const draft = structuredClone(value);
  delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateSagewoodPitchedHeldoutComparison(value) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.sagewood-pitched-heldout-comparison.v1') {
    return { status: 'blocked', issues: [issue('SAGEWOOD_HELDOUT_SCHEMA_INVALID', 'Sagewood held-out comparison identity is invalid.')] };
  }
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) {
    issues.push(issue('SAGEWOOD_HELDOUT_RECEIPT_MISMATCH', 'The held-out comparison no longer matches its immutable receipt.'));
  }
  if (value.sequence?.preAnswerCommit !== '1858f3f1276ff0273cdcf1f11d92ee63aef17879'
    || value.sequence?.sourceSealReceiptSha256 !== '7d7620ba91a20b899b3b7c2c6c28f8f1b08000d6bda3f28b957dea5f4e36f999'
    || value.sequence?.preAnswerCandidateReceiptSha256 !== '9d8abe21c2a3759b63763c56133d08b6d058f94eb8bb346108809326a69ba41c'
    || value.sequence?.sourceCandidateSealedBeforeAnswerOpen !== true
    || value.sequence?.answerOpenedAfterPreAnswerCommit !== true
    || value.sequence?.correctedImplementationEligibleAsFreshHoldout !== false) {
    issues.push(issue('SAGEWOOD_HELDOUT_SEQUENCE_VIOLATION', 'The source seal, pre-answer candidate, and answer-exposure boundary must remain explicit.'));
  }
  const answer = value.answerEvidence;
  const protection = answer?.completedProtection;
  if (answer?.completedPdfSha256 !== '1d48993b4c3c22459cd43ba05b167e6e7afc985c17c24140f51e4ae5dd81831c'
    || answer?.physicalPage !== 4 || answer?.sheetId !== 'F1.2'
    || answer?.render?.pageSha256 !== '7913a4a3a2ae76f0364e8591db36e535a3edbad30b4fc92bc3043c7e4c5763d6'
    || answer?.render?.cropSha256 !== 'db9fd91a6c5001ce21200735a2cf12c24b111fca970c74e2f65ed110814f5c5d'
    || protection?.protectedVolume !== 'pitched-attic' || protection?.headType !== 'upright'
    || protection?.observedHeadCount !== 30 || protection?.observedColumnCount !== 5 || protection?.observedRowsPerColumn !== 6) {
    issues.push(issue('SAGEWOOD_HELDOUT_ANSWER_EVIDENCE_DRIFT', 'The completed F1.2 attic classification, 30-head layout, or bound visual evidence changed.'));
  }
  const result = value.preAnswerResults;
  if (result?.assumedProtectedVolume !== 'occupied-sloped-ceiling' || result?.protectionVolumeClassifierPresent !== false
    || result?.generatedHeadCount !== 24 || result?.generatedColumnCount !== 6 || result?.generatedRowsPerColumn !== 4
    || result?.protectedVolumeParityPassed !== false || result?.headCountParityPassed !== false
    || result?.columnTopologyParityPassed !== false || result?.rowTopologyParityPassed !== false || result?.exactPlanPlacementPassed !== false) {
    issues.push(issue('SAGEWOOD_HELDOUT_RESULT_DRIFT', 'The occupied-ceiling-versus-attic classification failure and 24-versus-30 topology miss must remain recorded.'));
  }
  if (value.heldOutAcceptanceStatus !== 'failed' || value.unseenProtectionVolumeVerified !== false
    || value.unseenProjectPlacementVerified !== false || value.pitchedRoofHeadLayoutReady !== false
    || value.complianceReady !== false || value.fabricationReady !== false || value.fieldReleaseReady !== false
    || value.requiredNextLoop !== 'classify-protected-volume-before-placement-calibrate-pitched-attic-layout-then-run-another-fresh-unopened-pitched-project') {
    issues.push(issue('SAGEWOOD_HELDOUT_FALSE_ACCEPTANCE', 'A protected-volume classification failure cannot promote layout or downstream readiness.'));
  }
  if (value.internalVerification?.primary?.status !== 'passed' || value.internalVerification?.independent?.status !== 'passed'
    || value.internalVerification?.adversarial?.status !== 'passed' || value.internalVerification?.adversarial?.rejectedCases?.length !== 9) {
    issues.push(issue('SAGEWOOD_HELDOUT_LOOPS_INCOMPLETE', 'Primary, independent, and nine-case adversarial comparison loops are required.'));
  }
  return {
    status: issues.length ? 'blocked' : 'passed',
    issues,
    heldOutAcceptanceStatus: value.heldOutAcceptanceStatus,
    unseenProtectionVolumeVerified: false,
    unseenProjectPlacementVerified: false,
    freshHoldoutRequired: true,
    complianceReady: false,
  };
}

export async function verifySagewoodPitchedHeldoutAdversarialLoop(packet) {
  const cases = [
    ['sequence', (value) => { value.sequence.answerOpenedAfterPreAnswerCommit = false; }],
    ['answer-hash', (value) => { value.answerEvidence.completedPdfSha256 = '0'.repeat(64); }],
    ['crop-hash', (value) => { value.answerEvidence.render.cropSha256 = 'f'.repeat(64); }],
    ['answer-count', (value) => { value.answerEvidence.completedProtection.observedHeadCount = 24; }],
    ['answer-columns', (value) => { value.answerEvidence.completedProtection.observedColumnCount = 6; }],
    ['answer-rows', (value) => { value.answerEvidence.completedProtection.observedRowsPerColumn = 4; }],
    ['hide-classification-failure', (value) => { value.preAnswerResults.protectedVolumeParityPassed = true; }],
    ['whole-project-pass', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['compliance-pass', (value) => { value.complianceReady = true; }],
  ];
  const rejectedCases = [];
  for (const [name, mutate] of cases) {
    const changed = structuredClone(packet);
    mutate(changed);
    if ((await validateSagewoodPitchedHeldoutComparison(await sealSagewoodPitchedHeldoutComparison(changed))).status === 'blocked') rejectedCases.push(name);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, totalCases: cases.length };
}
