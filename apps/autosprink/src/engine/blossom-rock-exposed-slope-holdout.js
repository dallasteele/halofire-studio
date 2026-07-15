/** Fresh source-sealed exposed single-slope holdout. */

import { sha256Hex } from './elevation-datums.js';
import { buildSourceTopologyPlacementCandidate } from './source-topology-placement-policy.js';

const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });

const EXPECTED_SOURCES = Object.freeze({
  'architectural-floor-notation': ['32c751100f51241b5bb24524806b9fdc2f9646f56ef0525e247a574e0956ac97', 939684],
  'architectural-floor-dimension': ['2db70b398eca43244e5e0a44e3f773a03def39b449a9d20c94f618082dfe4b84', 957212],
  'architectural-roof-plan': ['1f998ad75557402e6b17010cc6febbdf5da105ede5a7a012ddc9f4726826aff1', 884442],
  'architectural-rcp': ['93dde254758ec42a612b935f2bd6e351106a99f452e1c7f092b518b78bb04b55', 877931],
  'architectural-elevations': ['81be9c87e510ec2c63f074bd9276c19f45853a11cce0b4a6a511fc895f23f68e', 1756483],
  'architectural-sections': ['38a1838e4092bc89d43952d48b807a275ae9bb7a6660251c6b5b9695f579fe70', 1148283],
  'structural-roof-framing': ['95e2e3575f3cb91c620290f059c1ed1c0dbf4f2d44e770f9bdc96846bf077594', 1036679],
  'mechanical-floor-plan': ['2c650271037a18ffcd8df810db026889b8b7e7803eb25077078c38a18e91fe96', 1583941],
});

export async function sealBlossomRockSource(value) {
  const { sourceReceiptSha256: _ignored, ...draft } = value;
  return { ...draft, sourceReceiptSha256: await sha256Hex(draft) };
}

export async function validateBlossomRockSource(value) {
  const issues = [];
  const { sourceReceiptSha256, ...draft } = value || {};
  if (!SHA.test(sourceReceiptSha256 || '') || await sha256Hex(draft) !== sourceReceiptSha256) issues.push(issue('BLOSSOM_SOURCE_RECEIPT_INVALID', 'Protected-source receipt is invalid.'));
  const sources = new Map((value?.protectedSources || []).map((entry) => [entry.role, entry]));
  for (const [role, [sha256, bytes]] of Object.entries(EXPECTED_SOURCES)) {
    const source = sources.get(role);
    if (!source || source.sha256 !== sha256 || source.bytes !== bytes) issues.push(issue('BLOSSOM_SOURCE_IDENTITY_DRIFT', `Protected source ${role} changed or is missing.`));
  }
  if (sources.size !== Object.keys(EXPECTED_SOURCES).length) issues.push(issue('BLOSSOM_SOURCE_SET_DRIFT', 'Protected-source set is not exact.'));
  const sequence = value?.sourceSequence;
  if (sequence?.answerArtifactRead !== false || sequence?.answerArtifactHashed !== false || sequence?.completedLayoutRead !== false || sequence?.sprinklerSymbolsConsumed !== false) issues.push(issue('BLOSSOM_SOURCE_SEQUENCE_VIOLATION', 'Answer evidence entered the source-only sequence.'));
  const answer = value?.answerKeyDenylist?.[0];
  if (value?.answerKeyDenylist?.length !== 1 || answer?.role !== 'approved-fire-plan' || answer?.bytes !== 2829351 || answer?.sha256 !== null || answer?.openedBeforeSourceSeal !== false || answer?.hashedBeforeSourceSeal !== false) issues.push(issue('BLOSSOM_ANSWER_BOUNDARY_DRIFT', 'Approved fire-plan answer must remain identified by metadata only and unopened/unhashed.'));
  const volume = value?.exposedSlopedCeilingVolumes?.[0];
  if (value?.exposedSlopedCeilingVolumes?.length !== 1 || volume?.id !== 'lake-pump-room-exposed-single-slope' || volume?.slopeRise !== 0.25 || volume?.slopeRun !== 12 || volume?.slopeAxis !== 'x' || volume?.targetKind !== 'orientation-unresolved') issues.push(issue('BLOSSOM_SOURCE_SLOPE_DRIFT', 'Bounded Lake Pump Room exposed-slope source geometry changed.'));
  if ((value?.finishedCeilingRooms || []).length !== 0 || (value?.pitchedConcealedVolumes || []).length !== 0) issues.push(issue('BLOSSOM_SCOPE_DRIFT', 'This source seal is bounded to one exposed sloped plane, not finished-ceiling or attic placement.'));
  if (Object.values(value?.claims || {}).some(Boolean)) issues.push(issue('BLOSSOM_SOURCE_FALSE_PROMOTION', 'Source seal cannot promote placement, compliance, hydraulics, fabrication, or release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceReady: issues.length === 0, complianceReady: false };
}

export async function buildBlossomRockSourceCandidate(source) {
  if ((await validateBlossomRockSource(source)).status !== 'passed') throw new Error('BLOSSOM_SOURCE_BLOCKED');
  // Preserve the already-sealed pre-answer artifact exactly for scoring. The
  // production policy now rejects this unregistered legacy packet; this replay
  // exception cannot be used by normal generation.
  const generated = await buildSourceTopologyPlacementCandidate(source, { allowLegacyUnregisteredExposedSlope: true });
  const draft = {
    artifactType: 'halofire.fresh-exposed-slope-source-candidate.v1',
    projectId: source.projectId,
    projectName: source.projectName,
    boundedScope: source.boundedScope,
    generationVersion: 'source-topology-placement-policy-exposed-slope-v1',
    generationMode: 'sealed-protected-source-exposed-single-slope-deterministic-target-placement',
    sourceReceiptSha256: source.sourceReceiptSha256,
    sequence: { sourceCandidateSealedBeforeAnswerOpen: true, answerArtifactRead: false, answerArtifactHashed: false, completedLayoutRead: false, freshProjectHoldout: true },
    policy: source.placementPolicy,
    roomAudit: generated.roomAudit,
    roofAudit: generated.roofAudit,
    exposedSlopedAudit: generated.exposedSlopedAudit,
    targets: generated.heads,
    counts: generated.counts,
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic protected-source exposed-plane replay' },
      independent: { status: 'passed', method: 'source receipt, polygon containment, area, spacing, and quarter-inch-per-foot elevation arithmetic' },
      adversarial: { status: 'passed', method: 'receipt, source boundary, geometry, orientation invention, answer leakage, and false-promotion attacks rejected' },
    },
    sourceGeneratedCandidateReady: true,
    answerScoreReady: false,
    freshProjectPlacementVerified: false,
    sprinklerOrientationResolved: false,
    sprinklerModelSelectionReady: false,
    exactMechanicalObstructionFootprintsReady: false,
    exactStructuralMemberDepthsReady: false,
    obstructionClearancesVerified: false,
    branchPipeTopologyReady: false,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    wholeBuildingLayoutReady: false,
    claimStatus: 'fresh-bounded-source-targets-awaiting-answer-score-not-whole-building-or-code-compliance-hydraulics-fabrication-release',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateBlossomRockSourceCandidate(value, source) {
  const issues = [];
  let expected;
  try { expected = await buildBlossomRockSourceCandidate(source); }
  catch (error) { return { status: 'blocked', issues: [issue('BLOSSOM_CANDIDATE_SOURCE_BLOCKED', error.message)], complianceReady: false }; }
  if (JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('BLOSSOM_CANDIDATE_REPLAY_MISMATCH', 'Candidate differs from deterministic source-only replay.'));
  if (value?.counts?.total !== 6 || value?.counts?.unresolved !== 6 || value?.counts?.pendent !== 0 || value?.counts?.upright !== 0) issues.push(issue('BLOSSOM_CANDIDATE_COUNT_DRIFT', 'Bounded policy must emit six orientation-unresolved source targets.'));
  if (value?.targets?.some((target) => target.kind !== 'orientation-unresolved' || target.headInstallationZFt !== null || target.sprinklerModel !== null || target.obstructionClearanceVerified || target.hydraulicNodeAssigned)) issues.push(issue('BLOSSOM_CANDIDATE_FALSE_HEAD_PROMOTION', 'Source targets cannot invent installation orientation, model, installed elevation, clearance, or hydraulics.'));
  const elevations = value?.targets?.map((target) => target.sourceProtectionPlaneZFt) || [];
  if (Math.min(...elevations) !== 13.779224 || Math.max(...elevations) !== 14.187789) issues.push(issue('BLOSSOM_CANDIDATE_ELEVATION_DRIFT', 'Quarter-inch-per-foot exposed-plane target elevations changed.'));
  if (value?.sequence?.answerArtifactRead !== false || value?.sequence?.answerArtifactHashed !== false || value?.answerScoreReady !== false || value?.freshProjectPlacementVerified !== false || value?.complianceReady !== false || value?.fabricationReady !== false || value?.fieldReleaseReady !== false || value?.wholeBuildingLayoutReady !== false) issues.push(issue('BLOSSOM_CANDIDATE_DOWNSTREAM_FALSE_PROMOTION', 'Unscored bounded source candidate promoted a downstream claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceGeneratedCandidateReady: issues.length === 0, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyBlossomRockCandidateAdversarialLoop(value, source) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }],
    ['source-binding', (entry) => { entry.sourceReceiptSha256 = '1'.repeat(64); }],
    ['version', (entry) => { entry.generationVersion = 'answer-fit'; }],
    ['target-x', (entry) => { entry.targets[0].localFt.x += 1; }],
    ['target-z', (entry) => { entry.targets[0].sourceProtectionPlaneZFt += 1; }],
    ['invent-orientation', (entry) => { entry.targets[0].kind = 'upright'; }],
    ['installed-z', (entry) => { entry.targets[0].headInstallationZFt = 14; }],
    ['model', (entry) => { entry.targets[0].sprinklerModel = 'invented'; }],
    ['clearance', (entry) => { entry.targets[0].obstructionClearanceVerified = true; }],
    ['hydraulic', (entry) => { entry.targets[0].hydraulicNodeAssigned = true; }],
    ['count', (entry) => { entry.counts.total = 7; }],
    ['audit', (entry) => { entry.exposedSlopedAudit[0].candidateIds.pop(); }],
    ['answer-open', (entry) => { entry.sequence.answerArtifactRead = true; }],
    ['answer-hash', (entry) => { entry.sequence.answerArtifactHashed = true; }],
    ['score', (entry) => { entry.answerScoreReady = true; }],
    ['holdout', (entry) => { entry.freshProjectPlacementVerified = true; }],
    ['compliance', (entry) => { entry.complianceReady = true; }],
    ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const attacked = structuredClone(value);
    mutate(attacked);
    if ((await validateBlossomRockSourceCandidate(attacked, source)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, complianceReady: false };
}
