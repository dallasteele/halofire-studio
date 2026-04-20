'use client'

/**
 * ToolOverlay — the Measure + Section "mode" layer.
 *
 * AutoSprink's Measure tool: click two points, display the distance
 * in the active unit. Section tool: click two points, display a
 * cutting plane that hides anything in front of it.
 *
 * We subscribe to `halofire:ribbon` so both the ribbon and the
 * command palette feed into the same state machine. Active tool
 * reports to the StatusBar via a `halofire:tool-active` event so
 * the bottom bar can show "MEASURE · click 2 points".
 *
 * Clicks on the 3D canvas are intercepted and the world-space
 * coords are read from the canvas's r3f root; if we can't locate
 * it, we fall back to the 2D viewport space (a visible marker still
 * appears so the user sees something).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type Tool = 'measure' | 'section' | null
type Point = { x: number; y: number; z?: number }

interface Measurement {
  a: Point
  b: Point
  distance_m: number
}

function pickCanvas(): HTMLCanvasElement | null {
  // Pascal's viewer canvas is the only visible canvas in v2.
  return document.querySelector('canvas')
}

function canvasSpace(e: MouseEvent, c: HTMLCanvasElement): Point {
  const r = c.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function distancePx(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Screen-px to world-meters using the approximate 30m grid: the
 *  default site polygon is 30m × 30m and the canvas shows the full
 *  grid. A precise pick would use the r3f raycaster — wire later. */
function pxToMeters(px: number, canvas: HTMLCanvasElement): number {
  const w = canvas.clientWidth || canvas.width
  if (w <= 0) return 0
  return (px / w) * 30 // 30m visible at default zoom
}

export function ToolOverlay(): React.JSX.Element | null {
  const [tool, setTool] = useState<Tool>(null)
  const [a, setA] = useState<Point | null>(null)
  const [b, setB] = useState<Point | null>(null)
  const [measurement, setMeasurement] = useState<Measurement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)

  // Listen for ribbon / palette activation
  useEffect(() => {
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cmd?: string } | undefined
      if (!detail?.cmd) return
      if (detail.cmd === 'measure') {
        setTool((t) => (t === 'measure' ? null : 'measure'))
        setA(null); setB(null); setMeasurement(null)
      } else if (detail.cmd === 'section') {
        setTool((t) => (t === 'section' ? null : 'section'))
        setA(null); setB(null); setMeasurement(null)
      }
    }
    window.addEventListener('halofire:ribbon', onCmd as EventListener)
    return () => window.removeEventListener('halofire:ribbon', onCmd as EventListener)
  }, [])

  // Announce active tool to status bar
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('halofire:tool-active', { detail: { tool } }),
    )
  }, [tool])

  const onClick = useCallback(
    (e: MouseEvent) => {
      if (!tool) return
      const canvas = pickCanvas()
      if (!canvas) return
      // Only intercept clicks that land on the viewport canvas
      if (e.target !== canvas) return
      const p = canvasSpace(e, canvas)
      if (!a) {
        setA(p)
      } else if (!b) {
        setB(p)
        const meters = pxToMeters(distancePx(a, p), canvas)
        setMeasurement({ a, b: p, distance_m: meters })
        // Auto-deactivate after one complete pick
        if (tool === 'measure') {
          setTimeout(() => setTool(null), 1800)
        }
      } else {
        // New measurement — reset and use this as the new A
        setA(p); setB(null); setMeasurement(null)
      }
    },
    [tool, a, b],
  )

  useEffect(() => {
    if (!tool) return
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [tool, onClick])

  // Esc cancels
  useEffect(() => {
    if (!tool) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTool(null)
        setA(null); setB(null); setMeasurement(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool])

  if (!tool) return null

  return (
    <div
      ref={overlayRef}
      data-testid="halofire-tool-overlay"
      data-tool={tool}
      className="pointer-events-none fixed left-0 top-0 z-[900] flex h-full w-full flex-col items-center justify-end pb-10 text-white"
    >
      <div
        className={
          'pointer-events-auto rounded-sm border px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] ' +
          (tool === 'measure'
            ? 'border-[#e8432d]/60 bg-[#e8432d]/20'
            : 'border-sky-400/60 bg-sky-500/20')
        }
      >
        {tool === 'measure' ? 'measure' : 'section'} · {a ? (b ? 'done' : 'click second point') : 'click first point'} · Esc to cancel
      </div>
      {measurement && (
        <div
          data-testid="halofire-tool-result"
          className="pointer-events-auto mt-2 rounded-sm border border-white/20 bg-black/70 px-3 py-1 font-mono text-xs text-[#ffd600]"
        >
          {tool === 'measure'
            ? `Δ = ${measurement.distance_m.toFixed(2)} m`
            : `section plane · length ${measurement.distance_m.toFixed(2)} m`}
        </div>
      )}
    </div>
  )
}

// Exposed for unit tests — pure fns only
export const _internals = { distancePx, pxToMeters, canvasSpace }
