import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildBlossomRockSourceCandidate,
  sealBlossomRockSource,
  validateBlossomRockSource,
  validateBlossomRockSourceCandidate,
  verifyBlossomRockCandidateAdversarialLoop,
} from '../src/engine/blossom-rock-exposed-slope-holdout.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const source = read('blossom-rock-exposed-slope-source.json');
const candidate = read('blossom-rock-exposed-slope-candidate.json');

describe('Blossom Rock fresh exposed-slope holdout', () => {
  it('keeps the completed approved fire plan unopened and unhashed at source seal time', async () => {
    expect(await validateBlossomRockSource(source)).toMatchObject({ status: 'passed', sourceReady: true, complianceReady: false });
    expect(source.answerKeyDenylist[0]).toMatchObject({ sha256: null, openedBeforeSourceSeal: false, hashedBeforeSourceSeal: false });
  });

  it('replays six orientation-unresolved targets on the source-proven quarter-inch-per-foot plane', async () => {
    const replay = await buildBlossomRockSourceCandidate(source);
    expect(replay).toEqual(candidate);
    expect(await validateBlossomRockSourceCandidate(candidate, source)).toMatchObject({ status: 'passed', sourceGeneratedCandidateReady: true, freshProjectPlacementVerified: false, complianceReady: false });
    expect(candidate.counts).toEqual({ total: 6, pendent: 0, upright: 0, unresolved: 6 });
  });

  it('keeps installation orientation, exact head elevation, models, clearance, hydraulics, and release unresolved', () => {
    expect(candidate.targets.every((target) => target.kind === 'orientation-unresolved' && target.headInstallationZFt === null && target.sprinklerModel === null && target.obstructionClearanceVerified === false && target.hydraulicNodeAssigned === false)).toBe(true);
    expect(candidate).toMatchObject({ sprinklerOrientationResolved: false, exactMechanicalObstructionFootprintsReady: false, exactStructuralMemberDepthsReady: false, obstructionClearancesVerified: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false, wholeBuildingLayoutReady: false });
  });

  it('rejects source drift and all candidate adversarial mutations', async () => {
    const changed = structuredClone(source);
    changed.exposedSlopedCeilingVolumes[0].slopeRise = 1.5;
    expect((await validateBlossomRockSource(await sealBlossomRockSource(changed))).status).toBe('blocked');
    expect(await verifyBlossomRockCandidateAdversarialLoop(candidate, source)).toMatchObject({ status: 'passed', attemptedCases: 18, complianceReady: false });
  });
});
