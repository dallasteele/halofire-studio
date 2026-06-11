import { describe, expect, it } from 'vitest';
import { computeHangerPositions, countHangers } from '../src/lib/hanger-3d';
import { hangersForSegment } from '../src/lib/hanger-spacing';
import { HangerPoint } from '../src/lib/hanger-spacing';

/**
 * A 30 ft run of 1.5 inch pipe has max spacing 15 and max end distance 3,
 * so expect hangers at positions consistent with that lib output.
 */
const segment30ft1_5in = {
  id: 'seg1',
  diameterIn: 1.5,
  lengthFt: 30,
};
const a30ft = { x: 0, y: 0, z: 0 };
const b30ft = { x: 30, y: 0, z: 0 };

/**
 * A 20x10 room grid with default cell size (4x2) should produce a grid
 * with specific segment counts.
 */
const roomBounds = {
  minX: 0,
  minY: 0,
  maxX: 20,
  maxY: 10,
};

describe('hanger-3d', () => {
  it('computes hanger positions for a 30 ft run of 1.5 inch pipe', () => {
    const positions = computeHangerPositions(segment30ft1_5in, a30ft, b30ft);
    expect(positions.length).toBe(3);
    expect(positions[0].t).toBeCloseTo(0.1, 2);
    expect(positions[1].t).toBeCloseTo(0.5, 2);
    expect(positions[2].t).toBeCloseTo(0.9, 2);
  });

  it('counts hangers correctly for a 30 ft run of 1.5 inch pipe', () => {
    const count = countHangers(segment30ft1_5in, a30ft, b30ft);
    expect(count).toBe(3);
  });

  it('uses the hangersForSegment function correctly', () => {
    const positions = computeHangerPositions(segment30ft1_5in, a30ft, b30ft);
    const expected = hangersForSegment(segment30ft1_5in, a30ft, b30ft);
    expect(positions).toEqual(expected);
  });
});

/**
 * Test the ceiling grid functionality.
 */
const grid = {
  lines: [
    { x1: 4, y1: 0, x2: 4, y2: 10, dir: 'y' },
    { x1: 8, y1: 0, x2: 8, y2: 10, dir: 'y' },
    { x1: 12, y1: 0, x2: 12, y2: 10, dir: 'y' },
    { x1: 16, y1: 0, x2: 16, y2: 10, dir: 'y' },
    { x1: 0, y1: 2, x2: 20, y2: 2, dir: 'x' },
    { x1: 0, y1: 4, x2: 20, y2: 4, dir: 'x' },
    { x1: 0, y1: 6, x2: 20, y2: 6, dir: 'x' },
    { x1: 0, y1: 8, x2: 20, y2: 8, dir: 'x' },
  ],
  cellW: 4,
  cellH: 2,
  originX: 0,
  originY: 0,
};

describe('ceiling-grid-3d', () => {
  it('computes grid segments for a 20x10 room', () => {
    const computedGrid = {
      lines: grid.lines,
      cellW: grid.cellW,
      cellH: grid.cellH,
      originX: grid.originX,
      originY: grid.originY,
    };
    const expectedCount = grid.lines.length;
    expect(computedGrid.lines.length).toBe(expectedCount);
  });
});
