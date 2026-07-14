import { sha256Hex } from './elevation-datums.js';

const PROJECT_ID = 'lds-meetinghouse-winter-garden-fl';
const SOURCE_CANDIDATE_RECEIPT = 'a8ff34f22991c290c783ce92286ff7729b97c65575fdabfefdc2791399365bdb';
const SOURCE_SEAL_RECEIPT = '6828ec8a225b9dfc0c69759493dca0f3ae35b76a5a66071e62d6cdb7f410a46a';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const APPROVED_IMAGE_CENTERS_PX = Object.freeze([
  [3231, 1245], [3535, 1245], [3838, 1245],
  [3231, 1671], [3535, 1671], [3838, 1671],
  [3231, 2064], [3535, 2064], [3838, 2064],
]);

const REGISTRATION = Object.freeze({
  sheet: 'FP2 FIRE SPRINKLER PLAN',
  answerPageNumber: 1,
  closeoutPageNumber: 2,
  approvedPortfolioAttachment: 'A002-FPSPlan-Meetinghouse.pdf.pdf',
  embeddedPlanRaster: {
    widthPx: 8023, heightPx: 3314,
    approvedSha256: '7fc71ee03360421e3d0421926b37a435440ea025fc475e3c1c4090e91beb2eb2',
    asBuiltSha256: '7fc71ee03360421e3d0421926b37a435440ea025fc475e3c1c4090e91beb2eb2',
    pageRectPt: [59.209999, 198.926392, 2198.676758, 1082.659912],
  },
  scopeRectImagePx: [3150, 1054, 3948, 2249],
  mapping: 'image x = 3150 + local x / 28.9375 * 798; image y = 2249 - local y / 38.083333 * 1195',
  basis: 'A103 source dimensions plus the shared architectural underlay wall faces in FP2 register the sealed local Cultural Center axes; no sprinkler centers define the scope transform',
});

function imageToLocal([x, y], sourceCandidate) {
  const [x0, y0, x1, y1] = REGISTRATION.scopeRectImagePx;
  return [
    round((x - x0) / (x1 - x0) * sourceCandidate.geometry.room.lengthFt),
    round((y1 - y) / (y1 - y0) * sourceCandidate.geometry.room.widthFt),
  ];
}

function maximumThresholdMatching(predicted, approved, toleranceFt) {
  const edges = predicted.map((entry) => approved.map((point, approvedIndex) => ({ approvedIndex, distanceFt: distance(entry.localPointFt, point) }))
    .filter((edge) => edge.distanceFt <= toleranceFt).sort((a, b) => a.distanceFt - b.distanceFt));
  const approvedOwner = Array(approved.length).fill(-1);
  const visit = (predictedIndex, seen) => {
    for (const edge of edges[predictedIndex]) {
      if (seen.has(edge.approvedIndex)) continue;
      seen.add(edge.approvedIndex);
      if (approvedOwner[edge.approvedIndex] === -1 || visit(approvedOwner[edge.approvedIndex], seen)) { approvedOwner[edge.approvedIndex] = predictedIndex; return true; }
    }
    return false;
  };
  for (let index = 0; index < predicted.length; index += 1) visit(index, new Set());
  const matches = approvedOwner.flatMap((predictedIndex, approvedIndex) => predictedIndex < 0 ? [] : [{
    predictedId: predicted[predictedIndex].id,
    approvedId: `winter-garden-approved-cultural-head-${String(approvedIndex + 1).padStart(2, '0')}`,
    distanceFt: round(distance(predicted[predictedIndex].localPointFt, approved[approvedIndex]), 3),
  }]);
  const errors = matches.map((match) => match.distanceFt);
  return {
    toleranceFt, matches, matchedCount: matches.length,
    precision: predicted.length ? round(matches.length / predicted.length) : 0,
    recall: approved.length ? round(matches.length / approved.length) : 0,
    falsePositiveCandidateCount: predicted.length - matches.length,
    falseNegativeApprovedCount: approved.length - matches.length,
    maxPlanErrorFt: errors.length ? Math.max(...errors) : null,
    meanPlanErrorFt: errors.length ? round(errors.reduce((sum, value) => sum + value, 0) / errors.length, 3) : null,
    parityPassed: matches.length === predicted.length && matches.length === approved.length,
  };
}

export async function buildWinterGardenHeldoutComparison(sourceCandidate) {
  if (sourceCandidate?.artifactType !== 'halofire.winter-garden-source-only-pitched-candidate.v1'
    || sourceCandidate?.projectId !== PROJECT_ID || sourceCandidate?.receiptSha256 !== SOURCE_CANDIDATE_RECEIPT
    || sourceCandidate?.sourceSealReceiptSha256 !== SOURCE_SEAL_RECEIPT || sourceCandidate?.answerKeyOpened !== false
    || sourceCandidate?.layout?.heads3d?.length !== 6 || sourceCandidate?.familySelection?.extrapolationWarning !== true) {
    throw new Error('WINTER_GARDEN_SEALED_SOURCE_CANDIDATE_BLOCKED');
  }
  const approvedHeads = APPROVED_IMAGE_CENTERS_PX.map((imagePointPx, index) => ({
    id: `winter-garden-approved-cultural-head-${String(index + 1).padStart(2, '0')}`,
    imagePointPx, localPointFt: imageToLocal(imagePointPx, sourceCandidate), symbol: 'pendent-drop-on-occupied-sloped-ceiling',
  }));
  const predictedHeads = sourceCandidate.layout.heads3d.map((head) => ({ id: head.id, localPointFt: head.pointFt.slice(0, 2) }));
  const approvedLocal = approvedHeads.map((head) => head.localPointFt);
  const comparisons = [0.5, 1, 1.5, 3, 5].map((toleranceFt) => maximumThresholdMatching(predictedHeads, approvedLocal, toleranceFt));
  const draft = {
    artifactType: 'halofire.winter-garden-pitched-heldout-comparison.v1', projectId: PROJECT_ID, projectName: 'LDS Meeting House - Winter Garden FL',
    sequence: { sourceCandidateCommit: 'b9cfccf6', sourceCandidateReceiptSha256: SOURCE_CANDIDATE_RECEIPT, sourceSealReceiptSha256: SOURCE_SEAL_RECEIPT, approvedAndAsBuiltOpenedAfterSourceCommit: true, answersUsedToGenerateSourceCandidate: false },
    answerKeys: {
      cityApprovedPortfolio: { sha256: '6e012d46dd20ff5808717d39898fd4b7fe54fcb0f35253ef7be6c3e5f48300f6', bytes: 6014967 },
      cityApprovedA002Attachment: { sha256: 'b0d00cdb0db93d80461ad29df686fe301c2d78882e7ab2b355cccbf9ec69dd3e', bytes: 2898426 },
      asBuiltA002: { sha256: '22c8db4dde89ce0ed9ee6625b9d8f8b1918c2ecdb9baf6ff829a9c4118b5b8bb', bytes: 2888781 },
      closeoutAsBuilt: { sha256: '4b6ea3c5027894ad7ccf752c25a82c993d321e0f1f7967c80d114f737bc8c128', bytes: 7345772, pageNumber: 2 },
    },
    registration: REGISTRATION,
    approvedEvidence: {
      primary: {
        status: 'passed',
        method: 'unseeded concentric-ring detector in the source-registered room: central dark disk radius 8 px, white annulus 10-13 px, dark outer ring 15-18 px, row-band search, and 70 px non-max suppression',
        threshold: 2.5, detectedCount: approvedHeads.length, weakestTrueScore: 2.5508, strongestRejectedScore: 1.7166, heads: approvedHeads,
      },
      independent: { status: 'passed', method: 'visual FP2 branch-line and drop-symbol audit', planTopology: { alongRidgeStations: 3, acrossSlopeStations: 3, headCount: 9 }, conclusion: 'three pendent drops on each of three branch lines within Cultural Center 150' },
      answerParity: { status: 'passed', method: 'approved portfolio A002 attachment and as-built A002 contain byte-identical 8023 x 3314 embedded plan rasters', approvedRasterSha256: REGISTRATION.embeddedPlanRaster.approvedSha256, asBuiltRasterSha256: REGISTRATION.embeddedPlanRaster.asBuiltSha256, centersEqualApproved: true },
      adversarial: { status: 'passed', method: 'answer-hash, sequence, scope, detector, topology, count, source-span ambiguity, receipt, and false-promotion mutations' },
    },
    sourceGeometryFinding: {
      status: 'failed-ambiguous-protection-zone-boundary',
      sealedCandidateLengthFt: sourceCandidate.geometry.room.lengthFt,
      sealedDimensionLabel: `28'-11 1/4"`,
      competingClearSpanLabelOnA103: `25'-10 3/4"`,
      effect: 'the blind packet selected the larger movable-partition-pocket dimension without proving it was the clear occupied protection-plane span; exact source polygon registration is not verified',
    },
    prediction: { headCount: predictedHeads.length, topology: sourceCandidate.layout.topology, registeredHeads: predictedHeads },
    approved: { headCount: approvedHeads.length, topology: { alongRidgeStations: 3, acrossSlopeStations: 3 }, heads: approvedHeads },
    comparisons,
    result: {
      status: 'failed', occupiedSlopedCeilingClassificationVerified: true, approvedDropsServeCulturalCenterVault: true,
      approvedPlanTopologyVerified: true, approvedAndAsBuiltRasterParityVerified: true, exactPlacementPatternVerified: false,
      sourceProtectionZoneGeometryVerified: false, countDelta: predictedHeads.length - approvedHeads.length,
      failureMode: 'The sealed v3 Moses Lake transfer predicts two along-ridge by three across-slope stations (six heads); the approved/as-built layout is three by three (nine heads), and the sealed source packet also chose the wrong side of an unresolved competing clear-span dimension.',
      correctionPolicy: 'Preserve this as an answer-exposed failed holdout; add the verified 3x3 topology and explicit clear-span disambiguation feature to a v4 empirical corpus, then require another sealed completed-project holdout before placement acceptance.',
    },
    internalVerification: { primary: 'source-registered concentric-ring raster detector', independent: 'FP2 branch-line and drop-symbol topology audit', adversarial: 'deterministic comparison replay and false-promotion mutation rejection' },
    unseenProjectPlacementVerified: false, sourceOnlyClassifierVerified: true, topViewComparisonReady: true, elevationClassificationComparisonReady: true,
    partialModel3dComparisonReady: true, wholeBuildingModelReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    claimStatus: 'failed-fresh-heldout-placement-and-source-zone-registration-with-approved-as-built-3-by-3-Cultural-Center-evidence-not-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateWinterGardenHeldoutComparison(packet, sourceCandidate) {
  let expected;
  try { expected = await buildWinterGardenHeldoutComparison(sourceCandidate); } catch (error) { return { status: 'blocked', issues: [issue('WINTER_GARDEN_COMPARISON_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('WINTER_GARDEN_COMPARISON_REPLAY_MISMATCH', 'Comparison does not equal deterministic answer-exposed replay.'));
  if (packet?.approvedEvidence?.primary?.detectedCount !== 9 || packet?.approvedEvidence?.independent?.planTopology?.headCount !== 9
    || packet?.approvedEvidence?.independent?.planTopology?.alongRidgeStations !== 3 || packet?.approvedEvidence?.independent?.planTopology?.acrossSlopeStations !== 3
    || packet?.approvedEvidence?.answerParity?.centersEqualApproved !== true || packet?.sourceGeometryFinding?.status !== 'failed-ambiguous-protection-zone-boundary') issues.push(issue('WINTER_GARDEN_ANSWER_EVIDENCE_DRIFT', 'Approved topology, parity, or source-span failure changed.'));
  if (packet?.result?.status !== 'failed' || packet?.result?.countDelta !== -3 || packet?.result?.exactPlacementPatternVerified !== false
    || packet?.result?.sourceProtectionZoneGeometryVerified !== false || packet?.unseenProjectPlacementVerified !== false
    || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('WINTER_GARDEN_FALSE_PROMOTION', 'Failed placement and source geometry cannot be promoted to acceptance or downstream readiness.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, comparisonReady: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyWinterGardenHeldoutComparisonAdversarialLoop(packet, sourceCandidate) {
  const cases = [
    ['source-receipt', (value) => { value.sequence.sourceCandidateReceiptSha256 = '0'.repeat(64); }], ['sequence', (value) => { value.sequence.approvedAndAsBuiltOpenedAfterSourceCommit = false; }],
    ['answer-hash', (value) => { value.answerKeys.asBuiltA002.sha256 = '1'.repeat(64); }], ['raster-parity', (value) => { value.approvedEvidence.answerParity.centersEqualApproved = false; }],
    ['detector-count', (value) => { value.approvedEvidence.primary.detectedCount = 6; }], ['detector-threshold', (value) => { value.approvedEvidence.primary.threshold = 1; }],
    ['approved-count', (value) => { value.approved.headCount = 6; }], ['approved-along', (value) => { value.approved.topology.alongRidgeStations = 2; }],
    ['approved-across', (value) => { value.approved.topology.acrossSlopeStations = 4; }], ['scope', (value) => { value.registration.scopeRectImagePx[0] += 20; }],
    ['span-failure', (value) => { value.sourceGeometryFinding.status = 'passed'; }], ['span-label', (value) => { value.sourceGeometryFinding.competingClearSpanLabelOnA103 = `28'-11 1/4"`; }],
    ['result', (value) => { value.result.status = 'passed'; }], ['count-delta', (value) => { value.result.countDelta = 0; }],
    ['exact-placement', (value) => { value.result.exactPlacementPatternVerified = true; }], ['geometry-promotion', (value) => { value.result.sourceProtectionZoneGeometryVerified = true; }],
    ['unseen-placement', (value) => { value.unseenProjectPlacementVerified = true; }], ['whole-building', (value) => { value.wholeBuildingModelReady = true; }],
    ['compliance', (value) => { value.complianceReady = true; }], ['fabrication', (value) => { value.fabricationReady = true; }],
    ['field-release', (value) => { value.fieldReleaseReady = true; }], ['receipt', (value) => { value.receiptSha256 = 'f'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validateWinterGardenHeldoutComparison(value, sourceCandidate)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, complianceReady: false };
}

export function renderWinterGardenHeldoutOverlaySvg(packet) {
  const approved = packet.approved.heads.map((head) => `<g data-approved-id="${head.id}"><circle cx="${head.localPointFt[0]}" cy="${head.localPointFt[1]}" r="0.45"/><path d="M${head.localPointFt[0] - 0.35} ${head.localPointFt[1]}h0.7M${head.localPointFt[0]} ${head.localPointFt[1] - 0.35}v0.7"/></g>`).join('');
  const predicted = packet.prediction.registeredHeads.map((head) => `<g data-predicted-id="${head.id}"><rect x="${head.localPointFt[0] - 0.4}" y="${head.localPointFt[1] - 0.4}" width="0.8" height="0.8"/></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -3 31 45" role="img" aria-label="Winter Garden Cultural Center heldout overlay"><style>.bg{fill:#08111e}.scope{fill:#10243c;stroke:#94a3b8;stroke-width:.12}.ridge{stroke:#f59e0b;stroke-width:.16;stroke-dasharray:.6 .4}g[data-approved-id] circle{fill:none;stroke:#f43f5e;stroke-width:.25}g[data-approved-id] path{stroke:#f43f5e;stroke-width:.14}g[data-predicted-id] rect{fill:none;stroke:#22d3ee;stroke-width:.22}text{fill:#e2e8f0;font:1px sans-serif}.bad{fill:#fca5a5;font-weight:700}</style><rect class="bg" x="-1" y="-3" width="31" height="45"/><rect class="scope" x="0" y="0" width="28.9375" height="38.083333"/><line class="ridge" x1="0" y1="19.041667" x2="28.9375" y2="19.041667"/>${approved}${predicted}<text x="0" y="40">Magenta: approved/as-built 9 (3 x 3)</text><text x="0" y="41.4">Cyan: sealed v3 prediction 6 (2 x 3)</text><text class="bad" x="0" y="42.8">FAILED: count, topology, and source span</text></svg>`;
}
