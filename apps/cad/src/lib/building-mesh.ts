// HaloFire CAD — M-3D.1 building mesh composition (PURE, no WebGL, no scene
// graph). Composes the landed pure mesh modules — wallSolid (wall-solid.ts) and
// slabSolid (slab-solid.ts) — into the combined position/index buffers the 3D
// viewer turns into THREE.BufferGeometry:
//
//   - wallsToMeshData(walls, defaults): ONE merged buffer for ALL walls (a
//     single draw call even for 1,000+ kernel walls).
//   - roomSlabs(rooms, opts): per room, a floor slab (top face at y == 0) and a
//     ceiling slab (underside at the room's ceiling height).
//
// UNITS: all inputs are FEET, already recentered on the building origin
// (buildingToMeshData below does the plan-units -> feet conversion + recenter
// via building3d.buildingBoundsFt). Plan (x, y) maps to scene (x, z); y is up.
//
// FLAT SHADING + WINDING HYGIENE: wallSolid's index winding is mixed (some
// faces wind inward), and indexed solids with shared corner vertices get
// averaged ("soft-beveled") normals from computeVertexNormals. So every solid
// is expanded to per-triangle vertices and each triangle is re-oriented to face
// OUTWARD from the solid's centroid (valid for these convex solids: wall boxes
// and convex room prisms — slabSolid's documented fan-triangulation limit).
// The result: crisp flat face normals and consistent front-face winding.
//
// HONESTY (design-aid, not as-built):
//   - Wall thickness uses wall.thicknessFt when the model carries one; else the
//     documented 0.5 ft default (DEFAULT_WALL_THICKNESS_FT) — a drawing
//     convention, NOT a measured assembly dimension.
//   - Wall height is the enclosing room's ceilingHt when both wall endpoints
//     resolve into one room; else the project default ceiling height. Never an
//     invented number.
//   - Slab thicknesses (floor 0.5 ft, ceiling 0.33 ft) are design-aid plate
//     conventions, NOT structural dimensions.
//   - No rooms -> no slabs (nothing is fabricated); degenerate inputs are
//     skipped, never faked.

import { wallSolid } from './wall-solid';
import { slabSolid } from './slab-solid';
import {
  DEFAULT_WALL_THICKNESS_FT,
  buildingBoundsFt,
  type BuildingBoundsFt,
} from './building3d';
import type { Building, Point2 } from './model';

/** The truthful name of this composition path (published to window.__cad). */
export const BUILDING_MESH_BACKEND = 'pure-mesh-solid';

/** Floor slab thickness (ft) — a design-aid plate, not a structural dim. */
export const FLOOR_SLAB_THICKNESS_FT = 0.5;
/** Ceiling slab thickness (ft) — a design-aid plate, not a structural dim. */
export const CEILING_SLAB_THICKNESS_FT = 0.33;

export { DEFAULT_WALL_THICKNESS_FT };

/** Combined triangle buffers ready for THREE.BufferGeometry (pure arrays). */
export interface CombinedMesh {
  /** xyz triples (scene space: y up, plan y -> z). */
  positions: Float32Array;
  /** Triangle indices into positions (per-triangle vertices, outward wound). */
  indices: Uint32Array;
}

/** One wall to mesh: feet, recentered. `y` here is PLAN y (scene z). */
export interface WallMeshSpec {
  start: Point2;
  end: Point2;
  /** Real wall thickness (ft) when the model carries one. */
  thicknessFt?: number;
  /** Resolved wall height (ft) when known (room ceiling). */
  heightFt?: number;
}

/** Defaults applied when a wall has no thickness/height of its own. */
export interface WallMeshDefaults {
  /** Default thickness (ft) — documented drawing convention, 0.5 ft. */
  thicknessFt: number;
  /** Default height (ft) — the project default ceiling height. */
  heightFt: number;
}

/** One room to slab: polygon in feet, recentered; plan y -> scene z. */
export interface RoomSlabSpec {
  id: string;
  polygon: readonly Point2[];
  /** Finished ceiling height (ft); falls back to opts.defaultCeilingHt. */
  ceilingHt?: number;
}

/** The built floor + ceiling slabs for one room (null = degenerate, skipped). */
export interface RoomSlabMesh {
  roomId: string;
  /** The ceiling height (ft) actually used — room's own or the default. */
  ceilingHt: number;
  /** Floor plate: top face at y == 0, extruded DOWN by floor thickness. */
  floor: CombinedMesh | null;
  /** Ceiling plate: underside at ceilingHt, extruded UP by its thickness. */
  ceiling: CombinedMesh | null;
}

/* ------------------------------------------------ flat-triangle expansion */

/** Mutable accumulator for merged triangle soup. */
interface MeshAccumulator {
  positions: number[];
  indices: number[];
}

/**
 * Expand indexed triangles into per-triangle vertices, re-orienting each
 * triangle to face OUTWARD from the solid's vertex centroid. Correct for the
 * convex solids composed here; gives flat face normals after
 * computeVertexNormals (no averaged corner smearing) and consistent winding.
 * `positions` must already be in scene space (y up).
 */
function pushFlatTriangles(
  acc: MeshAccumulator,
  positions: readonly number[],
  indices: readonly number[],
): void {
  const vertexCount = positions.length / 3;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < positions.length; i += 3) {
    cx += positions[i];
    cy += positions[i + 1];
    cz += positions[i + 2];
  }
  cx /= vertexCount;
  cy /= vertexCount;
  cz /= vertexCount;

  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t] * 3;
    const ib = indices[t + 1] * 3;
    const ic = indices[t + 2] * 3;
    const ax = positions[ia];
    const ay = positions[ia + 1];
    const az = positions[ia + 2];
    const bx = positions[ib];
    const by = positions[ib + 1];
    const bz = positions[ib + 2];
    const cx2 = positions[ic];
    const cy2 = positions[ic + 1];
    const cz2 = positions[ic + 2];
    // Face normal (b-a) x (c-a).
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx2 - ax;
    const vy = cy2 - ay;
    const vz = cz2 - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    // Outward test against the solid centroid (convex solids only).
    const tx = (ax + bx + cx2) / 3 - cx;
    const ty = (ay + by + cy2) / 3 - cy;
    const tz = (az + bz + cz2) / 3 - cz;
    const inward = nx * tx + ny * ty + nz * tz < 0;

    const base = acc.positions.length / 3;
    acc.positions.push(ax, ay, az);
    if (inward) {
      acc.positions.push(cx2, cy2, cz2, bx, by, bz);
    } else {
      acc.positions.push(bx, by, bz, cx2, cy2, cz2);
    }
    acc.indices.push(base, base + 1, base + 2);
  }
}

function toCombined(acc: MeshAccumulator): CombinedMesh {
  return {
    positions: new Float32Array(acc.positions),
    indices: new Uint32Array(acc.indices),
  };
}

/* ----------------------------------------------------------------- walls */

/**
 * PURE. Merge EVERY wall into ONE combined triangle buffer (one draw call).
 * Per wall: wallSolid builds the box (its output space is (planX, planY,
 * height); we remap to scene (planX, height, planZ=planY)), then the triangles
 * are expanded flat + wound outward. Zero-length walls are SKIPPED honestly
 * (never fabricated); `wallCount` reports how many walls contributed.
 */
export function wallsToMeshData(
  walls: readonly WallMeshSpec[],
  defaults: WallMeshDefaults,
): CombinedMesh & { wallCount: number } {
  const acc: MeshAccumulator = { positions: [], indices: [] };
  let wallCount = 0;
  for (const w of walls) {
    const length = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    if (length < 1e-9) continue; // degenerate — skip, never fake.
    const thickness =
      w.thicknessFt && w.thicknessFt > 0 ? w.thicknessFt : defaults.thicknessFt;
    const height = w.heightFt && w.heightFt > 0 ? w.heightFt : defaults.heightFt;
    const solid = wallSolid(w.start, w.end, thickness, height);
    // wallSolid space (planX, planY, height) -> scene space (planX, height, planY).
    const scene: number[] = [];
    for (let i = 0; i < solid.positions.length; i += 3) {
      scene.push(solid.positions[i], solid.positions[i + 2], solid.positions[i + 1]);
    }
    pushFlatTriangles(acc, scene, solid.indices);
    wallCount += 1;
  }
  return { ...toCombined(acc), wallCount };
}

/* ----------------------------------------------------------------- slabs */

/**
 * PURE. Per room: a floor slab whose TOP face is at y == 0 (slabSolid extrudes
 * down) and a ceiling slab whose UNDERSIDE is at the room's ceiling height
 * (top face at ceilingHt + thickness, extruded down to ceilingHt). A room with
 * a degenerate polygon yields null slabs — skipped honestly, never faked.
 */
export function roomSlabs(
  rooms: readonly RoomSlabSpec[],
  opts?: {
    defaultCeilingHt?: number;
    floorThicknessFt?: number;
    ceilingThicknessFt?: number;
  },
): RoomSlabMesh[] {
  const defaultCeilingHt =
    opts?.defaultCeilingHt && opts.defaultCeilingHt > 0 ? opts.defaultCeilingHt : 10;
  const floorThickness = opts?.floorThicknessFt ?? FLOOR_SLAB_THICKNESS_FT;
  const ceilingThickness = opts?.ceilingThicknessFt ?? CEILING_SLAB_THICKNESS_FT;

  const build = (polygon: readonly Point2[], elevationY: number, thickness: number): CombinedMesh | null => {
    try {
      const solid = slabSolid([...polygon], elevationY, thickness);
      const acc: MeshAccumulator = { positions: [], indices: [] };
      // slabSolid already emits scene space (x, y-up, z) — no remap needed.
      pushFlatTriangles(acc, solid.positions, solid.indices);
      return toCombined(acc);
    } catch {
      return null; // degenerate polygon — no slab, no fabrication.
    }
  };

  return rooms.map((room) => {
    const ceilingHt =
      room.ceilingHt && room.ceilingHt > 0 ? room.ceilingHt : defaultCeilingHt;
    return {
      roomId: room.id,
      ceilingHt,
      floor: build(room.polygon, 0, floorThickness),
      ceiling: build(room.polygon, ceilingHt + ceilingThickness, ceilingThickness),
    };
  });
}

/* ------------------------------------------------------ wall height resolve */

/** Boundary tolerance (ft) for "this wall endpoint belongs to this room". */
const ROOM_EDGE_EPS_FT = 0.01;

/** Squared distance from point p to segment ab. */
function distSqToSegment(p: Point2, a: Point2, b: Point2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  let t = 0;
  if (lenSq > 0) {
    t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const dx = p.x - (a.x + t * abx);
  const dy = p.y - (a.y + t * aby);
  return dx * dx + dy * dy;
}

/** Point inside polygon (ray cast) OR within ROOM_EDGE_EPS_FT of its boundary. */
function pointInOrOnPolygon(p: Point2, polygon: readonly Point2[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  const epsSq = ROOM_EDGE_EPS_FT * ROOM_EDGE_EPS_FT;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    if (distSqToSegment(p, a, b) <= epsSq) return true;
    if (b.y > p.y !== a.y > p.y) {
      const xCross = ((a.x - b.x) * (p.y - b.y)) / (a.y - b.y) + b.x;
      if (p.x < xCross) inside = !inside;
    }
  }
  return inside;
}

/**
 * PURE. Resolve a wall's extrusion height: the FIRST room (model order —
 * deterministic) whose polygon contains BOTH wall endpoints (inside or on the
 * boundary within 0.01 ft) supplies its ceilingHt; otherwise the project
 * default ceiling height. Never an invented number.
 */
export function resolveWallHeightFt(
  wall: { start: Point2; end: Point2 },
  rooms: ReadonlyArray<{ polygon: readonly Point2[]; ceilingHt: number }>,
  defaultHeightFt: number,
): number {
  for (const room of rooms) {
    if (
      room.ceilingHt > 0 &&
      pointInOrOnPolygon(wall.start, room.polygon) &&
      pointInOrOnPolygon(wall.end, room.polygon)
    ) {
      return room.ceilingHt;
    }
  }
  return defaultHeightFt;
}

/* -------------------------------------------------------- full composition */

/** Everything the 3D viewer needs, as pure buffers (no THREE objects). */
export interface BuildingMeshData {
  /** Which composition path built these — reported truthfully. */
  backend: string;
  bounds: BuildingBoundsFt;
  /** ONE merged buffer for all walls + how many walls contributed. */
  walls: CombinedMesh & { wallCount: number };
  /** Per-room floor + ceiling slabs (empty when the building has no rooms). */
  slabs: RoomSlabMesh[];
}

/**
 * PURE. Convert the shared Building (plan units) into combined mesh buffers in
 * FEET, recentered on the building origin: per-wall height resolved against
 * the rooms (room ceilingHt when both endpoints land in one room, else
 * `defaultCeilingHt`), per-wall thickness from wall.thicknessFt when present
 * (else the documented 0.5 ft drawing default), and floor + ceiling slabs per
 * room. No rooms -> `slabs` is empty (the viewer skips slabs honestly — no
 * fabricated floor plate).
 */
export function buildingToMeshData(
  building: Building,
  opts: { defaultCeilingHt: number; wallThicknessFt?: number },
): BuildingMeshData {
  const s = building.scaleFtPerUnit > 0 ? building.scaleFtPerUnit : 1;
  const bounds = buildingBoundsFt(building);
  const toFt = (p: Point2): Point2 => ({ x: p.x * s - bounds.cx, y: p.y * s - bounds.cy });
  const defaultCeilingHt = opts.defaultCeilingHt > 0 ? opts.defaultCeilingHt : 10;
  const defaultThickness =
    opts.wallThicknessFt && opts.wallThicknessFt > 0
      ? opts.wallThicknessFt
      : DEFAULT_WALL_THICKNESS_FT;

  const roomsFt = building.rooms.map((room) => ({
    id: room.id,
    polygon: room.polygon.map(toFt),
    ceilingHt: room.ceilingHt,
  }));

  const wallSpecs: WallMeshSpec[] = building.walls.map((wall) => {
    const start = toFt(wall.start);
    const end = toFt(wall.end);
    return {
      start,
      end,
      ...(wall.thicknessFt && wall.thicknessFt > 0
        ? { thicknessFt: wall.thicknessFt }
        : {}),
      heightFt: resolveWallHeightFt({ start, end }, roomsFt, defaultCeilingHt),
    };
  });

  return {
    backend: BUILDING_MESH_BACKEND,
    bounds,
    walls: wallsToMeshData(wallSpecs, {
      thicknessFt: defaultThickness,
      heightFt: defaultCeilingHt,
    }),
    slabs: roomSlabs(roomsFt, { defaultCeilingHt }),
  };
}
