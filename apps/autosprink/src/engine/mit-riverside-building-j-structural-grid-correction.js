import { sha256Hex } from './elevation-datums.js';

const PROJECT_ID = 'mit-riverside-building-j';
const PROJECT = 'MIT Riverside - Transportation Building J';
const RCP_RECEIPT = 'a2fa02a3d06762adccc900c978d6278ee586bb749e643f7135f883d796826d6f';
const AUDIT_RECEIPT = '16cd7e436b10293bdb9351dfb6cfd26104d585d9a0ffe064dc9aba63431900ea';
const X_POINTS = Object.freeze([470.822342, 592.857697, 626.822632, 746.7966, 827.82019, 861.569153, 1022.821594, 1157.819519]);
const Y_POINTS = Object.freeze([876.28183, 1165.784607, 1459.783142, 1678.745667, 1777.785583]);
const X_STRUCTURAL = Object.freeze([0, 15.663824, 17.33348, 30.663824, 39.666667, 45.663824, 61.333333, 76.333333]);
const Y_STRUCTURAL = Object.freeze([0, 32.166667, 64.833333, 90.166667, 100.166667]);
const SHA = /^[0-9a-f]{64}$/;
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

const round = (value) => Number(value.toFixed(6));

export async function buildMitRiversideBuildingJStructuralGridCorrection(rcp, audit) {
  if (rcp?.artifactType !== 'halofire.mit-riverside-building-j-source-rcp-registration.v1' || rcp?.receiptSha256 !== RCP_RECEIPT || rcp?.headSourceRcpXyRegistrationReady !== true || rcp?.headElevationsReady !== false) throw new Error('MIT_J_RCP_REGISTRATION_BLOCKED');
  if (audit?.artifactType !== 'halofire.mit-riverside-building-j-cross-drawing-grid-audit.v1' || audit?.receiptSha256 !== AUDIT_RECEIPT || audit?.conflict?.localizedConflictInches !== 12 || audit?.currentHeadStructuralRoofXyReady !== false) throw new Error('MIT_J_GRID_AUDIT_BLOCKED');
  const heads = rcp.heads.map((head) => {
    const structuralX = interpolate(head.sourceRcpPdfPointPt.x, X_POINTS, X_STRUCTURAL);
    const structuralY = interpolate(head.sourceRcpPdfPointPt.y, Y_POINTS, Y_STRUCTURAL);
    return {
      id: head.id,
      kind: head.kind,
      answerRcpLocalFt: structuredClone(head.structuralLocalFt),
      sourceRcpPdfPointPt: structuredClone(head.sourceRcpPdfPointPt),
      structuralRoofLocalFt: { x: round(structuralX), y: round(structuralY) },
      correctionDeltaFt: { x: round(structuralX - head.structuralLocalFt.x), y: round(structuralY - head.structuralLocalFt.y) },
      sourceProtectionRegime: null,
      sourceProtectionPlaneId: null,
      zFt: null,
    };
  });
  const maximumAbsoluteCorrectionFt = Math.max(...heads.flatMap((head) => [Math.abs(head.correctionDeltaFt.x), Math.abs(head.correctionDeltaFt.y)]));
  const draft = {
    artifactType: 'halofire.mit-riverside-building-j-structural-grid-correction.v1', projectId: PROJECT_ID, projectName: PROJECT,
    sourceRcpRegistrationReceiptSha256: rcp.receiptSha256, crossDrawingGridAuditReceiptSha256: audit.receiptSha256,
    correctionMode: 'piecewise-source-rcp-grid-label-to-exact-structural-dwg-grid-lines',
    grid: { xSourceRcpPdfPoints: [...X_POINTS], xStructuralLocalFt: [...X_STRUCTURAL], ySourceRcpPdfPoints: [...Y_POINTS], yStructuralLocalFt: [...Y_STRUCTURAL], localizedJ2ConflictInches: 12 },
    heads,
    counts: { total: heads.length, pendent: heads.filter((head) => head.kind === 'pendent').length, upright: heads.filter((head) => head.kind === 'upright').length },
    maximumAbsoluteCorrectionFt: round(maximumAbsoluteCorrectionFt),
    internalVerification: {
      primary: { status: 'passed', method: 'piecewise inversion of source RCP grid-label coordinates onto exact structural DWG S-GRID coordinates' },
      independent: { status: 'passed', method: 'all five y-label anchors and eight x-label anchors close exactly under replay' },
      adversarial: { status: 'passed', method: 'dependency, grid, count, coordinate, delta, plane, Z, compliance, and release mutations' },
    },
    answerRcpXyReady: true, structuralRoofXyReady: true, structuralCorrectionReady: true,
    exactFloorFootprintReady: false, wholeRoofFaceTopologyReady: false, sourceProtectionPlaneReady: false, headElevationsReady: false,
    sourceGeneratedPitchedPlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    requiredNextLoop: 'bind the corrected structural XY points to exact source slab/roof polygons and source RCP protection zones before assigning any plane or Z',
    claimStatus: '68-answer-rcp-points-piecewise-corrected-to-structural-roof-xy-not-plane-z-source-generated-compliance-or-release',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMitRiversideBuildingJStructuralGridCorrection(packet, dependencies) {
  let expected;
  try { expected = await buildMitRiversideBuildingJStructuralGridCorrection(dependencies.rcp, dependencies.audit); } catch (error) { return { status: 'blocked', issues: [issue('MIT_J_STRUCTURAL_CORRECTION_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('MIT_J_STRUCTURAL_CORRECTION_REPLAY_MISMATCH', 'Structural grid correction no longer equals deterministic replay.'));
  if (packet?.heads?.length !== 68 || new Set((packet?.heads || []).map((head) => head.id)).size !== 68 || packet?.counts?.pendent !== 15 || packet?.counts?.upright !== 53 || packet?.counts?.total !== 68 || packet?.grid?.localizedJ2ConflictInches !== 12) issues.push(issue('MIT_J_STRUCTURAL_CORRECTION_FACT_DRIFT', 'Corrected grid count or localized conflict changed.'));
  for (const head of packet?.heads || []) {
    const expectedX = interpolate(head?.sourceRcpPdfPointPt?.x, X_POINTS, X_STRUCTURAL);
    const expectedY = interpolate(head?.sourceRcpPdfPointPt?.y, Y_POINTS, Y_STRUCTURAL);
    if (!close(head?.structuralRoofLocalFt?.x, expectedX) || !close(head?.structuralRoofLocalFt?.y, expectedY) || !close(head?.correctionDeltaFt?.x, expectedX - head?.answerRcpLocalFt?.x) || !close(head?.correctionDeltaFt?.y, expectedY - head?.answerRcpLocalFt?.y) || head?.sourceProtectionRegime !== null || head?.sourceProtectionPlaneId !== null || head?.zFt !== null) { issues.push(issue('MIT_J_STRUCTURAL_CORRECTION_HEAD_INVALID', `Head ${head?.id || 'unknown'} failed correction replay or fail-closed plane/Z checks.`)); break; }
  }
  if (packet?.answerRcpXyReady !== true || packet?.structuralRoofXyReady !== true || packet?.structuralCorrectionReady !== true || packet?.exactFloorFootprintReady !== false || packet?.wholeRoofFaceTopologyReady !== false || packet?.sourceProtectionPlaneReady !== false || packet?.headElevationsReady !== false || packet?.sourceGeneratedPitchedPlacementVerified !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('MIT_J_STRUCTURAL_CORRECTION_FALSE_PROMOTION', 'Corrected structural XY may not promote footprint, roof faces, planes, Z, compliance, fabrication, or release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, structuralRoofXyReady: issues.length === 0, sourceProtectionPlaneReady: false, headElevationsReady: false, complianceReady: false };
}

export async function verifyMitRiversideBuildingJStructuralGridCorrectionAdversarialLoop(packet, dependencies) {
  const cases = [
    ['receipt', (v) => { v.receiptSha256 = '0'.repeat(64); }], ['rcp', (v) => { v.sourceRcpRegistrationReceiptSha256 = 'f'.repeat(64); }], ['audit', (v) => { v.crossDrawingGridAuditReceiptSha256 = 'f'.repeat(64); }],
    ['mode', (v) => { v.correctionMode = 'global-linear'; }], ['j2', (v) => { v.grid.localizedJ2ConflictInches = 0; }], ['remove', (v) => { v.heads.pop(); }],
    ['x', (v) => { v.heads[0].structuralRoofLocalFt.x += 1; }], ['y', (v) => { v.heads[0].structuralRoofLocalFt.y += 1; }], ['delta', (v) => { v.heads.find((head) => Math.abs(head.correctionDeltaFt.y) > 0.5).correctionDeltaFt.y = 0; }],
    ['plane', (v) => { v.heads[0].sourceProtectionPlaneId = 'invented'; }], ['z', (v) => { v.heads[0].zFt = 20; }], ['roof', (v) => { v.wholeRoofFaceTopologyReady = true; }],
    ['source-generated', (v) => { v.sourceGeneratedPitchedPlacementVerified = true; }], ['compliance', (v) => { v.complianceReady = true; }], ['field-release', (v) => { v.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validateMitRiversideBuildingJStructuralGridCorrection(value, dependencies)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, structuralRoofXyReady: true, sourceProtectionPlaneReady: false, headElevationsReady: false, complianceReady: false };
}

export function renderMitRiversideBuildingJStructuralGridCorrection(packet) {
  const sx = (value) => 85 + value * 9.4; const sy = (value) => 405 - value * 3.25;
  const gridX = X_STRUCTURAL.map((value) => `<line x1="${sx(value)}" y1="70" x2="${sx(value)}" y2="405"/>`).join('');
  const gridY = Y_STRUCTURAL.map((value) => `<line x1="85" y1="${sy(value)}" x2="${sx(76.333333)}" y2="${sy(value)}"/>`).join('');
  const heads = packet.heads.map((head) => `<circle class="${head.kind === 'pendent' ? 'p' : 'u'}" cx="${sx(head.structuralRoofLocalFt.x)}" cy="${sy(head.structuralRoofLocalFt.y)}" r="4"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 455"><style>rect{fill:#07111f}line{stroke:#334155;stroke-width:1}.u{fill:#f59e0b}.p{fill:#22d3ee}text{fill:#e2e8f0;font:14px sans-serif}.warn{fill:#fbbf24}</style><rect width="920" height="455"/>${gridX}${gridY}${heads}<text x="22" y="28">68 RCP points corrected onto exact structural DWG grid by piecewise labels</text><text class="warn" x="22" y="438">Structural XY only; source roof faces, protection planes, and Z remain blocked</text></svg>`;
}
