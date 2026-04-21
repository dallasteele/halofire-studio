'use client'

/**
 * AutoPilot — V2 step 5 SSE consumer.
 *
 * Attaches to the gateway's /intake/stream/{job_id} SSE endpoint and
 * displays per-stage pipeline progress as each stage completes. Every
 * event broadcasts `halofire:autopilot` so other components
 * (AutoDesignPanel, viewer spawners, LiveCalc) can react — e.g. the
 * viewer can spawn wall meshes when the 'intake' event lands, rooms
 * on 'classify', heads on 'place', pipes on 'route', without waiting
 * for the whole pipeline to finish.
 *
 * This is the real autopilot feedback loop the user asked for:
 * drop a PDF → watch the model appear stage-by-stage.
 */

import { useEffect, useRef, useState } from 'react'

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18080'

interface StageEvent {
  step: string
  done?: boolean
  levels?: number
  walls?: number
  rooms?: number
  head_count?: number
  system_count?: number
  pipe_count?: number
  hanger_count?: number
  line_items?: number
  total_usd?: number
  error?: string | null
  [k: string]: unknown
}

type Status = 'idle' | 'streaming' | 'completed' | 'failed'

interface Props {
  jobId: string | null
  gatewayUrl?: string
  onEvent?: (ev: StageEvent) => void
  onComplete?: () => void
}

export function AutoPilot({
  jobId,
  gatewayUrl = GATEWAY_URL,
  onEvent,
  onComplete,
}: Props) {
  const [events, setEvents] = useState<StageEvent[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const esRef = useRef<EventSource | null>(null)
  const onEventRef = useRef(onEvent)
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onEventRef.current = onEvent
    onCompleteRef.current = onComplete
  })

  useEffect(() => {
    // Tear down any prior connection.
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    setEvents([])
    if (!jobId) {
      setStatus('idle')
      return
    }
    setStatus('streaming')
    const url = `${gatewayUrl}/intake/stream/${encodeURIComponent(jobId)}`
    const es = new EventSource(url)
    esRef.current = es

    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as StageEvent
        setEvents((prev) => [...prev, parsed])
        onEventRef.current?.(parsed)
        // Rebroadcast for other halofire components.
        window.dispatchEvent(
          new CustomEvent('halofire:autopilot', {
            detail: { jobId, stage: parsed.step, event: parsed },
          }),
        )
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
      setStatus('failed')
      es.close()
      esRef.current = null
    }
    return () => {
      es.close()
      esRef.current = null
    }
  }, [jobId, gatewayUrl])

  if (!jobId) return null

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
        {events.map((ev, i) => (
          <li key={`${ev.step}-${i}`} className="flex items-center gap-2">
            <span className="text-[#e8432d]">✓</span>
            <span className="text-neutral-500">{ev.step}</span>
            <span className="ml-auto text-neutral-400">
              {ev.head_count !== undefined
                ? `${ev.head_count} heads`
                : ev.pipe_count !== undefined
                  ? `${ev.pipe_count} pipes`
                  : ev.walls !== undefined
                    ? `${ev.walls} walls`
                    : ev.rooms !== undefined
                      ? `${ev.rooms} rooms`
                      : ev.total_usd !== undefined
                        ? `$${Number(ev.total_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                        : ''}
            </span>
          </li>
        ))}
        {status === 'streaming' && (
          <li className="text-neutral-600 italic">…waiting for next stage</li>
        )}
      </ol>
    </div>
  )
}
