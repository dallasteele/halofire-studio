// HaloFire CAD — preview verification handle. Publishes a small, honest snapshot
// of workspace state onto `window.__cad` so an external preview harness can
// assert the shell mounted and report what is (and isn't) loaded.
//
// HONESTY: `projectLoaded` reflects whether ANY building/network geometry is
// present, NOT merely that a Project object exists (a fresh project is empty).
// The shell publishes `projectLoaded:false` until a real W-slice loads geometry.

import { hasNetwork, type Project } from './model';
import { polygonAreaSqFt } from './scale';
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

/** Compute the published snapshot from live state. */
export function cadWindowSnapshot(
  project: Project,
  viewMode: ViewMode,
  toolCount: number,
): CadWindowState {
  const roomCount = project.building.rooms.length;
  return {
    ready: true,
    viewMode,
    projectLoaded: roomCount > 0 || hasNetwork(project),
    toolCount,
    scaleFtPerUnit: project.building.scaleFtPerUnit,
    roomCount,
    buildingAreaSqFt: Math.round(sumRoomAreaSqFt(project) * 100) / 100,
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
  };
}
