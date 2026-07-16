import { sha256Hex } from './elevation-datums.js';

const PROJECT_ID = 'boys-girls-club-community-center-brigham-city-ut';
const SOURCE_RECEIPT = '7eba5e834823f6d64a2ac395c0ccb1820810d416d7e2f9860bf61e192e644a63';
const CANDIDATE_RECEIPT = '908819388b44ed015ca93ee0b15e8bd94f7c4e72f72eaa4503d6db649a6fac54';
const ANSWERS = Object.freeze({ ahjApproved: ['799fba69311eb3aa285d6b96cb346aed184b3093d73777737597d23df60a0a18', 5313661], asBuilt: ['6f20b0ad824aaae6a8a71fac46e5faf89e5904eef0ad762cf98b8d0ed186b252', 14918460] });
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function validateBoysGirlsClubHeldoutComparison(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.boys-girls-club-pitched-heldout-comparison.v1' || packet?.projectId !== PROJECT_ID) return { status: 'blocked', issues: [issue('BGC_COMPARISON_IDENTITY_INVALID', 'Boys and Girls Club comparison identity is invalid.')], candidatePlacementVerified: false, complianceReady: false };
  const { receiptSha256, ...draft } = packet;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('BGC_COMPARISON_RECEIPT_MISMATCH', 'Held-out comparison receipt changed.'));
  if (packet.sourceSealReceiptSha256 !== SOURCE_RECEIPT || packet.blindCandidateReceiptSha256 !== CANDIDATE_RECEIPT) issues.push(issue('BGC_COMPARISON_BLIND_CHAIN_DRIFT', 'Source or pre-answer candidate binding changed.'));
  for (const [role, [sha256, bytes]] of Object.entries(ANSWERS)) { const answer = packet.answerBindings?.[role]; if (!answer || answer.sha256 !== sha256 || answer.bytes !== bytes || answer.sheet !== 'FP 1.0' || answer.physicalPage !== 3) issues.push(issue('BGC_COMPARISON_ANSWER_BINDING_DRIFT', `${role} answer binding changed.`)); }
  const envelope = packet.registration?.sourceEnvelope;
  if (packet.registration?.status !== 'passed' || packet.registration?.approvedAndAsBuiltUseSameGymEnvelope !== true || envelope?.lengthFt !== 104 || envelope?.widthFt !== 89.5 || envelope?.pitchRiseInPer12 !== 2 || envelope?.springElevationFt !== 25 || envelope?.ridgeElevationFt !== 32.458333) issues.push(issue('BGC_COMPARISON_REGISTRATION_DRIFT', 'Architectural-to-sprinkler grid or elevation registration changed.'));
  const predicted = packet.blindPrediction; const approved = packet.approved; const asBuilt = packet.asBuilt;
  if (predicted?.alongRidgeStations !== 3 || predicted?.acrossSlopeStations !== 4 || predicted?.headCount !== 12 || predicted?.selectorDistance !== 30.887227 || predicted?.outOfEnvelope !== true || predicted?.candidatePlacementReady !== false) issues.push(issue('BGC_COMPARISON_PREDICTION_DRIFT', 'Sealed blind topology or OOD status changed.'));
  if (approved?.headCount !== 64 || approved?.topology?.alongRidgeStations !== 8 || approved?.topology?.acrossSlopeStations !== 8 || approved?.topology?.headsPerBranch !== 8 || approved?.topology?.branchCount !== 8 || approved?.hydraulicEvidence?.occupancy !== 'Light Hazard' || approved?.hydraulicEvidence?.remoteAreaActualSqFt !== 1630) issues.push(issue('BGC_COMPARISON_APPROVED_DRIFT', 'AHJ-approved 64-head 8-by-8 gym evidence changed.'));
  if (asBuilt?.headCount !== 64 || asBuilt?.topology?.alongRidgeStations !== 8 || asBuilt?.topology?.acrossSlopeStations !== 8 || asBuilt?.approvedGymTopologyPreserved !== true) issues.push(issue('BGC_COMPARISON_ASBUILT_DRIFT', 'As-built 64-head 8-by-8 parity changed.'));
  const result = packet.result;
  if (result?.status !== 'failed' || result?.headCountDelta !== -52 || result?.predictedToAsBuiltRatio !== 0.1875 || result?.alongRidgeStationDelta !== -5 || result?.acrossSlopeStationDelta !== -4 || result?.topologyMatched !== false || result?.countMatched !== false || result?.sourceProtectionZoneGeometryVerified !== true || result?.v4OutOfEnvelopePromotionGuardWorked !== true || result?.v4TopologyGeneralizationVerified !== false) issues.push(issue('BGC_COMPARISON_FAILURE_ERASED', 'The held-out topology failure or working OOD guard was weakened.'));
  if (packet.internalVerification?.primary?.status !== 'passed' || packet.internalVerification?.independent?.status !== 'passed' || packet.internalVerification?.adversarial?.status !== 'passed') issues.push(issue('BGC_COMPARISON_LOOPS_INCOMPLETE', 'Primary, independent, and adversarial loops must pass.'));
  if (packet.candidatePlacementVerified !== false || packet.unseenProjectPlacementVerified !== false || packet.pitchedRoofHeadLayoutReady !== false || packet.hydraulicCalculationReady !== false || packet.complianceReady !== false || packet.fabricationReady !== false || packet.fieldReleaseReady !== false || !packet.requiredNextLoop?.includes('v5')) issues.push(issue('BGC_COMPARISON_FALSE_PROMOTION', 'Failed holdout must require v5 and keep every downstream claim false.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, heldoutAcceptanceStatus: 'failed', candidatePlacementVerified: false, v4OutOfEnvelopePromotionGuardWorked: issues.length === 0, complianceReady: false };
}

export async function verifyBoysGirlsClubComparisonAdversarialLoop(packet) {
  const cases = [
    ['source-receipt', (v) => { v.sourceSealReceiptSha256 = '0'.repeat(64); }], ['candidate-receipt', (v) => { v.blindCandidateReceiptSha256 = '1'.repeat(64); }],
    ['approved-answer', (v) => { v.answerBindings.ahjApproved.sha256 = '2'.repeat(64); }], ['asbuilt-answer', (v) => { v.answerBindings.asBuilt.sha256 = '3'.repeat(64); }],
    ['registration', (v) => { v.registration.status = 'blocked'; }], ['approved-count', (v) => { v.approved.headCount = 12; }],
    ['asbuilt-topology', (v) => { v.asBuilt.topology.alongRidgeStations = 3; }], ['failure-erasure', (v) => { v.result.status = 'passed'; }],
    ['guard-erasure', (v) => { v.result.v4OutOfEnvelopePromotionGuardWorked = false; }], ['placement-promotion', (v) => { v.candidatePlacementVerified = true; }],
    ['compliance-promotion', (v) => { v.complianceReady = true; }], ['receipt', (v) => { v.receiptSha256 = 'f'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validateBoysGirlsClubHeldoutComparison(value)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, candidatePlacementVerified: false, complianceReady: false };
}

export function renderBoysGirlsClubHeldoutComparison(packet) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 500" role="img" aria-label="Historical Boys and Girls Club blind topology failure"><style>rect{fill:#07111f}.panel{fill:#10233b;stroke:#fb923c;stroke-width:3}.rule{stroke:#334155;stroke-width:2}text{fill:#e2e8f0;font:18px sans-serif}.title{fill:#fca5a5;font:bold 28px sans-serif}.truth{fill:#7dd3fc;font:bold 20px sans-serif}.path{fill:#fdba74;font:15px monospace}</style><rect width="980" height="500"/><rect class="panel" x="38" y="38" width="904" height="424" rx="20"/><text class="title" x="72" y="92">HISTORICAL FAILED BLIND V4 — NOT A SPRINKLER LAYOUT</text><line class="rule" x1="72" y1="116" x2="908" y2="116"/><text x="72" y="160">The synthetic 8 × 8 dot graphic has been retired because it had no PDF underlay</text><text x="72" y="190">and could be mistaken for source-grounded field coordinates.</text><text x="72" y="242">Recorded result: 12 predicted / 64 approved and as-built (head delta -52).</text><text x="72" y="276">The out-of-domain guard worked; topology generalization failed.</text><text class="truth" x="72" y="328">Use the actual-PDF plan + A301 section + Blender 3D proof:</text><text class="path" x="72" y="364">src/data/proofs/bgc-source-plan-section-3d-registration/index.html</text><text x="72" y="416">Installed Z, pipe grade, hydraulics, compliance, fabrication and release remain false.</text></svg>`;
  return { status: 'passed', svg, syntheticTopologyGraphicRetired: true, sourceRegisteredProofPath: 'src/data/proofs/bgc-source-plan-section-3d-registration/index.html', topologyMatched: false, candidatePlacementVerified: false, complianceReady: false };
}
