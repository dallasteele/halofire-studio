import { describe, expect, it } from 'vitest';
import { planOrthoFrustum, planCenter } from '../src/engine/plan-view.js';

// V1: the plan-mode orthographic frustum must fit the WHOLE floor-plan bbox to
// the viewport (so a readable top-down drawing always frames the plan), be
// aspect-correct, and stay centered.
describe('planOrthoFrustum', () => {
  const bbox = { minX: 0, maxX: 60, minY: 0, maxY: 40 }; // 60 x 40 plan

  it('is centered (left = -right, bottom = -top)', () => {
    const f = planOrthoFrustum(bbox, 1.5, 0);
    expect(f.left).toBeCloseTo(-f.right, 9);
    expect(f.bottom).toBeCloseTo(-f.top, 9);
  });

  it('matches the viewport aspect', () => {
    for (const a of [0.75, 1, 1.5, 2.4]) {
      const f = planOrthoFrustum(bbox, a, 0);
      expect((f.right - f.left) / (f.top - f.bottom)).toBeCloseTo(a, 6);
    }
  });

  it('fits the entire bbox with margin (frustum >= padded plan)', () => {
    const m = 0.08;
    const f = planOrthoFrustum(bbox, 1.5, m);
    expect(f.right - f.left).toBeGreaterThanOrEqual(60 * (1 + m) - 1e-6);
    expect(f.top - f.bottom).toBeGreaterThanOrEqual(40 * (1 + m) - 1e-6);
  });

  it('width-limited when the plan is wider than the viewport', () => {
    // square viewport (a=1), wide plan -> width fits exactly, height expands
    const f = planOrthoFrustum(bbox, 1, 0);
    expect(f.right - f.left).toBeCloseTo(60, 6);      // width fits exactly
    expect(f.top - f.bottom).toBeCloseTo(60, 6);      // expanded to square
  });

  it('height-limited when the viewport is wider than the plan', () => {
    const f = planOrthoFrustum(bbox, 2, 0); // aspect 2 > plan 1.5
    expect(f.top - f.bottom).toBeCloseTo(40, 6);      // height fits exactly
    expect(f.right - f.left).toBeCloseTo(80, 6);      // expanded to aspect 2
  });

  it('never collapses on a degenerate (zero-area) bbox', () => {
    const f = planOrthoFrustum({ minX: 5, maxX: 5, minY: 2, maxY: 2 }, 1.5, 0);
    expect(f.right).toBeGreaterThan(0);
    expect(f.top).toBeGreaterThan(0);
  });

  it('planCenter returns the bbox midpoint', () => {
    expect(planCenter(bbox)).toEqual({ x: 30, y: 20 });
  });
});
