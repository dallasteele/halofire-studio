import { describe, expect, it } from 'vitest';
import { snap, snapCandidates, segmentsFromModel, nodesFromModel, orthoConstrain, polarConstrain, defaultSnapState, SNAP_TYPES } from '../src/engine/snaps.js';

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
    const cands = snapCandidates([0.2, 0.2], segs, { grid: true, endpoint: false, midpoint: false, intersection: false, perpendicular: false, node: false, extension: false, gridSize: 1 });
    expect(cands.every((c) => c.type === 'grid')).toBe(true);
  });

  it('snaps to a NODE (head/fitting center) carrying its label', () => {
    const nodes = [{ p: [20, 20], label: 'head' }];
    const r = snap([20.3, 19.8], [], { ...defaultSnapState() }, nodes);
    expect(r.type).toBe('node');
    expect(r.p).toEqual([20, 20]);
    expect(r.label).toBe('head');
  });

  it('snaps to an EXTENSION along a run past its endpoint, anchored to that endpoint', () => {
    const onSeg = [{ a: [0, 0], b: [10, 0] }];
    const r = snap([13, 0.2], onSeg, { grid: false, endpoint: false, midpoint: false, intersection: false, perpendicular: false, node: false, extension: true, tolFt: 1.5 });
    expect(r.type).toBe('extension');
    expect(r.p[0]).toBeCloseTo(13, 6);
    expect(r.p[1]).toBeCloseTo(0, 6);
    expect(r.from).toEqual([10, 0]); // grows from the near endpoint
  });

  it('does NOT report extension when the cursor projects onto the segment body', () => {
    const onSeg = [{ a: [0, 0], b: [10, 0] }];
    const cands = snapCandidates([5, 0.2], onSeg, { grid: false, endpoint: false, midpoint: false, intersection: false, perpendicular: false, node: false, extension: true });
    expect(cands.filter((c) => c.type === 'extension').length).toBe(0);
  });

  it('a named endpoint beats a perpendicular foot near a segment end (priority)', () => {
    // cursor near the [0,0] endpoint but with a closer perpendicular foot at [0.2,0]
    const r = snap([0.2, 0.25], [{ a: [0, 0], b: [10, 0] }], { ...defaultSnapState(), grid: false });
    expect(r.type).toBe('endpoint');
  });
});

describe('nodesFromModel', () => {
  it('extracts head + component centers (NODE snap targets)', () => {
    const model = { solids: [
      { kind: 'pipe', from: [0, 0, 9], to: [4, 0, 9] }, // ignored
      { kind: 'head', position: [2, 2, 8] },
      { kind: 'component', componentKey: 'fitting_tee', position: [5, 6, 9] },
    ] };
    const n = nodesFromModel(model);
    expect(n.length).toBe(2);
    expect(n[0]).toEqual({ p: [2, 2], label: 'head' });
    expect(n[1]).toEqual({ p: [5, 6], label: 'component' });
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
  it('lists the full O-snap suite incl. node + extension', () => {
    expect(SNAP_TYPES).toEqual(['grid', 'endpoint', 'midpoint', 'intersection', 'perpendicular', 'node', 'extension']);
  });
});

describe('polarConstrain', () => {
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
  it('snaps a near-45° drag onto the exact 45° ray and preserves reach', () => {
    // cursor at (10, 9): raw angle ~42°, within band of the 45° increment.
    const r = polarConstrain([0, 0], [10, 9], 45, 6);
    expect(r.onAxis).toBe(true);
    expect(r.snappedAngleDeg).toBe(45);
    // constrained point lies on the 45° ray (x === y)
    expect(near(r.p[0], r.p[1])).toBe(true);
    // length = projection of (10,9) onto the 45° unit vector = (10+9)/sqrt2
    expect(near(r.lengthFt, (10 + 9) / Math.SQRT2)).toBe(true);
  });
  it('engages at 90° increment exactly like clean ortho', () => {
    const r = polarConstrain([0, 0], [12, 1], 90, 10);
    expect(r.onAxis).toBe(true);
    expect(r.snappedAngleDeg).toBe(0);
    expect(near(r.p[0], 12)).toBe(true);
    expect(near(r.p[1], 0)).toBe(true); // Y zeroed -> horizontal
  });
  it('does NOT engage when the drag is off-axis beyond the band (follows cursor)', () => {
    // 45° increment, band 4°. Raw angle of (10,3) ~ 16.7° — 16.7° from 0° and 28° from 45°, both > band.
    const r = polarConstrain([0, 0], [10, 3], 45, 4);
    expect(r.onAxis).toBe(false);
    expect(r.p).toEqual([10, 3]); // unchanged
  });
  it('chooses the nearest increment for 30° config', () => {
    const r = polarConstrain([0, 0], [Math.cos(0.55), Math.sin(0.55)], 30, 8); // ~31.5°
    expect(r.snappedAngleDeg).toBe(30);
    expect(r.onAxis).toBe(true);
  });
  it('handles the 359°/0° wrap as a 1° delta, not 359°', () => {
    // angle just below 0° (i.e. ~ -2° => 358°). Nearest increment 0/360.
    const r = polarConstrain([0, 0], [10, -0.3], 90, 6);
    expect(r.deltaDeg).toBeLessThan(6);
    expect(r.onAxis).toBe(true);
  });
  it('returns a zero-length safe result at the start point', () => {
    const r = polarConstrain([3, 3], [3, 3], 45, 6);
    expect(r.lengthFt).toBe(0);
    expect(r.onAxis).toBe(false);
  });
  it('supports the 22.5° increment', () => {
    const r = polarConstrain([0, 0], [Math.cos(0.40), Math.sin(0.40)], 22.5, 5); // ~22.9°
    expect(r.snappedAngleDeg).toBe(22.5);
    expect(r.onAxis).toBe(true);
  });
});
