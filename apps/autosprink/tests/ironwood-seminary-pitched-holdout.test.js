import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildIronwoodPitchedHoldoutCandidate,
  validateIronwoodPitchedHoldoutCandidate,
  validateIronwoodSourceTopology,
  verifyIronwoodPitchedHoldoutAdversarialLoop,
} from '../src/engine/ironwood-seminary-pitched-holdout.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const source = read('ironwood-seminary-pitched-holdout-source-topology.json');
const candidate = read('ironwood-seminary-pitched-holdout-candidate.json');

describe('Ironwood Seminary fresh pitched-roof holdout', () => {
  it('seals a never-before-used protected source packet with an explicit page boundary', async () => {
    expect(await validateIronwoodSourceTopology(source)).toMatchObject({ status: 'passed', sourceReady: true, complianceReady: false });
    expect(source.protectedSource).toMatchObject({ pageCount: 38, allowedPages: [12, 13, 14, 24, 28], excludedPages: [26] });
    expect(source.sourceSequence).toMatchObject({ answerArtifactRead: false, completedLayoutRead: false, answerArtifactHashed: false, candidateMustBeCommittedBeforeAnswerOpen: true });
    expect(source.sourceExtraction).toMatchObject({ vectorDrawingsAvailable: true, sourceGeometryVisuallyVerified: true, sprinklerSymbolsConsumed: false });
  });

  it('replays the frozen Building J policy into six ceiling and four pitched-volume targets', async () => {
    expect(await buildIronwoodPitchedHoldoutCandidate(source)).toEqual(candidate);
    expect(await validateIronwoodPitchedHoldoutCandidate(candidate, source)).toMatchObject({ status: 'passed', sourceGeneratedCandidateReady: true, freshProjectPlacementVerified: false, complianceReady: false });
    expect(candidate.counts).toEqual({ total: 10, pendent: 6, upright: 4 });
    expect(candidate.roomAudit.map((entry) => entry.candidateIds.length)).toEqual([1, 1, 2, 1, 1]);
    expect(candidate.roofAudit.map((entry) => entry.candidateIds.length)).toEqual([2, 2]);
  });

  it('retains every exact-elevation, obstruction, hydraulic, compliance, and release gate', () => {
    expect(candidate.heads.every((head) => head.headInstallationZFt === null && head.sprinklerModel === null && !head.obstructionClearanceVerified && !head.hydraulicNodeAssigned)).toBe(true);
    expect(candidate).toMatchObject({ concealedSpaceProtectionRequirementVerified: false, sprinklerModelSelectionReady: false, exactMechanicalObstructionFootprintsReady: false, exactStructuralMemberDepthsReady: false, obstructionClearancesVerified: false, branchPipeTopologyReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
  });

  it('keeps answer-shaped identifiers and the excluded sprinkler page out of generator code', () => {
    const engine = fs.readFileSync(new URL('../src/engine/ironwood-seminary-pitched-holdout.js', import.meta.url), 'utf8');
    const generic = fs.readFileSync(new URL('../src/engine/source-topology-placement-policy.js', import.meta.url), 'utf8');
    const builder = fs.readFileSync(new URL('../scripts/build-ironwood-seminary-pitched-holdout.mjs', import.meta.url), 'utf8');
    expect(`${engine}\n${generic}\n${builder}`).not.toMatch(/20127FPBASE|AsBui|ApprovedPlans|page\s*26/i);
  });

  it('rejects all source, geometry, answer-leakage, and false-promotion attacks', async () => {
    const result = await verifyIronwoodPitchedHoldoutAdversarialLoop(candidate, source);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 18, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(18);
  });
});
