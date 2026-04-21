/**
 * ViewportRenderer — Blueprint 07 §9 / R6.4.
 *
 * Renders one SheetNode Viewport (a three.js camera framing a level)
 * to an offscreen canvas and emits an SVG `<image>` tag positioned
 * in paper-space millimetres.
 *
 * Pipeline:
 *   1. Filter the scene snapshot to nodes relevant to the viewport
 *      (optionally to a level_id) and layer_visibility.
 *   2. Build a three.js Scene of schematic primitives (boxes for
 *      slabs/walls, spheres for heads, thin cylinders for pipes).
 *   3. Frame an orthographic camera on the filtered bbox, scaled to
 *      metres-per-paper-mm per viewport.scale.
 *   4. renderer.render → toDataURL('image/png').
 *   5. Emit an SVG <image href={dataUrl} x/y/w/h in mm>.
 *
 * Runs OFFSCREEN. The WebGL context is disposed on unmount and on
 * every re-render, so the component does not leak GL resources.
 *
 * Pure helpers (filterSceneForViewport, metresPerPaperMm,
 * computeBBox, NODE_CATEGORY) are exported for deterministic unit
 * tests that do not require a real WebGL context.
 */

import * as React from 'react'
import * as THREE from 'three'
import type { AnyNode, Viewport } from '@pascal-app/core'

export interface ViewportRendererProps {
  viewport: Viewport
  /** Current scene snapshot — passed via prop for deterministic
   *  rendering / testing. Keyed by node id. */
  sceneSnapshot: Record<string, AnyNode>
  /** Resolution multiplier for the offscreen raster. Default 2. */
  dpr?: number
  /** Test hook: called with the count of nodes that were rendered
   *  into the three.js scene, AFTER filtering. Useful for layer
   *  visibility checks without having to read pixels. */
  onDebug?: (info: ViewportDebugInfo) => void
}

export interface ViewportDebugInfo {
  nodeCountRendered: number
  nodeTypesRendered: string[]
  bboxMetres: [number, number, number, number] | null // [minX, minZ, maxX, maxZ]
  metresPerPaperMm: number
  disposed: boolean
}

// ---------------------------------------------------------------------------
// Pure helpers (exported — safe to import from a Node context).
// ---------------------------------------------------------------------------

/**
 * Map a node type to a layer_visibility category key.
 * layer_visibility is keyed by node type for v1 (schematic renderer).
 */
export function nodeLayerKey(node: AnyNode): string {
  return node.type
}

/**
 * Return true if this node type is something the schematic renderer
 * knows how to draw. Everything else (systems, zones, sheets, …) is
 * ignored for the raster pass.
 */
export function isRenderableType(type: string): boolean {
  return (
    type === 'slab' ||
    type === 'wall' ||
    type === 'sprinkler_head' ||
    type === 'pipe' ||
    type === 'valve' ||
    type === 'hanger' ||
    type === 'device' ||
    type === 'fdc' ||
    type === 'riser_assembly'
  )
}

/**
 * Filter the scene snapshot to nodes that should be rendered for a
 * given viewport. Applies:
 *   - renderability (only the primitive types we draw)
 *   - level scoping (viewport.camera.level_id → parentId must match
 *     or ancestor chain must contain it)
 *   - layer_visibility (undefined entry ⇒ visible by default)
 */
export function filterSceneForViewport(
  snapshot: Record<string, AnyNode>,
  viewport: Viewport,
): AnyNode[] {
  const levelId = viewport.camera.level_id
  const visibility = viewport.layer_visibility ?? {}

  const ancestors = (node: AnyNode): string[] => {
    const chain: string[] = []
    let cursor: AnyNode | undefined = node
    let guard = 0
    while (cursor && guard < 64) {
      const parentId = (cursor as { parentId?: string | null }).parentId
      if (!parentId) break
      chain.push(parentId)
      cursor = snapshot[parentId]
      guard += 1
    }
    return chain
  }

  const out: AnyNode[] = []
  for (const node of Object.values(snapshot)) {
    if (!isRenderableType(node.type)) continue
    const key = nodeLayerKey(node)
    if (visibility[key] === false) continue
    if (levelId) {
      const chain = ancestors(node)
      if (!chain.includes(levelId)) continue
    }
    out.push(node)
  }
  return out
}

/**
 * Engineering scale → metres of model space per millimetre of paper.
 *
 * A scale label like '1_96' means 1/8" = 1'-0" = 1:96. One
 * millimetre on paper therefore represents 96 millimetres in model
 * space = 0.096 m.
 */
export function metresPerPaperMm(scale: Viewport['scale']): number {
  const [num, den] = scale.split('_').map(Number)
  if (!num || !den) return 0.096
  return (den / num) / 1000 // paper_mm × (den/num) = model_mm → /1000 → m
}

export function computeBBox(nodes: AnyNode[]): [number, number, number, number] | null {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let any = false

  const visit = (x: number, z: number) => {
    any = true
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }

  for (const node of nodes) {
    switch (node.type) {
      case 'slab': {
        for (const [x, z] of node.polygon) visit(x, z)
        break
      }
      case 'wall': {
        visit(node.start[0], node.start[1])
        visit(node.end[0], node.end[1])
        break
      }
      case 'sprinkler_head': {
        const [x, , z] = node.position
        visit(x, z)
        break
      }
      case 'pipe': {
        visit(node.start_m[0], node.start_m[2])
        visit(node.end_m[0], node.end_m[2])
        break
      }
      default: {
        const pos = (node as { position?: [number, number, number] }).position
        if (pos) visit(pos[0], pos[2])
      }
    }
  }

  return any ? [minX, minZ, maxX, maxZ] : null
}

// ---------------------------------------------------------------------------
// Scene assembly (three.js).
// ---------------------------------------------------------------------------

interface BuildSceneResult {
  scene: THREE.Scene
  disposables: Array<THREE.BufferGeometry | THREE.Material>
  nodeCount: number
  types: Set<string>
}

function buildScene(nodes: AnyNode[]): BuildSceneResult {
  const scene = new THREE.Scene()
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = []
  const types = new Set<string>()

  const slabMat = new THREE.MeshBasicMaterial({ color: 0x333333 })
  const wallMat = new THREE.MeshBasicMaterial({ color: 0x777777 })
  const headMat = new THREE.MeshBasicMaterial({ color: 0xff3333 })
  const pipeMat = new THREE.MeshBasicMaterial({ color: 0x1e88e5 })
  const genericMat = new THREE.MeshBasicMaterial({ color: 0x4af626 })
  disposables.push(slabMat, wallMat, headMat, pipeMat, genericMat)

  let nodeCount = 0
  for (const node of nodes) {
    types.add(node.type)
    switch (node.type) {
      case 'slab': {
        // Compute AABB of the polygon and draw as a thin box at the
        // slab's elevation. Schematic — we are not triangulating the
        // polygon for the raster pass.
        const poly = node.polygon
        if (poly.length < 3) break
        let minX = poly[0][0], maxX = poly[0][0]
        let minZ = poly[0][1], maxZ = poly[0][1]
        for (const [x, z] of poly) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (z < minZ) minZ = z
          if (z > maxZ) maxZ = z
        }
        const w = maxX - minX
        const d = maxZ - minZ
        if (w <= 0 || d <= 0) break
        const geo = new THREE.BoxGeometry(w, 0.05, d)
        disposables.push(geo)
        const mesh = new THREE.Mesh(geo, slabMat)
        mesh.position.set(minX + w / 2, node.elevation ?? 0, minZ + d / 2)
        scene.add(mesh)
        nodeCount += 1
        break
      }
      case 'wall': {
        const [sx, sz] = node.start
        const [ex, ez] = node.end
        const dx = ex - sx
        const dz = ez - sz
        const len = Math.hypot(dx, dz)
        if (len <= 0) break
        const thickness = node.thickness ?? 0.15
        const height = node.height ?? 3.0
        const geo = new THREE.BoxGeometry(len, height, thickness)
        disposables.push(geo)
        const mesh = new THREE.Mesh(geo, wallMat)
        mesh.position.set((sx + ex) / 2, height / 2, (sz + ez) / 2)
        mesh.rotation.y = -Math.atan2(dz, dx)
        scene.add(mesh)
        nodeCount += 1
        break
      }
      case 'sprinkler_head': {
        const [x, y, z] = node.position
        const geo = new THREE.SphereGeometry(0.15, 8, 6)
        disposables.push(geo)
        const mesh = new THREE.Mesh(geo, headMat)
        mesh.position.set(x, y, z)
        scene.add(mesh)
        nodeCount += 1
        break
      }
      case 'pipe': {
        const [sx, sy, sz] = node.start_m
        const [ex, ey, ez] = node.end_m
        const len = Math.hypot(ex - sx, ey - sy, ez - sz)
        if (len <= 0) break
        const geo = new THREE.CylinderGeometry(0.04, 0.04, len, 6)
        disposables.push(geo)
        const mesh = new THREE.Mesh(geo, pipeMat)
        mesh.position.set((sx + ex) / 2, (sy + ey) / 2, (sz + ez) / 2)
        const axis = new THREE.Vector3(0, 1, 0)
        const dir = new THREE.Vector3(ex - sx, ey - sy, ez - sz).normalize()
        mesh.quaternion.setFromUnitVectors(axis, dir)
        scene.add(mesh)
        nodeCount += 1
        break
      }
      default: {
        const pos = (node as { position?: [number, number, number] }).position
        if (!pos) break
        const geo = new THREE.BoxGeometry(0.25, 0.25, 0.25)
        disposables.push(geo)
        const mesh = new THREE.Mesh(geo, genericMat)
        mesh.position.set(pos[0], pos[1], pos[2])
        scene.add(mesh)
        nodeCount += 1
        break
      }
    }
  }

  return { scene, disposables, nodeCount, types }
}

function configureCamera(
  kind: Viewport['camera']['kind'],
  bbox: [number, number, number, number] | null,
  halfWidthM: number,
  halfHeightM: number,
): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(
    -halfWidthM,
    halfWidthM,
    halfHeightM,
    -halfHeightM,
    -1000,
    1000,
  )
  const cx = bbox ? (bbox[0] + bbox[2]) / 2 : 0
  const cz = bbox ? (bbox[1] + bbox[3]) / 2 : 0

  switch (kind) {
    case 'top': {
      camera.position.set(cx, 100, cz)
      camera.up.set(0, 0, -1)
      camera.lookAt(cx, 0, cz)
      break
    }
    case 'iso': {
      camera.position.set(cx + 80, 80, cz + 80)
      camera.up.set(0, 1, 0)
      camera.lookAt(cx, 0, cz)
      break
    }
    case 'front': {
      camera.position.set(cx, 10, cz + 100)
      camera.up.set(0, 1, 0)
      camera.lookAt(cx, 10, cz)
      break
    }
    case 'side': {
      camera.position.set(cx + 100, 10, cz)
      camera.up.set(0, 1, 0)
      camera.lookAt(cx, 10, cz)
      break
    }
    default: {
      camera.position.set(cx, 100, cz)
      camera.up.set(0, 0, -1)
      camera.lookAt(cx, 0, cz)
    }
  }
  camera.updateProjectionMatrix()
  return camera
}

// ---------------------------------------------------------------------------
// Rasteriser.
// ---------------------------------------------------------------------------

/**
 * Perform the offscreen render and return a PNG data URL.
 * Disposes the renderer + geometries before returning.
 *
 * Returns null if WebGL is unavailable in the current runtime
 * (Node-without-GL test contexts). Callers should treat null as
 * "skip pixel work, still emit a paper-space <image> with an empty
 * src".
 */
export function rasteriseViewport(
  viewport: Viewport,
  sceneSnapshot: Record<string, AnyNode>,
  dpr: number,
  onDebug?: (info: ViewportDebugInfo) => void,
): string | null {
  const mPerMm = metresPerPaperMm(viewport.scale)
  const filtered = filterSceneForViewport(sceneSnapshot, viewport)
  const bbox = computeBBox(filtered)

  const [, , wMm, hMm] = viewport.paper_rect_mm
  const widthPx = Math.max(1, Math.round(wMm * dpr))
  const heightPx = Math.max(1, Math.round(hMm * dpr))
  const halfWidthM = (wMm * mPerMm) / 2
  const halfHeightM = (hMm * mPerMm) / 2

  const { scene, disposables, nodeCount, types } = buildScene(filtered)

  let disposed = false
  let canvas: HTMLCanvasElement | undefined
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas')
    canvas.width = widthPx
    canvas.height = heightPx
  }

  let dataUrl: string | null = null
  let renderer: THREE.WebGLRenderer | undefined
  try {
    if (canvas) {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      })
      renderer.setSize(widthPx, heightPx, false)
      renderer.setClearColor(0xffffff, 0)
      const camera = configureCamera(
        viewport.camera.kind,
        bbox,
        halfWidthM,
        halfHeightM,
      )
      renderer.render(scene, camera)
      dataUrl = renderer.domElement.toDataURL('image/png')
    }
  } catch {
    dataUrl = null
  } finally {
    if (renderer) {
      renderer.dispose()
      renderer.forceContextLoss?.()
      disposed = true
    }
    for (const d of disposables) d.dispose()
  }

  onDebug?.({
    nodeCountRendered: nodeCount,
    nodeTypesRendered: [...types],
    bboxMetres: bbox,
    metresPerPaperMm: mPerMm,
    disposed,
  })

  return dataUrl
}

/**
 * Pure helper: produce the SVG markup for a viewport directly,
 * without going through React. Used for server-side SVG export and
 * for deterministic tests.
 */
export function renderViewportSvg(
  viewport: Viewport,
  sceneSnapshot: Record<string, AnyNode>,
  dpr: number = 2,
  onDebug?: (info: ViewportDebugInfo) => void,
): string {
  const [x, y, w, h] = viewport.paper_rect_mm
  const dataUrl =
    rasteriseViewport(viewport, sceneSnapshot, dpr, onDebug) ??
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII='
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-testid="halofire-viewport"` +
    ` data-viewport-id="${viewport.id}"` +
    ` data-scale="${viewport.scale}"` +
    ` data-camera-kind="${viewport.camera.kind}"` +
    ` viewBox="${x} ${y} ${w} ${h}" width="${w}mm" height="${h}mm">` +
    `<image href="${dataUrl}" x="${x}" y="${y}" width="${w}" height="${h}"` +
    ` preserveAspectRatio="none" />` +
    `</svg>`
  )
}

// ---------------------------------------------------------------------------
// React component.
// ---------------------------------------------------------------------------

export function ViewportRenderer(props: ViewportRendererProps): JSX.Element {
  const { viewport, sceneSnapshot, dpr = 2, onDebug } = props
  const [x, y, w, h] = viewport.paper_rect_mm

  const dataUrl = React.useMemo(() => {
    return rasteriseViewport(viewport, sceneSnapshot, dpr, onDebug)
  }, [viewport, sceneSnapshot, dpr, onDebug])

  const href =
    dataUrl ??
    // 1x1 transparent PNG fallback when WebGL is unavailable. The
    // caller still gets a valid <image> with correct paper-space
    // geometry — downstream SVG export keeps flowing.
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII='

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      data-testid="halofire-viewport"
      data-viewport-id={viewport.id}
      data-scale={viewport.scale}
      data-camera-kind={viewport.camera.kind}
      viewBox={`${x} ${y} ${w} ${h}`}
      width={`${w}mm`}
      height={`${h}mm`}
    >
      <image
        href={href}
        x={x}
        y={y}
        width={w}
        height={h}
        preserveAspectRatio="none"
      />
    </svg>
  )
}

export default ViewportRenderer
