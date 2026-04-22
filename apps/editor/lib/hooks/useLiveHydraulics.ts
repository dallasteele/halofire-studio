'use client'

/**
 * useLiveHydraulics — Phase C live hydraulic state machine.
 *
 * Subscribes to the gateway's `/projects/:id/events` SSE stream
 * (Phase A) and debounces a call to `/projects/:id/calculate` when
 * a hydraulically-relevant `scene_delta` lands. Exposes the latest
 * per-system hydraulic result plus a flat per-node map keyed by the
 * `node_id` / `segment_id` the solver emits in `node_trace`.
 *
 * State machine::
 *
 *     idle ──run()──▶ calculating ──ok──▶ ready
 *                                     └─err──▶ error
 *     ready  ──scene_delta (debounced)──▶ calculating
 *     error  ──run()──▶ calculating
 *
 * The hook deliberately owns a small amount of state — the panels
 * that call it (LiveCalc, NodeTags, StatusBar, SystemOptimizer) all
 * want the same shape. A Zustand store is overkill at three
 * consumers and they're all in one page.
 *
 * SSE is optional: if `EventSource` isn't available (SSR, jsdom) or
 * the gateway is down, the hook falls back to manual-only mode.
 * Scene-changed CustomEvents also still drive recalc so the existing
 * SceneChangeBridge wiring keeps working.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { GATEWAY_URL, ipc } from '@/lib/ipc'
import type { HydraulicResult, RunHydraulicResponse } from '@/lib/ipc.types'

export type LiveState =
  | { kind: 'idle' }
  | { kind: 'calculating'; origin?: string }
  | {
      kind: 'ready'
      result: SystemsSnapshot
      at: number
      origin?: string
    }
  | { kind: 'error'; message: string; at: number; origin?: string }

export interface SystemsSnapshot {
  systems: Array<{
    id?: string
    hazard?: string
    hydraulic?: HydraulicResult
  }>
  /** Aggregate headline (first system — tree systems only in Alpha). */
  headline: {
    required_flow_gpm: number | null
    required_pressure_psi: number | null
    safety_margin_psi: number | null
    supply_residual_psi: number | null
    demand_at_base_of_riser_psi: number | null
    velocity_warnings: number
    issues: string[]
  }
  /** Per-node data used by the viewport NodeTags overlay. */
  nodes: Record<string, NodeDatum>
}

export interface NodeDatum {
  pressure_psi: number | null
  flow_gpm: number | null
  velocity_fps: number | null
  size_in: number | null
  /** ok | warn | critical — derived from velocity + margin. */
  severity: 'ok' | 'warn' | 'critical'
  /** True if this node sits on the critical path. */
  on_critical_path: boolean
}

export interface UseLiveHydraulicsOptions {
  projectId: string
  /** Debounce window for scene-change → recalc (default 300 ms). */
  debounceMs?: number
  /** Disable the SSE subscription. Used in unit tests. */
  disableSse?: boolean
  /** Disable auto-run on mount. Default true (runs once at mount). */
  runOnMount?: boolean
}

const DEFAULT_DEBOUNCE_MS = 300

/**
 * NFPA 13 §8.1.1 — 20 ft/s is the aspirational branch-line velocity
 * cap; cross-mains are allowed up to 32 ft/s. We flag anything over
 * 20 as a warning and over 32 as critical, which matches how the
 * industry rules-of-thumb work (AutoSPRINK's default warning bands).
 */
const VELOCITY_WARN_FPS = 20
const VELOCITY_CRIT_FPS = 32

function classifyVelocity(v: number | null): 'ok' | 'warn' | 'critical' {
  if (v == null || !Number.isFinite(v)) return 'ok'
  if (v >= VELOCITY_CRIT_FPS) return 'critical'
  if (v >= VELOCITY_WARN_FPS) return 'warn'
  return 'ok'
}

function mergeNodes(
  hydraulic: HydraulicResult | undefined,
  intoMap: Record<string, NodeDatum>,
): void {
  if (!hydraulic || !Array.isArray(hydraulic.node_trace)) return
  const critical = new Set(
    Array.isArray(hydraulic.critical_path) ? hydraulic.critical_path : [],
  )
  for (const row of hydraulic.node_trace) {
    const id = (row.segment_id ?? row.node_id) as string | undefined
    if (!id) continue
    const v =
      typeof row.velocity_fps === 'number' ? row.velocity_fps : null
    const p =
      typeof row.pressure_end_psi === 'number'
        ? row.pressure_end_psi
        : typeof row.pressure_psi === 'number'
          ? row.pressure_psi
          : typeof row.pressure_start_psi === 'number'
            ? row.pressure_start_psi
            : null
    const f = typeof row.flow_gpm === 'number' ? row.flow_gpm : null
    const size =
      typeof row.size_in === 'number' ? row.size_in : null
    intoMap[id] = {
      pressure_psi: p,
      flow_gpm: f,
      velocity_fps: v,
      size_in: size,
      severity: classifyVelocity(v),
      on_critical_path: critical.has(id),
    }
  }
}

export function normalizeSnapshot(
  response: RunHydraulicResponse,
): SystemsSnapshot {
  const systems = Array.isArray(response.systems) ? response.systems : []
  const nodes: Record<string, NodeDatum> = {}
  let velocityWarnings = 0
  const issues: string[] = []
  for (const s of systems) {
    mergeNodes(s.hydraulic, nodes)
    if (s.hydraulic?.issues) issues.push(...s.hydraulic.issues)
  }
  for (const n of Object.values(nodes)) {
    if (n.severity !== 'ok') velocityWarnings += 1
  }
  const first = systems[0]?.hydraulic ?? {}
  const headline = {
    required_flow_gpm: toNum(first.required_flow_gpm),
    required_pressure_psi: toNum(first.required_pressure_psi),
    safety_margin_psi: toNum(first.safety_margin_psi),
    supply_residual_psi: toNum(first.supply_residual_psi),
    demand_at_base_of_riser_psi: toNum(first.demand_at_base_of_riser_psi),
    velocity_warnings: velocityWarnings,
    issues,
  }
  return { systems, headline, nodes }
}

function toNum(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * Hydraulically-relevant scene deltas. Phase A emits these op kinds
 * on `scene_delta` events; we avoid re-calcing on ops that don't
 * change hydraulics (e.g. layer toggles, rules_run).
 */
const HYDRAULIC_OPS = new Set([
  'insert_head',
  'modify_head',
  'delete_head',
  'insert_pipe',
  'modify_pipe',
  'delete_pipe',
  'insert_fitting',
  'insert_hanger',
  'remote_area',
  'swap_sku',
  'undo',
  'redo',
])

export function useLiveHydraulics(
  opts: UseLiveHydraulicsOptions,
): {
  state: LiveState
  snapshot: SystemsSnapshot | null
  isCalculating: boolean
  error: string | null
  run: (origin?: string, scope?: { scope_system_id?: string }) => Promise<void>
} {
  const {
    projectId,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    disableSse = false,
    runOnMount = true,
  } = opts

  const [state, setState] = useState<LiveState>({ kind: 'idle' })
  const runningRef = useRef<Promise<void> | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const run = useCallback(
    async (origin?: string, scope?: { scope_system_id?: string }) => {
      // Single-flight: if a calc is already in flight, piggy-back.
      if (runningRef.current) return runningRef.current
      const p = (async () => {
        setState({ kind: 'calculating', origin })
        try {
          const body = await ipc.runHydraulic({ projectId, scope })
          const snap = normalizeSnapshot(body)
          if (!mountedRef.current) return
          setState({
            kind: 'ready', result: snap, at: Date.now(), origin,
          })
        } catch (e) {
          if (!mountedRef.current) return
          const message = e instanceof Error ? e.message : String(e)
          setState({
            kind: 'error', message, at: Date.now(), origin,
          })
        }
      })()
      runningRef.current = p
      try {
        await p
      } finally {
        runningRef.current = null
      }
    },
    [projectId],
  )

  // Run once on mount to populate the panel.
  useEffect(() => {
    mountedRef.current = true
    if (runOnMount) void run('mount')
    return () => {
      mountedRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Scene-change CustomEvent → debounced recalc.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { origin?: string }
        | undefined
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void run(detail?.origin ?? 'scene-changed')
      }, debounceMs)
    }
    window.addEventListener('halofire:scene-changed', handler)
    return () => {
      window.removeEventListener('halofire:scene-changed', handler)
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [debounceMs, run])

  // SSE subscription for cross-tab / HAL-driven mutations.
  useEffect(() => {
    if (disableSse) return
    if (typeof window === 'undefined') return
    if (typeof EventSource === 'undefined') return
    const url = `${GATEWAY_URL}/projects/${encodeURIComponent(projectId)}/events`
    let source: EventSource
    try {
      source = new EventSource(url)
    } catch {
      return
    }
    const handleDelta = (raw: string) => {
      try {
        const payload = JSON.parse(raw) as {
          kind?: string
          delta?: { op?: string }
          op?: string
        }
        if (payload.kind && payload.kind !== 'scene_delta') return
        const op = payload.op ?? payload.delta?.op
        if (op && !HYDRAULIC_OPS.has(op)) return
        if (timerRef.current !== null) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          void run(`sse:${op ?? 'delta'}`)
        }, debounceMs)
      } catch {
        /* malformed frame — drop silently */
      }
    }
    source.onmessage = (e) => handleDelta(e.data)
    // Named events (gateway emits `event: hello` on connect).
    source.addEventListener('scene_delta', (e) =>
      handleDelta((e as MessageEvent).data),
    )
    return () => {
      try { source.close() } catch { /* best effort */ }
    }
  }, [projectId, debounceMs, disableSse, run])

  const snapshot =
    state.kind === 'ready' ? state.result : null
  const isCalculating = state.kind === 'calculating'
  const error = state.kind === 'error' ? state.message : null

  return useMemo(
    () => ({ state, snapshot, isCalculating, error, run }),
    [state, snapshot, isCalculating, error, run],
  )
}

// Exported for unit tests.
export const _internals = {
  classifyVelocity,
  normalizeSnapshot,
  VELOCITY_WARN_FPS,
  VELOCITY_CRIT_FPS,
  HYDRAULIC_OPS,
}
