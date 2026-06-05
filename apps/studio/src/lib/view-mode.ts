// PURE view-mode logic — no React / three imports.
// Two camera/control presets for the part viewer:
//   "perspective" — angled 3D orbit view
//   "plan"        — top-down map view (camera high on +Y looking down)

export type ViewMode = 'perspective' | 'plan';

export type ControlKind = 'orbit' | 'map';

export interface CameraConfig {
  position: [number, number, number];
  up: [number, number, number];
  controls: ControlKind;
}

export const VIEW_MODES: readonly ViewMode[] = ['perspective', 'plan'] as const;

/** Flip between the two modes. Involutive: toggle(toggle(m)) === m. */
export function toggleViewMode(mode: ViewMode): ViewMode {
  return mode === 'perspective' ? 'plan' : 'perspective';
}

/**
 * Camera + control preset for a mode.
 *  - perspective: angled vantage, +Y up, orbit controls
 *  - plan: top-down (high on +Y looking straight down), -Z screen-up, map controls
 */
export function cameraConfigFor(mode: ViewMode): CameraConfig {
  if (mode === 'plan') {
    return {
      position: [0, 60, 0],
      up: [0, 0, -1],
      controls: 'map',
    };
  }
  return {
    position: [18, 14, 24],
    up: [0, 1, 0],
    controls: 'orbit',
  };
}
