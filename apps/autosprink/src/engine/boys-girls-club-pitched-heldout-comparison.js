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

function dots(columns, rows, colorClass, x0, y0, width, height) {
  return Array.from({ length: columns * rows }, (_, index) => { const x = index % columns; const y = Math.floor(index / columns); return `<circle class="${colorClass}" cx="${x0 + (x + 0.5) * width / columns}" cy="${y0 + (y + 0.5) * height / rows}" r="5"/>`; }).join('');
}

export function renderBoysGirlsClubHeldoutComparison(packet) {
  const approved = dots(8, 8, 'approved', 55, 75, 400, 345);
  const predicted = dots(3, 4, 'predicted', 55, 75, 400, 345);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 500" role="img" aria-label="Boys and Girls Club blind versus as-built topology comparison"><style>rect{fill:#07111f}.room{fill:#10233b;stroke:#e2e8f0;stroke-width:3}.ridge{stroke:#f59e0b;stroke-width:3;stroke-dasharray:8 5}.approved{fill:#fb923c;stroke:#fff}.predicted{fill:#22d3ee;stroke:#fff;stroke-width:2}text{fill:#e2e8f0;font:16px sans-serif}.fail{fill:#fca5a5;font:bold 22px sans-serif}</style><rect width="980" height="500"/><rect class="room" x="55" y="75" width="400" height="345"/><line class="ridge" x1="55" y1="247.5" x2="455" y2="247.5"/>${approved}${predicted}<text x="50" y="45">Registered topology proof - orange as-built 8 x 8 (64), cyan blind v4 3 x 4 (12)</text><text class="fail" x="525" y="125">HELD-OUT FAILURE</text><text x="525" y="165">head delta: -52</text><text x="525" y="195">along ridge: 3 predicted / 8 as-built</text><text x="525" y="225">across slope: 4 predicted / 8 as-built</text><text x="525" y="275">AHJ and as-built gym topology agree</text><text x="525" y="305">v4 OOD promotion guard worked</text><text x="525" y="355">Topology diagram only - no exact field-coordinate claim</text><text x="525" y="385">Compliance, fabrication, and release remain false</text></svg>`;
  return { status: 'passed', svg, topologyMatched: false, candidatePlacementVerified: false, complianceReady: false };
}
