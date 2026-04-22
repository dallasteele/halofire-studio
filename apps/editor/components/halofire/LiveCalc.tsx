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

  const headlineMargin = headline?.safety_margin_psi ?? null
  const marginTone: 'ok' | 'warn' | 'crit' =
    headlineMargin == null
      ? 'ok'
      : headlineMargin >= 10
        ? 'ok'
        : headlineMargin >= 0
          ? 'warn'
          : 'crit'

  return (
    <div
      data-testid="halofire-live-calc"
      style={{
        bottom: bottomOffset,
        borderRadius: 0,
        boxShadow:
          '0 10px 30px rgba(0,0,0,0.55), inset 0 1px 0 0 rgba(232,67,45,0.4)',
      }}
      className="pointer-events-auto fixed right-4 z-[800] w-[312px] border border-[var(--color-hf-edge)] bg-[var(--color-hf-surface)] text-[11px] text-[var(--color-hf-ink)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={
              'inline-block h-1.5 w-1.5 ' +
              (isCalculating
                ? 'bg-[var(--color-hf-gold)] hf-pulse-hot'
                : state.kind === 'error'
                  ? 'bg-[var(--color-hf-brick)]'
                  : snapshot
                    ? 'bg-[var(--color-hf-moss)]'
                    : 'bg-[var(--color-hf-ink-deep)]')
            }
          />
          <span className="hf-label tracking-[0.22em]">Live hydraulic</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={handleRetry}
            title="Recalculate now"
            style={{ borderRadius: 0 }}
            className="px-1.5 py-0.5 hf-label hover:bg-[var(--color-hf-surface-2)] hover:text-[var(--color-hf-paper)]"
          >
            recalc
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'expand' : 'collapse'}
            aria-label={collapsed ? 'expand' : 'collapse'}
            style={{ borderRadius: 0 }}
            className="px-1.5 py-0.5 text-[var(--color-hf-ink-mute)] hover:bg-[var(--color-hf-surface-2)] hover:text-[var(--color-hf-paper)]"
          >
            {collapsed ? '▴' : '▾'}
          </button>
          <button
            type="button"
            onClick={() => setVisible(false)}
            aria-label="close"
            style={{ borderRadius: 0 }}
            className="px-1.5 py-0.5 text-[var(--color-hf-ink-mute)] hover:bg-[var(--color-hf-surface-2)] hover:text-[var(--color-hf-paper)]"
          >
            ×
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-3 py-3">
          {state.kind === 'idle' && <EmptyState />}

          {state.kind === 'calculating' && !snapshot && (
            <div className="hf-label text-[var(--color-hf-gold)]">
              calculating…
            </div>
          )}

          {state.kind === 'error' && !snapshot && (
            <ErrorState message={friendlyError} onRetry={handleRetry} />
          )}

          {headline && (
            <>
              {/* Hero — residual pressure is the estimator's north star. */}
              <div className="pb-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="hf-label tracking-[0.22em]">Residual</span>
                  <ToneDot tone={marginTone} />
                </div>
                <div className="flex items-baseline">
                  <span
                    className="hf-hero text-[46px] text-[var(--color-hf-paper)]"
                    style={{ fontVariationSettings: '"SOFT" 30, "WONK" 0, "opsz" 144' }}
                  >
                    {headline.supply_residual_psi != null
                      ? headline.supply_residual_psi.toFixed(1)
                      : '—'}
                  </span>
                  <span className="hf-label ml-1.5 pb-1.5 text-[var(--color-hf-ink-mute)]">
                    psi
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="hf-label">Flow</span>
                  <span className="hf-num text-[13px] text-[var(--color-hf-paper)]">
                    {headline.required_flow_gpm != null
                      ? headline.required_flow_gpm.toFixed(0)
                      : '—'}
                  </span>
                  <span className="hf-label">gpm</span>
                </div>
              </div>

              {/* Status band: trigger / calc lifecycle */}
              <div className="flex items-center justify-between pb-2 hf-label">
                <span>
                  {state.kind === 'calculating'
                    ? 'recalculating…'
                    : state.kind === 'ready' && state.origin
                      ? `trigger · ${state.origin}`
                      : 'steady'}
                </span>
                <span className="hf-num text-[var(--color-hf-ink-deep)]">
                  {snapshot?.systems[0]?.id?.slice(0, 10) ?? ''}
                </span>
              </div>

              {/* Supporting readouts — 2-column compact table. */}
              <dl
                className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-[var(--color-hf-edge)] pt-2"
              >
                <Row
                  label="Static"
                  value={fmt(
                    snapshot?.systems[0]?.hydraulic?.supply_static_psi ?? null,
                    'psi',
                  )}
                />
                <Row
                  label="Base dem"
                  value={fmt(headline.demand_at_base_of_riser_psi, 'psi')}
                />
                <Row
                  label="Margin"
                  value={fmt(headline.safety_margin_psi, 'psi')}
                  tone={marginTone}
                />
                {headline.velocity_warnings > 0 && (
                  <Row
                    label="Velocity"
                    value={`${headline.velocity_warnings} warn`}
                    tone="warn"
                  />
                )}
                {bid != null && (
                  <Row
                    label="Bid"
                    value={`$${bid.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                  />
                )}
                {baselineRef.current && bid != null && (
                  <Row
                    label="Δ bid"
                    value={formatDelta(bid - baselineRef.current.bid, 0, '$')}
                    tone={bid - baselineRef.current.bid > 0 ? 'warn' : 'ok'}
                  />
                )}
                {heads != null && <Row label="Heads" value={`${heads}`} />}
                {baselineRef.current && heads != null && (
                  <Row
                    label="Δ heads"
                    value={formatDelta(
                      heads - baselineRef.current.heads, 0, '',
                    )}
                    tone={heads - baselineRef.current.heads > 0 ? 'warn' : 'ok'}
                  />
                )}
              </dl>
              {state.kind === 'error' && (
                <div className="mt-2 border-t border-[var(--color-hf-edge)] pt-2 text-[10px] text-[var(--color-hf-brick)]">
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

function ToneDot({ tone }: { tone: 'ok' | 'warn' | 'crit' }) {
  const color =
    tone === 'ok'
      ? 'var(--color-hf-moss)'
      : tone === 'warn'
        ? 'var(--color-hf-gold)'
        : 'var(--color-hf-brick)'
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5"
      style={{ background: color }}
    />
  )
}

function EmptyState() {
  return (
    <div className="space-y-1.5 text-[11px] leading-relaxed text-[var(--color-hf-ink-mute)]">
      <div className="hf-label">Awaiting geometry</div>
      <p className="text-[var(--color-hf-paper)]">
        Place sprinkler heads or run{' '}
        <span className="text-[var(--color-hf-accent)]">Auto-Design</span>.
      </p>
      <p className="text-[10.5px] text-[var(--color-hf-ink-dim)]">
        The solver reports static, residual, flow, margin, and
        velocity flags as the scene changes.
      </p>
    </div>
  )
}

function ErrorState({
  message, onRetry,
}: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-2 text-[11px] leading-relaxed">
      <div className="text-[var(--color-hf-brick)]">{message}</div>
      <button
        type="button"
        onClick={onRetry}
        style={{ borderRadius: 0 }}
        className="border border-[rgba(232,67,45,0.4)] bg-[rgba(232,67,45,0.08)] px-2 py-1 hf-label text-[var(--color-hf-accent)] hover:bg-[rgba(232,67,45,0.18)] hover:text-white"
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
  const color =
    tone === 'ok'
      ? 'var(--color-hf-moss)'
      : tone === 'warn'
        ? 'var(--color-hf-gold)'
        : tone === 'crit'
          ? 'var(--color-hf-brick)'
          : 'var(--color-hf-paper)'
  return (
    <>
      <dt className="hf-label">{label}</dt>
      <dd className="hf-num text-[11px] text-right" style={{ color }}>
        {value}
      </dd>
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
