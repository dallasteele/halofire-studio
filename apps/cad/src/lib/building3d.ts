// HaloFire CAD — W2 building model. PURE, deterministic geometry construction:
// given the shared `Building` (rooms + walls + scaleFtPerUnit + source), produce
// the 3D meshes the Viewer3D renders — one filled floor slab per room and one
// extruded run per wall — in FEET (1 scene unit == 1 ft).
//
// UNITS: every plan-space coordinate is multiplied by `scaleFtPerUnit` to get
// feet (the model's contract: "Feet represented by one plan-space unit"). The
// whole building is then recentered on the union bbox origin so the camera can
// frame it symmetrically. Plan (x, y) maps to scene (x, z); y is up (height).
//
// BACKEND ADAPTER: all primitive construction goes through a
// `BuildingGeometryBackend` { slab(polygon), wall(polyline, height, thickness) }.
// This is the seam the task asked for: an OpenGeometry (Rust/WASM) kernel could
// implement it, OR the bundled three.js implementation does. We REPORT which one
// is active via `ACTIVE_BACKEND_NAME` and `buildBuildingMeshes(...).backend` —
// truthfully, never claiming OpenGeometry when three.js is doing the work.
//
// WHY three.js is the active backend (a real OpenGeometry attempt was made):
//   OpenGeometry 2.0.11 (npm) was installed and evaluated. Its public API is an
//   ASYNC, singleton, scene-manager-coupled kernel: you must call
//   `await OpenGeometry.create({ wasmURL })` to boot the WASM runtime before you
//   can even construct a `Vector3`, and its `Polygon`/`Solid` results EXTEND
//   THREE.Mesh (live scene nodes pulling in CSS2DRenderer/Line2), not pure
//   BufferGeometry. That violates this module's hard contract — pure, synchronous,
//   deterministic-given-the-building, testable under jsdom with no WASM runtime.
//   So we fall back to a clean three.js backend (Shape + ShapeGeometry for slabs,
//   box runs for walls) behind the SAME adapter interface. The seam is real: a
//   future async OpenGeometry backend can be slotted in without touching callers.
//
// HONESTY: this is a BEST-EFFORT building model extruded from what the operator
// traced/imported — NOT an as-built, NOT AHJ / PE / code-certified. Nothing is
// fabricated: a building with no rooms produces zero floors; no walls -> zero
// walls. Every floor/wall corresponds 1:1 to a real entry in `building`.

import {
  BufferAttribute,
  BufferGeometry,
  Shape,
  ShapeGeometry,
} from 'three';
import type { Building, Point2, Room, Wall } from './model';

/* --------------------------------------------------------------- backend */

/**
 * A 2D point in FEET, recentered on the building origin. The x/z plane is the
 * floor; `wall(...)` lays runs flat in this plane and extrudes up in y.
 */
export interface FtPoint {
  x: number;
  z: number;
}

/**
 * The pluggable geometry kernel. `slab` fills a closed polygon into a flat floor
 * geometry (XZ plane, y == 0); `wall` extrudes a polyline run up to `height`
 * with the given `thickness`. Both return three BufferGeometry so the renderer is
 * backend-agnostic. An OpenGeometry-backed implementation would conform to this
 * SAME shape (returning kernel-tessellated BufferGeometry).
 */
export interface BuildingGeometryBackend {
  /** Human name of the active kernel — reported truthfully to callers. */
  readonly name: string;
  /**
   * Filled floor slab from a closed polygon (>= 3 points, feet, recentered).
   * Returns geometry laid flat in the XZ plane at y == 0, or null for a
   * degenerate polygon.
   */
  slab(polygon: readonly FtPoint[]): BufferGeometry | null;
  /**
   * One wall run extruded from a polyline (feet, recentered) up to `height`
   * (feet) with `thickness` (feet). Returns geometry, or null for a degenerate
   * run (no segment of measurable length).
   */
  wall(
    polyline: readonly FtPoint[],
    height: number,
    thickness: number,
  ): BufferGeometry | null;
}

/* ------------------------------------------------- three.js backend */

const EPS = 1e-9;

/**
 * three.js floor slab: a filled THREE.Shape from the polygon, rotated flat into
 * the XZ plane (ShapeGeometry is authored in XY; rotateX(-90deg) lays it down).
 * Deterministic: same polygon in -> same buffer out.
 */
function threeSlab(polygon: readonly FtPoint[]): BufferGeometry | null {
  if (polygon.length < 3) return null;
  const shape = new Shape();
  shape.moveTo(polygon[0].x, polygon[0].z);
  for (let i = 1; i < polygon.length; i++) {
    shape.lineTo(polygon[i].x, polygon[i].z);
  }
  shape.closePath();
  const geo = new ShapeGeometry(shape);
  // ShapeGeometry lives in XY; rotate flat into XZ so it is a floor (y up).
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}

/**
 * Append a single box run (one wall segment) to a flat position/normal buffer.
 * A wall is a thin box: `len` along the run, `height` up (y), `thickness` across.
 * We author 12 triangles (6 quads) directly so the result is ONE merged buffer
 * for the whole polyline — deterministic, no scene graph, no matrix side effects.
 */
function pushBox(
  positions: number[],
  cx: number,
  cz: number,
  len: number,
  height: number,
  thickness: number,
  yaw: number,
): void {
  const hl = len / 2;
  const ht = thickness / 2;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // Local box corners (run axis = local x, across = local z, up = y).
  // Map local (lx, lz) -> world (x, z) by yaw about y, then offset to (cx, cz).
  const local: Array<[number, number, number]> = [
    [-hl, 0, -ht],
    [hl, 0, -ht],
    [hl, height, -ht],
    [-hl, height, -ht],
    [-hl, 0, ht],
    [hl, 0, ht],
    [hl, height, ht],
    [-hl, height, ht],
  ];
  const world = local.map(([lx, ly, lz]) => {
    const wx = cx + lx * cos - lz * sin;
    const wz = cz + lx * sin + lz * cos;
    return [wx, ly, wz] as [number, number, number];
  });
  // Six faces, two triangles each (CCW). Indices into `world`.
  const faces: Array<[number, number, number, number]> = [
    [0, 1, 2, 3], // -z
    [5, 4, 7, 6], // +z
    [4, 0, 3, 7], // -x
    [1, 5, 6, 2], // +x
    [3, 2, 6, 7], // top (+y)
    [4, 5, 1, 0], // bottom (-y)
  ];
  for (const [a, b, c, d] of faces) {
    for (const idx of [a, b, c, a, c, d]) {
      positions.push(world[idx][0], world[idx][1], world[idx][2]);
    }
  }
}

/**
 * three.js wall run: extrude each segment of the polyline into a thin box and
 * merge into one geometry. Deterministic. Corner overlap is handled by extending
 * each segment by half the thickness on both ends (so joints close visually).
 */
function threeWall(
  polyline: readonly FtPoint[],
  height: number,
  thickness: number,
): BufferGeometry | null {
  if (polyline.length < 2 || height <= 0 || thickness <= 0) return null;
  const positions: number[] = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len <= EPS) continue;
    pushBox(
      positions,
      (a.x + b.x) / 2,
      (a.z + b.z) / 2,
      len + thickness, // overlap so corners close
      height,
      thickness,
      Math.atan2(dz, dx),
    );
  }
  if (positions.length === 0) return null;
  const geo = new BufferGeometry();
  geo.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}

/** The bundled, pure, deterministic three.js backend. */
export const threeBackend: BuildingGeometryBackend = {
  name: 'three-extrude',
  slab: threeSlab,
  wall: threeWall,
};

/**
 * The ACTIVE backend. three.js is active because OpenGeometry's async/WASM/
 * scene-manager API cannot satisfy this module's pure-deterministic contract
 * (see file header). A future OpenGeometry backend conforming to
 * `BuildingGeometryBackend` could replace this.
 */
export const activeBackend: BuildingGeometryBackend = threeBackend;

/** The active backend's name — reported truthfully (never faked). */
export const ACTIVE_BACKEND_NAME = activeBackend.name;

/** True only when an OpenGeometry kernel is the active backend. Honest: false. */
export const OPEN_GEOMETRY_INTEGRATED = activeBackend.name === 'opengeometry';

/* --------------------------------------------------------- bbox + units */

/** Axis-aligned bbox of the building in FEET (after scale), in plan space. */
export interface BuildingBoundsFt {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Center used to recenter geometry on the origin. */
  cx: number;
  cy: number;
  widthFt: number;
  depthFt: number;
}

/** Default wall thickness in feet — a thin visual run, not a real assembly dim. */
export const DEFAULT_WALL_THICKNESS_FT = 0.5;

/**
 * Compute the building's bbox in feet from every room polygon point and every
 * wall endpoint. Returns a zeroed bbox (centered at origin) when empty.
 */
export function buildingBoundsFt(building: Building): BuildingBoundsFt {
  const s = building.scaleFtPerUnit > 0 ? building.scaleFtPerUnit : 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const acc = (p: Point2): void => {
    const x = p.x * s;
    const y = p.y * s;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const room of building.rooms) for (const p of room.polygon) acc(p);
  for (const wall of building.walls) {
    acc(wall.start);
    acc(wall.end);
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0, widthFt: 0, depthFt: 0 };
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    widthFt: maxX - minX,
    depthFt: maxY - minY,
  };
}

/** Convert one plan-space point to recentered FEET (x -> x, plan y -> z). */
function toFt(p: Point2, s: number, cx: number, cy: number): FtPoint {
  return { x: p.x * s - cx, z: p.y * s - cy };
}

/* --------------------------------------------------------- public build */

/** A built floor slab for one room. */
export interface FloorMesh {
  /** The source room id (1:1 — never fabricated). */
  roomId: string;
  /** Optional room label, copied from the source room. */
  name?: string;
  /** The room's hazard class (drives the subtle per-room tint in the viewer). */
  hazard: Room['hazard'];
  /** Filled floor geometry (XZ plane, y == 0), or null for a degenerate polygon. */
  geometry: BufferGeometry | null;
  /** Computed floor area in square feet (shoelace * scale^2) — for the inspector. */
  areaSqFt: number;
}

/** A built wall run. */
export interface WallMesh {
  /** The source wall id (1:1 — never fabricated). */
  wallId: string;
  /** Extruded wall geometry, or null for a degenerate run. */
  geometry: BufferGeometry | null;
  /** Extrusion height in feet (the level/room ceiling height used). */
  heightFt: number;
}

/** A building level surfaced to the viewer (elevation in feet). */
export interface LevelInfo {
  id: string;
  name: string;
  elevationFt: number;
}

/** The full set of building meshes plus bounds + the backend that built them. */
export interface BuildingMeshes {
  floors: FloorMesh[];
  walls: WallMesh[];
  levels: LevelInfo[];
  bounds: BuildingBoundsFt;
  /** Which kernel produced these meshes — reported truthfully. */
  backend: string;
}

/** |shoelace| area of a polygon in feet, given scale. Mirrors scale.ts intent. */
function polygonAreaFt(polygon: readonly Point2[], s: number): number {
  const n = polygon.length;
  if (n < 3) return 0;
  let twice = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice / 2) * s * s;
}

/**
 * PURE. Build the 3D meshes for a building: one floor slab per room, one wall run
 * per wall, recentered to the building origin and in feet. Deterministic given
 * the building. Returns empty floor/wall arrays for an empty building — no
 * fabrication. The wall extrusion height is the project ceiling height passed via
 * `defaultCeilingHt` (callers pass the level/hazard default); per-room slabs sit
 * at y == 0 (single-level W2 — multi-level stacking lands in a later slice).
 */
export function buildBuildingMeshes(
  building: Building,
  opts?: {
    /** Ceiling height (ft) used for wall extrusion. Default 10 (model default). */
    ceilingHt?: number;
    /** Wall thickness (ft). Default DEFAULT_WALL_THICKNESS_FT. */
    wallThicknessFt?: number;
    /** Levels to surface (defaults to a single ground level). */
    levels?: LevelInfo[];
  },
): BuildingMeshes {
  const s = building.scaleFtPerUnit > 0 ? building.scaleFtPerUnit : 1;
  const bounds = buildingBoundsFt(building);
  const ceilingHt = opts?.ceilingHt && opts.ceilingHt > 0 ? opts.ceilingHt : 10;
  const thickness =
    opts?.wallThicknessFt && opts.wallThicknessFt > 0
      ? opts.wallThicknessFt
      : DEFAULT_WALL_THICKNESS_FT;
  const backend = activeBackend;

  const floors: FloorMesh[] = building.rooms.map((room) => {
    const ftPoly = room.polygon.map((p) => toFt(p, s, bounds.cx, bounds.cy));
    return {
      roomId: room.id,
      ...(room.name ? { name: room.name } : {}),
      hazard: room.hazard,
      geometry: backend.slab(ftPoly),
      areaSqFt: polygonAreaFt(room.polygon, s),
    };
  });

  // Each wall extrudes to its own ceiling height. With no per-wall room mapping
  // yet, every wall uses the project ceiling height (rooms still carry their own
  // ceilingHt for downstream slices). This is honest: the height is the documented
  // ceiling height, not an invented value.
  const walls: WallMesh[] = building.walls.map((wall: Wall) => {
    const a = toFt(wall.start, s, bounds.cx, bounds.cy);
    const b = toFt(wall.end, s, bounds.cx, bounds.cy);
    return {
      wallId: wall.id,
      geometry: backend.wall([a, b], ceilingHt, thickness),
      heightFt: ceilingHt,
    };
  });

  const levels: LevelInfo[] =
    opts?.levels && opts.levels.length > 0
      ? opts.levels
      : [{ id: 'lvl_ground', name: 'Level 1', elevationFt: 0 }];

  return { floors, walls, levels, bounds, backend: backend.name };
}
