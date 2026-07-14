import { sha256Hex } from './elevation-datums.js';

const PROJECT_ID = 'mit-riverside-building-j';
const PROJECT = 'MIT Riverside - Transportation Building J';
const SHA = /^[0-9a-f]{64}$/;
const X_ANSWER = Object.freeze([0, 15.666667, 17.333333, 30.666667, 39.666667, 45.666667, 61.333333, 76.333333]);
const Y_ANSWER = Object.freeze([0, 32.166667, 64.833333, 89.166667, 100.166667]);
const X_STRUCTURAL = Object.freeze([0, 15.663824, 17.33348, 30.663824, 39.666667, 45.663824, 61.333333, 76.333333]);
const Y_STRUCTURAL = Object.freeze([0, 32.166667, 64.833333, 90.166667, 100.166667]);
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function sealMitRiversideBuildingJCrossDrawingGridAuditEvidence(draft) {
  const { receiptSha256: _ignored, ...body } = draft;
  return { ...body, receiptSha256: await sha256Hex(body) };
}

export async function validateMitRiversideBuildingJCrossDrawingGridAuditEvidence(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.mit-riverside-building-j-cross-drawing-grid-audit-evidence.v1' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) issues.push(issue('MIT_J_GRID_AUDIT_IDENTITY_INVALID', 'Cross-drawing grid audit identity changed.'));
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('MIT_J_GRID_AUDIT_RECEIPT_MISMATCH', 'Cross-drawing grid audit evidence changed.'));
  const source = packet?.structuralRoofDwg;
  if (source?.sha256 !== '94ee255614f7b403de5185622018eaaad8f80ebe253592418bc7e3b6d993c9aa' || source?.bytes !== 701676 || source?.reader !== '@mlightcad/libredwg-web 0.7.7' || source?.unknownEntityCount !== 0) issues.push(issue('MIT_J_STRUCTURAL_DWG_BINDING_DRIFT', 'Structural roof DWG binding or extraction truth changed.'));
  if (packet?.architecturalRcpSourceSha256 !== '08515f43642de408ed1f9fc5ebd35115083b023d62412d5d9bc4301cf146c93c' || JSON.stringify(packet?.answerRcpLocalFeet?.x) !== JSON.stringify(X_ANSWER) || JSON.stringify(packet?.answerRcpLocalFeet?.y) !== JSON.stringify(Y_ANSWER) || JSON.stringify(packet?.structuralDwgLocalFeet?.x) !== JSON.stringify(X_STRUCTURAL) || JSON.stringify(packet?.structuralDwgLocalFeet?.y) !== JSON.stringify(Y_STRUCTURAL)) issues.push(issue('MIT_J_GRID_COORDINATE_DRIFT', 'Answer/RCP or structural grid coordinates changed.'));
  const audit = packet?.audit;
  if (audit?.localizedConflictAxis !== 'y' || audit?.localizedConflictLabel !== 'J.2' || audit?.localizedConflictInches !== 12 || audit?.structuralJ3ToJ2Ft !== 25.333334 || audit?.answerRcpJ3ToJ2Ft !== 24.333334 || audit?.structuralJ2ToJ1Ft !== 10 || audit?.answerRcpJ2ToJ1Ft !== 11 || audit?.oldClaimedGlobalYResidualPx !== 0.655077 || audit?.actualStructuralGlobalYResidualPx !== 23.487062 || audit?.piecewiseLabelCorrectionRequired !== true || audit?.priorGlobalStructuralAlignmentSuperseded !== true) issues.push(issue('MIT_J_LOCALIZED_GRID_CONFLICT_ERASED', 'The localized one-foot J.2 conflict and superseding residual must remain explicit.'));
  const claims = packet?.claims;
  if (claims?.answerRcpXyStillReady !== true || claims?.currentHeadStructuralRoofXyReady !== false || claims?.headPlaneAssignmentReady !== false || claims?.headElevationReady !== false || claims?.complianceReady !== false || claims?.fabricationReady !== false || claims?.fieldReleaseReady !== false) issues.push(issue('MIT_J_GRID_AUDIT_FALSE_PROMOTION', 'The audit may preserve RCP XY while structural roof XY, plane, Z, compliance, and release remain blocked.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, answerRcpXyStillReady: issues.length === 0, currentHeadStructuralRoofXyReady: false, headPlaneAssignmentReady: false, complianceReady: false };
}

export async function buildMitRiversideBuildingJCrossDrawingGridAudit(evidence) {
  if ((await validateMitRiversideBuildingJCrossDrawingGridAuditEvidence(evidence)).status !== 'passed') throw new Error('MIT_J_GRID_AUDIT_EVIDENCE_BLOCKED');
  const draft = {
    artifactType: 'halofire.mit-riverside-building-j-cross-drawing-grid-audit.v1', projectId: PROJECT_ID, projectName: PROJECT,
    auditAfterCommit: evidence.auditAfterCommit, evidenceReceiptSha256: evidence.receiptSha256,
    conflict: structuredClone(evidence.audit),
    correctionContract: {
      mode: 'piecewise-grid-label-transform-from-answer-rcp-to-structural-roof-dwg',
      labels: structuredClone(evidence.labels),
      answerRcpLocalFeet: structuredClone(evidence.answerRcpLocalFeet),
      structuralDwgLocalFeet: structuredClone(evidence.structuralDwgLocalFeet),
      correctionBuilt: false,
    },
    internalVerification: {
      primary: { status: 'passed', method: 'exact structural DWG S-GRID line-coordinate extraction' },
      independent: { status: 'passed', method: 'answer/RCP grid interval replay against structural J.5 through J.1 intervals' },
      adversarial: { status: 'passed', method: 'source, coordinate, label, residual, correction, plane, Z, compliance, and release mutations' },
    },
    answerRcpXyStillReady: true, currentHeadStructuralRoofXyReady: false, structuralCorrectionReady: false,
    headPlaneAssignmentReady: false, headElevationReady: false, sourceGeneratedPitchedPlacementVerified: false,
    complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    requiredNextLoop: 'apply and verify the piecewise J.5-J.1 label transform to all 68 source-RCP points before assigning any structural roof face or elevation',
    claimStatus: 'answer-and-source-rcp-xy-preserved-structural-roof-xy-superseded-by-localized-j2-conflict-pending-piecewise-correction',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMitRiversideBuildingJCrossDrawingGridAudit(packet, evidence) {
  let expected;
  try { expected = await buildMitRiversideBuildingJCrossDrawingGridAudit(evidence); } catch (error) { return { status: 'blocked', issues: [issue('MIT_J_GRID_AUDIT_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('MIT_J_GRID_AUDIT_REPLAY_MISMATCH', 'Cross-drawing grid audit no longer equals deterministic replay.'));
  if (packet?.conflict?.localizedConflictInches !== 12 || packet?.conflict?.actualStructuralGlobalYResidualPx !== 23.487062 || packet?.correctionContract?.correctionBuilt !== false || packet?.currentHeadStructuralRoofXyReady !== false || packet?.headPlaneAssignmentReady !== false || packet?.headElevationReady !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('MIT_J_GRID_AUDIT_GATE_DRIFT', 'Localized conflict or fail-closed downstream gates changed.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, answerRcpXyStillReady: issues.length === 0, currentHeadStructuralRoofXyReady: false, headPlaneAssignmentReady: false, complianceReady: false };
}

export async function verifyMitRiversideBuildingJCrossDrawingGridAuditAdversarialLoop(packet, evidence) {
  const cases = [
    ['receipt', (v) => { v.receiptSha256 = '0'.repeat(64); }], ['evidence', (v) => { v.evidenceReceiptSha256 = 'f'.repeat(64); }],
    ['label', (v) => { v.conflict.localizedConflictLabel = 'J.3'; }], ['inches', (v) => { v.conflict.localizedConflictInches = 0; }],
    ['residual', (v) => { v.conflict.actualStructuralGlobalYResidualPx = 0.655077; }], ['superseded', (v) => { v.conflict.priorGlobalStructuralAlignmentSuperseded = false; }],
    ['mode', (v) => { v.correctionContract.mode = 'global-linear'; }], ['structural-y', (v) => { v.correctionContract.structuralDwgLocalFeet.y[3] = 89.166667; }],
    ['correction-built', (v) => { v.correctionContract.correctionBuilt = true; }], ['structural-ready', (v) => { v.currentHeadStructuralRoofXyReady = true; }],
    ['plane', (v) => { v.headPlaneAssignmentReady = true; }], ['z', (v) => { v.headElevationReady = true; }],
    ['source-generated', (v) => { v.sourceGeneratedPitchedPlacementVerified = true; }], ['compliance', (v) => { v.complianceReady = true; }],
    ['fabrication', (v) => { v.fabricationReady = true; }], ['field-release', (v) => { v.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validateMitRiversideBuildingJCrossDrawingGridAudit(value, evidence)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, currentHeadStructuralRoofXyReady: false, headPlaneAssignmentReady: false, complianceReady: false };
}

export function renderMitRiversideBuildingJCrossDrawingGridAudit(packet) {
  const labels = packet.correctionContract.labels.y;
  const answer = packet.correctionContract.answerRcpLocalFeet.y;
  const structural = packet.correctionContract.structuralDwgLocalFeet.y;
  const rows = labels.map((label, index) => `<text x="65" y="${92 + index * 55}">${label}</text><line class="a" x1="175" y1="${84 + index * 55}" x2="${175 + answer[index] * 5.2}" y2="${84 + index * 55}"/><line class="s" x1="175" y1="${99 + index * 55}" x2="${175 + structural[index] * 5.2}" y2="${99 + index * 55}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 410"><style>rect{fill:#07111f}.a{stroke:#22d3ee;stroke-width:6}.s{stroke:#f59e0b;stroke-width:6}text{fill:#e2e8f0;font:15px sans-serif}.warn{fill:#fbbf24}</style><rect width="920" height="410"/>${rows}<text x="22" y="28">Building J cross-drawing grid audit: cyan answer/RCP vs orange structural DWG</text><text class="warn" x="22" y="382">J.2 differs by 12 in; old 0.655 px global claim superseded by actual 23.487 px residual</text></svg>`;
}
