// building-mesh.ts (M-3D.1) PURE adapter tests: wallSolid/slabSolid composition
// into combined position/index buffers — no WebGL, no DOM, no THREE scene. We
// assert merged buffer shapes, scene-space axis mapping (y up), per-wall
// thickness/height defaults, outward triangle winding (the flat-shading
// hygiene), per-room floor/ceiling slab elevations, honest degenerate skips,
// and wall-height resolution against room polygons.

import { describe, expect, it } from 'vitest';
import {
  BUILDING_MESH_BACKEND,
  CEILING_SLAB_THICKNESS_FT,
  DEFAULT_WALL_THICKNESS_FT,
  FLOOR_SLAB_THICKNESS_FT,
  buildingToMeshData,
  resolveWallHeightFt,
  roomSlabs,
  wallsToMeshData,
  type CombinedMesh,
} from '../src/lib/building-mesh';
import type { Building } from '../src/lib/model';

/** Axis-aligned bbox of a combined mesh's positions. */
function bbox(mesh: CombinedMesh): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = mesh.positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

/** Every triangle's normal must point AWAY from the buffer's vertex centroid. */
function allTrianglesOutward(mesh: CombinedMesh): boolean {
  const p = mesh.positions;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const vc = p.length / 3;
  for (let i = 0; i < p.length; i += 3) {
    cx += p[i];
    cy += p[i + 1];
    cz += p[i + 2];
  }
  cx /= vc;
  cy /= vc;
  cz /= vc;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [ia, ib, ic] = [mesh.indices[t] * 3, mesh.indices[t + 1] * 3, mesh.indices[t + 2] * 3];
    const ux = p[ib] - p[ia];
    const uy = p[ib + 1] - p[ia + 1];
    const uz = p[ib + 2] - p[ia + 2];
    const vx = p[ic] - p[ia];
    const vy = p[ic + 1] - p[ia + 1];
    const vz = p[ic + 2] - p[ia + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const tx = (p[ia] + p[ib] + p[ic]) / 3 - cx;
    const ty = (p[ia + 1] + p[ib + 1] + p[ic + 1]) / 3 - cy;
    const tz = (p[ia + 2] + p[ib + 2] + p[ic + 2]) / 3 - cz;
    if (nx * tx + ny * ty + nz * tz < 0) return false;
  }
  return true;
}

const DEFAULTS = { thicknessFt: DEFAULT_WALL_THICKNESS_FT, heightFt: 10 };

describe('wallsToMeshData', () => {
  it('one wall -> 12 flat triangles (36 dedicated vertices), sequential indices', () => {
    const m = wallsToMeshData(
      [{ start: { x: 0, y: 0 }, end: { x: 20, y: 0 } }],
      DEFAULTS,
    );
    expect(m.wallCount).toBe(1);
    expect(m.positions.length).toBe(36 * 3);
    expect(m.indices.length).toBe(36);
    expect(Array.from(m.indices)).toEqual([...Array(36).keys()]);
  });

  it('maps to scene space: y is UP (height), plan y -> z (thickness here)', () => {
    const m = wallsToMeshData(
      [{ start: { x: 0, y: 0 }, end: { x: 20, y: 0 } }, ],
      { thicknessFt: 0.5, heightFt: 9 },
    );
    const { min, max } = bbox(m);
    expect(max[0] - min[0]).toBeCloseTo(20, 6); // run length along x
    expect(max[1] - min[1]).toBeCloseTo(9, 6); // height up y
    expect(min[1]).toBeCloseTo(0, 6); // base at y == 0
    expect(max[2] - min[2]).toBeCloseTo(0.5, 6); // thickness across z
  });

  it('honors per-wall thicknessFt/heightFt and falls back to defaults', () => {
    const m = wallsToMeshData(
      [{ start: { x: 0, y: 0 }, end: { x: 0, y: 10 }, thicknessFt: 1.25, heightFt: 14 }],
      DEFAULTS,
    );
    const { min, max } = bbox(m);
    expect(max[0] - min[0]).toBeCloseTo(1.25, 6); // thickness across x (wall runs along z)
    expect(max[1] - min[1]).toBeCloseTo(14, 6);
    expect(max[2] - min[2]).toBeCloseTo(10, 6);
  });

  it('merges all walls into ONE buffer with correct index offsets', () => {
    const m = wallsToMeshData(
      [
        { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        { start: { x: 10, y: 0 }, end: { x: 10, y: 8 } },
      ],
      DEFAULTS,
    );
    expect(m.wallCount).toBe(2);
    expect(m.positions.length).toBe(2 * 36 * 3);
    expect(m.indices.length).toBe(72);
    expect(Math.max(...Array.from(m.indices))).toBe(71);
  });

  it('skips zero-length walls honestly (no throw, no fabricated box)', () => {
    const m = wallsToMeshData(
      [
        { start: { x: 5, y: 5 }, end: { x: 5, y: 5 } },
        { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      ],
      DEFAULTS,
    );
    expect(m.wallCount).toBe(1);
    expect(m.positions.length).toBe(36 * 3);
  });

  it('every wall triangle winds OUTWARD (flat-shading hygiene)', () => {
    const m = wallsToMeshData(
      [{ start: { x: 2, y: 3 }, end: { x: 17, y: 11 } }], // oblique run
      DEFAULTS,
    );
    expect(allTrianglesOutward(m)).toBe(true);
  });
});

const SQUARE = [
  { x: -5, y: -5 },
  { x: 5, y: -5 },
  { x: 5, y: 5 },
  { x: -5, y: 5 },
];

describe('roomSlabs', () => {
  it('floor top face at y == 0, extruded DOWN by the floor thickness', () => {
    const [slab] = roomSlabs([{ id: 'r1', polygon: SQUARE, ceilingHt: 10 }]);
    expect(slab.floor).not.toBeNull();
    const { min, max } = bbox(slab.floor!);
    expect(max[1]).toBeCloseTo(0, 6);
    expect(min[1]).toBeCloseTo(-FLOOR_SLAB_THICKNESS_FT, 6);
  });

  it('ceiling underside at the room ceilingHt, extruded UP by its thickness', () => {
    const [slab] = roomSlabs([{ id: 'r1', polygon: SQUARE, ceilingHt: 12 }]);
    expect(slab.ceilingHt).toBe(12);
    const { min, max } = bbox(slab.ceiling!);
    expect(min[1]).toBeCloseTo(12, 6);
    expect(max[1]).toBeCloseTo(12 + CEILING_SLAB_THICKNESS_FT, 6);
  });

  it('falls back to the default ceiling height when the room has none', () => {
    const [slab] = roomSlabs([{ id: 'r1', polygon: SQUARE }], { defaultCeilingHt: 9 });
    expect(slab.ceilingHt).toBe(9);
    const { min } = bbox(slab.ceiling!);
    expect(min[1]).toBeCloseTo(9, 6);
  });

  it('degenerate polygon -> null slabs (skipped honestly, no throw)', () => {
    const [slab] = roomSlabs([
      { id: 'bad', polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }], ceilingHt: 10 },
    ]);
    expect(slab.floor).toBeNull();
    expect(slab.ceiling).toBeNull();
  });

  it('slab triangles wind OUTWARD too', () => {
    const [slab] = roomSlabs([{ id: 'r1', polygon: SQUARE, ceilingHt: 10 }]);
    expect(allTrianglesOutward(slab.floor!)).toBe(true);
    expect(allTrianglesOutward(slab.ceiling!)).toBe(true);
  });
});

describe('resolveWallHeightFt', () => {
  const rooms = [
    { polygon: SQUARE, ceilingHt: 12 },
    {
      polygon: [
        { x: 5, y: -5 },
        { x: 15, y: -5 },
        { x: 15, y: 5 },
        { x: 5, y: 5 },
      ],
      ceilingHt: 16,
    },
  ];

  it('a wall fully inside a room takes that room ceilingHt', () => {
    expect(
      resolveWallHeightFt({ start: { x: -3, y: 0 }, end: { x: 3, y: 0 } }, rooms, 10),
    ).toBe(12);
  });

  it('a wall ON a room boundary resolves to that room', () => {
    // Perimeter wall of room 2 (its left edge is shared with room 1's right
    // edge — first match in model order wins, deterministically room 1).
    expect(
      resolveWallHeightFt({ start: { x: 5, y: -5 }, end: { x: 5, y: 5 } }, rooms, 10),
    ).toBe(12);
    // A wall on room 2's exclusive right edge resolves to room 2.
    expect(
      resolveWallHeightFt({ start: { x: 15, y: -5 }, end: { x: 15, y: 5 } }, rooms, 10),
    ).toBe(16);
  });

  it('a wall spanning rooms or outside all rooms uses the default', () => {
    expect(
      resolveWallHeightFt({ start: { x: -3, y: 0 }, end: { x: 12, y: 0 } }, rooms, 10),
    ).toBe(10);
    expect(
      resolveWallHeightFt({ start: { x: 40, y: 40 }, end: { x: 50, y: 40 } }, rooms, 10),
    ).toBe(10);
  });
});

describe('buildingToMeshData (full composition)', () => {
  function building(): Building {
    return {
      scaleFtPerUnit: 2, // plan units -> feet conversion must be applied
      source: 'manual',
      rooms: [
        {
          id: 'room-a',
          polygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 8 },
            { x: 0, y: 8 },
          ],
          hazard: 'LIGHT',
          ceilingHt: 11,
        },
      ],
      walls: [
        { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        { id: 'w2', start: { x: 10, y: 0 }, end: { x: 10, y: 8 }, thicknessFt: 1 },
      ],
    };
  }

  it('reports the truthful backend name and converts plan units to feet', () => {
    const data = buildingToMeshData(building(), { defaultCeilingHt: 10 });
    expect(data.backend).toBe(BUILDING_MESH_BACKEND);
    expect(data.bounds.widthFt).toBeCloseTo(20, 6); // 10 units * 2 ft/unit
    expect(data.walls.wallCount).toBe(2);
    expect(data.slabs).toHaveLength(1);
    // Recentered: merged wall bbox straddles the origin.
    const { min, max } = bbox(data.walls);
    expect(min[0]).toBeLessThan(0);
    expect(max[0]).toBeGreaterThan(0);
  });

  it('wall height comes from the enclosing room ceiling (both endpoints on it)', () => {
    const data = buildingToMeshData(building(), { defaultCeilingHt: 10 });
    // Both walls lie on room-a's boundary -> extruded to its 11 ft ceiling.
    const { max } = bbox(data.walls);
    expect(max[1]).toBeCloseTo(11, 6);
  });

  it('no rooms -> zero slabs (no fabricated floor plate), walls still build', () => {
    const b = building();
    b.rooms = [];
    const data = buildingToMeshData(b, { defaultCeilingHt: 10 });
    expect(data.slabs).toHaveLength(0);
    expect(data.walls.wallCount).toBe(2);
    // Without a room, walls extrude to the project default ceiling height.
    const { max } = bbox(data.walls);
    expect(max[1]).toBeCloseTo(10, 6);
  });

  it('is deterministic: same building -> byte-identical buffers', () => {
    const a = buildingToMeshData(building(), { defaultCeilingHt: 10 });
    const b = buildingToMeshData(building(), { defaultCeilingHt: 10 });
    expect(Array.from(a.walls.positions)).toEqual(Array.from(b.walls.positions));
    expect(Array.from(a.slabs[0].floor!.positions)).toEqual(
      Array.from(b.slabs[0].floor!.positions),
    );
  });
});
