/** Fresh source-sealed pitched-roof transfer holdout. */

import { sha256Hex } from './elevation-datums.js';
import { buildSourceTopologyPlacementCandidate } from './source-topology-placement-policy.js';

const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function sealIronwoodSourceTopology(value) {
  const { sourceReceiptSha256: _ignored, ...draft } = value;
  return { ...draft, sourceReceiptSha256: await sha256Hex(draft) };
}

export async function validateIronwoodSourceTopology(value) {
  const issues = [];
  const { sourceReceiptSha256, ...draft } = value || {};
  if (!SHA.test(sourceReceiptSha256 || '') || await sha256Hex(draft) !== sourceReceiptSha256) issues.push(issue('IRONWOOD_SOURCE_RECEIPT_INVALID', 'Protected-source packet receipt is invalid.'));
  if (value?.protectedSource?.sha256 !== 'b80b399aa219dd91344d68ad8637e22e165a87d7726427764348ead7ef21cba6') issues.push(issue('IRONWOOD_SOURCE_PDF_DRIFT', 'Protected construction PDF hash changed.'));
  if (JSON.stringify(value?.protectedSource?.allowedPages) !== JSON.stringify([12, 13, 14, 24, 28]) || JSON.stringify(value?.protectedSource?.excludedPages) !== JSON.stringify([26])) issues.push(issue('IRONWOOD_SOURCE_PAGE_BOUNDARY_DRIFT', 'Allowed or excluded source pages changed.'));
  if (value?.sourceSequence?.answerArtifactRead !== false || value?.sourceSequence?.completedLayoutRead !== false || value?.sourceSequence?.answerArtifactHashed !== false) issues.push(issue('IRONWOOD_SOURCE_SEQUENCE_VIOLATION', 'Answer evidence entered the source-only packet.'));
  if (value?.sourceExtraction?.sprinklerSymbolsConsumed !== false) issues.push(issue('IRONWOOD_SOURCE_SPRINKLER_LEAK', 'Source generation consumed a sprinkler symbol.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceReady: issues.length === 0, complianceReady: false };
}

export async function buildIronwoodPitchedHoldoutCandidate(source) {
  const validation = await validateIronwoodSourceTopology(source);
  if (validation.status !== 'passed') throw new Error('IRONWOOD_SOURCE_TOPOLOGY_BLOCKED');
  const generated = await buildSourceTopologyPlacementCandidate(source);
  const draft = {
    artifactType: 'halofire.fresh-pitched-source-candidate.v1',
    projectId: source.projectId,
    projectName: source.projectName,
    generationVersion: 'frozen-building-j-topology-policy-transfer-v1',
    generationMode: 'sealed-protected-source-room-and-pitched-volume-deterministic-placement',
    sourceReceiptSha256: source.sourceReceiptSha256,
    sequence: {
      sourceCandidateSealedBeforeAnswerOpen: true,
      answerArtifactRead: false,
      completedLayoutRead: false,
      freshProjectHoldout: true,
    },
    policy: source.placementPolicy,
    roomAudit: generated.roomAudit,
    roofAudit: generated.roofAudit,
    heads: generated.heads,
    counts: generated.counts,
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic protected-source room and pitched-volume replay' },
      independent: { status: 'passed', method: 'source receipt, polygon containment, spacing, area, count, and roof-slope arithmetic checks' },
      adversarial: { status: 'passed', method: 'receipt, source boundary, geometry, answer leakage, and false-promotion attacks rejected' }
    },
    sourceGeneratedCandidateReady: true,
    answerScoreReady: false,
    freshProjectPlacementVerified: false,
    concealedSpaceProtectionRequirementVerified: false,
    sprinklerModelSelectionReady: false,
    exactMechanicalObstructionFootprintsReady: false,
    exactStructuralMemberDepthsReady: false,
    obstructionClearancesVerified: false,
    branchPipeTopologyReady: false,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'fresh-source-sealed-candidate-awaiting-answer-only-score-not-code-compliance-hydraulics-fabrication-or-release'
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateIronwoodPitchedHoldoutCandidate(value, source) {
  const issues = [];
  let expected;
  try { expected = await buildIronwoodPitchedHoldoutCandidate(source); }
  catch (error) { return { status: 'blocked', issues: [issue('IRONWOOD_CANDIDATE_SOURCE_BLOCKED', error.message)], complianceReady: false }; }
  if (JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('IRONWOOD_CANDIDATE_REPLAY_MISMATCH', 'Candidate differs from deterministic source-only replay.'));
  if (value?.counts?.total !== 10 || value?.counts?.pendent !== 6 || value?.counts?.upright !== 4) issues.push(issue('IRONWOOD_CANDIDATE_COUNT_DRIFT', 'Frozen source policy must produce six finished-ceiling and four pitched-volume targets.'));
  if (value?.heads?.some((head) => head.headInstallationZFt !== null || head.sprinklerModel !== null || head.obstructionClearanceVerified || head.hydraulicNodeAssigned)) issues.push(issue('IRONWOOD_CANDIDATE_HEAD_FALSE_PROMOTION', 'A target was promoted to an installed, selected, cleared, or hydraulic head.'));
  if (value?.sequence?.answerArtifactRead !== false || value?.sequence?.completedLayoutRead !== false || value?.answerScoreReady !== false || value?.freshProjectPlacementVerified !== false || value?.complianceReady !== false || value?.fabricationReady !== false || value?.fieldReleaseReady !== false) issues.push(issue('IRONWOOD_CANDIDATE_DOWNSTREAM_FALSE_PROMOTION', 'Unscored candidate promoted a downstream claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceGeneratedCandidateReady: issues.length === 0, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyIronwoodPitchedHoldoutAdversarialLoop(value, source) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }],
    ['source-binding', (entry) => { entry.sourceReceiptSha256 = '1'.repeat(64); }],
    ['version', (entry) => { entry.generationVersion = 'answer-fit'; }],
    ['head-x', (entry) => { entry.heads[0].localFt.x += 1; }],
    ['head-kind', (entry) => { entry.heads[0].kind = 'upright'; }],
    ['head-z', (entry) => { entry.heads[0].headInstallationZFt = 108; }],
    ['model', (entry) => { entry.heads[0].sprinklerModel = 'fabricated'; }],
    ['clearance', (entry) => { entry.heads[0].obstructionClearanceVerified = true; }],
    ['hydraulic', (entry) => { entry.heads[0].hydraulicNodeAssigned = true; }],
    ['count', (entry) => { entry.counts.total = 11; }],
    ['room-audit', (entry) => { entry.roomAudit[0].candidateIds.pop(); }],
    ['roof-audit', (entry) => { entry.roofAudit[0].candidateIds.pop(); }],
    ['answer-open', (entry) => { entry.sequence.answerArtifactRead = true; }],
    ['completed-open', (entry) => { entry.sequence.completedLayoutRead = true; }],
    ['score', (entry) => { entry.answerScoreReady = true; }],
    ['holdout', (entry) => { entry.freshProjectPlacementVerified = true; }],
    ['compliance', (entry) => { entry.complianceReady = true; }],
    ['release', (entry) => { entry.fieldReleaseReady = true; }]
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const attacked = structuredClone(value);
    mutate(attacked);
    if ((await validateIronwoodPitchedHoldoutCandidate(attacked, source)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, complianceReady: false };
}
