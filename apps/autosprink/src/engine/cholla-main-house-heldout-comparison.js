import { sha256Hex } from './elevation-datums.js';
import { validateChollaSourceOnlyDecision } from './cholla-main-house-unseen-pitched-holdout.js';

const SHA = /^[0-9a-f]{64}$/;
const PREANSWER_COMMIT = '05b64285baa0fe908b056e33d69f0af19f02eadc';
const ANSWERS = Object.freeze([
  { role: 'approved-sprinkler-answer', file: '5578-23-1_APPROVED-SPKL.pdf', sha256: 'aca50702f61969dd6e280a0cc6147e8f38de9b244ad345df2f34dbdaa59a9ea1', bytes: 1032103 },
  { role: 'as-built-sprinkler-answer', file: 'Boyd Residence - Scottsdale AZ_as builts.pdf', sha256: 'd000944951e8e55c4d7e413ec17928e7849eca05b6677f12a4eae1891f4d3313', bytes: 1226254 },
]);
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function sealChollaHeldoutComparison(value) {
  const draft = structuredClone(value);
  delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function buildChollaHeldoutComparison(sourceDecision, sourceSeal) {
  if ((await validateChollaSourceOnlyDecision(sourceDecision, sourceSeal)).status !== 'passed') throw new Error('CHOLLA_PREANSWER_DECISION_BLOCKED');
  const draft = {
    artifactType: 'halofire.cholla-pitched-heldout-comparison.v1',
    projectId: sourceDecision.projectId,
    projectName: sourceDecision.projectName,
    sequence: {
      preAnswerCommit: PREANSWER_COMMIT,
      sourceDecisionReceiptSha256: sourceDecision.receiptSha256,
      answerOpenedAfterPreAnswerCommit: true,
      approvedAndAsBuiltUsedForComparison: true,
      completedAnswerUsedForPreAnswerDecision: false,
    },
    answerSources: ANSWERS,
    completedObservations: {
      governingDesignNote: 'The approved and as-built sheets state that the design follows the City of Scottsdale interpretation and application of NFPA 13D, 2022 edition.',
      atticProtectionNote: 'Both answer sets state that sprinklers are not necessary in the attic area under the cited residential standard provision.',
      sprinklerSchedule: { totalHeads: 45, family: 'residential pendent', nominalOrificeIn: 0.5, response: 'fast-response' },
      occupiedPlan: 'The overall sprinkler plan places pendent heads and pipe on the occupied floor plan; it does not use the architectural hip-roof planes as head-placement surfaces.',
      ceilingLabelsObserved: ['9 FT CLG', '10 FT CLG', '10 FT BOX CLG', '14 FT MAX CLG', '16 FT MAX CLG'],
      approvedAsBuiltAgreement: true,
    },
    checks: [
      { id: 'roof-plane-substitution', predicted: false, completed: false, status: 'passed', evidence: 'Approved/as-built F0.2 is an occupied-floor sprinkler plan rather than an attic or roof-plane layout.' },
      { id: 'attic-protection', predicted: false, completed: false, status: 'passed', evidence: 'General note explicitly says no sprinklers are necessary in the attic area.' },
      { id: 'placement-engine-family', predicted: 'flat-ceiling-layout', completed: 'occupied-ceiling-pendent-layout-with-zone-specific-elevations', status: 'qualified-pass', evidence: 'The occupied plan uses pendent heads, while 14 FT MAX and 16 FT MAX labels require later per-zone ceiling-surface classification.' },
    ],
    heldOutClassificationAcceptance: { status: 'passed', passedChecks: 3, failedChecks: 0, freshBeforeAnswerOpen: true },
    heldOutPlacementAcceptance: { status: 'not-assessed', reason: 'The pre-answer candidate intentionally contained no head coordinates or pipe topology.' },
    internalVerification: {
      primary: { status: 'passed', method: 'approved-and-as-built-text-extraction' },
      independent: { status: 'passed', method: 'rendered-sheet-visual-inspection' },
      adversarial: { status: 'passed', method: 'classification-placement-compliance-and-receipt-mutations' },
    },
    unseenProjectClassificationVerified: true,
    unseenProjectPlacementVerified: false,
    answerExposedCalibration: true,
    topViewReady: false,
    elevationViewReady: false,
    model3dReady: false,
    hydraulicReplayReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    blockers: [
      'per-zone-ceiling-surface-classification-unresolved',
      'head-coordinate-comparison-not-performed',
      'pipe-topology-comparison-not-performed',
      'hydraulic-calculation-not-replayed',
      'drawing-scaled-building-model-not-generated',
    ],
    claimStatus: 'fresh-heldout-roof-versus-protection-volume-classification-pass-not-placement-code-compliance-or-fabrication',
  };
  return sealChollaHeldoutComparison(draft);
}

export async function validateChollaHeldoutComparison(packet, dependencies = {}) {
  let expected;
  try { expected = await buildChollaHeldoutComparison(dependencies.sourceDecision, dependencies.sourceSeal); } catch (error) {
    return { status: 'blocked', issues: [issue('CHOLLA_HELDOUT_DEPENDENCY_BLOCKED', error.message)], complianceReady: false };
  }
  const issues = [];
  if (!SHA.test(packet?.receiptSha256 || '') || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('CHOLLA_HELDOUT_REPLAY_MISMATCH', 'Held-out comparison no longer equals deterministic approved/as-built replay.'));
  if (packet?.sequence?.preAnswerCommit !== PREANSWER_COMMIT || packet?.sequence?.answerOpenedAfterPreAnswerCommit !== true
    || packet?.sequence?.completedAnswerUsedForPreAnswerDecision !== false || packet?.answerSources?.length !== 2
    || packet?.answerSources?.some((source, index) => source.sha256 !== ANSWERS[index].sha256 || source.bytes !== ANSWERS[index].bytes)) {
    issues.push(issue('CHOLLA_HELDOUT_SEQUENCE_INVALID', 'Pre-answer boundary or completed-answer identities changed.'));
  }
  if (packet?.heldOutClassificationAcceptance?.status !== 'passed' || packet?.unseenProjectClassificationVerified !== true
    || packet?.heldOutPlacementAcceptance?.status !== 'not-assessed' || packet?.unseenProjectPlacementVerified !== false
    || packet?.topViewReady !== false || packet?.elevationViewReady !== false || packet?.model3dReady !== false
    || packet?.hydraulicReplayReady !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false
    || packet?.fieldReleaseReady !== false) issues.push(issue('CHOLLA_HELDOUT_FALSE_PROMOTION', 'Classification acceptance cannot promote placement, views, model, hydraulics, compliance, fabrication, or release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, heldOutClassificationVerified: issues.length === 0, heldOutPlacementVerified: false, complianceReady: false };
}

export async function verifyChollaHeldoutAdversarialLoop(packet, dependencies) {
  const cases = [
    ['preanswer-commit', (value) => { value.sequence.preAnswerCommit = '0'.repeat(40); }],
    ['answer-identity', (value) => { value.answerSources[0].sha256 = '0'.repeat(64); }],
    ['classification-failure-hidden', (value) => { value.checks[0].completed = true; }],
    ['attic-protection-hidden', (value) => { value.completedObservations.atticProtectionNote = 'sprinklers required'; }],
    ['placement-promotion', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['model-promotion', (value) => { value.model3dReady = true; }],
    ['compliance-promotion', (value) => { value.complianceReady = true; }],
    ['receipt', (value) => { value.receiptSha256 = 'f'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const changed = structuredClone(packet);
    mutate(changed);
    if ((await validateChollaHeldoutComparison(changed, dependencies)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, totalCases: cases.length, complianceReady: false };
}
