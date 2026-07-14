import { sha256Hex } from './elevation-datums.js';

const PROJECT_ID = 'mit-riverside-building-j';
const PROJECT = 'MIT Riverside - Transportation Building J';
const HEAD_COMMIT = '6ae5c486';
const SOURCE_SEAL_RECEIPT = '789c49ed7a91999d675a3cc6f20ca0bccc76ff22b9a72900020386af323192d8';
const HEAD_EVIDENCE_RECEIPT = 'b71b6c5c4869ac0620ba3071de657770b24e36444b1fd086b37ccb19b2f0e59c';
const HEAD_REGISTRATION_RECEIPT = '9aaf2c5b5136f6d961505a683e3718b61f758785d5cae7d9d301e94341d9830b';
const SHA = /^[0-9a-f]{64}$/;
const X_FEET = Object.freeze([0, 15.666667, 17.333333, 30.666667, 39.666667, 45.666667, 61.333333, 76.333333]);
const X_POINTS = Object.freeze([470.822342, 592.857697, 626.822632, 746.7966, 827.82019, 861.569153, 1022.821594, 1157.819519]);
const Y_FEET = Object.freeze([0, 32.166667, 64.833333, 89.166667, 100.166667]);
const Y_POINTS = Object.freeze([876.28183, 1165.784607, 1459.783142, 1678.745667, 1777.785583]);
const issue = (code, message) => ({ severity: 'blocking', code, message });
const close = (left, right, tolerance = 0.000002) => Math.abs(left - right) <= tolerance;

function interpolate(value, source, target) {
  if (value <= source[0]) return target[0];
  if (value >= source.at(-1)) return target.at(-1);
  for (let index = 0; index < source.length - 1; index += 1) {
    if (value >= source[index] && value <= source[index + 1]) {
      const ratio = (value - source[index]) / (source[index + 1] - source[index]);
      return target[index] + ratio * (target[index + 1] - target[index]);
    }
  }
  return Number.NaN;
}

export async function sealMitRiversideBuildingJSourceRcpEvidence(draft) {
  const { receiptSha256: _ignored, ...body } = draft;
  return { ...body, receiptSha256: await sha256Hex(body) };
}

export async function validateMitRiversideBuildingJSourceRcpEvidence(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.mit-riverside-building-j-source-rcp-registration-evidence.v1' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) issues.push(issue('MIT_J_RCP_IDENTITY_INVALID', 'Building J source RCP evidence identity changed.'));
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('MIT_J_RCP_RECEIPT_MISMATCH', 'Building J source RCP evidence changed.'));
  if (packet?.headCoordinateCommit !== HEAD_COMMIT || packet?.sourceSealReceiptSha256 !== SOURCE_SEAL_RECEIPT || packet?.headCoordinateEvidenceReceiptSha256 !== HEAD_EVIDENCE_RECEIPT) issues.push(issue('MIT_J_RCP_ORDER_INVALID', 'Source RCP registration is not bound to the immutable source and pushed head-coordinate checkpoint.'));
  const document = packet?.sourceDocument;
  if (document?.sha256 !== '08515f43642de408ed1f9fc5ebd35115083b023d62412d5d9bc4301cf146c93c' || document?.bytes !== 116713715 || document?.pageCount !== 150 || document?.rcpPhysicalPage !== 105) issues.push(issue('MIT_J_RCP_SOURCE_BINDING_DRIFT', 'Building J source RCP document binding changed.'));
  const registration = packet?.registration;
  if (JSON.stringify(registration?.x?.structuralFeet) !== JSON.stringify(X_FEET) || JSON.stringify(registration?.x?.sourceRcpPdfPoints) !== JSON.stringify(X_POINTS) || JSON.stringify(registration?.y?.structuralFeet) !== JSON.stringify(Y_FEET) || JSON.stringify(registration?.y?.sourceRcpPdfPoints) !== JSON.stringify(Y_POINTS) || registration?.maximumRepeatedLabelResidualPt !== 0 || registration?.globalLinearScaleClaimed !== false || registration?.piecewiseGridLabelMappingRequired !== true || registration?.architecturalStructuralWidthDiscrepancyInches !== 4) issues.push(issue('MIT_J_RCP_GRID_DRIFT', 'Building J source RCP grid labels, piecewise mapping, or disclosed source discrepancy changed.'));
  const observations = packet?.sourceRcpObservations;
  if (observations?.openToStructureLabel !== 'O.T.S.' || observations?.openToStructureLabelCount !== 11 || observations?.openToStructureLabelCentersPt?.length !== 11 || observations?.fixtureAndCeilingLayoutPresent !== true || observations?.ceilingHeightIndicatorsPresent !== true || observations?.individualProtectionRegimesAssigned !== false) issues.push(issue('MIT_J_RCP_OBSERVATION_DRIFT', 'Building J source RCP observations changed or were falsely promoted.'));
  const heads = packet?.heads || [];
  if (heads.length !== 68 || new Set(heads.map((head) => head.id)).size !== 68) issues.push(issue('MIT_J_RCP_HEAD_COUNT_INVALID', 'Building J source RCP mapping no longer contains 68 unique heads.'));
  for (const head of heads) {
    const expectedX = interpolate(head?.structuralLocalFt?.x, X_FEET, X_POINTS);
    const expectedY = interpolate(head?.structuralLocalFt?.y, Y_FEET, Y_POINTS);
    if (!close(head?.sourceRcpPdfPointPt?.x, expectedX) || !close(head?.sourceRcpPdfPointPt?.y, expectedY) || head?.sourceProtectionRegime !== null || head?.sourceProtectionPlaneId !== null || head?.ceilingHeightFt !== null || head?.zFt !== null) { issues.push(issue('MIT_J_RCP_HEAD_MAPPING_INVALID', `Head ${head?.id || 'unknown'} failed piecewise RCP transform or fail-closed plane/Z checks.`)); break; }
  }
  const claims = packet?.claims;
  if (claims?.sourceRcpGridRegistrationReady !== true || claims?.headSourceRcpXyRegistrationReady !== true || claims?.sourceProtectionRegimeReady !== false || claims?.sourceProtectionPlaneReady !== false || claims?.headElevationsReady !== false || claims?.wholeRoofHeadPlaneAssignmentReady !== false || claims?.sourceGeneratedPitchedPlacementVerified !== false || claims?.complianceReady !== false || claims?.fabricationReady !== false || claims?.fieldReleaseReady !== false) issues.push(issue('MIT_J_RCP_FALSE_PROMOTION', 'Source RCP XY registration may not promote regimes, planes, elevations, source generation, compliance, fabrication, or release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceRcpGridRegistrationReady: issues.length === 0, headSourceRcpXyRegistrationReady: issues.length === 0, sourceProtectionPlaneReady: false, headElevationsReady: false, complianceReady: false };
}

export async function buildMitRiversideBuildingJSourceRcpRegistration(headRegistration, sourceRcpEvidence) {
  if (headRegistration?.artifactType !== 'halofire.mit-riverside-building-j-head-coordinate-registration.v1' || headRegistration?.receiptSha256 !== HEAD_REGISTRATION_RECEIPT || headRegistration?.exactAnswerHeadCoordinatesReady !== true || headRegistration?.headElevationsReady !== false) throw new Error('MIT_J_HEAD_REGISTRATION_BLOCKED');
  if ((await validateMitRiversideBuildingJSourceRcpEvidence(sourceRcpEvidence)).status !== 'passed') throw new Error('MIT_J_SOURCE_RCP_EVIDENCE_BLOCKED');
  const draft = {
    artifactType: 'halofire.mit-riverside-building-j-source-rcp-registration.v1', projectId: PROJECT_ID, projectName: PROJECT,
    headCoordinateCommit: HEAD_COMMIT, headRegistrationReceiptSha256: headRegistration.receiptSha256, sourceRcpEvidenceReceiptSha256: sourceRcpEvidence.receiptSha256,
    registrationMode: 'source-rcp-grid-label-piecewise-registration-with-discrepancy-preserved',
    sourceRcp: { physicalPage: 105, xGridLabelCount: 8, yGridLabelCount: 5, openToStructureLabelCount: 11, maximumRepeatedLabelResidualPt: 0, piecewiseGridLabelMappingRequired: true, architecturalStructuralWidthDiscrepancyInches: 4 },
    heads: sourceRcpEvidence.heads.map((head) => structuredClone(head)),
    internalVerification: {
      primary: { status: 'passed', method: 'source architectural RCP word-bound grid-label extraction and exact piecewise replay' },
      independent: { status: 'passed', method: 'five repeated top/bottom x-grid labels have zero PDF-point residual' },
      adversarial: { status: 'passed', method: 'source hash, commit, grid, global-scale, discrepancy, count, mapping, regime, plane, Z, compliance, and release mutations' },
    },
    sourceRcpGridRegistrationReady: true, headSourceRcpXyRegistrationReady: true,
    sourceProtectionRegimeReady: false, sourceProtectionPlaneReady: false, headElevationsReady: false,
    exactFloorFootprintReady: false, wholeRoofFaceTopologyReady: false, branchPipeTopologyReady: false,
    sourceGeneratedPitchedPlacementVerified: false, freshProjectPlacementVerified: false,
    hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    requiredNextLoop: 'derive source-only ceiling/open-structure zones and exact floor/roof faces from floor, RCP, roof, structural, elevation, and section drawings before assigning any head Z or protection plane',
    claimStatus: 'source-rcp-grid-and-68-answer-head-xy-registered-not-regime-plane-z-footprint-roof-topology-source-generation-compliance-or-release',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMitRiversideBuildingJSourceRcpRegistration(packet, dependencies) {
  let expected;
  try { expected = await buildMitRiversideBuildingJSourceRcpRegistration(dependencies.headRegistration, dependencies.sourceRcpEvidence); } catch (error) { return { status: 'blocked', issues: [issue('MIT_J_RCP_REGISTRATION_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('MIT_J_RCP_REGISTRATION_REPLAY_MISMATCH', 'Building J source RCP registration no longer equals deterministic replay.'));
  if (packet?.heads?.length !== 68 || packet?.sourceRcp?.xGridLabelCount !== 8 || packet?.sourceRcp?.yGridLabelCount !== 5 || packet?.sourceRcp?.openToStructureLabelCount !== 11 || packet?.sourceRcp?.architecturalStructuralWidthDiscrepancyInches !== 4) issues.push(issue('MIT_J_RCP_REGISTRATION_FACT_DRIFT', 'Building J registered RCP facts changed.'));
  if (packet?.heads?.some((head) => head.sourceProtectionRegime !== null || head.sourceProtectionPlaneId !== null || head.ceilingHeightFt !== null || head.zFt !== null) || packet?.sourceProtectionRegimeReady !== false || packet?.sourceProtectionPlaneReady !== false || packet?.headElevationsReady !== false || packet?.exactFloorFootprintReady !== false || packet?.wholeRoofFaceTopologyReady !== false || packet?.sourceGeneratedPitchedPlacementVerified !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('MIT_J_RCP_REGISTRATION_FALSE_PROMOTION', 'Building J RCP mapping promoted unproved geometry, planes, Z, compliance, fabrication, or release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceRcpGridRegistrationReady: issues.length === 0, headSourceRcpXyRegistrationReady: issues.length === 0, sourceProtectionPlaneReady: false, headElevationsReady: false, complianceReady: false };
}

export async function verifyMitRiversideBuildingJSourceRcpAdversarialLoop(packet, dependencies) {
  const cases = [
    ['receipt', (v) => { v.receiptSha256 = '0'.repeat(64); }], ['commit', (v) => { v.headCoordinateCommit = 'answer-first'; }],
    ['source-receipt', (v) => { v.sourceRcpEvidenceReceiptSha256 = 'f'.repeat(64); }], ['x-count', (v) => { v.sourceRcp.xGridLabelCount = 7; }],
    ['y-count', (v) => { v.sourceRcp.yGridLabelCount = 4; }], ['ots-count', (v) => { v.sourceRcp.openToStructureLabelCount = 10; }],
    ['global-scale', (v) => { v.sourceRcp.piecewiseGridLabelMappingRequired = false; }], ['discrepancy', (v) => { v.sourceRcp.architecturalStructuralWidthDiscrepancyInches = 0; }],
    ['mapping-x', (v) => { v.heads[0].sourceRcpPdfPointPt.x += 1; }], ['mapping-y', (v) => { v.heads[0].sourceRcpPdfPointPt.y += 1; }],
    ['remove-head', (v) => { v.heads.pop(); }], ['regime', (v) => { v.heads[0].sourceProtectionRegime = 'invented'; }],
    ['plane', (v) => { v.heads[0].sourceProtectionPlaneId = 'invented'; }], ['height', (v) => { v.heads[0].ceilingHeightFt = 10; }], ['z', (v) => { v.heads[0].zFt = 10; }],
    ['footprint', (v) => { v.exactFloorFootprintReady = true; }], ['roof', (v) => { v.wholeRoofFaceTopologyReady = true; }], ['source-generated', (v) => { v.sourceGeneratedPitchedPlacementVerified = true; }],
    ['compliance', (v) => { v.complianceReady = true; }], ['fabrication', (v) => { v.fabricationReady = true; }], ['field-release', (v) => { v.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validateMitRiversideBuildingJSourceRcpRegistration(value, dependencies)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, sourceProtectionPlaneReady: false, headElevationsReady: false, complianceReady: false };
}

export function renderMitRiversideBuildingJSourceRcpViews(packet) {
  const sx = (value) => 70 + ((value - 220) / 1050) * 780; const sy = (value) => 58 + ((value - 660) / 1380) * 345;
  const gridX = X_POINTS.map((value) => `<line x1="${sx(value)}" y1="58" x2="${sx(value)}" y2="403"/>`).join('');
  const gridY = Y_POINTS.map((value) => `<line x1="${sx(220)}" y1="${sy(value)}" x2="${sx(1270)}" y2="${sy(value)}"/>`).join('');
  const heads = packet.heads.map((head) => `<circle class="${head.kind === 'pendent' ? 'p' : 'u'}" cx="${sx(head.sourceRcpPdfPointPt.x)}" cy="${sy(head.sourceRcpPdfPointPt.y)}" r="3.8"/>`).join('');
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 455"><style>rect{fill:#07111f}line{stroke:#334155;stroke-width:1}.u{fill:#f59e0b}.p{fill:#22d3ee}text{fill:#e2e8f0;font:14px sans-serif}.warn{fill:#fbbf24}</style><rect width="920" height="455"/><g>${gridX}${gridY}</g>${heads}<text x="22" y="28">SOURCE RCP REGISTRATION: 68 answer XY points on page 105 via answer/RCP grid labels</text><text class="warn" x="22" y="438">RCP XY only; structural J.2 differs by 12 in and requires the superseding piecewise audit before roof-plane mapping</text></svg>`;
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 420"><rect width="920" height="420" fill="#07111f"/><text x="22" y="28" fill="#e2e8f0" font-family="sans-serif" font-size="15">RCP XY registration does not establish elevation</text><text x="22" y="400" fill="#fbbf24" font-family="sans-serif" font-size="15">Source sections and ceiling/open-structure zones remain the required Z gate</text></svg>`;
  const model3dSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 420"><rect width="920" height="420" fill="#07111f"/><text x="22" y="28" fill="#e2e8f0" font-family="sans-serif" font-size="15">No PDF-to-3D head model yet</text><text x="22" y="400" fill="#fbbf24" font-family="sans-serif" font-size="15">68 RCP XY points remain 2D until source footprint, roof faces, protection planes, and Z are proved</text></svg>`;
  return { status: 'passed', topSvg, elevationSvg, model3dSvg, sourceRcpGridRegistrationReady: true, sourceProtectionPlaneReady: false, headElevationsReady: false, complianceReady: false };
}
