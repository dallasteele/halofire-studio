'use client'

/**
 * V2 Phase G — Scene-change event bridge for live re-calc.
 *
 * AutoSPRINK's System Optimizer re-runs hydraulics, updates BOM, and
 * flashes cost delta whenever the user edits the model. Our studio
 * fires fine-grained CustomEvents for each kind of edit:
 *
 *   halofire:swap-sku         (HalofireProperties)
 *   halofire:isolate          (HalofireProperties)
 *   halofire:layer-visibility (LayerPanel)
 *   halofire:remote-area      (RemoteAreaDraw)
 *   halofire:auto-design-done (AutoDesignPanel)
 *
 * The LiveCalc panel listens for a single unified `scene-changed`
 * event. This bridge subscribes to the granular events and COALESCES
 * them into a single trailing `halofire:scene-changed` event per
 * debounce window (default 150ms). This bounds fan-out: a burst of N
 * rapid mutations produces exactly 1 scene-changed, regardless of N.
 *
 * Rationale for debounce (agent P1 finding, 2026-04):
 * Previously the bridge re-fired 1:1, so 3 layer toggles produced
 * 23 scene-changed events (layer-visibility fans out through
 * HalofireNodeWatcher etc.). The bound test for "≤4 events per 3
 * clicks" failed at 23. Debouncing collapses the burst.
 *
 * HalofireNodeWatcher continues to fire its own scene-changed events
 * with distinct origins ('move', 'add-head', 'remove-head') and its
 * own debounce. Those are per-NODE and meaningful on their own; this
 * bridge handles PANEL-level mutations.
 *
 * The trailing scene-changed detail carries:
 *   - origins: string[]  — unique underlying event types in the window
 *   - count:   number    — total mutations coalesced
 *   - at:      number    — timestamp of last event in the window
 *   - origin:  string    — first origin (back-compat with existing listeners)
 */

import { useEffect } from 'react'

/** Event names that should invalidate the live calc. */
export const MUTATION_EVENTS = [
  'halofire:swap-sku',
  'halofire:isolate',
  'halofire:layer-visibility',
  'halofire:remote-area',
  'halofire:auto-design-done',
  'halofire:resize-pipe',
  'halofire:add-head',
  'halofire:remove-head',
] as const

export type MutationEventName = typeof MUTATION_EVENTS[number]

/** Debounce window in ms — coalesce bursts into one trailing emit. */
export const SCENE_CHANGE_DEBOUNCE_MS = 150

export function SceneChangeBridge() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handlers: Array<[string, EventListener]> = []

    // Coalescing buffer — reset on each flush.
    let timer: ReturnType<typeof setTimeout> | null = null
    let pendingOrigins: string[] = []
    let pendingCount = 0
    let lastAt = 0

    const flush = () => {
      timer = null
      if (pendingCount === 0) return
      const origins = Array.from(new Set(pendingOrigins))
      const detail = {
        origin: origins[0] ?? 'unknown',
        origins,
        count: pendingCount,
        at: lastAt,
      }
      pendingOrigins = []
      pendingCount = 0
      lastAt = 0
      window.dispatchEvent(
        new CustomEvent('halofire:scene-changed', { detail }),
      )
    }

    for (const name of MUTATION_EVENTS) {
      const h: EventListener = () => {
        const origin = name.replace(/^halofire:/, '')
        pendingOrigins.push(origin)
        pendingCount += 1
        lastAt = Date.now()
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(flush, SCENE_CHANGE_DEBOUNCE_MS)
      }
      window.addEventListener(name, h)
      handlers.push([name, h])
    }
    return () => {
      if (timer !== null) clearTimeout(timer)
      for (const [name, h] of handlers) {
        window.removeEventListener(name, h)
      }
    }
  }, [])
  return null
}
