'use client'

/**
 * ProjectContextHeader — the ALWAYS-VISIBLE bid context band.
 *
 * UX research: every production CAD product (AutoSprink, HydraCAD,
 * Revit) keeps the project name, path, and service-status visible at
 * all times. A user should never have to click a tab to know what
 * project they're in or whether the backend is reachable.
 *
 * This component renders ABOVE the sidebar tab content, inside every
 * sidebar panel, so it's present regardless of which tab is active.
 *
 * Per AGENTIC_RULES §13 honesty: if the gateway is offline the
 * banner says so, loudly. No silent "Failed to fetch" errors hidden
 * inside child panels.
 */

import { useEffect, useState } from 'react'
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
  const [dismissed, setDismissed] = useState(false)

  const offline = gw.status === 'offline'
  const checking = gw.status === 'checking'

  return (
    <div className="border-b border-neutral-800 bg-neutral-950 text-neutral-100">
      {/* Branded header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[#e8432d] text-[10px] font-bold text-white">
          HF
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold">
            {project.name}
          </p>
          <p className="truncate text-[9px] text-neutral-500">
            {project.address}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[11px] font-bold text-[#e8432d]">
            ${project.price.toLocaleString()}
          </p>
          <p className="text-[8px] uppercase text-neutral-500">
            Bid total
          </p>
        </div>
      </div>

      {/* Service health row */}
      <div
        className={`flex items-center gap-2 border-t border-neutral-800 px-3 py-1 text-[10px] ${
          offline
            ? 'bg-red-950/50 text-red-200'
            : checking
              ? 'bg-amber-950/30 text-amber-200'
              : 'bg-neutral-900 text-neutral-500'
        }`}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            offline
              ? 'bg-red-500'
              : checking
                ? 'bg-amber-400 animate-pulse'
                : 'bg-emerald-500'
          }`}
        />
        <span className="flex-1 truncate">
          {offline
            ? `Gateway offline — ${gw.error ?? 'no connection'}`
            : checking
              ? 'Checking halopenclaw…'
              : `halopenclaw online · ${gw.tools.length} tools`}
        </span>
        {offline && (
          <button
            type="button"
            onClick={gw.retry}
            className="rounded bg-red-900 px-2 py-0.5 font-medium text-red-100 hover:bg-red-800"
          >
            Retry
          </button>
        )}
      </div>

      {/* Offline help (dismissible) */}
      {offline && !dismissed && (
        <div className="border-t border-red-900 bg-red-950/60 px-3 py-2 text-[10px] text-red-100">
          <p className="font-semibold">Start the halopenclaw gateway:</p>
          <pre className="mt-1 overflow-x-auto rounded bg-neutral-950 p-1 font-mono text-[9px]">
            cd services/halopenclaw-gateway{"\n"}
            .venv/Scripts/python.exe -m uvicorn main:app --port 18080
          </pre>
          <p className="mt-1">
            Expected:{' '}
            <a
              href={`${GATEWAY_URL}/health`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {GATEWAY_URL}/health
            </a>
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="mt-1 text-[9px] underline text-red-200"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

/** Hook used by child panels that want to know the active project. */
export function useActiveProject(): ActiveProject {
  // In the future this pulls from a context or URL param; today all
  // Studio sessions are 1881-cooperative.
  return DEFAULT_PROJECT
}
