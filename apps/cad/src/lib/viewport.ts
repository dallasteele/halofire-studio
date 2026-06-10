// W2B — pan/zoom viewport math for the plan canvas (PURE).
//
// PlanCanvas maps plan -> screen through a ViewXform:
//   raster:  sx = px*scale + padX,            sy = py*scale + padY
//   vector:  sx = (px-originX)*scale + padX,  sy = (originY-py)*scale + padY
// Both are linear in (scale, padX, padY), so zoom-about-a-screen-point and pan
// can be expressed purely on the xform WITHOUT knowing which mapping is active:
// scaling about screen point (sx0, sy0) keeps that screen point's plan point
// fixed when pads transform as  pad' = s0 + (pad - s0) * factor.

export interface ViewXform {
  scale: number;
  originX: number;
  originY: number;
  padX: number;
  padY: number;
}

export const MIN_SCALE = 1e-6;
export const MAX_SCALE = 1e6;
/** Wheel-step zoom factor (one notch). */
export const ZOOM_STEP = 1.1;

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/**
 * Zoom about a screen point: the plan point under (sx, sy) stays under (sx, sy).
 * Pure; clamps to [MIN_SCALE, MAX_SCALE] (pads adjust by the EFFECTIVE factor
 * after clamping, so the invariant holds even at the limits).
 * Throws on a non-finite or non-positive factor.
 */
export function zoomXformAt(x: ViewXform, sx: number, sy: number, factor: number): ViewXform {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error(`zoomXformAt: factor must be finite > 0; got ${factor}`);
  }
  const newScale = clampScale(x.scale * factor);
  const f = newScale / x.scale; // effective factor after clamping
  return {
    ...x,
    scale: newScale,
    padX: sx + (x.padX - sx) * f,
    padY: sy + (x.padY - sy) * f,
  };
}

/** Pan by screen-pixel deltas. Pure. Throws on non-finite deltas. */
export function panXform(x: ViewXform, dxPx: number, dyPx: number): ViewXform {
  if (!Number.isFinite(dxPx) || !Number.isFinite(dyPx)) {
    throw new Error(`panXform: deltas must be finite; got ${dxPx}, ${dyPx}`);
  }
  return { ...x, padX: x.padX + dxPx, padY: x.padY + dyPx };
}

/** Zoom percentage relative to a fit scale (100 = fit). Throws on fitScale <= 0. */
export function zoomPercent(x: ViewXform, fitScale: number): number {
  if (!Number.isFinite(fitScale) || fitScale <= 0) {
    throw new Error(`zoomPercent: fitScale must be finite > 0; got ${fitScale}`);
  }
  return Math.round((x.scale / fitScale) * 100);
}
