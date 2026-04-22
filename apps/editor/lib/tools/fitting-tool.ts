/**
 * Fitting tool — click at a node to drop a fitting (default: elbow_90).
 * The ribbon/palette can later swap `currentKind` for tee/coupling.
 */

import { getHalofireSceneStore } from '../halofire/scene-store'
import type { Tool } from './Tool'
import { registerTool } from './ToolRegistry'

let currentKind = 'elbow_90'

if (typeof window !== 'undefined') {
  window.addEventListener('halofire:fitting-kind', (e: Event) => {
    const detail = (e as CustomEvent).detail as { kind?: string } | undefined
    if (detail?.kind) currentKind = detail.kind
  })
}

export const fittingTool: Tool = {
  id: 'fitting',
  label: 'Fitting',
  cursor: 'crosshair',
  onActivate(ctx) {
    ctx.status(`click to drop fitting (${currentKind})`)
  },
  async onPointerDown(e, ctx) {
    if (e.button !== 0) return
    const p = e.snapped ?? e.world
    if (!p) return
    const store = getHalofireSceneStore(ctx.projectId)
    try {
      await store.getState().insertFitting({
        kind: currentKind,
        position_m: p,
        size_in: 1.0,
      })
      ctx.status(`${currentKind} placed`)
      window.dispatchEvent(new CustomEvent('halofire:scene-changed', { detail: { origin: 'add-fitting' } }))
    } catch (err) {
      ctx.toast(`insert_fitting failed: ${String(err)}`, 'error')
    }
  },
}

registerTool(fittingTool)
