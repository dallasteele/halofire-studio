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
 * event. This bridge subscribes to the granular events and re-fires
 * them as `halofire:scene-changed`, so any existing or future
 * live-reactive widget gets a single subscription point.
 *
 * The bridge also stamps an `origin` field onto the scene-changed
 * detail so LiveCalc can show "recalc triggered by: SKU swap" etc.
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

export function SceneChangeBridge() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handlers: Array<[string, EventListener]> = []
    for (const name of MUTATION_EVENTS) {
      const h: EventListener = (e) => {
        const origin = name.replace(/^halofire:/, '')
        window.dispatchEvent(
          new CustomEvent('halofire:scene-changed', {
            detail: { origin, at: Date.now() },
          }),
        )
      }
      window.addEventListener(name, h)
      handlers.push([name, h])
    }
    return () => {
      for (const [name, h] of handlers) {
        window.removeEventListener(name, h)
      }
    }
  }, [])
  return null
}
