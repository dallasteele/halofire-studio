/**
 * Section tool — drag a cutting-plane line. Client-only. Emits
 * `halofire:section-plane` with the two world-space endpoints so the
 * Pascal viewer (when wired) can clip in front of the plane.
 */

import type { Tool } from './Tool'
import { registerTool } from './ToolRegistry'

type State =
  | { phase: 'a' }
  | { phase: 'b'; a: { x: number; y: number; z: number } }

let state: State = { phase: 'a' }

export const sectionTool: Tool = {
  id: 'section',
  label: 'Section',
  cursor: 'crosshair',
  onActivate(ctx) {
    state = { phase: 'a' }
    ctx.status('click plane start')
  },
  onPointerDown(e, ctx) {
    if (e.button !== 0) return
    const p = e.world
    if (!p) return
    if (state.phase === 'a') {
      state = { phase: 'b', a: p }
      ctx.status('click plane end')
      return
    }
    window.dispatchEvent(
      new CustomEvent('halofire:section-plane', {
        detail: { a: state.a, b: p },
      }),
    )
    ctx.status('section plane active')
    state = { phase: 'a' }
    ctx.deactivate()
  },
}

registerTool(sectionTool)
