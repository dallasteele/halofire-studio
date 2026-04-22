'use client'

/**
 * RevisionCloudTool — HaloFire R8.5 Pascal tool.
 *
 * Blueprint 05 §2.10. State machine:
 *   idle → drawing (user drags freehand polyline over viewport)
 *        → numbering (auto-assign bubble_number, prompt note)
 *
 * Activation:
 *   - `halofire:ribbon` {cmd:'revision-cloud'} event (ribbon button)
 *   - `Shift+R` key when no text field is focused
 *
 * On commit builds a schema-valid RevisionCloud and dispatches
 * `halofire:revision-cloud-placed` with { revision_cloud }.
 *
 * The cloud is rendered as a simple polyline SVG preview during
 * drag; scalloped decoration is post-1.0 (matches blueprint note).
 * A module-level counter auto-increments bubble_number each commit.
 */

// Schema subpath import is intentional.
import type { RevisionCloud } from '@pascal-app/core/schema/nodes/sheet'
import { useCallback, useEffect, useRef, useState } from 'react'

export type RevisionCloudMode = 'idle' | 'drawing' | 'numbering'

export type WorldPoint = [number, number, number]

export interface RevisionCloudToolState {
  active: boolean
  mode: RevisionCloudMode
  /** Polyline in world-xz (metres) captured during drag. */
  polyline: [number, number][]
  note: string
}

const INITIAL: RevisionCloudToolState = {
  active: false,
  mode: 'idle',
  polyline: [],
  note: '',
}

/** Module-scoped auto-incrementing bubble number. */
let NEXT_BUBBLE = 1

export function _resetBubbleCounter(): void {
  NEXT_BUBBLE = 1
}

function pickCanvas(): HTMLCanvasElement | null {
  return document.querySelector('canvas')
}

function pxToWorld2D(
  px: number,
  py: number,
  canvas: HTMLCanvasElement,
): [number, number] {
  const w = canvas.clientWidth || canvas.width || 1
  const h = canvas.clientHeight || canvas.height || 1
  return [(px / w) * 30, (py / h) * 30]
}

/** Build a RevisionCloud record from tool state. */
export function buildRevisionCloud(state: {
  polyline: [number, number][]
  note: string
}): RevisionCloud {
  const id = `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const bubble_number = NEXT_BUBBLE++
  return {
    id,
    revision_id: 'current',
    polyline_m: state.polyline,
    bubble_number,
    note: state.note,
    status: 'open',
  }
}

export const RevisionCloudTool: React.FC = () => {
  const [state, setState] = useState<RevisionCloudToolState>(INITIAL)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const draggingRef = useRef(false)
  const polylinePxRef = useRef<[number, number][]>([])
  const noteInputRef = useRef<HTMLInputElement | null>(null)

  // Ribbon trigger.
  useEffect(() => {
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cmd?: string } | undefined
      if (detail?.cmd !== 'revision-cloud') return
      setState((s) => (s.active ? INITIAL : { ...INITIAL, active: true }))
    }
    window.addEventListener('halofire:ribbon', onCmd as EventListener)
    return () =>
      window.removeEventListener('halofire:ribbon', onCmd as EventListener)
  }, [])

  // Announce tool-active.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('halofire:tool-active', {
        detail: { tool: state.active ? 'revision-cloud' : null },
      }),
    )
  }, [state.active])

  const reset = useCallback(() => {
    polylinePxRef.current = []
    draggingRef.current = false
    setState({ ...INITIAL })
  }, [])

  const commitWithNote = useCallback((note: string) => {
    setState((s) => {
      if (s.polyline.length < 2) return { ...INITIAL, active: true }
      const cloud = buildRevisionCloud({
        polyline: s.polyline,
        note,
      })
      window.dispatchEvent(
        new CustomEvent('halofire:revision-cloud-placed', {
          detail: { revision_cloud: cloud },
        }),
      )
      polylinePxRef.current = []
      return { ...INITIAL, active: true }
    })
  }, [])

  // Keyboard: Shift+R activates, Esc cancels.
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
        e.shiftKey &&
        (e.key === 'R' || e.key === 'r') &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !inField
      ) {
        e.preventDefault()
        setState({ ...INITIAL, active: true })
        return
      }
      if (!state.active) return
      if (e.key === 'Escape') {
        e.preventDefault()
        reset()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.active, reset])

  // Pointer state machine: drag records polyline.
  useEffect(() => {
    if (!state.active) return

    const onDown = (e: MouseEvent) => {
      const canvas = pickCanvas()
      if (!canvas || e.target !== canvas) return
      canvasRef.current = canvas
      const r = canvas.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      draggingRef.current = true
      polylinePxRef.current = [[px, py]]
      setState((s) =>
        s.mode === 'idle'
          ? {
              ...s,
              mode: 'drawing',
              polyline: [pxToWorld2D(px, py, canvas)],
            }
          : s,
      )
    }

    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      const canvas = canvasRef.current ?? pickCanvas()
      if (!canvas) return
      const r = canvas.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      polylinePxRef.current.push([px, py])
      setState((s) => {
        if (s.mode !== 'drawing') return s
        return {
          ...s,
          polyline: [...s.polyline, pxToWorld2D(px, py, canvas)],
        }
      })
    }

    const onUp = (_e: MouseEvent) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      setState((s) => {
        if (s.mode !== 'drawing') return s
        // If the user barely dragged, still transition; the numbering
        // input will reject zero-length polylines at commit time.
        return { ...s, mode: 'numbering' }
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
  }, [state.active])

  // Focus the note input when numbering phase starts.
  useEffect(() => {
    if (state.mode === 'numbering') {
      requestAnimationFrame(() => noteInputRef.current?.focus())
    }
  }, [state.mode])

  const onNoteKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        reset()
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        commitWithNote(state.note)
      }
    },
    [commitWithNote, reset, state.note],
  )

  if (!state.active) return null

  // SVG preview: simple polyline while drawing / numbering.
  let preview: React.ReactNode = null
  if (polylinePxRef.current.length > 1 && canvasRef.current) {
    const r = canvasRef.current.getBoundingClientRect()
    const pts = polylinePxRef.current
      .map(([x, y]) => `${r.left + x},${r.top + y}`)
      .join(' ')
    preview = (
      <svg
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 h-full w-full"
        viewBox={`0 0 ${typeof window !== 'undefined' ? window.innerWidth : 1920} ${typeof window !== 'undefined' ? window.innerHeight : 1080}`}
      >
        <polyline
          points={pts}
          stroke="#ff3333"
          strokeWidth={1.5}
          fill="none"
          strokeDasharray={state.mode === 'drawing' ? '4 4' : ''}
        />
      </svg>
    )
  }

  let noteOverlay: React.ReactNode = null
  if (state.mode === 'numbering') {
    noteOverlay = (
      <div className="pointer-events-auto absolute left-1/2 top-24 -translate-x-1/2 rounded-sm border border-[#ff3333]/60 bg-black/80 px-3 py-2">
        <input
          ref={noteInputRef}
          data-testid="halofire-revision-cloud-note"
          value={state.note}
          onChange={(e) =>
            setState((s) => ({ ...s, note: e.target.value }))
          }
          onKeyDown={onNoteKey}
          placeholder="revision note…"
          className="rounded-sm bg-transparent px-2 py-1 font-mono text-[12px] text-white outline-none"
        />
      </div>
    )
  }

  return (
    <div
      data-testid="halofire-revision-cloud-tool"
      data-mode={state.mode}
      className="pointer-events-none fixed left-0 top-0 z-[860] h-full w-full text-white"
    >
      <div className="pointer-events-auto absolute left-1/2 top-14 -translate-x-1/2 rounded-sm border border-[#ff3333]/60 bg-[#ff3333]/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em]">
        revision cloud · {
          state.mode === 'idle'
            ? 'drag to draw'
            : state.mode === 'drawing'
              ? 'release to finish'
              : 'type note · Enter to commit'
        } · Esc cancel
      </div>
      {preview}
      {noteOverlay}
    </div>
  )
}

// Exposed for unit tests.
export const _internals = { buildRevisionCloud, pxToWorld2D }
