// HaloFire CAD — preview verification handle. Publishes a small, honest snapshot
// of workspace state onto `window.__cad` so an external preview harness can
// assert the shell mounted and report what is (and isn't) loaded.
//
// HONESTY: `projectLoaded` reflects whether ANY building/network geometry is
// present, NOT merely that a Project object exists (a fresh project is empty).
// The shell publishes `projectLoaded:false` until a real W-slice loads geometry.

import { hasNetwork, type Project } from './model';
import { polygonAreaSqFt } from './scale';
import { coverageReport } from './head-layout';
import { reachableFrom } from './pipe-routing';
import { booleanPointInPolygon, point as turfPoint, polygon as turfPolygon } from '@turf/turf';
import type { ViewMode } from '../store';

export interface CadWindowState {
  /** The shell has mounted and tokens/layout are live. */
  ready: boolean;
  /** Current split/plan/3d view mode. */
  viewMode: ViewMode;
  /**
   * True once REAL geometry is loaded — per W1, a building with rooms (or a network).
   * A fresh project is false; the shell publishes false until an import/trace lands.
   */
  projectLoaded: boolean;
  /** Number of tools exposed in the workspace (ribbon + left panel). */
  toolCount: number;
  /** Current plan-to-feet scale (feet per model unit); 1 until set. */
  scaleFtPerUnit: number;
  /** Number of room polygons loaded/traced. */
  roomCount: number;
  /** Sum of room areas in square feet (0 until rooms + a scale exist). */
  buildingAreaSqFt: number;

  /* --- W2 3D building handle (set by Viewer3D when it builds meshes) --- */
  /** True once the 3D viewer has actually built building meshes (not faked). */
  has3DBuilding?: boolean;
  /** The geometry backend that built the 3D meshes ("three-extrude" | "opengeometry"), or null. */
  buildingBackend?: string | null;
  /** Number of floor slabs built in 3D (1:1 with rooms that have a polygon). */
  floorCount?: number;
  /** Number of wall runs built in 3D (1:1 with walls). */
  wallCount?: number;

  /* --- W3 head-layout handle --- */
  /** Number of sprinkler-head nodes in the network (1:1 with the store). */
  headCount: number;
  /**
   * True iff EVERY room with at least one head inside it passes its cited coverage
   * report (area + spacing), AND at least one head is placed. False when no heads
   * exist or any covered room fails a cited check. Honest: rooms with no heads at
   * all are NOT silently treated as covered.
   */
  coverageOk: boolean;
  /** The active head SKU id selected for placement, or null. */
  activeHeadSku: string | null;
  /** 3D head marker count (set by Viewer3D; mirrors headCount when 3D is live). */
  headCount3d?: number;

  /* --- W4 pipe-routing handle --- */
  /** Number of pipe segments in the network (1:1 with the store). */
  segmentCount: number;
  /** Number of fitting nodes (TEE + ELBOW + REDUCER) in the network. */
  fittingCount: number;
  /** Number of riser/source nodes in the network. */
  riserCount: number;
  /**
   * True iff there is a routed system AND EVERY head is connected to a riser through
   * the pipe tree (real graph connectivity over the segments). False when there are
   * no heads, no riser, or any head is unreachable. Honest: this re-runs the BFS over
   * the PERSISTED segments — it is not a stored flag that can drift from the geometry.
   */
  routedOk: boolean;
}

/**
 * Real connectivity check over the PERSISTED network: every HEAD reachable from a
 * SOURCE (riser) node through the segments. Returns false with no heads or no riser.
 * Re-runs the BFS so the flag can never drift from the actual geometry.
 */
function computeRoutedOk(project: Project): boolean {
  const heads = project.network.nodes.filter((n) => n.type === 'HEAD');
  const risers = project.network.nodes.filter((n) => n.type === 'SOURCE');
  if (heads.length === 0 || risers.length === 0) return false;
  // Union of reachability from every riser (typically one).
  const reached = new Set<string>();
  for (const r of risers) {
    for (const id of reachableFrom(r.id, project.network.segments)) reached.add(id);
  }
  return heads.every((h) => reached.has(h.id));
}

/** Sum of every room polygon's area, in square feet, at the building scale. */
function sumRoomAreaSqFt(project: Project): number {
  const ft = project.building.scaleFtPerUnit;
  let total = 0;
  for (const room of project.building.rooms) {
    total += polygonAreaSqFt(room.polygon, ft);
  }
  return total;
}

/**
 * Aggregate cited coverage across all rooms. Returns true only when at least one
 * head is placed AND every room that has heads inside it passes its cited coverage
 * report. Numbers come ONLY from coverageReport (cited nfpa13-rules) — never forked.
 */
function aggregateCoverageOk(project: Project): boolean {
  const heads = project.network.nodes.filter((n) => n.type === 'HEAD');
  if (heads.length === 0) return false;
  const scale = project.building.scaleFtPerUnit > 0 ? project.building.scaleFtPerUnit : 1;
  const rooms = project.building.rooms;
  if (rooms.length === 0) return false;
  let anyRoomHasHeads = false;
  for (const room of rooms) {
    const polyFt = room.polygon.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    if (polyFt.length < 3) continue;
    const ring = polyFt.map((p) => [p.x, p.y]);
    ring.push([polyFt[0].x, polyFt[0].y]);
    let turfPoly: ReturnType<typeof turfPolygon>;
    try {
      turfPoly = turfPolygon([ring]);
    } catch {
      continue;
    }
    const inRoom = heads
      .map((h) => ({ x: h.pos.x, y: h.pos.z }))
      .filter((h) => {
        try {
          return booleanPointInPolygon(turfPoint([h.x, h.y]), turfPoly);
        } catch {
          return false;
        }
      });
    if (inRoom.length === 0) continue;
    anyRoomHasHeads = true;
    const rep = coverageReport(polyFt, inRoom, room.hazard);
    if (!rep.covered) return false;
  }
  return anyRoomHasHeads;
}

/** Compute the published snapshot from live state. */
export function cadWindowSnapshot(
  project: Project,
  viewMode: ViewMode,
  toolCount: number,
  activeHeadSku: string | null = null,
): CadWindowState {
  const roomCount = project.building.rooms.length;
  const nodes = project.network.nodes;
  const headCount = nodes.filter((n) => n.type === 'HEAD').length;
  const fittingCount = nodes.filter(
    (n) => n.type === 'TEE' || n.type === 'ELBOW' || n.type === 'REDUCER',
  ).length;
  const riserCount = nodes.filter((n) => n.type === 'SOURCE').length;
  return {
    ready: true,
    viewMode,
    projectLoaded: roomCount > 0 || hasNetwork(project),
    toolCount,
    scaleFtPerUnit: project.building.scaleFtPerUnit,
    roomCount,
    buildingAreaSqFt: Math.round(sumRoomAreaSqFt(project) * 100) / 100,
    headCount,
    coverageOk: aggregateCoverageOk(project),
    activeHeadSku,
    segmentCount: project.network.segments.length,
    fittingCount,
    riserCount,
    routedOk: computeRoutedOk(project),
  };
}

/**
 * Publish the snapshot to window.__cad (no-op when window is absent, e.g. SSR).
 * PRESERVES any W2 3D fields (has3DBuilding/buildingBackend/floor/wall counts)
 * that Viewer3D set, so the shell snapshot and the 3D snapshot coexist rather
 * than clobbering each other.
 */
export function publishCadWindow(state: CadWindowState): void {
  if (typeof window === 'undefined') return;
  const prev = window.__cad;
  window.__cad = {
    ...state,
    has3DBuilding: prev?.has3DBuilding ?? false,
    buildingBackend: prev?.buildingBackend ?? null,
    floorCount: prev?.floorCount ?? 0,
    wallCount: prev?.wallCount ?? 0,
    headCount3d: prev?.headCount3d ?? 0,
  };
}
