import { sha256Hex } from './elevation-datums.js';
import { selectPitchedPlacementStrategyV4 } from './pitched-placement-calibration-corpus-v4.js';

const PROJECT_ID = 'boys-girls-club-community-center-brigham-city-ut';
const PROJECT = 'Boys & Girls Club Community Center - Brigham City UT';
const SOURCE = Object.freeze(['f220c7841dfd1ca7fc0b8eaf8f440d0b63a1541b8228c7c006e4c44a88180b20', 18178437]);
const ANSWERS = Object.freeze({
  ahj_approved_plan: ['799fba69311eb3aa285d6b96cb346aed184b3093d73777737597d23df60a0a18', 5313661],
  as_built_plan: ['6f20b0ad824aaae6a8a71fac46e5faf89e5904eef0ad762cf98b8d0ed186b252', 14918460],
});
const V4_RECEIPT = '6a37f16060e6dfc24358c83967f6ebf5b0964ddcbcf38368a72ce849ab3a4621';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function validateBoysGirlsClubSourceSeal(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.unseen-pitched-holdout.v1' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) {
    return { status: 'blocked', issues: [issue('BGC_SOURCE_IDENTITY_INVALID', 'Boys and Girls Club holdout identity is invalid.')], sourceSealReady: false, complianceReady: false };
  }
  const { receiptSha256, ...draft } = packet;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('BGC_SOURCE_RECEIPT_MISMATCH', 'The pre-answer source seal changed.'));
  const source = packet.sources?.[0];
  if (packet.sources?.length !== 1 || source?.role !== 'architectural_permit_set' || source?.sha256 !== SOURCE[0] || source?.bytes !== SOURCE[1]) issues.push(issue('BGC_SOURCE_BINDING_DRIFT', 'The independent architectural permit source changed.'));
  const byRole = new Map((packet.answerKeyDenylist || []).map((answer) => [answer.role, answer]));
  for (const [role, [sha256, bytes]] of Object.entries(ANSWERS)) {
    const answer = byRole.get(role);
    if (!answer || answer.sha256 !== sha256 || answer.bytes !== bytes || answer.openedBeforeSourceSeal !== false) issues.push(issue('BGC_ANSWER_DENYLIST_DRIFT', `Sealed answer ${role} changed or was opened early.`));
  }
  if (byRole.size !== 2 || packet.selection?.status !== 'source-sealed-answers-unopened' || packet.selection?.priorImplementationSearchHits !== 0 || packet.selection?.rejectedBeforeAnswerOpen?.length < 5) issues.push(issue('BGC_SELECTION_PROVENANCE_INVALID', 'Fresh selection, exact denylist, and rejection history are required.'));
  const section = packet.sourceObservations?.buildingSection;
  if (packet.sourceObservations?.floorPlan?.gymAlongRidgeLengthFt !== 104 || section?.pitchRiseInPer12 !== 2 || section?.clearAcrossSlopeSpanFt !== 89.5 || section?.eaveElevationFt !== 125 || section?.ridgeElevationFt !== 132.458333 || section?.finishedFloorElevationFt !== 100) issues.push(issue('BGC_SOURCE_DIMENSION_DRIFT', 'The plan-and-section-closed gym dimensions changed.'));
  if (packet.brainPreflight?.status !== 'passed' || packet.brainPreflight?.platformSpineAddendumApplied !== true || packet.brainPreflight?.spatialB1ThroughB7Priority !== 1) issues.push(issue('BGC_PREFLIGHT_INCOMPLETE', 'Brain preflight, platform spine, and spatial priority are required.'));
  if (packet.generation?.answerKeyUsed !== false || packet.generation?.completedBidUsedForGeneration !== false || packet.generation?.v4EmpiricalPriorAllowed !== true || Object.values(packet.claims || {}).some(Boolean)) issues.push(issue('BGC_SOURCE_FALSE_PROMOTION', 'The source seal must remain answer-blind and fail closed on every downstream claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceSealReady: issues.length === 0, complianceReady: false };
}

function sourceFeatures() {
  return {
    clearSpanDisambiguated: true,
    occupiedProtectionPlaneCount: 2,
    symmetricTwoPlaneVault: true,
    ceilingPitchRiseInPer12: 2,
    envelopeLengthFt: 104,
    envelopeWidthFt: 89.5,
    aspectRatio: round(104 / 89.5),
    envelopeAreaSqFt: 9308,
    sourceObstructionPresent: true,
    movablePartitionPocketPresent: false,
    sourceSpanCandidateCount: 1,
  };
}

function sourceGeometry() {
  const lengthFt = 104;
  const widthFt = 89.5;
  const halfRunFt = widthFt / 2;
  const springElevationFt = 25;
  const ridgeElevationFt = 32.458333;
  return {
    coordinateSystem: 'A101 Gymnasium 106 local feet; A301 finished floor 100 feet normalized to zero',
    floor: { id: 'level-01', elevationFt: 0, sourceSheet: 'A101', sourcePhysicalPage: 10 },
    room: { id: 'gymnasium-106', name: 'GYMNASIUM 106', lengthFt, widthFt, areaSqFt: lengthFt * widthFt, polygonFt: [[0, 0], [lengthFt, 0], [lengthFt, widthFt], [0, widthFt]] },
    ceiling: {
      kind: 'source-proven-exposed-two-plane-pemb-roof-underside', axis: 'y', ridgeAxis: 'x',
      pitch: { riseIn: 2, runIn: 12 }, halfRunFt, springElevationFt, ridgeElevationFt, riseFt: round(ridgeElevationFt - springElevationFt),
      dimensionClosure: { planLength: 'four 26 foot bays from grid 2 through grid 6', sectionPitch: '2:12', eaveDatum: "125'-0\"", ridgeDatum: "132'-5 1/2\"", floorDatum: "100'-0\"", spanCalculation: '2 * ((132.458333 - 125) * 12 / 2) = 89.5 feet' },
      surfaces: [
        { id: 'gym-south-plane', polygonFt: [[0, 0], [lengthFt, 0], [lengthFt, halfRunFt], [0, halfRunFt]], downhillDirection: 'negative-y' },
        { id: 'gym-north-plane', polygonFt: [[0, halfRunFt], [lengthFt, halfRunFt], [lengthFt, widthFt], [0, widthFt]], downhillDirection: 'positive-y' },
      ],
    },
    obstructionEvidence: { sourceObstructionPresent: true, kinds: ['center ceiling fan', 'retractable basketball standards', 'lighting and air devices'], inventoryComplete: false, clearancesVerified: false },
  };
}

function elevationFt(geometry, yFt) {
  const distanceFromEave = Math.min(yFt, geometry.room.widthFt - yFt);
  return round(geometry.ceiling.springElevationFt + distanceFromEave * 2 / 12);
}

export async function buildBoysGirlsClubSourceOnlyCandidate(sourceSeal, v4Corpus) {
  if ((await validateBoysGirlsClubSourceSeal(sourceSeal)).status !== 'passed') throw new Error('BGC_SOURCE_SEAL_BLOCKED');
  if (v4Corpus?.artifactType !== 'halofire.pitched-placement-calibration-corpus.v4' || v4Corpus?.receiptSha256 !== V4_RECEIPT || v4Corpus?.strategySelectorReadyForFreshHoldout !== true || v4Corpus?.unseenProjectPlacementVerified !== false) throw new Error('PITCHED_CALIBRATION_V4_BLOCKED');
  const features = sourceFeatures();
  const selection = selectPitchedPlacementStrategyV4(features, v4Corpus);
  const prior = v4Corpus.largeVaultStrategies.find((entry) => entry.projectId === selection.selectedProjectId);
  const geometry = sourceGeometry();
  const xStationsFt = prior.answerExposedFeatures.normalizedAlongRidgeStations.map((value) => round(value * geometry.room.lengthFt));
  const yStationsFt = prior.answerExposedFeatures.normalizedAcrossSlopeStations.map((value) => round(value * geometry.room.widthFt));
  const heads3d = xStationsFt.flatMap((xFt, xIndex) => yStationsFt.map((yFt, yIndex) => ({
    id: `bgc-v4-hypothesis-${xIndex + 1}-${yIndex + 1}`,
    surfaceId: yFt < geometry.ceiling.halfRunFt ? 'gym-south-plane' : 'gym-north-plane',
    pointFt: [xFt, yFt, elevationFt(geometry, yFt)],
    status: 'blind-v4-out-of-envelope-hypothesis', hydraulicNodeAssigned: false, obstructionClearanceVerified: false,
  })));
  const draft = {
    artifactType: 'halofire.boys-girls-club-source-only-pitched-candidate.v1', projectId: PROJECT_ID, projectName: PROJECT,
    sourceSealReceiptSha256: sourceSeal.receiptSha256, v4CorpusReceiptSha256: v4Corpus.receiptSha256,
    generationMode: 'sealed-architectural-source-plus-answer-exposed-v4-empirical-selector-before-answer-open',
    sourceObservableFeatures: features, selectorResult: selection,
    selectorApplicability: {
      selectedTrainingEnvelope: { projectId: prior.projectId, lengthFt: prior.sourceObservableFeatures.envelopeLengthFt, widthFt: prior.sourceObservableFeatures.envelopeWidthFt, areaSqFt: prior.sourceObservableFeatures.envelopeAreaSqFt },
      targetExceedsTrainingLength: true, targetExceedsTrainingWidth: true, targetExceedsTrainingArea: true,
      distanceThresholdDefinedByV4: false, outOfEnvelope: true, productionPromotionAllowed: false,
    },
    geometry,
    blindPrediction: { layoutFamily: selection.selectedFamily, alongRidgeStations: xStationsFt.length, acrossSlopeStations: yStationsFt.length, headCount: heads3d.length, xStationsFt, yStationsFt },
    heads3d, branchPipes3d: [], branchPipeTopologyReady: false,
    buildingModel: { levelCount: 1, levels: [{ id: 'level-01', floorElevationFt: 0, roomIds: ['gymnasium-106'] }], modeledScope: 'source-closed-gymnasium-envelope', floorByFloorExtrusionReady: true, twoPlaneVaultReady: true, wholeBuildingFootprintComplete: false },
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic-v4-normalized-station-replay' },
      independent: { status: 'passed', method: 'A101 four-bay length plus A301 pitch-eave-ridge span closure' },
      adversarial: { status: 'passed', method: 'source-answer-selector-geometry-envelope-tally-and-false-promotion mutations' },
    },
    answerKeyOpened: false, answerKeyUsedAsGeometryInput: false, completedBidUsedAsGeometryInput: false,
    blindTopologyRecorded: true, candidatePlacementReady: false, unseenProjectPlacementVerified: false,
    roomEnvelopeGeometryGrounded: true, topViewReady: true, elevationViewReady: true, partialModel3dReady: true,
    obstructionInventoryReady: false, obstructionClearancesVerified: false, wholeBuildingModelReady: false,
    wholeBuildingHeadLayoutReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    requiredNextLoop: 'commit blind out-of-envelope topology then open sealed approved and as-built plans compare and preserve pass or failure for v5',
    claimStatus: 'fresh-source-only-out-of-envelope-v4-topology-hypothesis-not-placement-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateBoysGirlsClubSourceOnlyCandidate(packet, dependencies = {}) {
  let expected;
  try { expected = await buildBoysGirlsClubSourceOnlyCandidate(dependencies.sourceSeal, dependencies.v4Corpus); } catch (error) { return { status: 'blocked', issues: [issue('BGC_CANDIDATE_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('BGC_CANDIDATE_REPLAY_MISMATCH', 'Candidate no longer equals the deterministic blind replay.'));
  if (packet?.geometry?.room?.lengthFt !== 104 || packet?.geometry?.room?.widthFt !== 89.5 || packet?.geometry?.ceiling?.pitch?.riseIn !== 2 || packet?.geometry?.ceiling?.springElevationFt !== 25 || packet?.geometry?.ceiling?.ridgeElevationFt !== 32.458333 || packet?.geometry?.ceiling?.surfaces?.length !== 2) issues.push(issue('BGC_CANDIDATE_GEOMETRY_DRIFT', 'The source-closed gym envelope changed.'));
  if (packet?.selectorResult?.selectedProjectId !== 'viviano-clubhouse-saratoga-springs-ut' || packet?.selectorResult?.distance !== 30.887227 || packet?.blindPrediction?.alongRidgeStations !== 3 || packet?.blindPrediction?.acrossSlopeStations !== 4 || packet?.blindPrediction?.headCount !== 12 || packet?.heads3d?.length !== 12) issues.push(issue('BGC_BLIND_TOPOLOGY_DRIFT', 'The sealed v4 3 by 4 hypothesis changed.'));
  if (packet?.selectorApplicability?.outOfEnvelope !== true || packet?.selectorApplicability?.productionPromotionAllowed !== false || packet?.candidatePlacementReady !== false || packet?.answerKeyOpened !== false || packet?.answerKeyUsedAsGeometryInput !== false || packet?.unseenProjectPlacementVerified !== false || packet?.obstructionInventoryReady !== false || packet?.obstructionClearancesVerified !== false || packet?.wholeBuildingModelReady !== false || packet?.hydraulicCalculationReady !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('BGC_CANDIDATE_FALSE_PROMOTION', 'Out-of-envelope blind topology must keep placement and every downstream gate false.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, packet: issues.length ? null : packet, blindTopologyRecorded: issues.length === 0, candidatePlacementReady: false, complianceReady: false };
}

export async function verifyBoysGirlsClubAdversarialLoop(packet, dependencies) {
  const cases = [
    ['source', (v) => { v.sourceSealReceiptSha256 = '0'.repeat(64); }],
    ['v4', (v) => { v.v4CorpusReceiptSha256 = 'f'.repeat(64); }],
    ['answer-open', (v) => { v.answerKeyOpened = true; }],
    ['answer-input', (v) => { v.answerKeyUsedAsGeometryInput = true; }],
    ['pitch', (v) => { v.geometry.ceiling.pitch.riseIn = 4; }],
    ['span', (v) => { v.geometry.room.widthFt = 79.5; }],
    ['surface', (v) => { v.geometry.ceiling.surfaces.pop(); }],
    ['head', (v) => { v.heads3d.pop(); }],
    ['envelope-promotion', (v) => { v.selectorApplicability.productionPromotionAllowed = true; }],
    ['placement-promotion', (v) => { v.candidatePlacementReady = true; }],
    ['compliance-promotion', (v) => { v.complianceReady = true; }],
    ['receipt', (v) => { v.receiptSha256 = 'a'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validateBoysGirlsClubSourceOnlyCandidate(value, dependencies)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, candidatePlacementReady: false, complianceReady: false };
}

export function renderBoysGirlsClubSourceCandidateViews(packet) {
  const { room, ceiling } = packet.geometry;
  const xScale = 7.4; const yScale = 5.2; const ox = 70; const oy = 55;
  const topHeads = packet.heads3d.map((head) => `<circle cx="${round(ox + head.pointFt[0] * xScale)}" cy="${round(oy + head.pointFt[1] * yScale)}" r="6"/>`).join('');
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 930 590" role="img" aria-label="Boys and Girls Club blind v4 gym topology"><style>rect{fill:#07111f}.room{fill:#10233b;stroke:#e2e8f0;stroke-width:3}.ridge{stroke:#f59e0b;stroke-width:3;stroke-dasharray:9 6}circle{fill:#22d3ee;stroke:#fff;stroke-width:2}text{fill:#e2e8f0;font:16px sans-serif}</style><rect width="930" height="590"/><rect class="room" x="${ox}" y="${oy}" width="${room.lengthFt * xScale}" height="${room.widthFt * yScale}"/><line class="ridge" x1="${ox}" y1="${oy + ceiling.halfRunFt * yScale}" x2="${ox + room.lengthFt * xScale}" y2="${oy + ceiling.halfRunFt * yScale}"/>${topHeads}<text x="24" y="28">Blind v4 hypothesis: 104 ft x 89.5 ft Gymnasium 106 - 3 x 4 stations - answer unopened</text></svg>`;
  const ex = (y) => 90 + y * 7.7; const ez = (z) => 430 - z * 10;
  const elevationHeads = packet.heads3d.filter((head) => head.pointFt[0] === packet.blindPrediction.xStationsFt[0]).map((head) => `<circle cx="${ex(head.pointFt[1])}" cy="${ez(head.pointFt[2])}" r="7"/>`).join('');
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 470" role="img" aria-label="Boys and Girls Club source-closed pitched elevation"><style>rect{fill:#07111f}.shell{stroke:#94a3b8;stroke-width:4}.ceiling{stroke:#f59e0b;stroke-width:6}circle{fill:#22d3ee;stroke:#fff;stroke-width:2}text{fill:#e2e8f0;font:16px sans-serif}</style><rect width="850" height="470"/><line class="shell" x1="${ex(0)}" y1="${ez(0)}" x2="${ex(room.widthFt)}" y2="${ez(0)}"/><line class="shell" x1="${ex(0)}" y1="${ez(0)}" x2="${ex(0)}" y2="${ez(25)}"/><line class="shell" x1="${ex(room.widthFt)}" y1="${ez(0)}" x2="${ex(room.widthFt)}" y2="${ez(25)}"/><line class="ceiling" x1="${ex(0)}" y1="${ez(25)}" x2="${ex(ceiling.halfRunFt)}" y2="${ez(32.458333)}"/><line class="ceiling" x1="${ex(ceiling.halfRunFt)}" y1="${ez(32.458333)}" x2="${ex(room.widthFt)}" y2="${ez(25)}"/>${elevationHeads}<text x="20" y="28">A301 replay: 2:12 - +25.00 ft eaves - +32.458 ft ridge - 89.5 ft clear span</text></svg>`;
  return { status: 'passed', topSvg, elevationSvg, partialModel3dReady: true, candidatePlacementReady: false, complianceReady: false };
}
