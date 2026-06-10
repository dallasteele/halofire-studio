/**
 * Pipe schedule sizing constants and utilities.
 * EXACTLY as specified: SCH40 internal diameters, nominal sizes, velocity formula.
 */

/** Internal diameters (inches) for SCH40 pipe nominal sizes. */
export const SCH40_ID_IN: Record<number, number> = {
  1: 1.049,
  1.25: 1.380,
  1.5: 1.610,
  2: 2.067,
  2.5: 2.469,
  3: 3.068,
  4: 4.026,
  6: 6.065,
  8: 7.981,
};

/** Ascending list of nominal pipe sizes (inches). */
export const NOMINAL_SIZES_IN: number[] = [1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8];

/**
 * Calculate velocity in feet per second (fps) from flow rate (gpm) and nominal pipe size.
 * Formula: V = 0.4085 * Q / (d_in^2)
 * @param gpm - Flow rate in gallons per minute (must be positive finite)
 * @param nominalIn - Nominal pipe size (must be in SCH40_ID_IN keys)
 * @returns Velocity in fps
 * @throws Error for invalid gpm or unknown nominal size
 */
export function velocityFps(gpm: number, nominalIn: number): number {
  if (!Number.isFinite(gpm) || gpm <= 0) {
    throw new Error('gpm must be positive finite');
  }
  const idIn = SCH40_ID_IN[nominalIn];
  if (idIn === undefined) {
    throw new Error(`Unknown nominal size: ${nominalIn}`);
  }
  return 0.4085 * gpm / (idIn * idIn);
}

/**
 * Result of pipe size selection.
 */
export interface SizePick {
  nominalIn: number;
  velocityFps: number;
  withinLimit: boolean;
}

/**
 * Pick the smallest nominal pipe size whose velocity is <= maxVelocityFps.
 * If no size qualifies, return the largest (8) with withinLimit=false.
 * @param gpm - Flow rate in gallons per minute (must be positive finite)
 * @param maxVelocityFps - Maximum allowable velocity (must be positive finite)
 * @returns SizePick object
 * @throws Error for invalid gpm or maxVelocityFps
 */
export function pickPipeSize(gpm: number, maxVelocityFps: number): SizePick {
  if (!Number.isFinite(gpm) || gpm <= 0) {
    throw new Error('gpm must be positive finite');
  }
  if (!Number.isFinite(maxVelocityFps) || maxVelocityFps <= 0) {
    throw new Error('maxVelocityFps must be positive finite');
  }

  // Calculate velocity for each nominal size in ascending order
  for (const size of NOMINAL_SIZES_IN) {
    const velocity = velocityFps(gpm, size);
    if (velocity <= maxVelocityFps) {
      return { nominalIn: size, velocityFps: velocity, withinLimit: true };
    }
  }

  // No size qualified, return largest (8) with withinLimit=false
  const largestSize = 8;
  const velocity = velocityFps(gpm, largestSize);
  return { nominalIn: largestSize, velocityFps: velocity, withinLimit: false };
}