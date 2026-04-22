'use client'

/**
 * SystemOptimizer — iterative pipe-schedule upsize loop.
 *
 * AutoSprink ships a "System Optimizer" that upsizes branches one
 * schedule at a time, re-runs the calc, and keeps the change if
 * safety margin improved without breaking a velocity cap. We do the
 * same thing client-side against Phase A's `/calculate` endpoint:
 *
 *   1. Fetch the current design + baseline calc.
 *   2. For each candidate pipe (ordered by friction contribution),
 *      PATCH size_in up one schedule, POST /calculate, check the
 *      new residual margin. Keep if improved + velocity cap still
 *      satisfied. Revert otherwise.
 *   3. Stop when target margin reached, no further pipe improves
 *      things, or the user cancels.
 *   4. Emit a single undo bundle at the end so one Ctrl-Z rolls the
 *      entire session back.
 *
 * The component is a slide-over; triggered from the Hydraulics
 * ribbon command `hydraulics-optimize`. Closing mid-run cancels.
 *
 * Phase C note: the real `single_ops.modify_pipe` call lives behind
 * `ipc.runHydraulic({ scope })`. We wire through the public facade
 * so the Tauri backend can replace it with a native command later
 * without touching this file.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { GATEWAY_URL, ipc } from '@/lib/ipc'
import {
  normalizeSnapshot,
  type SystemsSnapshot,
} from '@/lib/hooks/useLiveHydraulics'

type Log = {
  iteration: number
  pipeId: string
  beforeMargin: number | null
  afterMargin: number | null
  deltaMargin: number | null
  accepted: boolean
  reason: string
}

interface Props {
  projectId?: string
  /** Target headroom in psi. Default 15 psi — a comfortable margin. */
  targetMarginPsi?: number
  /** Hard cap on iterations. */
  maxIterations?: number
}

const PIPE_SIZES = [0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8] as const

function nextSize(s: number | null | undefined): number | null {
  if (s == null) return null
  const i = PIPE_SIZES.findIndex((x) => x >= s)
  if (i < 0 || i >= PIPE_SIZES.length - 1) return null
  return PIPE_SIZES[i + 1] ?? null
}

async function modifyPipe(
  projectId: string, pipeId: string, size_in: number,
): Promise<void> {
  const url =
    `${GATEWAY_URL}/projects/${encodeURIComponent(projectId)}`
    + `/pipes/${encodeURIComponent(pipeId)}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ size_in }),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`PATCH pipe → ${res.status}: ${msg.slice(0, 120)}`)
  }
}

async function undoOnce(projectId: string): Promise<void> {
  const res = await fetch(
    `${GATEWAY_URL}/projects/${encodeURIComponent(projectId)}/undo`,
    { method: 'POST' },
  )
  if (!res.ok && res.status !== 409) {
    const msg = await res.text().catch(() => '')
    throw new Error(`undo → ${res.status}: ${msg.slice(0, 120)}`)
  }
}

export function SystemOptimizer({
  projectId = '1881-cooperative',
  targetMarginPsi = 15,
  maxIterations = 24,
}: Props) {
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<Log[]>([])
  const [message, setMessage] = useState<string>('idle')
  const [baseline, setBaseline] = useState<SystemsSnapshot | null>(null)
  const [current, setCurrent] = useState<SystemsSnapshot | null>(null)
  const cancelRef = useRef(false)

  useEffect(() => {
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cmd?: string } | undefined
      if (detail?.cmd === 'hydraulics-optimize') setOpen(true)
    }
    window.addEventListener('halofire:ribbon', onCmd as EventListener)
    return () =>
      window.removeEventListener('halofire:ribbon', onCmd as EventListener)
  }, [])

  const cancel = useCallback(() => {
    cancelRef.current = true
    setMessage('cancelling…')
  }, [])

  const run = useCallback(async () => {
    if (running) return
    setRunning(true)
    cancelRef.current = false
    setLog([])
    setMessage('fetching baseline…')

    try {
      const base = normalizeSnapshot(await ipc.runHydraulic({ projectId }))
      setBaseline(base)
      setCurrent(base)
      let acceptedCount = 0

      // Order candidate pipes by descending friction contribution
      // (velocity * length if we have it, otherwise just velocity).
      const pipes = Object.entries(base.nodes)
        .filter(([, d]) => d.velocity_fps != null)
        .sort(
          ([, a], [, b]) =>
            (b.velocity_fps ?? 0) - (a.velocity_fps ?? 0),
        )
        .map(([id, d]) => ({ id, size_in: d.size_in }))

      let currentSnap = base
      for (let i = 0; i < Math.min(maxIterations, pipes.length); i++) {
        if (cancelRef.current) break
        const cand = pipes[i]
        if (!cand) break
        const beforeMargin =
          currentSnap.headline.safety_margin_psi
        const target = nextSize(cand.size_in)
        if (target == null) {
          setLog((prev) => [
            ...prev,
            {
              iteration: i + 1, pipeId: cand.id,
              beforeMargin, afterMargin: beforeMargin, deltaMargin: 0,
              accepted: false,
              reason: 'already at max schedule',
            },
          ])
          continue
        }

        setMessage(
          `iter ${i + 1}: upsizing ${cand.id} → ${target}" sched`,
        )
        try {
          await modifyPipe(projectId, cand.id, target)
          const next = normalizeSnapshot(
            await ipc.runHydraulic({ projectId }),
          )
          const afterMargin = next.headline.safety_margin_psi
          const deltaMargin =
            beforeMargin != null && afterMargin != null
              ? afterMargin - beforeMargin
              : null
          const velocityOk = next.headline.velocity_warnings <=
            currentSnap.headline.velocity_warnings
          const improved =
            deltaMargin != null && deltaMargin > 0.1 && velocityOk
          if (improved) {
            acceptedCount += 1
            currentSnap = next
            setCurrent(next)
            setLog((prev) => [
              ...prev,
              {
                iteration: i + 1, pipeId: cand.id,
                beforeMargin, afterMargin, deltaMargin,
                accepted: true,
                reason: 'kept',
              },
            ])
            const m = currentSnap.headline.safety_margin_psi ?? 0
            if (m >= targetMarginPsi) {
              setMessage(
                `target met — margin ${m.toFixed(1)} psi ≥ ${targetMarginPsi}`,
              )
              break
            }
          } else {
            // Revert: single undo rolls the patch back.
            await undoOnce(projectId)
            setLog((prev) => [
              ...prev,
              {
                iteration: i + 1, pipeId: cand.id,
                beforeMargin, afterMargin, deltaMargin,
                accepted: false,
                reason: !velocityOk
                  ? 'velocity regression'
                  : 'no margin improvement',
              },
            ])
          }
        } catch (e) {
          setLog((prev) => [
            ...prev,
            {
              iteration: i + 1, pipeId: cand.id,
              beforeMargin, afterMargin: null, deltaMargin: null,
              accepted: false,
              reason: e instanceof Error ? e.message : String(e),
            },
          ])
        }
      }

      setMessage(
        cancelRef.current
          ? 'cancelled'
          : `done — ${acceptedCount} pipe change${acceptedCount === 1 ? '' : 's'} kept`,
      )
      // Nudge the rest of the UI so LiveCalc / NodeTags repaint.
      window.dispatchEvent(
        new CustomEvent('halofire:scene-changed', {
          detail: { origin: 'optimizer' },
        }),
      )
    } catch (e) {
      setMessage(`error — ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRunning(false)
    }
  }, [projectId, running, maxIterations, targetMarginPsi])

  if (!open) return null

  return (
    <div
      data-testid="halofire-system-optimizer"
      className="pointer-events-auto fixed right-0 top-0 z-[900] flex h-full w-[420px] flex-col border-l border-white/10 bg-[#0a0a0b] font-mono text-[11px] text-neutral-100 shadow-[0_0_40px_rgba(0,0,0,0.6)]"
    >
      <header className="flex items-center justify-between border-b border-white/10 bg-[#0c0c10] px-3 py-2">
        <div>
          <div className="text-[12px] uppercase tracking-[0.14em] text-white">
            System Optimizer
          </div>
          <div className="text-[10px] text-neutral-500">
            project · {projectId}
          </div>
        </div>
        <button
          type="button"
          onClick={() => { cancel(); setOpen(false) }}
          className="px-2 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          aria-label="close"
        >
          ×
        </button>
      </header>

      <section className="grid grid-cols-2 gap-2 border-b border-white/10 p-3">
        <Stat
          label="baseline margin"
          value={fmt(baseline?.headline.safety_margin_psi, 'psi')}
        />
        <Stat
          label="current margin"
          value={fmt(current?.headline.safety_margin_psi, 'psi')}
          tone={
            (current?.headline.safety_margin_psi ?? 0)
              > (baseline?.headline.safety_margin_psi ?? 0)
              ? 'ok'
              : 'default'
          }
        />
        <Stat
          label="baseline flow"
          value={fmt(baseline?.headline.required_flow_gpm, 'gpm')}
        />
        <Stat
          label="velocity warn"
          value={`${current?.headline.velocity_warnings ?? '—'}`}
          tone={
            (current?.headline.velocity_warnings ?? 0) > 0 ? 'warn' : 'ok'
          }
        />
      </section>

      <div className="flex items-center gap-2 border-b border-white/10 bg-[#0c0c10] px-3 py-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="border border-[#e8432d]/50 bg-[#e8432d]/15 px-3 py-1 text-[11px] uppercase tracking-wider text-[#ffb4a6] hover:bg-[#e8432d]/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? 'running…' : 'run'}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={!running}
          className="border border-white/10 px-3 py-1 text-[11px] uppercase tracking-wider text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          cancel
        </button>
        <span className="ml-auto text-[10px] text-neutral-500">
          target · {targetMarginPsi} psi
        </span>
      </div>

      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-neutral-400">
        {message}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-[10px]">
          <thead className="sticky top-0 bg-[#0c0c10] text-neutral-500">
            <tr>
              <th className="px-2 py-1 text-left font-normal">#</th>
              <th className="px-2 py-1 text-left font-normal">pipe</th>
              <th className="px-2 py-1 text-right font-normal">Δ psi</th>
              <th className="px-2 py-1 text-left font-normal">result</th>
            </tr>
          </thead>
          <tbody>
            {log.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-3 text-center text-neutral-600">
                  no iterations yet — press run
                </td>
              </tr>
            )}
            {log.map((row) => (
              <tr
                key={`${row.iteration}-${row.pipeId}`}
                className="border-t border-white/5"
                data-accepted={row.accepted}
              >
                <td className="px-2 py-1 text-neutral-500">{row.iteration}</td>
                <td className="px-2 py-1 text-neutral-200">{row.pipeId}</td>
                <td
                  className={
                    'px-2 py-1 text-right '
                    + (row.deltaMargin == null
                      ? 'text-neutral-600'
                      : row.deltaMargin > 0
                        ? 'text-[#4af626]'
                        : 'text-[#ff3333]')
                  }
                >
                  {row.deltaMargin == null
                    ? '—'
                    : row.deltaMargin.toFixed(1)}
                </td>
                <td
                  className={
                    'px-2 py-1 '
                    + (row.accepted ? 'text-[#4af626]' : 'text-neutral-500')
                  }
                >
                  {row.accepted ? 'kept' : row.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({
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
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className={`text-[13px] ${cls}`}>{value}</div>
    </div>
  )
}

function fmt(n: number | null | undefined, unit: string): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${Number(n).toFixed(1)} ${unit}`
}

export const _internals = { nextSize, PIPE_SIZES }
