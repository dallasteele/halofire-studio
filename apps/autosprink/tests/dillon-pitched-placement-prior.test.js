import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDillonPitchedPlacementPrior, validateDillonPitchedPlacementPrior } from '../src/engine/dillon-pitched-placement-prior.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const calibration = read('submitted-sloped-ceiling-calibration.dillon.json');
const winterGardenHeldOut = read('winter-garden-source-pitched-heldout.json');
const packet = read('dillon-pitched-placement-prior.json');

describe('Dillon completed-project pitched placement prior', () => {
  it('replays the sealed calibration and excludes Winter Garden from tuning', async () => {
    expect(await buildDillonPitchedPlacementPrior({ calibration, winterGardenHeldOut })).toEqual(packet);
    const result = await validateDillonPitchedPlacementPrior(packet, { calibration, winterGardenHeldOut });
    expect(result.status).toBe('passed');
    expect(packet.excludedHoldout).toMatchObject({ acceptanceStatus: 'failed', usedForTuning: false, mutationAllowed: false });
    expect(packet.learnedGeometry).toMatchObject({ completedHeadCount: 2, replayAcrossCount: 1, replayAlongCount: 2, replayAlongSlopeSpanFt: 12 });
    expect(packet.calibrationResult).toEqual({ precision: 1, recall: 1, maxPlanErrorFt: 2.614, meanPlanErrorFt: 1.403, emptyReferenceRegionFalsePositives: 0 });
    expect(packet.transferPolicy).toMatchObject({ empiricalPriorOnly: true, codeLimit: false, obstructionClearanceTransferAllowed: false, unseenProjectHoldoutRequired: true });
    expect(packet.unseenProjectPlacementVerified).toBe(false);
    expect(packet.complianceReady).toBe(false);
  });

  it('rejects tuned geometry, source drift, and a promoted holdout', async () => {
    const tuned = structuredClone(packet); tuned.learnedGeometry.replayAlongSlopeSpanFt = 14;
    expect((await validateDillonPitchedPlacementPrior(tuned, { calibration, winterGardenHeldOut })).status).toBe('blocked');
    const drifted = structuredClone(calibration); drifted.slopeRegions[1].polygonSubmittedPt[0][0] += 1;
    expect((await validateDillonPitchedPlacementPrior(packet, { calibration: drifted, winterGardenHeldOut })).status).toBe('blocked');
    const promoted = { ...winterGardenHeldOut, heldOutAcceptanceStatus: 'passed', candidatePlacementVerified: true };
    expect((await validateDillonPitchedPlacementPrior(packet, { calibration, winterGardenHeldOut: promoted })).status).toBe('blocked');
  });
});
