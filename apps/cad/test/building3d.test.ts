// building3d.ts (W2) PURE tests: the floor-slab/wall extrusion math is
// deterministic given the building, slab area matches polygonAreaSqFt for a known
// polygon, N rooms -> N floors, wall extrusion height == ceiling height, and the
// active backend name is reported truthfully. No WebGL / DOM needed — these are
// pure geometry assertions on three BufferGeometry buffers.

import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import {
  ACTIVE_BACKEND_NAME,
  DEFAULT_WALL_THICKNESS_FT,
  OPEN_GEOMETRY_INTEGRATED,
  buildBuildingMeshes,
  buildingBoundsFt,
  threeBackend,
  type FtPoint,
} from '../src/lib/building3d';
import { polygonAreaSqFt } from '../src/lib/scale';
import type { Building, Point2, Room, Wall } from '../src/lib/model';

/** A 10x20 (units) rectangle room. */
function rectRoom(id: string, w: number, h: number, hazard: Room['hazard'] = 'LIGHT'): Room {
  return {
    id,
    polygon: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    hazard,
    ceilingHt: 10,
  };
}

function buildingWith(rooms: Room[], walls: Wall[], scaleFtPerUnit = 1): Building {
  return { rooms, walls, scaleFtPerUnit, source: 'manual' };
}

/** Bounding-box height (y span) of a geometry. */
function geomHeight(geometry: { boundingBox: Box3 | null } & object): number {
  const g = geometry as { boundingBox: Box3 | null };
  const box = g.boundingBox;
  if (!box) return 0;
  return box.max.y - box.min.y;
}

describe('active backend reporting (honesty)', () => {
  it('reports a concrete backend name', () => {
    expect(typeof ACTIVE_BACKEND_NAME).toBe('string');
    expect(ACTIVE_BACKEND_NAME.length).toBeGreaterThan(0);
  });

  it('reports the three.js extrude backend (OpenGeometry not integrated)', () => {
    // Truthful: three.js does the work, so the name is three-extrude and the
    // OpenGeometry flag is false. If a real OpenGeometry backend ever lands, these
    // assertions are the gate that forces the report to stay honest.
    expect(ACTIVE_BACKEND_NAME).toBe('three-extrude');
    expect(OPEN_GEOMETRY_INTEGRATED).toBe(false);
  });

  it('buildBuildingMeshes echoes the active backend name', () => {
    const b = buildingWith([rectRoom('r1', 10, 20)], []);
    expect(buildBuildingMeshes(b).backend).toBe(ACTIVE_BACKEND_NAME);
  });
});

describe('slab area matches polygonAreaSqFt', () => {
  it('a 10x20 unit room at scale 1 -> 200 sqft floor', () => {
    const room = rectRoom('r1', 10, 20);
    const b = buildingWith([room], []);
    const { floors } = buildBuildingMeshes(b);
    expect(floors).toHaveLength(1);
    const expected = polygonAreaSqFt(room.polygon, 1);
    expect(expected).toBe(200);
    expect(floors[0].areaSqFt).toBeCloseTo(expected, 6);
  });

  it('honors scaleFtPerUnit: 10x20 units at 0.5 ft/unit -> 50 sqft', () => {
    const room = rectRoom('r1', 10, 20);
    const b = buildingWith([room], [], 0.5);
    const { floors } = buildBuildingMeshes(b);
    const expected = polygonAreaSqFt(room.polygon, 0.5);
    expect(expected).toBe(50);
    expect(floors[0].areaSqFt).toBeCloseTo(expected, 6);
  });

  it('the slab geometry footprint matches the room dimensions in feet', () => {
    const room = rectRoom('r1', 10, 20);
    const geo = threeBackend.slab(
      room.polygon.map((p): FtPoint => ({ x: p.x, z: p.y })),
    );
    expect(geo).not.toBeNull();
    geo!.computeBoundingBox();
    const box = geo!.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(10, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(20, 6);
    // Floor lies flat: near-zero y span.
    expect(Math.abs(box.max.y - box.min.y)).toBeLessThan(1e-6);
  });
});

describe('N rooms -> N floors (no fabrication)', () => {
  it('three rooms produce exactly three floors', () => {
    const b = buildingWith(
      [rectRoom('a', 10, 10), rectRoom('b', 8, 8), rectRoom('c', 5, 12)],
      [],
    );
    const { floors } = buildBuildingMeshes(b);
    expect(floors).toHaveLength(3);
    expect(floors.map((f) => f.roomId)).toEqual(['a', 'b', 'c']);
  });

  it('empty building -> zero floors and zero walls', () => {
    const b = buildingWith([], []);
    const m = buildBuildingMeshes(b);
    expect(m.floors).toHaveLength(0);
    expect(m.walls).toHaveLength(0);
  });

  it('each floor carries its source room id and hazard 1:1', () => {
    const b = buildingWith(
      [rectRoom('mech', 10, 10, 'ORDINARY_2'), rectRoom('office', 12, 9, 'LIGHT')],
      [],
    );
    const { floors } = buildBuildingMeshes(b);
    expect(floors[0]).toMatchObject({ roomId: 'mech', hazard: 'ORDINARY_2' });
    expect(floors[1]).toMatchObject({ roomId: 'office', hazard: 'LIGHT' });
  });
});

describe('wall extrusion height == ceiling height', () => {
  const wall: Wall = {
    id: 'w1',
    start: { x: 0, y: 0 },
    end: { x: 30, y: 0 },
  };

  it('default ceiling height (10 ft) extrudes a 10 ft wall', () => {
    const b = buildingWith([], [wall]);
    const { walls } = buildBuildingMeshes(b);
    expect(walls).toHaveLength(1);
    expect(walls[0].heightFt).toBe(10);
    expect(geomHeight(walls[0].geometry as never)).toBeCloseTo(10, 5);
  });

  it('explicit ceiling height is the extrusion height', () => {
    const b = buildingWith([], [wall]);
    const { walls } = buildBuildingMeshes(b, { ceilingHt: 14 });
    expect(walls[0].heightFt).toBe(14);
    expect(geomHeight(walls[0].geometry as never)).toBeCloseTo(14, 5);
  });

  it('scaleFtPerUnit affects wall LENGTH but not its (feet) height', () => {
    const b = buildingWith([], [wall], 0.5);
    const { walls } = buildBuildingMeshes(b, { ceilingHt: 12 });
    const g = walls[0].geometry!;
    g.computeBoundingBox();
    const box = g.boundingBox!;
    // 30 units * 0.5 ft/unit = 15 ft + thickness overlap on both ends.
    const expectedLen = 30 * 0.5 + DEFAULT_WALL_THICKNESS_FT;
    expect(box.max.x - box.min.x).toBeCloseTo(expectedLen, 4);
    expect(box.max.y - box.min.y).toBeCloseTo(12, 5);
  });
});

describe('determinism', () => {
  it('same building -> byte-identical slab + wall buffers', () => {
    const b = buildingWith(
      [rectRoom('r', 11, 23)],
      [{ id: 'w', start: { x: 0, y: 0 }, end: { x: 11, y: 0 } }],
    );
    const m1 = buildBuildingMeshes(b);
    const m2 = buildBuildingMeshes(b);
    const f1 = m1.floors[0].geometry!.getAttribute('position').array;
    const f2 = m2.floors[0].geometry!.getAttribute('position').array;
    expect(Array.from(f1)).toEqual(Array.from(f2));
    const w1 = m1.walls[0].geometry!.getAttribute('position').array;
    const w2 = m2.walls[0].geometry!.getAttribute('position').array;
    expect(Array.from(w1)).toEqual(Array.from(w2));
  });
});

describe('buildingBoundsFt', () => {
  it('computes the union bbox in feet and a recentering center', () => {
    const b = buildingWith([rectRoom('r', 10, 20)], [], 2);
    const bounds = buildingBoundsFt(b);
    // 10x20 units * 2 ft/unit = 20x40 ft.
    expect(bounds.widthFt).toBeCloseTo(20, 6);
    expect(bounds.depthFt).toBeCloseTo(40, 6);
    expect(bounds.cx).toBeCloseTo(10, 6);
    expect(bounds.cy).toBeCloseTo(20, 6);
  });

  it('empty building -> zeroed bounds centered at origin', () => {
    const bounds = buildingBoundsFt(buildingWith([], []));
    expect(bounds).toMatchObject({ widthFt: 0, depthFt: 0, cx: 0, cy: 0 });
  });

  it('recenters geometry on the origin', () => {
    // A room far from origin should produce a slab centered near origin.
    const room: Room = {
      id: 'r',
      polygon: [
        { x: 100, y: 100 },
        { x: 110, y: 100 },
        { x: 110, y: 120 },
        { x: 100, y: 120 },
      ],
      hazard: 'LIGHT',
      ceilingHt: 10,
    };
    const { floors } = buildBuildingMeshes(buildingWith([room], []));
    const g = floors[0].geometry!;
    g.computeBoundingBox();
    const box = g.boundingBox!;
    const cx = (box.max.x + box.min.x) / 2;
    const cz = (box.max.z + box.min.z) / 2;
    expect(Math.abs(cx)).toBeLessThan(1e-6);
    expect(Math.abs(cz)).toBeLessThan(1e-6);
  });
});

describe('degenerate inputs (no fabrication)', () => {
  it('slab of a <3-point polygon is null', () => {
    expect(threeBackend.slab([{ x: 0, z: 0 }, { x: 1, z: 1 }])).toBeNull();
  });

  it('wall with a zero-length run is null', () => {
    const pts: Point2[] = [];
    void pts;
    expect(threeBackend.wall([{ x: 0, z: 0 }, { x: 0, z: 0 }], 10, 0.5)).toBeNull();
  });

  it('wall with non-positive height is null', () => {
    expect(threeBackend.wall([{ x: 0, z: 0 }, { x: 5, z: 0 }], 0, 0.5)).toBeNull();
  });
});
