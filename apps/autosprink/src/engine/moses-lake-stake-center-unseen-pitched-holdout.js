import { sha256Hex } from './elevation-datums.js';

const PROJECT = 'Moses Lake Stake Center';
const PROJECT_ID = 'moses-lake-stake-center';
const CALIBRATION_RECEIPT = '06c6ed0d30d2aed8ad0031985fa7a0225931dd400c5b1ef90cad894794b6f902';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });

const EXPECTED_SOURCES = Object.freeze({
  architectural_floor_plan: ['cf846baa12470b78db992b6cb657e26672c86a1fa2390de2d0d256989ddc7ee7', 1346905],
  architectural_dimension_plan: ['cad0b770cdd2fbe896c334501c7e490ab50562072a4ef2b330fbf568374a562b', 1121178],
  architectural_roof_plan: ['e26dd112b5705530f459005969d90fca277d5235a84a404eb95df09349f1ef03', 653985],
  architectural_reflected_ceiling_plan: ['626283ee00b0fea9eb3bec2142f7a6d429d10919446eb12656118b4c105f6f92', 1179752],
  architectural_building_elevations: ['2a0f3ec1f1b6a2761dcae5d151fd6a40fd8bda532eb41bf85837ebd022051916', 669256],
  architectural_chapel_sections: ['5597db2f57fd803006b43c947a40827a222780365829e5dfab9437ba47795697', 1160000],
  architectural_cultural_center_sections: ['a4936ba17edeefe34078abc832c1f2c0c9a5f7ba8ed0217d636d871112b62219', 1156490],
  structural_truss_elevations: ['f2a18a740b0c574f9bf2834aa4ba62de4205b6f77875b3d00b83c872c913f17b', 801948],
});

const EXPECTED_ANSWERS = Object.freeze([
  ['3074149cae1c4db4de8e40d7a537b2461910935bb6e5aa01ac504bb170fd52a3', 5932127],
  ['aa533bd4187ca59283cd3d8cc62d513acd31432ef3df2d8169a57e17fa713eab', 5937065],
]);

export async function sealMosesLakeSourceSeal(value) {
  const draft = structuredClone(value);
  delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMosesLakeSourceSeal(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.unseen-pitched-holdout.v1' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) {
    return { status: 'blocked', issues: [issue('MOSES_LAKE_SOURCE_SEAL_IDENTITY_INVALID', 'Moses Lake holdout identity is invalid.')], complianceReady: false };
  }
  const { receiptSha256, ...draft } = packet;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('MOSES_LAKE_SOURCE_SEAL_RECEIPT_MISMATCH', 'The pre-answer source seal changed.'));
  const sources = new Map((packet.sources || []).map((source) => [source.role, source]));
  for (const [role, [sha256, bytes]] of Object.entries(EXPECTED_SOURCES)) {
    const source = sources.get(role);
    if (!source || source.sha256 !== sha256 || source.bytes !== bytes) issues.push(issue('MOSES_LAKE_SOURCE_IDENTITY_DRIFT', `Source ${role} changed or is missing.`));
  }
  if (sources.size !== Object.keys(EXPECTED_SOURCES).length) issues.push(issue('MOSES_LAKE_SOURCE_SET_DRIFT', 'The source set must contain exactly the floor, dimension, roof, RCP, elevation, section, and truss evidence.'));
  if (packet.answerKeyDenylist?.length !== EXPECTED_ANSWERS.length) issues.push(issue('MOSES_LAKE_ANSWER_DENYLIST_DRIFT', 'The approved and as-built answers must both remain denylisted.'));
  else packet.answerKeyDenylist.forEach((answer, index) => {
    const [sha256, bytes] = EXPECTED_ANSWERS[index];
    if (answer.sha256 !== sha256 || answer.bytes !== bytes || answer.openedBeforeSourceCommit !== false) issues.push(issue('MOSES_LAKE_ANSWER_DENYLIST_DRIFT', 'An answer identity changed or was opened before source commit.'));
  });
  const vault = packet.sourceObservations?.culturalCenterVault;
  if (vault?.room !== 'CULTURAL CENTER SC150' || vault?.planLengthFt !== 25.5 || vault?.planWidthFt !== 37.541667
    || vault?.pitchRiseInPer12 !== 4.5 || vault?.ridgeElevationFt !== 19.385417 || vault?.derivedSpringElevationFt !== 12.346354
    || vault?.ceilingFinishType !== 'C3' || vault?.sourceCeilingLabel !== 'SLOPED') {
    issues.push(issue('MOSES_LAKE_SOURCE_OBSERVATION_DRIFT', 'The Cultural Center plan, RCP, or section closure changed.'));
  }
  if (packet.sourceObservations?.zoneRegistry?.length !== 3
    || packet.sourceObservations.zoneRegistry.filter((zone) => zone.placementEligible).length !== 1) issues.push(issue('MOSES_LAKE_ZONE_REGISTRY_DRIFT', 'Exactly one dimension-closed occupied sloped zone may be placement eligible.'));
  if (packet.selection?.status !== 'source-sealed-answer-unopened' || packet.selection?.priorImplementationSearchHits !== 0
    || packet.selection?.rejectedBeforeAnswerOpen?.length < 3) issues.push(issue('MOSES_LAKE_SELECTION_INVALID', 'Fresh selection and pre-answer rejection history are incomplete.'));
  if (packet.toolchain?.pdfRenderer !== 'Poppler pdftoppm' || packet.toolchain?.readOnlySourceInspection !== true
    || packet.brainPreflight?.status !== 'passed' || packet.brainPreflight?.platformSpineAddendumApplied !== true
    || packet.brainPreflight?.spatialB1ThroughB7Priority !== 1) issues.push(issue('MOSES_LAKE_PREFLIGHT_INCOMPLETE', 'Verified PDF tooling and brain preflight are required.'));
  if (packet.generation?.answerKeyUsed !== false || packet.generation?.completedBidUsedForGeneration !== false
    || packet.generation?.roofPlaneSubstitutionAllowed !== false || Object.values(packet.claims || {}).some(Boolean)) {
    issues.push(issue('MOSES_LAKE_SOURCE_SEAL_FALSE_PROMOTION', 'The source seal must reject answer leakage, roof substitution, and downstream claims.'));
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceSealReady: issues.length === 0, complianceReady: false };
}

function requireCalibration(calibration) {
  const family = calibration?.trainingProjects?.find((project) => project.layoutFamily === 'large-symmetric-two-plane-vault');
  if (calibration?.artifactType !== 'halofire.pitched-placement-calibration-corpus.v1'
    || calibration?.receiptSha256 !== CALIBRATION_RECEIPT
    || calibration?.mode !== 'answer-exposed-multi-project-empirical-calibration'
    || calibration?.transferPolicy?.empiricalPriorOnly !== true
    || calibration?.transferPolicy?.codeLimit !== false
    || calibration?.transferPolicy?.unseenProjectHoldoutRequired !== true
    || family?.answerExposedFeatures?.normalizedColumnStations?.length !== 3
    || family?.answerExposedFeatures?.normalizedRowStations?.length !== 4) throw new Error('PITCHED_CALIBRATION_CORPUS_BLOCKED');
  return family;
}

function sourceGeometry(sourceSeal) {
  const observation = sourceSeal.sourceObservations.culturalCenterVault;
  const widthFt = observation.planWidthFt;
  const lengthFt = observation.planLengthFt;
  const halfRunFt = round(widthFt / 2);
  const springElevationFt = observation.derivedSpringElevationFt;
  const ridgeElevationFt = observation.ridgeElevationFt;
  return {
    coordinateSystem: 'A103 Cultural Center SC150 local feet; x east-west along ridge, y south-north across slope; Level 01 datum 100 feet',
    floor: { id: 'level-01', localElevationFt: 0, projectDatumElevationFt: 100, sourceSheet: 'A101/A103' },
    room: { id: 'cultural-center-vault-zone', name: observation.room, lengthFt, widthFt, areaSqFt: round(lengthFt * widthFt), polygonFt: [[0, 0], [lengthFt, 0], [lengthFt, widthFt], [0, widthFt]], scopeStatus: 'dimension-closed-source-only-vault-zone-not-whole-building' },
    ceiling: {
      kind: 'source-proven-occupied-symmetric-two-plane-vault', axis: 'y', ridgeAxis: 'x', pitch: { riseIn: observation.pitchRiseInPer12, runIn: 12 },
      springElevationFt, ridgeElevationFt, halfRunFt, riseFt: round(ridgeElevationFt - springElevationFt),
      dimensionClosure: {
        sourceSheets: ['A103', 'A151', 'A302', 'S201'], planLengthLabel: `25'-6\"`, planWidthLabel: `37'-6 1/2\"`,
        ridgeLabel: `19'-4 5/8\"`, ceilingLabel: 'C3 SLOPED', pitchSymbol: `4 1/2\":1'-0\"`,
        derivedSpringCalculation: '19.385417 - (37.541667 / 2) * (4.5 / 12) = 12.346354 feet',
        roofPlaneUsedAsCeiling: false, trussBottomChordCorroborationOnly: true,
      },
      surfaces: [
        { id: 'cultural-center-south-plane', polygonFt: [[0, 0], [lengthFt, 0], [lengthFt, halfRunFt], [0, halfRunFt]], downhillDirection: 'negative-y' },
        { id: 'cultural-center-north-plane', polygonFt: [[0, halfRunFt], [lengthFt, halfRunFt], [lengthFt, widthFt], [0, widthFt]], downhillDirection: 'positive-y' },
      ],
    },
    zoneRegistry: sourceSeal.sourceObservations.zoneRegistry,
  };
}

const ceilingElevationFt = (geometry, y) => round(geometry.ceiling.springElevationFt + Math.min(y, geometry.room.widthFt - y) * geometry.ceiling.pitch.riseIn / 12);

export async function buildMosesLakeSourceOnlyCandidate(sourceSeal, calibration) {
  if ((await validateMosesLakeSourceSeal(sourceSeal)).status !== 'passed') throw new Error('MOSES_LAKE_SOURCE_SEAL_BLOCKED');
  const family = requireCalibration(calibration);
  const geometry = sourceGeometry(sourceSeal);
  const alongStationsFt = family.answerExposedFeatures.normalizedRowStations.map((station) => round(station * geometry.room.lengthFt));
  const acrossStationsFt = family.answerExposedFeatures.normalizedColumnStations.map((station) => round(station * geometry.room.widthFt));
  const heads3d = [];
  for (const x of alongStationsFt) for (const y of acrossStationsFt) {
    heads3d.push({
      id: `moses-lake-source-head-${String(heads3d.length + 1).padStart(2, '0')}`,
      surfaceId: y <= geometry.ceiling.halfRunFt ? 'cultural-center-south-plane' : 'cultural-center-north-plane',
      pointFt: [x, y, ceilingElevationFt(geometry, y)], status: 'source-only-answer-exposed-family-transfer-candidate',
      hydraulicNodeAssigned: false, obstructionClearanceVerified: false,
    });
  }
  const draft = {
    artifactType: 'halofire.moses-lake-stake-center-source-only-pitched-candidate.v1', projectId: PROJECT_ID, projectName: PROJECT,
    sourceSealReceiptSha256: sourceSeal.receiptSha256, calibrationCorpusReceiptSha256: calibration.receiptSha256,
    generationMode: 'fresh-sealed-architectural-source-plus-answer-exposed-cross-project-family-before-answer-open',
    familySelection: {
      selectedFamily: family.layoutFamily,
      sourceOnlyFeatures: { occupiedProtectionPlaneCount: 2, symmetricTwoPlaneVault: true, ceilingPitchRiseInPer12: 4.5, envelopeAreaSqFt: geometry.room.areaSqFt, sourceObstructionPresent: false },
      forbiddenSelectorInputsUsed: [], empiricalPriorOnly: true, codeLimit: false,
      stationTransfer: { acrossSlope: 'Midvale normalized columns', alongRidge: 'Midvale normalized rows', acrossStationsFt, alongStationsFt },
    },
    geometry, layout: { topology: { alongRidgeStations: 4, acrossSlopeStations: 3 }, headCount: heads3d.length, heads3d },
    branchPipes3d: [], branchPipeTopologyReady: false,
    buildingModel: { levelCount: 1, modeledScope: 'source-closed Cultural Center SC150 vault zone', floorByFloorExtrusionReady: true, twoPlaneVaultReady: true, wholeBuildingFootprintComplete: false, unresolvedZones: ['chapel-vault-zone', 'flat-support-zones'] },
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic-normalized-station-family-transfer' },
      independent: { status: 'passed', method: 'A103-A151-A302-S201-plan-RCP-section-truss-closure' },
      adversarial: { status: 'passed', method: 'source-calibration-family-answer-roof-zone-count-and-false-promotion-mutations' },
    },
    answerKeyUsedAsGeometryInput: false, completedBidUsedAsGeometryInput: false, answerKeyOpened: false,
    unseenProjectPlacementVerified: false, roomEnvelopeGeometryGrounded: true, topViewReady: true, elevationViewReady: true, partialModel3dReady: true,
    wholeBuildingModelReady: false, wholeBuildingHeadLayoutReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    claimStatus: 'fresh-source-only-Cultural-Center-vault-candidate-before-approved-or-as-built-answer-comparison-not-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMosesLakeSourceOnlyCandidate(packet, dependencies = {}) {
  let expected;
  try { expected = await buildMosesLakeSourceOnlyCandidate(dependencies.sourceSeal, dependencies.calibration); } catch (error) {
    return { status: 'blocked', issues: [issue('MOSES_LAKE_SOURCE_CANDIDATE_DEPENDENCY_BLOCKED', error.message)], complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('MOSES_LAKE_SOURCE_CANDIDATE_REPLAY_MISMATCH', 'Candidate does not equal deterministic sealed-source replay.'));
  const geometry = packet?.geometry;
  const heads = packet?.layout?.heads3d || [];
  if (geometry?.room?.lengthFt !== 25.5 || geometry?.room?.widthFt !== 37.541667 || geometry?.ceiling?.pitch?.riseIn !== 4.5
    || geometry?.ceiling?.ridgeElevationFt !== 19.385417 || geometry?.ceiling?.dimensionClosure?.roofPlaneUsedAsCeiling !== false
    || geometry?.ceiling?.surfaces?.length !== 2) issues.push(issue('MOSES_LAKE_SOURCE_GEOMETRY_DRIFT', 'The dimension-closed Cultural Center vault geometry changed.'));
  if (heads.length !== 12 || packet?.layout?.topology?.alongRidgeStations !== 4 || packet?.layout?.topology?.acrossSlopeStations !== 3
    || new Set(heads.map((head) => head.surfaceId)).size !== 2 || heads.some((head) => head.hydraulicNodeAssigned || head.obstructionClearanceVerified)) issues.push(issue('MOSES_LAKE_SOURCE_HEAD_TALLY_DRIFT', 'The empirical family transfer must emit twelve scoped candidates without downstream claims.'));
  if (packet?.familySelection?.selectedFamily !== 'large-symmetric-two-plane-vault' || packet?.familySelection?.forbiddenSelectorInputsUsed?.length !== 0
    || packet?.answerKeyUsedAsGeometryInput !== false || packet?.completedBidUsedAsGeometryInput !== false || packet?.answerKeyOpened !== false
    || packet?.unseenProjectPlacementVerified !== false || packet?.branchPipes3d?.length !== 0 || packet?.branchPipeTopologyReady !== false
    || packet?.wholeBuildingModelReady !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) {
    issues.push(issue('MOSES_LAKE_SOURCE_CANDIDATE_FALSE_PROMOTION', 'Pre-answer candidate cannot infer answer geometry, pipes, held-out acceptance, or downstream readiness.'));
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceCandidateReady: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyMosesLakeSourceCandidateAdversarialLoop(packet, dependencies) {
  const cases = [
    ['source', (value) => { value.sourceSealReceiptSha256 = '0'.repeat(64); }],
    ['calibration', (value) => { value.calibrationCorpusReceiptSha256 = '1'.repeat(64); }],
    ['family', (value) => { value.familySelection.selectedFamily = 'small-obstructed-single-plane'; }],
    ['forbidden-selector', (value) => { value.familySelection.forbiddenSelectorInputsUsed.push('approved-head-count'); }],
    ['answer', (value) => { value.answerKeyOpened = true; }],
    ['roof-substitution', (value) => { value.geometry.ceiling.dimensionClosure.roofPlaneUsedAsCeiling = true; }],
    ['pitch', (value) => { value.geometry.ceiling.pitch.riseIn = 6; }],
    ['ridge', (value) => { value.geometry.ceiling.ridgeElevationFt = 22; }],
    ['zone-promotion', (value) => { value.geometry.zoneRegistry[1].placementEligible = true; }],
    ['surface', (value) => { value.geometry.ceiling.surfaces.pop(); }],
    ['head', (value) => { value.layout.heads3d.pop(); }],
    ['topology', (value) => { value.layout.topology.acrossSlopeStations = 4; }],
    ['pipe', (value) => { value.branchPipeTopologyReady = true; }],
    ['whole-building', (value) => { value.wholeBuildingModelReady = true; }],
    ['heldout', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['compliance', (value) => { value.complianceReady = true; }],
    ['fabrication', (value) => { value.fabricationReady = true; }],
    ['field-release', (value) => { value.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const value = structuredClone(packet);
    mutate(value);
    if ((await validateMosesLakeSourceOnlyCandidate(value, dependencies)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, complianceReady: false };
}
