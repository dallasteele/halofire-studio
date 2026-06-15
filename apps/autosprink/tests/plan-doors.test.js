import { describe, it, expect } from 'vitest';
import { fitCircle, detectDoors, detectOpenings, detectFixtures, detectWindows } from '../src/engine/plan-doors.js';
import { selectWallLayer } from '../src/engine/pdf-floorplan.js';

describe('fitCircle', () => {
  it('fits a unit circle through three points', () => {
    const c = fitCircle([1, 0], [0, 1], [-1, 0]);
    expect(c).toBeTruthy();
    expect(c.cx).toBeCloseTo(0, 6);
    expect(c.cy).toBeCloseTo(0, 6);
    expect(c.r).toBeCloseTo(1, 6);
  });
  it('returns null for collinear points', () => {
    expect(fitCircle([0, 0], [1, 1], [2, 2])).toBeNull();
  });
});

describe('detectDoors', () => {
  // a 3ft door: quarter-circle swing arc centered at the hinge (10,10), radius 3, swept 90deg
  const door3ft = { cxFt: 10, cyFt: 10, rFt: 3, startFt: [13, 10], endFt: [10, 13], sweepDeg: 90, lineWidth: 0.26 };
  const hostWall = { a: [0, 10], b: [20, 10] }; // wall through the hinge

  it('accepts a leaf-radius quarter-swing arc as a door and finds its host wall', () => {
    const { doors } = detectDoors([door3ft], [hostWall], {});
    expect(doors).toHaveLength(1);
    const d = doors[0];
    expect(d.kind).toBe('door');
    expect(d.position).toEqual([10, 10]);
    expect(d.width).toBeCloseTo(3, 3);
    expect(d.onWall).toBe(true);
    expect(d.hostWall).toBe(0);
    expect(d.confidence).toBe('medium');
    expect(d.needsVerification).toBe(true);
  });

  it('rejects arcs that are too big (not a door leaf) or barely swept', () => {
    const bigArc = { cxFt: 50, cyFt: 50, rFt: 12, startFt: [62, 50], endFt: [50, 62], sweepDeg: 90 };
    const flatArc = { cxFt: 5, cyFt: 5, rFt: 3, startFt: [8, 5], endFt: [8, 5.2], sweepDeg: 5 };
    const { doors } = detectDoors([bigArc, flatArc], [hostWall], {});
    expect(doors).toHaveLength(0);
  });

  it('dedups overlapping arcs of the same swing (drawn 2-3x)', () => {
    const dup = { ...door3ft, startFt: [13.05, 10], endFt: [10, 13.05] };
    const { doors } = detectDoors([door3ft, dup, { ...door3ft }], [hostWall], {});
    expect(doors).toHaveLength(1);
  });

  it('flags an off-wall door low-confidence (no host within 3ft)', () => {
    const { doors } = detectDoors([door3ft], [{ a: [0, 40], b: [20, 40] }], {});
    expect(doors).toHaveLength(1);
    expect(doors[0].onWall).toBe(false);
    expect(doors[0].hostWall).toBeNull();
    expect(doors[0].confidence).toBe('low');
  });
});

describe('detectOpenings', () => {
  it('detects a cased opening: a gap between two collinear major walls with no door', () => {
    const walls = [
      { a: [0, 0], b: [10, 0] },   // left run (10ft)
      { a: [14, 0], b: [24, 0] },  // right run (10ft), 4ft gap at x=10..14
    ];
    const { openings } = detectOpenings(walls, [], {});
    expect(openings.length).toBeGreaterThanOrEqual(1);
    const o = openings[0];
    expect(o.kind).toBe('opening');
    expect(o.width).toBeCloseTo(4, 1);
    expect(o.position[0]).toBeCloseTo(12, 1);
    expect(o.needsVerification).toBe(true);
  });

  it('does NOT report a gap that already has a door on it', () => {
    const walls = [{ a: [0, 0], b: [10, 0] }, { a: [14, 0], b: [24, 0] }];
    const doors = [{ position: [12, 0], width: 3 }];
    const { openings } = detectOpenings(walls, doors, {});
    expect(openings).toHaveLength(0);
  });

  it('ignores tiny flanking jogs (< minFlank) so dense partitions do not flood openings', () => {
    const walls = [{ a: [0, 0], b: [1, 0] }, { a: [5, 0], b: [6, 0] }]; // 1ft stubs
    const { openings } = detectOpenings(walls, [], {});
    expect(openings).toHaveLength(0);
  });
});

describe('detectFixtures', () => {
  it('counts + locates fixtures from room kinds, labels-in-rooms, and stair cores', () => {
    const rooms = [
      { poly: [[0, 0], [10, 0], [10, 10], [0, 10]], kind: 'mech', label: 'MECH' },
      { poly: [[20, 0], [30, 0], [30, 10], [20, 10]], kind: 'unknown', label: null },
    ];
    const labels = [{ text: 'ELEC', xFt: 25, yFt: 5 }]; // sits inside the unknown room
    const stairs = [{ centroidFt: [50, 50] }];
    const { fixtures, counts } = detectFixtures(rooms, labels, stairs);
    expect(counts.mech).toBe(1);
    expect(counts.elec).toBe(1);
    expect(counts.stair).toBe(1);
    expect(fixtures.every((f) => f.kind === 'fixture' && f.needsVerification === true)).toBe(true);
    const elec = fixtures.find((f) => f.fixtureKind === 'elec');
    expect(elec.position).toEqual([25, 5]); // snapped to the enclosing room centroid
    expect(elec.source).toBe('label-in-room');
  });

  it('returns empty for no rooms/labels/stairs', () => {
    const { fixtures, counts } = detectFixtures([], [], []);
    expect(fixtures).toHaveLength(0);
    expect(counts).toEqual({});
  });
});

describe('detectWindows', () => {
  // a 4ft window: 4 parallel mullion/sill lines (each 4ft long, running along +x at y=0,0.15,0.3,0.45)
  // packed in a 0.45ft band — the glazing symbol of a double-line wall window.
  const windowSym = [
    { a: [10, 0.0], b: [14, 0.0] },
    { a: [10, 0.15], b: [14, 0.15] },
    { a: [10, 0.3], b: [14, 0.3] },
    { a: [10, 0.45], b: [14, 0.45] },
  ];

  it('detects a mullion bundle as a window at the bundle centroid', () => {
    const { windows } = detectWindows(windowSym, [], {});
    expect(windows).toHaveLength(1);
    const w = windows[0];
    expect(w.kind).toBe('window');
    expect(w.position[0]).toBeCloseTo(12, 1);
    expect(w.width).toBeCloseTo(4, 1);
    expect(w.mullionLines).toBeGreaterThanOrEqual(3);
    expect(w.needsVerification).toBe(true);
  });

  it('does NOT report a window where a door swing arc sits (door wins)', () => {
    const doors = [{ position: [12, 0.2], width: 3 }];
    const { windows } = detectWindows(windowSym, doors, {});
    expect(windows).toHaveLength(0);
  });

  it('rejects too-few parallel lines (a single wall double-line is not a window)', () => {
    const twoLines = [{ a: [10, 0], b: [14, 0] }, { a: [10, 0.3], b: [14, 0.3] }];
    const { windows } = detectWindows(twoLines, [], {});
    expect(windows).toHaveLength(0);
  });

  it('rejects long structural wall lines (only short mullion-length segments cluster)', () => {
    const longWalls = [
      { a: [0, 0], b: [60, 0] }, { a: [0, 0.3], b: [60, 0.3] }, { a: [0, 0.6], b: [60, 0.6] },
    ];
    const { windows } = detectWindows(longWalls, [], {});
    expect(windows).toHaveLength(0);
  });
});

describe('selectWallLayer partitionInclusive', () => {
  // baseline hairline mass (lw=0) + two heavier bands (partitions 0.25, primary 0.5)
  const segs = [];
  // hairline baseline must DOMINATE by total drawn length (it is the modal-by-length band): make
  // it long so lw=0 is the baseline and 0.25/0.5 are strictly heavier.
  for (let i = 0; i < 200; i++) segs.push({ x1: 0, y1: i * 0.5, x2: 100, y2: i * 0.5, lineWidth: 0, strokeColor: null }); // hatch baseline (huge length)
  for (let i = 0; i < 8; i++) segs.push({ x1: 0, y1: i, x2: 10, y2: i, lineWidth: 0.25, strokeColor: null }); // partitions
  for (let i = 0; i < 8; i++) segs.push({ x1: 0, y1: 100 + i, x2: 20, y2: 100 + i, lineWidth: 0.5, strokeColor: null }); // primary

  it('single-band selection picks ONE heavier band (default)', () => {
    const wl = selectWallLayer(segs, {});
    const widths = new Set(wl.wallSegments.map((s) => s.lineWidth));
    expect(widths.size).toBe(1);
    expect([...widths][0]).toBeGreaterThan(0); // never the hairline baseline
  });

  it('partitionInclusive returns the UNION of ALL heavier-than-baseline bands', () => {
    const wl = selectWallLayer(segs, { partitionInclusive: true });
    const widths = new Set(wl.wallSegments.map((s) => s.lineWidth));
    expect(widths.has(0.25)).toBe(true);
    expect(widths.has(0.5)).toBe(true);
    expect(widths.has(0)).toBe(false); // hairline baseline still excluded
    expect(wl.method).toBe('partition-inclusive-all-heavier-than-baseline');
    expect(wl.wallSegments.length).toBe(16); // 8 partitions + 8 primary, no hatch
  });
});
