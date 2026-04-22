'use client'

/**
 * NodeTags — viewport labels for every head + critical junction.
 *
 * Phase F rewrite: instead of projecting world→screen in DOM, we
 * publish a list of `{id, position, label, severity}` to the
 * `useHalofireBridge` store. `HalofireBridgeSlot` (mounted inside
 * Pascal's `<Canvas>`) renders an `<Html>` anchor per tag, so tags
 * follow the camera automatically on orbit / zoom / pan.
 *
 * A ribbon toggle (`node-tags-toggle`) flips the global enabled
 * state. Layer visibility (`halofire:layer-visibility`) hides tags
 * for layers that the LayerPanel has collapsed — we read the bridge
 * store's `layers` directly so there's a single source of truth.
 *
 * The old DOM-overlay projection is preserved under `projectNode` +
 * `_internals` for the existing unit test suite; no runtime code
 * consumes it any more.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { NodeDatum, SystemsSnapshot } from '@/lib/hooks/useLiveHydraulics'
import { useHalofireBridge, type HalofireNodeTag } from '@pascal-app/viewer/halofire'

interface SceneNode {
  id: string
  type?: string
  position?: [number, number, number]
  asset?: { category?: string; tags?: string[] }
  metadata?: { tags?: string[]; layer?: string; hydraulic_node_id?: string }
  systemId?: string
}

interface Props {
  /** Live hydraulic snapshot from `useLiveHydraulics`. */
  snapshot: SystemsSnapshot | null
  /**
   * Unused after Phase F — kept for API compat with existing tests
   * that invoke `projectNode()`.
   */
  worldSpanMeters?: number
  /** Poll interval for scene-store snapshots (ms). */
  pollMs?: number
}

function readScene(): Record<string, SceneNode> {
  if (typeof window === 'undefined') return {}
  const w = window as unknown as {
    __hfScene?: { getState: () => { nodes: Record<string, SceneNode> } }
  }
  try {
    return w.__hfScene?.getState().nodes ?? {}
  } catch {
    return {}
  }
}

// Kept for legacy unit tests — projects a world xy into a canvas-
// relative screen point. Unused at runtime now.
export function projectNode(
  position: [number, number, number],
  rect: { width: number; height: number; left: number; top: number },
  worldSpanMeters: number,
): { x: number; y: number } {
  const [wx, , wz] = position
  const m2px = rect.width / worldSpanMeters
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  return { x: cx + wx * m2px, y: cy + wz * m2px }
}

function severityColor(s: NodeDatum['severity']): string {
  if (s === 'critical') return '#ff3333'
  if (s === 'warn') return '#ffb800'
  return '#4af626'
}

export function NodeTags({ snapshot, pollMs = 400 }: Props) {
  const [enabled, setEnabled] = useState(true)
  const [tick, setTick] = useState(0)
  const bridge = useHalofireBridge
  const setTags = bridge((s) => s.setTags)
  const layers = bridge((s) => s.layers)

  // Ribbon toggle.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cmd?: string } | undefined
      if (detail?.cmd === 'node-tags-toggle') setEnabled((v) => !v)
    }
    window.addEventListener('halofire:ribbon', onCmd as EventListener)
    return () =>
      window.removeEventListener('halofire:ribbon', onCmd as EventListener)
  }, [])

  // Periodic poll — re-collect tags every `pollMs`. Covers cases
  // where the scene store mutates without firing a custom event.
  useEffect(() => {
    if (!enabled) return
    const iv = setInterval(() => setTick((t) => t + 1), pollMs)
    return () => clearInterval(iv)
  }, [enabled, pollMs])

  const tags = useMemo<HalofireNodeTag[]>(() => {
    if (!enabled || !snapshot) return []
    const nodes = readScene()
    const out: HalofireNodeTag[] = []
    for (const n of Object.values(nodes)) {
      const tagsList = [
        ...(n.asset?.tags ?? []),
        ...(n.metadata?.tags ?? []),
      ]
      if (!tagsList.includes('halofire')) continue
      const cat = n.asset?.category ?? ''
      const isHead = cat.startsWith('sprinkler_head') || n.type === 'sprinkler_head'
      if (!isHead) continue
      const layer = (n.metadata?.layer ?? 'heads') as keyof typeof layers
      if (layers[layer] === false) continue
      if (!n.position) continue
      const lookup = n.metadata?.hydraulic_node_id ?? n.id
      const datum = snapshot.nodes[lookup]
      if (!datum) continue
      const pressure =
        datum.pressure_psi != null ? `${datum.pressure_psi.toFixed(1)} psi` : '—'
      const flow =
        datum.flow_gpm != null ? `${datum.flow_gpm.toFixed(0)} gpm` : ''
      const velocity =
        datum.velocity_fps != null && datum.velocity_fps > 0
          ? `${datum.velocity_fps.toFixed(1)} ft/s`
          : ''
      const size = datum.size_in != null ? `${datum.size_in}"` : ''
      const label = [pressure, flow, velocity, size].filter(Boolean).join(' · ')
      out.push({
        id: n.id,
        position: n.position,
        label,
        severity: datum.severity,
        onCriticalPath: datum.on_critical_path,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, enabled, layers, tick])

  // Publish tags into the bridge — the r3f slot renders them.
  useEffect(() => {
    try { setTags(tags) } catch { /* bridge store might not exist in tests */ }
    return () => { try { setTags([]) } catch { /* */ } }
  }, [tags, setTags])

  // Lightweight DOM hint for Playwright tests that look for
  // data-testid="halofire-node-tags". The actual visible markers are
  // the r3f <Html> anchors — but those live inside Canvas and aren't
  // easy to assert on without a WebGL context.
  if (!enabled || tags.length === 0) return null
  return (
    <div
      data-testid="halofire-node-tags"
      data-count={tags.length}
      aria-hidden
      style={{ display: 'none' }}
    />
  )
}

// Exported for legacy unit tests.
export const _internals = { projectNode, severityColor }
