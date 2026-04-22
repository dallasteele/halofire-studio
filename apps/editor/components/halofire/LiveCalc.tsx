'use client'

/**
 * LiveCalc — Phase C hydraulic summary panel.
 *
 * Reads live state from `useLiveHydraulics` (SSE-driven + debounced
 * scene-change recalc) and renders the AutoSprink-parity headline
 * numbers the estimator stares at while nudging pipe sizes:
 *
 *   static / residual / demand-at-base / safety margin / flow
 *   + velocity-warning count (red flag over 20 ft/s per NFPA 13 §8)
 *
 * Phase C changes vs the pre-Phase-C version:
 *   - POSTs `/projects/:id/calculate` (not `/hydraulic`) via the IPC
 *     facade; resolves the "gateway offline — HTTP 404" screenshot.
 *   - Empty state explains what to do instead of showing "awaiting".
 *   - Errors are typed — 404 shows "backend hydraulic endpoint
 *     missing" rather than a raw stack trace.
 *   - Collapses/expands like LayerPanel, respects the status-bar
 *     height at the bottom of the viewport (measured, not guessed).
 *   - IBM Plex Mono / JetBrains Mono voice, `#0a0a0b` bg, `#e8432d`
 *     accent, no border-radius, matching the studio shell.
 *   - BOM / bid-delta block preserved from the Phase G baseline so
 *     estimators see cost movement alongside pressure movement.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ipc } from '@/lib/ipc'
import { useLiveHydraulics } from '@/lib/hooks/useLiveHydraulics'

interface Props {
  /** @deprecated R10.3 — ignored, the IPC facade owns routing now. */
  gatewayUrl?: string
  projectId?: string
  /** Pass `true` to disable the debounced auto-recalc. */
  manualOnly?: boolean
  /** Debounce window for scene-change → recalc (default 300 ms). */
  debounceMs?: number
}

/** Status-bar measurement fallback when we can't read the DOM. */
const STATUSBAR_FALLBACK_PX = 32

export function LiveCalc({
  gatewayUrl: _gatewayUrl,
  projectId = '1881-cooperative',
  manualOnly = false,
  debounceMs = 300,
}: Props) {
  void _gatewayUrl
  const {
    state,
    snapshot,
    isCalculating,
    error,
    run,
  } = useLiveHydraulics({
    projectId,
    debounceMs,
    disableSse: manualOnly,
    runOnMount: !manualOnly,
  })

  const [visible, setVisible] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [bottomOffset, setBottomOffset] = useState(STATUSBAR_FALLBACK_PX + 8)

  // BOM / bid — rendered when the deliverables sidecar has them.
  const [bid, setBid] = useState<number | null>(null)
  const [heads, setHeads] = useState<number | null>(null)
  const baselineRef = useRef<{ bid: number; heads: number } | null>(null)

  // Measure the real status-bar height so the panel never clips.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const measure = () => {
      const sb = document.querySelector<HTMLDivElement>(
        '[data-testid="halofire-status-bar"]',
      )
      const h = sb?.getBoundingClientRect().height ?? STATUSBAR_FALLBACK_PX
      setBottomOffset(Math.round(h) + 8)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Best-effort BOM read — silent on failure. Keyed by the ready
  // timestamp so a new calc refreshes the BOM sidecar; stored on a
  // local to keep the effect dep list typed.
  const readyAt = state.kind === 'ready' ? state.at : 0
  useEffect(() => {
    if (!readyAt) return
    let cancelled = false
    void (async () => {
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
        if (cancelled) return
        const proposalStep = summary?.steps?.find((s) => s?.step === 'proposal')
        const bomStep = summary?.steps?.find((s) => s?.step === 'bom')
        const hStep = summary?.steps?.find((s) => s?.head_count !== undefined)
        const newBid = proposalStep?.total_usd ?? bomStep?.total_usd ?? null
        const newHeads = hStep?.head_count ?? null
        setBid(newBid)
        setHeads(newHeads)
        if (
          baselineRef.current === null
          && newBid !== null
          && newHeads !== null
        ) {
          baselineRef.current = { bid: newBid, heads: newHeads }
        }
      } catch {
        /* deliverable not present — skip silently */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [readyAt, projectId])

  // Manual ribbon trigger.
  useEffect(() => {
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cmd?: string } | undefined
      if (detail?.cmd === 'hydraulic-calc') {
        setVisible(true)
        setCollapsed(false)
        void run('manual')
      }
    }
    window.addEventListener('halofire:ribbon', onCmd as EventListener)
    return () =>
      window.removeEventListener('halofire:ribbon', onCmd as EventListener)
  }, [run])

  const friendlyError = useMemo(() => friendly(error), [error])

  const handleRetry = useCallback(() => {
    void run('retry')
  }, [run])

  if (!visible) return null

  const headline = snapshot?.headline ?? null

  return (
    <div
      data-testid="halofire-live-calc"
      style={{ bottom: bottomOffset }}
      className="pointer-events-auto fixed right-4 z-[800] w-[300px] border border-white/10 bg-[#0a0a0b] text-[11px] text-neutral-100 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 bg-[#0c0c10] px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={
              'inline-block h-2 w-2 ' +
              (isCalculating
                ? 'animate-pulse bg-[#ffb800]'
                : state.kind === 'error'
                  ? 'bg-[#ff3333]'
                  : snapshot
                    ? 'bg-[#4af626]'
                    : 'bg-neutral-600')
            }
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-300">
            Live hydraulic
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleRetry}
            title="Recalculate now"
            className="px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-400 hover:bg-neutral-800 hover:text-white"
          >
            recalc
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'expand' : 'collapse'}
            className="px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
            aria-label={collapsed ? 'expand' : 'collapse'}
          >
            {collapsed ? '▴' : '▾'}
          </button>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
            aria-label="close"
          >
            ×
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-3 font-mono">
          {state.kind === 'idle' && (
            <EmptyState />
          )}

          {state.kind === 'calculating' && !snapshot && (
            <div className="text-[#ffb800]">calculating…</div>
          )}

          {state.kind === 'error' && !snapshot && (
            <ErrorState message={friendlyError} onRetry={handleRetry} />
          )}

          {headline && (
            <>
              {state.kind === 'calculating' && (
                <div className="mb-1 text-[9px] uppercase tracking-wider text-[#ffb800]">
                  recalculating…
                </div>
              )}
              {state.kind === 'ready' && state.origin && (
                <div className="mb-1 text-[9px] uppercase tracking-wider text-neutral-600">
                  trigger · {state.origin}
                </div>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <Row
                  label="static"
                  value={fmt(
                    snapshot?.systems[0]?.hydraulic?.supply_static_psi ?? null,
                    'psi',
                  )}
                />
                <Row
                  label="residual"
                  value={fmt(headline.supply_residual_psi, 'psi')}
                />
                <Row
                  label="base demand"
                  value={fmt(headline.demand_at_base_of_riser_psi, 'psi')}
                />
                <Row
                  label="flow"
                  value={fmt(headline.required_flow_gpm, 'gpm')}
                />
                <Row
                  label="margin"
                  value={fmt(headline.safety_margin_psi, 'psi')}
                  tone={
                    (headline.safety_margin_psi ?? 0) >= 10
                      ? 'ok'
                      : (headline.safety_margin_psi ?? 0) >= 0
                        ? 'warn'
                        : 'crit'
                  }
                />
                {headline.velocity_warnings > 0 && (
                  <Row
                    label="velocity"
                    value={`${headline.velocity_warnings} warning${headline.velocity_warnings === 1 ? '' : 's'}`}
                    tone="warn"
                  />
                )}
                {bid != null && (
                  <Row
                    label="bid $"
                    value={`$${bid.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                  />
                )}
                {baselineRef.current && bid != null && (
                  <Row
                    label="Δ bid"
                    value={formatDelta(bid - baselineRef.current.bid, 0, '$')}
                    tone={
                      bid - baselineRef.current.bid > 0 ? 'warn' : 'ok'
                    }
                  />
                )}
                {heads != null && <Row label="heads" value={`${heads}`} />}
                {baselineRef.current && heads != null && (
                  <Row
                    label="Δ heads"
                    value={formatDelta(
                      heads - baselineRef.current.heads, 0, '',
                    )}
                    tone={
                      heads - baselineRef.current.heads > 0 ? 'warn' : 'ok'
                    }
                  />
                )}
              </dl>
              {state.kind === 'error' && (
                <div className="mt-2 border-t border-white/5 pt-2 text-[10px] text-[#ff3333]">
                  last recalc failed — {friendlyError}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="space-y-1 text-[11px] leading-snug text-neutral-400">
      <div className="text-neutral-200">No hydraulic data yet</div>
      <div>
        Run <span className="text-[#e8432d]">Auto-Design</span> or place
        sprinkler heads to populate the solver.
      </div>
    </div>
  )
}

function ErrorState({
  message, onRetry,
}: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-2">
      <div className="text-[#ff3333]">{message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="border border-[#e8432d]/40 bg-[#e8432d]/10 px-2 py-1 text-[10px] uppercase tracking-wider text-[#ffb4a6] hover:bg-[#e8432d]/20 hover:text-white"
      >
        retry
      </button>
    </div>
  )
}

function Row({
  label, value, tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'ok' | 'warn' | 'crit'
}) {
  const cls =
    tone === 'ok'
      ? 'text-[#4af626]'
      : tone === 'warn'
        ? 'text-[#ffb800]'
        : tone === 'crit'
          ? 'text-[#ff3333]'
          : 'text-neutral-100'
  return (
    <>
      <dt className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd className={cls}>{value}</dd>
    </>
  )
}

function fmt(n: number | null | undefined, unit: string): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${Number(n).toFixed(1)} ${unit}`
}

function formatDelta(n: number, digits: number, prefix: string): string {
  const s = Math.abs(n).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  })
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${prefix}${s}`
}

function friendly(message: string | null): string {
  if (!message) return ''
  if (/HTTP 404/i.test(message)) {
    return 'backend hydraulic endpoint missing — is the gateway running Phase A (/calculate)?'
  }
  if (/HTTP 5\d\d/i.test(message)) {
    return 'solver error — the gateway logged an exception. Check server console.'
  }
  if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(message)) {
    return 'gateway offline — start `halopenclaw-gateway` on :18080.'
  }
  // Strip long stack-trace-ish tails.
  return message.length > 160 ? `${message.slice(0, 160)}…` : message
}

// Pure helpers exported for unit tests.
export const _internals = {
  emitSceneChange(origin?: string): void {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('halofire:scene-changed', { detail: { origin } }),
    )
  },
  formatDelta,
  friendly,
}
