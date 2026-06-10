import { describe, expect, it } from 'vitest';
import { hydrantFlow, HydrantFlowInput, SMOOTHBORE_CONSTANT } from '../src/lib/hydrant-flow';

const validInput: HydrantFlowInput = {
  coefficient: 0.9,
  diameterIn: 2.5,
  pitotPsi: 36
};

const expectedFlow = SMOOTHBORE_CONSTANT * validInput.coefficient * Math.pow(validInput.diameterIn, 2) * Math.sqrt(validInput.pitotPsi);

describe('hydrantFlow', () => {
  it('calculates flow correctly for valid input', () => {
    const result = hydrantFlow(validInput);
    expect(result.flowGpm).toBeCloseTo(expectedFlow, 4);
    expect(result.formula).toBe('Q = 29.83 * c * d^2 * sqrt(P)');
    expect(result.input).toEqual(validInput);
  });

  it('accepts coefficient at upper bound (1)', () => {
    const input = { ...validInput, coefficient: 1 };
    const result = hydrantFlow(input);
    expect(result.flowGpm).toBeCloseTo(expectedFlow * (1 / 0.9), 4);
  });

  describe('throws for invalid inputs', () => {
    const invalidInputs: Array<{ input: HydrantFlowInput; message: string }> = [
      { input: { ...validInput, coefficient: 0 }, message: 'Coefficient must be in (0, 1]' },
      { input: { ...validInput, coefficient: 1.1 }, message: 'Coefficient must be in (0, 1]' },
      { input: { ...validInput, diameterIn: 0 }, message: 'Diameter must be a positive finite number' },
      { input: { ...validInput, diameterIn: -1 }, message: 'Diameter must be a positive finite number' },
      { input: { ...validInput, pitotPsi: -1 }, message: 'Pitot pressure must be a non-negative finite number' },
      { input: { ...validInput, pitotPsi: NaN }, message: 'Pitot pressure must be a non-negative finite number' },
      { input: { ...validInput, diameterIn: NaN }, message: 'Diameter must be a positive finite number' },
      { input: { ...validInput, coefficient: NaN }, message: 'Coefficient must be in (0, 1]' }
    ];

    invalidInputs.forEach(({ input, message }) => {
      it(`throws for ${message}`, () => {
        expect(() => hydrantFlow(input)).toThrowError(message);
      });
    });
  });
});