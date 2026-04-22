'use client'

/**
 * ProjectContextHeader — the always-visible bid context block.
 *
 * Phase G redesign: this is the piece every sidebar panel sits
 * beneath. The bid total is the loudest element on screen — it's
 * the single number the estimator is ultimately paid for. Fraunces
 * at 32–40px, tightly tracked, with `$` and the `BID TOTAL` label
 * in quiet Plex small-caps.
 *
 * Gateway status is a CALM inline chip — not a red alarm band.
 * Empty states speak in prose; no stack traces, no giant red boxes
 * dominating what should be a tool surface.
 */

import { useState } from 'react'
import { useGatewayHealth } from './useGatewayHealth'

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18080'

interface ActiveProject {
  projectId: string
  name: string
  address: string
  price: number
}

const DEFAULT_PROJECT: ActiveProject = {
  projectId: '1881-cooperative',
  name: 'The Cooperative 1881 — Phase I',
  address: '1881 W North Temple, Salt Lake City, UT',
  price: 538792,
}

export function ProjectContextHeader() {
  const gw = useGatewayHealth()
  const [project] = useState<ActiveProject>(DEFAULT_PROJECT)
  const [showHelp, setShowHelp] = useState(false)

  const offline = gw.status === 'offline'
  const checking = gw.status === 'checking'

  return (
    <div className="relative bg-[var(--color-hf-bg)] border-b border-[var(--color-hf-edge)]">
      {/* Hero block — the numbers that matter. */}
      <div className="px-3 py-3">
        {/* Label row */}
        <div className="flex items-center gap-2 pb-1.5">
          <div
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center border border-[rgba(232,67,45,0.5)] text-[10px] font-semibold tracking-wider text-[var(--color-hf-accent)]"
            style={{
              borderRadius: 0,
              background:
                'linear-gradient(180deg, rgba(232,67,45,0.15), rgba(232,67,45,0.04))',
              fontFamily: 'var(--font-fraunces), serif',
              fontStyle: 'italic',
            }}
          >
            hf
          </div>
          <span className="hf-label tracking-[0.22em]">Active bid</span>
          <span className="ml-auto hf-label tracking-[0.22em]">
            {project.projectId}
          </span>
        </div>

        {/* Project line */}
        <div className="min-w-0 pb-3">
          <p
            className="truncate text-[13px] font-medium tracking-tight text-[var(--color-hf-paper)]"
            title={project.name}
          >
            {project.name}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-[var(--color-hf-ink-dim)]">
            {project.address}
          </p>
        </div>

        {/* Bid total — hero treatment. */}
        <div className="flex items-end justify-between gap-2 pb-1">
          <div className="hf-label tracking-[0.24em]">Bid total</div>
          <div className="flex items-baseline">
            <span
              className="hf-num text-[11px] text-[var(--color-hf-ink-dim)] pr-1"
              aria-hidden
            >
              $
            </span>
            <span
              className="hf-hero text-[34px] text-[var(--color-hf-accent)]"
              style={{
                fontVariationSettings: '"SOFT" 30, "WONK" 0, "opsz" 144',
              }}
            >
              {project.price.toLocaleString()}
            </span>
          </div>
        </div>
        {/* Thin accent rule under the hero figure */}
        <div
          aria-hidden
          className="h-px w-full"
          style={{
            background:
              'linear-gradient(to right, rgba(232,67,45,0.6), rgba(232,67,45,0.05))',
          }}
        />
      </div>

      {/* Service health — calm inline chip, never a red alarm band. */}
      <div className="flex items-center gap-2 border-t border-[var(--color-hf-edge)] px-3 py-1.5">
        <GatewayDot status={offline ? 'offline' : checking ? 'checking' : 'online'} />
        <span className="hf-label tracking-[0.22em]">halopenclaw</span>
        <span
          className="text-[10px] leading-none"
          style={{
            color: offline
              ? 'var(--color-hf-brick)'
              : checking
                ? 'var(--color-hf-gold)'
                : 'var(--color-hf-moss)',
          }}
        >
          {offline ? 'offline' : checking ? 'checking…' : 'online'}
        </span>
        {!offline && !checking && gw.tools.length > 0 && (
          <span className="hf-num text-[10px] text-[var(--color-hf-ink-deep)]">
            · {gw.tools.length}
            <span className="ml-0.5 hf-label">tools</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {offline && (
            <>
              <button
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                className="hf-label underline decoration-dotted underline-offset-2 hover:text-[var(--color-hf-paper)]"
              >
                {showHelp ? 'hide' : 'help'}
              </button>
              <button
                type="button"
                onClick={gw.retry}
                className="border border-[var(--color-hf-edge)] px-1.5 py-0.5 hf-label hover:border-[var(--color-hf-accent)] hover:text-[var(--color-hf-paper)]"
                style={{ borderRadius: 0 }}
              >
                retry
              </button>
            </>
          )}
        </div>
      </div>

      {/* Help drawer — opt-in, quiet prose. No red banner. */}
      {offline && showHelp && (
        <div className="border-t border-[var(--color-hf-edge)] bg-[var(--color-hf-surface)] px-3 py-2 text-[10.5px] leading-relaxed text-[var(--color-hf-ink-mute)]">
          <p>
            Start the halopenclaw gateway from the repo root:
          </p>
          <pre
            className="mt-1.5 overflow-x-auto border border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)] px-2 py-1.5 hf-num text-[10px] text-[var(--color-hf-paper)]"
            style={{ borderRadius: 0 }}
          >
{`cd services/halopenclaw-gateway
.venv/Scripts/python.exe -m uvicorn main:app --port 18080`}
          </pre>
          <p className="mt-1.5">
            Health probe ·{' '}
            <a
              href={`${GATEWAY_URL}/health`}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-hf-accent)]"
            >
              {GATEWAY_URL}/health
            </a>
          </p>
        </div>
      )}
    </div>
  )
}

function GatewayDot({
  status,
}: {
  status: 'online' | 'offline' | 'checking'
}) {
  const color =
    status === 'online'
      ? 'var(--color-hf-moss)'
      : status === 'offline'
        ? 'var(--color-hf-brick)'
        : 'var(--color-hf-gold)'
  return (
    <span
      aria-hidden
      className={
        'inline-block h-2 w-2 shrink-0 ' +
        (status === 'checking' ? 'hf-pulse-hot' : '')
      }
      style={{ background: color }}
    />
  )
}

/** Hook used by child panels that want to know the active project. */
export function useActiveProject(): ActiveProject {
  return DEFAULT_PROJECT
}
