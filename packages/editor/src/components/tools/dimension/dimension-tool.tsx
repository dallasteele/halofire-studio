'use client'

/**
 * DimensionTool — HaloFire R8.2 Pascal tool.
 *
 * Blueprint 05 §2.8. Click two points in the viewport to place a
 * linear dimension. Tab cycles through linear → continuous → aligned.
 * Escape cancels. Scroll-wheel during the third ("dim-line-position")
 * stage nudges the perpendicular offset before the user commits.
 *
 * Pascal's in-viewport ToolManager (packages/editor/.../tool-manager.tsx)
 * binds phase/tool/mode combos to R3F tools; the dimension tool is a
 * paper-space annotation that the structure/site phase registry doesn't
 * yet reach, so we wire it as a lightweight DOM overlay that activates
 * on the ribbon's `halofire:ribbon` {cmd:'dimension'} event — matching
 * the RemoteAreaDraw pattern. On commit, we dispatch
 * `halofire:dimension-placed` with a valid schema Dimension record and
 * let downstream stores (active sheet, in-memory pending list) listen.
 */

// biome-ignore lint/style/noRelativeImport: schema subpath import
import type { Dimension } from '@pascal-app/core/schema/nodes/sheet'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Local mirror of `formatDimensionText` from `@halofire/core/drawing/dimension`.
 * Inlined here so `@pascal-app/editor` stays free of a `@halofire/core`
 * peer-dependency for the sake of one overlay label. Kept byte-for-byte
 * equivalent to the upstream formatter (R8.1) — update both in lock-step.
 */
function formatDimensionText(
  length_m: number,
  unit_display: 'ft_in' | 'decimal_ft' | 'm' | 'mm',
  precision: number,
): string {
  if (unit_display === 'm') return `${length_m.toFixed(precision)} m`
  if (unit_display === 'mm') return `${Math.round(length_m * 1000)} mm`
  if (unit_display === 'decimal_ft') {
    const ft = length_m / 0.3048
    return `${ft.toFixed(precision)} ft`
  }
  const totalInches = length_m / 0.0254
  const p = Math.max(0, Math.min(4, Math.floor(precision)))
  const denom = 1 << p
  const snapped = Math.round(totalInches * denom) / denom
  let feet = Math.trunc(snapped / 12)
  let inches = snapped - feet * 12
  if (snapped < 0 && inches !== 0) {
    inches = 12 + inches
    feet -= 1
  }
  const whole = Math.trunc(inches + 1e-9)
  const frac = inches - whole
  const fracNumer = Math.round(frac * denom)
  if (fracNumer === 0) return `${feet}'-${whole}"`
  const g = (() => {
    let a = Math.abs(fracNumer)
    let b = Math.abs(denom)
    while (b !== 0) {
      const t = b
      b = a % b
      a = t
    }
    return a || 1
  })()
  const n = fracNumer / g
  const d = denom / g
  if (whole === 0) return `${feet}'-${n}/${d}"`
  return `${feet}'-${whole} ${n}/${d}"`
}

export type DimensionKind = 'linear' | 'continuous' | 'aligned'
export type DimensionMode = 'idle' | 'first-clicked' | 'dim-line-position'

/** 3D world-space point produced by the viewport pick. */
export type WorldPoint = [number, number, number]

export interface DimensionToolState {
  active: boolean
  mode: DimensionMode
  kind: DimensionKind
  firstPoint: WorldPoint | null
  secondPoint: WorldPoint | null
  dimLineOffset: number
  /** Hover point while routing — for ghost preview. */
  hover: WorldPoint | null
}

const INITIAL: DimensionToolState = {
  active: false,
  mode: 'idle',
  kind: 'linear',
  firstPoint: null,
  secondPoint: null,
  dimLineOffset: 0.5,
  hover: null,
}

const KIND_CYCLE: DimensionKind[] = ['linear', 'continuous', 'aligned']

function cycleKind(k: DimensionKind): DimensionKind {
  return KIND_CYCLE[(KIND_CYCLE.indexOf(k) + 1) % KIND_CYCLE.length]!
}

function pickCanvas(): HTMLCanvasElement | null {
  return document.querySelector('canvas')
}

/**
 * Project a canvas pixel coord into an approximate world-space point
 * on the ground (y=0) plane, matching the 30 m visible window used by
 * the RemoteAreaDraw overlay. For v1 this is a stand-in until the tool
 * can read Pascal's real camera matrix; the schema only needs the 2D
 * (x,z) projection so the error stays consistent on both clicks.
 */
function pxToWorld(
  px: number,
  py: number,
  canvas: HTMLCanvasElement,
): WorldPoint {
  const w = canvas.clientWidth || canvas.width || 1
  const h = canvas.clientHeight || canvas.height || 1
  const x = (px / w) * 30
  const z = (py / h) * 30
  return [x, 0, z]
}

function distance2DXZ(a: WorldPoint, b: WorldPoint): number {
  const dx = b[0] - a[0]
  const dz = b[2] - a[2]
  return Math.hypot(dx, dz)
}

/** Build a Dimension record from the tool state. Stored points are
 *  2-tuples (x,z) — schema/nodes/sheet expects 2D paper-space tuples. */
export function buildDimension(state: {
  kind: DimensionKind
  firstPoint: WorldPoint
  secondPoint: WorldPoint
  dimLineOffset: number
}): Dimension {
  const id = `dim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    kind: state.kind,
    points: [
      [state.firstPoint[0], state.firstPoint[2]],
      [state.secondPoint[0], state.secondPoint[2]],
    ],
    dim_line_offset_m: state.dimLineOffset,
    precision: 2,
    unit_display: 'ft_in',
    style_id: 'halofire.default',
  }
}

export const DimensionTool: React.FC = () => {
  const [state, setState] = useState<DimensionToolState>(INITIAL)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Ribbon / palette trigger — toggles active.
  useEffect(() => {
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cmd?: string } | undefined
      if (detail?.cmd !== 'dimension') return
      setState((s) => (s.active ? INITIAL : { ...INITIAL, active: true }))
    }
    window.addEventListener('halofire:ribbon', onCmd as EventListener)
    return () =>
      window.removeEventListener('halofire:ribbon', onCmd as EventListener)
  }, [])

  // Announce tool-active for the StatusBar.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('halofire:tool-active', {
        detail: { tool: state.active ? 'dimension' : null },
      }),
    )
  }, [state.active])

  const reset = useCallback(() => setState({ ...INITIAL }), [])

  const commit = useCallback(() => {
    setState((s) => {
      if (!s.firstPoint || !s.secondPoint) return s
      const dim = buildDimension({
        kind: s.kind,
        firstPoint: s.firstPoint,
        secondPoint: s.secondPoint,
        dimLineOffset: s.dimLineOffset,
      })
      window.dispatchEvent(
        new CustomEvent('halofire:dimension-placed', {
          detail: { dimension: dim, sheet_id: dim.sheet_id },
        }),
      )
      // Stay active so the estimator can chain dimensions.
      return { ...INITIAL, active: true }
    })
  }, [])

  // Keyboard: Esc cancels, Tab cycles kind, 'd' shortcut activates.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        !state.active &&
        (e.key === 'd' || e.key === 'D') &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        const target = e.target as HTMLElement | null
        const inField =
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        if (!inField) {
          e.preventDefault()
          setState({ ...INITIAL, active: true })
          return
        }
      }
      if (!state.active) return
      if (e.key === 'Escape') {
        e.preventDefault()
        reset()
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        setState((s) => ({ ...s, kind: cycleKind(s.kind) }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.active, reset])

  // Pointer state machine — idle → first-clicked → dim-line-position → commit.
  useEffect(() => {
    if (!state.active) return

    const onDown = (e: MouseEvent) => {
      const canvas = pickCanvas()
      if (!canvas || e.target !== canvas) return
      canvasRef.current = canvas
      const r = canvas.getBoundingClientRect()
      const pt = pxToWorld(e.clientX - r.left, e.clientY - r.top, canvas)
      setState((s) => {
        if (s.mode === 'idle') {
          return { ...s, mode: 'first-clicked', firstPoint: pt, hover: pt }
        }
        if (s.mode === 'first-clicked') {
          // Guard against a zero-length span.
          if (s.firstPoint && distance2DXZ(s.firstPoint, pt) < 0.01) {
            return s
          }
          return { ...s, mode: 'dim-line-position', secondPoint: pt }
        }
        // Third click in dim-line-position commits.
        if (s.mode === 'dim-line-position') {
          return s // commit is handled below (side effect)
        }
        return s
      })
    }

    const onMove = (e: MouseEvent) => {
      const canvas = canvasRef.current ?? pickCanvas()
      if (!canvas) return
      const r = canvas.getBoundingClientRect()
      const pt = pxToWorld(e.clientX - r.left, e.clientY - r.top, canvas)
      setState((s) => (s.mode === 'idle' ? s : { ...s, hover: pt }))
    }

    const onUp = (e: MouseEvent) => {
      // Commit the dimension on the third click (pointerup while in
      // dim-line-position with both points set).
      setState((s) => {
        if (s.mode !== 'dim-line-position') return s
        if (!s.firstPoint || !s.secondPoint) return s
        // Defer the actual dispatch to commit() so the event fires
        // with the latest state — do it synchronously here instead.
        const dim = buildDimension({
          kind: s.kind,
          firstPoint: s.firstPoint,
          secondPoint: s.secondPoint,
          dimLineOffset: s.dimLineOffset,
        })
        window.dispatchEvent(
          new CustomEvent('halofire:dimension-placed', {
            detail: { dimension: dim, sheet_id: dim.sheet_id },
          }),
        )
        return { ...INITIAL, active: true }
      })
      // Silence unused-param lint.
      void e
    }

    // Scroll-wheel nudges offset while positioning the dim line.
    const onWheel = (e: WheelEvent) => {
      setState((s) => {
        if (s.mode !== 'dim-line-position') return s
        const step = e.deltaY > 0 ? -0.05 : 0.05
        return { ...s, dimLineOffset: Math.max(0.05, s.dimLineOffset + step) }
      })
    }

    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
    document.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseup', onUp, true)
      document.removeEventListener('wheel', onWheel)
    }
  }, [state.active])

  // `commit` is referenced for external callers / tests via ref mount,
  // but pointer-up already commits inline. Keep it reachable so
  // tree-shaking doesn't wipe the export-wise behaviour.
  void commit

  if (!state.active) return null

  // Overlay preview: yellow line from firstPoint → (secondPoint ?? hover),
  // label with the measured length in ft-in.
  const canvas = canvasRef.current
  let overlay: React.ReactNode = null
  if (canvas && state.firstPoint) {
    const r = canvas.getBoundingClientRect()
    const w = canvas.clientWidth || canvas.width || 1
    const h = canvas.clientHeight || canvas.height || 1
    const toPx = (p: WorldPoint): [number, number] => [
      r.left + (p[0] / 30) * w,
      r.top + (p[2] / 30) * h,
    ]
    const b: WorldPoint | null = state.secondPoint ?? state.hover
    if (b) {
      const [x1, y1] = toPx(state.firstPoint)
      const [x2, y2] = toPx(b)
      const len_m = distance2DXZ(state.firstPoint, b)
      const label = formatDimensionText(len_m, 'ft_in', 2)
      overlay = (
        <svg
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 h-full w-full"
          viewBox={`0 0 ${typeof window !== 'undefined' ? window.innerWidth : 1920} ${typeof window !== 'undefined' ? window.innerHeight : 1080}`}
        >
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#ffd600"
            strokeWidth={1.5}
            strokeDasharray={state.secondPoint ? '' : '4 4'}
          />
          <text
            x={(x1 + x2) / 2}
            y={Math.min(y1, y2) - 8}
            textAnchor="middle"
            fill="#ffd600"
            fontFamily="JetBrains Mono, monospace"
            fontSize="12"
          >
            {label}
          </text>
        </svg>
      )
    }
  }

  return (
    <div
      data-testid="halofire-dimension-tool"
      data-mode={state.mode}
      data-kind={state.kind}
      className="pointer-events-none fixed left-0 top-0 z-[860] h-full w-full text-white"
    >
      <div className="pointer-events-auto absolute left-1/2 top-14 -translate-x-1/2 rounded-sm border border-[#ffd600]/60 bg-[#ffd600]/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em]">
        dimension · {state.kind} · {
          state.mode === 'idle'
            ? 'click first point'
            : state.mode === 'first-clicked'
              ? 'click second point'
              : 'click to place dim line · scroll to offset'
        } · Tab cycle · Esc cancel
      </div>
      {overlay}
    </div>
  )
}

// Exposed for unit tests.
export const _internals = { cycleKind, buildDimension, distance2DXZ, pxToWorld }
