/**
 * Sprinkler tool — click the viewport to place a head at the snapped
 * grid point using the active catalog SKU. One-shot: stays active
 * until Esc so the user can rapidly place multiple heads.
 */

import { getHalofireSceneStore } from '../halofire/scene-store'
import type { Tool } from './Tool'
import { registerTool } from './ToolRegistry'

let activeSku: string | undefined

if (typeof window !== 'undefined') {
  window.addEventListener('halofire:catalog-select', (e: Event) => {
    const detail = (e as CustomEvent).detail as { sku?: string } | undefined
    if (detail?.sku) activeSku = detail.sku
  })
}

export const sprinklerTool: Tool = {
  id: 'sprinkler',
  label: 'Sprinkler',
  cursor: 'crosshair',
  onActivate(ctx) {
    ctx.status(activeSku ? `Click to place head (${activeSku})` : 'Click to place head')
  },
  async onPointerDown(e, ctx) {
    if (e.button !== 0) return
    const p = e.snapped ?? e.world
    if (!p) return
    const store = getHalofireSceneStore(ctx.projectId)
    try {
      await store.getState().insertHead({ position_m: p, sku: activeSku })
      ctx.status(`head placed @ ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`)
      // Fire legacy scene-changed event so LiveCalc debounces a recalc
      window.dispatchEvent(
        new CustomEvent('halofire:scene-changed', { detail: { origin: 'add-head' } }),
      )
    } catch (err) {
      ctx.toast(`insert_head failed: ${String(err)}`, 'error')
    }
  },
}

registerTool(sprinklerTool)
