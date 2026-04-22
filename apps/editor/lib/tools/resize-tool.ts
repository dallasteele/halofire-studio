/**
 * Resize tool — pipe diameter adjust. Keyboard-driven because we
 * don't yet have a drag-handle widget: `+` / `-` cycles through the
 * NFPA schedule sizes. PATCHes on every change.
 */

import { getHalofireSceneStore } from '../halofire/scene-store'
import type { Tool } from './Tool'
import { registerTool } from './ToolRegistry'

const SIZES = [0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 6.0, 8.0]

function firstSelectedPipe(projectId: string): string | null {
  const { selection, nodes } = getHalofireSceneStore(projectId).getState()
  for (const id of selection) {
    if (nodes[id]?.kind === 'pipe') return id
  }
  return null
}

export const resizeTool: Tool = {
  id: 'resize',
  label: 'Resize',
  cursor: 'ew-resize',
  onActivate(ctx) {
    ctx.status('select pipe · +/- to change diameter · Esc cancel')
  },
  async onKeyDown(e, ctx) {
    if (e.key !== '+' && e.key !== '=' && e.key !== '-') return
    const id = firstSelectedPipe(ctx.projectId)
    if (!id) {
      ctx.toast('select a pipe first', 'warn')
      return
    }
    const node = getHalofireSceneStore(ctx.projectId).getState().nodes[id]
    if (!node || node.kind !== 'pipe') return
    const cur = node.size_in ?? 1.0
    let idx = SIZES.findIndex((s) => Math.abs(s - cur) < 1e-3)
    if (idx < 0) idx = 0
    idx = e.key === '-' ? Math.max(0, idx - 1) : Math.min(SIZES.length - 1, idx + 1)
    const next = SIZES[idx]
    try {
      await getHalofireSceneStore(ctx.projectId).getState().modifyPipe(id, { size_in: next })
      ctx.status(`pipe ${id} → ${next}"`)
    } catch (err) {
      ctx.toast(`resize failed: ${String(err)}`, 'error')
    }
  },
}

registerTool(resizeTool)
