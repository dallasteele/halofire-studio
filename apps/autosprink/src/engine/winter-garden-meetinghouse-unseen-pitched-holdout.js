import { sha256Hex } from './elevation-datums.js';
import { selectPitchedPlacementStrategyV3 } from './pitched-placement-calibration-corpus-v3.js';

const PROJECT = 'LDS Meeting House - Winter Garden FL';
const PROJECT_ID = 'lds-meetinghouse-winter-garden-fl';
const CALIBRATION_RECEIPT = 'c9865fa6713ea4eea83f0e5afbe8587205f6d2a150f4bbc6dcc1e10f6fe32101';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });

const EXPECTED_SOURCES = Object.freeze({
  architectural_dimension_plan: ['bca163d23e89b86332f670f6f234f5bc5319b1a1e461de28a3fb3124120c2f89', 429687],
  architectural_roof_plan: ['0fa8d19cf2a8ca421a3cad7200b410763eee701bb566ca84d37321b1b51ce921', 337696],
  architectural_reflected_ceiling_plan: ['4a6c4b29eff18a8e964627ba41807f2f8119f8a2c8012d5900acf08e61ee8e43', 777587],
  architectural_building_sections: ['cc07fa4778271d2000a9dc3aa006b50e7aac4bfc87ad0a7aa7f3531a3118f4af', 518193],
  structural_roof_framing_plan: ['598c32666d64af92bec8235ee359eea11e8c35535bd46f951d9a7a78e505574e', 423465],
  structural_truss_elevations: ['e589f03c8227bda73c37ec30f238f67406534b3ba30ecf64ca4b02d4e1db3311', 225245],
});

const EXPECTED_ANSWERS = Object.freeze([
  ['6e012d46dd20ff5808717d39898fd4b7fe54fcb0f35253ef7be6c3e5f48300f6', 6014967],
  ['50ff94aee2d05dd7434160ded0c622515f24f700e6fc971170ee595f7c50215f', 1113607],
  ['7949abda695309093c66b31d178eeb9724a2c7cb2ef03997c73abf93a864b0b5', 490600],
  ['6561bcb77f1c6f4f636a7b0f1dc924ae2c54d9dcbb214e4d32bc3d589c9ed86c', 1043434],
  ['22c8db4dde89ce0ed9ee6625b9d8f8b1918c2ecdb9baf6ff829a9c4118b5b8bb', 2888781],
  ['13aa82f90bf7b03bc0b4728d0b631321372a48932d2a55187dad6edc947de3a0', 1430614],
  ['0f27868210a489538cfd46490108e1ac81ab9f727a126e0e8a8e3bdf53ce88e1', 946501],
  ['4b6ea3c5027894ad7ccf752c25a82c993d321e0f1f7967c80d114f737bc8c128', 7345772],
]);

export async function sealWinterGardenSourceSeal(value) {
  const draft = structuredClone(value);
  delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateWinterGardenSourceSeal(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.unseen-pitched-holdout.v3' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) {
    return { status: 'blocked', issues: [issue('WINTER_GARDEN_SOURCE_IDENTITY_INVALID', 'Winter Garden holdout identity is invalid.')], complianceReady: false };
  }
  const { receiptSha256, ...draft } = packet;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('WINTER_GARDEN_SOURCE_RECEIPT_MISMATCH', 'The pre-answer source seal changed.'));
  const sources = new Map((packet.sources || []).map((source) => [source.role, source]));
  for (const [role, [sha256, bytes]] of Object.entries(EXPECTED_SOURCES)) {
    const source = sources.get(role);
    if (!source || source.sha256 !== sha256 || source.bytes !== bytes) issues.push(issue('WINTER_GARDEN_SOURCE_IDENTITY_DRIFT', `Source ${role} changed or is missing.`));
  }
  if (sources.size !== Object.keys(EXPECTED_SOURCES).length) issues.push(issue('WINTER_GARDEN_SOURCE_SET_DRIFT', 'Exactly six source geometry sheets are required.'));
  if (packet.answerKeyDenylist?.length !== EXPECTED_ANSWERS.length) issues.push(issue('WINTER_GARDEN_ANSWER_DENYLIST_DRIFT', 'All completed answer identities must remain denylisted.'));
  else packet.answerKeyDenylist.forEach((answer, index) => {
    const [sha256, bytes] = EXPECTED_ANSWERS[index];
    if (answer.sha256 !== sha256 || answer.bytes !== bytes || answer.openedBeforeSourceCommit !== false) issues.push(issue('WINTER_GARDEN_ANSWER_DENYLIST_DRIFT', 'An answer identity changed or was opened before the source-only commit.'));
  });
  const vault = packet.sourceObservations?.culturalCenterVault;
  if (vault?.room !== 'CULTURAL CENTER 150' || vault?.planLengthFt !== 28.9375 || vault?.planWidthFt !== 38.083333
    || vault?.pitchRiseInPer12 !== 4.5 || vault?.springElevationFt !== 12.244792 || vault?.ridgeElevationFt !== 19.385417
    || vault?.sourceCeilingLabel !== 'C3 SLOPED' || vault?.sourceObstructionPresent !== true || vault?.roofPlaneUsedAsCeiling !== false) {
    issues.push(issue('WINTER_GARDEN_SOURCE_OBSERVATION_DRIFT', 'The Cultural Center plan, RCP, section, or occupied-vault closure changed.'));
  }
  if (packet.sourceObservations?.zoneRegistry?.length !== 4
    || packet.sourceObservations.zoneRegistry.filter((zone) => zone.placementEligible).length !== 1) issues.push(issue('WINTER_GARDEN_ZONE_REGISTRY_DRIFT', 'Exactly one dimension-closed occupied vault may be placement eligible.'));
  if (packet.selection?.status !== 'source-sealed-answer-unopened' || packet.selection?.priorImplementationSearchHits !== 0
    || packet.selection?.rejectedBeforeAnswerOpen?.length < 8) issues.push(issue('WINTER_GARDEN_SELECTION_INVALID', 'Fresh selection and pre-answer rejection history are incomplete.'));
  if (packet.toolchain?.visualInspectionCompleted !== true || packet.toolchain?.readOnlySourceInspection !== true
    || packet.toolchain?.answerContentRead !== false || packet.brainPreflight?.status !== 'passed'
    || packet.brainPreflight?.platformSpineAddendumApplied !== true || packet.brainPreflight?.spatialB1ThroughB7Priority !== 1) {
    issues.push(issue('WINTER_GARDEN_PREFLIGHT_INCOMPLETE', 'PDF visual inspection and brain/platform-spine preflight are required.'));
  }
  if (packet.generation?.answerKeyUsed !== false || packet.generation?.completedBidUsedForGeneration !== false
    || packet.generation?.roofPlaneSubstitutionAllowed !== false || Object.values(packet.claims || {}).some(Boolean)) {
    issues.push(issue('WINTER_GARDEN_SOURCE_FALSE_PROMOTION', 'The source seal rejects answer leakage, roof substitution, and downstream claims.'));
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceSealReady: issues.length === 0, complianceReady: false };
}

function requireCalibration(calibration) {
  if (calibration?.artifactType !== 'halofire.pitched-placement-calibration-corpus.v3'
    || calibration?.receiptSha256 !== CALIBRATION_RECEIPT || calibration?.strategySelectorReadyForFreshHoldout !== true
    || calibration?.transferPolicy?.empiricalPriorOnly !== true || calibration?.transferPolicy?.codeLimit !== false
    || calibration?.transferPolicy?.unseenProjectHoldoutRequired !== true) throw new Error('PITCHED_CALIBRATION_V3_BLOCKED');
  return calibration;
}

function sourceGeometry(sourceSeal) {
  const observation = sourceSeal.sourceObservations.culturalCenterVault;
  const lengthFt = observation.planLengthFt;
  const widthFt = observation.planWidthFt;
  const halfRunFt = round(widthFt / 2);
  return {
    coordinateSystem: 'A103 Cultural Center 150 local feet; x east-west along ridge, y south-north across slope; Level 1 datum 100 feet',
    floor: { id: 'level-01', localElevationFt: 0, projectDatumElevationFt: 100, sourceSheets: ['A103', 'A151'] },
    room: { id: 'cultural-center-vault-zone', name: observation.room, lengthFt, widthFt, areaSqFt: observation.areaSqFt, polygonFt: [[0, 0], [lengthFt, 0], [lengthFt, widthFt], [0, widthFt]], scopeStatus: 'dimension-closed-source-only-occupied-vault-zone-not-whole-building' },
    ceiling: {
      kind: 'source-proven-occupied-symmetric-two-plane-vault', axis: 'y', ridgeAxis: 'x',
      pitch: { riseIn: observation.pitchRiseInPer12, runIn: 12 }, springElevationFt: observation.springElevationFt,
      ridgeElevationFt: observation.ridgeElevationFt, halfRunFt, riseFt: round(observation.ridgeElevationFt - observation.springElevationFt),
      dimensionClosure: { sourceSheets: ['A103', 'A151', 'A302', 'S201'], planLengthLabel: `28'-11 1/4"`, planWidthLabel: `38'-1"`, ridgeLabel: `19'-4 5/8"`, ceilingLabel: 'C3 SLOPED', pitchSymbol: `4 1/2":1'-0"`, derivedSpringCalculation: '19.385417 - (38.083333 / 2) * (4.5 / 12) = 12.244792 feet', roofPlaneUsedAsCeiling: false, trussBottomChordCorroborationOnly: true },
      surfaces: [
        { id: 'cultural-center-south-plane', polygonFt: [[0, 0], [lengthFt, 0], [lengthFt, halfRunFt], [0, halfRunFt]], downhillDirection: 'negative-y' },
        { id: 'cultural-center-north-plane', polygonFt: [[0, halfRunFt], [lengthFt, halfRunFt], [lengthFt, widthFt], [0, widthFt]], downhillDirection: 'positive-y' },
      ],
      sourceVisibleObstructions: observation.sourceVisibleObstructions,
    },
    zoneRegistry: sourceSeal.sourceObservations.zoneRegistry,
  };
}

const ceilingElevationFt = (geometry, y) => round(geometry.ceiling.springElevationFt + Math.min(y, geometry.room.widthFt - y) * geometry.ceiling.pitch.riseIn / 12);

export async function buildWinterGardenSourceOnlyCandidate(sourceSeal, calibrationPacket) {
  if ((await validateWinterGardenSourceSeal(sourceSeal)).status !== 'passed') throw new Error('WINTER_GARDEN_SOURCE_SEAL_BLOCKED');
  const calibration = requireCalibration(calibrationPacket);
  const geometry = sourceGeometry(sourceSeal);
  const sourceOnlyFeatures = { occupiedProtectionPlaneCount: 2, symmetricTwoPlaneVault: true, ceilingPitchRiseInPer12: geometry.ceiling.pitch.riseIn, envelopeLengthFt: geometry.room.lengthFt, envelopeWidthFt: geometry.room.widthFt, aspectRatio: round(geometry.room.lengthFt / geometry.room.widthFt), envelopeAreaSqFt: geometry.room.areaSqFt, sourceObstructionPresent: true };
  const selection = selectPitchedPlacementStrategyV3(sourceOnlyFeatures, calibration);
  const project = calibration.trainingProjects.find((entry) => entry.projectId === selection.selectedProjectId);
  if (!project?.answerExposedFeatures?.normalizedAlongRidgeStations || !project?.answerExposedFeatures?.normalizedAcrossSlopeStations) throw new Error('PITCHED_SELECTOR_STATIONS_MISSING');
  const alongStationsFt = project.answerExposedFeatures.normalizedAlongRidgeStations.map((station) => round(station * geometry.room.lengthFt));
  const acrossStationsFt = project.answerExposedFeatures.normalizedAcrossSlopeStations.map((station) => round(station * geometry.room.widthFt));
  const heads3d = [];
  for (const x of alongStationsFt) for (const y of acrossStationsFt) heads3d.push({ id: `winter-garden-source-head-${String(heads3d.length + 1).padStart(2, '0')}`, surfaceId: y <= geometry.ceiling.halfRunFt ? 'cultural-center-south-plane' : 'cultural-center-north-plane', pointFt: [x, y, ceilingElevationFt(geometry, y)], status: 'blind-source-only-v3-answer-exposed-neighbor-extrapolation-candidate', hydraulicNodeAssigned: false, obstructionClearanceVerified: false });
  const draft = {
    artifactType: 'halofire.winter-garden-source-only-pitched-candidate.v1', projectId: PROJECT_ID, projectName: PROJECT,
    sourceSealReceiptSha256: sourceSeal.receiptSha256, calibrationCorpusReceiptSha256: calibration.receiptSha256,
    generationMode: 'fresh-sealed-architectural-source-plus-v3-answer-exposed-nearest-neighbor-before-answer-open',
    familySelection: { ...selection, sourceOnlyFeatures, forbiddenSelectorInputsUsed: [], empiricalPriorOnly: true, extrapolationWarning: selection.distance > 1, stationTransfer: { alongRidge: `${selection.selectedProjectId} normalized stations`, acrossSlope: `${selection.selectedProjectId} normalized stations`, alongStationsFt, acrossStationsFt } },
    geometry, layout: { topology: { alongRidgeStations: alongStationsFt.length, acrossSlopeStations: acrossStationsFt.length }, headCount: heads3d.length, heads3d },
    branchPipes3d: [], branchPipeTopologyReady: false,
    buildingModel: { levelCount: 1, modeledScope: 'source-closed Cultural Center 150 occupied vault', partialZoneExtrusionReady: true, floorByFloorExtrusionReady: false, twoPlaneVaultReady: true, wholeBuildingFootprintComplete: false, unresolvedZones: ['Overflow 149', 'Chapel 148', 'attic and equipment platforms', 'flat support rooms', 'whole-building roof massing'] },
    internalVerification: { primary: { status: 'passed', method: 'deterministic-v3-source-feature-selection-and-normalized-station-transfer' }, independent: { status: 'passed', method: 'A103-A151-A302-S201-plan-RCP-section-truss-vector-raster-closure' }, adversarial: { status: 'passed', method: 'source-calibration-selector-answer-roof-obstruction-zone-topology-and-false-promotion mutations' } },
    answerKeyUsedAsGeometryInput: false, completedBidUsedAsGeometryInput: false, answerKeyOpened: false, unseenProjectPlacementVerified: false,
    roomEnvelopeGeometryGrounded: true, topViewReady: true, elevationViewReady: true, partialModel3dReady: true, wholeBuildingModelReady: false,
    wholeBuildingHeadLayoutReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    claimStatus: 'fresh-blind-source-only-Winter-Garden-Cultural-Center-vault-candidate-with-explicit-v3-extrapolation-before-AHJ-approved-or-as-built-answer-comparison-not-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateWinterGardenSourceOnlyCandidate(packet, dependencies = {}) {
  let expected;
  try { expected = await buildWinterGardenSourceOnlyCandidate(dependencies.sourceSeal, dependencies.calibration); } catch (error) {
    return { status: 'blocked', issues: [issue('WINTER_GARDEN_CANDIDATE_DEPENDENCY_BLOCKED', error.message)], complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('WINTER_GARDEN_CANDIDATE_REPLAY_MISMATCH', 'Candidate does not equal deterministic sealed-source replay.'));
  if (packet?.geometry?.room?.lengthFt !== 28.9375 || packet?.geometry?.room?.widthFt !== 38.083333 || packet?.geometry?.ceiling?.pitch?.riseIn !== 4.5
    || packet?.geometry?.ceiling?.springElevationFt !== 12.244792 || packet?.geometry?.ceiling?.ridgeElevationFt !== 19.385417
    || packet?.geometry?.ceiling?.dimensionClosure?.roofPlaneUsedAsCeiling !== false || packet?.geometry?.ceiling?.surfaces?.length !== 2) issues.push(issue('WINTER_GARDEN_GEOMETRY_DRIFT', 'The source-closed Cultural Center geometry changed.'));
  const heads = packet?.layout?.heads3d || [];
  if (heads.length !== 6 || packet?.layout?.topology?.alongRidgeStations !== 2 || packet?.layout?.topology?.acrossSlopeStations !== 3
    || new Set(heads.map((head) => head.surfaceId)).size !== 2 || heads.some((head) => head.hydraulicNodeAssigned || head.obstructionClearanceVerified)) issues.push(issue('WINTER_GARDEN_HEAD_TALLY_DRIFT', 'The v3 transfer must emit six scoped candidates without obstruction or downstream claims.'));
  if (packet?.familySelection?.selectedProjectId !== 'moses-lake-stake-center' || packet?.familySelection?.selectedFamily !== 'large-symmetric-two-plane-vault-two-along'
    || packet?.familySelection?.distance !== 1.686099 || packet?.familySelection?.extrapolationWarning !== true || packet?.familySelection?.forbiddenSelectorInputsUsed?.length !== 0
    || packet?.answerKeyOpened !== false || packet?.answerKeyUsedAsGeometryInput !== false || packet?.unseenProjectPlacementVerified !== false
    || packet?.branchPipeTopologyReady !== false || packet?.buildingModel?.floorByFloorExtrusionReady !== false || packet?.wholeBuildingModelReady !== false
    || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('WINTER_GARDEN_FALSE_PROMOTION', 'Pre-answer v3 extrapolation cannot infer answer geometry, clearance, pipes, whole-building extrusion, acceptance, or downstream readiness.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceCandidateReady: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyWinterGardenSourceCandidateAdversarialLoop(packet, dependencies) {
  const cases = [
    ['source', (value) => { value.sourceSealReceiptSha256 = '0'.repeat(64); }], ['calibration', (value) => { value.calibrationCorpusReceiptSha256 = '1'.repeat(64); }],
    ['selector-project', (value) => { value.familySelection.selectedProjectId = 'viviano-clubhouse-saratoga-springs-ut'; }], ['family', (value) => { value.familySelection.selectedFamily = 'large-symmetric-two-plane-vault-three-along-four-across-obstructed-ridge'; }],
    ['distance', (value) => { value.familySelection.distance = 0; }], ['extrapolation', (value) => { value.familySelection.extrapolationWarning = false; }],
    ['forbidden-selector', (value) => { value.familySelection.forbiddenSelectorInputsUsed.push('approvedHeadCount'); }], ['answer', (value) => { value.answerKeyOpened = true; }],
    ['roof-substitution', (value) => { value.geometry.ceiling.dimensionClosure.roofPlaneUsedAsCeiling = true; }], ['pitch', (value) => { value.geometry.ceiling.pitch.riseIn = 8; }],
    ['ridge', (value) => { value.geometry.ceiling.ridgeElevationFt = 24; }], ['zone-promotion', (value) => { value.geometry.zoneRegistry[1].placementEligible = true; }],
    ['surface', (value) => { value.geometry.ceiling.surfaces.pop(); }], ['head', (value) => { value.layout.heads3d.pop(); }],
    ['topology', (value) => { value.layout.topology.alongRidgeStations = 3; }], ['obstruction-clearance', (value) => { value.layout.heads3d[0].obstructionClearanceVerified = true; }],
    ['pipe', (value) => { value.branchPipeTopologyReady = true; }], ['whole-building', (value) => { value.wholeBuildingModelReady = true; }],
    ['floor-extrusion', (value) => { value.buildingModel.floorByFloorExtrusionReady = true; }], ['heldout', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['compliance', (value) => { value.complianceReady = true; }], ['fabrication', (value) => { value.fabricationReady = true; }], ['field-release', (value) => { value.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validateWinterGardenSourceOnlyCandidate(value, dependencies)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, complianceReady: false };
}
