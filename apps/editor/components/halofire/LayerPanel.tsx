'use client'

/**
 * LayerPanel — AutoSprink-style layer-visibility widget.
 *
 * Shows a compact toggle list (Heads / Pipes / Walls / Zones /
 * Hangers / Obstructions / Arch trace). Click to toggle. State is
 * broadcast via `halofire:layer-visibility` CustomEvent so Pascal's
 * node renderer or any overlay can react.
 *
 * The ribbon + command palette already fire 'layer-*' commands;
 * those feed into the same reducer.
 */

import { useCallback, useEffect, useState } from 'react'
import { useHalofireBridge } from '@pascal-app/viewer/halofire'

export type LayerId =
  | 'heads'
  | 'pipes'
  | 'walls'
  | 'zones'
  | 'hangers'
  | 'obstructions'
  | 'arch'

export const LAYER_DEFS: { id: LayerId; label: string; hotkey?: string }[] = [
  { id: 'heads',        label: 'Heads',        hotkey: 'H' },
  { id: 'pipes',        label: 'Pipes',        hotkey: 'P' },
  { id: 'walls',        label: 'Walls',        hotkey: 'W' },
  { id: 'zones',        label: 'Zones',        hotkey: 'Z' },
  { id: 'hangers',      label: 'Hangers' },
  { id: 'obstructions', label: 'Obstructions' },
  { id: 'arch',         label: 'Arch trace' },
]

export type LayerVisibility = Record<LayerId, boolean>

export const DEFAULT_VISIBILITY: LayerVisibility = {
  heads: true, pipes: true, walls: true, zones: true,
  hangers: true, obstructions: false, arch: true,
}

/** Ribbon command → layer id. */
const RIBBON_TO_LAYER: Record<string, LayerId> = {
  'layer-heads': 'heads',
  'layer-pipes': 'pipes',
  'layer-walls': 'walls',
  'layer-zones': 'zones',
}

export function toggleLayer(
  current: LayerVisibility, id: LayerId,
): LayerVisibility {
  return { ...current, [id]: !current[id] }
}

export function setAllLayers(
  current: LayerVisibility, value: boolean,
): LayerVisibility {
  const out = { ...current }
  for (const k of Object.keys(out) as LayerId[]) out[k] = value
  return out
}

/** Solo: hide every other layer, keep only `id` visible. AutoSPRINK
 *  parity — V2 Phase 5.4. */
export function soloLayer(
  current: LayerVisibility, id: LayerId,
): LayerVisibility {
  const out = { ...current }
  for (const k of Object.keys(out) as LayerId[]) out[k] = (k === id)
  return out
}

export interface LayerPanelProps {
  /** Callback fires whenever any toggle lands. */
  onChange?: (next: LayerVisibility) => void
  /** Starting state (useful for tests / stories). */
  initial?: LayerVisibility
}

export function LayerPanel({
  onChange,
  initial = DEFAULT_VISIBILITY,
}: LayerPanelProps) {
  const [vis, setVis] = useState<LayerVisibility>(initial)

  // Push the initial visibility into the r3f bridge so a freshly
  // mounted viewport reflects defaults (e.g. obstructions hidden).
  useEffect(() => {
    try { useHalofireBridge.getState().setLayerVisibility(initial) } catch { /* */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Single place to commit a new visibility map
  const commit = useCallback((next: LayerVisibility) => {
    setVis(next)
    onChange?.(next)
    // Push into the r3f bridge so Pascal's viewport actually hides
    // the toggled layers.
    try {
      useHalofireBridge.getState().setLayerVisibility(next)
    } catch { /* bridge may be unmounted in tests */ }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('halofire:layer-visibility', { detail: next }),
      )
    }
  }, [onChange])

  // Ribbon / palette hooks
  useEffect(() => {
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cmd?: string } | undefined
      if (!detail?.cmd) return
      const id = RIBBON_TO_LAYER[detail.cmd]
      if (!id) return
      // Use the closure's vis via functional update to avoid races
      setVis((prev) => {
        const next = toggleLayer(prev, id)
        onChange?.(next)
        try { useHalofireBridge.getState().setLayerVisibility(next) } catch { /* */ }
        window.dispatchEvent(
          new CustomEvent('halofire:layer-visibility', { detail: next }),
        )
        return next
      })
    }
    window.addEventListener('halofire:ribbon', onCmd as EventListener)
    return () =>
      window.removeEventListener('halofire:ribbon', onCmd as EventListener)
  }, [onChange])

  // Keyboard hotkeys — H / P / W / Z (without modifiers, ignore when
  // typing in an input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const tgt = e.target as HTMLElement | null
      if (tgt && /INPUT|TEXTAREA|SELECT/.test(tgt.tagName)) return
      const k = e.key.toUpperCase()
      const match = LAYER_DEFS.find((d) => d.hotkey === k)
      if (!match) return
      setVis((prev) => {
        const next = toggleLayer(prev, match.id)
        onChange?.(next)
        try { useHalofireBridge.getState().setLayerVisibility(next) } catch { /* */ }
        window.dispatchEvent(
          new CustomEvent('halofire:layer-visibility', { detail: next }),
        )
        return next
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onChange])

  // Default-EXPANDED so the user immediately sees what the widget
  // does. Collapse on click for power users who want viewport real
  // estate back. (Tried collapsed-default — unfamiliar users couldn't
  // tell what the dot column was.) Persist choice to localStorage so
  // power users stay collapsed across reloads.
  const [open, setOpen] = useState<boolean>(true)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem('halofire:layer-panel-open')
    if (saved === '0') setOpen(false)
    else if (saved === '1') setOpen(true)
  }, [])
  const setOpenPersist = useCallback((v: boolean) => {
    setOpen(v)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('halofire:layer-panel-open', v ? '1' : '0')
    }
  }, [])

  // Auto-collapse on narrow viewports (<1024px) — the 224px panel
  // eats too much canvas on laptops. User can still manually expand.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 1024px)')
    const apply = () => { if (mq.matches) setOpen(false) }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // Hover preview for collapsed state — hovering a dot shows a
  // floating chip with the layer name + hotkey to its right so
  // users can identify each row without expanding the whole widget.
  const [hover, setHover] = useState<LayerId | null>(null)

  return (
    <div
      data-testid="halofire-layer-panel"
      // Bottom-left of the viewport, always-on-top below modals.
      // bottom-20 sits above the bottom toolbar (which lives at
      // bottom-4 / bottom-2 depending on layout); left-3 floats off
      // the sidebar without overlapping the viewport canvas.
      // backdrop-blur lets the model bleed through subtly.
      className={
        // StatusBar is h-8 (32px); sit above it with ~12px clearance.
        // bottom-11 = 44px, clears the 32px bar without touching.
        'pointer-events-auto fixed bottom-11 left-3 z-40 ' +
        'border border-white/10 border-t-[#e8432d]/60 bg-[#0a0a0b]/95 ' +
        'backdrop-blur-sm text-white ' +
        'shadow-[0_8px_24px_rgba(0,0,0,0.6)] ' +
        'transition-[width] duration-200 ease-out ' +
        (open ? 'w-[220px]' : 'w-[32px]')
      }
      style={{ borderRadius: 0 }}
    >
      {/* Header — only visible when expanded. Collapsed state has no
          header so the column reads as a pure tool, not a panel. */}
      {open && (
        <div className="flex items-center justify-between border-b border-white/8 px-2.5 py-1">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-neutral-500">
            Layers
          </span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="border border-white/10 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-neutral-400 transition-colors hover:border-[#e8432d]/40 hover:text-[#e8432d]"
              onClick={() => commit(setAllLayers(vis, true))}
              aria-label="show all layers"
              style={{ borderRadius: 0 }}
            >
              all
            </button>
            <button
              type="button"
              className="border border-white/10 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-neutral-400 transition-colors hover:border-[#e8432d]/40 hover:text-[#e8432d]"
              onClick={() => commit(setAllLayers(vis, false))}
              aria-label="hide all layers"
              style={{ borderRadius: 0 }}
            >
              none
            </button>
            <button
              type="button"
              className="ml-0.5 border border-white/10 px-1 py-0.5 font-mono text-[10px] leading-none text-neutral-400 transition-colors hover:border-[#e8432d]/40 hover:text-[#e8432d]"
              onClick={() => setOpenPersist(false)}
              aria-label="collapse layer panel"
              style={{ borderRadius: 0 }}
            >
              ‹
            </button>
          </div>
        </div>
      )}

      <ul className={open ? 'py-1' : 'flex flex-col items-center py-1'}>
        {LAYER_DEFS.map((d) => (
          <li
            key={d.id}
            className={open ? '' : 'relative w-full'}
            onMouseEnter={() => !open && setHover(d.id)}
            onMouseLeave={() => !open && setHover(null)}
          >
            <button
              type="button"
              data-testid={`layer-toggle-${d.id}`}
              onClick={(e) => {
                e.stopPropagation()
                // Alt-click → solo this layer (V2 Phase 5.4
                // AutoSPRINK parity); plain click → toggle.
                if (e.altKey) {
                  commit(soloLayer(vis, d.id))
                } else {
                  commit(toggleLayer(vis, d.id))
                }
              }}
              className={
                open
                  ? 'group flex w-full items-center justify-between border-l-2 border-transparent px-2.5 py-1 text-xs transition-colors hover:border-[#e8432d] hover:bg-white/5'
                  : 'group flex h-7 w-full items-center justify-center transition-colors hover:bg-white/5'
              }
              style={{ borderRadius: 0 }}
              aria-pressed={vis[d.id]}
              title={open ? `Click to toggle · Alt-click to solo · ${d.hotkey ? `[${d.hotkey}]` : ''}` : undefined}
            >
              <span className={open ? 'flex items-center gap-2' : ''}>
                <span
                  className={
                    'inline-block h-1.5 w-1.5 transition-colors ' +
                    (vis[d.id]
                      ? 'bg-[#e8432d] shadow-[0_0_4px_rgba(232,67,45,0.6)]'
                      : 'border border-neutral-600 bg-transparent')
                  }
                  aria-hidden
                />
                {open && (
                  <span
                    className={
                      'font-mono text-[11px] tracking-wide ' +
                      (vis[d.id] ? 'text-neutral-100' : 'text-neutral-500')
                    }
                  >
                    {d.label}
                  </span>
                )}
              </span>
              {open && d.hotkey && (
                <span className="font-mono text-[9px] uppercase tracking-wider text-neutral-600 group-hover:text-neutral-400">
                  {d.hotkey}
                </span>
              )}
            </button>

            {/* Floating tooltip when collapsed and this row hovered */}
            {!open && hover === d.id && (
              <span
                className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap border border-white/8 bg-[#0a0a0b]/95 px-2 py-1 font-mono text-[10px] tracking-wide text-neutral-200 shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
                style={{ borderRadius: 0 }}
              >
                {d.label}
                {d.hotkey && (
                  <span className="ml-2 text-neutral-500">[{d.hotkey}]</span>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* Expand affordance when collapsed — small chevron at the
          bottom of the dot column. Click ANYWHERE on the collapsed
          column expands; chevron is just a visual cue. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpenPersist(true)}
          aria-label="expand layer panel"
          className="flex w-full items-center justify-center border-t border-white/8 py-1 font-mono text-[10px] leading-none text-neutral-600 transition-colors hover:bg-white/5 hover:text-[#e8432d]"
          style={{ borderRadius: 0 }}
        >
          ›
        </button>
      )}
    </div>
  )
}
