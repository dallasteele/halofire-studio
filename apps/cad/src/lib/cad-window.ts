// HaloFire CAD — preview verification handle. Publishes a small, honest snapshot
// of workspace state onto `window.__cad` so an external preview harness can
// assert the shell mounted and report what is (and isn't) loaded.
//
// HONESTY: `projectLoaded` reflects whether ANY building/network geometry is
// present, NOT merely that a Project object exists (a fresh project is empty).
// The shell publishes `projectLoaded:false` until a real W-slice loads geometry.

import { hasBuilding, hasNetwork, type Project } from './model';
import type { ViewMode } from '../store';

export interface CadWindowState {
  /** The shell has mounted and tokens/layout are live. */
  ready: boolean;
  /** Current split/plan/3d view mode. */
  viewMode: ViewMode;
  /** True only when real building OR network geometry is loaded. */
  projectLoaded: boolean;
  /** Number of tools exposed in the workspace (ribbon + left panel). */
  toolCount: number;
}

/** Compute the published snapshot from live state. */
export function cadWindowSnapshot(
  project: Project,
  viewMode: ViewMode,
  toolCount: number,
): CadWindowState {
  return {
    ready: true,
    viewMode,
    projectLoaded: hasBuilding(project) || hasNetwork(project),
    toolCount,
  };
}

/** Publish the snapshot to window.__cad (no-op when window is absent, e.g. SSR). */
export function publishCadWindow(state: CadWindowState): void {
  if (typeof window === 'undefined') return;
  window.__cad = state;
}
