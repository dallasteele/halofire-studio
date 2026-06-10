import { coverageCell, cellsOverlap, maxAreaWithinLimit } from '../src/lib/coverage-area';

const testPt = { x: 0, y: 0 };

describe('coverageCell', () => {
  it('creates correct bounds and area for valid input', () => {
    const cell = coverageCell(testPt, 12);
    expect(cell).toEqual({
      center: testPt,
      sideFt: 12,
      minX: -6,
      minY: -6,
      maxX: 6,
      maxY: 6,
      areaSqFt: 144
    });
  });

  it('throws for non-finite center coordinates', () => {
    expect(() => coverageCell({ x: Infinity, y: 0 }, 12)).toThrow('Center coordinates must be finite');
    expect(() => coverageCell({ x: 0, y: Infinity }, 12)).toThrow('Center coordinates must be finite');
    expect(() => coverageCell({ x: NaN, y: 0 }, 12)).toThrow('Center coordinates must be finite');
  });

  it('throws for non-finite or non-positive sideFt', () => {
    expect(() => coverageCell(testPt, Infinity)).toThrow('Side length must be finite and positive');
    expect(() => coverageCell(testPt, NaN)).toThrow('Side length must be finite and positive');
    expect(() => coverageCell(testPt, 0)).toThrow('Side length must be finite and positive');
    expect(() => coverageCell(testPt, -12)).toThrow('Side length must be finite and positive');
  });
});

describe('cellsOverlap', () => {
  it('does not overlap when edges touch', () => {
    const a = coverageCell({ x: 0, y: 0 }, 12);
    const b = coverageCell({ x: 12, y: 0 }, 12);
    expect(cellsOverlap(a, b)).toBe(false);
  });

  it('overlaps when centers are closer than sideFt', () => {
    const a = coverageCell({ x: 0, y: 0 }, 12);
    const b = coverageCell({ x: 10, y: 0 }, 12);
    expect(cellsOverlap(a, b)).toBe(true);
  });
});

describe('maxAreaWithinLimit', () => {
  it('returns true when area is within limit', () => {
    expect(maxAreaWithinLimit(12, 225)).toBe(true);
  });

  it('returns false when area exceeds limit', () => {
    expect(maxAreaWithinLimit(16, 225)).toBe(false);
  });

  it('throws for non-positive sideFt', () => {
    expect(() => maxAreaWithinLimit(0, 225)).toThrow('Side length must be positive');
    expect(() => maxAreaWithinLimit(-12, 225)).toThrow('Side length must be positive');
  });

  it('throws for non-positive maxProtectionSqFt', () => {
    expect(() => maxAreaWithinLimit(12, 0)).toThrow('Maximum protection area must be positive');
    expect(() => maxAreaWithinLimit(12, -225)).toThrow('Maximum protection area must be positive');
  });
});
