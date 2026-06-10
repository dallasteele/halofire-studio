// W4C fitting-orient — Y-rotation placement math for tee/elbow STEP bodies.

import { describe, expect, it } from 'vitest';
import {
  elbowRotationY,
  isOrthogonal,
  normalize,
  teeRotationY,
} from '../src/lib/fitting-orient';

const X = { x: 1, y: 0, z: 0 };
const NX = { x: -1, y: 0, z: 0 };
const Z = { x: 0, y: 0, z: 1 };

describe('normalize', () => {
  it('unit-length output; throws on zero vector', () => {
    const n = normalize({ x: 3, y: 0, z: 4 });
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 12);
    expect(() => normalize({ x: 0, y: 0, z: 0 })).toThrow();
  });
});

describe('elbowRotationY', () => {
  it('+X leg already aligned -> 0', () => {
    expect(elbowRotationY(X, Z)).toBeCloseTo(0, 12);
  });
  it('+Z direction -> -PI/2', () => {
    expect(elbowRotationY(Z, X)).toBeCloseTo(-Math.PI / 2, 12);
  });
  it('-X direction -> |PI|', () => {
    expect(Math.abs(elbowRotationY(NX, Z))).toBeCloseTo(Math.PI, 12);
  });
  it('throws on non-horizontal directions', () => {
    expect(() => elbowRotationY({ x: 0, y: 1, z: 0 }, X)).toThrow();
    expect(() => elbowRotationY(X, { x: 0.1, y: 0.9, z: 0 })).toThrow();
  });
});

describe('teeRotationY', () => {
  it('run +X, branch +Z -> rotation 0 and orthogonal', () => {
    expect(teeRotationY(X, Z)).toBeCloseTo(0, 12);
    expect(isOrthogonal(X, Z)).toBe(true);
  });
  it('throws when branch is parallel to run', () => {
    expect(() => teeRotationY(X, X)).toThrow();
    expect(() => teeRotationY(X, NX)).toThrow();
  });
});

describe('isOrthogonal', () => {
  it('respects the tolerance window', () => {
    const nearly = { x: Math.cos((87 * Math.PI) / 180), y: 0, z: Math.sin((87 * Math.PI) / 180) };
    expect(isOrthogonal(X, nearly, 5)).toBe(true);
    expect(isOrthogonal(X, nearly, 1)).toBe(false);
    expect(isOrthogonal(X, X)).toBe(false);
  });
});
