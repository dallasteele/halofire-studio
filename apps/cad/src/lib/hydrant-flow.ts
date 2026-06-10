/**
 * Hydrant Flow Calculator for smoothbore nozzles (NFPA 291 style).
 * Formula: Q = 29.83 * c * d^2 * sqrt(P), where:
 *   Q = flow rate in gpm,
 *   c = discharge coefficient (0 < c <= 1),
 *   d = orifice diameter in inches,
 *   P = pitot pressure in psi.
 */

export const SMOOTHBORE_CONSTANT = 29.83;

export interface HydrantFlowInput {
  coefficient: number;
  diameterIn: number;
  pitotPsi: number;
}

export interface HydrantFlowResult {
  flowGpm: number;
  formula: 'Q = 29.83 * c * d^2 * sqrt(P)';
  input: HydrantFlowInput;
}

/**
 * Calculates hydrant flow using smoothbore nozzle discharge formula.
 * @param input - Input parameters for the calculation.
 * @throws {Error} If input values are invalid (non-finite, non-positive diameter/pitot, or coefficient outside (0, 1]).
 */
export function hydrantFlow(input: HydrantFlowInput): HydrantFlowResult {
  const { coefficient, diameterIn, pitotPsi } = input;

  // Validate input values
  if (!Number.isFinite(coefficient) || coefficient <= 0 || coefficient > 1) {
    throw new Error('Coefficient must be in (0, 1]');
  }
  if (!Number.isFinite(diameterIn) || diameterIn <= 0) {
    throw new Error('Diameter must be a positive finite number');
  }
  if (!Number.isFinite(pitotPsi) || pitotPsi < 0) {
    throw new Error('Pitot pressure must be a non-negative finite number');
  }

  // Calculate flow using the formula
  const flowGpm = SMOOTHBORE_CONSTANT * coefficient * Math.pow(diameterIn, 2) * Math.sqrt(pitotPsi);

  return {
    flowGpm,
    formula: 'Q = 29.83 * c * d^2 * sqrt(P)',
    input
  };
}