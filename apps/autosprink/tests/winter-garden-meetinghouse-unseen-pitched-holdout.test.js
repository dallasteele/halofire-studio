import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildWinterGardenSourceOnlyCandidate,
  validateWinterGardenSourceOnlyCandidate,
  validateWinterGardenSourceSeal,
  verifyWinterGardenSourceCandidateAdversarialLoop,
} from '../src/engine/winter-garden-meetinghouse-unseen-pitched-holdout.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceSeal = read('winter-garden-meetinghouse-unseen-pitched-holdout.json');
const calibration = read('pitched-placement-calibration-corpus-v3.json');
const candidate = read('winter-garden-source-only-pitched-candidate.json');
const dependencies = { sourceSeal, calibration };

describe('Winter Garden fresh occupied-vaulted-ceiling holdout', () => {
  it('seals six independent source sheets while eight completed answers remain unopened', async () => {
    expect(await validateWinterGardenSourceSeal(sourceSeal)).toMatchObject({ status: 'passed', sourceSealReady: true, complianceReady: false });
    expect(sourceSeal.sources).toHaveLength(6);
    expect(sourceSeal.answerKeyDenylist).toHaveLength(8);
    expect(sourceSeal.answerKeyDenylist.every((answer) => answer.openedBeforeSourceCommit === false)).toBe(true);
    expect(sourceSeal.toolchain).toMatchObject({ visualInspectionCompleted: true, answerContentRead: false, answerBytesHashedOnly: true });
  });

  it('closes Cultural Center 150 from plan, RCP, section, and truss evidence', () => {
    expect(sourceSeal.sourceObservations.culturalCenterVault).toMatchObject({
      room: 'CULTURAL CENTER 150', planLengthFt: 28.9375, planWidthFt: 38.083333,
      pitchRiseInPer12: 4.5, springElevationFt: 12.244792, ridgeElevationFt: 19.385417,
      sourceCeilingLabel: 'C3 SLOPED', sourceObstructionPresent: true, roofPlaneUsedAsCeiling: false,
    });
    expect(sourceSeal.sourceObservations.zoneRegistry.filter((zone) => zone.placementEligible).map((zone) => zone.id)).toEqual(['cultural-center-vault-zone']);
  });

  it('replays the blind six-head v3 Moses Lake transfer with an explicit extrapolation warning', async () => {
    expect(await buildWinterGardenSourceOnlyCandidate(sourceSeal, calibration)).toEqual(candidate);
    expect(await validateWinterGardenSourceOnlyCandidate(candidate, dependencies)).toMatchObject({ status: 'passed', sourceCandidateReady: true, unseenProjectPlacementVerified: false, complianceReady: false });
    expect(candidate.familySelection).toMatchObject({
      selectedProjectId: 'moses-lake-stake-center', selectedFamily: 'large-symmetric-two-plane-vault-two-along',
      distance: 1.686099, extrapolationWarning: true, forbiddenSelectorInputsUsed: [], empiricalPriorOnly: true, codeLimit: false,
    });
    expect(candidate.layout.topology).toEqual({ alongRidgeStations: 2, acrossSlopeStations: 3 });
    expect(candidate.layout.heads3d).toHaveLength(6);
    expect(new Set(candidate.layout.heads3d.map((head) => head.surfaceId)).size).toBe(2);
    expect(candidate.answerKeyOpened).toBe(false);
    expect(candidate.wholeBuildingModelReady).toBe(false);
    expect(candidate.complianceReady).toBe(false);
  });

  it('rejects twenty-three provenance, leakage, geometry, topology, and false-promotion mutations', async () => {
    const result = await verifyWinterGardenSourceCandidateAdversarialLoop(candidate, dependencies);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 23, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(23);
  });
});
