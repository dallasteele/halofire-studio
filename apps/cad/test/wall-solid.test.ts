import { wallSolid } from '../src/lib/wall-solid';

describe('wallSolid', () => {
  it('should create a wall from (0,0) to (10,0) with thickness 1, height 8', () => {
    const result = wallSolid({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, 8);
    expect(result.vertexCount).toBe(8);
    expect(result.positions.length).toBe(24);
    expect(result.positions[2]).toBeCloseTo(0); // Bottom z=0
    expect(result.positions[5]).toBeCloseTo(0); // Bottom z=0
    expect(result.positions[8]).toBeCloseTo(0); // Bottom z=0
    expect(result.positions[11]).toBeCloseTo(0); // Bottom z=0
    expect(result.positions[14]).toBeCloseTo(8); // Top z=8
    expect(result.positions[17]).toBeCloseTo(8); // Top z=8
    expect(result.positions[20]).toBeCloseTo(8); // Top z=8
    expect(result.positions[23]).toBeCloseTo(8); // Top z=8
    expect(result.positions[1]).toBeCloseTo(0.5); // Left y=0.5
    expect(result.positions[4]).toBeCloseTo(-0.5); // Right y=-0.5
    expect(result.positions[7]).toBeCloseTo(-0.5); // Right y=-0.5
    expect(result.positions[10]).toBeCloseTo(0.5); // Left y=0.5
    expect(result.indices.length).toBe(36);
    for (const index of result.indices) {
      expect(index).toBeLessThan(8);
    }
  });

  it('should handle diagonal wall (3-4-5 triangle)', () => {
    const result = wallSolid({ x: 0, y: 0 }, { x: 3, y: 4 }, 1, 1);
    const dx = 3, dy = 4;
    const length = 5;
    const normalX = -dy / length;
    const normalY = dx / length;
    const halfThickness = 0.5;

    const expectedLeft = { x: 0 + normalX * halfThickness, y: 0 + normalY * halfThickness };
    const expectedRight = { x: 0 - normalX * halfThickness, y: 0 - normalY * halfThickness };

    expect(result.positions[0]).toBeCloseTo(expectedLeft.x);
    expect(result.positions[1]).toBeCloseTo(expectedLeft.y);
    expect(result.positions[3]).toBeCloseTo(expectedRight.x);
    expect(result.positions[4]).toBeCloseTo(expectedRight.y);
  });

  it('should throw on zero-length segment', () => {
    expect(() => wallSolid({ x: 0, y: 0 }, { x: 0, y: 0 }, 1, 1)).toThrow('Zero-length segment');
  });

  it('should throw on non-finite inputs', () => {
    expect(() => wallSolid({ x: 0, y: 0 }, { x: 1, y: 1 }, NaN, 1)).toThrow('Invalid input: non-finite or non-positive thickness/height');
    expect(() => wallSolid({ x: 0, y: 0 }, { x: 1, y: 1 }, 1, NaN)).toThrow('Invalid input: non-finite or non-positive thickness/height');
    expect(() => wallSolid({ x: 0, y: 0 }, { x: 1, y: 1 }, -1, 1)).toThrow('Invalid input: non-finite or non-positive thickness/height');
    expect(() => wallSolid({ x: 0, y: 0 }, { x: 1, y: 1 }, 1, -1)).toThrow('Invalid input: non-finite or non-positive thickness/height');
  });
});
