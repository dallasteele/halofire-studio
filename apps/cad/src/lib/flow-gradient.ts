// HaloFire CAD — flow-gradient. PURE color math for the CONTINUOUS pressure
// gradient rendering of the W5 heatmap ("fluid dynamics" look): instead of one
// flat mean color per pipe, every pipe blends from its FROM-node pressure color
// to its TO-node pressure color along its axis (2D: konva linear-gradient
// stroke; 3D: per-vertex colors on the pipe cylinder).
//
// HONESTY: the colors derive ONLY from hydraulics.pressureColor, so the 2D plan,
// the 3D viewer, and both legends share ONE scale. The pressure interpolation
// along a pipe is a LINEAR psi lerp between the two computed endpoint pressures
// — a Hazen-Williams design-aid visualization, NOT a CFD solve and NOT an
// AHJ / PE / code-certified pressure profile. Nothing here invents pressures;
// endpoints come straight from the hydraulics result.

import { pressureColor } from './hydraulics';

/** One gradient color stop: t in [0,1] along the pipe (0 = from-node, 1 = to-node). */
export interface GradientStop {
  t: number;
  color: string;
}

/**
 * PURE. Parse a `rgb(r, g, b)` string (the exact format pressureColor emits)
 * into [r, g, b] floats in [0, 1]. An unparseable string returns a neutral
 * mid-gray — deterministic, never NaN (cannot happen for pressureColor output).
 */
export function parseRgb01(color: string): [number, number, number] {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  if (!m) return [0.5, 0.5, 0.5];
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
}

/**
 * PURE. The two color stops for one pipe segment: t=0 colored by the from-node
 * pressure, t=1 by the to-node pressure, both on the shared [min,max] psi scale.
 */
export function stopsForSegment(
  fromPsi: number,
  toPsi: number,
  min: number,
  max: number,
): GradientStop[] {
  return [
    { t: 0, color: pressureColor(fromPsi, min, max) },
    { t: 1, color: pressureColor(toPsi, min, max) },
  ];
}

/**
 * PURE. Flatten gradient stops into konva's strokeLinearGradientColorStops form:
 * [t0, color0, t1, color1, ...].
 */
export function konvaColorStops(stops: GradientStop[]): Array<number | string> {
  const flat: Array<number | string> = [];
  for (const s of stops) flat.push(s.t, s.color);
  return flat;
}

/**
 * PURE. Per-vertex RGB triplets for a pipe cylinder: for each vertex's axis
 * parameter t (0 = from end, 1 = to end), lerp the PRESSURE linearly between the
 * endpoints and map it through pressureColor — so the gradient travels THROUGH
 * the shared blue->cyan->green->yellow->red ramp, exactly matching what the 2D
 * linear-gradient stroke renders between the same two stops.
 *
 * Returns a Float32Array of length 3 * axisT.length, every component finite and
 * in [0, 1]. A non-finite t is clamped to 0.5 (mid-pipe) so a degenerate vertex
 * can never poison the buffer with NaN.
 */
export function segmentVertexColors(
  axisT: ArrayLike<number>,
  fromPsi: number,
  toPsi: number,
  min: number,
  max: number,
): Float32Array {
  const out = new Float32Array(axisT.length * 3);
  for (let i = 0; i < axisT.length; i++) {
    const raw = axisT[i];
    const t = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5;
    const psi = fromPsi + (toPsi - fromPsi) * t;
    const [r, g, b] = parseRgb01(pressureColor(psi, min, max));
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}
