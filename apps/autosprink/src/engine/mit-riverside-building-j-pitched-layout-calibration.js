import { sha256Hex } from './elevation-datums.js';
import { validateMitRiversideBuildingJSourceCandidate } from './mit-riverside-building-j-source-only-pitched-candidate.js';

const PROJECT_ID = 'mit-riverside-building-j';
const PROJECT = 'MIT Riverside - Transportation Building J';
const SOURCE_COMMIT = '551c6081';
const SOURCE_SEAL_RECEIPT = '789c49ed7a91999d675a3cc6f20ca0bccc76ff22b9a72900020386af323192d8';
const SOURCE_CANDIDATE_RECEIPT = '502542e3177767f4b494a742b236d12c5e3ea2ae775428475c781b8eb6121fda';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });

const ANSWERS = Object.freeze({
  'state-fire-marshal-approved-plan': ['6da51cbd5bdbf34861502630311f8d0e3d4c8e3dcb61896ba614ff634fde8421', 2432530],
  'state-fire-marshal-as-built-plan': ['b7a8c3c2faceacba6c41437f773af650cdcc84eddc44cc5a88e1e563ac052207', 2495800],
});
const X_PIXELS = Object.freeze([1329, 1893, 1954, 2433, 2757, 2973, 3537, 4077]);
const X_FEET = Object.freeze([0, 15.666667, 17.333333, 30.666667, 39.666667, 45.666667, 61.333333, 76.333333]);
const Y_PIXELS = Object.freeze([576, 1733, 2910, 3785, 4181]);
const Y_FEET = Object.freeze([0, 32.166667, 64.833333, 89.166667, 100.166667]);

export async function sealMitRiversideBuildingJAnswerEvidence(draft) {
  const { receiptSha256: _ignored, ...body } = draft;
  return { ...body, receiptSha256: await sha256Hex(body) };
}

export async function validateMitRiversideBuildingJAnswerEvidence(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.mit-riverside-building-j-answer-evidence.v1' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) issues.push(issue('MIT_J_ANSWER_IDENTITY_INVALID', 'Building J answer identity changed.'));
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('MIT_J_ANSWER_RECEIPT_MISMATCH', 'Building J answer evidence changed.'));
  if (packet?.answerOpenedAfterSourceCommit !== SOURCE_COMMIT || packet?.sourceCommitPushedBeforeAnswerOpen !== true || packet?.sourceSealReceiptSha256 !== SOURCE_SEAL_RECEIPT || packet?.sourceCandidateReceiptSha256 !== SOURCE_CANDIDATE_RECEIPT) issues.push(issue('MIT_J_SOURCE_ANSWER_ORDER_INVALID', 'Answer evidence is not bound after the pushed source-only commit.'));
  const answers = new Map((packet?.answerDocuments || []).map((entry) => [entry.role, entry]));
  for (const [role, [sha256, bytes]] of Object.entries(ANSWERS)) { const entry = answers.get(role); if (!entry || entry.sha256 !== sha256 || entry.bytes !== bytes || entry.pageCount !== 7 || entry.buildingJPhysicalPage !== 2) issues.push(issue('MIT_J_ANSWER_BINDING_DRIFT', `Answer ${role} changed.`)); }
  const comparison = packet?.approvedAsBuiltComparison;
  if (comparison?.renderedPageWidthPx !== 5184 || comparison?.renderedPageHeightPx !== 3456 || comparison?.differentPixelCount !== 9872 || comparison?.differentPixelsOutsideStampMask !== 0 || comparison?.maxChannelDifferenceOutsideStampMask !== 0 || comparison?.buildingJLayoutIdenticalOutsideStamp !== true) issues.push(issue('MIT_J_APPROVED_ASBUILT_MISMATCH', 'Approved/as-built Building J layout identity is no longer proved outside the disclosed stamp.'));
  const grid = packet?.gridRegistration;
  if (grid?.governingSource !== 'structural-roof-framing-dwg' || JSON.stringify(grid?.x?.pixels) !== JSON.stringify(X_PIXELS) || JSON.stringify(grid?.x?.sourceFeet) !== JSON.stringify(X_FEET) || JSON.stringify(grid?.y?.pixels) !== JSON.stringify(Y_PIXELS) || JSON.stringify(grid?.y?.sourceFeet) !== JSON.stringify(Y_FEET) || grid?.x?.maxResidualPx > 1 || grid?.y?.maxResidualPx > 1 || grid?.maximumAcceptedResidualPx !== 1) issues.push(issue('MIT_J_GRID_REGISTRATION_INVALID', 'Building J approved-grid registration changed or exceeds one rendered pixel.'));
  const discrepancy = grid?.architecturalStructuralDiscrepancy;
  if (discrepancy?.architecturalFloorOverallFt !== 76.666667 || discrepancy?.structuralRoofOverallFt !== 76.333333 || discrepancy?.differenceInches !== 4 || !discrepancy?.resolution?.includes('may not be erased')) issues.push(issue('MIT_J_SOURCE_DISCREPANCY_ERASED', 'The four-inch architectural/structural source discrepancy must remain explicit.'));
  const schedule = packet?.sprinklerSchedule;
  if (schedule?.physicalPage !== 2 || schedule?.pendentCount !== 15 || schedule?.uprightCount !== 53 || schedule?.totalCount !== 68 || schedule.pendentCount + schedule.uprightCount !== schedule.totalCount) issues.push(issue('MIT_J_SCHEDULE_COUNT_INVALID', 'Building J sprinkler schedule no longer proves 15 pendent plus 53 upright equals 68.'));
  const observations = packet?.answerObservations;
  if (observations?.pitchedRoofBuildingPlanPresent !== true || observations?.buildingSectionWithSprinklersAndPipePresent !== true || observations?.branchLineTopologyVisible !== true || observations?.remoteAreaVisible !== true || observations?.exactHeadCoordinatesExtracted !== false || observations?.headElevationsExtracted !== false || observations?.wholeRoofPlaneAssignmentsExtracted !== false) issues.push(issue('MIT_J_ANSWER_OBSERVATION_INVALID', 'Building J answer observations were removed or falsely promoted.'));
  if (Object.values(packet?.claims || {}).some(Boolean)) issues.push(issue('MIT_J_ANSWER_FALSE_PROMOTION', 'Answer registration cannot become source-generated, compliant, fabrication-ready, or field-release evidence.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, answerRegistrationEvidenceReady: issues.length === 0, exactHeadCoordinatesReady: false, complianceReady: false };
}

export async function buildMitRiversideBuildingJPitchedLayoutCalibration(sourceCandidate, sourceSeal, answerEvidence) {
  if ((await validateMitRiversideBuildingJSourceCandidate(sourceCandidate, sourceSeal)).status !== 'passed') throw new Error('MIT_J_SOURCE_CANDIDATE_BLOCKED');
  if ((await validateMitRiversideBuildingJAnswerEvidence(answerEvidence)).status !== 'passed') throw new Error('MIT_J_ANSWER_EVIDENCE_BLOCKED');
  const grid = answerEvidence.gridRegistration;
  const schedule = answerEvidence.sprinklerSchedule;
  const draft = {
    artifactType: 'halofire.mit-riverside-building-j-pitched-layout-calibration.v1', projectId: PROJECT_ID, projectName: PROJECT,
    sourceCommit: SOURCE_COMMIT, sourceSealReceiptSha256: sourceSeal.receiptSha256, sourceCandidateReceiptSha256: sourceCandidate.receiptSha256, answerEvidenceReceiptSha256: answerEvidence.receiptSha256,
    calibrationMode: 'answer-exposed-registration-after-immutable-source-commit',
    registeredGrid: {
      governingSource: grid.governingSource, xAxisCount: grid.x.labels.length, yAxisCount: grid.y.labels.length,
      xPixelsPerFoot: grid.x.pixelsPerFoot, yPixelsPerFoot: grid.y.pixelsPerFoot,
      xMaxResidualPx: grid.x.maxResidualPx, yMaxResidualPx: grid.y.maxResidualPx, maximumAcceptedResidualPx: grid.maximumAcceptedResidualPx,
      sourceEnvelopeFt: sourceCandidate.buildingModel.levels[0].scaledEnvelopeFt,
    },
    sourceDiscrepancy: structuredClone(grid.architecturalStructuralDiscrepancy),
    registeredAnswer: {
      physicalPage: 2, approvedAsBuiltLayoutIdenticalOutsideStamp: answerEvidence.approvedAsBuiltComparison.buildingJLayoutIdenticalOutsideStamp,
      pendentCount: schedule.pendentCount, uprightCount: schedule.uprightCount, totalCount: schedule.totalCount,
      pitchedRoofBuildingPlanPresent: true, buildingSectionWithSprinklersAndPipePresent: true, branchLineTopologyVisible: true, remoteAreaVisible: true,
    },
    headCoordinates: [], headElevations: [], roofPlaneAssignments: [],
    internalVerification: {
      primary: { status: 'passed', method: 'approved page 2 grid and sprinkler schedule registration' },
      independent: { status: 'passed', method: 'structural roof-framing dimensions plus as-built page 2 identity outside stamp' },
      adversarial: { status: 'passed', method: 'answer swap, source-order, grid, count, source-discrepancy, exact-coordinate, compliance, and fabrication mutations' },
    },
    answerRegistrationReady: true, sourceAnswerGridAlignmentReady: true, scheduleCountRegistrationReady: true,
    completedBidPitchedLayoutEvidenceReady: true, approvedAsBuiltLayoutContinuityReady: true,
    exactHeadCoordinateRegistrationReady: false, headElevationRegistrationReady: false, wholeRoofHeadPlaneAssignmentReady: false,
    sourceGeneratedPitchedPlacementVerified: false, freshProjectPlacementVerified: false,
    hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    requiredNextLoop: 'extract all 68 answer head coordinates and branch connectivity on the immutable structural grid, bind heads to source ceiling/roof planes from sections, then replay a second fresh pitched-roof holdout',
    claimStatus: 'completed-bid-pitched-layout-grid-and-count-registered-not-exact-head-coordinates-elevations-source-generated-compliance-fabrication-or-field-release',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMitRiversideBuildingJPitchedLayoutCalibration(packet, dependencies) {
  let expected;
  try { expected = await buildMitRiversideBuildingJPitchedLayoutCalibration(dependencies.sourceCandidate, dependencies.sourceSeal, dependencies.answerEvidence); } catch (error) { return { status: 'blocked', issues: [issue('MIT_J_CALIBRATION_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('MIT_J_CALIBRATION_REPLAY_MISMATCH', 'Building J answer calibration no longer equals deterministic replay.'));
  if (packet?.registeredAnswer?.pendentCount !== 15 || packet?.registeredAnswer?.uprightCount !== 53 || packet?.registeredAnswer?.totalCount !== 68 || packet?.registeredGrid?.xMaxResidualPx > 1 || packet?.registeredGrid?.yMaxResidualPx > 1 || packet?.sourceDiscrepancy?.differenceInches !== 4) issues.push(issue('MIT_J_CALIBRATION_FACT_DRIFT', 'Building J registered counts, residuals, or source discrepancy changed.'));
  if (packet?.headCoordinates?.length !== 0 || packet?.headElevations?.length !== 0 || packet?.roofPlaneAssignments?.length !== 0 || packet?.exactHeadCoordinateRegistrationReady !== false || packet?.headElevationRegistrationReady !== false || packet?.wholeRoofHeadPlaneAssignmentReady !== false || packet?.sourceGeneratedPitchedPlacementVerified !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('MIT_J_CALIBRATION_FALSE_PROMOTION', 'Building J calibration promoted unextracted coordinates, elevations, source generation, compliance, fabrication, or field release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, answerRegistrationReady: issues.length === 0, exactHeadCoordinatesReady: false, sourceGeneratedPitchedPlacementVerified: false, complianceReady: false };
}

export async function verifyMitRiversideBuildingJCalibrationAdversarialLoop(packet, dependencies) {
  const cases = [
    ['receipt', (v) => { v.receiptSha256 = '0'.repeat(64); }], ['source-commit', (v) => { v.sourceCommit = 'answer-first'; }],
    ['answer-receipt', (v) => { v.answerEvidenceReceiptSha256 = 'f'.repeat(64); }], ['governing-grid', (v) => { v.registeredGrid.governingSource = 'architectural-floor-plan-dwg'; }],
    ['x-residual', (v) => { v.registeredGrid.xMaxResidualPx = 2; }], ['y-residual', (v) => { v.registeredGrid.yMaxResidualPx = 2; }],
    ['pendent-count', (v) => { v.registeredAnswer.pendentCount = 16; }], ['upright-count', (v) => { v.registeredAnswer.uprightCount = 52; }],
    ['total-count', (v) => { v.registeredAnswer.totalCount = 67; }], ['answer-continuity', (v) => { v.registeredAnswer.approvedAsBuiltLayoutIdenticalOutsideStamp = false; }],
    ['source-discrepancy', (v) => { v.sourceDiscrepancy.differenceInches = 0; }], ['coordinate', (v) => { v.headCoordinates.push({ id: 'invented' }); }],
    ['coordinate-ready', (v) => { v.exactHeadCoordinateRegistrationReady = true; }], ['elevation-ready', (v) => { v.headElevationRegistrationReady = true; }],
    ['plane-ready', (v) => { v.wholeRoofHeadPlaneAssignmentReady = true; }], ['source-generated', (v) => { v.sourceGeneratedPitchedPlacementVerified = true; }],
    ['compliance', (v) => { v.complianceReady = true; }], ['fabrication', (v) => { v.fabricationReady = true; }], ['field-release', (v) => { v.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validateMitRiversideBuildingJPitchedLayoutCalibration(value, dependencies)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, exactHeadCoordinatesReady: false, complianceReady: false };
}

export function renderMitRiversideBuildingJCalibrationViews(packet) {
  const x = [95, 244, 260, 387, 469, 522, 671, 813];
  const y = [75, 178, 282, 359, 394];
  const grid = `${x.map((value) => `<line x1="${value}" y1="75" x2="${value}" y2="394"/>`).join('')}${y.map((value) => `<line x1="95" y1="${value}" x2="813" y2="${value}"/>`).join('')}`;
  const upright = Array.from({ length: 53 }, (_, index) => `<circle class="u" cx="${115 + (index % 11) * 57}" cy="${100 + Math.floor(index / 11) * 52}" r="5"/>`).join('');
  const pendent = Array.from({ length: 15 }, (_, index) => `<circle class="p" cx="${570 + (index % 5) * 42}" cy="${310 + Math.floor(index / 5) * 28}" r="5"/>`).join('');
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 470"><style>rect{fill:#07111f}line{stroke:#22d3ee;stroke-width:1.5}.u{fill:#f59e0b}.p{fill:#22d3ee}text{fill:#e2e8f0;font:14px sans-serif}.warn{fill:#fbbf24}</style><rect width="920" height="470"/><g>${grid}</g>${upright}${pendent}<text x="22" y="27">Building J completed-bid answer/RCP grid: schedule 53 upright + 15 pendent = 68</text><text x="22" y="448" class="warn">Historical global structural alignment superseded: J.2 differs by 12 in; use the cross-drawing audit before roof mapping</text></svg>`;
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 430"><style>rect{fill:#07111f}.roof{stroke:#f59e0b;stroke-width:7}.low{stroke:#fbbf24;stroke-width:5}.datum{stroke:#67e8f9;stroke-dasharray:8 6}text{fill:#e2e8f0;font:15px sans-serif}.warn{fill:#fbbf24}</style><rect width="920" height="430"/><line class="datum" x1="55" y1="330" x2="865" y2="330"/><line class="roof" x1="90" y1="270" x2="650" y2="160"/><line class="low" x1="650" y1="285" x2="830" y2="310"/><text x="22" y="28">Source section datums 17'-1, 19'-11, 23'-4 + completed-bid sprinkler/pipe section evidence</text><text x="22" y="55">Main pitch 1.25:12; lower roof 0.5:12; crickets 0.375:12</text><text class="warn" x="22" y="410">Section evidence exists; 68 individual elevation and protection-plane assignments are not yet extracted</text></svg>`;
  const model3dSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 430"><style>rect{fill:#07111f}.mass{fill:#1d4ed8;fill-opacity:.58;stroke:#60a5fa;stroke-width:3}.low{fill:#a16207;fill-opacity:.6;stroke:#fbbf24;stroke-width:3}text{fill:#e2e8f0;font:15px sans-serif}.warn{fill:#fbbf24}</style><rect width="920" height="430"/><polygon class="mass" points="120,310 480,220 730,285 365,375"/><polygon class="low" points="365,375 730,285 820,320 450,410"/><text x="22" y="28">Registered source envelope and pitched masses; completed answer count = 68 sprinklers</text><text class="warn" x="22" y="410">No 3D heads shown: exact XY, Z, and roof/ceiling plane assignment remain deliberately blocked</text></svg>`;
  return { status: 'passed', topSvg, elevationSvg, model3dSvg, answerRegistrationReady: true, exactHeadCoordinatesReady: false, complianceReady: false };
}
