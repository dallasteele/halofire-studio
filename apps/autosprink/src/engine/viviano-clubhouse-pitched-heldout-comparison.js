import { sha256Hex } from './elevation-datums.js';

const PROJECT_ID = 'viviano-clubhouse-saratoga-springs-ut';
const SOURCE_CANDIDATE_RECEIPT = 'a37a7f16802d80fc18ad9634b97564e295c3585f1ad14a4fdf36071891fd94b9';
const SOURCE_SEAL_RECEIPT = '1defe4bf3fb75ddd0d8c6cb48b87d1208281250320cc502572b91bf67965bb93';
const APPROVED_AS_BUILT_SHA256 = 'e3b4f12828e13c42051021b4d50e93462a8e750e97b2cdf7c8b88619f62d83f3';
const ENGINEER_APPROVED_SHA256 = '05d1a6e9ee901210a076c28dc919644b4e5facad88291fc21d30928627fc398c';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const APPROVED_CENTERS_PDF_PT = Object.freeze([
  [1971, 1407.75], [2074.5, 1408], [2189.5, 1408], [2293, 1407.75],
  [1971, 1585.5], [2074.5, 1585.5], [2189.5, 1585.5], [2293, 1585.5],
  [1971, 1763.75], [2074.5, 1764.25], [2189.5, 1764.25], [2293, 1764],
]);

const REGISTRATION = Object.freeze({
  pageNumber: 4,
  sheet: 'F1.2 SPRINKLER PLAN - LEVEL 2',
  sectionPageNumber: 5,
  sectionSheet: 'F1.3 GYM - SECTION VIEW',
  scalePtPerFt: 13.5,
  originPdfPt: [1924.092, 1296.592],
  mapping: 'pdf x = origin x + local y * 13.5; pdf y = origin y + local x * 13.5',
  ridgePdfX: 2131.724813,
  scopeRectPdfPt: [1924.092, 1296.592, 2339.653, 1866.967],
  roomRectPdfPt: [1924.092, 1296.592, 2339.653, 1866.967],
  basis: 'A404 source geometry closes the Gym vaulted bay at 42 feet 3 inches by 30 feet 9 1/8 inches; F1.2 prints at 3/16 inch equals 1 foot; the architectural underlay wall faces bind the source-local axes without using sprinkler centers',
});

function registerCandidate(sourceCandidate) {
  return sourceCandidate.layout.heads3d.map((head) => ({
    id: head.id,
    sourcePointFt: head.pointFt,
    pdfPointPt: [
      round(REGISTRATION.originPdfPt[0] + head.pointFt[1] * REGISTRATION.scalePtPerFt),
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
      approvedId: `viviano-approved-gym-head-${String(approvedIndex + 1).padStart(2, '0')}`,
      distanceFt: round(distance(predicted[predictedIndex].pdfPointPt, approved[approvedIndex]) / REGISTRATION.scalePtPerFt, 3),
    }];
  });
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

export async function buildVivianoHeldoutComparison(sourceCandidate) {
  if (sourceCandidate?.artifactType !== 'halofire.viviano-clubhouse-source-only-pitched-candidate.v1'
    || sourceCandidate?.projectId !== PROJECT_ID || sourceCandidate?.receiptSha256 !== SOURCE_CANDIDATE_RECEIPT
    || sourceCandidate?.sourceSealReceiptSha256 !== SOURCE_SEAL_RECEIPT || sourceCandidate?.answerKeyOpened !== false
    || sourceCandidate?.layout?.heads3d?.length !== 12 || sourceCandidate?.familySelection?.extrapolationWarning !== true) {
    throw new Error('VIVIANO_SEALED_SOURCE_CANDIDATE_BLOCKED');
  }
  const registeredCandidateHeads = registerCandidate(sourceCandidate);
  const approvedHeads = APPROVED_CENTERS_PDF_PT.map((pdfPointPt, index) => ({
    id: `viviano-approved-gym-head-${String(index + 1).padStart(2, '0')}`,
    pdfPointPt,
    localPointFt: [
      round((pdfPointPt[1] - REGISTRATION.originPdfPt[1]) / REGISTRATION.scalePtPerFt),
      round((pdfPointPt[0] - REGISTRATION.originPdfPt[0]) / REGISTRATION.scalePtPerFt),
    ],
    symbol: 'pendent-drop-on-occupied-vault-plane',
  }));
  const comparisons = [0.5, 1, 1.5, 3, 5].map((toleranceFt) => maximumThresholdMatching(registeredCandidateHeads, APPROVED_CENTERS_PDF_PT, toleranceFt));
  const draft = {
    artifactType: 'halofire.viviano-clubhouse-pitched-heldout-comparison.v1',
    projectId: PROJECT_ID,
    projectName: 'Viviano Clubhouse - Saratoga Springs UT',
    sequence: {
      sourceCandidateCommit: '957fe15ac4f395504e06af71cec9b5a9e84fceda',
      sourceCandidateReceiptSha256: SOURCE_CANDIDATE_RECEIPT,
      sourceSealReceiptSha256: SOURCE_SEAL_RECEIPT,
      approvedAndAsBuiltOpenedAfterSourceCommit: true,
      answersUsedToGenerateSourceCandidate: false,
    },
    answerKeys: {
      engineerApproved: { sha256: ENGINEER_APPROVED_SHA256, bytes: 16280495 },
      ahjApprovedRevised: { sha256: APPROVED_AS_BUILT_SHA256, bytes: 7450530, pageNumber: 4, sheet: REGISTRATION.sheet },
      asBuilt: { sha256: APPROVED_AS_BUILT_SHA256, bytes: 7450530, pageNumber: 4, sheet: REGISTRATION.sheet },
    },
    registration: REGISTRATION,
    approvedEvidence: {
      primary: {
        status: 'passed',
        method: 'unseeded four-pixel-per-point saturated-red open-annulus detector inside only the source-registered Gym vault; 24 angular samples at 18-pixel radius, open-center threshold, and 25-pixel non-max suppression',
        rawCandidateCount: 123,
        detectedCount: approvedHeads.length,
        heads: approvedHeads,
      },
      independent: {
        status: 'passed',
        method: 'F1.2 pipe-end symbol and dimension audit plus F1.3 section audit',
        planTopology: { alongRidgeStations: 3, acrossSlopeStations: 4, headCount: 12 },
        sectionTopology: { pendentDropsPerWestPlane: 2, pendentDropsPerEastPlane: 2, ridgeHeadPresent: false },
        alongRidgeSpacingLabelsFt: [13.166667, 13.166667],
        conclusion: 'three along-ridge stations by four across-slope stations; two pendent drops on each occupied ceiling plane',
      },
      answerParity: {
        status: 'passed',
        method: 'AHJ-approved revised PDF and close-out as-built PDF are byte-identical SHA-256 artifacts',
        detectedCount: 12,
        centersEqualApproved: true,
      },
      adversarial: { status: 'passed', method: 'answer-hash, sequence, scope, detector, topology, count, section, receipt, and false-promotion mutations' },
    },
    prediction: {
      headCount: registeredCandidateHeads.length,
      uniqueAlongRidgeStations: 4,
      uniqueAcrossSlopeStations: 3,
      ridgeHeadStationPresent: true,
      registeredHeads: registeredCandidateHeads,
    },
    approved: {
      headCount: approvedHeads.length,
      uniqueAlongRidgeStations: 3,
      uniqueAcrossSlopeStations: 4,
      ridgeHeadStationPresent: false,
    },
    comparisons,
    result: {
      status: 'failed',
      occupiedVaultedCeilingClassificationVerified: true,
      approvedDropsServeOccupiedVaultedGym: true,
      approvedPlanAndSectionTopologyVerified: true,
      approvedAndAsBuiltParityVerified: true,
      exactPlacementPatternVerified: false,
      countDelta: sourceCandidate.layout.heads3d.length - approvedHeads.length,
      failureMode: 'The sealed v2 nearest-neighbor transfer gets the total count right but transposes the topology: it predicts four along-ridge by three across-slope stations with a ridge row; the approved/as-built layout is three along-ridge by four across-slope stations with two drops per ceiling plane and no ridge head.',
      correctionPolicy: 'Preserve Viviano as an answer-exposed failed holdout; add answer-exposed plane-station and ridge-row features without claiming a causal rule, revise the empirical corpus, and require another sealed completed-project holdout before placement acceptance.',
    },
    internalVerification: {
      primary: 'source-registered saturated-red open-head raster detector',
      independent: 'plan topology and dimension labels cross-checked against the separate Gym section view',
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
    claimStatus: 'failed-fresh-heldout-placement-with-approved-and-as-built-3-by-4-Gym-vault-evidence-not-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateVivianoHeldoutComparison(packet, sourceCandidate) {
  let expected;
  try { expected = await buildVivianoHeldoutComparison(sourceCandidate); } catch (error) {
    return { status: 'blocked', issues: [issue('VIVIANO_HELDOUT_DEPENDENCY_BLOCKED', error.message)], complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('VIVIANO_HELDOUT_REPLAY_MISMATCH', 'Comparison does not equal deterministic answer-exposed replay.'));
  if (packet?.answerKeys?.ahjApprovedRevised?.sha256 !== APPROVED_AS_BUILT_SHA256 || packet?.answerKeys?.asBuilt?.sha256 !== APPROVED_AS_BUILT_SHA256
    || packet?.registration?.scopeRectPdfPt?.join(',') !== REGISTRATION.scopeRectPdfPt.join(',')) issues.push(issue('VIVIANO_ANSWER_OR_SCOPE_DRIFT', 'Answer identity or source-registered Gym scope changed.'));
  if (packet?.approvedEvidence?.primary?.detectedCount !== 12 || packet?.approvedEvidence?.independent?.planTopology?.headCount !== 12
    || packet?.approvedEvidence?.independent?.sectionTopology?.pendentDropsPerWestPlane !== 2
    || packet?.approvedEvidence?.independent?.sectionTopology?.pendentDropsPerEastPlane !== 2
    || packet?.approvedEvidence?.answerParity?.centersEqualApproved !== true
    || packet?.approved?.uniqueAlongRidgeStations !== 3 || packet?.approved?.uniqueAcrossSlopeStations !== 4
    || packet?.approved?.ridgeHeadStationPresent !== false) issues.push(issue('VIVIANO_APPROVED_EVIDENCE_DRIFT', 'The independently confirmed approved/as-built 3-by-4 Gym pattern changed.'));
  if (packet?.prediction?.headCount !== 12 || packet?.prediction?.uniqueAlongRidgeStations !== 4 || packet?.prediction?.uniqueAcrossSlopeStations !== 3
    || packet?.prediction?.ridgeHeadStationPresent !== true || packet?.result?.status !== 'failed'
    || packet?.result?.exactPlacementPatternVerified !== false || packet?.result?.countDelta !== 0
    || packet?.comparisons?.find((entry) => entry.toleranceFt === 1.5)?.matchedCount !== 0
    || packet?.unseenProjectPlacementVerified !== false) issues.push(issue('VIVIANO_FAILURE_TRUTH_DRIFT', 'The failed equal-count topology result was weakened or changed.'));
  if (packet?.sourceOnlyClassifierVerified !== true || packet?.result?.occupiedVaultedCeilingClassificationVerified !== true
    || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('VIVIANO_HELDOUT_FALSE_PROMOTION', 'Correct ceiling classification and equal head count cannot promote wrong topology or downstream readiness.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, heldoutComparisonReady: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyVivianoHeldoutAdversarialLoop(packet, sourceCandidate) {
  const cases = [
    ['engineer-hash', (value) => { value.answerKeys.engineerApproved.sha256 = '0'.repeat(64); }],
    ['approved-hash', (value) => { value.answerKeys.ahjApprovedRevised.sha256 = '1'.repeat(64); }],
    ['as-built-hash', (value) => { value.answerKeys.asBuilt.sha256 = '2'.repeat(64); }],
    ['source-receipt', (value) => { value.sequence.sourceCandidateReceiptSha256 = 'f'.repeat(64); }],
    ['sequence', (value) => { value.sequence.approvedAndAsBuiltOpenedAfterSourceCommit = false; }],
    ['scope', (value) => { value.registration.scopeRectPdfPt[0] += 13.5; }],
    ['primary-count', (value) => { value.approvedEvidence.primary.detectedCount = 11; }],
    ['independent-count', (value) => { value.approvedEvidence.independent.planTopology.headCount = 11; }],
    ['section-west', (value) => { value.approvedEvidence.independent.sectionTopology.pendentDropsPerWestPlane = 1; }],
    ['section-ridge', (value) => { value.approvedEvidence.independent.sectionTopology.ridgeHeadPresent = true; }],
    ['answer-parity', (value) => { value.approvedEvidence.answerParity.centersEqualApproved = false; }],
    ['approved-along', (value) => { value.approved.uniqueAlongRidgeStations = 4; }],
    ['approved-across', (value) => { value.approved.uniqueAcrossSlopeStations = 3; }],
    ['approved-ridge', (value) => { value.approved.ridgeHeadStationPresent = true; }],
    ['prediction-topology', (value) => { value.prediction.uniqueAlongRidgeStations = 3; }],
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
    if ((await validateVivianoHeldoutComparison(value, sourceCandidate)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, complianceReady: false };
}

export function renderVivianoHeldoutOverlaySvg(packet) {
  const approved = packet.approvedEvidence.primary.heads.map((head) => `<g data-approved-id="${head.id}"><circle cx="${head.pdfPointPt[0]}" cy="${head.pdfPointPt[1]}" r="8"/><path d="M${head.pdfPointPt[0] - 6} ${head.pdfPointPt[1]}h12M${head.pdfPointPt[0]} ${head.pdfPointPt[1] - 6}v12"/></g>`).join('');
  const predicted = packet.prediction.registeredHeads.map((head) => `<g data-predicted-id="${head.id}"><rect x="${head.pdfPointPt[0] - 6}" y="${head.pdfPointPt[1] - 6}" width="12" height="12"/><path d="M${head.pdfPointPt[0] - 8} ${head.pdfPointPt[1]}h16M${head.pdfPointPt[0]} ${head.pdfPointPt[1] - 8}v16"/></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="1880 1240 510 700" role="img" aria-label="Viviano heldout Gym vault overlay"><style>.bg{fill:#08111e}.scope{fill:#10243c;stroke:#94a3b8;stroke-width:2}.ridge{stroke:#f59e0b;stroke-width:3;stroke-dasharray:10 7}g[data-approved-id] circle{fill:none;stroke:#f43f5e;stroke-width:5}g[data-approved-id] path{stroke:#f43f5e;stroke-width:3}g[data-predicted-id] rect{fill:none;stroke:#22d3ee;stroke-width:4}g[data-predicted-id] path{stroke:#22d3ee;stroke-width:3}text{fill:#e2e8f0;font:13px sans-serif}.bad{fill:#fca5a5;font-weight:700}</style><rect class="bg" x="1880" y="1240" width="510" height="700"/><rect class="scope" x="${REGISTRATION.scopeRectPdfPt[0]}" y="${REGISTRATION.scopeRectPdfPt[1]}" width="${REGISTRATION.scopeRectPdfPt[2] - REGISTRATION.scopeRectPdfPt[0]}" height="${REGISTRATION.scopeRectPdfPt[3] - REGISTRATION.scopeRectPdfPt[1]}"/><line class="ridge" x1="${REGISTRATION.ridgePdfX}" y1="${REGISTRATION.roomRectPdfPt[1]}" x2="${REGISTRATION.ridgePdfX}" y2="${REGISTRATION.roomRectPdfPt[3]}"/>${approved}${predicted}<text x="1888" y="1260">Magenta circles: approved/as-built 12 (3 along x 4 across; no ridge head)</text><text x="1888" y="1278">Cyan squares: sealed prediction 12 (4 along x 3 across; ridge row)</text><text class="bad" x="1888" y="1296">HELDOUT FAILED: equal count, wrong topology; exact placement not verified</text></svg>`;
}
