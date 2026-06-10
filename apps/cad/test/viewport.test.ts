// W2B viewport math — zoom-about-cursor invariant + pan over the ViewXform.

import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE,
  MIN_SCALE,
  panXform,
  zoomPercent,
  zoomXformAt,
  ZOOM_STEP,
  type ViewXform,
} from '../src/lib/viewport';

const base: ViewXform = { scale: 2, originX: 5, originY: 105, padX: 10, padY: -5 };

/** The vector (DXF) plan->screen mapping PlanCanvas uses. */
function vectorToScreen(x: ViewXform, px: number, py: number): { sx: number; sy: number } {
  return { sx: (px - x.originX) * x.scale + x.padX, sy: (x.originY - py) * x.scale + x.padY };
}
/** The raster (PDF) mapping. */
function rasterToScreen(x: ViewXform, px: number, py: number): { sx: number; sy: number } {
  return { sx: px * x.scale + x.padX, sy: py * x.scale + x.padY };
}

describe('zoomXformAt — the point under the cursor stays put', () => {
  it('holds for the vector mapping', () => {
    const plan = { px: 42, py: 77 };
    const before = vectorToScreen(base, plan.px, plan.py);
    const zoomed = zoomXformAt(base, before.sx, before.sy, 1.5);
    const after = vectorToScreen(zoomed, plan.px, plan.py);
    expect(after.sx).toBeCloseTo(before.sx, 9);
    expect(after.sy).toBeCloseTo(before.sy, 9);
    expect(zoomed.scale).toBeCloseTo(3, 12);
  });

  it('holds for the raster mapping', () => {
    const plan = { px: 300, py: 220 };
    const before = rasterToScreen(base, plan.px, plan.py);
    const zoomed = zoomXformAt(base, before.sx, before.sy, 1 / ZOOM_STEP);
    const after = rasterToScreen(zoomed, plan.px, plan.py);
    expect(after.sx).toBeCloseTo(before.sx, 9);
    expect(after.sy).toBeCloseTo(before.sy, 9);
  });

  it('clamps at MAX_SCALE / MIN_SCALE and keeps the invariant at the limit', () => {
    let x = base;
    for (let i = 0; i < 200; i++) x = zoomXformAt(x, 100, 100, 10);
    expect(x.scale).toBe(MAX_SCALE);
    let y = base;
    for (let i = 0; i < 200; i++) y = zoomXformAt(y, 100, 100, 0.1);
    expect(y.scale).toBe(MIN_SCALE);
  });

  it('throws on non-positive or non-finite factors', () => {
    expect(() => zoomXformAt(base, 0, 0, 0)).toThrow();
    expect(() => zoomXformAt(base, 0, 0, -2)).toThrow();
    expect(() => zoomXformAt(base, 0, 0, Number.NaN)).toThrow();
  });
});

describe('panXform', () => {
  it('shifts every mapped point by exactly the pixel deltas', () => {
    const before = vectorToScreen(base, 42, 77);
    const panned = panXform(base, 3, -4);
    const after = vectorToScreen(panned, 42, 77);
    expect(after.sx - before.sx).toBeCloseTo(3, 12);
    expect(after.sy - before.sy).toBeCloseTo(-4, 12);
  });

  it('is pure and throws on non-finite deltas', () => {
    const snapshot = { ...base };
    panXform(base, 1, 1);
    expect(base).toEqual(snapshot);
    expect(() => panXform(base, Number.NaN, 0)).toThrow();
  });
});

describe('zoomPercent', () => {
  it('reports 100 at fit scale, 200 at double', () => {
    expect(zoomPercent(base, 2)).toBe(100);
    expect(zoomPercent({ ...base, scale: 4 }, 2)).toBe(200);
    expect(() => zoomPercent(base, 0)).toThrow();
  });
});
