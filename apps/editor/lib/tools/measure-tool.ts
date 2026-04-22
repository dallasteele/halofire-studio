/**
 * Measure tool — two clicks, show distance in meters.
 *
 * Uses the ToolManager's world-space projection rather than the old
 * hardcoded 30m→pixel approximation in `ToolOverlay.tsx`. The
 * projection is still approximate (real r3f raycaster is Phase F)
 * but at least it's consistent with the other tools and uses the
 * real canvas dimensions rather than assuming a specific zoom.
 */

import type { Tool } from './Tool'
import { registerTool } from './ToolRegistry'

type State =
  | { phase: 'a' }
  | { phase: 'b'; a: { x: number; y: number; z: number } }

let state: State = { phase: 'a' }

export const measureTool: Tool = {
  id: 'measure',
  label: 'Measure',
  cursor: 'crosshair',
  onActivate(ctx) {
    state = { phase: 'a' }
    ctx.status('click first point')
  },
  onPointerDown(e, ctx) {
    if (e.button !== 0) return
    const p = e.world
    if (!p) return
    if (state.phase === 'a') {
      state = { phase: 'b', a: p }
      ctx.status('click second point')
      return
    }
    const dx = p.x - state.a.x, dz = p.z - state.a.z
    const dy = p.y - state.a.y
    const dist = Math.hypot(dx, dy, dz)
    ctx.status(`Δ = ${dist.toFixed(2)} m`)
    window.dispatchEvent(
      new CustomEvent('halofire:measurement', {
        detail: { a: state.a, b: p, distance_m: dist },
      }),
    )
    // One-shot; re-activate to measure again
    state = { phase: 'a' }
    ctx.deactivate()
  },
}

registerTool(measureTool)
