'use client'

/**
 * AutoPilot — R4.3 streaming slice consumer.
 *
 * Two input paths, one merge point:
 *
 *   1. SSE fallback — EventSource against the gateway's
 *      /intake/stream/{job_id} endpoint (non-Tauri browsers, dev).
 *   2. Tauri IPC — `ipc.onPipelineProgress` fires for every job and
 *      we filter by jobId.
 *
 * Every event lands in `processEvent(stage)`, which:
 *   - reads the current scene via `useScene.getState().nodes`,
 *   - calls `translateDesignSliceToNodes(stage, existing)`,
 *   - batch-applies creates / updates / deletes through the store.
 *
 * The translator is idempotent — ids are deterministic, so the same
 * slice arriving from both paths only mutates the scene once (the
 * second pass degenerates to a zero-patch update). This removes the
 * classic SSE↔Tauri race without needing a dedupe table.
 *
 * On `event.step === 'done'` we fire `camera-controls:focus` against
 * the freshly-built building so the viewport frames the new model.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { translateDesignSliceToNodes } from '@halofire/core/scene/translate-slice'
import type { StageEvent as SliceStageEvent } from '@halofire/core/scene/translate-slice'
import { emitter, useScene } from '@pascal-app/core'
import type { AnyNode } from '@pascal-app/core/schema'

import { detectTauri, ipc } from '@/lib/ipc'
import type { PipelineProgressEvent } from '@/lib/ipc.types'

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18080'

type Status = 'idle' | 'streaming' | 'completed' | 'failed'

interface Props {
  jobId: string | null
  gatewayUrl?: string
  onEvent?: (ev: SliceStageEvent) => void
  onComplete?: () => void
}

/**
 * Apply a translated slice to the Pascal scene store.
 *
 * Pulled out so the Tauri and SSE paths share identical semantics,
 * and so Playwright can call this via a test helper on `window`.
 */
function applySlice(stage: SliceStageEvent): {
  creates: number
  updates: number
  deletes: number
} {
  const store = useScene.getState() as unknown as {
    nodes: Record<string, AnyNode>
    createNode: (n: AnyNode, parentId?: string | null) => void
    updateNode?: (id: string, patch: Partial<AnyNode>) => void
    deleteNode?: (id: string) => void
  }
  const existing = store.nodes ?? {}
  const { creates, updates, deletes } = translateDesignSliceToNodes(
    stage,
    existing,
  )

  for (const op of creates) {
    try {
      store.createNode(op.node, op.parentId ?? null)
    } catch {
      // best-effort; bad payloads should not crash the stream
    }
  }
  for (const op of updates) {
    try {
      store.updateNode?.(op.id, op.patch)
    } catch {
      /* best-effort */
    }
  }
  for (const id of deletes) {
    try {
      store.deleteNode?.(id)
    } catch {
      /* best-effort */
    }
  }
  return { creates: creates.length, updates: updates.length, deletes: deletes.length }
}

export function AutoPilot({
  jobId,
  gatewayUrl = GATEWAY_URL,
  onEvent,
  onComplete,
}: Props) {
  const [events, setEvents] = useState<SliceStageEvent[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const esRef = useRef<EventSource | null>(null)
  const onEventRef = useRef(onEvent)
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onEventRef.current = onEvent
    onCompleteRef.current = onComplete
  })

  // Shared per-event handler — translate + apply + rebroadcast.
  const processEvent = useMemo(
    () => (stage: SliceStageEvent, srcJobId: string | null) => {
      try {
        applySlice(stage)
      } catch {
        // translator is pure; store errors are already swallowed above
      }
      setEvents((prev) => [...prev, stage])
      onEventRef.current?.(stage)
      window.dispatchEvent(
        new CustomEvent('halofire:autopilot', {
          detail: { jobId: srcJobId, stage: stage.step, event: stage },
        }),
      )
      if (stage.step === 'done' || stage.done === true) {
        setStatus('completed')
        try {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              emitter.emit('camera-controls:focus', { nodeId: undefined })
            }),
          )
        } catch {
          // emitter uninitialized in tests — ignore
        }
        onCompleteRef.current?.()
      }
    },
    [],
  )

  // Expose a test helper for Playwright — lets specs inject synthetic
  // stages without spinning up the gateway.
  useEffect(() => {
    ;(window as unknown as {
      __hfAutoPilot?: {
        inject: (stage: SliceStageEvent) => void
        applySlice: (stage: SliceStageEvent) => unknown
      }
    }).__hfAutoPilot = {
      inject: (stage: SliceStageEvent) => processEvent(stage, jobId),
      applySlice,
    }
    return () => {
      delete (window as unknown as { __hfAutoPilot?: unknown }).__hfAutoPilot
    }
  }, [jobId, processEvent])

  // SSE path — gateway fallback. Only active when NOT running inside
  // Tauri; the IPC subscription below is the primary source of truth
  // in the desktop shell, and opening a redundant EventSource would
  // double-apply every slice (the translator is idempotent so it
  // would no-op, but the extra network traffic is wasteful).
  useEffect(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    setEvents([])
    if (!jobId) {
      setStatus('idle')
      return
    }
    if (detectTauri()) {
      // Tauri path owns streaming — leave status to the IPC effect.
      setStatus('streaming')
      return
    }
    setStatus('streaming')
    const url = `${gatewayUrl}/intake/stream/${encodeURIComponent(jobId)}`
    let es: EventSource
    try {
      es = new EventSource(url)
    } catch {
      setStatus('failed')
      return
    }
    esRef.current = es

    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as SliceStageEvent
        processEvent(parsed, jobId)
      } catch {
        // ignore malformed payload
      }
    }
    es.addEventListener('end', (evt) => {
      try {
        const parsed = JSON.parse((evt as MessageEvent).data) as {
          status?: Status
        }
        setStatus(parsed.status === 'failed' ? 'failed' : 'completed')
        if (parsed.status === 'completed') onCompleteRef.current?.()
      } catch {
        setStatus('completed')
      }
      es.close()
      esRef.current = null
    })
    es.onerror = () => {
      setStatus((s) => (s === 'completed' ? s : 'failed'))
      es.close()
      esRef.current = null
    }
    return () => {
      es.close()
      esRef.current = null
    }
  }, [jobId, gatewayUrl, processEvent])

  // Tauri path — ipc.onPipelineProgress fires for every job; filter.
  useEffect(() => {
    if (!jobId) return
    const unsub = ipc.onPipelineProgress(
      (msg: PipelineProgressEvent) => {
        if (msg.job_id !== jobId) return
        const ev = msg.event as unknown as SliceStageEvent
        if (!ev || typeof ev !== 'object') return
        processEvent(ev, jobId)
      },
      { jobId },
    )
    return () => {
      try {
        unsub()
      } catch {
        /* best-effort */
      }
    }
  }, [jobId, processEvent])

  if (!jobId) return null

  const latestStep = events.length > 0 ? events[events.length - 1].step : null

  return (
    <div
      data-testid="halofire-autopilot"
      className="pointer-events-auto fixed bottom-12 left-3 z-40 w-[280px] border border-white/10 bg-[#0a0a0b]/95 text-white shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
      style={{ borderRadius: 0 }}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-neutral-500">
          Autopilot
        </span>
        <span
          data-testid="autopilot-status"
          className={
            'font-mono text-[10px] uppercase tracking-wider ' +
            (status === 'streaming'
              ? 'text-[#e8432d]'
              : status === 'completed'
                ? 'text-[#22c55e]'
                : status === 'failed'
                  ? 'text-[#ef4444]'
                  : 'text-neutral-500')
          }
        >
          {status}
        </span>
      </div>
      <ol className="space-y-0.5 px-3 py-2 font-mono text-[10px] text-neutral-300">
        {events.map((ev, i) => {
          const isLatest =
            i === events.length - 1 && status === 'streaming' && ev.step === latestStep
          return (
            <li
              key={`${ev.step}-${i}`}
              data-testid={`autopilot-step-${ev.step}`}
              className={
                'flex items-center gap-2 ' +
                (isLatest ? 'animate-pulse text-white' : '')
              }
            >
              <span className="text-[#e8432d]">✓</span>
              <span className="text-neutral-500">{ev.step}</span>
              <span className="ml-auto text-neutral-400">
                {(ev as Record<string, unknown>).head_count !== undefined
                  ? `${(ev as Record<string, unknown>).head_count} heads`
                  : (ev as Record<string, unknown>).pipe_count !== undefined
                    ? `${(ev as Record<string, unknown>).pipe_count} pipes`
                    : (ev as Record<string, unknown>).walls !== undefined
                      ? `${(ev as Record<string, unknown>).walls} walls`
                      : (ev as Record<string, unknown>).rooms !== undefined
                        ? `${(ev as Record<string, unknown>).rooms} rooms`
                        : (ev as Record<string, unknown>).total_usd !== undefined
                          ? `$${Number((ev as Record<string, unknown>).total_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          : ''}
              </span>
            </li>
          )
        })}
        {status === 'streaming' && (
          <li className="text-neutral-600 italic">…waiting for next stage</li>
        )}
      </ol>
    </div>
  )
}
