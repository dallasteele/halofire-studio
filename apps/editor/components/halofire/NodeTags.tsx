'use client'

/**
 * NodeTags — viewport overlay that labels every head + critical
 * junction with its live pressure / flow / pipe size / velocity.
 *
 * AutoSprink shows these labels directly on the drawing. We match
 * the affordance with a DOM overlay pinned to world-space head
 * positions, projected through the same 30-m grid approximation that
 * ToolOverlay uses. It's not a full r3f `<Html>` anchor — that would
 * require mounting inside Pascal's `<Canvas>` — but it tracks canvas
 * resize + scroll and is precise enough for the scales we care about
 * (single building, ≤ 30 m on a side).
 *
 * The tags respond to:
 *   - `halofire:layer-visibility` — hide tags whose node's layer was
 *     toggled off by the LayerPanel.
 *   - ribbon command `node-tags-toggle` — global show/hide switch.
 *
 * Severity coloring comes from `useLiveHydraulics`:
 *   green = ok, amber = warn (≥ 20 ft/s), red = critical (≥ 32 ft/s
 *   or negative margin).
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { NodeDatum, SystemsSnapshot } from '@/lib/hooks/useLiveHydraulics'

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
  /** World-span of the viewport canvas in meters (matches ToolOverlay). */
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

function pickCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector('canvas')
}

export function projectNode(
  position: [number, number, number],
  rect: { width: number; height: number; left: number; top: number },
  worldSpanMeters: number,
): { x: number; y: number } {
  // AutoSprink 2D plan view: X = world-X, Y = world-Z (Y-up).
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

export function NodeTags({
  snapshot, worldSpanMeters = 30, pollMs = 400,
}: Props) {
  const [enabled, setEnabled] = useState(true)
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set())
  const [tick, setTick] = useState(0)
  const rafRef = useRef<number | null>(null)

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

  // Layer-visibility tracking.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onVis = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { layer?: string; visible?: boolean }
        | undefined
      if (!detail?.layer) return
      setHiddenLayers((prev) => {
        const next = new Set(prev)
        if (detail.visible === false) next.add(detail.layer as string)
        else next.delete(detail.layer as string)
        return next
      })
    }
    window.addEventListener('halofire:layer-visibility', onVis as EventListener)
    return () =>
      window.removeEventListener(
        'halofire:layer-visibility', onVis as EventListener,
      )
  }, [])

  // Re-render on resize + periodic poll so tags track the canvas.
  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return
    const bump = () => setTick((t) => t + 1)
    window.addEventListener('resize', bump)
    const iv = setInterval(bump, pollMs)
    return () => {
      window.removeEventListener('resize', bump)
      clearInterval(iv)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [enabled, pollMs])

  const visibleNodes = useMemo(() => {
    if (!enabled || !snapshot) return []
    const nodes = readScene()
    const canvas = pickCanvas()
    if (!canvas) return []
    const rect = canvas.getBoundingClientRect()
    const out: Array<{
      id: string
      x: number
      y: number
      datum: NodeDatum
      label: string
    }> = []
    for (const n of Object.values(nodes)) {
      const tags = [
        ...(n.asset?.tags ?? []),
        ...(n.metadata?.tags ?? []),
      ]
      if (!tags.includes('halofire')) continue
      const cat = n.asset?.category ?? ''
      const isHead = cat.startsWith('sprinkler_head') || n.type === 'sprinkler_head'
      if (!isHead) continue
      const layer = n.metadata?.layer ?? 'heads'
      if (hiddenLayers.has(layer)) continue
      if (!n.position) continue
      // Map the scene node id to the solver's hydraulic_node_id when
      // present, otherwise fall through to the raw id — small designs
      // keep the two in sync.
      const lookup = n.metadata?.hydraulic_node_id ?? n.id
      const datum = snapshot.nodes[lookup]
      if (!datum) continue
      const p = projectNode(n.position, rect, worldSpanMeters)
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
      out.push({ id: n.id, x: p.x, y: p.y, datum, label })
    }
    return out
    // `tick` intentionally in deps to re-read on resize / poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, enabled, hiddenLayers, worldSpanMeters, tick])

  if (!enabled || visibleNodes.length === 0) return null

  return (
    <div
      data-testid="halofire-node-tags"
      className="pointer-events-none fixed inset-0 z-[700] font-mono"
    >
      {visibleNodes.map((t) => (
        <div
          key={t.id}
          data-testid={`node-tag-${t.id}`}
          data-severity={t.datum.severity}
          data-critical={t.datum.on_critical_path ? 'true' : 'false'}
          style={{
            position: 'absolute',
            left: t.x,
            top: t.y,
            transform: 'translate(12px, -50%)',
            borderLeft: `2px solid ${severityColor(t.datum.severity)}`,
            background: 'rgba(10,10,11,0.85)',
            color: '#e8e8e8',
            padding: '2px 6px',
            fontSize: 10,
            whiteSpace: 'nowrap',
            boxShadow: t.datum.on_critical_path
              ? `0 0 0 1px ${severityColor(t.datum.severity)}`
              : 'none',
          }}
        >
          {t.label}
        </div>
      ))}
    </div>
  )
}

// Exported for unit tests.
export const _internals = { projectNode, severityColor }
