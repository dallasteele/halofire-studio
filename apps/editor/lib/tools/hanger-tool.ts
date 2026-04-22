/**
 * Hanger tool — click along a pipe to drop a hanger. We don't yet
 * resolve the nearest pipe id client-side (the picker is a Phase F
 * cleanup); we let the gateway's single-op wrapper pick the closest
 * pipe, falling back to a warning if no pipe is nearby.
 */

import { getHalofireSceneStore } from '../halofire/scene-store'
import type { Tool } from './Tool'
import { registerTool } from './ToolRegistry'

/** Best-effort nearest-pipe pick from the TS scene mirror. */
function pickNearestPipeId(
  projectId: string,
  p: { x: number; y: number; z: number },
): string | null {
  const store = getHalofireSceneStore(projectId)
  const nodes = store.getState().nodes
  let best: { id: string; d: number } | null = null
  for (const n of Object.values(nodes)) {
    if (n.kind !== 'pipe') continue
    // Distance from p (x,z) to pipe segment (start,end) in x,z plane.
    const ax = n.start_m.x, az = n.start_m.z
    const bx = n.end_m.x, bz = n.end_m.z
    const dx = bx - ax, dz = bz - az
    const len2 = dx * dx + dz * dz || 1
    let t = ((p.x - ax) * dx + (p.z - az) * dz) / len2
    t = Math.max(0, Math.min(1, t))
    const qx = ax + t * dx, qz = az + t * dz
    const d = Math.hypot(p.x - qx, p.z - qz)
    if (!best || d < best.d) best = { id: n.id, d }
  }
  return best && best.d < 2.0 ? best.id : null
}

export const hangerTool: Tool = {
  id: 'hanger',
  label: 'Hanger',
  cursor: 'crosshair',
  onActivate(ctx) {
    ctx.status('click along a pipe to drop a hanger')
  },
  async onPointerDown(e, ctx) {
    if (e.button !== 0) return
    const p = e.snapped ?? e.world
    if (!p) return
    const pipeId = pickNearestPipeId(ctx.projectId, p)
    if (!pipeId) {
      ctx.toast('no pipe within 2 m — move closer', 'warn')
      return
    }
    try {
      await getHalofireSceneStore(ctx.projectId).getState().insertHanger({
        pipe_id: pipeId,
        position_m: p,
      })
      ctx.status(`hanger placed on ${pipeId}`)
    } catch (err) {
      ctx.toast(`insert_hanger failed: ${String(err)}`, 'error')
    }
  },
}

registerTool(hangerTool)

export const _internals = { pickNearestPipeId }
