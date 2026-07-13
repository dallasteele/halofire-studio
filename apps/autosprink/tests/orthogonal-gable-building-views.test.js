import { describe, expect, it } from 'vitest';
import { buildOrthogonalGableBuildingModel } from '../src/engine/orthogonal-gable-building-model.js';
import { renderOrthogonalGableBuildingViews } from '../src/engine/orthogonal-gable-building-views.js';

describe('renderOrthogonalGableBuildingViews', () => {
  it('renders source floor and pitched surfaces into top and isometric SVG views', () => {
    const model = buildOrthogonalGableBuildingModel({
      footprintPlanFt: [[0, 0], [100, 0], [100, 100], [0, 100]],
      roofSkeleton: { status: 'passed', mainRidge: { from: [0, 50], to: [100, 50] }, crossGables: [{ id: 'gable-1', axisXFt: 50, ridgeOuterFt: [50, 0], ridgeInnerFt: [50, 30], leftEaveFt: [40, 10], rightEaveFt: [60, 10] }] },
      floorElevationFt: 100, wallTopElevationFt: 111.5, mainBearingElevationFt: 115, mainRidgeElevationFt: 125,
      pitchRiseIn: 4, pitchRunIn: 12, rooms: [{ poly: [[10, 10], [30, 10], [30, 30], [10, 30]], kind: 'office' }],
      features: [{ id: 'tower', kind: 'steeple', footprintPlanFt: [[90, 45], [98, 45], [98, 55], [90, 55]], baseElevationFt: 100, beamElevationFt: 128, topElevationFt: 155 }],
    });
    const views = renderOrthogonalGableBuildingViews(model);
    expect(views.status).toBe('passed');
    expect(views.isometricSvg).toContain('PDF TO 3D');
    expect(views.isometricSvg).toContain('cross-gable-roof');
    expect(views.isometricSvg).toContain('steeple-spire');
    expect(views.topSvg).toContain('SOURCE PLAN REGISTRATION');
    expect(views.complianceReady).toBe(false);
  });
  it('fails closed for a blocked model', () => {
    expect(renderOrthogonalGableBuildingViews({ status: 'blocked' }).status).toBe('blocked');
  });
});
