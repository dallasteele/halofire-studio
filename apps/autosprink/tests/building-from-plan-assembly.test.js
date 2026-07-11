import { describe, it, expect } from 'vitest';
import { buildBuildingFromPlans } from '../src/engine/building-from-plan.js';

/*
 * ASSEMBLE-BUILDING test — the RASTER PDF -> BUILDING MODEL critical-path assembly step.
 *
 * buildBuildingFromPlans() is the function the Studio intake calls to assemble the EXTRACTED
 * geometry (walls + openings/doors/windows + columns + fixtures + rooms, at the sheet's true
 * scale) into the renderable Building the head-placer + router run on. It previously had no
 * dedicated test. These tests assert an ASSEMBLY-RECALL metric: every extracted input element
 * produces a corresponding mesh/group in the built model (no silent drops), with no fabrication
 * (nothing assembled that was not in the input), and the honest needs-verification provenance.
 */

// Minimal THREE stub — only the surface buildBuildingFromPlans touches. Each geometry/mesh is a
// plain object so we can traverse + count. No merge fn injected => per-element (countable) path.
function stubTHREE() {
  class Group {
    constructor() { this.children = []; this.name = ''; this.userData = {}; this.visible = true; this.isGroup = true; this.parent = null; }
    add(o) { o.parent = this; this.children.push(o); return this; }
    traverse(fn) { fn(this); for (const c of this.children) { if (c.traverse) c.traverse(fn); else fn(c); } }
  }
  class Mesh {
    constructor(geo, mat) { this.geometry = geo; this.material = mat; this.name = ''; this.userData = {}; this.visible = true; this.isMesh = true; this.parent = null; this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }; this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }; this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }; }
    traverse(fn) { fn(this); }
  }
  function geom(verts = 24) {
    return {
      isGeometry: true,
      attributes: { position: { count: verts } },
      rotateX() { return this; }, rotateY() { return this; }, rotateZ() { return this; },
      translate() { return this; }, dispose() {},
    };
  }
  class Shape { constructor() { this.holes = []; } moveTo() {} lineTo() {} closePath() {} }
  return {
    Group, Mesh,
    BoxGeometry: function () { return geom(24); },
    ExtrudeGeometry: function () { return geom(48); },
    ShapeGeometry: function () { return geom(6); },
    BufferGeometry: function () { return { setFromPoints() { return this; }, attributes: { position: { count: 12 } }, dispose() {} }; },
    Line: class { constructor(g, m) { this.geometry = g; this.material = m; this.name = ''; this.userData = {}; this.isLine = true; this.parent = null; } traverse(fn) { fn(this); } },
    LineBasicMaterial: function (o) { return { ...o, isMat: true }; },
    MeshStandardMaterial: function (o) { return { ...o, isMat: true }; },
    MeshBasicMaterial: function (o) { return { ...o, isMat: true }; },
    Shape,
    Vector2: function (x, y) { return { x, y }; },
    Vector3: function (x, y, z) { return { x, y, z }; },
    DoubleSide: 2,
  };
}

// A small but COMPLETE extracted level: a rectangular footprint with wall runs, a traced room,
// a door, a window, a cased opening, a column (real marker-extraction), and a fixture symbol.
function sampleLevelPlan() {
  return {
    level: 1,
    name: 'Level 1',
    elevationFt: 0,
    plan: {
      scaleFtPerUnit: 0.1481,
      scaleText: '3/32" = 1\'-0"',
      footprintFt: [[0, 0], [40, 0], [40, 30], [0, 30]],
      // wallRuns = the high-recall collinear-merged real walls (the headline structure).
      wallRuns: [
        { a: [0, 0], b: [40, 0] }, { a: [40, 0], b: [40, 30] },
        { a: [40, 30], b: [0, 30] }, { a: [0, 30], b: [0, 0] },
        { a: [20, 0], b: [20, 30] }, // interior partition
      ],
      walls: [{ a: [0, 0], b: [10, 0] }, { a: [10, 0], b: [40, 0] }], // fragmented raw (provenance only)
      roomBoundaries: [
        { poly: [[0.5, 0.5], [19.5, 0.5], [19.5, 29.5], [0.5, 29.5]], areaSqft: 551, kind: 'unknown', wallCoverage: 0.98, confidence: 'medium' },
      ],
      doors: [{ position: [20, 15], width: 3, confidence: 'medium' }],
      windows: [{ position: [40, 15], width: 4, confidence: 'medium', mullionLines: 4 }],
      openings: [{ position: [10, 0], width: 5, confidence: 'low' }],
      columns: [{ x: 20, y: 15, sizeFt: 1.9, confidence: 'medium', source: 'marker-extraction' }],
      columnSource: 'marker-extraction',
      fixtureSymbols: [{ position: [5, 5], fixtureKind: 'equipment', widthFt: 2, heightFt: 2, source: 'symbol-cluster', confidence: 'low' }],
    },
  };
}

describe('buildBuildingFromPlans — ASSEMBLE-BUILDING (raster PDF -> Building model)', () => {
  it('throws (never fabricates) when given no levels', () => {
    const THREE = stubTHREE();
    expect(() => buildBuildingFromPlans(THREE, [])).toThrow(/at least one/i);
    expect(() => buildBuildingFromPlans(THREE, null)).toThrow();
  });

  it('throws when no level has a positive footprint (no plan -> no building)', () => {
    const THREE = stubTHREE();
    expect(() => buildBuildingFromPlans(THREE, [{ level: 1, elevationFt: 0, plan: { footprintFt: [[0, 0]] } }]))
      .toThrow(/positive footprint/i);
  });

  it('assembles a building-from-plan root tagged needs-verification (engineering aid)', () => {
    const THREE = stubTHREE();
    const api = buildBuildingFromPlans(THREE, [sampleLevelPlan()]);
    expect(api.root.name).toBe('building-from-plan');
    expect(api.root.userData.kind).toBe('building-from-plan');
    expect(api.root.userData.needsVerification).toBe(true);
    expect(api.summary.needsVerification).toBe(true);
    expect(api.bounds.widthFt).toBeCloseTo(40, 5);
    expect(api.bounds.depthFt).toBeCloseTo(30, 5);
  });

  it('ASSEMBLY RECALL = 1.0 — every extracted element becomes a renderable mesh/group (no silent drops)', () => {
    const THREE = stubTHREE();
    const plan = sampleLevelPlan();
    const api = buildBuildingFromPlans(THREE, [plan]);
    const c = api.summary.perLevel[0];

    // Each extraction class must be fully assembled (assembled / input === 1).
    const inWalls = plan.plan.wallRuns.length;
    const inRooms = plan.plan.roomBoundaries.length;
    const inDoors = plan.plan.doors.length;
    const inWindows = plan.plan.windows.length;
    const inOpenings = plan.plan.openings.length;
    const inColumns = plan.plan.columns.length;
    const inFixtures = plan.plan.fixtureSymbols.length;

    expect(c.walls).toBe(inWalls);
    expect(c.rooms).toBe(inRooms);
    expect(c.doors).toBe(inDoors);
    expect(c.windows).toBe(inWindows);
    expect(c.openings).toBe(inOpenings);
    expect(c.columns).toBe(inColumns);
    expect(c.fixtures).toBe(inFixtures);

    // explicit recall metric (assembled / extracted) per class — all 100%.
    const recall = (a, b) => (b === 0 ? 1 : a / b);
    expect(recall(c.walls, inWalls)).toBe(1);
    expect(recall(c.rooms, inRooms)).toBe(1);
    expect(recall(c.doors, inDoors)).toBe(1);
    expect(recall(c.windows, inWindows)).toBe(1);
    expect(recall(c.openings, inOpenings)).toBe(1);
    expect(recall(c.columns, inColumns)).toBe(1);
    expect(recall(c.fixtures, inFixtures)).toBe(1);

    // honest provenance carried through: marker-extraction columns, boundary-trace rooms.
    expect(c.columnSource).toBe('marker-extraction');
    expect(c.roomSource).toBe('boundary-trace');
  });

  it('puts named layer groups in the scene for every assembled class (the head-placer/LAYERS need them)', () => {
    const THREE = stubTHREE();
    const api = buildBuildingFromPlans(THREE, [sampleLevelPlan()]);
    const names = new Set();
    api.root.traverse((o) => { if (o.name) names.add(o.name); });
    expect(names.has('building-from-plan')).toBe(true);
    expect(names.has('level:1')).toBe(true);
    expect(names.has('doors')).toBe(true);
    expect(names.has('windows')).toBe(true);
    expect(names.has('openings')).toBe(true);
    expect(names.has('columns')).toBe(true);
    // a real mesh with positions exists (the building actually renders, not just counts)
    let meshes = 0, verts = 0;
    api.root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes) { meshes++; verts += o.geometry.attributes.position.count; } });
    expect(meshes).toBeGreaterThan(0);
    expect(verts).toBeGreaterThan(0);
  });

  it('renders every system-verified accepted head in the real 3D level', () => {
    const THREE = stubTHREE();
    const accepted = sampleLevelPlan();
    accepted.plan.geometryGrounded = true;
    accepted.plan.heads = [
      { x: 5, y: 5, roomId: 'room-1' },
      { x: 12, y: 8, roomId: 'room-1' },
    ];
    accepted.plan.sprinklerEvidence = {
      source: 'accepted-geometry-layout', systemVerified: true,
      headCount: 2, outsideHeadCount: 0,
      pipeAvailable: true, pipeSystemVerified: true,
      routeSetDigest: 'f'.repeat(64), pipeSegmentCount: 2,
    };
    accepted.plan.pipeSegments = [
      { id: 'seg-1', x1: 5, y1: 5, x2: 12, y2: 5, size_in: 2, kind: 'main' },
      { id: 'seg-2', x1: 12, y1: 5, x2: 12, y2: 8, size_in: 1.25, kind: 'branch' },
    ];
    const api = buildBuildingFromPlans(THREE, [accepted]);
    const heads = [], pipes = [];
    api.root.traverse((object) => {
      if (object.name === 'accepted-sprinkler-head') heads.push(object);
      if (object.name === 'accepted-pipe-segment') pipes.push(object);
    });
    expect(api.root.userData.systemVerified).toBe(true);
    expect(api.root.userData.needsVerification).toBe(false);
    expect(api.summary.systemVerified).toBe(true);
    expect(api.summary.perLevel[0].sprinklerHeads).toBe(2);
    expect(api.summary.perLevel[0].sprinklerPipeSegments).toBe(2);
    expect(heads).toHaveLength(2);
    expect(pipes).toHaveLength(2);
    expect(heads.every((head) => head.userData.needsVerification === false)).toBe(true);
    expect(pipes.every((pipe) => pipe.userData.needsVerification === false)).toBe(true);
    expect(pipes.every((pipe) => Math.abs(pipe.position.y - 8.65) < 1e-9)).toBe(true);
  });

  it('builds a CONTINUOUS PERIMETER SHELL from the footprint loop (closed building, not scattered stubs)', () => {
    const THREE = stubTHREE();
    const api = buildBuildingFromPlans(THREE, [sampleLevelPlan()], { wallHeightFt: 14 });
    // a perimeter-shell group exists, tagged for the WALLS layer + needs-verification
    let shell = null;
    api.root.traverse((o) => { if (o.name === 'perimeter-shell' && !shell) shell = o; });
    expect(shell).not.toBeNull();
    expect(shell.userData.kind).toBe('plan-perimeter-shell');
    expect(shell.userData.needsVerification).toBe(true);
    // one perimeter-wall mesh per footprint edge (4 edges for the rect footprint)
    const edges = shell.children.filter((c) => c.userData && c.userData.kind === 'plan-perimeter-wall');
    expect(edges.length).toBe(4);
    // surfaced honestly on the level counts
    expect(api.summary.perLevel[0].perimeterEdges).toBe(4);
  });

  it('extrudes walls + columns + perimeter to the requested ceiling height (true scale, not a flat plate)', () => {
    const THREE = stubTHREE();
    const H = 14;
    const api = buildBuildingFromPlans(THREE, [sampleLevelPlan()], { wallHeightFt: H });
    // collect every standing-member mesh's center-Y and box height from the stub transforms.
    // stub Mesh.position.set records y; perimeter/wall/column all center at elev + H/2.
    let perimeter = null, column = null;
    api.root.traverse((o) => {
      if (o.userData && o.userData.kind === 'plan-perimeter-wall' && !perimeter) perimeter = o;
      if (o.userData && o.userData.kind === 'plan-column' && !column) column = o;
    });
    expect(perimeter).not.toBeNull();
    expect(column).not.toBeNull();
    // center Y at H/2 (elev 0) => member spans 0..H (slab->ceiling), the true-scale standing height
    expect(perimeter.position.y).toBeCloseTo(H / 2, 5);
    expect(column.position.y).toBeCloseTo(H / 2, 5);
  });

  it('does NOT fabricate columns when the plan carries neither columns nor a grid', () => {
    const THREE = stubTHREE();
    const plan = sampleLevelPlan();
    delete plan.plan.columns; delete plan.plan.columnSource; delete plan.plan.grid;
    const api = buildBuildingFromPlans(THREE, [plan]);
    expect(api.summary.perLevel[0].columns).toBe(0);
    expect(api.summary.perLevel[0].columnSource).toBeNull();
  });

  it('assembles multiple levels into a shared origin (vertical alignment)', () => {
    const THREE = stubTHREE();
    const l1 = sampleLevelPlan();
    const l2 = sampleLevelPlan(); l2.level = 2; l2.name = 'Level 2'; l2.elevationFt = 12;
    const api = buildBuildingFromPlans(THREE, [l1, l2]);
    expect(api.summary.levelCount).toBe(2);
    expect(api.levels.map((l) => l.level).sort()).toEqual([1, 2]);
    // each level group present
    const levelGroups = [];
    api.root.traverse((o) => { if (/^level:/.test(o.name || '')) levelGroups.push(o.name); });
    expect(levelGroups).toContain('level:1');
    expect(levelGroups).toContain('level:2');
  });
});
