/**
 * Sway-brace tool — click along a pipe run. Default: lateral; Tab
 * cycles direction. Pipe picker reuses the hanger-tool heuristic.
 */

import { getHalofireSceneStore } from '../halofire/scene-store'
import type { Tool } from './Tool'
import { registerTool } from './ToolRegistry'
import { _internals as hangerInternals } from './hanger-tool'

type BraceKind = 'lateral' | 'longitudinal' | 'four_way'
let currentKind: BraceKind = 'lateral'

export const swayBraceTool: Tool = {
  id: 'sway_brace',
  label: 'Sway brace',
  cursor: 'crosshair',
  onActivate(ctx) {
    ctx.status(`click along a pipe · brace=${currentKind} (Tab cycles)`)
  },
  onKeyDown(e, ctx) {
    if (e.key === 'Tab') {
      e.raw.preventDefault()
      currentKind =
        currentKind === 'lateral' ? 'longitudinal' :
        currentKind === 'longitudinal' ? 'four_way' : 'lateral'
      ctx.status(`brace=${currentKind}`)
    }
  },
  async onPointerDown(e, ctx) {
    if (e.button !== 0) return
    const p = e.snapped ?? e.world
    if (!p) return
    const pipeId = hangerInternals.pickNearestPipeId(ctx.projectId, p)
    if (!pipeId) {
      ctx.toast('no pipe within 2 m', 'warn')
      return
    }
    try {
      await getHalofireSceneStore(ctx.projectId).getState().insertBrace({
        pipe_id: pipeId,
        position_m: p,
        kind: currentKind,
      })
      ctx.status(`${currentKind} brace placed`)
    } catch (err) {
      ctx.toast(`insert_brace failed: ${String(err)}`, 'error')
    }
  },
}

registerTool(swayBraceTool)
