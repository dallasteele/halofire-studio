/**
 * Pipe tool — click start, preview a live segment on mouse-move,
 * click end to insert the pipe. Stays active after a successful
 * insert so the user can chain segments.
 */

import { getHalofireSceneStore } from '../halofire/scene-store'
import type { Tool, ToolPointerEvent } from './Tool'
import { registerTool } from './ToolRegistry'

type State =
  | { phase: 'idle' }
  | { phase: 'placing-end'; start: { x: number; y: number; z: number } }

let state: State = { phase: 'idle' }
let previewCleanup: (() => void) | null = null

function clearPreview() {
  previewCleanup?.()
  previewCleanup = null
}

function renderPreview(start: { x: number; y: number; z: number }, cur: { x: number; y: number; z: number }) {
  if (typeof document === 'undefined') return
  clearPreview()
  const id = 'halofire-pipe-preview'
  let el = document.getElementById(id) as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = id
    el.style.cssText = `
      position: fixed; top: 0; left: 0; pointer-events: none; z-index: 850;
      font: 11px/1 monospace; color: #ffd600;
      background: rgba(255, 214, 0, 0.10); border: 1px dashed #ffd600;
      padding: 2px 6px; border-radius: 0;
    `
    document.body.appendChild(el)
  }
  const dx = cur.x - start.x, dz = cur.z - start.z
  const len = Math.hypot(dx, dz)
  el.textContent = `pipe preview · ${len.toFixed(2)} m`
  // Position the chip near the live canvas click
  const canvas = document.querySelector('canvas')
  if (canvas) {
    const r = canvas.getBoundingClientRect()
    el.style.left = `${r.left + 8}px`
    el.style.top = `${r.top + 8}px`
  }
  previewCleanup = () => {
    if (el && el.parentNode) el.parentNode.removeChild(el)
  }
}

export const pipeTool: Tool = {
  id: 'pipe',
  label: 'Pipe',
  cursor: 'crosshair',
  onActivate(ctx) {
    state = { phase: 'idle' }
    ctx.status('click pipe start')
  },
  onDeactivate() {
    state = { phase: 'idle' }
    clearPreview()
  },
  onPointerMove(e: ToolPointerEvent) {
    if (state.phase !== 'placing-end') return
    const cur = e.snapped ?? e.world
    if (!cur) return
    renderPreview(state.start, cur)
  },
  async onPointerDown(e, ctx) {
    if (e.button !== 0) return
    const p = e.snapped ?? e.world
    if (!p) return
    if (state.phase === 'idle') {
      state = { phase: 'placing-end', start: p }
      ctx.status('click pipe end (Esc to cancel)')
      return
    }
    // placing-end
    const start = state.start
    state = { phase: 'idle' }
    clearPreview()
    const store = getHalofireSceneStore(ctx.projectId)
    try {
      await store.getState().insertPipe({
        from_point_m: start,
        to_point_m: p,
        size_in: 1.0,
        role: 'branch',
      })
      ctx.status(`pipe inserted · ${Math.hypot(p.x - start.x, p.z - start.z).toFixed(2)} m`)
      window.dispatchEvent(new CustomEvent('halofire:scene-changed', { detail: { origin: 'add-pipe' } }))
    } catch (err) {
      ctx.toast(`insert_pipe failed: ${String(err)}`, 'error')
    }
  },
}

registerTool(pipeTool)
