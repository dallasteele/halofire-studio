'use client'

/**
 * TextTool — HaloFire R8.4 Pascal tool.
 *
 * Blueprint 05 §2.9. State machine:
 *   idle → placing (click anchor in viewport)
 *        → typing (inline DOM input appears at click point)
 *        → leader (optional drag to place text offset; click or Enter commits)
 *
 * Activation:
 *   - `halofire:ribbon` {cmd:'text'} event (ribbon button)
 *   - `T` key when no text field is focused
 *
 * Commit builds a schema-valid Annotation (kind defaults to 'note')
 * and dispatches `halofire:annotation-placed` with { annotation }.
 *
 * - Escape cancels at any phase.
 * - Tab cycles kind: note → callout → label → tag → zone_name → note.
 *
 * Mirrors the DimensionTool pattern from R8.2 (pxToWorld, overlay
 * SVG, `halofire:tool-active` broadcast).
 */

// Schema subpath import is intentional.
import type { Annotation } from '@pascal-app/core/schema/nodes/sheet'
import { useCallback, useEffect, useRef, useState } from 'react'

export type AnnotationKind = Annotation['kind']
export type TextToolMode = 'idle' | 'placing' | 'typing' | 'leader'

export type WorldPoint = [number, number, number]

export interface TextToolState {
  active: boolean
  mode: TextToolMode
  kind: AnnotationKind
  anchor: WorldPoint | null
  textPosMm: [number, number] | null
  text: string
  leaderMm: [number, number][]
}

const INITIAL: TextToolState = {
  active: false,
  mode: 'idle',
  kind: 'note',
  anchor: null,
  textPosMm: null,
  text: '',
  leaderMm: [],
}

const KIND_CYCLE: AnnotationKind[] = [
  'note',
  'callout',
  'label',
  'tag',
  'zone_name',
]

function cycleKind(k: AnnotationKind): AnnotationKind {
  return KIND_CYCLE[(KIND_CYCLE.indexOf(k) + 1) % KIND_CYCLE.length]!
}

function pickCanvas(): HTMLCanvasElement | null {
  return document.querySelector('canvas')
}

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

export function buildAnnotation(state: {
  kind: AnnotationKind
  anchor: WorldPoint
  textPosMm: [number, number]
  text: string
  leaderMm: [number, number][]
}): Annotation {
  const id = `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    kind: state.kind,
    text: state.text,
    anchor_model: [state.anchor[0], 0, state.anchor[2]],
    text_position_paper_mm: state.textPosMm,
    leader_polyline_mm: state.leaderMm,
    style_id: 'halofire.default',
  }
}

export const TextTool: React.FC = () => {
  const [state, setState] = useState<TextToolState>(INITIAL)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const anchorPxRef = useRef<[number, number] | null>(null)

  useEffect(() => {
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cmd?: string } | undefined
      if (detail?.cmd !== 'text') return
      setState((s) =>
        s.active ? INITIAL : { ...INITIAL, active: true, mode: 'placing' },
      )
    }
    window.addEventListener('halofire:ribbon', onCmd as EventListener)
    return () =>
      window.removeEventListener('halofire:ribbon', onCmd as EventListener)
  }, [])

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('halofire:tool-active', {
        detail: { tool: state.active ? 'text' : null },
      }),
    )
  }, [state.active])

  const reset = useCallback(() => setState({ ...INITIAL }), [])

  const commit = useCallback(() => {
    setState((s) => {
      if (!s.anchor || !s.textPosMm || !s.text) {
        return { ...INITIAL, active: true, mode: 'placing' }
      }
      const ann = buildAnnotation({
        kind: s.kind,
        anchor: s.anchor,
        textPosMm: s.textPosMm,
        text: s.text,
        leaderMm: s.leaderMm,
      })
      window.dispatchEvent(
        new CustomEvent('halofire:annotation-placed', {
          detail: { annotation: ann },
        }),
      )
      return { ...INITIAL, active: true, mode: 'placing' }
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      if (
        !state.active &&
        (e.key === 't' || e.key === 'T') &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !inField
      ) {
        e.preventDefault()
        setState({ ...INITIAL, active: true, mode: 'placing' })
        return
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

  useEffect(() => {
    if (!state.active) return

    const onDown = (e: MouseEvent) => {
      const canvas = pickCanvas()
      if (!canvas || e.target !== canvas) return
      canvasRef.current = canvas
      const r = canvas.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      const pt = pxToWorld(px, py, canvas)
      setState((s) => {
        if (s.mode === 'placing') {
          anchorPxRef.current = [px, py]
          return {
            ...s,
            mode: 'typing',
            anchor: pt,
            textPosMm: [px, py],
          }
        }
        return s
      })
    }

    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [state.active])

  useEffect(() => {
    if (state.mode === 'typing') {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [state.mode])

  const onInputKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        reset()
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      }
    },
    [commit, reset],
  )

  if (!state.active) return null

  let inputOverlay: React.ReactNode = null
  if (state.mode === 'typing' && anchorPxRef.current && canvasRef.current) {
    const r = canvasRef.current.getBoundingClientRect()
    const [px, py] = anchorPxRef.current
    const left = r.left + px + 8
    const top = r.top + py - 8
    inputOverlay = (
      <input
        ref={inputRef}
        data-testid="halofire-text-tool-input"
        value={state.text}
        onChange={(e) =>
          setState((s) => ({ ...s, text: e.target.value }))
        }
        onKeyDown={onInputKey}
        placeholder="note…"
        className="pointer-events-auto absolute rounded-sm border border-[#ffd600]/60 bg-black/80 px-2 py-1 font-mono text-[12px] text-white outline-none"
        style={{ left, top }}
      />
    )
  }

  return (
    <div
      data-testid="halofire-text-tool"
      data-mode={state.mode}
      data-kind={state.kind}
      className="pointer-events-none fixed left-0 top-0 z-[860] h-full w-full text-white"
    >
      <div className="pointer-events-auto absolute left-1/2 top-14 -translate-x-1/2 rounded-sm border border-[#ffd600]/60 bg-[#ffd600]/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em]">
        text · {state.kind} · {
          state.mode === 'placing'
            ? 'click anchor'
            : state.mode === 'typing'
              ? 'type · Enter to place · Tab cycle'
              : 'drag leader · release to commit'
        } · Esc cancel
      </div>
      {inputOverlay}
    </div>
  )
}

export const _internals = { cycleKind, buildAnnotation, pxToWorld }
