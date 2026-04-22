'use client'

/**
 * PipeHandles — Phase F drag-resize gizmo for selected pipes.
 *
 * Reads the halofire scene store for the current selection; when a
 * pipe is selected, publishes `{start, end, size_in}` descriptors to
 * the `useHalofireBridge` store. The bridge slot (rendered inside
 * Pascal's `<Canvas>`) draws three handles per selected pipe:
 *
 *   • Red sphere at each endpoint — drag to reposition the endpoint;
 *     on pointer-up the full ray / ground-plane intersection is
 *     PATCHed back to the pipe via `modifyPipe`.
 *   • Amber cube at the midpoint — click to step the pipe schedule
 *     up one size (Shift-click to step down).
 *
 * This component has no DOM output of its own; everything lives in
 * the r3f Canvas.
 */

import { useEffect } from 'react'
import { useHalofireBridge, type HalofirePipeHandle } from '@pascal-app/viewer/halofire'
import { getHalofireSceneStore } from '@/lib/halofire/scene-store'

const SIZES = [0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 6.0, 8.0]

function stepSize(cur: number | undefined, delta: 1 | -1): number {
  const base = cur ?? 1.0
  let idx = SIZES.findIndex((s) => Math.abs(s - base) < 1e-3)
  if (idx < 0) idx = SIZES.findIndex((s) => s >= base)
  if (idx < 0) idx = 0
  idx = Math.min(SIZES.length - 1, Math.max(0, idx + delta))
  return SIZES[idx]
}

export interface PipeHandlesProps {
  projectId: string
}

export function PipeHandles({ projectId }: PipeHandlesProps) {
  const setPipeHandles = useHalofireBridge((s) => s.setPipeHandles)
  const setOnPipeEndpointMove = useHalofireBridge((s) => s.setOnPipeEndpointMove)
  const setOnPipeDiameterStep = useHalofireBridge((s) => s.setOnPipeDiameterStep)

  // Subscribe to the halofire scene store — when selection changes,
  // publish handles for every selected pipe.
  useEffect(() => {
    const store = getHalofireSceneStore(projectId)
    const compute = (): HalofirePipeHandle[] => {
      const s = store.getState()
      const out: HalofirePipeHandle[] = []
      for (const id of s.selection) {
        const n = s.nodes[id]
        if (!n || n.kind !== 'pipe') continue
        out.push({
          pipeId: id,
          start: [n.start_m.x, n.start_m.y, n.start_m.z],
          end: [n.end_m.x, n.end_m.y, n.end_m.z],
          size_in: n.size_in ?? 1.0,
        })
      }
      return out
    }
    setPipeHandles(compute())
    const unsub = store.subscribe(() => setPipeHandles(compute()))
    return () => {
      unsub()
      setPipeHandles([])
    }
  }, [projectId, setPipeHandles])

  // Register drag + diameter-step callbacks.
  useEffect(() => {
    const store = getHalofireSceneStore(projectId)
    setOnPipeEndpointMove((pipeId, which, world) => {
      const patch =
        which === 'start'
          ? { start_m: { x: world[0], y: world[1], z: world[2] } }
          : { end_m: { x: world[0], y: world[1], z: world[2] } }
      store.getState().modifyPipe(pipeId, patch).catch((err: unknown) => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('halofire:toast', {
            detail: { level: 'error', message: `pipe drag failed: ${String(err)}` },
          }))
        }
      })
    })
    setOnPipeDiameterStep((pipeId, delta) => {
      const cur = store.getState().nodes[pipeId]
      if (!cur || cur.kind !== 'pipe') return
      const next = stepSize(cur.size_in, delta)
      store.getState().modifyPipe(pipeId, { size_in: next }).catch((err: unknown) => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('halofire:toast', {
            detail: { level: 'error', message: `diameter step failed: ${String(err)}` },
          }))
        }
      })
    })
    return () => {
      setOnPipeEndpointMove(null)
      setOnPipeDiameterStep(null)
    }
  }, [projectId, setOnPipeEndpointMove, setOnPipeDiameterStep])

  return null
}

export const _internals = { stepSize, SIZES }
