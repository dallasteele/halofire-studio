import { describe, it, expect } from 'vitest';
import {
  synthesizeCeilingGrid,
  centerHeadsOnTiles,
  tileForPoint,
  CEILING_GRID_DISCLAIMER,
} from '../src/engine/ceiling-grid.js';

// A 24x16 ft room (walls) with four heads NOT centered on a 2x2 tile grid.
// Grid origin = wall min corner (0,0); tiles span 0..24 x 0..16.
function roomModel() {
  return {
    sizing: { hazard: 'ordinary' },
    solids: [
      { kind: 'wall', name: 'wall-S', a: [0, 0], b: [24, 0], baseZ: 0, heightFt: 10, thicknessFt: 0.5 },
      { kind: 'wall', name: 'wall-E', a: [24, 0], b: [24, 16], baseZ: 0, heightFt: 10, thicknessFt: 0.5 },
      { kind: 'wall', name: 'wall-N', a: [24, 16], b: [0, 16], baseZ: 0, heightFt: 10, thicknessFt: 0.5 },
      { kind: 'wall', name: 'wall-W', a: [0, 16], b: [0, 0], baseZ: 0, heightFt: 10, thicknessFt: 0.5 },
      // heads slightly off the 2x2 tile centres (centres are odd ft: 1,3,5,...)
      { kind: 'head', name: 'h1', position: [5.4, 4.6, 9], orientation: 'pendent' },
      { kind: 'head', name: 'h2', position: [11.3, 4.7, 9], orientation: 'pendent' },
      { kind: 'head', name: 'h3', position: [5.6, 10.4, 9], orientation: 'pendent' },
      { kind: 'head', name: 'h4', position: [11.4, 10.3, 9], orientation: 'pendent' },
    ],
  };
}

describe('synthesizeCeilingGrid', () => {
  it('tiles the wall footprint with a 2x2 grid aligned to the corner', () => {
    const g = synthesizeCeilingGrid({ cadModel: roomModel(), tileW: 2, tileH: 2, padFt: 0 });
    expect(g.ok).toBe(true);
    expect(g.tileW).toBe(2);
    expect(g.tileH).toBe(2);
    expect(g.extentSource).toBe('wall-footprint-bbox');
    expect(g.origin).toEqual([0, 0]);
    expect(g.cols).toBe(12); // 24 / 2
    expect(g.rows).toBe(8);  // 16 / 2
    expect(g.tileCount).toBe(96);
  });

  it('produces tile records with correct centres and indices', () => {
    const g = synthesizeCeilingGrid({ cadModel: roomModel(), tileW: 2, tileH: 2, padFt: 0 });
    const t00 = g.tiles.find((t) => t.i === 0 && t.j === 0);
    expect(t00.cx).toBe(1); expect(t00.cy).toBe(1);
    expect(t00.x0).toBe(0); expect(t00.y0).toBe(0);
    expect(t00.x1).toBe(2); expect(t00.y1).toBe(2);
    const t21 = g.tiles.find((t) => t.i === 2 && t.j === 1);
    expect(t21.cx).toBe(5); expect(t21.cy).toBe(3);
  });

  it('supports 2x4 lay-in tiles', () => {
    const g = synthesizeCeilingGrid({ cadModel: roomModel(), tileW: 2, tileH: 4, padFt: 0 });
    expect(g.cols).toBe(12); // 24 / 2
    expect(g.rows).toBe(4);  // 16 / 4
    const t = g.tiles.find((t) => t.i === 0 && t.j === 0);
    expect(t.cx).toBe(1); expect(t.cy).toBe(2); // centre of a 2-wide x 4-tall tile
  });

  it('pads a head-field extent when there are no walls', () => {
    const m = { solids: [{ kind: 'head', name: 'a', position: [10, 10, 9] }, { kind: 'head', name: 'b', position: [16, 10, 9] }] };
    const g = synthesizeCeilingGrid({ cadModel: m, tileW: 2, tileH: 2, padFt: 2 });
    expect(g.ok).toBe(true);
    expect(g.extentSource).toBe('head-field-bbox');
    // extent padded so heads are well inside the lattice
    expect(g.bounds.x0).toBeLessThanOrEqual(10);
    expect(g.bounds.x1).toBeGreaterThanOrEqual(16);
  });

  it('honestly fails with no walls and no heads', () => {
    const g = synthesizeCeilingGrid({ cadModel: { solids: [] } });
    expect(g.ok).toBe(false);
    expect(g.reason).toMatch(/no extent/i);
    expect(g.tileCount).toBe(0);
  });

  it('clamps to maxTiles on a huge extent', () => {
    const m = { solids: [{ kind: 'head', name: 'a', position: [0, 0, 9] }, { kind: 'head', name: 'b', position: [5000, 5000, 9] }] };
    const g = synthesizeCeilingGrid({ cadModel: m, tileW: 2, tileH: 2, maxTiles: 1000 });
    expect(g.ok).toBe(true);
    expect(g.clamped).toBe(true);
    expect(g.tileCount).toBeLessThanOrEqual(1000);
  });

  it('centered origin mode keeps the lattice covering the extent', () => {
    const g = synthesizeCeilingGrid({ cadModel: roomModel(), tileW: 2, tileH: 2, originMode: 'center', padFt: 0 });
    expect(g.ok).toBe(true);
    expect(g.originSource).toBe('centered-on-extent');
    expect(g.bounds.x0).toBeLessThanOrEqual(0);
    expect(g.bounds.y0).toBeLessThanOrEqual(0);
    expect(g.bounds.x1).toBeGreaterThanOrEqual(24);
    expect(g.bounds.y1).toBeGreaterThanOrEqual(16);
  });

  it('carries the engineering-aid disclaimer', () => {
    const g = synthesizeCeilingGrid({ cadModel: roomModel() });
    expect(g.disclaimer).toBe(CEILING_GRID_DISCLAIMER);
    expect(g.disclaimer).toMatch(/NOT.*RCP|reflected ceiling/i);
  });
});

describe('tileForPoint', () => {
  it('finds the containing tile centre', () => {
    const g = synthesizeCeilingGrid({ cadModel: roomModel(), tileW: 2, tileH: 2, padFt: 0 });
    const t = tileForPoint(g, 5.4, 4.6); // -> tile (2,2): centre (5,5)
    expect(t.i).toBe(2); expect(t.j).toBe(2);
    expect(t.cx).toBe(5); expect(t.cy).toBe(5);
    expect(t.inBounds).toBe(true);
  });

  it('clamps points outside the lattice', () => {
    const g = synthesizeCeilingGrid({ cadModel: roomModel(), tileW: 2, tileH: 2, padFt: 0 });
    const t = tileForPoint(g, -100, -100);
    expect(t.i).toBe(0); expect(t.j).toBe(0);
    expect(t.inBounds).toBe(false);
  });
});

describe('centerHeadsOnTiles', () => {
  it('snaps off-center heads to their tile centres', () => {
    const m = roomModel();
    const g = synthesizeCeilingGrid({ cadModel: m, tileW: 2, tileH: 2, padFt: 0 });
    const r = centerHeadsOnTiles({ cadModel: m, grid: g, hazard: 'ordinary' });
    expect(r.ok).toBe(true);
    expect(r.headsConsidered).toBe(4);
    expect(r.headsCentered).toBe(4);
    expect(r.skipped.length).toBe(0);
    // h1 [5.4,4.6] -> tile (2,2) centre (5,5)
    const mv1 = r.moves.find((mv) => mv.name === 'h1');
    expect(mv1.to).toEqual([5, 5]);
    expect(mv1.from).toEqual([5.4, 4.6]);
    expect(mv1.deltaFt).toBeGreaterThan(0);
  });

  it('returns a mutated clone without touching the live model', () => {
    const m = roomModel();
    const g = synthesizeCeilingGrid({ cadModel: m, tileW: 2, tileH: 2, padFt: 0 });
    const r = centerHeadsOnTiles({ cadModel: m, grid: g });
    // live model unchanged
    expect(m.solids.find((s) => s.name === 'h1').position).toEqual([5.4, 4.6, 9]);
    // clone reflects the move, z preserved
    const cloneHead = r.model.solids.find((s) => s.name === 'h1');
    expect(cloneHead.position).toEqual([5, 5, 9]);
  });

  it('REJECTS a snap that would violate the minimum spacing (honest skip)', () => {
    // two heads in the SAME tile-adjacency that would collide if both snapped to
    // within < 6 ft. Put two heads near a shared corner so centering pushes them
    // below the 6 ft minimum.
    const m = {
      sizing: { hazard: 'ordinary' },
      solids: [
        { kind: 'wall', name: 'w', a: [0, 0], b: [8, 0], baseZ: 0, heightFt: 10 },
        { kind: 'wall', name: 'w2', a: [8, 0], b: [8, 4], baseZ: 0, heightFt: 10 },
        { kind: 'wall', name: 'w3', a: [8, 4], b: [0, 4], baseZ: 0, heightFt: 10 },
        { kind: 'wall', name: 'w4', a: [0, 4], b: [0, 0], baseZ: 0, heightFt: 10 },
        // two heads, each lands in adjacent 2x2 tiles whose centres are only 2 ft apart
        { kind: 'head', name: 'a', position: [2.9, 2, 9] },
        { kind: 'head', name: 'b', position: [4.9, 2, 9] },
      ],
    };
    const g = synthesizeCeilingGrid({ cadModel: m, tileW: 2, tileH: 2, padFt: 0 });
    const r = centerHeadsOnTiles({ cadModel: m, grid: g, hazard: 'ordinary' });
    // at least one head must be skipped for the min-spacing reason
    expect(r.skipped.length).toBeGreaterThanOrEqual(1);
    expect(r.skipped.some((s) => /minimum spacing/i.test(s.reason))).toBe(true);
  });

  it('uses compliance.coverage-style lookup when provided', () => {
    const m = roomModel();
    const g = synthesizeCeilingGrid({ cadModel: m, tileW: 2, tileH: 2, padFt: 0 });
    const coverageFn = (hz) => ({ maxAreaFt2: 130, maxSpacingFt: 15, minSpacingFt: 6, source: 'test' });
    const r = centerHeadsOnTiles({ cadModel: m, grid: g, hazard: 'ordinary', complianceCoverage: coverageFn });
    expect(r.ok).toBe(true);
    expect(r.coverageSource).toBe('compliance.coverage');
    expect(r.maxSpacingFt).toBe(15);
  });

  it('counts already-centered heads without moving them', () => {
    const m = {
      sizing: { hazard: 'ordinary' },
      solids: [
        { kind: 'wall', name: 'w', a: [0, 0], b: [12, 0], baseZ: 0, heightFt: 10 },
        { kind: 'wall', name: 'w2', a: [0, 12], b: [12, 12], baseZ: 0, heightFt: 10 },
        // already on tile centres (1,3,5... for 2x2 from origin 0,0)
        { kind: 'head', name: 'a', position: [3, 3, 9] },
        { kind: 'head', name: 'b', position: [9, 9, 9] },
      ],
    };
    const g = synthesizeCeilingGrid({ cadModel: m, tileW: 2, tileH: 2, padFt: 0 });
    const r = centerHeadsOnTiles({ cadModel: m, grid: g });
    expect(r.alreadyCentered).toBe(2);
    expect(r.headsCentered).toBe(0);
  });

  it('honestly refuses with no grid', () => {
    const r = centerHeadsOnTiles({ cadModel: roomModel(), grid: { ok: false } });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/grid/i);
  });
});
