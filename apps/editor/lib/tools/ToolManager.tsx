'use client'

/**
 * Phase B — ToolManager.
 *
 * Provides:
 *   - `useActiveTool()`  — read the active tool id + activate/deactivate
 *   - viewport pointer capture while a tool is active
 *   - cursor style swap on the <canvas>
 *   - escape-to-cancel + status-bar announce
 *   - screen-to-world projection (approximate; documented as Phase F
 *     cleanup to swap in a real r3f raycaster)
 *
 * We dispatch DOM CustomEvents (`halofire:tool-active`,
 * `halofire:toast`) so the existing StatusBar / toast consumers pick
 * up the feedback without needing to import this context.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Tool, ToolContext, ToolPointerEvent, ToolKeyEvent } from './Tool'
import { getTool, listTools } from './ToolRegistry'

interface ToolManagerAPI {
  activeId: string | null
  activeTool: Tool | null
  activate(id: string | null): void
  projectId: string
}

const ToolManagerCtx = createContext<ToolManagerAPI | null>(null)

/**
 * Approximate screen→world projection. Matches the convention the
 * existing `RemoteAreaDraw` and `ToolOverlay` use: the visible
 * viewport shows a 30 m × 30 m slice centred on the origin. A proper
 * r3f raycaster is Phase F cleanup; this gets us real tool dispatch
 * in the meantime.
 */
function screenToWorld(
  x: number,
  y: number,
  canvas: HTMLCanvasElement,
): { x: number; y: number; z: number } {
  const w = canvas.clientWidth || canvas.width || 1
  const h = canvas.clientHeight || canvas.height || 1
  // Map (0,0)→(-15,-15), (w,h)→(+15,+15) in world x/z; y (up) is
  // ceiling-ish by default (2.8 m). The manual tools caller can
  // override the y component per-tool.
  const worldX = (x / w) * 30 - 15
  const worldZ = (y / h) * 30 - 15
  return { x: worldX, y: 2.8, z: worldZ }
}

/** 0.5 m grid snap, matching the StatusBar "grid: 0.5m" default. */
function snap(p: { x: number; y: number; z: number }, step = 0.5) {
  return {
    x: Math.round(p.x / step) * step,
    y: p.y,
    z: Math.round(p.z / step) * step,
  }
}

function pickCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector('canvas')
}

export interface ToolManagerProviderProps {
  projectId: string
  children: ReactNode
}

export function ToolManagerProvider({ projectId, children }: ToolManagerProviderProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeToolRef = useRef<Tool | null>(null)

  const toast = useCallback((message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('halofire:toast', { detail: { level, message } }))
  }, [])

  const status = useCallback((message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('halofire:tool-active', {
        detail: { tool: activeId, message, level },
      }),
    )
  }, [activeId])

  const deactivate = useCallback(() => {
    setActiveId(null)
  }, [])

  const ctxForTool = useMemo<ToolContext>(
    () => ({ projectId, status, toast, deactivate }),
    [projectId, status, toast, deactivate],
  )

  const activate = useCallback(
    async (id: string | null) => {
      const prev = activeToolRef.current
      if (prev && prev.onDeactivate) {
        try { await prev.onDeactivate(ctxForTool) } catch { /* ignore */ }
      }
      if (!id) {
        activeToolRef.current = null
        setActiveId(null)
        return
      }
      const tool = getTool(id)
      if (!tool) {
        toast(`Tool "${id}" is not implemented`, 'warn')
        activeToolRef.current = null
        setActiveId(null)
        return
      }
      activeToolRef.current = tool
      setActiveId(id)
      try { if (tool.onActivate) await tool.onActivate(ctxForTool) } catch (e) {
        toast(`Tool "${id}" failed to activate: ${String(e)}`, 'error')
      }
    },
    [ctxForTool, toast],
  )

  // Announce active tool
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('halofire:tool-active', { detail: { tool: activeId } }),
    )
  }, [activeId])

  // Swap canvas cursor while a tool is active
  useEffect(() => {
    const canvas = pickCanvas()
    if (!canvas) return
    const tool = activeId ? getTool(activeId) : null
    if (tool?.cursor) {
      const prev = canvas.style.cursor
      canvas.style.cursor = tool.cursor
      return () => { canvas.style.cursor = prev }
    }
  }, [activeId])

  // Pointer + key capture
  useEffect(() => {
    if (!activeId) return
    const tool = activeToolRef.current
    if (!tool) return

    const handlePointer = (type: 'down' | 'move' | 'up') => (e: PointerEvent | MouseEvent) => {
      const canvas = pickCanvas()
      if (!canvas) return
      if (e.target !== canvas) return
      const r = canvas.getBoundingClientRect()
      const x = (e as MouseEvent).clientX - r.left
      const y = (e as MouseEvent).clientY - r.top
      const world = screenToWorld(x, y, canvas)
      const snapped = snap(world)
      const evt: ToolPointerEvent = {
        x, y, world, snapped,
        button: (e as MouseEvent).button ?? 0,
        shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey,
        raw: e,
      }
      const fn =
        type === 'down' ? tool.onPointerDown :
        type === 'move' ? tool.onPointerMove :
        tool.onPointerUp
      if (fn) void fn(evt, ctxForTool)
    }

    const onKey = (e: KeyboardEvent) => {
      // Esc always cancels
      if (e.key === 'Escape') {
        setActiveId(null)
        return
      }
      if (tool.onKeyDown) {
        const ke: ToolKeyEvent = {
          key: e.key,
          shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey,
          raw: e,
        }
        void tool.onKeyDown(ke, ctxForTool)
      }
    }

    const down = handlePointer('down')
    const move = handlePointer('move')
    const up = handlePointer('up')
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointermove', move, true)
    document.addEventListener('pointerup', up, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('pointerup', up, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [activeId, ctxForTool])

  const api = useMemo<ToolManagerAPI>(() => ({
    activeId,
    activeTool: activeId ? (getTool(activeId) ?? null) : null,
    activate,
    projectId,
  }), [activeId, activate, projectId])

  return <ToolManagerCtx.Provider value={api}>{children}</ToolManagerCtx.Provider>
}

export function useToolManager(): ToolManagerAPI {
  const ctx = useContext(ToolManagerCtx)
  if (!ctx) throw new Error('useToolManager must be used inside ToolManagerProvider')
  return ctx
}

export function useActiveTool(): { id: string | null; tool: Tool | null } {
  const { activeId, activeTool } = useToolManager()
  return { id: activeId, tool: activeTool }
}

// For tests
export const _internals = { screenToWorld, snap, listTools }
