import { describe, expect, it } from 'vitest';
import {
  clipSegmentsToBounds,
  dimensionViewportFootprint,
  deriveOverallDimensionViewport,
  parseArchitecturalDimensionFt,
  verifyDimensionViewportWallSupport,
} from '../src/engine/dimension-plan.js';

const horizontal = (s, xPt, yPt) => ({ s, xPt, yPt, transform: [10, 0, 0, 10, xPt, yPt] });
const vertical = (s, xPt, yPt) => ({ s, xPt, yPt, transform: [0, 10, -10, 0, xPt, yPt] });

describe('dimension-plan source viewport', () => {
  it('parses architectural dimension strings without accepting malformed inches', () => {
    expect(parseArchitecturalDimensionFt('201\'-8"')).toBeCloseTo(201 + 8 / 12, 5);
    expect(parseArchitecturalDimensionFt('90\' - 8 1/2"')).toBeCloseTo(90 + 8.5 / 12, 5);
    expect(parseArchitecturalDimensionFt('12\'')).toBe(12);
    expect(parseArchitecturalDimensionFt('10\'-14"')).toBeNull();
    expect(parseArchitecturalDimensionFt('NOT A DIMENSION')).toBeNull();
  });

  it('derives a sealed viewport from orthogonal overall dimensions', () => {
    const result = deriveOverallDimensionViewport([
      horizontal('201\'-8"', 1000, 400),
      vertical('90\'-8"', 100, 800),
      vertical('90\'-8"', 1900, 800),
      horizontal('12\'-0"', 500, 500),
    ], { scaleFtPerUnit: 1 / 9, minOverallFt: 80 });
    expect(result.widthFt).toBeCloseTo(201 + 8 / 12, 5);
    expect(result.heightFt).toBeCloseTo(90 + 8 / 12, 5);
    expect(result.centerFt).toEqual([111.111111, 88.888889]);
    expect(result.evidence.vertical).toHaveLength(2);
  });

  it('fails closed when only one dimension axis is available', () => {
    expect(() => deriveOverallDimensionViewport([
      horizontal('201\'-8"', 1000, 400),
      horizontal('90\'-8"', 1000, 800),
    ], { scaleFtPerUnit: 1 / 9, minOverallFt: 80 })).toThrow(/orthogonal/);
  });

  it('clips crossing segments at the dimension boundary and preserves metadata', () => {
    expect(clipSegmentsToBounds([
      { x1: -5, y1: 5, x2: 15, y2: 5, lineWidth: 2 },
      { x1: -5, y1: -5, x2: -1, y2: -1, lineWidth: 1 },
    ], { minX: 0, minY: 0, maxX: 10, maxY: 10 })).toEqual([
      { x1: 0, y1: 5, x2: 10, y2: 5, lineWidth: 2 },
    ]);
  });

  it('creates a closed exact footprint and independently requires support on every side', () => {
    const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 10 };
    expect(dimensionViewportFootprint(bounds)).toEqual([[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]);
    const passed = verifyDimensionViewportWallSupport([
      { x1: 0, y1: 0, x2: 20, y2: 0 }, { x1: 0, y1: 10, x2: 20, y2: 10 },
      { x1: 0, y1: 0, x2: 0, y2: 10 }, { x1: 20, y1: 0, x2: 20, y2: 10 },
      { x1: -5, y1: 5, x2: 25, y2: 5 },
    ], bounds);
    expect(passed.status).toBe('passed');
    const blocked = verifyDimensionViewportWallSupport([
      { x1: 0, y1: 0, x2: 20, y2: 0 }, { x1: 0, y1: 10, x2: 20, y2: 10 },
      { x1: 0, y1: 0, x2: 0, y2: 10 },
    ], bounds);
    expect(blocked).toMatchObject({ status: 'blocked', unsupportedSides: ['right'] });
  });
});
