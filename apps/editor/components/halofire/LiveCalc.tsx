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

import { ipc } from '@/lib/ipc'

type Result = {
  required_flow_gpm?: number | null
  required_pressure_psi?: number | null
  safety_margin_psi?: number | null
  supply_static_psi?: number | null
  supply_residual_psi?: number | null
  /** V2 Phase G — total bid $ and head count so the optimizer can
   * show $-delta + head-delta since the last full run. */
  bid_total_usd?: number | null
  head_count?: number | null
}

type State =
  | { kind: 'idle' }
  | { kind: 'running'; origin?: string }
  | { kind: 'ok'; result: Result; at: number; origin?: string;
      baseline?: { bid: number; heads: number } }
  | { kind: 'error'; error: string; at: number; origin?: string }

interface Props {
  /** @deprecated R10.3 — the IPC facade owns routing now; kept for
   * backward-compat with callers that still pass it, but ignored. */
  gatewayUrl?: string
  projectId?: string
  /** Disable the auto-recalc debounce, keep manual trigger only. */
  manualOnly?: boolean
  /** Debounce delay for scene-change triggered recalc. */
  debounceMs?: number
}

export function LiveCalc({
  gatewayUrl: _gatewayUrl,
  projectId = '1881-cooperative',
  manualOnly = false,
  debounceMs = 1500,
}: Props) {
  void _gatewayUrl // R10.3: prop retained for API stability, unused
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<number | null>(null)

  const baselineRef = useRef<{ bid: number; heads: number } | null>(null)

  const runCalc = useCallback(async (origin?: string) => {
    setState({ kind: 'running', origin })
    setVisible(true)
    try {
      // Hydraulic re-calc (primary). R10.3: routed through the IPC
      // facade — Tauri mode reads `design.json` from the desktop
      // shell's per-user data dir; browser/dev mode falls back to
      // `POST /projects/:id/hydraulic` against the gateway.
      const body = (await ipc.runHydraulic({ projectId })) as {
        systems?: Array<{ hydraulic?: Record<string, unknown> }>
      } & Record<string, unknown>
      const hr = (body?.systems?.[0]?.hydraulic ?? body ?? {}) as Record<
        string,
        unknown
      >
      // BOM snapshot (best-effort — if not exposed, leave nulls). R10.3:
      // routed through `ipc.readDeliverable` so the desktop shell
      // reads the summary file directly from disk.
      let bid: number | null = null
      let heads: number | null = null
      try {
        const summary = (await ipc.readDeliverable({
          projectId,
          name: 'pipeline_summary.json',
        })) as {
          steps?: Array<{
            step?: string
            total_usd?: number
            head_count?: number
          }>
        }
        const proposalStep = (summary?.steps ?? []).find(
          (s) => s?.step === 'proposal',
        )
        const bomStep = (summary?.steps ?? []).find((s) => s?.step === 'bom')
        bid = proposalStep?.total_usd ?? bomStep?.total_usd ?? null
        // head_count lives on the building or hydraulic stage
        const hstep = (summary?.steps ?? []).find(
          (s) => s?.head_count !== undefined,
        )
        heads = hstep?.head_count ?? null
      } catch {
        // non-fatal — bid/heads stay null
      }
      const result: Result = {
        ...(hr as Result),
        bid_total_usd: bid,
        head_count: heads,
      }
      // Lock baseline on the first successful run so deltas read
      // against the pre-edit snapshot.
      if (baselineRef.current === null && bid !== null && heads !== null) {
        baselineRef.current = { bid, heads }
      }
      setState({
        kind: 'ok', result, at: Date.now(), origin,
        baseline: baselineRef.current ?? undefined,
      })
    } catch (e) {
      setState({ kind: 'error', error: String(e), at: Date.now(), origin })
    }
  }, [projectId])

  // Manual trigger via ribbon command
  useEffect(() => {
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cmd?: string } | undefined
      if (detail?.cmd === 'hydraulic-calc') {
        void runCalc('manual')
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
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { origin?: string }
        | undefined
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = window.setTimeout(() => {
        void runCalc(detail?.origin)
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
        <>
          {state.origin && (
            <div className="mb-1 text-[9px] uppercase tracking-wider text-neutral-600">
              trigger: {state.origin}
            </div>
          )}
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
            {state.result.bid_total_usd != null && (
              <>
                <dt className="text-neutral-400">bid $</dt>
                <dd>
                  ${state.result.bid_total_usd.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </dd>
              </>
            )}
            {state.baseline && state.result.bid_total_usd != null && (
              <>
                <dt className="text-neutral-400">Δ bid</dt>
                <dd
                  className={
                    state.result.bid_total_usd - state.baseline.bid > 0
                      ? 'text-[#f59e0b]'
                      : 'text-[#22c55e]'
                  }
                >
                  {formatDelta(
                    state.result.bid_total_usd - state.baseline.bid, 0, '$',
                  )}
                </dd>
              </>
            )}
            {state.result.head_count != null && (
              <>
                <dt className="text-neutral-400">heads</dt>
                <dd>{state.result.head_count}</dd>
              </>
            )}
            {state.baseline && state.result.head_count != null && (
              <>
                <dt className="text-neutral-400">Δ heads</dt>
                <dd
                  className={
                    state.result.head_count - state.baseline.heads > 0
                      ? 'text-[#f59e0b]'
                      : 'text-[#22c55e]'
                  }
                >
                  {formatDelta(
                    state.result.head_count - state.baseline.heads, 0, '',
                  )}
                </dd>
              </>
            )}
          </dl>
        </>
      )}
      {state.kind === 'error' && (
        <div className="text-[#ef4444]">gateway offline — {state.error}</div>
      )}
    </div>
  )
}

function formatDelta(n: number, digits: number, prefix: string): string {
  const s = Math.abs(n).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  })
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${prefix}${s}`
}

// Pure helpers exported for unit tests
export const _internals = {
  emitSceneChange(origin?: string): void {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('halofire:scene-changed', { detail: { origin } }),
    )
  },
  formatDelta,
}
