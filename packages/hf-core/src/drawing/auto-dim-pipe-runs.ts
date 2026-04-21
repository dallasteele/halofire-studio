/**
 * auto-dim-pipe-runs — emit continuous Dimension objects along every
 * branch / cross-main in a System, with a dimension tick at each
 * sprinkler head and at both pipe endpoints.
 *
 * Blueprint 07 §5 and implementation plan Phase R8.3. Pure function:
 * given the system, its pipes, and its heads, return the Dimension
 * objects that can be appended to a Sheet's `dimensions` array.
 *
 * Algorithm:
 *   1. For each pipe with role 'branch' or 'cross_main':
 *      - Collect attached heads: first by `head.branchId === pipe.id`,
 *        and if none match, by nearest-neighbour projection onto the
 *        pipe centreline within a 0.6m perpendicular tolerance.
 *   2. Project head positions onto the pipe centreline (parametric t).
 *   3. Sort by t, filter by 0 ≤ t ≤ 1, de-duplicate near-equal t.
 *   4. If there are < 2 heads on the branch, skip — a dimension with
 *      only the two endpoints is noise.
 *   5. Emit one 'continuous' Dimension with points:
 *      [branch_start, head_1_projected, …, head_N_projected, branch_end].
 */
// biome-ignore lint/style/noRelativeImport: schema subpath import
import type { Dimension } from '@pascal-app/core/schema/nodes/sheet'
// biome-ignore lint/style/noRelativeImport: schema subpath import
import type { PipeNode } from '@pascal-app/core/schema/nodes/pipe'
// biome-ignore lint/style/noRelativeImport: schema subpath import
import type { SprinklerHeadNode } from '@pascal-app/core/schema/nodes/sprinkler-head'

/** Minimal shape the auto-dim needs from a System — we only use the id. */
export interface SystemRef {
  id: string
}

export interface AutoDimOptions {
  style_id: string
  sheet_id: string
  unit_display: Dimension['unit_display']
  /** Offset (m) of the dim line from the branch centreline. Default 0.5. */
  dim_line_offset_m?: number
  /** Perpendicular distance tolerance (m) for nearest-neighbour attach.
   *  Default 0.6m — a typical branch-to-drop offset. */
  perp_tolerance_m?: number
  /** Minimum spacing (m) between two head ticks before we dedupe.
   *  Default 0.05m (50mm). */
  min_spacing_m?: number
}

export function autoDimensionPipeRun(
  system: SystemRef,
  pipes: PipeNode[],
  heads: SprinklerHeadNode[],
  opts: AutoDimOptions,
): Dimension[] {
  const offset = opts.dim_line_offset_m ?? 0.5
  const perpTol = opts.perp_tolerance_m ?? 0.6
  const minSpacing = opts.min_spacing_m ?? 0.05

  const out: Dimension[] = []

  for (const pipe of pipes) {
    if (pipe.role !== 'branch' && pipe.role !== 'cross_main') continue
    if (pipe.systemId !== undefined && pipe.systemId !== system.id) continue

    const a = pipe.start_m
    const b = pipe.end_m
    const ax = a[0]
    const ay = a[2]
    const bx = b[0]
    const by = b[2]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    if (len2 === 0) continue
    const len = Math.sqrt(len2)

    // Gather candidate heads. Prefer branchId match; otherwise use
    // nearest-neighbour projection.
    const branchMatched = heads.filter((h) => h.branchId === pipe.id)
    const candidates = branchMatched.length > 0 ? branchMatched : heads

    const projected: { t: number; x: number; y: number }[] = []
    for (const h of candidates) {
      const hx = h.position[0]
      const hy = h.position[2]
      const t = ((hx - ax) * dx + (hy - ay) * dy) / len2
      if (t < 0 || t > 1) continue
      // Perpendicular distance from the centreline.
      const px = ax + dx * t
      const py = ay + dy * t
      const perp = Math.hypot(hx - px, hy - py)
      if (branchMatched.length === 0 && perp > perpTol) continue
      projected.push({ t, x: px, y: py })
    }

    if (projected.length < 2) continue

    projected.sort((u, v) => u.t - v.t)

    // Dedupe near-equal t.
    const deduped: { t: number; x: number; y: number }[] = []
    for (const p of projected) {
      const prev = deduped[deduped.length - 1]
      if (!prev || Math.abs(p.t - prev.t) * len > minSpacing) {
        deduped.push(p)
      }
    }
    if (deduped.length < 2) continue

    const points: [number, number][] = [
      [ax, ay],
      ...deduped.map((p) => [p.x, p.y] as [number, number]),
      [bx, by],
    ]

    out.push({
      id: `dim_auto_${pipe.id}`,
      kind: 'continuous',
      points,
      dim_line_offset_m: offset,
      precision: 2,
      unit_display: opts.unit_display,
      style_id: opts.style_id,
      sheet_id: opts.sheet_id,
    })
  }

  return out
}
