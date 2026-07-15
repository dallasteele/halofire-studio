import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildNewHopePitchedSourceOnlyCandidate,
  sealNewHopePitchedSource,
  validateNewHopePitchedSource,
  validateNewHopePitchedSourceOnlyCandidate,
  verifyNewHopePitchedCandidateAdversarialLoop,
} from '../src/engine/new-hope-pitched-holdout.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const source = read('new-hope-pitched-holdout-source.json');
const candidate = read('new-hope-pitched-holdout-candidate.json');

describe('New Hope fresh source-only pitched-attic holdout', () => {
  it('seals actual A101/A102/A103/A301 and zero-unknown floor/RCP/roof/section DWGs before answer access', async () => {
    expect(await sealNewHopePitchedSource(source)).toEqual(source);
    expect(await validateNewHopePitchedSource(source)).toMatchObject({ status: 'passed', sourceRegistrationReady: true, freshProjectPlacementVerified: false, complianceReady: false });
    expect(source.selection).toMatchObject({ repoReferenceHitsBeforeSelection: 0, answerArtifactRead: false, answerArtifactHashed: false, completedLayoutRead: false, candidateMustBeCommittedBeforeAnswerOpen: true });
    expect(source.answerKeyDenylist.every((entry) => entry.sha256 === null && entry.openedBeforeCandidateCommit === false)).toBe(true);
  });

  it('requires an occupied footprint intersection and emits 24 frozen source-only upright targets', async () => {
    expect(await buildNewHopePitchedSourceOnlyCandidate(source)).toEqual(candidate);
    expect(await validateNewHopePitchedSourceOnlyCandidate(candidate, source)).toMatchObject({ status: 'passed', sourceXyCandidateReady: true, freshProjectPlacementVerified: false, complianceReady: false });
    expect(candidate.protectionEligibilityAudit).toEqual({ status: 'passed', issues: [], eligibleVolumeIds: ['north-east-occupied-wing-gable-core'], matchedFootprintIds: ['north-east-occupied-family-unit-wing'] });
    expect(candidate.counts).toEqual({ total: 24, upright: 24 });
    expect(candidate.heads.every((head) => head.kind === 'upright' && head.sourceProtectionPlaneZFt === null && head.headInstallationZFt === null && Number.isFinite(head.sourceRoofSurfaceZFt))).toBe(true);
  });

  it('uses system-owned primary, cross-source, and adversarial loops without an independent-review gate', () => {
    expect(candidate.internalVerification).toMatchObject({ primary: { status: 'passed' }, crossSource: { status: 'passed' }, adversarial: { status: 'passed' } });
    expect(candidate.internalVerification).not.toHaveProperty('independent');
  });

  it('rejects every source, isolation, eligibility, geometry, target, and false-promotion mutation', async () => {
    const result = await verifyNewHopePitchedCandidateAdversarialLoop(candidate, source);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 19, freshProjectPlacementVerified: false, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(19);
  });
});
