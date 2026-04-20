'use client'

/**
 * LiveCalc — re-runs hydraulics when the scene changes.
 *
 * AutoSprink RVT advertises "real-time calculation results adjust
 * with changes to the model." Our version: debounce scene edits,
 * POST a lightweight delta to the gateway's /hydraulic endpoint,
 * render the Q/P/margin numbers in a floating card.
 *
 * Two trigger modes:
 *   1. halofire:ribbon   cmd = 'hydraulic-calc'   — explicit user
 *   2. scene-store subscribe + 1500 ms debounce  — live
 *
 * When `/hydraulic` isn't reachable (dev box without the gateway
 * running) the card shows a greyed "gateway offline" state instead
 * of crashing.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type Result = {
  required_flow_gpm?: number | null
  required_pressure_psi?: number | null
  safety_margin_psi?: number | null
  supply_static_psi?: number | null
  supply_residual_psi?: number | null
}

type State =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; result: Result; at: number }
  | { kind: 'error'; error: string; at: number }

interface Props {
  gatewayUrl?: string
  projectId?: string
  /** Disable the auto-recalc debounce, keep manual trigger only. */
  manualOnly?: boolean
  /** Debounce delay for scene-change triggered recalc. */
  debounceMs?: number
}

export function LiveCalc({
  gatewayUrl = 'http://localhost:18080',
  projectId = '1881-cooperative',
  manualOnly = false,
  debounceMs = 1500,
}: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<number | null>(null)

  const runCalc = useCallback(async () => {
    setState({ kind: 'running' })
    setVisible(true)
    try {
      const res = await fetch(
        `${gatewayUrl}/projects/${projectId}/hydraulic`,
        { method: 'POST', cache: 'no-store' },
      )
      if (!res.ok) throw new Error(`gateway ${res.status}`)
      const body = await res.json()
      const r: Result = body?.systems?.[0]?.hydraulic ?? body ?? {}
      setState({ kind: 'ok', result: r, at: Date.now() })
    } catch (e) {
      setState({ kind: 'error', error: String(e), at: Date.now() })
    }
  }, [gatewayUrl, projectId])

  // Manual trigger via ribbon command
  useEffect(() => {
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cmd?: string } | undefined
      if (detail?.cmd === 'hydraulic-calc') {
        void runCalc()
      }
    }
    window.addEventListener('halofire:ribbon', onCmd as EventListener)
    return () => window.removeEventListener('halofire:ribbon', onCmd as EventListener)
  }, [runCalc])

  // Scene-change debounce. The studio emits halofire:scene-changed
  // whenever a node is added/removed/edited; we don't enforce the
  // event here — downstream panels can dispatch it when they edit.
  useEffect(() => {
    if (manualOnly) return
    const onChange = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = window.setTimeout(() => {
        void runCalc()
        timerRef.current = null
      }, debounceMs)
    }
    window.addEventListener('halofire:scene-changed', onChange)
    return () => {
      window.removeEventListener('halofire:scene-changed', onChange)
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [manualOnly, debounceMs, runCalc])

  if (!visible) return null

  const fmt = (n: number | null | undefined, unit: string) =>
    n == null ? '—' : `${Number(n).toFixed(1)} ${unit}`

  return (
    <div
      data-testid="halofire-live-calc"
      className="pointer-events-auto fixed bottom-12 right-4 z-[800] w-[280px] rounded-sm border border-white/10 bg-[#0f0f14] p-3 font-mono text-[11px] text-white shadow-xl"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.1em] text-neutral-400">
          Live hydraulic
        </span>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="rounded px-1 text-neutral-500 hover:bg-neutral-800 hover:text-white"
          aria-label="close"
        >
          ×
        </button>
      </div>
      {state.kind === 'idle' && (
        <div className="text-neutral-500">awaiting first run</div>
      )}
      {state.kind === 'running' && (
        <div className="text-[#ffd600]">running…</div>
      )}
      {state.kind === 'ok' && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="text-neutral-400">flow</dt>
          <dd>{fmt(state.result.required_flow_gpm, 'gpm')}</dd>
          <dt className="text-neutral-400">pressure</dt>
          <dd>{fmt(state.result.required_pressure_psi, 'psi')}</dd>
          <dt className="text-neutral-400">margin</dt>
          <dd
            className={
              (state.result.safety_margin_psi ?? 0) > 0
                ? 'text-[#22c55e]'
                : 'text-[#ef4444]'
            }
          >
            {fmt(state.result.safety_margin_psi, 'psi')}
          </dd>
        </dl>
      )}
      {state.kind === 'error' && (
        <div className="text-[#ef4444]">gateway offline — {state.error}</div>
      )}
    </div>
  )
}

// Pure helpers exported for unit tests
export const _internals = {
  emitSceneChange(): void {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('halofire:scene-changed'))
  },
}
