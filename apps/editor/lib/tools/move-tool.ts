/**
 * Move tool — drag the current selection. On pointer-up we PATCH the
 * head (only heads supported for now; pipes require two-endpoint
 * recompute which is Phase F).
 *
 * Optimistic: we update the TS scene store immediately on pointer-
 * move so the dragged node "follows" the cursor; on release we PATCH
 * the gateway. If the PATCH fails the store rollback restores the
 * pre-drag position.
 */

import { getHalofireSceneStore } from '../halofire/scene-store'
import type { Tool } from './Tool'
import { registerTool } from './ToolRegistry'

type DragState = {
  targetId: string
  origin: { x: number; y: number; z: number }
  current: { x: number; y: number; z: number }
} | null

let drag: DragState = null

function firstSelectedHead(projectId: string): string | null {
  const store = getHalofireSceneStore(projectId)
  const { selection, nodes } = store.getState()
  for (const id of selection) {
    const n = nodes[id]
    if (n?.kind === 'head') return id
  }
  return null
}

export const moveTool: Tool = {
  id: 'move',
  label: 'Move',
  cursor: 'move',
  onActivate(ctx) {
    ctx.status('drag selected head to move (Esc cancel)')
    drag = null
  },
  onDeactivate() {
    drag = null
  },
  onPointerDown(e, ctx) {
    if (e.button !== 0) return
    const p = e.snapped ?? e.world
    if (!p) return
    const targetId = firstSelectedHead(ctx.projectId)
    if (!targetId) {
      ctx.toast('select a head before moving', 'warn')
      return
    }
    const head = getHalofireSceneStore(ctx.projectId).getState().nodes[targetId]
    if (!head || head.kind !== 'head') return
    drag = { targetId, origin: head.position_m, current: head.position_m }
  },
  onPointerMove(e, ctx) {
    if (!drag) return
    const p = e.snapped ?? e.world
    if (!p) return
    drag.current = p
    getHalofireSceneStore(ctx.projectId).getState().updateLocal(drag.targetId, {
      position_m: p,
    })
  },
  async onPointerUp(_e, ctx) {
    if (!drag) return
    const { targetId, origin, current } = drag
    drag = null
    if (origin.x === current.x && origin.y === current.y && origin.z === current.z) {
      return // no move
    }
    try {
      await getHalofireSceneStore(ctx.projectId).getState().modifyHead(targetId, {
        position_m: current,
      })
      ctx.status(`moved ${targetId}`)
      window.dispatchEvent(new CustomEvent('halofire:scene-changed', { detail: { origin: 'move' } }))
    } catch (err) {
      // Rollback optimistic local update
      getHalofireSceneStore(ctx.projectId).getState().updateLocal(targetId, { position_m: origin })
      ctx.toast(`move failed: ${String(err)}`, 'error')
    }
  },
}

registerTool(moveTool)
