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

  // Single place to commit a new visibility map
  const commit = useCallback((next: LayerVisibility) => {
    setVis(next)
    onChange?.(next)
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
        window.dispatchEvent(
          new CustomEvent('halofire:layer-visibility', { detail: next }),
        )
        return next
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onChange])

  return (
    <div
      data-testid="halofire-layer-panel"
      className="pointer-events-auto fixed right-4 top-28 z-[700] w-[220px] rounded-sm border border-white/10 bg-[#0f0f14] text-white shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-[0.1em] text-neutral-400">
          Layers
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            className="rounded-sm border border-white/10 px-1.5 text-[10px] text-neutral-400 hover:text-white"
            onClick={() => commit(setAllLayers(vis, true))}
            aria-label="show all layers"
          >
            all
          </button>
          <button
            type="button"
            className="rounded-sm border border-white/10 px-1.5 text-[10px] text-neutral-400 hover:text-white"
            onClick={() => commit(setAllLayers(vis, false))}
            aria-label="hide all layers"
          >
            none
          </button>
        </div>
      </div>
      <ul className="p-1 text-sm">
        {LAYER_DEFS.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              data-testid={`layer-toggle-${d.id}`}
              onClick={() => commit(toggleLayer(vis, d.id))}
              className={
                'flex w-full items-center justify-between rounded-sm px-2 py-1 text-xs transition-colors ' +
                (vis[d.id]
                  ? 'text-white hover:bg-neutral-900'
                  : 'text-neutral-500 hover:bg-neutral-900')
              }
            >
              <span className="flex items-center gap-2">
                <span
                  className={
                    'inline-block h-2 w-2 rounded-full ' +
                    (vis[d.id] ? 'bg-[#e8432d]' : 'bg-neutral-700')
                  }
                  aria-hidden
                />
                {d.label}
              </span>
              {d.hotkey && (
                <span className="font-mono text-[10px] text-neutral-500">
                  {d.hotkey}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
