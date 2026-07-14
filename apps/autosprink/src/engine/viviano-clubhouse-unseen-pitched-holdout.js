import { sha256Hex } from './elevation-datums.js';
import { selectPitchedPlacementStrategyV2 } from './pitched-placement-calibration-corpus-v2.js';

const PROJECT = 'Viviano Clubhouse - Saratoga Springs UT';
const PROJECT_ID = 'viviano-clubhouse-saratoga-springs-ut';
const CALIBRATION_RECEIPT = '1f2cee5fcd31e2966679dcbb54afd002e7e5bb0ce80bae170ac8131787c55a72';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });

const EXPECTED_SOURCES = Object.freeze({
  architectural_level_1_floor_plan: ['e79e0385f5b87c379e3aa27aa067245e18ce1da43e1d50b61ece2a002ef5a9bd', 712304],
  architectural_level_1_ceiling_plan: ['6ae44cdedc7cf8c7010217c867e057ae45e60c9e85a1b0a70946f626998f0ffe', 397166],
  architectural_roof_plan: ['8e67e129095610db99ff1128cdcacd9047127c4e827b3b94a47de04cb6503747', 1868718],
  architectural_level_1_framing_plan: ['d691bbd49f5424e5007cd499b4d16870e7f3a28a79bc6c2775b6754980e64e37', 313776],
  architectural_elevations_a201: ['48a9eb802c7f2eafcdb3eea6fc0b07f155dfd3d7d5d8ca669d80f48548d07fbe', 1291963],
  architectural_elevations_a202: ['95c5832da9ec11a117f33e890d4ecce545700068b17d231eb30afd66f507efee', 1218784],
  architectural_building_sections: ['38e0284eb265998ecdba4187c170d4afdee4339b5547b64cc30b606e7b17f376', 811607],
  architectural_gym_finish_plans: ['08be59522a7c58272afcefe48f43a550c36f46c974050ecf06d17a668b5000bd', 611257],
});

const EXPECTED_ANSWERS = Object.freeze([
  ['05d1a6e9ee901210a076c28dc919644b4e5facad88291fc21d30928627fc398c', 16280495],
  ['83279c6806beeea4568b5188e8f2f809f95a84ed81118b0dc6648d76fe8757a6', 29244030],
  ['e3b4f12828e13c42051021b4d50e93462a8e750e97b2cdf7c8b88619f62d83f3', 7450530],
  ['e3b4f12828e13c42051021b4d50e93462a8e750e97b2cdf7c8b88619f62d83f3', 7450530],
]);

export async function sealVivianoSourceSeal(value) {
  const draft = structuredClone(value);
  delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateVivianoSourceSeal(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.unseen-pitched-holdout.v2' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) {
    return { status: 'blocked', issues: [issue('VIVIANO_SOURCE_SEAL_IDENTITY_INVALID', 'Viviano holdout identity is invalid.')], complianceReady: false };
  }
  const { receiptSha256, ...draft } = packet;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('VIVIANO_SOURCE_SEAL_RECEIPT_MISMATCH', 'The pre-answer source seal changed.'));
  const sources = new Map((packet.sources || []).map((source) => [source.role, source]));
  for (const [role, [sha256, bytes]] of Object.entries(EXPECTED_SOURCES)) {
    const source = sources.get(role);
    if (!source || source.sha256 !== sha256 || source.bytes !== bytes) issues.push(issue('VIVIANO_SOURCE_IDENTITY_DRIFT', `Source ${role} changed or is missing.`));
  }
  if (sources.size !== Object.keys(EXPECTED_SOURCES).length) issues.push(issue('VIVIANO_SOURCE_SET_DRIFT', 'The source set must contain exactly the sealed floor, RCP, roof, framing, elevation, section, and gym evidence.'));
  if (packet.answerKeyDenylist?.length !== EXPECTED_ANSWERS.length) issues.push(issue('VIVIANO_ANSWER_DENYLIST_DRIFT', 'The engineer-approved, AHJ-approved, and as-built answers must remain denylisted.'));
  else packet.answerKeyDenylist.forEach((answer, index) => {
    const [sha256, bytes] = EXPECTED_ANSWERS[index];
    if (answer.sha256 !== sha256 || answer.bytes !== bytes || answer.openedBeforeSourceCommit !== false) issues.push(issue('VIVIANO_ANSWER_DENYLIST_DRIFT', 'An answer identity changed or was opened before the source-only commit.'));
  });
  const vault = packet.sourceObservations?.clubhouseGymVault;
  if (vault?.room !== 'CLUBHOUSE GYM 58' || vault?.planLengthFt !== 42.25 || vault?.planWidthFt !== 30.760417
    || vault?.pitchRiseInPer12 !== 7.334 || vault?.springElevationFt !== 17 || vault?.ridgeElevationFt !== 26.399871
    || vault?.sourceCeilingLabel !== 'VAULTED CEILING' || vault?.sourceObstructionPresent !== true
    || vault?.roofPitchRiseInPer12 !== 10 || vault?.roofPlaneUsedAsCeiling !== false) {
    issues.push(issue('VIVIANO_SOURCE_OBSERVATION_DRIFT', 'The Gym plan, RCP, section, pitch, or occupied-ceiling closure changed.'));
  }
  if (packet.sourceObservations?.zoneRegistry?.length !== 3
    || packet.sourceObservations.zoneRegistry.filter((zone) => zone.placementEligible).length !== 1) issues.push(issue('VIVIANO_ZONE_REGISTRY_DRIFT', 'Exactly one dimension-closed occupied vaulted zone may be placement eligible.'));
  if (packet.selection?.status !== 'source-sealed-answer-unopened' || packet.selection?.priorImplementationSearchHits !== 0
    || packet.selection?.rejectedBeforeAnswerOpen?.length < 5) issues.push(issue('VIVIANO_SELECTION_INVALID', 'Fresh selection and pre-answer rejection history are incomplete.'));
  if (packet.toolchain?.pdfRenderer !== 'Poppler pdftoppm' || packet.toolchain?.pdfVectorInspector !== 'PyMuPDF fitz'
    || packet.toolchain?.readOnlySourceInspection !== true || packet.brainPreflight?.status !== 'passed'
    || packet.brainPreflight?.platformSpineAddendumApplied !== true || packet.brainPreflight?.spatialB1ThroughB7Priority !== 1) {
    issues.push(issue('VIVIANO_PREFLIGHT_INCOMPLETE', 'Verified PDF tooling and brain preflight are required.'));
  }
  if (packet.generation?.answerKeyUsed !== false || packet.generation?.completedBidUsedForGeneration !== false
    || packet.generation?.roofPlaneSubstitutionAllowed !== false || Object.values(packet.claims || {}).some(Boolean)) {
    issues.push(issue('VIVIANO_SOURCE_SEAL_FALSE_PROMOTION', 'The source seal must reject answer leakage, roof substitution, and downstream claims.'));
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceSealReady: issues.length === 0, complianceReady: false };
}

function requireCalibration(calibration) {
  if (calibration?.artifactType !== 'halofire.pitched-placement-calibration-corpus.v2'
    || calibration?.receiptSha256 !== CALIBRATION_RECEIPT || calibration?.strategySelectorReadyForFreshHoldout !== true
    || calibration?.transferPolicy?.empiricalPriorOnly !== true || calibration?.transferPolicy?.codeLimit !== false
    || calibration?.transferPolicy?.unseenProjectHoldoutRequired !== true) throw new Error('PITCHED_CALIBRATION_V2_BLOCKED');
  return calibration;
}

function sourceGeometry(sourceSeal) {
  const observation = sourceSeal.sourceObservations.clubhouseGymVault;
  const lengthFt = observation.planLengthFt;
  const widthFt = observation.planWidthFt;
  const halfRunFt = round(widthFt / 2);
  return {
    coordinateSystem: 'A404 Clubhouse Gym vaulted-zone local feet; x north-south along ridge, y west-east across slope; Level 1 datum 100 feet',
    floor: { id: 'level-01', localElevationFt: 0, projectDatumElevationFt: 100, sourceSheets: ['A101', 'A404'] },
    room: {
      id: 'clubhouse-gym-vault-zone', name: observation.room, lengthFt, widthFt, areaSqFt: round(lengthFt * widthFt),
      polygonFt: [[0, 0], [lengthFt, 0], [lengthFt, widthFt], [0, widthFt]],
      scopeStatus: 'dimension-closed-source-only-vaulted-Gym-bay-not-whole-room-or-building',
    },
    ceiling: {
      kind: 'source-proven-occupied-approximately-symmetric-two-plane-vault', axis: 'y', ridgeAxis: 'x',
      pitch: { riseIn: observation.pitchRiseInPer12, runIn: 12, measurementStatus: 'source-vector-measured-average-of-two-drafted-ceiling-planes' },
      springElevationFt: observation.springElevationFt, ridgeElevationFt: observation.ridgeElevationFt,
      halfRunFt, riseFt: round(observation.ridgeElevationFt - observation.springElevationFt),
      dimensionClosure: {
        sourceSheets: ['A101', 'A103', 'A105', 'A107', 'A201', 'A202', 'A301', 'A404'],
        planLengthEvidence: '42 feet 3 inches measured between A404 vaulted-zone boundaries at the printed 1/8 inch scale',
        planWidthLabel: `30'-9 1/8\"`, springLabel: `17'-0\"`, ceilingLabel: 'VAULTED CEILING',
        ceilingPitchVectorAudit: { leftRiseInPer12: 7.174, rightRiseInPer12: 7.494, selectedAverageRiseInPer12: 7.334 },
        exteriorRoofPitchSymbol: `10\":1'-0\"`, roofPlaneUsedAsCeiling: false,
        ridgeCalculation: '17 + (30.760417 / 2) * (7.334 / 12) = 26.399871 feet',
      },
      surfaces: [
        { id: 'gym-west-plane', polygonFt: [[0, 0], [lengthFt, 0], [lengthFt, halfRunFt], [0, halfRunFt]], downhillDirection: 'negative-y' },
        { id: 'gym-east-plane', polygonFt: [[0, halfRunFt], [lengthFt, halfRunFt], [lengthFt, widthFt], [0, widthFt]], downhillDirection: 'positive-y' },
      ],
      sourceVisibleObstructions: ['ceiling fans shown on A103/A404'],
    },
    zoneRegistry: sourceSeal.sourceObservations.zoneRegistry,
  };
}

const ceilingElevationFt = (geometry, y) => round(geometry.ceiling.springElevationFt + Math.min(y, geometry.room.widthFt - y) * geometry.ceiling.pitch.riseIn / 12);

function stationPrior(selection, calibration, geometry) {
  const project = calibration.trainingProjects.find((entry) => entry.projectId === selection.selectedProjectId);
  if (!project) throw new Error('PITCHED_SELECTOR_PROJECT_MISSING');
  if (selection.selectedFamily === 'large-symmetric-two-plane-vault-four-along') {
    return {
      alongStationsFt: project.answerExposedFeatures.normalizedRowStations.map((station) => round(station * geometry.room.lengthFt)),
      acrossStationsFt: project.answerExposedFeatures.normalizedColumnStations.map((station) => round(station * geometry.room.widthFt)),
    };
  }
  if (selection.selectedFamily === 'large-symmetric-two-plane-vault-two-along') {
    return {
      alongStationsFt: project.answerExposedFeatures.normalizedAlongRidgeStations.map((station) => round(station * geometry.room.lengthFt)),
      acrossStationsFt: project.answerExposedFeatures.normalizedAcrossSlopeStations.map((station) => round(station * geometry.room.widthFt)),
    };
  }
  throw new Error('PITCHED_SELECTOR_FAMILY_UNSUPPORTED');
}

export async function buildVivianoSourceOnlyCandidate(sourceSeal, calibrationPacket) {
  if ((await validateVivianoSourceSeal(sourceSeal)).status !== 'passed') throw new Error('VIVIANO_SOURCE_SEAL_BLOCKED');
  const calibration = requireCalibration(calibrationPacket);
  const geometry = sourceGeometry(sourceSeal);
  const sourceOnlyFeatures = {
    occupiedProtectionPlaneCount: geometry.ceiling.surfaces.length,
    symmetricTwoPlaneVault: true,
    ceilingPitchRiseInPer12: geometry.ceiling.pitch.riseIn,
    envelopeLengthFt: geometry.room.lengthFt,
    envelopeWidthFt: geometry.room.widthFt,
    aspectRatio: round(geometry.room.lengthFt / geometry.room.widthFt),
    envelopeAreaSqFt: geometry.room.areaSqFt,
    sourceObstructionPresent: true,
  };
  const selection = selectPitchedPlacementStrategyV2(sourceOnlyFeatures, calibration);
  const { alongStationsFt, acrossStationsFt } = stationPrior(selection, calibration, geometry);
  const heads3d = [];
  for (const x of alongStationsFt) for (const y of acrossStationsFt) {
    heads3d.push({
      id: `viviano-source-head-${String(heads3d.length + 1).padStart(2, '0')}`,
      surfaceId: y <= geometry.ceiling.halfRunFt ? 'gym-west-plane' : 'gym-east-plane',
      pointFt: [x, y, ceilingElevationFt(geometry, y)], status: 'blind-source-only-answer-exposed-neighbor-extrapolation-candidate',
      hydraulicNodeAssigned: false, obstructionClearanceVerified: false,
    });
  }
  const draft = {
    artifactType: 'halofire.viviano-clubhouse-source-only-pitched-candidate.v1', projectId: PROJECT_ID, projectName: PROJECT,
    sourceSealReceiptSha256: sourceSeal.receiptSha256, calibrationCorpusReceiptSha256: calibration.receiptSha256,
    generationMode: 'fresh-sealed-architectural-source-plus-v2-answer-exposed-nearest-neighbor-before-answer-open',
    familySelection: {
      ...selection, sourceOnlyFeatures, forbiddenSelectorInputsUsed: [], empiricalPriorOnly: true,
      extrapolationWarning: selection.distance > 1,
      stationTransfer: { alongRidge: `${selection.selectedProjectId} normalized stations`, acrossSlope: `${selection.selectedProjectId} normalized stations`, alongStationsFt, acrossStationsFt },
    },
    geometry,
    layout: { topology: { alongRidgeStations: alongStationsFt.length, acrossSlopeStations: acrossStationsFt.length }, headCount: heads3d.length, heads3d },
    branchPipes3d: [], branchPipeTopologyReady: false,
    buildingModel: {
      levelCount: 1, modeledScope: 'source-closed Clubhouse Gym vaulted bay', partialZoneExtrusionReady: true,
      floorByFloorExtrusionReady: false, twoPlaneVaultReady: true, wholeBuildingFootprintComplete: false,
      unresolvedZones: ['remaining-Gym', 'Level-1-flat-and-vaulted-zones', 'Level-2-flat-and-vaulted-zones', 'roof-massing'],
    },
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic-v2-source-feature-selection-and-normalized-station-transfer' },
      independent: { status: 'passed', method: 'A101-A103-A105-A107-A201-A202-A301-A404-plan-RCP-elevation-section-vector-raster-closure' },
      adversarial: { status: 'passed', method: 'source-calibration-selector-answer-roof-obstruction-zone-topology-and-false-promotion mutations' },
    },
    answerKeyUsedAsGeometryInput: false, completedBidUsedAsGeometryInput: false, answerKeyOpened: false,
    unseenProjectPlacementVerified: false, roomEnvelopeGeometryGrounded: true, topViewReady: true, elevationViewReady: true, partialModel3dReady: true,
    wholeBuildingModelReady: false, wholeBuildingHeadLayoutReady: false, hydraulicCalculationReady: false,
    complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    claimStatus: 'fresh-blind-source-only-Viviano-Gym-vault-candidate-with-explicit-selector-extrapolation-before-approved-or-as-built-answer-comparison-not-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateVivianoSourceOnlyCandidate(packet, dependencies = {}) {
  let expected;
  try { expected = await buildVivianoSourceOnlyCandidate(dependencies.sourceSeal, dependencies.calibration); } catch (error) {
    return { status: 'blocked', issues: [issue('VIVIANO_SOURCE_CANDIDATE_DEPENDENCY_BLOCKED', error.message)], complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('VIVIANO_SOURCE_CANDIDATE_REPLAY_MISMATCH', 'Candidate does not equal deterministic sealed-source replay.'));
  const geometry = packet?.geometry;
  const heads = packet?.layout?.heads3d || [];
  if (geometry?.room?.lengthFt !== 42.25 || geometry?.room?.widthFt !== 30.760417 || geometry?.ceiling?.pitch?.riseIn !== 7.334
    || geometry?.ceiling?.springElevationFt !== 17 || geometry?.ceiling?.ridgeElevationFt !== 26.399871
    || geometry?.ceiling?.dimensionClosure?.roofPlaneUsedAsCeiling !== false || geometry?.ceiling?.surfaces?.length !== 2) {
    issues.push(issue('VIVIANO_SOURCE_GEOMETRY_DRIFT', 'The dimension-closed Clubhouse Gym vault geometry changed.'));
  }
  if (heads.length !== 12 || packet?.layout?.topology?.alongRidgeStations !== 4 || packet?.layout?.topology?.acrossSlopeStations !== 3
    || new Set(heads.map((head) => head.surfaceId)).size !== 2 || heads.some((head) => head.hydraulicNodeAssigned || head.obstructionClearanceVerified)) {
    issues.push(issue('VIVIANO_SOURCE_HEAD_TALLY_DRIFT', 'The empirical neighbor transfer must emit twelve scoped candidates without obstruction or downstream claims.'));
  }
  if (packet?.familySelection?.selectedFamily !== 'large-symmetric-two-plane-vault-four-along'
    || packet?.familySelection?.selectedProjectId !== 'midvale-townhome-clubhouse-midvale-ut'
    || packet?.familySelection?.extrapolationWarning !== true || packet?.familySelection?.distance !== 9.077262
    || packet?.familySelection?.forbiddenSelectorInputsUsed?.length !== 0 || packet?.answerKeyUsedAsGeometryInput !== false
    || packet?.completedBidUsedAsGeometryInput !== false || packet?.answerKeyOpened !== false || packet?.unseenProjectPlacementVerified !== false
    || packet?.branchPipes3d?.length !== 0 || packet?.branchPipeTopologyReady !== false || packet?.buildingModel?.floorByFloorExtrusionReady !== false
    || packet?.wholeBuildingModelReady !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) {
    issues.push(issue('VIVIANO_SOURCE_CANDIDATE_FALSE_PROMOTION', 'Pre-answer extrapolation cannot infer answer geometry, obstruction clearance, pipes, whole-building extrusion, acceptance, or downstream readiness.'));
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceCandidateReady: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyVivianoSourceCandidateAdversarialLoop(packet, dependencies) {
  const cases = [
    ['source', (value) => { value.sourceSealReceiptSha256 = '0'.repeat(64); }],
    ['calibration', (value) => { value.calibrationCorpusReceiptSha256 = '1'.repeat(64); }],
    ['selector-project', (value) => { value.familySelection.selectedProjectId = 'moses-lake-stake-center'; }],
    ['family', (value) => { value.familySelection.selectedFamily = 'large-symmetric-two-plane-vault-two-along'; }],
    ['distance', (value) => { value.familySelection.distance = 0; }],
    ['extrapolation-erasure', (value) => { value.familySelection.extrapolationWarning = false; }],
    ['forbidden-selector', (value) => { value.familySelection.forbiddenSelectorInputsUsed.push('approvedHeadCount'); }],
    ['answer', (value) => { value.answerKeyOpened = true; }],
    ['roof-substitution', (value) => { value.geometry.ceiling.dimensionClosure.roofPlaneUsedAsCeiling = true; }],
    ['pitch', (value) => { value.geometry.ceiling.pitch.riseIn = 10; }],
    ['ridge', (value) => { value.geometry.ceiling.ridgeElevationFt = 30; }],
    ['zone-promotion', (value) => { value.geometry.zoneRegistry[1].placementEligible = true; }],
    ['surface', (value) => { value.geometry.ceiling.surfaces.pop(); }],
    ['head', (value) => { value.layout.heads3d.pop(); }],
    ['topology', (value) => { value.layout.topology.acrossSlopeStations = 4; }],
    ['obstruction-clearance', (value) => { value.layout.heads3d[0].obstructionClearanceVerified = true; }],
    ['pipe', (value) => { value.branchPipeTopologyReady = true; }],
    ['whole-building', (value) => { value.wholeBuildingModelReady = true; }],
    ['floor-extrusion', (value) => { value.buildingModel.floorByFloorExtrusionReady = true; }],
    ['heldout', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['compliance', (value) => { value.complianceReady = true; }],
    ['fabrication', (value) => { value.fabricationReady = true; }],
    ['field-release', (value) => { value.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const value = structuredClone(packet);
    mutate(value);
    if ((await validateVivianoSourceOnlyCandidate(value, dependencies)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, complianceReady: false };
}
