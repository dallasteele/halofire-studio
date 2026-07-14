import { sha256Hex } from './elevation-datums.js';

const SHA = /^[0-9a-f]{64}$/;
const SOURCE_SEAL_RECEIPT = 'f77a2a15ab76762c2376edaa4d1c5d36a6b4ecd607960b50ea0b8348d3941823';
const SOURCE_DECISION_RECEIPT = '5d28547bee67ec9dd74e06969f399494639ae0d3cc3725b5b5ef9759f1d7db3a';
const HELDOUT_COMPARISON_RECEIPT = 'd63714a8afb62a0943b00559142be7cb8b1eb5ab73cfb5825a5541eb6a459258';
const ANSWERS = Object.freeze([
  { role: 'approved-sprinkler-answer', file: '5578-23-1_APPROVED-SPKL.pdf', sha256: 'aca50702f61969dd6e280a0cc6147e8f38de9b244ad345df2f34dbdaa59a9ea1', bytes: 1032103, page: 2 },
  { role: 'as-built-sprinkler-answer', file: 'Boyd Residence - Scottsdale AZ_as builts.pdf', sha256: 'd000944951e8e55c4d7e413ec17928e7849eca05b6677f12a4eae1891f4d3313', bytes: 1226254, page: 2 },
]);
const HEAD_POINTS = Object.freeze([[1057.099,1580.681],[1287.409,1580.681],[1036.836,1354.824],[1213.929,1399.836],[1069.103,1053.152],[1187.666,1872.586],[1371.024,1872.586],[993.313,1908.605],[1015.955,1823.06],[1293.472,1291.778],[1176.41,1157.469],[1252.2,462.772],[1333.385,869.304],[1292.242,689.209],[1302.476,1053.149],[1027.081,770.252],[1583.385,1048.816],[1583.391,798.872],[1418.788,1291.791],[1302.476,1193.486],[986.559,553.399],[1816.149,747.886],[1789.137,923.101],[1996.25,954.44],[2178.593,954.439],[1996.247,645.277],[2248.38,645.29],[1933.213,1040.994],[2453.768,516.479],[2594.032,624.536],[2477.796,669.559],[2571.52,696.57],[2398.882,633.54],[2547.373,1065.755],[2409.716,1065.755],[2294.904,1208.708],[2490.429,1208.708],[2356.802,1842.419],[2559.004,1842.419],[2356.802,1494.247],[2559.004,1494.247],[2453.238,813.623],[1766.285,1224.853],[1084.861,462.772],[1364.764,1152.216]]);
const PIPE_SEGMENTS = Object.freeze([[[2427.776,1842.418],[2554.605,1842.418]],[[2361.2,1842.418],[2422.375,1842.418]],[[2361.202,1494.234],[2422.375,1494.234]],[[2427.776,1494.234],[2554.58,1494.234]],[[2428.522,1208.708],[2486.031,1208.708]],[[2343.375,1065.757],[2405.292,1065.757]],[[2414.116,1065.757],[2542.949,1065.757]],[[2294.904,1129.126],[2294.904,1204.321]],[[2453.707,520.868],[2453.707,533.685]],[[2594.032,628.945],[2594.032,654.107]],[[2477.796,659.814],[2477.796,665.16]],[[2571.52,659.814],[2571.52,692.175]],[[2398.882,637.934],[2398.882,653.234]],[[2183.016,954.441],[2337.746,954.441]],[[2252.779,645.277],[2337.746,645.277]],[[2000.683,645.277],[2243.98,645.277]],[[2000.669,954.441],[2174.199,954.441]],[[2343.375,813.623],[2448.844,813.623]],[[1806.975,747.874],[1811.755,747.874]],[[1793.53,923.092],[1801.723,923.092]],[[1933.213,1045.386],[1933.213,1078.069]],[[1766.286,1084.962],[1766.286,1220.458]],[[1583.397,1053.214],[1583.397,1079.332]],[[986.559,557.767],[986.559,646.52]],[[1252.2,467.153],[1252.2,645.596]],[[1270.175,689.209],[1287.82,689.209]],[[1084.861,467.153],[1084.861,645.596]],[[1270.175,869.304],[1328.956,869.304]],[[1073.497,1053.152],[1264.029,1053.152]],[[1269.429,1053.152],[1298.054,1053.152]],[[1180.832,1157.457],[1263.282,1157.457]],[[1270.175,1193.476],[1298.054,1193.476]],[[1297.866,1291.778],[1414.39,1291.778]],[[1270.175,1291.778],[1289.085,1291.778]],[[1041.234,1354.812],[1263.282,1354.812]],[[1218.366,1399.836],[1263.282,1399.836]],[[1061.477,1580.681],[1264.029,1580.681]],[[1269.429,1580.681],[1283.028,1580.681]],[[1192.046,1872.586],[1264.029,1872.586]],[[1269.429,1872.586],[1366.583,1872.586]],[[997.711,1908.605],[1264.206,1908.605]],[[1020.345,1823.06],[1263.282,1823.06]],[[1027.08,652.489],[1027.08,765.865]],[[1583.397,803.247],[1583.397,1044.424]],[[1364.759,1084.962],[1364.759,1147.821]],[[956.967,1908.605],[988.913,1908.605]]]);
const COMPLETED_LABELS = Object.freeze([
  { id: 'great-room-16-max', text: "16' MAX CLG", bboxPt: [1460.87,830.83,1519.06,842.44], heightStatus: 'maximum-only-surface-shape-unresolved' },
  { id: 'breakfast-14-max', text: "14' MAX CLG", bboxPt: [1925.8,714.64,1983.99,726.25], heightStatus: 'maximum-only-surface-shape-unresolved' },
  { id: 'kitchen-14-max', text: "14' MAX CLG", bboxPt: [2176.04,782.92,2234.23,794.53], heightStatus: 'maximum-only-surface-shape-unresolved' },
]);
const issue = (code, message) => ({ severity: 'blocking', code, message });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export async function sealChollaCompletedLayoutRegistration(value) {
  const draft = structuredClone(value);
  delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function buildChollaCompletedLayoutRegistration() {
  const heads = HEAD_POINTS.map(([xPt, yPt], index) => ({
    id: `cholla-f02-head-${String(index + 1).padStart(2, '0')}`,
    family: 'residential-pendent-answer-observed', xPt, yPt,
    zFt: null, ceilingZoneId: null, elevationStatus: 'ceiling-surface-and-zone-boundary-unresolved',
  }));
  return sealChollaCompletedLayoutRegistration({
    artifactType: 'halofire.cholla-main-house-completed-layout-registration.v1',
    projectId: 'boyd-cholla-main-house-scottsdale-az',
    sequence: { answerExposed: true, freshBeforeAnswerOpen: false, correctedImplementationEligibleAsFreshHoldout: false },
    dependencyReceipts: {
      sourceSealReceiptSha256: SOURCE_SEAL_RECEIPT,
      sourceDecisionReceiptSha256: SOURCE_DECISION_RECEIPT,
      heldoutComparisonReceiptSha256: HELDOUT_COMPARISON_RECEIPT,
    },
    answerSources: ANSWERS,
    coordinateSystem: {
      unit: 'pdf-point', origin: 'page-top-left', pageWidthPt: 3456, pageHeightPt: 2592.23999,
      publishedScale: "1/4 inch = 1 foot", pointsPerFoot: 18,
      buildingDatumTransform: null, buildingRegistrationReady: false,
    },
    headExtraction: {
      primary: { method: 'black-filled-core-rectangle', widthPt: [4.3,4.7], heightPt: [4.3,4.7], detected: 45 },
      independent: { method: 'white-halo-path', widthPt: [8.85,9.15], heightPt: [8.85,9.15], minimumPathItems: 50, detected: 45, maximumCenterResidualPt: 0.017782 },
      thresholdStability: { '4.2-4.8': 45, '4.3-4.7': 45, '4.4-4.6': 45 },
      approvedAsBuiltMaximumResidualPt: 0,
      scheduleCrossCheck: { scheduledHeads: 45, extractedHeads: 45, family: 'residential pendent', status: 'passed' },
    },
    heads,
    pipeVectorEvidence: {
      method: 'paired-red-filled-orthogonal-rectangles-seeded-from-extracted-heads',
      rawCandidates: 182, averagedCandidates: 133, headConnectedSegments: PIPE_SEGMENTS,
      coveredHeadCount: 45, maximumHeadToSegmentDistancePt: 4.441,
      completeNetworkTopologyReady: false,
      limitation: 'These segments prove head-adjacent pipe registration only; fittings, continuations, diameters, riser connectivity, and fabrication topology are not reconstructed.',
    },
    ceilingEvidence: {
      sourceDwgKnownLabels: [{ text: "10' CLG", count: 6 }, { text: "9' CLG", count: 2 }],
      completedAnswerAddedMaximumLabels: COMPLETED_LABELS,
      exactZoneBoundariesReady: false, exactCeilingSurfaceReady: false, exactDeflectorElevationReady: false,
      limitation: 'MAX labels are scalar upper controls, not enough to infer pitch, spring line, orientation, polygon boundaries, or each head elevation.',
    },
    internalVerification: {
      primary: { status: 'passed', method: '45-black-core-vectors-plus-schedule-cross-check' },
      independent: { status: 'passed', method: '45-white-halo-vectors-plus-approved-as-built-coordinate-identity' },
      adversarial: { status: 'pending', method: 'receipt-coordinate-count-pipe-zone-and-false-promotion-mutations', rejectedCases: [] },
    },
    answerExposedTopViewCalibrationReady: true,
    topViewReady: true,
    topViewScope: 'completed-answer-pdf-coordinate-registration-only',
    freshHoldoutRequired: true,
    unseenProjectPlacementVerified: false,
    exactDeflectorElevationReady: false,
    elevationViewReady: false,
    wholeBuildingModelReady: false,
    model3dReady: false,
    completePipeTopologyReady: false,
    hydraulicReplayReady: false,
    obstructionClearanceReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'answer-exposed-completed-top-view-registration-not-fresh-placement-elevation-3d-compliance-or-fabrication',
  });
}

export async function validateChollaCompletedLayoutRegistration(value) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.cholla-main-house-completed-layout-registration.v1') return { status: 'blocked', issues: [issue('CHOLLA_LAYOUT_SCHEMA_INVALID', 'Completed-layout registration identity is invalid.')] };
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('CHOLLA_LAYOUT_RECEIPT_MISMATCH', 'Completed-layout registration no longer matches its receipt.'));
  if (value.dependencyReceipts?.sourceSealReceiptSha256 !== SOURCE_SEAL_RECEIPT || value.dependencyReceipts?.sourceDecisionReceiptSha256 !== SOURCE_DECISION_RECEIPT || value.dependencyReceipts?.heldoutComparisonReceiptSha256 !== HELDOUT_COMPARISON_RECEIPT) issues.push(issue('CHOLLA_LAYOUT_DEPENDENCY_DRIFT', 'Source seal, pre-answer decision, or heldout comparison receipt changed.'));
  if (!same(value.answerSources, ANSWERS)) issues.push(issue('CHOLLA_LAYOUT_ANSWER_IDENTITY_DRIFT', 'Approved or as-built answer identity changed.'));
  const points = value.heads?.map(({ xPt, yPt }) => [xPt, yPt]);
  if (!same(points, HEAD_POINTS) || value.heads?.length !== 45 || value.heads?.some((head) => head.zFt !== null || head.ceilingZoneId !== null)) issues.push(issue('CHOLLA_LAYOUT_HEAD_REGISTRATION_DRIFT', 'All 45 exact PDF head coordinates must remain registered while Z and zone assignment stay unresolved.'));
  if (value.headExtraction?.primary?.detected !== 45 || value.headExtraction?.independent?.detected !== 45 || value.headExtraction?.independent?.maximumCenterResidualPt > 0.02 || Object.values(value.headExtraction?.thresholdStability || {}).some((count) => count !== 45) || value.headExtraction?.approvedAsBuiltMaximumResidualPt !== 0 || value.headExtraction?.scheduleCrossCheck?.status !== 'passed') issues.push(issue('CHOLLA_LAYOUT_HEAD_LOOP_FAILED', 'Primary, independent, threshold, approved/as-built, and schedule head loops must all close at 45.'));
  if (!same(value.pipeVectorEvidence?.headConnectedSegments, PIPE_SEGMENTS) || value.pipeVectorEvidence?.coveredHeadCount !== 45 || value.pipeVectorEvidence?.maximumHeadToSegmentDistancePt > 5 || value.pipeVectorEvidence?.completeNetworkTopologyReady !== false) issues.push(issue('CHOLLA_LAYOUT_PIPE_EVIDENCE_DRIFT', 'Head-connected pipe evidence must cover 45 heads without promoting complete network topology.'));
  if (!same(value.ceilingEvidence?.completedAnswerAddedMaximumLabels, COMPLETED_LABELS) || value.ceilingEvidence?.exactZoneBoundariesReady !== false || value.ceilingEvidence?.exactCeilingSurfaceReady !== false || value.ceilingEvidence?.exactDeflectorElevationReady !== false) issues.push(issue('CHOLLA_LAYOUT_CEILING_FALSE_INFERENCE', '14/16 foot MAX labels cannot become exact zones, surfaces, or deflector elevations.'));
  if (value.sequence?.answerExposed !== true || value.sequence?.correctedImplementationEligibleAsFreshHoldout !== false || value.answerExposedTopViewCalibrationReady !== true || value.topViewReady !== true || value.topViewScope !== 'completed-answer-pdf-coordinate-registration-only' || value.freshHoldoutRequired !== true || value.unseenProjectPlacementVerified !== false || value.exactDeflectorElevationReady !== false || value.elevationViewReady !== false || value.wholeBuildingModelReady !== false || value.model3dReady !== false || value.completePipeTopologyReady !== false || value.hydraulicReplayReady !== false || value.obstructionClearanceReady !== false || value.complianceReady !== false || value.fabricationReady !== false || value.fieldReleaseReady !== false) issues.push(issue('CHOLLA_LAYOUT_FALSE_PROMOTION', 'Answer-exposed top-view registration cannot promote fresh placement, Z, 3D, topology, hydraulics, compliance, fabrication, or release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, answerExposedTopViewCalibrationReady: issues.length === 0, topViewReady: issues.length === 0, freshHoldoutRequired: true, unseenProjectPlacementVerified: false, exactDeflectorElevationReady: false, model3dReady: false, complianceReady: false };
}

export async function verifyChollaCompletedLayoutAdversarialLoop(packet) {
  const cases = [
    ['source-receipt', (value) => { value.dependencyReceipts.sourceSealReceiptSha256 = '0'.repeat(64); }],
    ['answer-identity', (value) => { value.answerSources[0].sha256 = 'f'.repeat(64); }],
    ['head-count', (value) => { value.heads.pop(); }],
    ['head-coordinate', (value) => { value.heads[0].xPt += 18; }],
    ['independent-count', (value) => { value.headExtraction.independent.detected = 44; }],
    ['pipe-coverage', (value) => { value.pipeVectorEvidence.coveredHeadCount = 44; }],
    ['pipe-topology', (value) => { value.pipeVectorEvidence.completeNetworkTopologyReady = true; }],
    ['ceiling-surface', (value) => { value.ceilingEvidence.exactCeilingSurfaceReady = true; }],
    ['deflector-elevation', (value) => { value.heads[0].zFt = 16; }],
    ['fresh-placement', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['model3d', (value) => { value.model3dReady = true; }],
    ['compliance', (value) => { value.complianceReady = true; }],
  ];
  const rejectedCases = [];
  for (const [name, mutate] of cases) {
    const changed = structuredClone(packet); mutate(changed);
    if ((await validateChollaCompletedLayoutRegistration(await sealChollaCompletedLayoutRegistration(changed))).status === 'blocked') rejectedCases.push(name);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, totalCases: cases.length };
}

export function buildChollaCompletedLayoutView(packet) {
  const lines = packet.pipeVectorEvidence.headConnectedSegments.map(([[x1,y1],[x2,y2]]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join('');
  const heads = packet.heads.map((head) => `<circle cx="${head.xPt}" cy="${head.yPt}" r="8"><title>${head.id}: Z unresolved</title></circle>`).join('');
  const labels = packet.ceilingEvidence.completedAnswerAddedMaximumLabels.map((label) => { const [x1,y1,x2] = label.bboxPt; return `<text x="${x1}" y="${y1 - 8}">${label.text}</text><rect x="${x1}" y="${y1}" width="${x2 - x1}" height="14"/>`; }).join('');
  return `<svg viewBox="900 400 1800 1580" role="img" aria-label="Cholla completed-answer 45-head PDF coordinate registration"><style>rect{fill:none;stroke:#f59e0b;stroke-width:2}line{stroke:#e879f9;stroke-width:4;stroke-linecap:round}circle{fill:#22c55e;stroke:#052e16;stroke-width:2}text{fill:#fbbf24;font:18px system-ui}</style>${lines}${heads}${labels}</svg>`;
}
