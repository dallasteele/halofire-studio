import { describe, expect, it } from 'vitest';
import { deriveOrthogonalGableRoofSkeleton } from '../src/engine/orthogonal-gable-roof-skeleton.js';

const ridge = (x1, y1, x2, y2) => ({ x1, y1, x2, y2, strokeColor: '#555555', lineWidth: 0.36 });
const valley = (x1, y1, x2, y2) => ({ x1, y1, x2, y2, strokeColor: '#000000', lineWidth: 0.42 });

describe('deriveOrthogonalGableRoofSkeleton', () => {
  const source = [
    ridge(0, 50, 200, 50), ridge(0, 50.4, 200, 50.4),
    ridge(40, 0, 40, 34), ridge(39.7, 0, 39.7, 34),
    valley(40, 35, 20, 10), valley(40, 35, 60, 10),
    ridge(150, 100, 150, 66), ridge(150.4, 100, 150.4, 66),
    valley(150, 65, 130, 90), valley(150, 65, 170, 90),
    ridge(202, 45, 210, 45), ridge(202, 55, 210, 55), ridge(202, 45, 202, 55), ridge(210, 45, 210, 55),
  ];
  it('extracts the longest main ridge and opposing valley-paired cross gables', () => {
    const result = deriveOrthogonalGableRoofSkeleton(source, {
      ridgeStyle: { strokeColor: '#555555', lineWidth: 0.36 },
      valleyStyle: { strokeColor: '#000000', lineWidth: 0.42 },
      expectedGableCount: 2,
    });
    expect(result.status).toBe('passed');
    expect(result.mainRidge.from).toEqual([0, 50.2]);
    expect(result.mainRidge.to).toEqual([200, 50.2]);
    expect(result.crossGables).toHaveLength(2);
    expect(result.crossGables[0].ridgeInnerFt).toEqual([40, 35]);
    expect(result.crossGables[0].leftEaveFt).toEqual([20, 10]);
    expect(result.crossGables[0].rightEaveFt).toEqual([60, 10]);
    expect(result.roofFeatures).toHaveLength(1);
    expect(result.roofFeatures[0].centerFt).toEqual([206, 50]);
  });
  it('rejects a source that does not contain the expected paired gables', () => {
    const result = deriveOrthogonalGableRoofSkeleton(source.slice(0, 6), {
      ridgeStyle: { strokeColor: '#555555', lineWidth: 0.36 },
      valleyStyle: { strokeColor: '#000000', lineWidth: 0.42 },
      expectedGableCount: 2,
    });
    expect(result.status).toBe('blocked');
    expect(result.issues[0].code).toBe('ROOF_CROSS_GABLE_COUNT_MISMATCH');
  });
  it('does not promote diagonal linework that lacks opposed arms', () => {
    const result = deriveOrthogonalGableRoofSkeleton([
      ridge(0, 50, 200, 50), ridge(40, 0, 40, 34), valley(40, 35, 20, 10),
    ], {
      ridgeStyle: { strokeColor: '#555555', lineWidth: 0.36 },
      valleyStyle: { strokeColor: '#000000', lineWidth: 0.42 },
      expectedGableCount: 1,
    });
    expect(result.status).toBe('blocked');
    expect(result.counts.crossGables).toBe(0);
  });
});
