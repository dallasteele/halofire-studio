// @ts-nocheck — agent-loop tier-0: test is RUNTIME-gated by vitest; src module stays strictly typed
import { describe, expect, it } from 'vitest';
import {
  SCH40_ID_IN,
  NOMINAL_SIZES_IN,
  velocityFps,
  pickPipeSize,
  SizePick,
} from '../src/lib/pipe-sizing';

/**
 * Test the velocity calculation formula.
 * Exact values from spec: velocityFps(100, 2) = 0.4085 * 100 / (2.067^2) ≈ 9.56
 */
describe('velocityFps', () => {
  it('calculates velocity correctly for known values', () => {
    expect(velocityFps(100, 2)).toBeCloseTo(9.56, 2);
  });

  it('throws for non-finite gpm', () => {
    expect(() => velocityFps(NaN, 2)).toThrow();
    expect(() => velocityFps(Infinity, 2)).toThrow();
  });

  it('throws for non-positive gpm', () => {
    expect(() => velocityFps(0, 2)).toThrow();
    expect(() => velocityFps(-1, 2)).toThrow();
  });

  it('throws for unknown nominal size', () => {
    expect(() => velocityFps(100, 0)).toThrow();
  });
});

/**
 * Test pipe size selection logic.
 */
describe('pickPipeSize', () => {
  it('picks smallest size with velocity <= maxVelocity', () => {
    const result = pickPipeSize(100, 10);
    expect(result).toEqual({
      nominalIn: 2,
      velocityFps: expect.closeTo(9.56, 0.01),
      withinLimit: true,
    });
  });

  it('picks size 1 for low flow', () => {
    const result = pickPipeSize(20, 10);
    expect(result.nominalIn).toBe(1);
  });

  it('returns largest size (8) when no size qualifies', () => {
    const result = pickPipeSize(10000, 5);
    expect(result.nominalIn).toBe(8);
    expect(result.withinLimit).toBe(false);
  });

  it('throws for non-finite maxVelocityFps', () => {
    expect(() => pickPipeSize(100, NaN)).toThrow();
    expect(() => pickPipeSize(100, Infinity)).toThrow();
  });

  it('throws for non-positive maxVelocityFps', () => {
    expect(() => pickPipeSize(100, 0)).toThrow();
    expect(() => pickPipeSize(100, -1)).toThrow();
  });

  it('throws for negative gpm', () => {
    expect(() => pickPipeSize(-1, 10)).toThrow();
  });
});