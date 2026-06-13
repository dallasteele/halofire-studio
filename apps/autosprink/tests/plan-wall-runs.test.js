import { describe, it, expect } from 'vitest';
import { buildWallRuns } from '../src/engine/plan-wall-runs.js';

describe('buildWallRuns — collinear merge + non-wall exclusion (RECORE)', () => {
  it('merges fragmented collinear horizontal pieces into one run', () => {
    // A 30ft wall drawn as 6 collinear 5ft pieces at y=10 with hairline gaps.
    const walls = [];
    for (let x = 0; x < 30; x += 5) walls.push({ a: [x, 10], b: [x + 5, 10] });
    const { runs, meta } = buildWallRuns(walls);
    expect(runs.length).toBe(1);
    expect(runs[0].axis).toBe('H');
    expect(runs[0].lengthFt).toBeCloseTo(30, 1);
    expect(meta.horizontal).toBe(6);
    expect(meta.runCount).toBe(1);
  });

  it('keeps two parallel walls separated by more than perpTol as distinct runs', () => {
    const walls = [
      { a: [0, 10], b: [20, 10] }, // wall A at y=10
      { a: [0, 13], b: [20, 13] }, // wall B at y=13 (3ft apart, > perpTol 0.25)
    ];
    const { runs } = buildWallRuns(walls);
    expect(runs.length).toBe(2);
  });

  it('drops diagonal segments (door-swing arcs / hatch) and counts them', () => {
    const walls = [
      { a: [0, 0], b: [20, 0] },   // real horizontal wall
      { a: [0, 0], b: [3, 3] },    // diagonal (door swing arc chord)
      { a: [5, 5], b: [7, 8] },    // diagonal
    ];
    const { runs, meta } = buildWallRuns(walls);
    expect(meta.diagonalDropped).toBe(2);
    expect(runs.length).toBe(1);
    expect(runs[0].axis).toBe('H');
  });

  it('drops sub-minRunFt stubs (dimension ticks / glyph strokes)', () => {
    const walls = [
      { a: [0, 0], b: [20, 0] },     // real wall, kept
      { a: [0, 5], b: [1, 5] },      // 1ft stub at y=5, dropped (< 2ft)
      { a: [10, 8], b: [10.5, 8] },  // 0.5ft stub, dropped
    ];
    const { runs, meta } = buildWallRuns(walls);
    expect(runs.length).toBe(1);
    expect(meta.shortRunsDropped).toBe(2);
  });

  it('does not bridge gaps larger than gapFt (a real doorway opening stays split)', () => {
    const walls = [
      { a: [0, 0], b: [10, 0] },   // wall up to x=10
      { a: [14, 0], b: [24, 0] },  // wall resumes at x=14 (4ft gap > default 1ft)
    ];
    const { runs } = buildWallRuns(walls, { gapFt: 1.0 });
    expect(runs.length).toBe(2);
  });

  it('produces a plausible (small) count, not the raw fragment count', () => {
    // 200 collinear 1ft fragments forming 4 walls -> 4 runs, not 200.
    const walls = [];
    for (let i = 0; i < 50; i++) walls.push({ a: [i, 0], b: [i + 1, 0] });   // wall 1 (y=0)
    for (let i = 0; i < 50; i++) walls.push({ a: [i, 30], b: [i + 1, 30] }); // wall 2 (y=30)
    for (let i = 0; i < 50; i++) walls.push({ a: [0, i], b: [0, i + 1] });   // wall 3 (x=0)
    for (let i = 0; i < 50; i++) walls.push({ a: [50, i], b: [50, i + 1] }); // wall 4 (x=50)
    const { runs, meta } = buildWallRuns(walls);
    expect(meta.inputSegments).toBe(200);
    expect(runs.length).toBe(4);
    expect(meta.totalRunLengthFt).toBeGreaterThan(150);
  });

  it('handles empty / garbage input without throwing', () => {
    expect(buildWallRuns([]).runs).toEqual([]);
    expect(buildWallRuns(null).runs).toEqual([]);
    expect(buildWallRuns([{ a: [0, 0], b: [0, 0] }]).meta.degenerateDropped).toBe(1);
  });

  it('is deterministic (stable order + identical output on re-run)', () => {
    const walls = [
      { a: [0, 10], b: [20, 10] },
      { a: [5, 0], b: [5, 25] },
      { a: [0, 0], b: [40, 0] },
    ];
    const a = buildWallRuns(walls);
    const b = buildWallRuns(walls);
    expect(JSON.stringify(a.runs)).toBe(JSON.stringify(b.runs));
    // H runs sort before V runs.
    expect(a.runs[0].axis).toBe('H');
  });
});
