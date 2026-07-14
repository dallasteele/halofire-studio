import { sha256Hex } from './elevation-datums.js';

const PROJECT_ID = 'moses-lake-stake-center';
const SOURCE_CANDIDATE_RECEIPT = '2df8931bdfa0b9b8f05e0b558421b89c8be644a8bc2f4403e5b70c7604908baa';
const SOURCE_SEAL_RECEIPT = '0f0d90d0acdfde302ada885312279bd606fa2bb0328ab28695690f4e6365ce39';
const APPROVED_SHA256 = '3074149cae1c4db4de8e40d7a537b2461910935bb6e5aa01ac504bb170fd52a3';
const AS_BUILT_SHA256 = 'aa533bd4187ca59283cd3d8cc62d513acd31432ef3df2d8169a57e17fa713eab';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const APPROVED_CENTERS_PDF_PT = Object.freeze([
  [1423.730103, 1511.709961], [1423.730103, 1646.709961],
  [1297.730103, 1511.709961], [1297.730103, 1646.709961],
  [1180.190063, 1511.709961], [1180.01001, 1646.709961],
]);

const RASTER_CENTERS_PDF_PT = Object.freeze([
  [1425, 1512], [1425, 1646.5],
  [1297.5, 1512], [1297.5, 1646.5],
  [1180, 1511.5], [1179.5, 1646.5],
]);

const REGISTRATION = Object.freeze({
  pageNumber: 4,
  sheet: 'FP-1.2 ATTIC LEVEL - FIRE PROTECTION PLAN',
  scalePtPerFt: 9,
  originPdfPt: [1461.08, 1438.72],
  mapping: 'pdf x = origin x - local y * 9; pdf y = origin y + local x * 9',
  ridgePdfX: 1292.142503,
  scopeRectPdfPt: [1150, 1450, 1450, 1685],
  roomRectPdfPt: [1123.205003, 1438.72, 1461.08, 1668.22],
  basis: 'A103 source dimensions close Cultural Center SC150 at 25 feet 6 inches by 37 feet 6 1/2 inches; FP-1.2 printed scale is 1/8 inch equals 1 foot; the FP-1.2 room corner and ceiling-grid underlay bind the source-local axes without using sprinkler centers',
});

function registerCandidate(sourceCandidate) {
  return sourceCandidate.layout.heads3d.map((head) => ({
    id: head.id,
    sourcePointFt: head.pointFt,
    pdfPointPt: [
      round(REGISTRATION.originPdfPt[0] - head.pointFt[1] * REGISTRATION.scalePtPerFt),
      round(REGISTRATION.originPdfPt[1] + head.pointFt[0] * REGISTRATION.scalePtPerFt),
    ],
  }));
}

function maximumThresholdMatching(predicted, approved, toleranceFt) {
  const edges = predicted.map((entry) => approved.map((point, approvedIndex) => ({
    approvedIndex,
    distanceFt: distance(entry.pdfPointPt, point) / REGISTRATION.scalePtPerFt,
  })).filter((edge) => edge.distanceFt <= toleranceFt).sort((a, b) => a.distanceFt - b.distanceFt));
  const approvedOwner = Array(approved.length).fill(-1);
  const visit = (predictedIndex, seen) => {
    for (const edge of edges[predictedIndex]) {
      if (seen.has(edge.approvedIndex)) continue;
      seen.add(edge.approvedIndex);
      if (approvedOwner[edge.approvedIndex] === -1 || visit(approvedOwner[edge.approvedIndex], seen)) {
        approvedOwner[edge.approvedIndex] = predictedIndex;
        return true;
      }
    }
    return false;
  };
  for (let index = 0; index < predicted.length; index += 1) visit(index, new Set());
  const matches = approvedOwner.flatMap((predictedIndex, approvedIndex) => {
    if (predictedIndex < 0) return [];
    return [{
      predictedId: predicted[predictedIndex].id,
      approvedId: `moses-lake-approved-cultural-center-head-${String(approvedIndex + 1).padStart(2, '0')}`,
      distanceFt: round(distance(predicted[predictedIndex].pdfPointPt, approved[approvedIndex]) / REGISTRATION.scalePtPerFt, 3),
    }];
  });
  const errors = matches.map((match) => match.distanceFt);
  return {
    toleranceFt,
    matches,
    matchedCount: matches.length,
    precision: predicted.length ? round(matches.length / predicted.length, 6) : 0,
    recall: approved.length ? round(matches.length / approved.length, 6) : 0,
    falsePositiveCandidateCount: predicted.length - matches.length,
    maxPlanErrorFt: errors.length ? Math.max(...errors) : null,
    meanPlanErrorFt: errors.length ? round(errors.reduce((sum, value) => sum + value, 0) / errors.length, 3) : null,
    parityPassed: matches.length === predicted.length && matches.length === approved.length,
  };
}

export async function buildMosesLakeHeldoutComparison(sourceCandidate) {
  if (sourceCandidate?.artifactType !== 'halofire.moses-lake-stake-center-source-only-pitched-candidate.v1'
    || sourceCandidate?.projectId !== PROJECT_ID || sourceCandidate?.receiptSha256 !== SOURCE_CANDIDATE_RECEIPT
    || sourceCandidate?.sourceSealReceiptSha256 !== SOURCE_SEAL_RECEIPT || sourceCandidate?.answerKeyOpened !== false
    || sourceCandidate?.layout?.heads3d?.length !== 12) throw new Error('MOSES_LAKE_SEALED_SOURCE_CANDIDATE_BLOCKED');
  const registeredCandidateHeads = registerCandidate(sourceCandidate);
  const approvedHeads = APPROVED_CENTERS_PDF_PT.map((pdfPointPt, index) => ({
    id: `moses-lake-approved-cultural-center-head-${String(index + 1).padStart(2, '0')}`,
    pdfPointPt,
    localPointFt: [
      round((pdfPointPt[1] - REGISTRATION.originPdfPt[1]) / REGISTRATION.scalePtPerFt),
      round((REGISTRATION.originPdfPt[0] - pdfPointPt[0]) / REGISTRATION.scalePtPerFt),
    ],
    symbol: 'one-inch-drop-to-flex-pendent-below',
  }));
  const comparisons = [0.5, 1, 1.5].map((toleranceFt) => maximumThresholdMatching(registeredCandidateHeads, APPROVED_CENTERS_PDF_PT, toleranceFt));
  const draft = {
    artifactType: 'halofire.moses-lake-stake-center-pitched-heldout-comparison.v1',
    projectId: PROJECT_ID,
    projectName: 'Moses Lake Stake Center',
    sequence: {
      sourceCandidateCommit: '919a6bf9877ba606ae286f43fcf0a2d2785dbdd4',
      sourceCandidateReceiptSha256: SOURCE_CANDIDATE_RECEIPT,
      sourceSealReceiptSha256: SOURCE_SEAL_RECEIPT,
      approvedAndAsBuiltOpenedAfterSourceCommit: true,
      answersUsedToGenerateSourceCandidate: false,
    },
    answerKeys: {
      approved: { sha256: APPROVED_SHA256, bytes: 5932127, pageNumber: 4, sheet: REGISTRATION.sheet },
      asBuilt: { sha256: AS_BUILT_SHA256, bytes: 5937065, pageNumber: 4, sheet: REGISTRATION.sheet },
    },
    registration: REGISTRATION,
    approvedEvidence: {
      primary: {
        status: 'passed',
        method: 'PyMuPDF vector detector inside the source-registered Cultural Center scope',
        signature: { strokeRgb: [0, 0, 0], strokeWidthPt: 0.54, fill: null, itemCount: 4, itemType: 'cubic-bezier', widthPt: 9.18, heightPt: 9.18 },
        detectedCount: approvedHeads.length,
        heads: approvedHeads,
      },
      independent: {
        status: 'passed',
        method: 'unseeded 4-pixel-per-point grayscale square-core detector within only the source-registered scope, thresholded at 92 percent dark and non-max-suppressed at 9 points',
        rawCandidateCount: 197,
        detectedCount: RASTER_CENTERS_PDF_PT.length,
        centersPdfPt: RASTER_CENTERS_PDF_PT,
        maximumVectorResidualPt: 1.302598,
      },
      asBuiltParity: {
        status: 'passed',
        method: 'same vector signature and source-registered scope replayed against the separate as-built PDF',
        detectedCount: 6,
        centersEqualApproved: true,
      },
      adversarial: { status: 'passed', method: 'answer-hash, sequence, scope, detector, topology, count, receipt, and false-promotion mutations' },
    },
    prediction: {
      headCount: registeredCandidateHeads.length,
      uniqueAlongRidgeStations: 4,
      uniqueAcrossSlopeStations: 3,
      registeredHeads: registeredCandidateHeads,
    },
    approved: { headCount: approvedHeads.length, uniqueAlongRidgeStations: 2, uniqueAcrossSlopeStations: 3 },
    comparisons,
    result: {
      status: 'failed',
      occupiedSlopedCeilingClassificationVerified: true,
      approvedDropsServeOccupiedSlopedCulturalCenter: true,
      approvedAndAsBuiltParityVerified: true,
      exactPlacementPatternVerified: false,
      countDelta: sourceCandidate.layout.heads3d.length - approvedHeads.length,
      failureMode: 'The sealed large-vault family transfer over-generalizes Midvale four-row placement onto the shorter 25-foot-6-inch Cultural Center and emits four along-ridge stations instead of the approved and as-built two, producing six excess candidate heads.',
      correctionPolicy: 'Preserve Moses Lake as an answer-exposed failed holdout; add source-only along-ridge span, room aspect, and row-count features to the empirical family selector, then require another sealed completed-project holdout before placement acceptance.',
    },
    internalVerification: {
      primary: 'approved one-inch-drop vector-circle detector',
      independent: 'scope-only grayscale dark-core detector plus separate as-built parity replay',
      adversarial: 'deterministic comparison receipt and false-promotion mutation rejection',
    },
    unseenProjectPlacementVerified: false,
    sourceOnlyClassifierVerified: true,
    topViewComparisonReady: true,
    elevationClassificationComparisonReady: true,
    partialModel3dComparisonReady: true,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'failed-fresh-heldout-placement-with-approved-and-as-built-six-head-cultural-center-evidence-not-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMosesLakeHeldoutComparison(packet, sourceCandidate) {
  let expected;
  try { expected = await buildMosesLakeHeldoutComparison(sourceCandidate); } catch (error) {
    return { status: 'blocked', issues: [issue('MOSES_LAKE_HELDOUT_DEPENDENCY_BLOCKED', error.message)], complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('MOSES_LAKE_HELDOUT_REPLAY_MISMATCH', 'Comparison does not equal deterministic answer-exposed replay.'));
  if (packet?.answerKeys?.approved?.sha256 !== APPROVED_SHA256 || packet?.answerKeys?.asBuilt?.sha256 !== AS_BUILT_SHA256
    || packet?.registration?.scopeRectPdfPt?.join(',') !== REGISTRATION.scopeRectPdfPt.join(',')) issues.push(issue('MOSES_LAKE_ANSWER_OR_SCOPE_DRIFT', 'Answer identity or source-registered Cultural Center scope changed.'));
  if (packet?.approvedEvidence?.primary?.detectedCount !== 6 || packet?.approvedEvidence?.independent?.detectedCount !== 6
    || packet?.approvedEvidence?.asBuiltParity?.detectedCount !== 6 || packet?.approvedEvidence?.asBuiltParity?.centersEqualApproved !== true
    || packet?.approved?.uniqueAlongRidgeStations !== 2 || packet?.approved?.uniqueAcrossSlopeStations !== 3) issues.push(issue('MOSES_LAKE_APPROVED_EVIDENCE_DRIFT', 'The independently confirmed approved and as-built 2-by-3 Cultural Center pattern changed.'));
  if (packet?.prediction?.headCount !== 12 || packet?.prediction?.uniqueAlongRidgeStations !== 4 || packet?.prediction?.uniqueAcrossSlopeStations !== 3
    || packet?.result?.status !== 'failed' || packet?.result?.exactPlacementPatternVerified !== false
    || packet?.result?.countDelta !== 6 || packet?.unseenProjectPlacementVerified !== false) issues.push(issue('MOSES_LAKE_FAILURE_TRUTH_DRIFT', 'The failed 12-versus-6 heldout result was weakened or changed.'));
  if (packet?.sourceOnlyClassifierVerified !== true || packet?.result?.occupiedSlopedCeilingClassificationVerified !== true
    || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('MOSES_LAKE_HELDOUT_FALSE_PROMOTION', 'Correct ceiling classification cannot promote failed placement or downstream readiness.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, heldoutComparisonReady: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyMosesLakeHeldoutAdversarialLoop(packet, sourceCandidate) {
  const cases = [
    ['approved-hash', (value) => { value.answerKeys.approved.sha256 = '0'.repeat(64); }],
    ['as-built-hash', (value) => { value.answerKeys.asBuilt.sha256 = '1'.repeat(64); }],
    ['source-receipt', (value) => { value.sequence.sourceCandidateReceiptSha256 = 'f'.repeat(64); }],
    ['sequence', (value) => { value.sequence.approvedAndAsBuiltOpenedAfterSourceCommit = false; }],
    ['scope', (value) => { value.registration.scopeRectPdfPt[0] += 9; }],
    ['primary-count', (value) => { value.approvedEvidence.primary.detectedCount = 12; }],
    ['independent-count', (value) => { value.approvedEvidence.independent.detectedCount = 12; }],
    ['as-built-parity', (value) => { value.approvedEvidence.asBuiltParity.centersEqualApproved = false; }],
    ['approved-topology', (value) => { value.approved.uniqueAlongRidgeStations = 4; }],
    ['prediction-count', (value) => { value.prediction.headCount = 6; }],
    ['result', (value) => { value.result.status = 'passed'; }],
    ['placement', (value) => { value.result.exactPlacementPatternVerified = true; }],
    ['heldout', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['compliance', (value) => { value.complianceReady = true; }],
    ['fabrication', (value) => { value.fabricationReady = true; }],
    ['field-release', (value) => { value.fieldReleaseReady = true; }],
    ['receipt', (value) => { value.receiptSha256 = 'a'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const value = structuredClone(packet);
    mutate(value);
    if ((await validateMosesLakeHeldoutComparison(value, sourceCandidate)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, complianceReady: false };
}

export function renderMosesLakeHeldoutOverlaySvg(packet) {
  const approved = packet.approvedEvidence.primary.heads.map((head) => `<g data-approved-id="${head.id}"><circle cx="${head.pdfPointPt[0]}" cy="${head.pdfPointPt[1]}" r="8"/><path d="M${head.pdfPointPt[0] - 6} ${head.pdfPointPt[1]}h12M${head.pdfPointPt[0]} ${head.pdfPointPt[1] - 6}v12"/></g>`).join('');
  const predicted = packet.prediction.registeredHeads.map((head) => `<g data-predicted-id="${head.id}"><rect x="${head.pdfPointPt[0] - 6}" y="${head.pdfPointPt[1] - 6}" width="12" height="12"/><path d="M${head.pdfPointPt[0] - 8} ${head.pdfPointPt[1]}h16M${head.pdfPointPt[0]} ${head.pdfPointPt[1] - 8}v16"/></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="1080 1360 440 380" role="img" aria-label="Moses Lake heldout Cultural Center overlay"><style>.bg{fill:#08111e}.scope{fill:#10243c;stroke:#94a3b8;stroke-width:2}.ridge{stroke:#f59e0b;stroke-width:3;stroke-dasharray:10 7}g[data-approved-id] circle{fill:none;stroke:#f43f5e;stroke-width:5}g[data-approved-id] path{stroke:#f43f5e;stroke-width:3}g[data-predicted-id] rect{fill:none;stroke:#22d3ee;stroke-width:4}g[data-predicted-id] path{stroke:#22d3ee;stroke-width:3}text{fill:#e2e8f0;font:13px sans-serif}.bad{fill:#fca5a5;font-weight:700}</style><rect class="bg" x="1080" y="1360" width="440" height="380"/><rect class="scope" x="${REGISTRATION.scopeRectPdfPt[0]}" y="${REGISTRATION.scopeRectPdfPt[1]}" width="${REGISTRATION.scopeRectPdfPt[2] - REGISTRATION.scopeRectPdfPt[0]}" height="${REGISTRATION.scopeRectPdfPt[3] - REGISTRATION.scopeRectPdfPt[1]}"/><line class="ridge" x1="${REGISTRATION.ridgePdfX}" y1="${REGISTRATION.roomRectPdfPt[1]}" x2="${REGISTRATION.ridgePdfX}" y2="${REGISTRATION.roomRectPdfPt[3]}"/>${approved}${predicted}<text x="1092" y="1382">Magenta circles: approved/as-built 6 (2 along ridge x 3 across slope)</text><text x="1092" y="1400">Cyan squares: sealed prediction 12 (4 along ridge x 3 across slope)</text><text class="bad" x="1092" y="1418">HELDOUT FAILED: +6 candidates; exact placement not verified</text></svg>`;
}
