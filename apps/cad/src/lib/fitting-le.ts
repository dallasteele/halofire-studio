/**
 * Hydraulics fitting equivalent lengths for Hazen-Williams (C=120, schedule-40).
 * Cited: Verify adopted edition.
 */

export type FittingType = 'TEE_BRANCH' | 'ELBOW_90' | 'GATE_VALVE';

export const FITTING_LE_FT: Record<FittingType, Record<number, number>> = {
  TEE_BRANCH: {
    1: 5,
    1.25: 6,
    1.5: 8,
    2: 10,
    2.5: 12,
    3: 15,
    4: 20,
    6: 30,
    8: 35
  },
  ELBOW_90: {
    1: 2,
    1.25: 3,
    1.5: 4,
    2: 5,
    2.5: 6,
    3: 7,
    4: 10,
    6: 14,
    8: 18
  },
  GATE_VALVE: {
    1: 1,
    1.25: 1,
    1.5: 1,
    2: 1,
    2.5: 1,
    3: 1,
    4: 2,
    6: 3,
    8: 4
  }
};

export const FITTING_LE_CITATION = 'Verify adopted edition';

/**
 * Get equivalent length in feet for a fitting.
 * @param type Fitting type.
 * @param nominalIn Nominal size in inches.
 * @returns Equivalent length in feet.
 * @throws {Error} If type or nominal size is unknown.
 */
export function equivalentLengthFt(type: FittingType, nominalIn: number): number {
  const sizes = FITTING_LE_FT[type];
  if (!sizes) {
    throw new Error('Unknown fitting type');
  }
  const length = sizes[nominalIn];
  if (length === undefined || !Number.isFinite(length)) {
    throw new Error('Unknown nominal size');
  }
  return length;
}

/**
 * Calculate total equivalent length from an array of fittings.
 * @param fittings Array of fittings with type and nominal size.
 * @returns Sum of equivalent lengths in feet.
 * @throws {Error} If any fitting has unknown type or nominal size.
 */
export function totalEquivalentLengthFt(fittings: Array<{ type: FittingType; nominalIn: number }>): number {
  return fittings.reduce((sum, fitting) => {
    return sum + equivalentLengthFt(fitting.type, fitting.nominalIn);
  }, 0);
}