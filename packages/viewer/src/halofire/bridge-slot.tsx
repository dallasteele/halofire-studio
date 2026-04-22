'use client'

/**
 * HalofireBridgeSlot — r3f-aware mount point rendered inside Pascal's
 * `<Canvas>`. Must live inside the Canvas for `useThree` to work.
 *
 * Responsibilities:
 *
 *   1. Publish `{camera, raycaster, scene, gl, domRect}` to the
 *      bridge zustand store so halofire tools can perform real
 *      raycasts.
 *   2. Walk the Pascal scene once per layer-visibility change and
 *      flip Object3D.visible on halofire-tagged groups so the
 *      LayerPanel toggles really hide heads/pipes.
 *   3. Render `<Html>` tags pinned to world positions.
 *   4. Render pipe drag-handle spheres for the currently-selected
 *      pipe; dragging a handle fires the registered callbacks.
 */

import { useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Mesh, Object3D } from 'three'
import * as THREE from 'three'
import { useHalofireBridge, resolveHalofireLayer, type LayerId } from './bridge'

const TAG_LAYER_NAMES = new Set<string>([
  'halofire_layer',
])

function readNodeHalofireLayer(obj: Object3D): LayerId | null {
  // Pascal groups carry `userData.nodeType` + `userData.tags` + `userData.asset`
  // after intake. We check both the direct object and up to 3 parents
  // because Pascal sometimes nests meshes under the node group.
  let cur: Object3D | null = obj
  for (let depth = 0; depth < 4 && cur; depth += 1, cur = cur.parent) {
    const u = cur.userData ?? {}
    const tags: string[] | undefined =
      u.halofireTags ?? u.tags ?? u.asset?.tags
    const category: string | undefined = u.asset?.category ?? u.category
    const type: string | undefined = u.nodeType ?? u.type
    const layer = resolveHalofireLayer({ tags, category, type })
    if (layer) return layer
  }
  return null
}

function severityColor(s: 'ok' | 'warn' | 'critical'): string {
  if (s === 'critical') return '#ff3333'
  if (s === 'warn') return '#ffb800'
  return '#4af626'
}

interface Props {
  /** Optional override for the canvas DOM lookup (tests only). */
  canvasSelector?: string
}

export function HalofireBridgeSlot({ canvasSelector = 'canvas' }: Props) {
  const three = useThree()
  const setRefs = useHalofireBridge((s) => s.setRefs)
  const layers = useHalofireBridge((s) => s.layers)
  const tags = useHalofireBridge(useShallow((s) => s.tags))
  const pipeHandles = useHalofireBridge(useShallow((s) => s.pipeHandles))
  const onEndpointMove = useHalofireBridge((s) => s.onPipeEndpointMove)

  // Publish r3f handles on mount + when they change.
  useEffect(() => {
    const canvas =
      typeof document !== 'undefined'
        ? (document.querySelector(canvasSelector) as HTMLCanvasElement | null)
        : null
    setRefs({
      camera: three.camera,
      raycaster: three.raycaster,
      scene: three.scene,
      gl: three.gl as unknown as THREE.WebGLRenderer,
      domRect: canvas?.getBoundingClientRect() ?? null,
    })
    if (typeof window !== 'undefined' && canvas) {
      const onResize = () => {
        setRefs({ domRect: canvas.getBoundingClientRect() })
      }
      window.addEventListener('resize', onResize)
      // Also watch for layout shifts via ResizeObserver.
      let ro: ResizeObserver | undefined
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(onResize)
        ro.observe(canvas)
      }
      return () => {
        window.removeEventListener('resize', onResize)
        ro?.disconnect()
      }
    }
  }, [three.camera, three.raycaster, three.scene, three.gl, setRefs, canvasSelector])

  // Apply layer visibility — traverse the scene and set .visible on
  // halofire-tagged nodes. Cheap: runs only when `layers` changes.
  useEffect(() => {
    if (!three.scene) return
    three.scene.traverse((obj) => {
      const layer = readNodeHalofireLayer(obj)
      if (!layer) return
      const vis = layers[layer] ?? true
      // Only touch groups at the halofire-tagged level — the
      // traversal revisits children, so per-mesh overrides get
      // replaced on the next pass.
      if (obj.type === 'Group' || obj.type === 'Mesh') {
        obj.visible = vis
      }
    })
  }, [layers, three.scene])

  // Drag state for pipe handles.
  const dragRef = useRef<{ pipeId: string; which: 'start' | 'end' } | null>(null)

  const handleDown = (pipeId: string, which: 'start' | 'end') => (e: any) => {
    e.stopPropagation?.()
    dragRef.current = { pipeId, which }
    // Capture pointer on canvas.
    const canvas = document.querySelector(canvasSelector) as HTMLCanvasElement | null
    if (canvas && e.pointerId != null) {
      try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }
  }

  const handleMove = (e: any) => {
    if (!dragRef.current) return
    // Raycast onto an invisible ground plane at y = pipe endpoint y.
    const { raycaster, camera } = three
    const canvas = document.querySelector(canvasSelector) as HTMLCanvasElement | null
    if (!canvas || !raycaster || !camera) return
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(ndc, camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const target = new THREE.Vector3()
    raycaster.ray.intersectPlane(plane, target)
    if (!target) return
    // Render preview: nothing to do; commit on up.
    ;(dragRef.current as any).preview = target.toArray()
  }

  const handleUp = (_e: any) => {
    const active = dragRef.current as
      | { pipeId: string; which: 'start' | 'end'; preview?: [number, number, number] }
      | null
    dragRef.current = null
    if (!active || !active.preview) return
    if (onEndpointMove) {
      onEndpointMove(active.pipeId, active.which, active.preview)
    }
  }

  // Attach drag listeners while handles are visible.
  useEffect(() => {
    if (pipeHandles.length === 0) return
    const move = (e: PointerEvent) => handleMove(e)
    const up = (e: PointerEvent) => handleUp(e)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeHandles.length])

  const stepDiameter = useHalofireBridge((s) => s.onPipeDiameterStep)

  // Build handles set
  const handleElems = useMemo(() => {
    return pipeHandles.flatMap((h) => {
      const mid: [number, number, number] = [
        (h.start[0] + h.end[0]) / 2,
        (h.start[1] + h.end[1]) / 2 + 0.12,
        (h.start[2] + h.end[2]) / 2,
      ]
      return [
        <mesh
          key={`${h.pipeId}-start`}
          position={h.start as unknown as THREE.Vector3Tuple}
          onPointerDown={handleDown(h.pipeId, 'start')}
          userData={{ halofireHandle: 'endpoint' }}
        >
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshBasicMaterial color="#e8432d" />
        </mesh>,
        <mesh
          key={`${h.pipeId}-end`}
          position={h.end as unknown as THREE.Vector3Tuple}
          onPointerDown={handleDown(h.pipeId, 'end')}
          userData={{ halofireHandle: 'endpoint' }}
        >
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshBasicMaterial color="#e8432d" />
        </mesh>,
        <mesh
          key={`${h.pipeId}-dia`}
          position={mid as unknown as THREE.Vector3Tuple}
          onPointerDown={(e: any) => {
            e.stopPropagation?.()
            // Shift-click = down-size, regular = up-size.
            if (stepDiameter)
              stepDiameter(h.pipeId, e.shiftKey ? -1 : 1)
          }}
          userData={{ halofireHandle: 'diameter' }}
        >
          <boxGeometry args={[0.14, 0.05, 0.14]} />
          <meshBasicMaterial color="#ffb800" />
        </mesh>,
      ]
    })
  }, [pipeHandles, stepDiameter])

  return (
    <group name="halofire-bridge-slot">
      {tags.map((t) => (
        <Html
          key={t.id}
          position={t.position as unknown as THREE.Vector3Tuple}
          center
          distanceFactor={10}
          style={{ pointerEvents: 'none' }}
        >
          <div
            data-testid={`node-tag-${t.id}`}
            data-severity={t.severity}
            data-critical={t.onCriticalPath ? 'true' : 'false'}
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 10,
              padding: '2px 6px',
              background: 'rgba(10,10,11,0.85)',
              color: '#e8e8e8',
              borderLeft: `2px solid ${severityColor(t.severity)}`,
              whiteSpace: 'nowrap',
              boxShadow: t.onCriticalPath
                ? `0 0 0 1px ${severityColor(t.severity)}`
                : 'none',
            }}
          >
            {t.label}
          </div>
        </Html>
      ))}
      {handleElems}
    </group>
  )
}

export default HalofireBridgeSlot
