import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildMosesLakeSourceOnlyCandidate,
  validateMosesLakeSourceOnlyCandidate,
  validateMosesLakeSourceSeal,
  verifyMosesLakeSourceCandidateAdversarialLoop,
} from '../src/engine/moses-lake-stake-center-unseen-pitched-holdout.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceSeal = read('moses-lake-stake-center-unseen-pitched-holdout.json');
const calibration = read('pitched-placement-calibration-corpus.json');
const candidate = read('moses-lake-stake-center-source-only-pitched-candidate.json');
const dependencies = { sourceSeal, calibration };

describe('Moses Lake Stake Center fresh occupied-sloped-ceiling holdout', () => {
  it('seals eight independent architectural sources while approved and as-built answers remain unopened', async () => {
    expect(await validateMosesLakeSourceSeal(sourceSeal)).toMatchObject({ status: 'passed', sourceSealReady: true, complianceReady: false });
    expect(sourceSeal.sources).toHaveLength(8);
    expect(sourceSeal.answerKeyDenylist).toHaveLength(2);
    expect(sourceSeal.answerKeyDenylist.every((answer) => answer.openedBeforeSourceCommit === false)).toBe(true);
    expect(sourceSeal.selection).toMatchObject({ status: 'source-sealed-answer-unopened', priorImplementationSearchHits: 0 });
  });

  it('distinguishes one dimension-closed Cultural Center vault from the reserved Chapel and flat zones', () => {
    expect(sourceSeal.sourceObservations.zoneRegistry.map((zone) => [zone.id, zone.classification, zone.placementEligible])).toEqual([
      ['cultural-center-vault-zone', 'occupied-sloped-ceiling', true],
      ['chapel-vault-zone', 'occupied-sloped-ceiling', false],
      ['flat-support-zones', 'flat-occupied-ceilings', false],
    ]);
    expect(sourceSeal.sourceObservations.culturalCenterVault).toMatchObject({ planLengthFt: 25.5, planWidthFt: 37.541667, pitchRiseInPer12: 4.5, ridgeElevationFt: 19.385417, derivedSpringElevationFt: 12.346354, sourceCeilingLabel: 'SLOPED' });
  });

  it('replays a committed twelve-head family-transfer candidate without answer, pipes, or downstream claims', async () => {
    expect(await buildMosesLakeSourceOnlyCandidate(sourceSeal, calibration)).toEqual(candidate);
    expect(await validateMosesLakeSourceOnlyCandidate(candidate, dependencies)).toMatchObject({ status: 'passed', sourceCandidateReady: true, unseenProjectPlacementVerified: false, complianceReady: false });
    expect(candidate.familySelection).toMatchObject({ selectedFamily: 'large-symmetric-two-plane-vault', forbiddenSelectorInputsUsed: [], empiricalPriorOnly: true, codeLimit: false });
    expect(candidate.layout.topology).toEqual({ alongRidgeStations: 4, acrossSlopeStations: 3 });
    expect(candidate.layout.heads3d).toHaveLength(12);
    expect(new Set(candidate.layout.heads3d.map((head) => head.surfaceId)).size).toBe(2);
    expect(candidate.branchPipes3d).toEqual([]);
    expect(candidate.answerKeyOpened).toBe(false);
    expect(candidate.unseenProjectPlacementVerified).toBe(false);
    expect(candidate.complianceReady).toBe(false);
  });

  it('rejects eighteen source, family, answer-leakage, geometry, topology, and false-promotion mutations', async () => {
    const result = await verifyMosesLakeSourceCandidateAdversarialLoop(candidate, dependencies);
    expect(result.status).toBe('passed');
    expect(result.rejectedCases).toHaveLength(18);
  });
});
