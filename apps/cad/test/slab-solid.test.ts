// W4B slab-solid — horizontal slab mesh from a room polygon (fan triangulation).

import { describe, expect, it } from 'vitest';
import { slabSolid } from '../src/lib/slab-solid';

const SQUARE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('slabSolid — unit square at elevation 0, thickness 0.5', () => {
  const m = slabSolid(SQUARE, 0, 0.5);

  it('has 2N vertices and (N-2)*6 + N*6 indices', () => {
    expect(m.vertexCount).toBe(8);
    expect(m.positions).toHaveLength(24);
    expect(m.indices).toHaveLength(36); // (4-2)*3*2 + 4*6
  });

  it('top ring at y=0, bottom ring at y=-0.5', () => {
    const ys = [];
    for (let i = 1; i < m.positions.length; i += 3) ys.push(m.positions[i]);
    expect(ys.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(ys.slice(4)).toEqual([-0.5, -0.5, -0.5, -0.5]);
  });

  it('plan y maps to world z', () => {
    // vertex 2 is (10,10) -> world (10, top, 10)
    expect(m.positions.slice(6, 9)).toEqual([10, 0, 10]);
  });

  it('every index addresses a real vertex', () => {
    for (const i of m.indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(8);
    }
  });
});

describe('slabSolid — triangle polygon', () => {
  it('N=3: indices length (1*6)+(3*6)=24, vertexCount 6', () => {
    const m = slabSolid([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }], 12, 1);
    expect(m.vertexCount).toBe(6);
    expect(m.indices).toHaveLength(24);
    // top at 12, bottom at 11
    expect(m.positions[1]).toBe(12);
    expect(m.positions[10]).toBe(11);
  });
});

describe('slabSolid — throws', () => {
  it('rejects <3 points, non-finite, bad thickness, repeated points', () => {
    expect(() => slabSolid([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0, 1)).toThrow();
    expect(() => slabSolid([{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }, { x: 2, y: 2 }], 0, 1)).toThrow();
    expect(() => slabSolid(SQUARE, 0, 0)).toThrow();
    expect(() => slabSolid(SQUARE, Number.NaN, 1)).toThrow();
    expect(() =>
      slabSolid([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }], 0, 1),
    ).toThrow();
  });
});
