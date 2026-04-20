'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18080'

export interface GatewayHealth {
  status: 'online' | 'offline' | 'checking'
  tools: string[]
  lastChecked: Date | null
  error: string | null
  retry: () => void
}

/**
 * Poll `/health` every 10s. Exposes connection status + registered
 * tools so the Studio can show a persistent banner when the Python
 * backend is down (the actual reason Auto-Design was failing —
 * "TypeError: Failed to fetch" was the gateway being down, not the
 * Studio being broken).
 */
export function useGatewayHealth(): GatewayHealth {
  const [status, setStatus] = useState<'online' | 'offline' | 'checking'>(
    'checking',
  )
  const [tools, setTools] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const check = useCallback(async () => {
    abortRef.current?.abort()
    const ctl = new AbortController()
    abortRef.current = ctl
    setStatus('checking')
    try {
      const res = await fetch(`${GATEWAY_URL}/health`, {
        signal: ctl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      setStatus('online')
      setTools(body.tools ?? [])
      setError(null)
    } catch (e) {
      if (ctl.signal.aborted) return
      setStatus('offline')
      setError(String(e))
    } finally {
      setLastChecked(new Date())
    }
  }, [])

  useEffect(() => {
    check()
    const id = setInterval(check, 10_000)
    return () => {
      clearInterval(id)
      abortRef.current?.abort()
    }
  }, [check])

  return { status, tools, lastChecked, error, retry: check }
}
