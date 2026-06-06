// scale.ts contract tests — the operator-verifiable scale that replaces the blind
// magic factor. Two-point scale, measurement, and shoelace area correctness.

import { describe, expect, it } from 'vitest';
import {
  distanceUnits,
  measureFeet,
  polygonAreaSqFt,
  setScaleFromTwoPoints,
  shoelaceAreaUnits,
} from '../src/lib/scale';

describe('setScaleFromTwoPoints', () => {
  it('100 units known to be 25 ft apart -> 0.25 ft/unit', () => {
    const ft = setScaleFromTwoPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 25);
    expect(ft).toBeCloseTo(0.25, 10);
  });

  it('works on a diagonal (3-4-5 -> 5 units known as 10 ft -> 2 ft/unit)', () => {
    const ft = setScaleFromTwoPoints({ x: 0, y: 0 }, { x: 3, y: 4 }, 10);
    expect(ft).toBeCloseTo(2, 10);
  });

  it('throws when the two points coincide (no measurable distance)', () => {
    expect(() => setScaleFromTwoPoints({ x: 5, y: 5 }, { x: 5, y: 5 }, 10)).toThrow();
  });

  it('throws on a non-positive known distance (never guesses a fallback)', () => {
    expect(() => setScaleFromTwoPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toThrow();
    expect(() => setScaleFromTwoPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, -3)).toThrow();
    expect(() =>
      setScaleFromTwoPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, Number.NaN),
    ).toThrow();
  });
});

describe('distanceUnits / measureFeet', () => {
  it('distanceUnits is plain Euclidean', () => {
    expect(distanceUnits({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('measureFeet scales distance by ftPerUnit', () => {
    expect(measureFeet({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.25)).toBeCloseTo(25, 10);
  });

  it('measureFeet returns 0 for a missing/invalid scale (honest, no crash)', () => {
    expect(measureFeet({ x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toBe(0);
    expect(measureFeet({ x: 0, y: 0 }, { x: 100, y: 0 }, -1)).toBe(0);
  });
});

describe('shoelace area', () => {
  it('a 10x10 square is 100 sq units', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(Math.abs(shoelaceAreaUnits(sq))).toBeCloseTo(100, 10);
  });

  it('a right triangle (base 6, height 8) is 24 sq units', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 0, y: 8 },
    ];
    expect(Math.abs(shoelaceAreaUnits(tri))).toBeCloseTo(24, 10);
  });

  it('returns 0 for fewer than 3 points', () => {
    expect(shoelaceAreaUnits([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });
});

describe('polygonAreaSqFt', () => {
  it('a 40x40 unit square at 0.25 ft/unit is 100 sq ft (10ft x 10ft)', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ];
    // 40*40 = 1600 sq units * 0.25^2 = 100 sq ft.
    expect(polygonAreaSqFt(sq, 0.25)).toBeCloseTo(100, 8);
  });

  it('area is winding-independent (CW vs CCW give the same magnitude)', () => {
    const ccw = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const cw = [...ccw].reverse();
    expect(polygonAreaSqFt(ccw, 1)).toBeCloseTo(polygonAreaSqFt(cw, 1), 10);
  });

  it('returns 0 for a degenerate polygon or missing scale (honest empty)', () => {
    expect(polygonAreaSqFt([{ x: 0, y: 0 }], 1)).toBe(0);
    expect(
      polygonAreaSqFt(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        0,
      ),
    ).toBe(0);
  });
});
