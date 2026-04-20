'use client'

/**
 * RemoteAreaDraw — AutoSprink's "draw a rectangle around the heads
 * you want to flow" remote-area picker.
 *
 * Activated by the ribbon (cmd='remote-area') or command palette.
 * User click-drags on the viewport; we render a live rectangle and,
 * on release, POST the world-space corners to the gateway so the
 * hydraulic solver uses the interactively-chosen remote area on
 * its next calc.
 *
 * Why click-drag over click-to-pick-heads: matches AutoSprink
 * muscle memory and is faster for thousand-head systems. A "pick
 * heads individually" mode can layer on later.
 */

import { useEffect, useRef, useState } from 'react'

export type RemoteAreaRect = {
  /** World-meter coords (x,z plane), meters from site origin. */
  x_min_m: number
  z_min_m: number
  x_max_m: number
  z_max_m: number
  /** Canvas pixel coords — convenient for debug overlays. */
  px0: number; py0: number
  px1: number; py1: number
  /** Computed area in square meters and sqft. */
  area_m2: number
  area_sqft: number
}

interface State {
  active: boolean
  start: { x: number; y: number } | null
  current: { x: number; y: number } | null
  committed: RemoteAreaRect | null
}

function pickCanvas(): HTMLCanvasElement | null {
  return document.querySelector('canvas')
}

function pxToWorldM(px: number, canvas: HTMLCanvasElement): number {
  const w = canvas.clientWidth || canvas.width
  if (w <= 0) return 0
  return (px / w) * 30 // 30 m visible at default zoom
}

function worldBoundsFor(
  start: { x: number; y: number },
  end: { x: number; y: number },
  canvas: HTMLCanvasElement,
): RemoteAreaRect {
  const x0_m = pxToWorldM(Math.min(start.x, end.x), canvas)
  const z0_m = pxToWorldM(Math.min(start.y, end.y), canvas)
  const x1_m = pxToWorldM(Math.max(start.x, end.x), canvas)
  const z1_m = pxToWorldM(Math.max(start.y, end.y), canvas)
  const area_m2 = (x1_m - x0_m) * (z1_m - z0_m)
  // 1 m² = 10.7639 sqft
  const area_sqft = area_m2 * 10.7639
  return {
    x_min_m: x0_m, z_min_m: z0_m, x_max_m: x1_m, z_max_m: z1_m,
    px0: Math.min(start.x, end.x), py0: Math.min(start.y, end.y),
    px1: Math.max(start.x, end.x), py1: Math.max(start.y, end.y),
    area_m2, area_sqft,
  }
}

export interface RemoteAreaDrawProps {
  /** POST target for committed rect. No network call when null. */
  gatewayUrl?: string | null
  /** Project id for the POST route. */
  projectId?: string
  /** onCommit is called after the user releases the drag. */
  onCommit?: (rect: RemoteAreaRect) => void
}

export function RemoteAreaDraw({
  gatewayUrl = null,
  projectId = '1881-cooperative',
  onCommit,
}: RemoteAreaDrawProps) {
  const [state, setState] = useState<State>({
    active: false, start: null, current: null, committed: null,
  })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Ribbon / palette trigger
  useEffect(() => {
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cmd?: string } | undefined
      if (detail?.cmd !== 'remote-area') return
      setState((s) => ({
        active: !s.active, start: null, current: null, committed: null,
      }))
    }
    window.addEventListener('halofire:ribbon', onCmd as EventListener)
    return () =>
      window.removeEventListener('halofire:ribbon', onCmd as EventListener)
  }, [])

  // Announce to StatusBar / subscribers
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('halofire:tool-active', {
        detail: { tool: state.active ? 'remote-area' : null },
      }),
    )
  }, [state.active])

  // Esc cancels
  useEffect(() => {
    if (!state.active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setState({ active: false, start: null, current: null, committed: null })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.active])

  // Pointer handlers
  useEffect(() => {
    if (!state.active) return
    const onDown = (e: MouseEvent) => {
      const canvas = pickCanvas()
      if (!canvas || e.target !== canvas) return
      canvasRef.current = canvas
      const r = canvas.getBoundingClientRect()
      setState((s) => ({
        ...s,
        start: { x: e.clientX - r.left, y: e.clientY - r.top },
        current: { x: e.clientX - r.left, y: e.clientY - r.top },
        committed: null,
      }))
    }
    const onMove = (e: MouseEvent) => {
      if (!canvasRef.current) return
      const r = canvasRef.current.getBoundingClientRect()
      setState((s) =>
        s.start
          ? {
              ...s,
              current: { x: e.clientX - r.left, y: e.clientY - r.top },
            }
          : s,
      )
    }
    const onUp = () => {
      const canvas = canvasRef.current
      setState((s) => {
        if (!s.start || !s.current || !canvas) return s
        const rect = worldBoundsFor(s.start, s.current, canvas)
        // Ignore tiny accidental clicks (< 1 sqm)
        if (rect.area_m2 < 1.0) {
          return { ...s, start: null, current: null }
        }
        onCommit?.(rect)
        // POST to gateway if configured
        if (gatewayUrl) {
          void fetch(
            `${gatewayUrl}/projects/${projectId}/remote-area`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(rect),
            },
          ).catch(() => { /* offline ok */ })
        }
        return { active: false, start: null, current: null, committed: rect }
      })
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseup', onUp, true)
    }
  }, [state.active, gatewayUrl, projectId, onCommit])

  // No overlay unless active OR we have a committed rect to show
  if (!state.active && !state.committed) return null

  // Render overlay
  let rect: {
    px0: number; py0: number; px1: number; py1: number;
    area_sqft: number
  } | null = null
  if (state.committed) {
    rect = state.committed
  } else if (state.start && state.current) {
    const c = canvasRef.current
    if (c) {
      const r = worldBoundsFor(state.start, state.current, c)
      rect = r
    }
  }

  return (
    <div
      data-testid="halofire-remote-area-draw"
      className="pointer-events-none fixed left-0 top-0 z-[850] h-full w-full text-white"
    >
      <div className="pointer-events-auto absolute left-1/2 top-14 -translate-x-1/2 rounded-sm border border-[#e8432d]/60 bg-[#e8432d]/20 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em]">
        remote area · {state.committed
          ? 'committed'
          : state.start
            ? 'drag — release to commit'
            : 'click-drag to pick area'} · Esc to cancel
      </div>
      {rect && (
        <svg
          aria-hidden
          className="absolute left-0 top-0 h-full w-full"
          viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}
        >
          <rect
            x={rect.px0}
            y={rect.py0}
            width={rect.px1 - rect.px0}
            height={rect.py1 - rect.py0}
            fill={state.committed ? 'rgba(232, 67, 45, 0.12)' : 'rgba(255, 214, 0, 0.12)'}
            stroke={state.committed ? '#e8432d' : '#ffd600'}
            strokeWidth={1.5}
            strokeDasharray={state.committed ? '' : '4 4'}
          />
          <text
            x={(rect.px0 + rect.px1) / 2}
            y={Math.max(rect.py0 - 6, 12)}
            textAnchor="middle"
            fill={state.committed ? '#ffb4a6' : '#ffd600'}
            fontFamily="JetBrains Mono, monospace"
            fontSize="11"
          >
            {rect.area_sqft.toFixed(0)} sqft
          </text>
        </svg>
      )}
    </div>
  )
}

// Pure helpers for unit tests — no DOM
export const _internals = { pxToWorldM, worldBoundsFor }
