import { describe, it, expect } from 'vitest';
import { planeFromPoints, generateSection, SECTION_DISCLAIMER } from '../src/engine/section-cut.js';

// A small but realistic model: a 20ft-long room, two walls, one column, a branch
// pipe at z=9, two drops to pendent heads at z=8, a system riser.
function demoModel() {
  return {
    solids: [
      // walls along x from (0,0)->(20,0) and (0,10)->(20,10), 9ft tall, 0.5 thick
      { kind: 'wall', name: 'wall-S', type: 'exterior', a: [0, 0], b: [20, 0], baseZ: 0, heightFt: 9, thicknessFt: 0.5 },
      { kind: 'wall', name: 'wall-N', type: 'exterior', a: [0, 10], b: [20, 10], baseZ: 0, heightFt: 9, thicknessFt: 0.5 },
      // a column at (10,5), 1ft, 9ft tall
      { kind: 'column', name: 'col-A1', x: 10, y: 5, sizeFt: 1, baseZ: 0, heightFt: 9, gridLabel: 'A-1' },
      // branch line at z=9 along x at y=5
      { kind: 'pipe', name: 'branch-1', role: 'branch', from: [2, 5, 9], to: [18, 5, 9], diameterIn: 1.25 },
      // two drops to heads at z=8
      { kind: 'pipe', name: 'drop-1', role: 'drop', from: [6, 5, 9], to: [6, 5, 8], diameterIn: 1 },
      { kind: 'pipe', name: 'drop-2', role: 'drop', from: [14, 5, 9], to: [14, 5, 8], diameterIn: 1 },
      { kind: 'head', name: 'head-1', position: [6, 5, 8], orientation: 'pendent' },
      { kind: 'head', name: 'head-2', position: [14, 5, 8], orientation: 'pendent' },
      // system riser at (0,5) floor->9
      { kind: 'pipe', name: 'riser', role: 'riser', from: [0, 5, 0], to: [0, 5, 9], diameterIn: 2 },
    ],
  };
}

describe('planeFromPoints', () => {
  it('builds an orthonormal frame from two plan points', () => {
    const p = planeFromPoints([0, 5], [20, 5]);
    expect(p).toBeTruthy();
    expect(p.lengthFt).toBeCloseTo(20, 6);
    expect(p.dir[0]).toBeCloseTo(1, 6);
    expect(p.dir[1]).toBeCloseTo(0, 6);
    // left normal of +x is +y
    expect(p.normal[0]).toBeCloseTo(0, 6);
    expect(p.normal[1]).toBeCloseTo(1, 6);
  });

  it('returns null when the two points coincide', () => {
    expect(planeFromPoints([3, 3], [3, 3])).toBeNull();
    expect(planeFromPoints([NaN, 0], [1, 1])).toBeNull();
  });
});

describe('generateSection — longitudinal cut down the room centerline', () => {
  const sec = generateSection(demoModel(), [0, 5], [20, 5], { bandFt: 8, label: 'Section A-A' });

  it('succeeds and is labelled + disclaimed', () => {
    expect(sec.ok).toBe(true);
    expect(sec.kind).toBe('section');
    expect(sec.label).toBe('Section A-A');
    expect(sec.disclaimer).toBe(SECTION_DISCLAIMER);
  });

  it('captures heads at their TRUE elevation (z=8)', () => {
    const heads = sec.entities.filter((e) => e.type === 'head');
    expect(heads.length).toBe(2);
    for (const h of heads) expect(h.v).toBeCloseTo(8, 6);
    // u runs along the cut line from A; head-1 at x=6 -> u=6, head-2 at x=14 -> u=14
    const us = heads.map((h) => h.u).sort((a, b) => a - b);
    expect(us[0]).toBeCloseTo(6, 6);
    expect(us[1]).toBeCloseTo(14, 6);
    // both heads sit ON the plane -> cut
    expect(heads.every((h) => h.cut)).toBe(true);
  });

  it('captures the branch pipe as a horizontal line at z=9', () => {
    const branch = sec.entities.find((e) => e.type === 'line' && e.name === 'branch-1');
    expect(branch).toBeTruthy();
    expect(branch.a[1]).toBeCloseTo(9, 6);
    expect(branch.b[1]).toBeCloseTo(9, 6);
    expect(branch.diameterIn).toBe(1.25);
    expect(branch.cut).toBe(true); // on the centerline plane
  });

  it('captures drops as vertical lines from z=9 down to z=8', () => {
    const drops = sec.entities.filter((e) => e.type === 'line' && e.role === 'drop');
    expect(drops.length).toBe(2);
    for (const d of drops) {
      const vs = [d.a[1], d.b[1]].sort((a, b) => a - b);
      expect(vs[0]).toBeCloseTo(8, 6);
      expect(vs[1]).toBeCloseTo(9, 6);
    }
  });

  it('captures the riser from floor(0) to 9 at u=0', () => {
    const riser = sec.entities.find((e) => e.name === 'riser');
    expect(riser).toBeTruthy();
    const vs = [riser.a[1], riser.b[1]].sort((a, b) => a - b);
    expect(vs[0]).toBeCloseTo(0, 6);
    expect(vs[1]).toBeCloseTo(9, 6);
  });

  it('shows the column the plane passes through as a CUT rect spanning full height', () => {
    const col = sec.entities.find((e) => e.kind === 'column');
    expect(col).toBeTruthy();
    expect(col.cut).toBe(true);
    expect(col.v0).toBeCloseTo(0, 6);
    expect(col.v1).toBeCloseTo(9, 6);
    // column at (10,5) on the centerline -> u≈10, width 1
    expect((col.u0 + col.u1) / 2).toBeCloseTo(10, 6);
    expect(col.u1 - col.u0).toBeCloseTo(1, 6);
  });

  it('shows side walls as "beyond" (not cut) rects within the band', () => {
    const walls = sec.entities.filter((e) => e.kind === 'wall');
    // both side walls (y=0 and y=10) are 5ft off the centerline, within band 8 -> beyond
    expect(walls.length).toBe(2);
    expect(walls.every((w) => w.cut === false)).toBe(true);
  });

  it('emits floor + ceiling datum lines', () => {
    const datums = sec.entities.filter((e) => e.type === 'datum');
    const vs = datums.map((d) => d.v).sort((a, b) => a - b);
    expect(vs).toContain(0);
    expect(vs).toContain(9); // ceiling = tallest wall/column top
  });

  it('reports sensible bounds (elevation 0..9, u 0..~20)', () => {
    expect(sec.bounds.v0).toBeCloseTo(0, 6);
    expect(sec.bounds.v1).toBeGreaterThanOrEqual(9 - 1e-6);
    expect(sec.bounds.u0).toBeLessThanOrEqual(0 + 1e-6);
    expect(sec.bounds.u1).toBeGreaterThanOrEqual(18);
  });
});

describe('generateSection — transverse cut excludes far content via the depth band', () => {
  it('a narrow band drops content outside it', () => {
    // cut across the room at x=10 (perpendicular), tiny band -> only near-x=10 content
    const sec = generateSection(demoModel(), [10, -5], [10, 15], { bandFt: 1.0 });
    expect(sec.ok).toBe(true);
    // heads are at x=6 and x=14, both >1ft from x=10 plane -> excluded
    const heads = sec.entities.filter((e) => e.type === 'head');
    expect(heads.length).toBe(0);
    // the column at x=10 IS within band -> present and cut
    const col = sec.entities.find((e) => e.kind === 'column');
    expect(col).toBeTruthy();
    expect(col.cut).toBe(true);
  });

  it('the branch pipe crossing the plane is clipped but present (cut)', () => {
    const sec = generateSection(demoModel(), [10, -5], [10, 15], { bandFt: 1.0 });
    const branch = sec.entities.find((e) => e.name === 'branch-1');
    expect(branch).toBeTruthy();
    expect(branch.cut).toBe(true);
    // the branch runs along x and crosses x=10 -> at the plane its z is 9
    expect(branch.a[1]).toBeCloseTo(9, 6);
  });
});

describe('generateSection — degenerate / empty inputs are honest', () => {
  it('returns ok:false on a zero-length cut line', () => {
    const sec = generateSection(demoModel(), [5, 5], [5, 5]);
    expect(sec.ok).toBe(false);
    expect(sec.entities).toEqual([]);
  });

  it('handles an empty model without throwing', () => {
    const sec = generateSection({ solids: [] }, [0, 0], [10, 0]);
    expect(sec.ok).toBe(true);
    expect(sec.entities).toEqual([]);
    expect(sec.counts.heads).toBe(0);
  });

  it('handles a null model', () => {
    const sec = generateSection(null, [0, 0], [10, 0]);
    expect(sec.ok).toBe(true);
    expect(sec.entities).toEqual([]);
  });
});
