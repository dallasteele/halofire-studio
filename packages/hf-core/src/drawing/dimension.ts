/**
 * Dimension primitives — pure helpers for rendering paper-space
 * Dimension nodes to SVG and for formatting dimension text in the
 * four unit modes Pascal's sheet renderer understands.
 *
 * Blueprint 07 §5. Dimension + DimStyle landed as zod schemas in
 * `@pascal-app/core/schema/nodes/sheet` (R6.1) and
 * `@pascal-app/core/schema/nodes/dim-style` (R8.1). This module is
 * the stateless rendering + formatting companion — no React, no
 * Three.js, no DOM; just math.
 *
 * Output from `dimensionToSvgPrimitives` is an array of `DimPrimitive`
 * records, each representing one SVG element. Callers (hf-sheet-render)
 * map these into JSX / Paper.js / PDF primitives.
 */
// biome-ignore lint/style/noRelativeImport: schema subpath import
import type { Dimension } from '@pascal-app/core/schema/nodes/sheet'
// biome-ignore lint/style/noRelativeImport: schema subpath import
import type { DimStyle } from '@pascal-app/core/schema/nodes/dim-style'

export type { Dimension, DimStyle }

/** One SVG-ish primitive in paper-space mm. `attrs` is a flat bag of
 *  SVG attributes (stroke, stroke-width, x1, etc.) — the caller chooses
 *  whether to render it as JSX, a DOM node, or a PDF path. */
export interface DimPrimitive {
  type: 'line' | 'text' | 'path'
  attrs: Record<string, string | number>
}

/** Convert a length in metres into its display string under the given
 *  unit mode and precision.
 *
 *  - 'ft_in'      → feet-and-inches with a fractional denominator:
 *                   precision 0 → nearest inch, 1 → 1/2", 2 → 1/4",
 *                   3 → 1/8", 4 → 1/16". Output format: `12'-6"` or
 *                   `12'-6 1/4"`.
 *  - 'decimal_ft' → `12.50 ft` to `precision` decimals.
 *  - 'm'          → `3.81 m` to `precision` decimals.
 *  - 'mm'         → `3810 mm`, rounded to integer mm regardless of
 *                   precision (mm precision is already ≤1mm; sub-mm
 *                   decimals on a sheet are noise). */
export function formatDimensionText(
  length_m: number,
  unit_display: 'ft_in' | 'decimal_ft' | 'm' | 'mm',
  precision: number,
): string {
  if (unit_display === 'm') {
    return `${length_m.toFixed(precision)} m`
  }
  if (unit_display === 'mm') {
    return `${Math.round(length_m * 1000)} mm`
  }
  if (unit_display === 'decimal_ft') {
    const ft = length_m / 0.3048
    return `${ft.toFixed(precision)} ft`
  }
  // ft_in
  return formatFeetInches(length_m, precision)
}

function formatFeetInches(length_m: number, precision: number): string {
  const totalInches = length_m / 0.0254
  // Fractional denominator: clamp precision 0..4 to {1, 2, 4, 8, 16}.
  const p = Math.max(0, Math.min(4, Math.floor(precision)))
  const denom = 1 << p // 0→1, 1→2, 2→4, 3→8, 4→16
  const snapped = Math.round(totalInches * denom) / denom
  let feet = Math.trunc(snapped / 12)
  let inches = snapped - feet * 12
  // Handle negative cleanly (rare, but defensive).
  if (snapped < 0 && inches !== 0) {
    inches = 12 + inches
    feet -= 1
  }
  const whole = Math.trunc(inches + 1e-9)
  const frac = inches - whole
  const fracNumer = Math.round(frac * denom)
  if (fracNumer === 0) {
    return `${feet}'-${whole}"`
  }
  // Reduce the fraction (e.g. 2/8 → 1/4).
  const g = gcd(fracNumer, denom)
  const n = fracNumer / g
  const d = denom / g
  if (whole === 0) {
    return `${feet}'-${n}/${d}"`
  }
  return `${feet}'-${whole} ${n}/${d}"`
}

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b !== 0) {
    const t = b
    b = a % b
    a = t
  }
  return a || 1
}

/** Render a Dimension to paper-space SVG primitives (mm units).
 *
 *  Emits, per span between consecutive points:
 *    - 2 extension lines (one at each end)
 *    - 1 dimension line between the two extension tips
 *    - 1 text label centred above the dimension line
 *    - 2 tick/arrow markers (emitted as 'path' primitives)
 *
 *  The geometry assumes `dim.points` are already in paper-space
 *  millimetres (the sheet renderer projects model-space points
 *  through the viewport transform before calling this helper). */
export function dimensionToSvgPrimitives(
  dim: Dimension,
  style: DimStyle,
): DimPrimitive[] {
  if (dim.points.length < 2) return []

  const offset = dim.dim_line_offset_m * 1000 // m → mm
  const extOffset = style.extension_line_offset_mm
  const extExtend = style.extension_line_extend_mm
  const stroke = style.color

  // Compute a common perpendicular for 'linear' / 'aligned' / 'continuous'.
  // For 'linear' we project the polyline onto the line through the
  // first and last point and place the dim line parallel to it.
  const p0 = dim.points[0]!
  const pN = dim.points[dim.points.length - 1]!
  const dx = pN[0] - p0[0]
  const dy = pN[1] - p0[1]
  const len = Math.hypot(dx, dy)
  if (len === 0) return []
  const ux = dx / len
  const uy = dy / len
  // Perpendicular (rotate +90°): (-uy, ux). Sign of offset chooses side.
  const nx = -uy
  const ny = ux

  const prims: DimPrimitive[] = []

  // Dim-line endpoints (projected + offset perpendicular).
  const projected: [number, number][] = dim.points.map((pt) => {
    const t = (pt[0] - p0[0]) * ux + (pt[1] - p0[1]) * uy
    return [p0[0] + ux * t + nx * offset, p0[1] + uy * t + ny * offset]
  })

  // Extension lines — one per point.
  for (let i = 0; i < dim.points.length; i++) {
    const src = dim.points[i]!
    const dst = projected[i]!
    // Start slightly away from the measured point (extension_line_offset).
    const sx = src[0] + nx * extOffset
    const sy = src[1] + ny * extOffset
    // End slightly past the dim line (extension_line_extend).
    const ex = dst[0] + nx * extExtend
    const ey = dst[1] + ny * extExtend
    prims.push({
      type: 'line',
      attrs: {
        x1: sx, y1: sy, x2: ex, y2: ey,
        stroke, 'stroke-width': 0.18,
      },
    })
  }

  // Dim line — one span per consecutive pair.
  for (let i = 0; i < projected.length - 1; i++) {
    const a = projected[i]!
    const b = projected[i + 1]!
    prims.push({
      type: 'line',
      attrs: {
        x1: a[0], y1: a[1], x2: b[0], y2: b[1],
        stroke, 'stroke-width': 0.25,
      },
    })

    // Tick/arrow at each end of this span.
    prims.push(arrowPrimitive(a, -ux, -uy, nx, ny, style))
    prims.push(arrowPrimitive(b, ux, uy, nx, ny, style))

    // Text label at the midpoint.
    const mx = (a[0] + b[0]) / 2
    const my = (a[1] + b[1]) / 2
    const span_m = segmentLengthM(dim.points[i]!, dim.points[i + 1]!)
    const label =
      dim.text_override ??
      formatDimensionText(span_m, dim.unit_display, dim.precision)
    prims.push({
      type: 'text',
      attrs: {
        x: mx + nx * (style.text_height_mm * 0.6),
        y: my + ny * (style.text_height_mm * 0.6),
        'font-size': style.text_height_mm,
        fill: stroke,
        'text-anchor': 'middle',
        transform: `rotate(${(Math.atan2(uy, ux) * 180) / Math.PI} ${mx} ${my})`,
        _text: label,
      },
    })
  }

  return prims
}

function segmentLengthM(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  // Paper-space input is mm; convert to metres. Points are assumed
  // to already be scaled to paper units by the caller, but the
  // dimension text reports model-space length, so we trust the
  // caller passed model-equivalent mm. Here we simply compute the
  // distance and reinterpret mm→m for the label.
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / 1000
}

function arrowPrimitive(
  p: [number, number],
  ux: number,
  uy: number,
  nx: number,
  ny: number,
  style: DimStyle,
): DimPrimitive {
  const s = style.arrow_size_mm
  // Tick: short 45° line across the dim line.
  if (style.arrow_kind === 'tick') {
    const kx = (ux + nx) / Math.SQRT2
    const ky = (uy + ny) / Math.SQRT2
    return {
      type: 'path',
      attrs: {
        d: `M ${p[0] - kx * s} ${p[1] - ky * s} L ${p[0] + kx * s} ${p[1] + ky * s}`,
        stroke: style.color,
        'stroke-width': 0.3,
        fill: 'none',
      },
    }
  }
  if (style.arrow_kind === 'dot') {
    return {
      type: 'path',
      attrs: {
        d: `M ${p[0] - s * 0.3} ${p[1]} a ${s * 0.3} ${s * 0.3} 0 1 0 ${s * 0.6} 0 a ${s * 0.3} ${s * 0.3} 0 1 0 ${-s * 0.6} 0`,
        fill: style.color,
        stroke: 'none',
      },
    }
  }
  // open_arrow / closed_arrow — chevron pointing inward.
  const bx1 = p[0] + ux * s + nx * s * 0.3
  const by1 = p[1] + uy * s + ny * s * 0.3
  const bx2 = p[0] + ux * s - nx * s * 0.3
  const by2 = p[1] + uy * s - ny * s * 0.3
  const closed = style.arrow_kind === 'closed_arrow'
  return {
    type: 'path',
    attrs: {
      d: `M ${p[0]} ${p[1]} L ${bx1} ${by1} L ${bx2} ${by2} ${closed ? 'Z' : ''}`,
      stroke: style.color,
      'stroke-width': 0.25,
      fill: closed ? style.color : 'none',
    },
  }
}
