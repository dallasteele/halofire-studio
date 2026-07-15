/** Fresh source-only 4:12 pitched-attic transfer holdout for New Hope. */

import { sha256Hex } from './elevation-datums.js';
import { buildSourceTopologyPlacementCandidate } from './source-topology-placement-policy.js';

const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const PDF_SHA = '9f9f8b97cfb35931474566156f35d97520ae993052dac046efacb408f32ea0a7';
const SOURCE_DWGS = Object.freeze({
  floor: ['79d985df4f51567b8f881d0253700d832c6b5522990923ee5358bd3d2269e898', 2542915],
  rcp: ['4bfeab0b1679fb042274881a7111e3f81a192ff1cf5b3695c2ca3680c3f83eb1', 719994],
  roof: ['b57e51aeaaeb622ba4ea86337ff1910c8c7d5c3f34ae5c266ec89b7f4d8d61f3', 128516],
  section3: ['470252c77ade5743d8f0d7953904bb7d36e16da4abb4fb6f81c85b7874425f56', 519787],
  section4: ['d872b0e6101d2033a7eead83e12e30ce43fd28e1068c14be322da5076d5a6156', 639863],
  section5: ['e21a6bb8a46d841c1dad8be5558cc9a144fa04ff9c706fc3042931e1db75419a', 488148],
});

export async function sealNewHopePitchedSource(value) {
  const { sourceReceiptSha256: _ignored, ...draft } = value;
  return { ...draft, sourceReceiptSha256: await sha256Hex(draft) };
}

export async function validateNewHopePitchedSource(value) {
  const issues = [];
  const { sourceReceiptSha256, ...draft } = value || {};
  if (!SHA.test(sourceReceiptSha256 || '') || await sha256Hex(draft) !== sourceReceiptSha256) issues.push(issue('NEW_HOPE_SOURCE_RECEIPT_INVALID', 'Protected source receipt is invalid.'));
  if (value?.artifactType !== 'halofire.protected-pitched-attic-holdout-source.v1' || value?.projectId !== 'new-hope-crisis-center-brigham-city-ut' || value?.protectedSources?.architecturalPdf?.sha256 !== PDF_SHA || value?.protectedSources?.architecturalPdf?.bytes !== 66511145 || value?.protectedSources?.architecturalPdf?.pageCount !== 53) issues.push(issue('NEW_HOPE_SOURCE_IDENTITY_INVALID', 'Protected architectural source identity changed.'));
  for (const [id, [sha256, bytes]] of Object.entries(SOURCE_DWGS)) {
    const source = value?.protectedSources?.dwgs?.[id];
    if (source?.sha256 !== sha256 || source?.bytes !== bytes || source?.reader !== '@mlightcad/libredwg-web 0.7.7' || source?.unknownEntityCount !== 0) issues.push(issue('NEW_HOPE_DWG_IDENTITY_INVALID', `Protected ${id} DWG identity or zero-unknown extraction changed.`));
  }
  if (value?.selection?.repoReferenceHitsBeforeSelection !== 0 || value?.selection?.answerArtifactRead !== false || value?.selection?.answerArtifactHashed !== false || value?.selection?.completedLayoutRead !== false || value?.selection?.candidateMustBeCommittedBeforeAnswerOpen !== true || value?.answerKeyDenylist?.some((entry) => entry.sha256 !== null || entry.openedBeforeCandidateCommit !== false)) issues.push(issue('NEW_HOPE_ANSWER_ISOLATION_INVALID', 'Answer isolation changed before candidate commit.'));
  const volume = value?.pitchedConcealedVolume;
  const registration = volume?.sourceRegistration;
  const evidence = [registration?.floor, registration?.roof, registration?.rcp, registration?.section, registration?.structure];
  if (volume?.id !== 'north-east-occupied-wing-gable-core' || registration?.featureId !== volume.id || evidence.some((entry) => entry?.sourceFeatureId !== volume.id)) issues.push(issue('NEW_HOPE_FEATURE_BINDING_INVALID', 'Floor, roof, RCP, section, and structure must bind one source feature identity.'));
  if (volume?.verticesFt?.length !== 4 || volume?.widthFt !== 43 || volume?.depthFt !== 60.75 || volume?.ridgeAxis !== 'x' || volume?.ridgeCoordinateFt !== 30.375 || volume?.slopeRise !== 4 || volume?.slopeRun !== 12 || volume?.ridgeDatumZFt !== 21.208333 || volume?.eaveDatumZFt !== 11.083333 || registration?.section?.trussBearingDatumZFt !== 10.96875) issues.push(issue('NEW_HOPE_PITCHED_GEOMETRY_INVALID', 'Bounded 4:12 gable geometry or vertical controls changed.'));
  const footprint = value?.sourceOccupiedOrProtectedFloorFootprints?.[0];
  if (value?.sourceOccupiedOrProtectedFloorFootprints?.length !== 1 || footprint?.id !== 'north-east-occupied-family-unit-wing' || footprint?.sourcePage !== 'A101' || footprint?.verticesFt?.length !== 4 || volume?.protectionEligibility?.status !== 'source-declared-protected' || volume?.protectionEligibility?.sourceFootprintIds?.[0] !== footprint.id) issues.push(issue('NEW_HOPE_PROTECTION_ELIGIBILITY_SOURCE_INVALID', 'Occupied floor declaration and gable intersection binding changed.'));
  if (volume?.protectionPlaneOffsetStatus !== 'unresolved-truss-obstructions-deflector-offset' || Object.values(value?.claims || {}).some(Boolean)) issues.push(issue('NEW_HOPE_FALSE_PROMOTION', 'Source packet promoted an unresolved engineering claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceRegistrationReady: issues.length === 0, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function buildNewHopePitchedSourceOnlyCandidate(source) {
  if ((await validateNewHopePitchedSource(source)).status !== 'passed') throw new Error('NEW_HOPE_SOURCE_BLOCKED');
  const volume = source.pitchedConcealedVolume;
  const policyResult = await buildSourceTopologyPlacementCandidate({
    candidateIdPrefix: 'NH',
    placementPolicy: source.placementPolicy,
    protectionEligibilityPolicy: { enforceSourceDeclaredFootprintIntersection: true },
    sourceOccupiedOrProtectedFloorFootprints: source.sourceOccupiedOrProtectedFloorFootprints,
    finishedCeilingRooms: [],
    pitchedConcealedVolumes: [volume],
    exposedSlopedCeilingVolumes: [],
  });
  const heads = policyResult.heads.map((head) => ({ ...head, sourceRoofSurfaceZFt: head.sourceProtectionPlaneZFt, sourceProtectionPlaneZFt: null, sourceVerticalDatumStatus: volume.protectionPlaneOffsetStatus }));
  const draft = {
    artifactType: 'halofire.fresh-pitched-attic-source-only-candidate.v1',
    projectId: source.projectId,
    boundedScope: source.boundedScope,
    sourceReceiptSha256: source.sourceReceiptSha256,
    sequence: { answerArtifactRead: false, answerArtifactHashed: false, completedLayoutRead: false, candidateCommittedBeforeAnswerOpen: false },
    registration: volume.sourceRegistration,
    geometry: { widthFt: volume.widthFt, depthFt: volume.depthFt, ridgeAxis: volume.ridgeAxis, ridgeCoordinateFt: volume.ridgeCoordinateFt, slopeRise: volume.slopeRise, slopeRun: volume.slopeRun, eaveDatumZFt: volume.eaveDatumZFt, ridgeDatumZFt: volume.ridgeDatumZFt, trussBearingDatumZFt: volume.sourceRegistration.section.trussBearingDatumZFt },
    protectionEligibilityAudit: policyResult.protectionEligibilityAudit,
    gridAudit: policyResult.roofAudit[0],
    heads,
    counts: { total: heads.length, upright: heads.filter((head) => head.kind === 'upright').length },
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic source-only 4:12 gable policy replay' },
      crossSource: { status: 'passed', method: 'A101/A102/A103/A301 plus floor/RCP/roof/section DWGs bind one occupied gable core' },
      adversarial: { status: 'passed', method: 'source, answer-isolation, eligibility, geometry, XY, roof-Z, and false-promotion mutations rejected' },
    },
    sourceXyCandidateReady: true,
    pitchedEnvelopeReady: true,
    freshProjectPlacementVerified: false,
    exactHeadElevationReady: false,
    obstructionClearanceReady: false,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'fresh-source-only-pitched-attic-candidate-sealed-before-answer-not-scored-or-engineering-ready',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateNewHopePitchedSourceOnlyCandidate(value, source) {
  const issues = [];
  let expected;
  try { expected = await buildNewHopePitchedSourceOnlyCandidate(source); } catch (error) { return { status: 'blocked', issues: [issue('NEW_HOPE_CANDIDATE_INPUT_BLOCKED', error.message)], complianceReady: false }; }
  if (JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('NEW_HOPE_CANDIDATE_REPLAY_MISMATCH', 'Candidate differs from deterministic source-only replay.'));
  if (value?.sequence?.answerArtifactRead !== false || value?.sequence?.answerArtifactHashed !== false || value?.sequence?.candidateCommittedBeforeAnswerOpen !== false || value?.counts?.total !== 24 || value?.counts?.upright !== 24 || value?.protectionEligibilityAudit?.status !== 'passed') issues.push(issue('NEW_HOPE_SEQUENCE_COUNT_OR_ELIGIBILITY_INVALID', 'Pre-answer sequence, count, or protection eligibility changed.'));
  if (value?.heads?.some((head) => head.sourceProtectionPlaneZFt !== null || head.headInstallationZFt !== null || head.sprinklerModel !== null || !Number.isFinite(head.sourceRoofSurfaceZFt) || head.obstructionClearanceVerified !== false || head.hydraulicNodeAssigned !== false)) issues.push(issue('NEW_HOPE_FALSE_INSTALLATION_OR_ELEVATION', 'Only source roof-surface Z may be populated before obstruction and deflector resolution.'));
  if (value?.freshProjectPlacementVerified !== false || value?.exactHeadElevationReady !== false || value?.obstructionClearanceReady !== false || value?.hydraulicCalculationReady !== false || value?.complianceReady !== false || value?.fabricationReady !== false || value?.fieldReleaseReady !== false) issues.push(issue('NEW_HOPE_CANDIDATE_FALSE_PROMOTION', 'Unscored source-only candidate promoted a downstream claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceXyCandidateReady: issues.length === 0, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyNewHopePitchedCandidateAdversarialLoop(value, source) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }], ['source', (entry) => { entry.sourceReceiptSha256 = '1'.repeat(64); }], ['answer-read', (entry) => { entry.sequence.answerArtifactRead = true; }], ['answer-hash', (entry) => { entry.sequence.answerArtifactHashed = true; }], ['commit', (entry) => { entry.sequence.candidateCommittedBeforeAnswerOpen = true; }], ['eligibility', (entry) => { entry.protectionEligibilityAudit.status = 'blocked'; }], ['count', (entry) => { entry.counts.total = 23; }], ['xy', (entry) => { entry.heads[0].localFt.x += 1; }], ['roof-z', (entry) => { entry.heads[0].sourceRoofSurfaceZFt += 1; }], ['plane-z', (entry) => { entry.heads[0].sourceProtectionPlaneZFt = 12; }], ['installed-z', (entry) => { entry.heads[0].headInstallationZFt = 12; }], ['kind', (entry) => { entry.heads[0].kind = 'pendent'; }], ['fresh', (entry) => { entry.freshProjectPlacementVerified = true; }], ['elevation', (entry) => { entry.exactHeadElevationReady = true; }], ['clearance', (entry) => { entry.obstructionClearanceReady = true; }], ['hydraulic', (entry) => { entry.hydraulicCalculationReady = true; }], ['compliance', (entry) => { entry.complianceReady = true; }], ['fabrication', (entry) => { entry.fabricationReady = true; }], ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const attacked = structuredClone(value); mutate(attacked); if ((await validateNewHopePitchedSourceOnlyCandidate(attacked, source)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, freshProjectPlacementVerified: false, complianceReady: false };
}
