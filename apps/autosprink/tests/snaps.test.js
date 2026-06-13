import { describe, expect, it } from 'vitest';
import { snap, snapCandidates, segmentsFromModel, orthoConstrain, defaultSnapState, SNAP_TYPES } from '../src/engine/snaps.js';

// HF-W1-SNAP — pure plan-space snap engine (grid/endpoint/midpoint/intersection/
// perpendicular) for drawing + move. Mirrors the AutoSprink Snaps menu at
// flag-don't-gate fidelity. All coords are plan [x,y] feet.

const segs = [
  { a: [0, 0], b: [10, 0] }, // horizontal
  { a: [5, -5], b: [5, 5] }, // vertical, crosses the first at [5,0]
];

describe('snap', () => {
  it('snaps to an endpoint within tolerance', () => {
    const r = snap([0.4, 0.3], segs, { ...defaultSnapState() });
    expect(r.snapped).toBe(true);
    expect(r.type).toBe('endpoint');
    expect(r.p).toEqual([0, 0]);
  });

  it('snaps to a segment midpoint', () => {
    const r = snap([5.2, 0.2], [{ a: [0, 0], b: [10, 0] }], { ...defaultSnapState(), endpoint: false });
    expect(r.type).toBe('midpoint');
    expect(r.p).toEqual([5, 0]);
  });

  it('snaps to a true segment intersection', () => {
    const r = snap([5.3, 0.2], segs, { ...defaultSnapState(), endpoint: false, midpoint: false });
    expect(r.type).toBe('intersection');
    expect(r.p[0]).toBeCloseTo(5, 6);
    expect(r.p[1]).toBeCloseTo(0, 6);
  });

  it('endpoint beats grid on a tie within tolerance (priority)', () => {
    const r = snap([0.2, 0.2], segs, { ...defaultSnapState(), gridSize: 1 });
    expect(r.type).toBe('endpoint');
  });

  it('falls back to grid when no geometry is near', () => {
    const r = snap([20.4, 20.4], segs, { ...defaultSnapState() });
    expect(r.type).toBe('grid');
    expect(r.p).toEqual([20, 20]);
  });

  it('returns the raw point unsnapped when nothing (incl. grid) is enabled in tolerance', () => {
    const r = snap([100, 100], [], { grid: false, endpoint: false, midpoint: false, intersection: false, perpendicular: false, tolFt: 1.5 });
    expect(r.snapped).toBe(false);
    expect(r.p).toEqual([100, 100]);
  });

  it('perpendicular snaps to the foot on a segment when enabled', () => {
    const r = snap([3, 2], [{ a: [0, 0], b: [10, 0] }], { grid: false, endpoint: false, midpoint: false, intersection: false, perpendicular: true, tolFt: 3 });
    expect(r.type).toBe('perpendicular');
    expect(r.p[0]).toBeCloseTo(3, 6);
    expect(r.p[1]).toBeCloseTo(0, 6);
  });

  it('respects disabled types', () => {
    const cands = snapCandidates([0.2, 0.2], segs, { grid: true, endpoint: false, midpoint: false, intersection: false, perpendicular: false, gridSize: 1 });
    expect(cands.every((c) => c.type === 'grid')).toBe(true);
  });
});

describe('segmentsFromModel', () => {
  it('extracts pipe + wall segments in plan XY', () => {
    const model = { solids: [
      { kind: 'pipe', from: [0, 0, 9], to: [4, 0, 9] },
      { kind: 'wall', a: [0, 0], b: [8, 0] },
      { kind: 'head', position: [2, 2, 8] }, // ignored
    ] };
    const s = segmentsFromModel(model);
    expect(s.length).toBe(2);
    expect(s[0]).toEqual({ a: [0, 0], b: [4, 0] });
  });
});

describe('orthoConstrain', () => {
  it('locks to the dominant axis', () => {
    expect(orthoConstrain([0, 0], [10, 2])).toEqual([10, 0]); // X dominant
    expect(orthoConstrain([0, 0], [2, 10])).toEqual([0, 10]); // Y dominant
  });
});

describe('SNAP_TYPES', () => {
  it('lists the five supported snap types', () => {
    expect(SNAP_TYPES).toEqual(['grid', 'endpoint', 'midpoint', 'intersection', 'perpendicular']);
  });
});
