// @ts-nocheck — agent-loop tier-0: test is RUNTIME-gated by vitest; src module stays strictly typed
import { FITTING_LE_FT, FITTING_LE_CITATION, equivalentLengthFt, totalEquivalentLengthFt } from '../src/lib/fitting-le';
import { describe, it, expect } from 'vitest';

const validFittings = [
  { type: 'TEE_BRANCH', nominalIn: 4 },
  { type: 'ELBOW_90', nominalIn: 2 },
  { type: 'GATE_VALVE', nominalIn: 2 }
];

const invalidFittingTypes = ['INVALID_TYPE', 'TEE_BRANCH'] as const;
const invalidNominalSizes = [0, 9, 10];

describe('Fitting equivalent lengths', () => {
  it('should return correct length for TEE_BRANCH 4', () => {
    expect(equivalentLengthFt('TEE_BRANCH', 4)).toBe(20);
  });

  it('should return correct length for ELBOW_90 2', () => {
    expect(equivalentLengthFt('ELBOW_90', 2)).toBe(5);
  });

  it('should return correct length for GATE_VALVE 2', () => {
    expect(equivalentLengthFt('GATE_VALVE', 2)).toBe(1);
  });

  it('should sum equivalent lengths correctly', () => {
    expect(totalEquivalentLengthFt(validFittings)).toBe(20 + 5 + 1);
  });

  it('should throw on unknown fitting type', () => {
    expect(() => equivalentLengthFt('INVALID_TYPE' as any, 2)).toThrow();
  });

  it('should throw on unknown nominal size', () => {
    expect(() => equivalentLengthFt('TEE_BRANCH', 9)).toThrow();
  });

  it('should throw on invalid nominal size (non-numeric)', () => {
    expect(() => equivalentLengthFt('TEE_BRANCH', NaN)).toThrow();
  });

  it('should throw on invalid nominal size (negative)', () => {
    expect(() => equivalentLengthFt('TEE_BRANCH', -1)).toThrow();
  });

  it('should throw on invalid nominal size (zero)', () => {
    expect(() => equivalentLengthFt('TEE_BRANCH', 0)).toThrow();
  });

  it('should throw on invalid type in totalEquivalentLengthFt', () => {
    expect(() => totalEquivalentLengthFt([{ type: 'INVALID_TYPE', nominalIn: 2 } as any])).toThrow();
  });

  it('should throw on invalid nominal size in totalEquivalentLengthFt', () => {
    expect(() => totalEquivalentLengthFt([{ type: 'TEE_BRANCH', nominalIn: 9 }])).toThrow();
  });

  it('should contain citation string', () => {
    expect(FITTING_LE_CITATION).toContain('Verify adopted edition');
  });
});