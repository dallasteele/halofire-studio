import { describe, it, expect } from 'vitest';
import { synthesizeColumnsFromGrid } from '../src/engine/building-from-plan.js';

describe('synthesizeColumnsFromGrid (Phase 4 intake — heuristic column reconstruction)', () => {
  const grid = { xs: [0, 10, 20, 30], ys: [0, 10, 20] };

  it('returns no columns when grid datums are insufficient', () => {
    expect(synthesizeColumnsFromGrid({ xs: [0], ys: [0] }).columns).toHaveLength(0);
    expect(synthesizeColumnsFromGrid(null).columns).toHaveLength(0);
    expect(synthesizeColumnsFromGrid({}).columns).toHaveLength(0);
  });

  it('synthesizes a column at every grid intersection when no bbox clip is given', () => {
    const { columns, note } = synthesizeColumnsFromGrid(grid, null);
    expect(columns).toHaveLength(4 * 3); // 12 intersections
    // each column carries honest provenance fields
    for (const c of columns) {
      expect(Number.isFinite(c.x)).toBe(true);
      expect(Number.isFinite(c.y)).toBe(true);
      expect(c.source).toBe('grid-intersection');
      expect(c.confidence).toBe('low');
    }
    expect(note).toMatch(/needs-verification/i);
  });

  it('drops perimeter intersections within the edge inset of the footprint bbox', () => {
    // bbox tight around the grid; inset 4ft drops the x=0/x=30 and y=0/y=20 perimeter lines.
    const bbox = { minX: 0, minY: 0, maxX: 30, maxY: 20 };
    const { columns } = synthesizeColumnsFromGrid(grid, bbox, { edgeInsetFt: 4 });
    // only interior datums x in {10,20}, y in {10} survive -> 2 columns
    expect(columns).toHaveLength(2);
    expect(columns.every((c) => c.x === 10 || c.x === 20)).toBe(true);
    expect(columns.every((c) => c.y === 10)).toBe(true);
  });

  it('attaches a grid label when datum labels are provided as arrays', () => {
    const labeled = { xs: [10, 20], ys: [10, 30], labels: { cols: ['1', '2'], rows: ['A', 'B'] } };
    const { columns } = synthesizeColumnsFromGrid(labeled, null);
    expect(columns).toHaveLength(4);
    expect(columns.map((c) => c.gridLabel).sort()).toEqual(['1-A', '1-B', '2-A', '2-B']);
  });

  it('respects a custom column size', () => {
    const { columns } = synthesizeColumnsFromGrid(grid, null, { sizeFt: 2 });
    expect(columns.every((c) => c.sizeFt === 2)).toBe(true);
  });
});
