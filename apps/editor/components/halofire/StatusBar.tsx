'use client'

/**
 * StatusBar — CAD command line.
 *
 * Exactly 28px tall (h-7). No padding tricks, no wrap. Reads
 * peripherally while the estimator drafts — pressure, flow, velocity
 * flags, gateway health, clock. The estimator never looks at this
 * directly; it just stops seeing numbers change when something's
 * wrong. That's the job.
 *
 * Earthen palette: within-spec = moss, caution = gold, violation =
 * brick. No neon reds, no hazard yellows — we're imitating an
 * engineering drawing's title block, not a dashboard.
 */

import { useEffect, useState } from 'react'

export interface StatusBarProps {
  projectName?: string
  projectAddress?: string
  gatewayUrl?: string
  sceneNodeCount?: number
  hydraulics?: {
    pressure_psi: number | null
    flow_gpm: number | null
    margin_psi: number | null
    velocity_warnings: number
  } | null
}

type Gateway = { ok: boolean; latency_ms?: number; err?: string }

async function probe(url: string): Promise<Gateway> {
  const t0 = performance.now()
  try {
    const res = await fetch(url, { cache: 'no-store' })
    const latency_ms = Math.round(performance.now() - t0)
    return { ok: res.ok, latency_ms }
  } catch (e) {
    return { ok: false, err: String(e) }
  }
}

export function StatusBar({
  projectName = '—',
  projectAddress = '',
  gatewayUrl = 'http://localhost:18080/health',
  sceneNodeCount,
  hydraulics,
}: StatusBarProps) {
  const [gateway, setGateway] = useState<Gateway | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      const g = await probe(gatewayUrl)
      if (!cancelled) setGateway(g)
    }
    tick()
    const iv = setInterval(tick, 15_000)
    const clockIv = setInterval(() => setNow(new Date()), 60_000)
    return () => {
      cancelled = true
      clearInterval(iv)
      clearInterval(clockIv)
    }
  }, [gatewayUrl])

  const ok = gateway?.ok === true
  const dotColor = ok
    ? 'var(--color-hf-moss)'
    : 'var(--color-hf-brick)'

  return (
    <div
      data-testid="halofire-status-bar"
      // Exactly 28px — zero padding tricks.
      style={{ height: 28 }}
      className="flex w-full items-center gap-3 border-t border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)] px-3 font-[var(--font-plex)] text-[10.5px] leading-none text-[var(--color-hf-ink-mute)]"
    >
      {/* Gateway ping */}
      <span className="flex items-center gap-1.5">
        <span
          style={{ background: dotColor, borderRadius: 0 }}
          className="inline-block h-1.5 w-1.5"
          title={ok ? 'gateway online' : 'gateway offline'}
        />
        <Label>Gateway</Label>
        <Value tone={ok ? 'default' : 'crit'}>
          {ok ? 'online' : 'offline'}
        </Value>
        {ok && gateway?.latency_ms !== undefined && (
          <span className="hf-num text-[var(--color-hf-ink-deep)]">
            {gateway.latency_ms}
            <span className="ml-0.5 hf-label">ms</span>
          </span>
        )}
      </span>
      <Tick />

      {/* Project context */}
      <span className="flex min-w-0 items-center gap-1.5 truncate">
        <Label>Job</Label>
        <span className="truncate text-[var(--color-hf-paper)]">
          {projectName}
        </span>
        {projectAddress && (
          <span className="truncate text-[var(--color-hf-ink-deep)]">
            · {projectAddress}
          </span>
        )}
      </span>

      {sceneNodeCount !== undefined && (
        <>
          <Tick />
          <span className="flex items-center gap-1.5">
            <Label>Nodes</Label>
            <span className="hf-num text-[var(--color-hf-ink)]">
              {sceneNodeCount}
            </span>
          </span>
        </>
      )}

      {hydraulics && (
        <>
          <Tick />
          <span
            data-testid="status-hydraulics"
            className="flex items-center gap-3"
          >
            <Metric
              label="P-res"
              value={hydraulics.pressure_psi}
              unit="psi"
              digits={0}
            />
            <Metric
              label="Flow"
              value={hydraulics.flow_gpm}
              unit="gpm"
              digits={0}
            />
            {hydraulics.velocity_warnings > 0 && (
              <span
                data-testid="status-velocity-warn"
                className="flex items-center gap-1 text-[var(--color-hf-gold)]"
              >
                <span
                  className="inline-block h-1.5 w-1.5"
                  style={{ background: 'var(--color-hf-gold)' }}
                />
                <Label>vel</Label>
                <span className="hf-num">{hydraulics.velocity_warnings}</span>
              </span>
            )}
            {hydraulics.margin_psi != null && hydraulics.margin_psi < 0 && (
              <span className="flex items-center gap-1 text-[var(--color-hf-brick)]">
                <span
                  className="inline-block h-1.5 w-1.5 hf-pulse-hot"
                  style={{ background: 'var(--color-hf-brick)' }}
                />
                <Label>margin</Label>
                <span className="hf-num">
                  {hydraulics.margin_psi.toFixed(1)}
                </span>
                <span className="hf-label">psi</span>
              </span>
            )}
          </span>
        </>
      )}

      {/* Right-edge modes — always present, peripheral. */}
      <span className="ml-auto flex items-center gap-3 text-[var(--color-hf-ink-deep)]">
        <span className="flex items-center gap-1">
          <Label>units</Label>
          <span className="hf-num text-[var(--color-hf-ink-mute)]">m</span>
        </span>
        <span className="flex items-center gap-1">
          <Label>grid</Label>
          <span className="hf-num text-[var(--color-hf-ink-mute)]">
            0.5<span className="hf-label">m</span>
          </span>
        </span>
        <span className="flex items-center gap-1">
          <Label>snap</Label>
          <span className="text-[var(--color-hf-moss)]">on</span>
        </span>
        <span className="hf-num text-[var(--color-hf-ink-deep)]">
          {now.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </span>
    </div>
  )
}

function Tick() {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-px bg-[var(--color-hf-edge-strong)]"
    />
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="hf-label tracking-[0.2em]">
      {children}
    </span>
  )
}

function Value({
  children,
  tone = 'default',
}: {
  children: React.ReactNode
  tone?: 'default' | 'warn' | 'crit'
}) {
  const color =
    tone === 'crit'
      ? 'var(--color-hf-brick)'
      : tone === 'warn'
        ? 'var(--color-hf-gold)'
        : 'var(--color-hf-paper)'
  return (
    <span style={{ color }} className="uppercase tracking-wider">
      {children}
    </span>
  )
}

function Metric({
  label,
  value,
  unit,
  digits,
}: {
  label: string
  value: number | null
  unit: string
  digits: number
}) {
  return (
    <span className="flex items-baseline gap-1">
      <Label>{label}</Label>
      <span className="hf-num text-[var(--color-hf-paper)]">
        {value != null ? value.toFixed(digits) : '—'}
      </span>
      <span className="hf-label">{unit}</span>
    </span>
  )
}
