/**
 * Remote-area tool — polygon draw. Click adds vertex; double-click
 * closes + POSTs to the gateway. The existing `RemoteAreaDraw`
 * component still renders the rectangle overlay in the simpler
 * click-drag flow; this tool is the polygon variant invoked by the
 * ribbon's "Remote Area" button.
 */

import { getHalofireSceneStore } from '../halofire/scene-store'
import type { Tool } from './Tool'
import { registerTool } from './ToolRegistry'

let vertices: { x: number; y: number }[] = []
let lastClickTs = 0

function renderPolyOverlay() {
  if (typeof document === 'undefined') return
  const id = 'halofire-remote-area-poly'
  let svg = document.getElementById(id) as unknown as SVGSVGElement | null
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement
    svg.id = id
    svg.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:850'
    document.body.appendChild(svg)
  }
  while (svg.firstChild) svg.removeChild(svg.firstChild)
  if (vertices.length < 2) return
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  poly.setAttribute('points', vertices.map((v) => `${v.x},${v.y}`).join(' '))
  poly.setAttribute('fill', 'rgba(255, 214, 0, 0.10)')
  poly.setAttribute('stroke', '#ffd600')
  poly.setAttribute('stroke-width', '1.5')
  poly.setAttribute('stroke-dasharray', '4 4')
  svg.appendChild(poly)
}

function clearOverlay() {
  if (typeof document === 'undefined') return
  const el = document.getElementById('halofire-remote-area-poly')
  if (el?.parentNode) el.parentNode.removeChild(el)
}

export const remoteAreaTool: Tool = {
  id: 'remote_area',
  label: 'Remote area',
  cursor: 'crosshair',
  onActivate(ctx) {
    vertices = []
    lastClickTs = 0
    renderPolyOverlay()
    ctx.status('click to add vertex · double-click to close · Esc cancel')
  },
  onDeactivate() {
    vertices = []
    clearOverlay()
  },
  async onPointerDown(e, ctx) {
    if (e.button !== 0) return
    const p = e.snapped ?? e.world
    if (!p) return
    const now = performance.now()
    const isDouble = now - lastClickTs < 350
    lastClickTs = now
    if (isDouble && vertices.length >= 3) {
      const poly = vertices.map((v) => ({ x: v.x, y: v.y }))
      // Convert our on-canvas pixel vertices back to world via the
      // last pointer event's world coord. Simpler: keep world coords
      // as we accumulate. Re-do with world coords for the POST:
      const worldPoly = (remoteAreaTool as unknown as { _worldVerts?: { x: number; y: number }[] })._worldVerts ?? []
      try {
        await getHalofireSceneStore(ctx.projectId).getState().setRemoteArea({
          polygon_m: worldPoly.length >= 3 ? worldPoly : poly,
          name: 'remote_area',
        })
        ctx.status(`remote area set · ${worldPoly.length || poly.length} vertices`)
        window.dispatchEvent(new CustomEvent('halofire:scene-changed', { detail: { origin: 'remote-area' } }))
      } catch (err) {
        ctx.toast(`set_remote_area failed: ${String(err)}`, 'error')
      }
      clearOverlay()
      vertices = []
      ctx.deactivate()
      return
    }
    vertices.push({ x: e.x, y: e.y })
    const worldVerts = (remoteAreaTool as unknown as { _worldVerts?: { x: number; y: number }[] })._worldVerts ?? []
    worldVerts.push({ x: p.x, y: p.z })
    ;(remoteAreaTool as unknown as { _worldVerts?: { x: number; y: number }[] })._worldVerts = worldVerts
    renderPolyOverlay()
    ctx.status(`vertex ${vertices.length} added`)
  },
}

registerTool(remoteAreaTool)
