import { describe, expect, it } from 'vitest';
import { buildOrthogonalGableBuildingModel } from '../src/engine/orthogonal-gable-building-model.js';

const skeleton = {
  status: 'passed', mainRidge: { from: [0, 50], to: [100, 50] },
  crossGables: [{ id: 'gable-1', axisXFt: 50, ridgeOuterFt: [50, 0], ridgeInnerFt: [50, 30], leftEaveFt: [40, 10], rightEaveFt: [60, 10] }],
};
const input = {
  footprintPlanFt: [[0, 0], [100, 0], [100, 100], [0, 100]], roofSkeleton: skeleton,
  floorElevationFt: 100, wallTopElevationFt: 111.5, mainBearingElevationFt: 115, mainRidgeElevationFt: 125,
  pitchRiseIn: 4, pitchRunIn: 12, sourceRefs: ['A103', 'A121', 'A201', 'A301'], unresolved: ['steeple'],
  features: [{ id: 'tower', kind: 'steeple', footprintPlanFt: [[90, 45], [98, 45], [98, 55], [90, 55]], baseElevationFt: 100, beamElevationFt: 128, topElevationFt: 155 }],
};

describe('buildOrthogonalGableBuildingModel', () => {
  it('extrudes the source footprint and replays main/cross-gable pitch exactly', () => {
    const model = buildOrthogonalGableBuildingModel(input);
    expect(model.status).toBe('passed');
    expect(model.walls).toHaveLength(4);
    expect(model.surfaces).toHaveLength(4);
    expect(model.mainRoof.bearingSouthYFt).toBe(20);
    expect(model.mainRoof.bearingNorthYFt).toBe(80);
    expect(model.verification.exactPitchReplay).toBe(true);
    expect(model.unresolved).toEqual(['steeple']);
    expect(model.features).toHaveLength(1);
    expect(model.complianceReady).toBe(false);
  });
  it('fails closed without an ordered source elevation stack', () => {
    const model = buildOrthogonalGableBuildingModel({ ...input, mainRidgeElevationFt: 110 });
    expect(model.status).toBe('blocked');
    expect(model.issues[0].code).toBe('BUILDING_ELEVATION_INPUT_INVALID');
  });
  it('fails closed without a passed roof skeleton', () => {
    const model = buildOrthogonalGableBuildingModel({ ...input, roofSkeleton: { ...skeleton, status: 'blocked' } });
    expect(model.status).toBe('blocked');
    expect(model.issues[0].code).toBe('BUILDING_ROOF_SKELETON_INVALID');
  });
  it('fails closed for a vertical feature without ordered source datums', () => {
    const model = buildOrthogonalGableBuildingModel({ ...input, features: [{ ...input.features[0], topElevationFt: 120 }] });
    expect(model.status).toBe('blocked');
    expect(model.issues[0].code).toBe('BUILDING_VERTICAL_FEATURE_INVALID');
  });
});
