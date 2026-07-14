import { sha256Hex } from './elevation-datums.js';

const PROJECT_ID = 'mit-riverside-building-j';
const PROJECT = 'MIT Riverside - Transportation Building J';
const ANSWER_CALIBRATION_COMMIT = 'cd6d38f0';
const ANSWER_EVIDENCE_RECEIPT = '1c1ac44482e7a2bba7f8356a75277da3245306eb0d23429085e737f8ff2752bc';
const ANSWER_CALIBRATION_RECEIPT = '0cdc912de604731bef8e51cf860ab6c18fd021f101f25636bd10446dae058710';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const close = (left, right, tolerance = 0.000002) => Math.abs(left - right) <= tolerance;

export async function sealMitRiversideBuildingJHeadCoordinateEvidence(draft) {
  const { receiptSha256: _ignored, ...body } = draft;
  return { ...body, receiptSha256: await sha256Hex(body) };
}

export async function validateMitRiversideBuildingJHeadCoordinateEvidence(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.mit-riverside-building-j-head-coordinate-evidence.v1' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) issues.push(issue('MIT_J_HEAD_EVIDENCE_IDENTITY_INVALID', 'Building J head-coordinate evidence identity changed.'));
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('MIT_J_HEAD_EVIDENCE_RECEIPT_MISMATCH', 'Building J head-coordinate evidence changed.'));
  if (packet?.answerCalibrationCommit !== ANSWER_CALIBRATION_COMMIT || packet?.answerEvidenceReceiptSha256 !== ANSWER_EVIDENCE_RECEIPT) issues.push(issue('MIT_J_HEAD_EXTRACTION_ORDER_INVALID', 'Head extraction is not bound after the pushed count/grid calibration.'));
  const extraction = packet?.extraction;
  if (extraction?.method !== 'PyMuPDF vector-path classification on immutable approved/as-built page 2' || extraction?.candidateOuterCircleCount !== 69 || extraction?.excludedCrossedValveCount !== 1 || extraction?.pendentCenteredCircleCount !== 13 || extraction?.uprightCenteredCircleCount !== 1 || extraction?.approvedAsBuiltVectorSymbolsIdentical !== true || extraction?.approvedAsBuiltMaximumCoordinateDeltaPt !== 0) issues.push(issue('MIT_J_HEAD_EXTRACTION_METHOD_DRIFT', 'Building J vector classification or approved/as-built parity changed.'));
  const heads = packet?.heads || [];
  const pendent = heads.filter((head) => head.kind === 'pendent');
  const upright = heads.filter((head) => head.kind === 'upright');
  if (heads.length !== 68 || pendent.length !== 15 || upright.length !== 53 || packet?.counts?.pendent !== 15 || packet?.counts?.upright !== 53 || packet?.counts?.total !== 68) issues.push(issue('MIT_J_HEAD_COUNT_MISMATCH', 'Extracted head classes no longer reconcile to the 68-head schedule.'));
  if (new Set(heads.map((head) => head.id)).size !== 68 || packet?.excludedSymbols?.length !== 1 || packet?.excludedSymbols?.[0]?.kind !== 'crossed-valve' || !close(packet?.excludedSymbols?.[0]?.pagePointPt?.x, 867.719971) || !close(packet?.excludedSymbols?.[0]?.pagePointPt?.y, 345.47998)) issues.push(issue('MIT_J_HEAD_SYMBOL_IDENTITY_INVALID', 'Head ids are not unique or the crossed valve exclusion changed.'));
  for (const head of heads) {
    const pageX = head?.pagePointPt?.x; const pageY = head?.pagePointPt?.y;
    const cropX = (1342 - pageY) * 4; const cropY = (pageX - 120) * 4;
    const localX = 0.027780973797536804 * cropX - 36.928509664140215;
    const localY = 0.027783395349058156 * cropY - 15.998146868799669;
    const expectedCircles = head.kind === 'pendent' ? 13 : head.kind === 'upright' ? 1 : -1;
    if (!Number.isFinite(pageX) || !Number.isFinite(pageY) || !close(head?.cropPixel?.x, cropX) || !close(head?.cropPixel?.y, cropY) || !close(head?.localFt?.x, localX) || !close(head?.localFt?.y, localY) || head.centeredCircleCount !== expectedCircles || head.localFt.x < 0 || head.localFt.x > 76.333333 || head.localFt.y < 0 || head.localFt.y > 100.166667 || head.zFt !== null || head.sourceProtectionPlaneId !== null) { issues.push(issue('MIT_J_HEAD_COORDINATE_INVALID', `Head ${head?.id || 'unknown'} failed vector transform, class, envelope, or fail-closed Z checks.`)); break; }
  }
  const claims = packet?.claims;
  if (claims?.exactAnswerHeadCoordinatesReady !== true || claims?.headElevationsReady !== false || claims?.wholeRoofHeadPlaneAssignmentReady !== false || claims?.sourceGeneratedPitchedPlacementVerified !== false || claims?.complianceReady !== false || claims?.fabricationReady !== false || claims?.fieldReleaseReady !== false) issues.push(issue('MIT_J_HEAD_EVIDENCE_FALSE_PROMOTION', 'Exact answer XY may not promote Z, source generation, compliance, fabrication, or field release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, exactAnswerHeadCoordinatesReady: issues.length === 0, headElevationsReady: false, sourceGeneratedPitchedPlacementVerified: false, complianceReady: false };
}

export async function buildMitRiversideBuildingJHeadCoordinateRegistration(answerCalibration, headEvidence) {
  if (answerCalibration?.artifactType !== 'halofire.mit-riverside-building-j-pitched-layout-calibration.v1' || answerCalibration?.receiptSha256 !== ANSWER_CALIBRATION_RECEIPT || answerCalibration?.answerRegistrationReady !== true || answerCalibration?.exactHeadCoordinateRegistrationReady !== false) throw new Error('MIT_J_ANSWER_CALIBRATION_BLOCKED');
  if ((await validateMitRiversideBuildingJHeadCoordinateEvidence(headEvidence)).status !== 'passed') throw new Error('MIT_J_HEAD_COORDINATE_EVIDENCE_BLOCKED');
  const draft = {
    artifactType: 'halofire.mit-riverside-building-j-head-coordinate-registration.v1', projectId: PROJECT_ID, projectName: PROJECT,
    answerCalibrationCommit: ANSWER_CALIBRATION_COMMIT, answerCalibrationReceiptSha256: answerCalibration.receiptSha256, headCoordinateEvidenceReceiptSha256: headEvidence.receiptSha256,
    registrationMode: 'approved-and-asbuilt-identical-vector-symbols-on-immutable-structural-grid',
    counts: structuredClone(headEvidence.counts), excludedCrossedValveCount: 1,
    coordinateSystem: { axes: 'local structural grid feet', widthFt: 76.333333, depthFt: 100.166667, maximumSourceGridResidualPx: 0.798381 },
    heads: headEvidence.heads.map((head) => ({ id: head.id, kind: head.kind, localFt: structuredClone(head.localFt), approvedPagePointPt: structuredClone(head.pagePointPt), zFt: null, sourceProtectionPlaneId: null })),
    internalVerification: {
      primary: { status: 'passed', method: 'approved page-2 vector symbol extraction and structural-grid transform' },
      independent: { status: 'passed', method: 'as-built page-2 vector extraction with zero coordinate delta and schedule reconciliation' },
      adversarial: { status: 'passed', method: 'receipt, commit, count, symbol class, coordinate transform, valve exclusion, Z, plane, compliance, and release mutations' },
    },
    exactAnswerHeadCoordinatesReady: true, approvedAsBuiltHeadCoordinateContinuityReady: true,
    headElevationsReady: false, wholeRoofHeadPlaneAssignmentReady: false, branchPipeTopologyReady: false,
    sourceGeneratedPitchedPlacementVerified: false, freshProjectPlacementVerified: false,
    hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    requiredNextLoop: 'extract answer branch connectivity, bind the 68 XY heads to source RCP/section protection planes and elevations, then learn transferable rules before a second fresh pitched-roof holdout',
    claimStatus: 'exact-completed-bid-approved-asbuilt-head-xy-registered-not-z-plane-source-generated-compliance-fabrication-or-field-release',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMitRiversideBuildingJHeadCoordinateRegistration(packet, dependencies) {
  let expected;
  try { expected = await buildMitRiversideBuildingJHeadCoordinateRegistration(dependencies.answerCalibration, dependencies.headEvidence); } catch (error) { return { status: 'blocked', issues: [issue('MIT_J_HEAD_REGISTRATION_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('MIT_J_HEAD_REGISTRATION_REPLAY_MISMATCH', 'Building J head registration no longer equals deterministic replay.'));
  if (packet?.heads?.length !== 68 || packet?.counts?.pendent !== 15 || packet?.counts?.upright !== 53 || packet?.excludedCrossedValveCount !== 1 || packet?.exactAnswerHeadCoordinatesReady !== true) issues.push(issue('MIT_J_HEAD_REGISTRATION_FACT_DRIFT', 'Building J registered coordinate facts changed.'));
  if (packet?.heads?.some((head) => head.zFt !== null || head.sourceProtectionPlaneId !== null) || packet?.headElevationsReady !== false || packet?.wholeRoofHeadPlaneAssignmentReady !== false || packet?.branchPipeTopologyReady !== false || packet?.sourceGeneratedPitchedPlacementVerified !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('MIT_J_HEAD_REGISTRATION_FALSE_PROMOTION', 'Building J answer XY promoted Z, pipes, source generation, compliance, fabrication, or release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, exactAnswerHeadCoordinatesReady: issues.length === 0, headElevationsReady: false, sourceGeneratedPitchedPlacementVerified: false, complianceReady: false };
}

export async function verifyMitRiversideBuildingJHeadRegistrationAdversarialLoop(packet, dependencies) {
  const cases = [
    ['receipt', (v) => { v.receiptSha256 = '0'.repeat(64); }], ['commit', (v) => { v.answerCalibrationCommit = 'answer-first'; }],
    ['evidence', (v) => { v.headCoordinateEvidenceReceiptSha256 = 'f'.repeat(64); }], ['total', (v) => { v.counts.total = 67; }],
    ['pendent', (v) => { v.counts.pendent = 14; }], ['upright', (v) => { v.counts.upright = 54; }], ['valve', (v) => { v.excludedCrossedValveCount = 0; }],
    ['x', (v) => { v.heads[0].localFt.x += 1; }], ['y', (v) => { v.heads[0].localFt.y += 1; }], ['kind', (v) => { v.heads[0].kind = 'pendent'; }],
    ['remove', (v) => { v.heads.pop(); }], ['z', (v) => { v.heads[0].zFt = 20; }], ['plane', (v) => { v.heads[0].sourceProtectionPlaneId = 'invented'; }],
    ['elevation-ready', (v) => { v.headElevationsReady = true; }], ['pipe-ready', (v) => { v.branchPipeTopologyReady = true; }], ['source-generated', (v) => { v.sourceGeneratedPitchedPlacementVerified = true; }],
    ['compliance', (v) => { v.complianceReady = true; }], ['fabrication', (v) => { v.fabricationReady = true; }], ['field-release', (v) => { v.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validateMitRiversideBuildingJHeadCoordinateRegistration(value, dependencies)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, headElevationsReady: false, complianceReady: false };
}

export function renderMitRiversideBuildingJHeadRegistrationViews(packet) {
  const sx = (value) => 90 + value * 9.2; const sy = (value) => 410 - value * 3.35;
  const gridX = [0, 15.666667, 17.333333, 30.666667, 39.666667, 45.666667, 61.333333, 76.333333].map((value) => `<line x1="${sx(value)}" y1="74" x2="${sx(value)}" y2="410"/>`).join('');
  const gridY = [0, 32.166667, 64.833333, 89.166667, 100.166667].map((value) => `<line x1="90" y1="${sy(value)}" x2="${sx(76.333333)}" y2="${sy(value)}"/>`).join('');
  const heads = packet.heads.map((head) => `<circle class="${head.kind === 'pendent' ? 'p' : 'u'}" cx="${sx(head.localFt.x)}" cy="${sy(head.localFt.y)}" r="4.5"/>`).join('');
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 465"><style>rect{fill:#07111f}line{stroke:#22d3ee;stroke-width:1}.u{fill:#f59e0b;stroke:#fff;stroke-width:.5}.p{fill:#22d3ee;stroke:#fff;stroke-width:.5}text{fill:#e2e8f0;font:14px sans-serif}.warn{fill:#fbbf24}</style><rect width="920" height="465"/><g>${gridX}${gridY}</g>${heads}<text x="22" y="28">EXACT COMPLETED-BID XY: 53 upright (orange) + 15 pendent (cyan) = 68; approved/as-built vector delta 0</text><text class="warn" x="22" y="448">Answer registration proof only - not source-generated placement, elevation, compliance, fabrication, or field release</text></svg>`;
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 430"><style>rect{fill:#07111f}.roof{stroke:#f59e0b;stroke-width:7}.datum{stroke:#67e8f9;stroke-dasharray:8 6}text{fill:#e2e8f0;font:15px sans-serif}.warn{fill:#fbbf24}</style><rect width="920" height="430"/><line class="datum" x1="55" y1="330" x2="865" y2="330"/><line class="roof" x1="90" y1="270" x2="650" y2="160"/><line class="roof" x1="650" y1="285" x2="830" y2="310"/><text x="22" y="28">Source pitches/datums remain registered; exact answer XY count = 68</text><text class="warn" x="22" y="410">No head marks shown here: individual Z and source protection-plane assignments remain blocked</text></svg>`;
  const model3dSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 430"><style>rect{fill:#07111f}.mass{fill:#1d4ed8;fill-opacity:.58;stroke:#60a5fa;stroke-width:3}text{fill:#e2e8f0;font:15px sans-serif}.warn{fill:#fbbf24}</style><rect width="920" height="430"/><polygon class="mass" points="120,310 480,220 730,285 365,375"/><text x="22" y="28">Source pitched mass plus exact answer XY evidence; Z remains unknown</text><text class="warn" x="22" y="410">No 3D heads fabricated from 2D points - section/RCP plane assignment is the next gate</text></svg>`;
  return { status: 'passed', topSvg, elevationSvg, model3dSvg, exactAnswerHeadCoordinatesReady: true, headElevationsReady: false, complianceReady: false };
}
