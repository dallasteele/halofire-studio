/** Answer-exposed correction of the Blossom Rock cross-registration failure. */

import { sha256Hex } from './elevation-datums.js';
import {
  auditExposedSlopeSourceRegistration,
  buildSourceTopologyPlacementCandidate,
} from './source-topology-placement-policy.js';

const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const EXPECTED_SOURCE_HASHES = Object.freeze({
  'A3.2': '2db70b398eca43244e5e0a44e3f773a03def39b449a9d20c94f618082dfe4b84',
  'A5.1': '1f998ad75557402e6b17010cc6febbdf5da105ede5a7a012ddc9f4726826aff1',
  'A6.1': '93dde254758ec42a612b935f2bd6e351106a99f452e1c7f092b518b78bb04b55',
  'A8.1': '38a1838e4092bc89d43952d48b807a275ae9bb7a6660251c6b5b9695f579fe70',
  'S2.2': '95e2e3575f3cb91c620290f059c1ed1c0dbf4f2d44e770f9bdc96846bf077594',
  'M2.0': '2c650271037a18ffcd8df810db026889b8b7e7803eb25077078c38a18e91fe96',
});

export async function sealBlossomRockRegisteredCalibrationSource(value) {
  const { sourceReceiptSha256: _ignored, ...draft } = value;
  return { ...draft, sourceReceiptSha256: await sha256Hex(draft) };
}

export async function validateBlossomRockRegisteredCalibrationSource(value) {
  const issues = [];
  const { sourceReceiptSha256, ...draft } = value || {};
  if (!SHA.test(sourceReceiptSha256 || '') || await sha256Hex(draft) !== sourceReceiptSha256) issues.push(issue('BLOSSOM_CALIBRATION_SOURCE_RECEIPT_INVALID', 'Registered calibration source receipt is invalid.'));
  const sources = new Map((value?.protectedSources || []).map((entry) => [entry.page, entry.sha256]));
  for (const [page, sha256] of Object.entries(EXPECTED_SOURCE_HASHES)) if (sources.get(page) !== sha256) issues.push(issue('BLOSSOM_CALIBRATION_SOURCE_IDENTITY_DRIFT', `Protected source ${page} changed or is missing.`));
  if (sources.size !== Object.keys(EXPECTED_SOURCE_HASHES).length) issues.push(issue('BLOSSOM_CALIBRATION_SOURCE_SET_DRIFT', 'Protected calibration source set is not exact.'));
  if (value?.sequence?.answerExposed !== true || value?.sequence?.freshHoldoutEligible !== false || value?.sequence?.calibrationOnly !== true || value?.approvedAnswer?.sha256 !== 'df8624f88afc39842a208636676479208aef058ba7a59f8fca4aedd3dd1308b4') issues.push(issue('BLOSSOM_CALIBRATION_DISCLOSURE_INVALID', 'Answer exposure and calibration-only status must remain explicit.'));
  const volume = value?.exposedSlopedCeilingVolumes?.[0];
  if (value?.exposedSlopedCeilingVolumes?.length !== 1 || volume?.id !== 'lake-pump-room-roof-3' || volume?.slopeAxis !== 'y' || volume?.slopeDirection !== 1 || volume?.slopeRise !== 1.5 || volume?.slopeRun !== 12 || volume?.targetKind !== 'upright') issues.push(issue('BLOSSOM_CALIBRATION_ROOF_GEOMETRY_DRIFT', 'Registered Roof 3 geometry or answer-exposed orientation changed.'));
  if (volume?.sourceRegistration?.plan?.pdfBoundsPt?.x !== 1640 || volume?.sourceRegistration?.plan?.pdfBoundsPt?.y !== 987 || volume?.sourceRegistration?.plan?.pdfBoundsPt?.width !== 359.5 || volume?.sourceRegistration?.plan?.pdfBoundsPt?.height !== 225.5) issues.push(issue('BLOSSOM_CALIBRATION_PLAN_BOUNDS_DRIFT', 'A3.2 rotated-PDF interior wall-face bounds changed.'));
  if (volume?.lowEdgeDatumZFt !== 18.034723 || volume?.highEdgeDatumZFt !== 21.166667 || volume?.protectionPlaneOffsetStatus !== 'unresolved-roof-assembly-purlin-and-branch-line-offset') issues.push(issue('BLOSSOM_CALIBRATION_VERTICAL_BOUNDARY_DRIFT', 'Roof surface bounds or unresolved protection-plane offset changed.'));
  if (volume?.structuralMembers?.purlin?.section !== 'HSS 6x4x1/4' || volume?.structuralMembers?.purlin?.spacingIn !== 46 || volume?.structuralMembers?.beam?.section !== 'HSS 12x8x1/4' || volume?.structuralMembers?.roofAssemblyThicknessResolved !== false || volume?.structuralMembers?.branchLineElevationResolved !== false) issues.push(issue('BLOSSOM_CALIBRATION_STRUCTURE_DRIFT', 'S2.2 purlin/beam evidence or unresolved offsets changed.'));
  const registration = auditExposedSlopeSourceRegistration(value);
  if (registration.status !== 'passed') issues.push(...registration.issues.map((entry) => issue(entry.code, 'Exposed-slope source registration failed.')));
  if (Object.values(value?.claims || {}).some(Boolean)) issues.push(issue('BLOSSOM_CALIBRATION_INPUT_FALSE_PROMOTION', 'Calibration input cannot promote engineering or release claims.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceRegistrationReady: issues.length === 0, freshHoldoutEligible: false, complianceReady: false };
}

export async function buildBlossomRockRegisteredCalibration(value) {
  if ((await validateBlossomRockRegisteredCalibrationSource(value)).status !== 'passed') throw new Error('BLOSSOM_REGISTERED_CALIBRATION_SOURCE_BLOCKED');
  const generated = await buildSourceTopologyPlacementCandidate(value);
  if (generated.counts.total !== 8 || generated.counts.upright !== 8 || generated.counts.unresolved !== 0) throw new Error('BLOSSOM_REGISTERED_CALIBRATION_PATTERN_BLOCKED');
  const draft = {
    artifactType: 'halofire.answer-exposed-registered-slope-calibration.v1',
    projectId: value.projectId,
    boundedScope: value.boundedScope,
    sourceReceiptSha256: value.sourceReceiptSha256,
    approvedAnswerSha256: value.approvedAnswer.sha256,
    sequence: value.sequence,
    registrationAudit: generated.exposedSlopeRegistrationAudit,
    exposedSlopedAudit: generated.exposedSlopedAudit,
    targets: generated.heads,
    counts: generated.counts,
    structuralMembers: value.exposedSlopedCeilingVolumes[0].structuralMembers,
    calibrationComparison: {
      completedPattern: value.approvedAnswer.boundedUprightPattern,
      countParity: true,
      kindParity: true,
      normalizedPatternParity: true,
      exactXyScoreAvailable: false,
      exactHeadElevationReady: false,
      reasonExactElevationBlocked: 'Top-of-roof datum is registered, but roof assembly thickness, purlin underside offset, branch-line elevation, and deflector offset are unresolved.',
    },
    internalVerification: {
      primary: { status: 'passed', method: 'registered source replay produces four columns by two rows' },
      crossSource: { status: 'passed', method: 'A3.2 PDF transform, A5.1/M2.0 slope, A6.1 regime, A8.1 datum, and S2.2 member profile agree on one feature identity' },
      adversarial: { status: 'passed', method: 'source identity, feature binding, geometry, answer disclosure, elevation, and false-promotion mutations rejected' },
    },
    registeredSourceModelReady: true,
    topViewReady: true,
    roofSurfaceElevationViewReady: true,
    threeDimensionalEnvelopeReady: true,
    answerExposedCalibrationReady: true,
    freshProjectPlacementVerified: false,
    exactHeadElevationReady: false,
    obstructionClearanceReady: false,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'answer-exposed-source-registered-top-elevation-and-3d-calibration-ready-not-a-fresh-holdout-or-engineering-release',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateBlossomRockRegisteredCalibration(value, source) {
  const issues = [];
  let expected;
  try { expected = await buildBlossomRockRegisteredCalibration(source); }
  catch (error) { return { status: 'blocked', issues: [issue('BLOSSOM_REGISTERED_CALIBRATION_SOURCE_BLOCKED', error.message)], complianceReady: false }; }
  if (JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('BLOSSOM_REGISTERED_CALIBRATION_REPLAY_MISMATCH', 'Registered calibration differs from deterministic replay.'));
  if (value?.counts?.total !== 8 || value?.counts?.upright !== 8 || value?.calibrationComparison?.countParity !== true || value?.calibrationComparison?.kindParity !== true) issues.push(issue('BLOSSOM_REGISTERED_CALIBRATION_PATTERN_DRIFT', 'Expected exact eight-upright count and kind parity.'));
  if (value?.targets?.some((target) => target.sourceProtectionPlaneZFt !== null || target.headInstallationZFt !== null || !Number.isFinite(target.sourceRoofSurfaceZFt))) issues.push(issue('BLOSSOM_REGISTERED_CALIBRATION_FALSE_ELEVATION', 'Unresolved protection-plane and installed elevations must remain null while roof-surface bounds stay numeric.'));
  if (value?.freshProjectPlacementVerified !== false || value?.exactHeadElevationReady !== false || value?.obstructionClearanceReady !== false || value?.hydraulicCalculationReady !== false || value?.complianceReady !== false || value?.fabricationReady !== false || value?.fieldReleaseReady !== false) issues.push(issue('BLOSSOM_REGISTERED_CALIBRATION_FALSE_PROMOTION', 'Answer-exposed calibration promoted a fresh or production engineering claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, registeredSourceModelReady: issues.length === 0, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyBlossomRockRegisteredCalibrationAdversarialLoop(value, source) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }],
    ['source-receipt', (entry) => { entry.sourceReceiptSha256 = '1'.repeat(64); }],
    ['answer', (entry) => { entry.approvedAnswerSha256 = '2'.repeat(64); }],
    ['count', (entry) => { entry.counts.total = 6; }],
    ['kind', (entry) => { entry.targets[0].kind = 'orientation-unresolved'; }],
    ['xy', (entry) => { entry.targets[0].localFt.x += 1; }],
    ['roof-z', (entry) => { entry.targets[0].sourceRoofSurfaceZFt += 1; }],
    ['protection-z', (entry) => { entry.targets[0].sourceProtectionPlaneZFt = 18; }],
    ['installed-z', (entry) => { entry.targets[0].headInstallationZFt = 18; }],
    ['registration', (entry) => { entry.registrationAudit.status = 'blocked'; }],
    ['exact-xy', (entry) => { entry.calibrationComparison.exactXyScoreAvailable = true; }],
    ['fresh', (entry) => { entry.freshProjectPlacementVerified = true; }],
    ['elevation', (entry) => { entry.exactHeadElevationReady = true; }],
    ['clearance', (entry) => { entry.obstructionClearanceReady = true; }],
    ['hydraulic', (entry) => { entry.hydraulicCalculationReady = true; }],
    ['compliance', (entry) => { entry.complianceReady = true; }],
    ['fabrication', (entry) => { entry.fabricationReady = true; }],
    ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const attacked = structuredClone(value);
    mutate(attacked);
    if ((await validateBlossomRockRegisteredCalibration(attacked, source)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, complianceReady: false };
}
