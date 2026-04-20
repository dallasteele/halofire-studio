'use client'

/**
 * StatusBar — AutoSprink-style bottom bar. Shows:
 *   - active project + address
 *   - gateway health (ticks green / red dot)
 *   - quick stats (scene node counts)
 *   - snap / grid / units on the right (mirrors AutoSprink's 2D
 *     status row so the estimator always knows the mode they're in)
 */

import { useEffect, useState } from 'react'

export interface StatusBarProps {
  projectName?: string
  projectAddress?: string
  gatewayUrl?: string
  sceneNodeCount?: number
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

  return (
    <div
      data-testid="halofire-status-bar"
      className="flex h-8 w-full items-center gap-4 border-t border-white/10 bg-[#0c0c10] px-3 font-mono text-[11px] text-neutral-400"
    >
      <span className="flex items-center gap-1.5">
        <span
          className={
            'inline-block h-2 w-2 rounded-full ' +
            (gateway?.ok ? 'bg-[#22c55e]' : 'bg-[#ef4444]')
          }
          title={gateway?.ok ? 'gateway online' : 'gateway offline'}
        />
        <span className="text-neutral-300">
          {gateway?.ok ? 'gateway' : 'gateway down'}
        </span>
        {gateway?.ok && gateway.latency_ms !== undefined && (
          <span className="text-neutral-600">
            {gateway.latency_ms}ms
          </span>
        )}
      </span>
      <span className="text-neutral-600">·</span>
      <span className="truncate">
        <span className="text-neutral-200">{projectName}</span>
        {projectAddress && (
          <span className="ml-2 text-neutral-600">{projectAddress}</span>
        )}
      </span>
      {sceneNodeCount !== undefined && (
        <>
          <span className="text-neutral-600">·</span>
          <span>{sceneNodeCount} nodes</span>
        </>
      )}
      <span className="ml-auto flex items-center gap-3">
        <span>units: m</span>
        <span>grid: 0.5m</span>
        <span>snap: on</span>
        <span className="text-neutral-600">
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </span>
    </div>
  )
}
