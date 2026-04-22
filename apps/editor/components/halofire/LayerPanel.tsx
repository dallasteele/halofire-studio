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
      // StatusBar is now exactly 28px; sit above with a 12px gap.
      className={
        'pointer-events-auto fixed bottom-10 left-3 z-40 ' +
        'border border-[var(--color-hf-edge)] ' +
        'bg-[var(--color-hf-surface)]/95 backdrop-blur-sm ' +
        'text-[var(--color-hf-ink)] ' +
        'shadow-[0_10px_30px_rgba(0,0,0,0.55)] ' +
        'transition-[width] duration-200 ease-out ' +
        (open ? 'w-[220px]' : 'w-[32px]')
      }
      style={{
        borderRadius: 0,
        // Drafting-style red-orange rule on the top edge — signals
        // "active tool surface".
        boxShadow:
          '0 10px 30px rgba(0,0,0,0.55), inset 0 1px 0 0 rgba(232,67,45,0.45)',
      }}
    >
      {open && (
        <div className="flex items-center justify-between border-b border-[var(--color-hf-edge)] px-2.5 py-1.5">
          <span className="hf-label tracking-[0.22em]">Layers</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="border border-[var(--color-hf-edge)] px-1 py-0.5 hf-label hover:border-[var(--color-hf-accent)] hover:text-[var(--color-hf-paper)]"
              onClick={() => commit(setAllLayers(vis, true))}
              aria-label="show all layers"
              style={{ borderRadius: 0 }}
            >
              all
            </button>
            <button
              type="button"
              className="border border-[var(--color-hf-edge)] px-1 py-0.5 hf-label hover:border-[var(--color-hf-accent)] hover:text-[var(--color-hf-paper)]"
              onClick={() => commit(setAllLayers(vis, false))}
              aria-label="hide all layers"
              style={{ borderRadius: 0 }}
            >
              none
            </button>
            <button
              type="button"
              className="ml-0.5 border border-[var(--color-hf-edge)] px-1 py-0.5 text-[10px] leading-none text-[var(--color-hf-ink-mute)] hover:border-[var(--color-hf-accent)] hover:text-[var(--color-hf-paper)]"
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
                if (e.altKey) {
                  commit(soloLayer(vis, d.id))
                } else {
                  commit(toggleLayer(vis, d.id))
                }
              }}
              className={
                open
                  ? 'group flex w-full items-center justify-between border-l-2 border-transparent px-2.5 py-1.5 transition-colors hover:border-[var(--color-hf-accent)] hover:bg-white/[0.03]'
                  : 'group flex h-7 w-full items-center justify-center transition-colors hover:bg-white/[0.03]'
              }
              style={{ borderRadius: 0 }}
              aria-pressed={vis[d.id]}
              title={open ? `Click to toggle · Alt-click to solo · ${d.hotkey ? `[${d.hotkey}]` : ''}` : undefined}
            >
              <span className={open ? 'flex items-center gap-2.5' : ''}>
                <span
                  className={
                    'inline-block h-1.5 w-1.5 transition-colors ' +
                    (vis[d.id]
                      ? 'bg-[var(--color-hf-accent)] shadow-[0_0_6px_rgba(232,67,45,0.55)]'
                      : 'border border-[var(--color-hf-ink-deep)] bg-transparent')
                  }
                  aria-hidden
                />
                {open && (
                  <span
                    className={
                      'font-[var(--font-plex)] text-[11px] tracking-[0.04em] ' +
                      (vis[d.id]
                        ? 'text-[var(--color-hf-paper)]'
                        : 'text-neutral-500')
                    }
                  >
                    {d.label}
                  </span>
                )}
              </span>
              {open && d.hotkey && (
                <span className="hf-num text-[9px] uppercase tracking-wider text-[var(--color-hf-ink-deep)] group-hover:text-[var(--color-hf-ink-mute)]">
                  {d.hotkey}
                </span>
              )}
            </button>

            {!open && hover === d.id && (
              <span
                className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap border border-[var(--color-hf-edge)] bg-[var(--color-hf-surface)]/95 px-2 py-1 font-[var(--font-plex)] text-[10px] tracking-wide text-[var(--color-hf-paper)] shadow-[0_2px_8px_rgba(0,0,0,0.55)]"
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

      {!open && (
        <button
          type="button"
          onClick={() => setOpenPersist(true)}
          aria-label="expand layer panel"
          className="flex w-full items-center justify-center border-t border-[var(--color-hf-edge)] py-1 text-[10px] leading-none text-[var(--color-hf-ink-deep)] transition-colors hover:bg-white/[0.03] hover:text-[var(--color-hf-accent)]"
          style={{ borderRadius: 0 }}
        >
          ›
        </button>
      )}
    </div>
  )
}
