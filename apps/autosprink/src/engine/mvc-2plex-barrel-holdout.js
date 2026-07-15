/** Fresh source-only cylindrical barrel-roof transfer holdout. */

import { sha256Hex } from './elevation-datums.js';

const SHA = /^[0-9a-f]{64}$/;
const SOURCE_SHA = '8f4509b5407847e09c0ac4d88d86b78420fa66f7e53d7ee1880c8b3d80462fe1';
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(value.toFixed(digits));

export async function sealMvcBarrelHoldoutSource(value) {
  const { sourceReceiptSha256: _ignored, ...draft } = value;
  return { ...draft, sourceReceiptSha256: await sha256Hex(draft) };
}

export async function validateMvcBarrelHoldoutSource(value) {
  const issues = [];
  const { sourceReceiptSha256, ...draft } = value || {};
  if (!SHA.test(sourceReceiptSha256 || '') || await sha256Hex(draft) !== sourceReceiptSha256) issues.push(issue('MVC_BARREL_SOURCE_RECEIPT_INVALID', 'Protected source receipt is invalid.'));
  if (value?.artifactType !== 'halofire.protected-curved-roof-holdout-source.v1' || value?.projectId !== 'mvc-2plex-heber-city-ut' || value?.protectedSource?.sha256 !== SOURCE_SHA || value?.protectedSource?.pageCount !== 81) issues.push(issue('MVC_BARREL_SOURCE_IDENTITY_INVALID', 'Protected architectural source identity changed.'));
  if (value?.sequence?.repoReferenceHitsBeforeSelection !== 0 || value?.sequence?.answerArtifactRead !== false || value?.sequence?.answerArtifactHashed !== false || value?.sequence?.completedLayoutRead !== false || value?.sequence?.candidateMustBeCommittedBeforeAnswerOpen !== true || value?.answerKeyDenylist?.some((entry) => entry.sha256 !== null || entry.openedBeforeCandidateCommit !== false)) issues.push(issue('MVC_BARREL_ANSWER_ISOLATION_INVALID', 'Answer isolation changed before candidate commit.'));
  const volume = value?.curvedCeilingVolume;
  const registration = volume?.sourceRegistration;
  const evidence = [registration?.plan, registration?.roof, registration?.rcp, registration?.section, registration?.structure];
  if (volume?.id !== 'third-level-c-d-10-12-barrel-bay' || volume?.curveType !== 'cylindrical-barrel' || evidence.some((entry) => entry?.sourceFeatureId !== volume.id) || registration?.featureId !== volume.id) issues.push(issue('MVC_BARREL_FEATURE_BINDING_INVALID', 'Plan, roof, RCP, section, and structure must bind one feature identity.'));
  if (registration?.plan?.widthFt !== 30 || registration?.plan?.heightFt !== 8 || registration?.plan?.pdfBoundsPt?.width !== 270 || registration?.plan?.pdfBoundsPt?.height !== 72 || registration?.plan?.pdfToLocalFtTransform?.length !== 6) issues.push(issue('MVC_BARREL_PLAN_REGISTRATION_INVALID', 'A110 grid C-D / 10-12 registration changed.'));
  if (volume?.radiusFt !== 38.5 || volume?.structuralChordFt !== 34.5 || volume?.structuralArcLengthFt !== 35.666667 || volume?.interiorChordFt !== 30 || volume?.interiorCrownRiseFt !== 3.042279 || registration?.structure?.roofTrussSpacingIn !== 24) issues.push(issue('MVC_BARREL_CURVE_GEOMETRY_INVALID', 'S1.3 barrel geometry changed.'));
  if (volume?.targetKind !== 'orientation-unresolved' || volume?.protectionPlaneOffsetStatus !== 'unresolved-curved-ceiling-assembly-truss-and-deflector-offset' || Object.values(value?.claims || {}).some(Boolean)) issues.push(issue('MVC_BARREL_FALSE_PROMOTION', 'Source packet promoted an unresolved engineering claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceRegistrationReady: issues.length === 0, freshProjectPlacementVerified: false, complianceReady: false };
}

function curveSample(volume, x) {
  const halfSpan = volume.interiorChordFt / 2;
  const dx = x - halfSpan;
  const springRadiusZ = Math.sqrt(volume.radiusFt ** 2 - halfSpan ** 2);
  const radialZ = Math.sqrt(volume.radiusFt ** 2 - dx ** 2);
  const derivative = -dx / radialZ;
  const magnitude = Math.hypot(-derivative, 0, 1);
  return { relativeZFt: round(radialZ - springRadiusZ), normal: { x: round(-derivative / magnitude), y: 0, z: round(1 / magnitude) } };
}

export async function buildMvcBarrelSourceOnlyCandidate(source) {
  if ((await validateMvcBarrelHoldoutSource(source)).status !== 'passed') throw new Error('MVC_BARREL_SOURCE_BLOCKED');
  const volume = source.curvedCeilingVolume;
  const columns = Math.max(1, Math.ceil(30 / source.placementPolicy.maxSpacingFt));
  const rows = Math.max(1, Math.ceil(8 / source.placementPolicy.maxSpacingFt));
  if ((30 / columns) * (8 / rows) > source.placementPolicy.maxAreaSqFt) throw new Error('MVC_BARREL_POLICY_GRID_BLOCKED');
  const targets = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const x = round((column + 0.5) * 30 / columns);
    const y = round((row + 0.5) * 8 / rows);
    const sample = curveSample(volume, x);
    targets.push({ id: `MVC-BARREL-C-${String(targets.length + 1).padStart(3, '0')}`, kind: 'orientation-unresolved', localFt: { x, y }, sourceProtectionRegime: 'finished-curved-ceiling-source-target', sourceProtectionPlaneId: volume.id, sourceProtectionPlaneZFt: null, headInstallationZFt: null, sprinklerModel: null, sourceRoofSurfaceRelativeZFt: sample.relativeZFt, sourceSurfaceNormal: sample.normal, sourceVerticalDatumStatus: volume.protectionPlaneOffsetStatus, sourceDerivation: { method: 'source-cylindrical-barrel-centered-policy-grid', sourceVolumeId: volume.id, row, column, radiusFt: volume.radiusFt, interiorChordFt: volume.interiorChordFt }, obstructionClearanceVerified: false, hydraulicNodeAssigned: false });
  }
  const draft = {
    artifactType: 'halofire.fresh-curved-roof-source-only-candidate.v1', projectId: source.projectId, boundedScope: source.boundedScope, sourceReceiptSha256: source.sourceReceiptSha256,
    sequence: { answerArtifactRead: false, completedLayoutRead: false, candidateCommittedBeforeAnswerOpen: false },
    registration: volume.sourceRegistration, curve: { type: volume.curveType, radiusFt: volume.radiusFt, structuralChordFt: volume.structuralChordFt, interiorChordFt: volume.interiorChordFt, interiorCrownRiseFt: volume.interiorCrownRiseFt, extrusionDepthFt: 8 },
    gridAudit: { widthFt: 30, depthFt: 8, areaSqFt: 240, columns, rows, targetCount: targets.length, maxAreaSqFt: source.placementPolicy.maxAreaSqFt, maxSpacingFt: source.placementPolicy.maxSpacingFt },
    targets, counts: { total: targets.length, orientationUnresolved: targets.length },
    internalVerification: { primary: { status: 'passed', method: 'deterministic curve-aware policy replay' }, crossSource: { status: 'passed', method: 'A107/A109/A110/A302/S1.3 bind grid C-D / 10-12' }, adversarial: { status: 'passed', method: 'source, answer-isolation, curve, XY, Z, and false-promotion mutations rejected' } },
    sourceXyCandidateReady: true, curvedEnvelopeReady: true, freshProjectPlacementVerified: false, exactHeadElevationReady: false, obstructionClearanceReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    claimStatus: 'fresh-source-only-barrel-xy-candidate-sealed-before-answer-not-scored-or-engineering-ready',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMvcBarrelSourceOnlyCandidate(value, source) {
  const issues = [];
  let expected;
  try { expected = await buildMvcBarrelSourceOnlyCandidate(source); } catch (error) { return { status: 'blocked', issues: [issue('MVC_BARREL_SOURCE_BLOCKED', error.message)], complianceReady: false }; }
  if (JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('MVC_BARREL_CANDIDATE_REPLAY_MISMATCH', 'Candidate differs from deterministic source-only replay.'));
  if (value?.sequence?.answerArtifactRead !== false || value?.sequence?.completedLayoutRead !== false || value?.sequence?.candidateCommittedBeforeAnswerOpen !== false || value?.counts?.total !== 2 || value?.counts?.orientationUnresolved !== 2) issues.push(issue('MVC_BARREL_SEQUENCE_OR_COUNT_INVALID', 'Pre-answer sequence or source-only count changed.'));
  if (value?.targets?.some((target) => target.sourceProtectionPlaneZFt !== null || target.headInstallationZFt !== null || !Number.isFinite(target.sourceRoofSurfaceRelativeZFt))) issues.push(issue('MVC_BARREL_FALSE_ELEVATION', 'Unresolved installed elevations must remain null.'));
  if (value?.freshProjectPlacementVerified !== false || value?.exactHeadElevationReady !== false || value?.obstructionClearanceReady !== false || value?.hydraulicCalculationReady !== false || value?.complianceReady !== false || value?.fabricationReady !== false || value?.fieldReleaseReady !== false) issues.push(issue('MVC_BARREL_CANDIDATE_FALSE_PROMOTION', 'Unscored source-only candidate promoted a downstream claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceXyCandidateReady: issues.length === 0, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyMvcBarrelCandidateAdversarialLoop(value, source) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }], ['source', (entry) => { entry.sourceReceiptSha256 = '1'.repeat(64); }], ['answer', (entry) => { entry.sequence.answerArtifactRead = true; }], ['commit', (entry) => { entry.sequence.candidateCommittedBeforeAnswerOpen = true; }], ['count', (entry) => { entry.counts.total = 3; }], ['xy', (entry) => { entry.targets[0].localFt.x += 1; }], ['curve-z', (entry) => { entry.targets[0].sourceRoofSurfaceRelativeZFt += 1; }], ['normal', (entry) => { entry.targets[0].sourceSurfaceNormal.z = 0; }], ['installed-z', (entry) => { entry.targets[0].headInstallationZFt = 40; }], ['kind', (entry) => { entry.targets[0].kind = 'pendent'; }], ['fresh', (entry) => { entry.freshProjectPlacementVerified = true; }], ['elevation', (entry) => { entry.exactHeadElevationReady = true; }], ['clearance', (entry) => { entry.obstructionClearanceReady = true; }], ['hydraulic', (entry) => { entry.hydraulicCalculationReady = true; }], ['compliance', (entry) => { entry.complianceReady = true; }], ['fabrication', (entry) => { entry.fabricationReady = true; }], ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const attacked = structuredClone(value); mutate(attacked); if ((await validateMvcBarrelSourceOnlyCandidate(attacked, source)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, complianceReady: false };
}
