import { sha256Hex } from './elevation-datums.js';

const PROJECT_ID = 'midvale-townhome-clubhouse-midvale-ut';
const SOURCE_CANDIDATE_RECEIPT = '2c58ee909b3b27fa6a497539d4f0ec287c93624b5bbc1d7103db4cb83f7fc91d';
const SOURCE_SEAL_RECEIPT = '6949ffacb0e1228f635087b4e901d0484e73d920c465414d1b3221ff6350e932';
const ANSWER_SHA256 = '043920f7514e7bb250a8eb20502f3f3ae7738b6d6f771dc4604580e2595f9e9a';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const APPROVED_CENTERS_PDF_PT = Object.freeze([
  [1643.505066, 1459.083252], [1794.705627, 1459.083252], [1945.90625, 1459.083252],
  [1643.505066, 1548.888489], [1794.705627, 1548.888489], [1945.90625, 1548.888489],
  [1643.505066, 1694.638611], [1794.705627, 1694.638611], [1945.90625, 1694.638611],
  [1643.505066, 1784.443848], [1794.705627, 1784.443848], [1945.90625, 1784.443848],
]);

const REGISTRATION = Object.freeze({
  pageNumber: 4,
  scalePtPerFt: 14.4,
  originPdfPt: [1585.905627, 1404.000244],
  ridgePdfX: 1794.705627,
  scopeRectPdfPt: [1585.905627, 1404.000244, 2003.505627, 1836.000244],
  basis: 'FP-1 printed 1/5 inch equals 1 foot; ridge centerline binds local x=14.5 feet; grid A-B binds 30-foot vault length',
});

function registerCandidate(sourceCandidate) {
  return sourceCandidate.heads3d.map((head) => ({
    id: head.id,
    sourcePointFt: head.pointFt,
    pdfPointPt: [
      round(REGISTRATION.originPdfPt[0] + head.pointFt[0] * REGISTRATION.scalePtPerFt),
      round(REGISTRATION.originPdfPt[1] + head.pointFt[1] * REGISTRATION.scalePtPerFt),
    ],
  }));
}

function maximumThresholdMatching(predicted, approved, toleranceFt) {
  const tolerancePt = toleranceFt * REGISTRATION.scalePtPerFt;
  const edges = predicted.map((entry) => approved.map((point, approvedIndex) => ({
    approvedIndex,
    distanceFt: distance(entry.pdfPointPt, point) / REGISTRATION.scalePtPerFt,
  })).filter((edge) => edge.distanceFt <= toleranceFt).sort((a, b) => a.distanceFt - b.distanceFt));
  const approvedOwner = Array(approved.length).fill(-1);
  const visit = (predictedIndex, seen) => {
    for (const edge of edges[predictedIndex]) {
      if (edge.distanceFt * REGISTRATION.scalePtPerFt > tolerancePt || seen.has(edge.approvedIndex)) continue;
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
      approvedId: `midvale-approved-clubroom-head-${String(approvedIndex + 1).padStart(2, '0')}`,
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
    maxPlanErrorFt: errors.length ? Math.max(...errors) : null,
    meanPlanErrorFt: errors.length ? round(errors.reduce((sum, value) => sum + value, 0) / errors.length, 3) : null,
    parityPassed: matches.length === predicted.length && matches.length === approved.length,
  };
}

export async function buildMidvaleHeldoutComparison(sourceCandidate) {
  if (sourceCandidate?.artifactType !== 'halofire.midvale-clubhouse-source-only-pitched-candidate.v1'
    || sourceCandidate?.projectId !== PROJECT_ID || sourceCandidate?.receiptSha256 !== SOURCE_CANDIDATE_RECEIPT
    || sourceCandidate?.sourceSealReceiptSha256 !== SOURCE_SEAL_RECEIPT || sourceCandidate?.answerKeyOpened !== false
    || sourceCandidate?.heads3d?.length !== 8) throw new Error('MIDVALE_SEALED_SOURCE_CANDIDATE_BLOCKED');
  const registeredCandidateHeads = registerCandidate(sourceCandidate);
  const approvedHeads = APPROVED_CENTERS_PDF_PT.map((pdfPointPt, index) => ({
    id: `midvale-approved-clubroom-head-${String(index + 1).padStart(2, '0')}`,
    pdfPointPt,
    localPointFt: [
      round((pdfPointPt[0] - REGISTRATION.originPdfPt[0]) / REGISTRATION.scalePtPerFt),
      round((pdfPointPt[1] - REGISTRATION.originPdfPt[1]) / REGISTRATION.scalePtPerFt),
    ],
    symbol: 'pendent',
  }));
  const comparisons = [3, 5, 6].map((toleranceFt) => maximumThresholdMatching(registeredCandidateHeads, APPROVED_CENTERS_PDF_PT, toleranceFt));
  const draft = {
    artifactType: 'halofire.midvale-clubhouse-pitched-heldout-comparison.v1',
    projectId: PROJECT_ID,
    projectName: 'Midvale Townhome Clubhouse - Midvale UT',
    sequence: {
      sourceCandidateCommit: '77920d69314e4861256f467a35cbeae6283326da',
      sourceCandidateReceiptSha256: SOURCE_CANDIDATE_RECEIPT,
      sourceSealReceiptSha256: SOURCE_SEAL_RECEIPT,
      stampedAnswerOpenedAfterSourceCommit: true,
      answerUsedToGenerateSourceCandidate: false,
    },
    answerKey: {
      path: '2-Internal Ops/03-Approved Docs/AHJ/Midvale Townhomes Clubhouse - Stamped Fire Sprinkler Shop Drawings.pdf',
      sha256: ANSWER_SHA256,
      bytes: 12644865,
      pageNumber: 4,
      sheet: 'FP-1 OVERALL FIRE SPRINKLER PLAN',
    },
    registration: REGISTRATION,
    approvedEvidence: {
      primary: {
        status: 'passed',
        method: 'FP-1 black pendent outline vector signature inside sealed Clubroom vault rectangle',
        signature: { strokeRgb: [0, 0, 0], strokeWidthPt: 0.64, itemCount: 21, widthPt: 9.6, heightPt: 8.565 },
        detectedCount: approvedHeads.length,
        heads: approvedHeads,
      },
      independent: {
        status: 'passed',
        method: 'orange drop endcap pairs grouped by identical x station and 16.75-point vertical assembly span',
        detectedDropAssemblyCount: 12,
        uniqueColumnCount: 3,
        uniqueRowCount: 4,
        maxPrimaryCircleToDropEndcapResidualPt: 0.811462,
      },
      adversarial: {
        status: 'passed',
        method: 'answer-hash, scope, symbol-count, registration, sequence, and false-promotion mutations',
      },
    },
    prediction: {
      headCount: sourceCandidate.heads3d.length,
      uniqueColumnCount: 4,
      uniqueRowCount: 2,
      registeredHeads: registeredCandidateHeads,
    },
    approved: {
      headCount: approvedHeads.length,
      uniqueColumnCount: 3,
      uniqueRowCount: 4,
    },
    comparisons,
    result: {
      status: 'failed',
      occupiedSlopedCeilingClassificationVerified: true,
      approvedElevationPipingFollowsPitchedOccupiedCeiling: true,
      exactPlacementPatternVerified: false,
      countDelta: sourceCandidate.heads3d.length - approvedHeads.length,
      failureMode: 'Dillon two-head empirical span prior under-generalizes the larger 6:12 Clubroom vault and produces a four-column-by-two-row pattern instead of the approved three-column-by-four-row pattern.',
      correctionPolicy: 'Treat Midvale as answer-exposed completed-layout calibration only; add ridge-edge-row and zone-scale features, then require a different sealed fresh holdout before placement acceptance.',
    },
    internalVerification: {
      primary: 'approved pendent vector-outline detector',
      independent: 'approved orange-drop assembly detector plus source-to-answer plan registration',
      adversarial: 'deterministic receipt and false-promotion mutation rejection',
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
    claimStatus: 'failed-fresh-heldout-placement-with-verified-occupied-sloped-ceiling-classification-not-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMidvaleHeldoutComparison(packet, sourceCandidate) {
  let expected;
  try { expected = await buildMidvaleHeldoutComparison(sourceCandidate); } catch (error) {
    return { status: 'blocked', issues: [issue('MIDVALE_HELDOUT_DEPENDENCY_BLOCKED', error.message)], complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('MIDVALE_HELDOUT_REPLAY_MISMATCH', 'Comparison does not equal deterministic answer-exposed replay.'));
  if (packet?.answerKey?.sha256 !== ANSWER_SHA256 || packet?.approvedEvidence?.primary?.detectedCount !== 12
    || packet?.approvedEvidence?.independent?.detectedDropAssemblyCount !== 12
    || packet?.approved?.uniqueColumnCount !== 3 || packet?.approved?.uniqueRowCount !== 4) issues.push(issue('MIDVALE_APPROVED_EVIDENCE_DRIFT', 'The independently confirmed 3-by-4 approved Clubroom pattern changed.'));
  if (packet?.prediction?.headCount !== 8 || packet?.prediction?.uniqueColumnCount !== 4 || packet?.prediction?.uniqueRowCount !== 2
    || packet?.result?.status !== 'failed' || packet?.result?.exactPlacementPatternVerified !== false
    || packet?.result?.countDelta !== -4 || packet?.unseenProjectPlacementVerified !== false) issues.push(issue('MIDVALE_FAILURE_TRUTH_DRIFT', 'The failed 8-versus-12 heldout result was weakened or changed.'));
  if (packet?.sourceOnlyClassifierVerified !== true || packet?.result?.occupiedSlopedCeilingClassificationVerified !== true
    || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('MIDVALE_HELDOUT_FALSE_PROMOTION', 'Classification evidence cannot promote failed placement or downstream readiness.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, heldoutComparisonReady: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyMidvaleHeldoutAdversarialLoop(packet, sourceCandidate) {
  const cases = [
    ['answer-hash', (value) => { value.answerKey.sha256 = '0'.repeat(64); }],
    ['source-receipt', (value) => { value.sequence.sourceCandidateReceiptSha256 = 'f'.repeat(64); }],
    ['sequence', (value) => { value.sequence.stampedAnswerOpenedAfterSourceCommit = false; }],
    ['primary-count', (value) => { value.approvedEvidence.primary.detectedCount = 8; }],
    ['independent-count', (value) => { value.approvedEvidence.independent.detectedDropAssemblyCount = 8; }],
    ['approved-columns', (value) => { value.approved.uniqueColumnCount = 4; }],
    ['approved-rows', (value) => { value.approved.uniqueRowCount = 2; }],
    ['prediction-count', (value) => { value.prediction.headCount = 12; }],
    ['result', (value) => { value.result.status = 'passed'; }],
    ['placement', (value) => { value.result.exactPlacementPatternVerified = true; }],
    ['heldout', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['compliance', (value) => { value.complianceReady = true; }],
    ['fabrication', (value) => { value.fabricationReady = true; }],
    ['receipt', (value) => { value.receiptSha256 = 'a'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const value = structuredClone(packet);
    mutate(value);
    if ((await validateMidvaleHeldoutComparison(value, sourceCandidate)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, complianceReady: false };
}

export function renderMidvaleHeldoutOverlaySvg(packet) {
  const approved = packet.approvedEvidence.primary.heads.map((head) => `<g data-approved-id="${head.id}"><circle cx="${head.pdfPointPt[0]}" cy="${head.pdfPointPt[1]}" r="10"/><path d="M${head.pdfPointPt[0] - 7} ${head.pdfPointPt[1]}h14M${head.pdfPointPt[0]} ${head.pdfPointPt[1] - 7}v14"/></g>`).join('');
  const predicted = packet.prediction.registeredHeads.map((head) => `<g data-predicted-id="${head.id}"><rect x="${head.pdfPointPt[0] - 8}" y="${head.pdfPointPt[1] - 8}" width="16" height="16"/><path d="M${head.pdfPointPt[0] - 11} ${head.pdfPointPt[1]}h22M${head.pdfPointPt[0]} ${head.pdfPointPt[1] - 11}v22"/></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="1480 1320 540 530" role="img" aria-label="Midvale heldout Clubroom vault overlay"><style>.bg{fill:#08111e}.scope{fill:#10243c;stroke:#94a3b8;stroke-width:2}.ridge{stroke:#f59e0b;stroke-width:3;stroke-dasharray:10 7}g[data-approved-id] circle{fill:none;stroke:#f43f5e;stroke-width:5}g[data-approved-id] path{stroke:#f43f5e;stroke-width:3}g[data-predicted-id] rect{fill:none;stroke:#22d3ee;stroke-width:4}g[data-predicted-id] path{stroke:#22d3ee;stroke-width:3}text{fill:#e2e8f0;font:16px sans-serif}.bad{fill:#fca5a5;font-weight:700}</style><rect class="bg" x="1480" y="1320" width="540" height="530"/><rect class="scope" x="${REGISTRATION.scopeRectPdfPt[0]}" y="${REGISTRATION.scopeRectPdfPt[1]}" width="${REGISTRATION.scopeRectPdfPt[2] - REGISTRATION.scopeRectPdfPt[0]}" height="${REGISTRATION.scopeRectPdfPt[3] - REGISTRATION.scopeRectPdfPt[1]}"/><line class="ridge" x1="${REGISTRATION.ridgePdfX}" y1="${REGISTRATION.scopeRectPdfPt[1]}" x2="${REGISTRATION.ridgePdfX}" y2="${REGISTRATION.scopeRectPdfPt[3]}"/>${approved}${predicted}<text x="1492" y="1345">Magenta circles: approved 12 (3 columns x 4 rows)</text><text x="1492" y="1368">Cyan squares: sealed prediction 8 (4 columns x 2 rows)</text><text class="bad" x="1492" y="1391">HELDOUT FAILED: count -4; exact placement not verified</text></svg>`;
}
