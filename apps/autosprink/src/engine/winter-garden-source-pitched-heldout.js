import { sha256Hex } from './elevation-datums.js';

const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const near = (left, right, tolerance = 1e-4) => Math.abs(left - right) <= tolerance;

export async function sealWinterGardenSourcePitchedHeldout(value) {
  const draft = structuredClone(value); delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateWinterGardenSourcePitchedHeldout(value, { candidates, ceiling, headEvidence, registration } = {}) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.winter-garden-source-pitched-heldout.v1') return { status: 'blocked', issues: [issue('WG_PITCHED_HELDOUT_SCHEMA_INVALID', 'Held-out pitched comparison identity is invalid.')] };
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('WG_PITCHED_HELDOUT_RECEIPT_MISMATCH', 'Held-out comparison no longer matches its immutable receipt.'));
  const expected = { candidates: candidates?.receiptSha256, ceiling: ceiling?.receiptSha256, headEvidence: headEvidence?.receiptSha256, registration: registration?.receiptSha256 };
  if (Object.entries(expected).some(([key, digest]) => !SHA.test(digest || '') || value.sourceReceipts?.[key] !== digest)) issues.push(issue('WG_PITCHED_HELDOUT_UPSTREAM_DRIFT', 'Sealed source candidates, ceiling, completed-head evidence, and registration receipts are required.'));
  const metrics = value.metrics || {}; const comparison = value.comparisons?.[0];
  if (metrics.generatedCandidateHeads !== 1 || metrics.completedHeadsInsideGeneratedComponent !== 0 || metrics.completedHeadsInsideTopologyZone !== 9
    || !near(comparison?.nearestCompletedDistanceFt, 4.4303) || comparison?.nearestCompletedHeadId !== 'wg-fp3-pendent-086') issues.push(issue('WG_PITCHED_HELDOUT_METRIC_DRIFT', 'The sealed one-head source hypothesis must replay against the nine-head completed topology-zone observation and 4.4303-foot nearest point.'));
  if (value.sequence?.sourcePacketSealedBeforeAnswerKeyOpen !== true || value.sequence?.sourceGenerationModifiedAfterComparison !== false || value.generation?.answerKeyUsedForSourceGeneration !== false || value.generation?.answerKeyRole !== 'held-out-comparison-only') issues.push(issue('WG_PITCHED_HELDOUT_SEQUENCE_VIOLATION', 'The completed bid may only be opened after source generation is sealed and may not mutate the source packet.'));
  if (value.heldOutAcceptanceStatus !== 'failed' || value.headCountParityPassed !== false || value.exactPlanParityPassed !== false || value.candidatePlacementVerified !== false) issues.push(issue('WG_PITCHED_HELDOUT_FALSE_ACCEPTANCE', 'The observed one-vs-nine count and 4.4303-foot point residual must fail held-out placement acceptance.'));
  if (value.internalVerification?.primary?.status !== 'passed' || value.internalVerification?.independent?.status !== 'passed' || value.internalVerification?.adversarial?.status !== 'passed') issues.push(issue('WG_PITCHED_HELDOUT_LOOPS_INCOMPLETE', 'Held-out primary, independent, and adversarial loops must pass.'));
  if (value.pitchedRoofHeadLayoutReady !== false || value.complianceReady !== false || value.fabricationReady !== false || value.fieldReleaseReady !== false) issues.push(issue('WG_PITCHED_HELDOUT_FAIL_CLOSED_STATUS_DRIFT', 'Failed held-out acceptance cannot enable layout, compliance, fabrication, or release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, heldOutAcceptanceStatus: value.heldOutAcceptanceStatus, candidatePlacementVerified: false, pitchedRoofHeadLayoutReady: false, complianceReady: false };
}
