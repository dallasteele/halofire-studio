import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildVivianoSourceOnlyCandidate,
  validateVivianoSourceOnlyCandidate,
  validateVivianoSourceSeal,
  verifyVivianoSourceCandidateAdversarialLoop,
} from '../src/engine/viviano-clubhouse-unseen-pitched-holdout.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceSeal = read('viviano-clubhouse-unseen-pitched-holdout.json');
const calibration = read('pitched-placement-calibration-corpus-v2.json');
const candidate = read('viviano-clubhouse-source-only-pitched-candidate.json');
const dependencies = { sourceSeal, calibration };

describe('Viviano Clubhouse fresh occupied-vaulted-ceiling holdout', () => {
  it('seals eight independent architectural sources while four completed answers remain unopened', async () => {
    expect(await validateVivianoSourceSeal(sourceSeal)).toMatchObject({ status: 'passed', sourceSealReady: true, complianceReady: false });
    expect(sourceSeal.sources).toHaveLength(8);
    expect(sourceSeal.answerKeyDenylist).toHaveLength(4);
    expect(sourceSeal.answerKeyDenylist.every((answer) => answer.openedBeforeSourceCommit === false)).toBe(true);
    expect(sourceSeal.selection).toMatchObject({ status: 'source-sealed-answer-unopened', priorImplementationSearchHits: 0 });
  });

  it('closes one occupied Gym vault without substituting the steeper exterior roof plane', () => {
    expect(sourceSeal.sourceObservations.clubhouseGymVault).toMatchObject({
      room: 'CLUBHOUSE GYM 58', planLengthFt: 42.25, planWidthFt: 30.760417,
      pitchRiseInPer12: 7.334, springElevationFt: 17, ridgeElevationFt: 26.399871,
      sourceCeilingLabel: 'VAULTED CEILING', sourceObstructionPresent: true,
      roofPitchRiseInPer12: 10, roofPlaneUsedAsCeiling: false,
    });
    expect(sourceSeal.sourceObservations.zoneRegistry.map((zone) => [zone.id, zone.placementEligible])).toEqual([
      ['clubhouse-gym-vault-zone', true], ['other-vaulted-zones', false], ['flat-occupied-zones', false],
    ]);
  });

  it('replays a blind twelve-head v2-neighbor candidate and preserves the out-of-range warning', async () => {
    expect(await buildVivianoSourceOnlyCandidate(sourceSeal, calibration)).toEqual(candidate);
    expect(await validateVivianoSourceOnlyCandidate(candidate, dependencies)).toMatchObject({
      status: 'passed', sourceCandidateReady: true, unseenProjectPlacementVerified: false, complianceReady: false,
    });
    expect(candidate.familySelection).toMatchObject({
      selectedProjectId: 'midvale-townhome-clubhouse-midvale-ut',
      selectedFamily: 'large-symmetric-two-plane-vault-four-along', distance: 9.077262,
      extrapolationWarning: true, forbiddenSelectorInputsUsed: [], empiricalPriorOnly: true, codeLimit: false,
    });
    expect(candidate.layout.topology).toEqual({ alongRidgeStations: 4, acrossSlopeStations: 3 });
    expect(candidate.layout.heads3d).toHaveLength(12);
    expect(new Set(candidate.layout.heads3d.map((head) => head.surfaceId)).size).toBe(2);
    expect(candidate.layout.heads3d.every((head) => head.obstructionClearanceVerified === false)).toBe(true);
    expect(candidate.answerKeyOpened).toBe(false);
    expect(candidate.wholeBuildingModelReady).toBe(false);
    expect(candidate.complianceReady).toBe(false);
  });

  it('rejects twenty-three provenance, extrapolation, leakage, geometry, obstruction, topology, and false-promotion mutations', async () => {
    const result = await verifyVivianoSourceCandidateAdversarialLoop(candidate, dependencies);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 23, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(23);
  });
});
