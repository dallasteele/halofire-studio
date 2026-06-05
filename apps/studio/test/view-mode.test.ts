import { describe, expect, it } from 'vitest';
import {
  cameraConfigFor,
  toggleViewMode,
  VIEW_MODES,
  type ViewMode,
} from '../src/lib/view-mode';

describe('VIEW_MODES', () => {
  it('contains exactly perspective and plan', () => {
    expect(VIEW_MODES).toEqual(['perspective', 'plan']);
  });
});

describe('toggleViewMode', () => {
  it('flips perspective <-> plan', () => {
    expect(toggleViewMode('perspective')).toBe('plan');
    expect(toggleViewMode('plan')).toBe('perspective');
  });

  it('is involutive: toggle(toggle(m)) === m', () => {
    for (const m of VIEW_MODES) {
      expect(toggleViewMode(toggleViewMode(m))).toBe(m);
    }
  });
});

describe('cameraConfigFor', () => {
  it('plan is top-down: camera high on +Y, map controls', () => {
    const plan = cameraConfigFor('plan');
    expect(plan.controls).toBe('map');
    // Camera sits well above the origin on +Y.
    expect(plan.position[1]).toBeGreaterThan(0);
    // Top-down: Y dominates the camera position (looking straight down).
    expect(plan.position[1]).toBeGreaterThan(Math.abs(plan.position[0]));
    expect(plan.position[1]).toBeGreaterThan(Math.abs(plan.position[2]));
  });

  it('perspective is an angled orbit view', () => {
    const persp = cameraConfigFor('perspective');
    expect(persp.controls).toBe('orbit');
    // Angled: it has non-zero horizontal offset (not straight down).
    expect(Math.abs(persp.position[0]) + Math.abs(persp.position[2])).toBeGreaterThan(0);
    expect(persp.up).toEqual([0, 1, 0]);
  });

  it('plan and perspective differ in controls and camera', () => {
    const plan = cameraConfigFor('plan');
    const persp = cameraConfigFor('perspective');
    expect(plan.controls).not.toBe(persp.controls);
    expect(plan.position).not.toEqual(persp.position);
    expect(plan.up).not.toEqual(persp.up);
  });

  it('returns a fresh config object each call (no shared mutation)', () => {
    const a = cameraConfigFor('plan');
    const b = cameraConfigFor('plan');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('covers all VIEW_MODES with a valid control kind', () => {
    for (const m of VIEW_MODES as ViewMode[]) {
      const cfg = cameraConfigFor(m);
      expect(['orbit', 'map']).toContain(cfg.controls);
      expect(cfg.position).toHaveLength(3);
      expect(cfg.up).toHaveLength(3);
    }
  });
});
