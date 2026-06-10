// HaloFire CAD — PURE typed project data model (no React / three / DOM imports).
//
// This is the single typed shape the 2D plan editor, the 3D building/network
// viewer, and the inspector all read from and write to. It is intentionally a
// SHELL model: `emptyProject()` returns a valid, empty project with NO walls,
// rooms, nodes, or segments. W1-W6 fill these arrays from real imports (DXF/PDF
// in W1, building reconstruction, head layout, pipe routing). Nothing here
// fabricates a plan, a building, or a head.
//
// HONESTY: every list starts empty and stays empty until a real W-slice writes
// to it. There is no seed geometry, no demo heads, no fake hazard areas.

import {
  type Method,
  type Port,
  type PortRole,
} from './connectivity';
import { type DrawingElement } from './drawing-elements';

// Re-export the connectivity Port shape so consumers get ONE Port type across
// the catalog/connectivity logic and the CAD network model — they never drift.
export { type Method, type Port, type PortRole, METHODS, PORT_ROLES } from './connectivity';

/* --------------------------------------------------------------- geometry */

/** A 2D point in plan-space, in model units (see `scaleFtPerUnit`). */
export interface Point2 {
  x: number;
  y: number;
}

/** A 3D point in building-space (feet). y is up. */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/* ----------------------------------------------------------------- hazard */

/**
 * NFPA-13 occupancy hazard classification. This is the design density driver
 * used downstream for head spacing/area. We model the canonical buckets only;
 * a real W-slice maps a room to one of these.
 */
export type HazardClass =
  | 'LIGHT'
  | 'ORDINARY_1'
  | 'ORDINARY_2'
  | 'EXTRA_1'
  | 'EXTRA_2';

export const HAZARD_CLASSES: readonly HazardClass[] = [
  'LIGHT',
  'ORDINARY_1',
  'ORDINARY_2',
  'EXTRA_1',
  'EXTRA_2',
] as const;

/** Project-wide hazard defaults applied to new rooms until overridden. */
export interface HazardDefaults {
  /** Default hazard class for newly-classified rooms. */
  defaultClass: HazardClass;
  /** Default finished ceiling height (ft) when a room has none yet. */
  defaultCeilingHt: number;
}

/* -------------------------------------------------------------- building */

/** A straight wall segment in plan-space (model units). */
export interface Wall {
  id: string;
  start: Point2;
  end: Point2;
  /**
   * Real wall thickness in FEET when the source data carries one (e.g. a
   * measured/import value). Absent on traced walls — the 3D viewer then uses
   * the documented 0.5 ft drawing default, never an invented dimension.
   */
  thicknessFt?: number;
}

/** A room/space: a closed polygon with a hazard class and ceiling height. */
export interface Room {
  id: string;
  /** Closed polygon (>=3 points) in plan-space. Empty model has no rooms. */
  polygon: Point2[];
  /** Occupancy hazard classification. */
  hazard: HazardClass;
  /** Finished ceiling height in feet. */
  ceilingHt: number;
  /** Optional human label (e.g. "Mech 101"). */
  name?: string;
}

/** Where the building geometry came from — provenance, never faked. */
export type BuildingSource = 'none' | 'dxf' | 'pdf' | 'manual';

/** The architectural shell: walls + rooms + the plan-to-feet scale. */
export interface Building {
  walls: Wall[];
  rooms: Room[];
  /** Feet represented by one plan-space unit. 1 = units already feet. */
  scaleFtPerUnit: number;
  /** Provenance of the geometry. 'none' for an empty/just-created project. */
  source: BuildingSource;
}

/* ----------------------------------------------------------- network */

/** A network node kind in the sprinkler hydraulic topology. */
export type NodeType =
  | 'SOURCE' // riser / supply entry
  | 'TEE'
  | 'ELBOW'
  | 'CROSS'
  | 'HEAD' // sprinkler head
  | 'REDUCER'
  | 'VALVE';

export const NODE_TYPES: readonly NodeType[] = [
  'SOURCE',
  'TEE',
  'ELBOW',
  'CROSS',
  'HEAD',
  'REDUCER',
  'VALVE',
] as const;

/** A node in the pipe network, positioned in building-space (ft). */
export interface Node {
  id: string;
  type: NodeType;
  pos: Point3;
  /** Resolved catalog SKU for this fitting/head, when one is chosen. */
  sku?: string;
}

/**
 * The hydraulic/plumbing role a pipe segment plays.
 *   MAIN       — feed main from the riser/supply to the cross-main.
 *   CROSS_MAIN — runs across the branch taps, feeding each branch line.
 *   BRANCH     — the branch line along a row of heads.
 *   ARM_OVER   — the short drop/arm-over from a branch line down to a head (W4).
 *   RISER      — the vertical system riser run.
 *   DROP       — a generic vertical drop (kept for back-compat / non-arm drops).
 */
export type SegmentRole =
  | 'MAIN'
  | 'CROSS_MAIN'
  | 'BRANCH'
  | 'ARM_OVER'
  | 'RISER'
  | 'DROP';

export const SEGMENT_ROLES: readonly SegmentRole[] = [
  'MAIN',
  'CROSS_MAIN',
  'BRANCH',
  'ARM_OVER',
  'RISER',
  'DROP',
] as const;

/** Pipe material — drives C-factor / weight downstream. */
export type PipeMaterial = 'STEEL_SCH40' | 'STEEL_SCH10' | 'CPVC' | 'COPPER';

export const PIPE_MATERIALS: readonly PipeMaterial[] = [
  'STEEL_SCH40',
  'STEEL_SCH10',
  'CPVC',
  'COPPER',
] as const;

/** A pipe segment connecting two nodes by id. */
export interface Segment {
  id: string;
  /** Node id of the upstream end. */
  from: string;
  /** Node id of the downstream end. */
  to: string;
  /** Nominal inside/diameter in inches. */
  diameterIn: number;
  /** Run length in feet. */
  lengthFt: number;
  role: SegmentRole;
  material: PipeMaterial;
}

/**
 * A remote design area — the most hydraulically-demanding region used for the
 * sizing calculation (NFPA-13 design area). Referenced by room ids; the empty
 * model has none.
 */
export interface RemoteArea {
  id: string;
  /** Room ids that make up this design area. */
  roomIds: string[];
  /** Optional human label. */
  name?: string;
}

/** The sprinkler hydraulic network. All lists empty in a fresh project. */
export interface SprinklerNetwork {
  nodes: Node[];
  segments: Segment[];
  remoteAreas: RemoteArea[];
}

/* ------------------------------------------------------------- levels */

/**
 * A building level/floor. The shell carries a single default level; multi-level
 * import lands in a later W-slice.
 */
export interface Level {
  id: string;
  name: string;
  /** Elevation of this level's finished floor, in feet. */
  elevationFt: number;
}

/* ------------------------------------------------------------- project */

/** The top-level CAD project — the single shared document. */
export interface Project {
  id: string;
  name: string;
  /** Building levels (at least one). */
  levels: Level[];
  /** The architectural shell. */
  building: Building;
  /** The sprinkler hydraulic network. */
  network: SprinklerNetwork;
  /** Project-wide hazard defaults. */
  hazardDefaults: HazardDefaults;
  /**
   * Annotation/drawing primitives (AutoSprink Tools > Line/Polyline/Arc/Circle/
   * Rectangle/Point) in PLAN UNITS — the same space as walls/rooms. Optional so
   * pre-annotation project literals (tests, samples) stay valid.
   */
  annotations?: DrawingElement[];
}

/* ----------------------------------------------------- constructors */

/** A stable id with a short prefix (deterministic-friendly; callers may pass a seed). */
export function makeId(prefix: string, seed?: number): string {
  const n = seed ?? Math.floor(Math.random() * 1e9);
  return `${prefix}_${n.toString(36)}`;
}

/**
 * A valid, fully-EMPTY project: one ground level, an empty building with no
 * geometry (source 'none'), an empty network, and light-hazard defaults. This
 * is the honest starting point — nothing is loaded.
 */
export function emptyProject(name = 'Untitled Project'): Project {
  return {
    id: makeId('proj'),
    name,
    levels: [{ id: makeId('lvl'), name: 'Level 1', elevationFt: 0 }],
    building: {
      walls: [],
      rooms: [],
      scaleFtPerUnit: 1,
      source: 'none',
    },
    network: {
      nodes: [],
      segments: [],
      remoteAreas: [],
    },
    hazardDefaults: {
      defaultClass: 'LIGHT',
      defaultCeilingHt: 10,
    },
    annotations: [],
  };
}

/** True when the project has any architectural geometry loaded. */
export function hasBuilding(project: Project): boolean {
  return (
    project.building.source !== 'none' &&
    (project.building.walls.length > 0 || project.building.rooms.length > 0)
  );
}

/** True when the project has any network topology. */
export function hasNetwork(project: Project): boolean {
  return project.network.nodes.length > 0;
}

/** A Port for a given node end — convenience that reuses the connectivity shape. */
export function portFor(
  method: Method,
  nominalSizeIn: number,
  role: PortRole,
): Port {
  return { method, nominalSizeIn, role };
}
