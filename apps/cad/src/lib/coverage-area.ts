export interface Pt {
  x: number;
  y: number;
}

export interface CoverageCell {
  center: Pt;
  sideFt: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  areaSqFt: number;
}

/**
 * Creates a coverage cell centered at (cx, cy) with side length `sideFt` (ft).
 * @param center - The center point of the cell.
 * @param sideFt - The side length of the square cell (must be finite and positive).
 * @returns The coverage cell with computed bounds and area.
 * @throws {Error} If center coordinates are not finite or sideFt is not finite or <= 0.
 */
export function coverageCell(center: Pt, sideFt: number): CoverageCell {
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    throw new Error('Center coordinates must be finite');
  }
  if (!Number.isFinite(sideFt) || sideFt <= 0) {
    throw new Error('Side length must be finite and positive');
  }

  const halfSide = sideFt / 2;
  return {
    center,
    sideFt,
    minX: center.x - halfSide,
    minY: center.y - halfSide,
    maxX: center.x + halfSide,
    maxY: center.y + halfSide,
    areaSqFt: sideFt * sideFt
  };
}

/**
 * Checks if two coverage cells overlap (strict axis-aligned overlap).
 * @param a - First coverage cell.
 * @param b - Second coverage cell.
 * @returns True if cells overlap (edges touching does not count as overlap).
 */
export function cellsOverlap(a: CoverageCell, b: CoverageCell): boolean {
  return a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY;
}

/**
 * Checks if the area of a coverage cell (sideFt^2) is within a maximum limit.
 * @param sideFt - The side length of the cell (must be positive).
 * @param maxProtectionSqFt - The maximum allowed area (must be positive).
 * @returns True if sideFt^2 <= maxProtectionSqFt.
 * @throws {Error} If sideFt <= 0 or maxProtectionSqFt <= 0.
 */
export function maxAreaWithinLimit(sideFt: number, maxProtectionSqFt: number): boolean {
  if (sideFt <= 0) {
    throw new Error('Side length must be positive');
  }
  if (maxProtectionSqFt <= 0) {
    throw new Error('Maximum protection area must be positive');
  }

  return sideFt * sideFt <= maxProtectionSqFt;
}