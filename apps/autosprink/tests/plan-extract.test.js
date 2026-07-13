import { describe, it, expect } from 'vitest';
import {
  deriveScaleFromText,
  extractGrid,
  segmentRooms,
  isLikelyRoomLabel,
  detectStairs,
  detectStairCores,
  buildLevelPlan,
  reconcileWithSam,
  splitStackedPlanViews,
  computeWingRegistration,
  mergeWingPlans,
} from '../src/engine/plan-extract.js';
import { buildBuildingFromPlans, planBounds, polyCentroid, computePlanUnderlayTransform, unionFootprintCenter } from '../src/engine/building-from-plan.js';

describe('deriveScaleFromText', () => {
  it('derives feet-per-unit from the printed 3/32" = 1\'-0" notation (never hardcoded)', () => {
    const r = deriveScaleFromText('GENERAL NOTES SCALE: 3/32" = 1\'-0" KEY PLAN');
    expect(r).toBeTruthy();
    expect(r.feetPerUnit).toBeCloseTo(0.14814814, 6);
    expect(r.source).toBe('sheet-printed-scale-notation');
    expect(r.scaleText).toMatch(/3\/32/);
  });
  it('derives 1/8" = 1\' as 0.11111', () => {
    expect(deriveScaleFromText('SCALE: 1/8" = 1\'').feetPerUnit).toBeCloseTo(0.1111111, 6);
  });
  it('prefers the explicit title-block SCALE clause over an earlier dimension fragment', () => {
    const r = deriveScaleFromText('DOOR 14 3/16" = 1\'-0" NOTES SCALE: 3/16" = 1\'-0"');
    expect(r.feetPerUnit).toBeCloseTo(0.07407407, 6);
    expect(r.scaleText).toMatch(/SCALE: 3\/16/);
  });
  it('prefers the scale notation nearest a trailing SCALE label', () => {
    const r = deriveScaleFromText('DOOR 14 3/16" = 1\'-0" NOTES 3/16" = 1\'-0" 0 FEET SCALE');
    expect(r.feetPerUnit).toBeCloseTo(0.07407407, 6);
    expect(r.scaleText).toMatch(/3\/16/);
  });
  it('separates a scale-bar tick from the fraction before a trailing FEET SCALE label', () => {
    const r = deriveScaleFromText('2 4 6 8 10 12 14 3/16" = 1\'-0" 0 FEET SCALE');
    expect(r.feetPerUnit).toBeCloseTo(0.07407407, 6);
    expect(r.scaleText).toMatch(/^3\/16/);
  });
  it('does not treat a zero-padded view number adjacent to a fraction as a mixed-number scale', () => {
    const r = deriveScaleFromText('DETAIL TITLE 05 1/8" = 1\' MAIN FLOOR PLAN');
    expect(r.feetPerUnit).toBeCloseTo(0.1111111, 6);
    expect(r.scaleText).toMatch(/05 1\/8/);
  });
  it('returns null when no scale notation present', () => {
    expect(deriveScaleFromText('REVISION LIST DESCRIPTION DATE')).toBeNull();
  });
});

describe('extractGrid', () => {
  it('clusters numbered column bubbles into vertical datums and drops single-occurrence note letters from rows', () => {
    const items = [
      { s: '1', xFt: 10, yFt: 0 }, { s: '1', xFt: 10, yFt: 80 }, // col 1, two bubbles
      { s: '2', xFt: 30, yFt: 0 }, { s: '2', xFt: 30, yFt: 80 }, // col 2
      { s: 'A', xFt: 0, yFt: 20 }, { s: 'A', xFt: 100, yFt: 20 }, // row A, two bubbles -> datum
      { s: 'F', xFt: 55, yFt: 41 }, // lone note letter -> dropped from row datums
    ];
    const g = extractGrid(items);
    expect(g.xs).toEqual([10, 30]);
    expect(g.ys).toEqual([20]); // only the 2-bubble row A survives
    expect(g.labels.cols).toEqual(['1', '2']);
    expect(g.labels.rows).toEqual(['A']);
  });
});

describe('segmentRooms', () => {
  // A simple closed 100x100ft box split by a wall into two rooms, with labels.
  const walls = [
    // outer box
    { x1: 0, y1: 0, x2: 100, y2: 0 }, { x1: 100, y1: 0, x2: 100, y2: 100 },
    { x1: 100, y1: 100, x2: 0, y2: 100 }, { x1: 0, y1: 100, x2: 0, y2: 0 },
    // interior divider
    { x1: 50, y1: 0, x2: 50, y2: 100 },
  ];
  it('segments enclosed spaces and classifies by nearest label', () => {
    const text = [{ s: 'STAIR', xFt: 25, yFt: 50 }, { s: 'MECH', xFt: 75, yFt: 50 }];
    const r = segmentRooms(walls, text, { gridN: 100, minRoomSqft: 100 });
    expect(r.rooms.length).toBe(2);
    const kinds = r.rooms.map((x) => x.kind).sort();
    expect(kinds).toEqual(['mech', 'stair']);
  });
  it('does not let a nearer dimension string masquerade as the room label', () => {
    const text = [
      { s: '12\'-4 1/2"', xFt: 25, yFt: 50 },
      { s: 'BISHOP', xFt: 20, yFt: 45 },
      { s: 'MEN\'S', xFt: 75, yFt: 50 },
    ];
    const result = segmentRooms(walls, text, { gridN: 100, minRoomSqft: 100 });
    expect(result.rooms.map((room) => room.kind).sort()).toEqual(['office', 'restroom']);
    expect(result.rooms.some((room) => room.label.includes('12\''))).toBe(false);
  });
  it('unlabeled spaces are kind unknown at low confidence', () => {
    const r = segmentRooms(walls, [], { gridN: 100, minRoomSqft: 100 });
    expect(r.rooms.every((x) => x.kind === 'unknown' && x.confidence === 'low')).toBe(true);
  });
  it('traces an L-shaped component instead of inflating it to its bounding rectangle', () => {
    const lWalls = [
      { x1: 0, y1: 0, x2: 40, y2: 0 }, { x1: 40, y1: 0, x2: 40, y2: 20 },
      { x1: 40, y1: 20, x2: 20, y2: 20 }, { x1: 20, y1: 20, x2: 20, y2: 40 },
      { x1: 20, y1: 40, x2: 0, y2: 40 }, { x1: 0, y1: 40, x2: 0, y2: 0 },
    ];
    const result = segmentRooms(lWalls, [{ s: 'LOBBY', xFt: 10, yFt: 10 }], {
      gridN: 160, bridgeFt: 0.25, minRoomSqft: 100, maxRoomFraction: 0.9,
    });
    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0].poly.length).toBeGreaterThan(4);
    expect(result.rooms[0].areaSqft).toBeLessThan(0.85 * 40 * 40);
    expect(result.rooms[0].kind).toBe('lobby');
  });
  it('can close a short collinear door gap without globally thickening the wall network', () => {
    const doorGapWalls = [
      { x1: 0, y1: 0, x2: 100, y2: 0 }, { x1: 100, y1: 0, x2: 100, y2: 100 },
      { x1: 100, y1: 100, x2: 0, y2: 100 }, { x1: 0, y1: 100, x2: 0, y2: 0 },
      { x1: 50, y1: 0, x2: 50, y2: 48 }, { x1: 50, y1: 52, x2: 50, y2: 100 },
    ];
    const open = segmentRooms(doorGapWalls, [], {
      gridN: 200, bridgeFt: 0, collinearBridgeFt: 0, minRoomSqft: 100, maxRoomFraction: 0.6,
    });
    const closed = segmentRooms(doorGapWalls, [], {
      gridN: 200, bridgeFt: 0, collinearBridgeFt: 5, minRoomSqft: 100, maxRoomFraction: 0.6,
    });
    expect(open.rooms).toHaveLength(0);
    expect(closed.rooms).toHaveLength(2);
  });
});

describe('isLikelyRoomLabel', () => {
  it('keeps operational space names and rejects dimensions, grids, and ceiling tags', () => {
    expect(isLikelyRoomLabel('SAC PREP')).toBe(true);
    expect(isLikelyRoomLabel('RELIEF SOCIETY')).toBe(true);
    expect(isLikelyRoomLabel('6\'-11 1/2"')).toBe(false);
    expect(isLikelyRoomLabel('CG-23')).toBe(false);
    expect(isLikelyRoomLabel('C3')).toBe(false);
    expect(isLikelyRoomLabel('SLOPED')).toBe(false);
  });
});

describe('detectStairs', () => {
  it('flags rooms classified stair and stair-token-in-room', () => {
    const rooms = [
      { kind: 'stair', poly: [[0, 0], [10, 0], [10, 10], [0, 10]], bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, confidence: 'medium' },
      { kind: 'unknown', poly: [[20, 20], [30, 20], [30, 30], [20, 30]], bbox: { minX: 20, minY: 20, maxX: 30, maxY: 30 }, confidence: 'low' },
    ];
    const text = [{ s: 'STAIR', xFt: 25, yFt: 25 }];
    const r = detectStairs(rooms, text);
    expect(r.stairs.length).toBe(2);
    expect(r.stairs[0].evidence).toBe('label-classified-stair');
    expect(r.stairs[1].evidence).toBe('stair-token-in-enclosed-room');
  });
});

describe('detectStairCores (geometric: UP/DN tokens + tread hatch)', () => {
  // Build a dense tread-hatch run (short parallel segments) around a centroid.
  function hatchRun(cx, cy, n) {
    const segs = [];
    for (let i = 0; i < n; i++) {
      const y = cy - 5 + (i / n) * 10;
      segs.push({ x1: cx - 4, y1: y, x2: cx + 4, y2: y, lineWidth: 0.09 }); // ~8ft tread, len in [0.2,4]? 8>4
    }
    // use shorter treads so segLen lands in [0.2,4]
    const out = [];
    for (let i = 0; i < n; i++) {
      const y = cy - 5 + (i / n) * 10;
      out.push({ x1: cx - 1.5, y1: y, x2: cx + 1.5, y2: y, lineWidth: 0.09 }); // 3ft tread
    }
    return out;
  }

  it('detects a stair core from UP/DOWN tokens validated by dense tread hatch', () => {
    const segments = [...hatchRun(50, 50, 120)];
    const text = [{ s: 'UP', xFt: 50, yFt: 48 }, { s: 'DOWN', xFt: 50, yFt: 52 }];
    const r = detectStairCores(segments, text, { minHatchSegs: 60 });
    expect(r.cores.length).toBe(1);
    expect(r.cores[0].evidence).toMatch(/UP\/DN/);
    expect(r.cores[0].hatchSegs).toBeGreaterThanOrEqual(60);
    expect(r.cores[0].dirTokens).toBe(2);
  });

  it('REJECTS a lone UP token with no tread hatch (no fabrication)', () => {
    const r = detectStairCores([], [{ s: 'UP', xFt: 10, yFt: 10 }], { minHatchSegs: 60 });
    expect(r.cores.length).toBe(0);
  });

  it('separates two stair cores further apart than the merge radius', () => {
    const segments = [...hatchRun(20, 20, 100), ...hatchRun(120, 120, 100)];
    const text = [
      { s: 'UP', xFt: 20, yFt: 20 }, { s: 'UP', xFt: 120, yFt: 120 },
    ];
    const r = detectStairCores(segments, text, { minHatchSegs: 60, mergeRadiusFt: 18 });
    expect(r.cores.length).toBe(2);
  });

  it('returns no cores when there are no direction tokens', () => {
    const r = detectStairCores(hatchRun(50, 50, 200), [{ s: 'OFFICE', xFt: 50, yFt: 50 }]);
    expect(r.cores.length).toBe(0);
  });
});

describe('buildLevelPlan geometric stair + parking comprehension (round-1 fix)', () => {
  // A 200x100ft closed box (heavy walls) with: a dense hatch stair shaft annotated UP/DN at
  // (40,50), and a large open low-hatch field elsewhere. Mirrors A-101: NO "STAIR"/"PARKING" text.
  function box(w, h, lw) {
    return [
      { x1: 0, y1: 0, x2: w, y2: 0, lineWidth: lw }, { x1: w, y1: 0, x2: w, y2: h, lineWidth: lw },
      { x1: w, y1: h, x2: 0, y2: h, lineWidth: lw }, { x1: 0, y1: h, x2: 0, y2: 0, lineWidth: lw },
    ];
  }
  function hatch(cx, cy, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const y = cy - 5 + (i / n) * 10;
      out.push({ x1: cx - 1.5, y1: y, x2: cx + 1.5, y2: y, lineWidth: 0.09 });
    }
    return out;
  }

  it('comprehends >=1 stair core from UP/DN+hatch even with ZERO "STAIR" text, and surfaces it in counts', () => {
    const segments = [
      ...box(200, 100, 0.35),
      // partition splitting into a shaft area (x<80) and an open field (x>=80)
      { x1: 80, y1: 0, x2: 80, y2: 100, lineWidth: 0.35 },
      ...hatch(40, 50, 200),
    ];
    const text = [{ s: 'UP', xFt: 40, yFt: 48 }, { s: 'DN', xFt: 40, yFt: 52 }];
    const plan = buildLevelPlan(
      { segments, textItemsFt: text, scaleFtPerUnit: 0.1481, scaleText: 'SCALE: 3/32" = 1\'' },
      { roomOpts: { gridN: 120, minRoomSqft: 100 } },
    );
    expect(plan.counts.stairCoresGeometric).toBeGreaterThanOrEqual(1);
    expect(plan.counts.stairs).toBeGreaterThanOrEqual(1);
    // at least one stair has geometric source + hatch evidence
    expect(plan.stairs.some((s) => s.source === 'geometric' && /UP\/DN/.test(s.evidence))).toBe(true);
    // roomKinds is surfaced and the shaft room is reclassified stair (not all unknown)
    expect(plan.roomKinds).toBeTruthy();
    expect((plan.roomKinds.stair || 0)).toBeGreaterThanOrEqual(1);
  });

  it('flags geometric stair/parking honestly (low/medium confidence, needs-verification, no AHJ claim)', () => {
    const segments = [...box(200, 100, 0.35), { x1: 80, y1: 0, x2: 80, y2: 100, lineWidth: 0.35 }, ...hatch(40, 50, 200)];
    const text = [{ s: 'UP', xFt: 40, yFt: 50 }];
    const plan = buildLevelPlan(
      { segments, textItemsFt: text, scaleFtPerUnit: 0.1481, scaleText: 'x' },
      { roomOpts: { gridN: 120, minRoomSqft: 100 } },
    );
    expect(plan.needsVerification).toBe(true);
    for (const s of plan.stairs) expect(['low', 'medium']).toContain(s.confidence);
    expect(plan.notes.stairCores).toMatch(/needs-verification|NOT verified|NOT AHJ/i);
  });
});

describe('buildLevelPlan honesty', () => {
  const segments = [
    { x1: 0, y1: 0, x2: 100, y2: 0, lineWidth: 0.35 }, { x1: 100, y1: 0, x2: 100, y2: 100, lineWidth: 0.35 },
    { x1: 100, y1: 100, x2: 0, y2: 100, lineWidth: 0.35 }, { x1: 0, y1: 100, x2: 0, y2: 0, lineWidth: 0.35 },
    { x1: 5, y1: 5, x2: 6, y2: 5, lineWidth: 0.05 }, // thin annotation
  ];
  it('throws when scale is not derived (never hardcodes 1ft/unit)', () => {
    expect(() => buildLevelPlan({ segments, textItemsFt: [], scaleFtPerUnit: 0, scaleText: 'x' })).toThrow(/derived/i);
  });
  it('emits a LevelPlan flagged needs-verification with both area measures', () => {
    const plan = buildLevelPlan({ segments, textItemsFt: [], scaleFtPerUnit: 0.1481, scaleText: 'SCALE: 3/32" = 1\'' });
    expect(plan.needsVerification).toBe(true);
    expect(plan.scaleFtPerUnit).toBeCloseTo(0.1481, 4);
    expect(typeof plan.footprintBboxAreaSqft).toBe('number');
    expect(typeof plan.footprintAreaReliable).toBe('boolean');
    expect(plan.provenance).toMatch(/needs-verification/);
  });
});

describe('reconcileWithSam fail-soft', () => {
  it('returns samUsed:false without throwing when no invoker', async () => {
    const r = await reconcileWithSam({ rooms: [{ kind: 'unknown', poly: [[0, 0]], confidence: 'low' }] }, null);
    expect(r.samUsed).toBe(false);
    expect(r.reason).toBe('no-invoker');
  });
  it('does not throw when invoker throws (SAM down)', async () => {
    const r = await reconcileWithSam(
      { rooms: [{ kind: 'unknown', poly: [[0, 0], [10, 0], [10, 10]], confidence: 'low' }], scaleFtPerUnit: 0.15 },
      async () => { throw new Error('HTTP_UNREACHABLE'); },
    );
    expect(r.samUsed).toBe(false);
    expect(r.reason).toMatch(/invoker-threw/);
  });
});

describe('buildBuildingFromPlans (stub THREE)', () => {
  function stubThree() {
    class Group { constructor() { this.children = []; this.visible = true; this.userData = {}; this.name = ''; } add(c) { this.children.push(c); } }
    class Shape { moveTo() {} lineTo() {} closePath() {} }
    class ExtrudeGeometry { rotateX() {} }
    class BoxGeometry {}
    class Mesh { constructor() { this.position = { set() {}, y: 0 }; this.rotation = { y: 0 }; this.userData = {}; this.name = ''; } }
    class MeshStandardMaterial {}
    return { Group, Shape, ExtrudeGeometry, BoxGeometry, Mesh, MeshStandardMaterial };
  }
  const plan = {
    scaleFtPerUnit: 0.1481, scaleText: 'SCALE: 3/32" = 1\'',
    footprintFt: [[0, 0], [100, 0], [100, 50], [0, 50]],
    walls: [{ a: [0, 0], b: [100, 0] }, { a: [50, 0], b: [50, 50] }],
    rooms: [{ poly: [[0, 0], [50, 0], [50, 50], [0, 50]], kind: 'parking', label: 'PARKING', areaSqft: 2500, confidence: 'medium' }],
    stairs: [{ poly: [[60, 10], [70, 10], [70, 20], [60, 20]], bbox: { minX: 60, minY: 10, maxX: 70, maxY: 20 }, evidence: 'label-classified-stair', confidence: 'medium' }],
    provenance: 'extracted — needs-verification',
  };
  it('builds one group per level and toggles visibility', () => {
    const THREE = stubThree();
    const b = buildBuildingFromPlans(THREE, [
      { level: 1, elevationFt: 0, plan },
      { level: 2, elevationFt: 10.5, plan },
    ]);
    expect(b.root.children.length).toBe(2);
    expect(b.summary.levelCount).toBe(2);
    expect(b.summary.perLevel[0].walls).toBe(2);
    expect(b.summary.perLevel[0].stairs).toBe(1);
    b.setActiveLevel(1);
    expect(b.levels.filter((l) => l.group.visible).map((l) => l.level)).toEqual([1]);
    b.setActiveLevel('all');
    expect(b.levels.every((l) => l.group.visible)).toBe(true);
  });
  it('throws on empty levelPlans (never fabricates)', () => {
    expect(() => buildBuildingFromPlans(stubThree(), [])).toThrow(/at least one/i);
  });
  it('merges walls into ONE mesh when a merger is injected and the level exceeds the threshold (draw-call perf)', () => {
    // stub THREE whose BoxGeometry supports rotateY/translate/dispose so the merge path runs.
    function mergeStubThree() {
      class Group { constructor() { this.children = []; this.visible = true; this.userData = {}; this.name = ''; } add(c) { this.children.push(c); } }
      class Shape { moveTo() {} lineTo() {} closePath() {} }
      class ExtrudeGeometry { rotateX() {} }
      class BoxGeometry { rotateY() { return this; } translate() { return this; } dispose() {} }
      class Mesh { constructor(geo) { this.geometry = geo; this.position = { set() {}, y: 0 }; this.rotation = { y: 0 }; this.userData = {}; this.name = ''; } }
      class MeshStandardMaterial {}
      return { Group, Shape, ExtrudeGeometry, BoxGeometry, Mesh, MeshStandardMaterial };
    }
    const manyWalls = Array.from({ length: 700 }, (_, i) => ({ a: [i, 0], b: [i, 50] }));
    const bigPlan = { ...plan, walls: manyWalls };
    let mergeCalls = 0;
    const mergeGeometries = (geos) => { mergeCalls += 1; return { _merged: true, _count: geos.length }; };
    const THREE = mergeStubThree();
    const b = buildBuildingFromPlans(THREE, [{ level: 1, elevationFt: 0, plan: bigPlan }], { mergeGeometries, wallMergeThreshold: 600 });
    expect(mergeCalls).toBe(1);
    expect(b.summary.perLevel[0].walls).toBe(700);
    // exactly one merged wall mesh (named plan-walls-merged), not 700 meshes.
    const merged = b.levels[0].group.children.filter((c) => c.name === 'plan-walls-merged');
    expect(merged.length).toBe(1);
    expect(merged[0].userData.merged).toBe(true);
  });
  it('keeps the per-wall (selectable) path below the merge threshold', () => {
    const THREE = stubThree();
    const b = buildBuildingFromPlans(THREE, [{ level: 1, elevationFt: 0, plan }], { mergeGeometries: () => ({}), wallMergeThreshold: 600 });
    expect(b.levels[0].group.children.filter((c) => c.name === 'plan-walls-merged').length).toBe(0);
    expect(b.summary.perLevel[0].walls).toBe(2); // the 2 per-wall meshes from `plan`
  });

  // HF-W2: doors / openings / fixtures / recovered walls + recall surfacing.
  function w2StubThree() {
    class Group {
      constructor() { this.children = []; this.visible = true; this.userData = {}; this.name = ''; this.isMesh = false; }
      add(c) { this.children.push(c); }
      traverse(fn) { fn(this); for (const c of this.children) { if (c.traverse) c.traverse(fn); else fn(c); } }
    }
    class Shape { moveTo() {} lineTo() {} closePath() {} }
    class ExtrudeGeometry { rotateX() {} }
    class BoxGeometry { rotateY() { return this; } translate() { return this; } dispose() {} }
    class Mesh { constructor(geo) { this.geometry = geo; this.position = { set() {}, y: 0 }; this.rotation = { y: 0 }; this.userData = {}; this.name = ''; this.isMesh = true; } }
    class MeshStandardMaterial {}
    class MeshBasicMaterial {}
    class Vector3 { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } }
    class BufferGeometry { setFromPoints(p) { this.points = p; return this; } }
    class LineBasicMaterial {}
    class Line { constructor(geo) { this.geometry = geo; this.userData = {}; this.name = ''; this.isMesh = false; } }
    return { Group, Shape, ExtrudeGeometry, BoxGeometry, Mesh, MeshStandardMaterial, MeshBasicMaterial, Vector3, BufferGeometry, LineBasicMaterial, Line };
  }
  const w2Plan = {
    ...plan,
    wallsFull: [{ a: [0, 0], b: [100, 0] }, { a: [50, 0], b: [50, 50] }, { a: [10, 10], b: [40, 10] }],
    wallsFullMeta: { merged: false, count: 3, recallPct: 71, recallMeasure: { method: 'stored-vs-ink', wallInkPx: 100, coveredPx: 71 } },
    doors: [
      { kind: 'door', position: [25, 0], width: 2, swingDir: [0, 1], leafDir: [1, 0], swingAngleDeg: 90, hostWall: 7, onWall: true, evidence: 'swing-arc', confidence: 'medium' },
      { kind: 'door', position: [60, 25], width: 3, swingDir: [1, 0], leafDir: [0, 1], swingAngleDeg: 88, hostWall: 12, onWall: true, confidence: 'medium' },
    ],
    openings: [{ kind: 'opening', position: [55, 45], width: 5, evidence: 'collinear-wall-gap', confidence: 'low' }],
    fixtures: [{ kind: 'fixture', fixtureKind: 'stair', position: [65, 15], source: 'stair-core', label: null, confidence: 'low' }],
    fixtureCounts: { stair: 1 },
    doorExtraction: { method: 'swing-arc-circle-fit', doorsFound: 2 },
  };

  it('renders doors (leaf+swing), openings, fixtures, recovered walls into named toggleable layers', () => {
    const THREE = w2StubThree();
    const b = buildBuildingFromPlans(THREE, [{ level: 1, elevationFt: 0, plan: w2Plan }]);
    const g = b.levels[0].group;
    const byName = (n) => g.children.find((c) => c.name === n);
    expect(byName('doors').children.length).toBe(2);
    expect(byName('openings').children.length).toBe(1);
    expect(byName('fixtures').children.length).toBe(1);
    expect(byName('recovered-walls')).toBeTruthy();
    // each door is a group with a leaf mesh + swing-arc line, tagged plan-door + needs-verification.
    const door0 = byName('doors').children[0];
    expect(door0.userData.kind).toBe('plan-door');
    expect(door0.userData.widthFt).toBe(2);
    expect(door0.userData.onWall).toBe(true);
    expect(door0.userData.needsVerification).toBe(true);
    expect(door0.children.some((c) => c.name === 'plan-door-leaf')).toBe(true);
    expect(door0.children.some((c) => c.name === 'plan-door-swing')).toBe(true);
    // counts on the summary
    expect(b.summary.perLevel[0].doors).toBe(2);
    expect(b.summary.perLevel[0].openings).toBe(1);
    expect(b.summary.perLevel[0].fixtures).toBe(1);
    expect(b.summary.perLevel[0].wallsFull).toBe(3);
  });

  it('surfaces honest wall recall + extraction completeness on the summary (never fabricated)', () => {
    const THREE = w2StubThree();
    const b = buildBuildingFromPlans(THREE, [{ level: 1, elevationFt: 0, plan: w2Plan }]);
    const ext = b.summary.extractionCompleteness;
    expect(ext).toBeTruthy();
    expect(ext.wallRecallPct).toBe(71); // reads the measured value from wallsFullMeta — NOT hardcoded 99
    expect(ext.doors).toBe(2);
    expect(ext.fixtures).toBe(1);
    expect(ext.fixtureCounts).toEqual({ stair: 1 });
    expect(ext.recoveredWalls).toBe(3);
    expect(ext.needsVerification).toBe(true);
    // a plan with NO wallsFullMeta surfaces null recall (no fabrication).
    const noMeta = buildBuildingFromPlans(THREE, [{ level: 1, elevationFt: 0, plan }]);
    expect(noMeta.summary.extractionCompleteness).toBeNull();
  });

  it('setLayerVisible toggles a named overlay across all levels; recovered walls + fixtures default OFF', () => {
    const THREE = w2StubThree();
    const b = buildBuildingFromPlans(THREE, [
      { level: 1, elevationFt: 0, plan: w2Plan },
      { level: 2, elevationFt: 10, plan: w2Plan },
    ]);
    const findLayer = (lvl, n) => b.levels[lvl].group.children.find((c) => c.name === n);
    // defaults: doors visible, recovered-walls + fixtures hidden.
    expect(findLayer(0, 'doors').visible).toBe(true);
    expect(findLayer(0, 'recovered-walls').visible).toBe(false);
    expect(findLayer(0, 'fixtures').visible).toBe(false);
    b.setLayerVisible('recovered-walls', true);
    expect(findLayer(0, 'recovered-walls').visible).toBe(true);
    expect(findLayer(1, 'recovered-walls').visible).toBe(true); // applied across all levels
    b.setLayerVisible('doors', false);
    expect(findLayer(0, 'doors').visible).toBe(false);
  });
});

describe('planBounds / polyCentroid', () => {
  it('computes footprint bounds and centroid', () => {
    const b = planBounds([[0, 0], [100, 0], [100, 60], [0, 60]]);
    expect(b.widthFt).toBe(100);
    expect(b.depthFt).toBe(60);
    expect(b.cx).toBe(50);
    expect(polyCentroid([[0, 0], [10, 0], [10, 10], [0, 10]])).toEqual([5, 5]);
  });
});

describe('unionFootprintCenter (shared world origin = geometry build origin)', () => {
  it('returns the union bbox center across levels (matches buildBuildingFromPlans origin)', () => {
    const c = unionFootprintCenter([
      { plan: { footprintFt: [[10, 20], [110, 20], [110, 80], [10, 80]] } },
      { plan: { footprintFt: [[0, 0], [200, 0], [200, 100], [0, 100]] } },
    ]);
    expect(c.minX).toBe(0); expect(c.maxX).toBe(200);
    expect(c.minY).toBe(0); expect(c.maxY).toBe(100);
    expect(c.cx).toBe(100); expect(c.cy).toBe(50);
  });
  it('returns null when no level has a positive footprint (never fabricate)', () => {
    expect(unionFootprintCenter([])).toBeNull();
    expect(unionFootprintCenter([{ plan: { footprintFt: [] } }])).toBeNull();
  });
});

describe('computePlanUnderlayTransform (register sheet UNDER geometry at true scale)', () => {
  it('sizes the plane to the page in feet at the sheet-derived scale (no contain-fit)', () => {
    // floor-1 ground truth: page bbox ~ 384 x 256 ft at s = 0.1481 ft/pt.
    const s = 0.1481;
    const wPt = 2592, hPt = 1728; // an arch-D sheet at 0.1481 ft/pt -> ~384 x 256 ft
    const t = computePlanUnderlayTransform({ pageWidthPt: wPt, pageHeightPt: hPt, scaleFtPerUnit: s, unionCenterXFt: 0, unionCenterYFt: 0 });
    expect(t.widthFt).toBeCloseTo(wPt * s, 6);
    expect(t.depthFt).toBeCloseTo(hPt * s, 6);
    expect(t.scaleFtPerUnit).toBe(s);
  });
  it('places the page center using the SAME plan-feet->world map as the geometry (sheet registers under walls)', () => {
    const s = 0.1481, wPt = 2592, hPt = 1728;
    const pageWFt = wPt * s, pageHFt = hPt * s;
    // union center from a footprint living mid-page, like the real floor 1.
    const center = unionFootprintCenter([{ plan: { footprintFt: [[60, 90], [327, 90], [327, 167], [60, 167]] } }]);
    const t = computePlanUnderlayTransform({ pageWidthPt: wPt, pageHeightPt: hPt, scaleFtPerUnit: s, unionCenterXFt: center.cx, unionCenterYFt: center.cy, elevationFt: 0 });
    // page center in plan feet is (pageWFt/2, pageHFt/2); world = plan - center.
    expect(t.position.x).toBeCloseTo(pageWFt / 2 - center.cx, 6);
    expect(t.position.z).toBeCloseTo(pageHFt / 2 - center.cy, 6);
  });
  // REGISTRATION-CORRECTED LIVE 2026-06-15 (underlay-registration): the texture V axis must run the
  // SAME direction as the geometry's plan-Y -> world-Z map (worldZ = planY - cy, INCREASING). With the
  // -PI/2 plane and the default CanvasTexture flipY=true, NO flip maps PDF-Y DECREASING with world-Z —
  // the inverse of the geometry — which placed the extracted footprint under the WRONG sheet band.
  // flipTextureV:true mirrors V so PDF-Y runs WITH world-Z, registering geometry over the plan region
  // it was extracted from. The earlier no-flip assertion tested readability, not ink registration.
  it('uses -PI/2 with flipTextureV:true so texture V matches the geometry plan-Y -> world-Z direction', () => {
    const t = computePlanUnderlayTransform({ pageWidthPt: 100, pageHeightPt: 100, scaleFtPerUnit: 0.15 });
    expect(t.rotation.x).toBeCloseTo(-Math.PI / 2, 9);
    expect(t.flipTextureV).toBe(true);
    expect(t.needsVerification).toBe(true);
    expect(t.scaleSource).toMatch(/needs-verification/i);
  });
  it('throws on a non-positive sheet-derived scale (never hardcode a fallback scale)', () => {
    expect(() => computePlanUnderlayTransform({ pageWidthPt: 100, pageHeightPt: 100, scaleFtPerUnit: 0 })).toThrow(/scaleFtPerUnit/);
  });
});

// ---- STREAM A: stacked plan views (A-101 two-wing match-line split) ----

describe('splitStackedPlanViews', () => {
  // Two stacked solid boxes separated by a sustained empty gap (the inter-view margin).
  // Lower box y in [0,40], upper box y in [100,140], gap y in (40,100). Each box is a dense
  // grid of short segments so the Y-occupancy histogram has two humps and one wide valley.
  const denseBox = (y0, y1) => {
    const segs = [];
    for (let y = y0; y <= y1; y += 1) for (let x = 0; x <= 80; x += 2) segs.push({ x1: x, y1: y, x2: x + 2, y2: y });
    return segs;
  };
  const segs = [...denseBox(0, 40), ...denseBox(100, 140)];

  it('detects the inter-view gap and splits at its center (NOT a within-wing wall-row dip)', () => {
    const r = splitStackedPlanViews(segs, [], {});
    expect(r.isStacked).toBe(true);
    expect(r.splitYFt).toBeGreaterThan(40);
    expect(r.splitYFt).toBeLessThan(100);
    const lower = r.views.find((v) => v.region === 'lower');
    const upper = r.views.find((v) => v.region === 'upper');
    expect(lower.segments.length).toBeGreaterThan(0);
    expect(upper.segments.length).toBeGreaterThan(0);
    expect(lower.segments.every((s) => (s.y1 + s.y2) / 2 < r.splitYFt)).toBe(true);
    expect(upper.segments.every((s) => (s.y1 + s.y2) / 2 >= r.splitYFt)).toBe(true);
  });

  it('splits text items at the same Y line', () => {
    const txt = [{ s: 'LOWER', xFt: 10, yFt: 20 }, { s: 'UPPER', xFt: 10, yFt: 120 }];
    const r = splitStackedPlanViews(segs, txt, {});
    const lower = r.views.find((v) => v.region === 'lower');
    const upper = r.views.find((v) => v.region === 'upper');
    expect(lower.textItemsFt.map((t) => t.s)).toEqual(['LOWER']);
    expect(upper.textItemsFt.map((t) => t.s)).toEqual(['UPPER']);
  });

  it('returns isStacked=false for a single dense plan view (no sustained inter-view gap)', () => {
    const r = splitStackedPlanViews(denseBox(0, 60), [], {});
    expect(r.isStacked).toBe(false);
    expect(r.views.length).toBe(1);
    expect(r.views[0].region).toBe('single');
  });

  it('returns single for trivially few segments (never fabricates a split)', () => {
    expect(splitStackedPlanViews([{ x1: 0, y1: 0, x2: 1, y2: 1 }], [], {}).isStacked).toBe(false);
  });
});

describe('computeWingRegistration', () => {
  // Shared columns 19..23 at a CONSTANT -57ft offset; columns 1,5 are CONTAMINATED and must be
  // rejected by consensus. Equal wall-bbox height (same building width) so Y aligns by edge.
  const wingA = {
    grid: {
      colDatums: [
        { label: '1', xFt: 317 }, { label: '5', xFt: 314 },
        { label: '19', xFt: 119.7 }, { label: '20', xFt: 108.7 }, { label: '21', xFt: 97.7 },
        { label: '22', xFt: 86.7 }, { label: '23', xFt: 75.7 },
      ],
      rowDatums: [{ label: 'A', yFt: 38.2 }],
    },
    wallBboxFt: { minX: 73.6, maxX: 341.1, minY: 35.8, maxY: 117.7, widthFt: 267.5, heightFt: 81.9 },
    footprintBboxFt: { minX: 73.6, maxX: 341.1, minY: 35.8, maxY: 117.7, widthFt: 267.5, heightFt: 81.9 },
  };
  const wingB = {
    grid: {
      colDatums: [
        { label: '1', xFt: 39 }, { label: '5', xFt: 273 },
        { label: '19', xFt: 176.6 }, { label: '20', xFt: 165.6 }, { label: '21', xFt: 154.6 },
        { label: '22', xFt: 143.6 }, { label: '23', xFt: 132.6 },
      ],
      rowDatums: [{ label: 'A', yFt: 201.2 }],
    },
    wallBboxFt: { minX: 36.6, maxX: 216.5, minY: 147.5, maxY: 229.4, widthFt: 179.9, heightFt: 81.9 },
    footprintBboxFt: { minX: 36.6, maxX: 216.5, minY: 147.5, maxY: 229.4, widthFt: 179.9, heightFt: 81.9 },
  };

  it('recovers the constant column offset via consensus, rejecting contaminated shared labels', () => {
    const reg = computeWingRegistration(wingA, wingB, {});
    expect(reg.dx).toBeCloseTo(-57, 0);
    expect(reg.inlierCols.sort()).toEqual(['19', '20', '21', '22', '23']);
    expect(reg.colInlierCount).toBe(5);
    expect(reg.confidence).toBe('medium');
  });

  it('aligns Y by equal-height wall-bbox bottom edges (rejects prose-contaminated row consensus)', () => {
    const reg = computeWingRegistration(wingA, wingB, {});
    expect(reg.dy).toBeCloseTo(-111.7, 1);
    expect(reg.inlierRows).toEqual([]);
    expect(reg.method).toMatch(/wall-bbox-bottom-edge-Y/);
  });

  it('falls back to wall-bbox edges with low confidence when no shared columns', () => {
    const a = { grid: { colDatums: [{ label: '1', xFt: 10 }] }, wallBboxFt: { minX: 0, maxX: 100, minY: 0, maxY: 50, widthFt: 100, heightFt: 50 }, footprintBboxFt: { minX: 0, maxX: 100, minY: 0, maxY: 50, widthFt: 100, heightFt: 50 } };
    const b = { grid: { colDatums: [{ label: '9', xFt: 30 }] }, wallBboxFt: { minX: 20, maxX: 140, minY: 60, maxY: 110, widthFt: 120, heightFt: 50 }, footprintBboxFt: { minX: 20, maxX: 140, minY: 60, maxY: 110, widthFt: 120, heightFt: 50 } };
    const reg = computeWingRegistration(a, b, {});
    expect(reg.confidence).toBe('low');
    expect(reg.method).toMatch(/no-shared-columns/);
  });
});

describe('mergeWingPlans', () => {
  const mkWing = (offX, offY, label) => ({
    scaleFtPerUnit: 0.1481, scaleText: 'SCALE: 3/32 = 1', scaleSource: 'sheet-printed-scale-notation',
    footprintFt: [[offX, offY], [offX + 100, offY], [offX + 100, offY + 80], [offX, offY + 80]],
    footprintBboxFt: { minX: offX, maxX: offX + 100, minY: offY, maxY: offY + 80, widthFt: 100, heightFt: 80 },
    wallBboxFt: { minX: offX, maxX: offX + 100, minY: offY, maxY: offY + 80, widthFt: 100, heightFt: 80 },
    walls: [{ a: [offX, offY], b: [offX + 100, offY] }],
    rooms: [{ poly: [[offX + 10, offY + 10], [offX + 20, offY + 10], [offX + 20, offY + 20], [offX + 10, offY + 20]], label, kind: 'unknown', areaSqft: 100, confidence: 'low' }],
    stairs: [{ poly: [[offX + 5, offY + 5], [offX + 9, offY + 5], [offX + 9, offY + 9], [offX + 5, offY + 9]], bbox: { minX: offX + 5, minY: offY + 5, maxX: offX + 9, maxY: offY + 9 }, centroidFt: [offX + 7, offY + 7], evidence: 'x', confidence: 'low', source: 'geometric' }],
    grid: { xs: [offX + 10], ys: [offY + 10], labels: { cols: ['1'], rows: ['A'] }, colDatums: [{ label: '1', xFt: offX + 10 }], rowDatums: [{ label: 'A', yFt: offY + 10 }] },
    labels: [{ text: label, xFt: offX + 50, yFt: offY + 40 }],
    counts: { segments: 1000, wallSegments: 1, rooms: 1, stairs: 1, stairCoresGeometric: 1, stairsLabelBased: 0, gridCols: 1, gridRows: 1 },
    wallLayer: { method: 'm', chosen: {} }, occupancyHint: null,
    notes: { rooms: 'rn', stairs: 'sn' },
  });
  const A = mkWing(0, 0, 'LOWER');
  const B = mkWing(50, 200, 'UPPER');

  it('translates wing B onto A and unions geometry + counts', () => {
    const reg = computeWingRegistration(A, B, {});
    const merged = mergeWingPlans(A, B, reg, { scaleFtPerUnit: 0.1481, scaleText: A.scaleText, scaleSource: A.scaleSource });
    expect(merged.walls.length).toBe(2);
    expect(merged.rooms.length).toBe(2);
    expect(merged.stairs.length).toBe(2);
    expect(merged.counts.stairs).toBe(2);
    expect(merged.counts.rooms).toBe(2);
    const upperLabel = merged.labels.find((l) => l.text === 'UPPER');
    expect(upperLabel.yFt).toBeLessThan(120);
    expect(merged.footprintAreaReliable).toBe(false);
    expect(merged.merged.wings).toBe(2);
    expect(merged.provenance).toMatch(/MERGED from TWO stacked plan views/);
    expect(merged.needsVerification).toBe(true);
  });

  it('merged footprint bbox spans both wings in the common frame', () => {
    const reg = computeWingRegistration(A, B, {});
    const merged = mergeWingPlans(A, B, reg, {});
    expect(merged.footprintBboxFt.widthFt).toBeGreaterThan(99);
    expect(merged.footprintBboxFt.heightFt).toBeCloseTo(80, 0);
  });
});
