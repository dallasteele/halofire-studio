/**
 * HaloFire Studio IPC facade (R10.2).
 *
 * A single typed surface the editor frontend uses for every call
 * that would otherwise branch on "am I running inside Tauri or in a
 * browser dev tab?". When Tauri is present we use `invoke()` +
 * `listen()` against the Rust command layer defined in
 * `apps/halofire-studio-desktop/src-tauri/src/commands/`. When
 * Tauri is absent (e.g. `next dev` on localhost:3002, Playwright
 * headless, CI) we fall back to `fetch()` + `EventSource` against
 * the FastAPI HaloPenClaw gateway.
 *
 * Strategy for missing peer deps: `@tauri-apps/api` is NOT a hard
 * dependency of `apps/editor` — it is only present when the editor
 * is loaded inside the Tauri WebView. We import the package with
 * `await import(...)` so a Node/Browser dev build that can't resolve
 * the specifier still executes; if the specifier resolves but we're
 * still outside Tauri (unusual), the fallback path runs.
 *
 * NOTE: This module does NOT replace any fetch() callsites in
 * AutoDesignPanel/LiveCalc/AutoPilot yet — that migration is R10.3.
 * This commit only lands the facade + types + a smoke test so
 * downstream work has a stable import target.
 */

import type {
  CatalogTemplate,
  CatalogUpdatedEvent,
  HostVersions,
  JobStatus,
  PipelineProgressEvent,
  PipelineStarted,
  ProjectEntry,
  RenderResult,
  RenderScadArgs,
  RunPipelineArgs,
  RuntimeStatus,
} from './ipc.types'

// ── Environment detection ─────────────────────────────────────────

/**
 * `true` when the runtime is hosted inside a Tauri WebView. Tauri 2
 * exposes `window.__TAURI_INTERNALS__`; older Tauri 1 / plugin
 * checks look at `window.__TAURI__`. Check both for robustness.
 */
export function detectTauri(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as Record<string, unknown>
  return '__TAURI_INTERNALS__' in w || '__TAURI__' in w
}

/**
 * Gateway URL used by the fetch fallback. Reads
 * `NEXT_PUBLIC_HALOPENCLAW_URL` at build time and falls back to the
 * local-dev default that the existing panels use.
 */
export const GATEWAY_URL: string =
  (typeof process !== 'undefined' &&
    process.env?.NEXT_PUBLIC_HALOPENCLAW_URL) ||
  'http://localhost:18080'

// ── Lazy-loaded Tauri bindings ────────────────────────────────────
//
// We cache the dynamic imports so multiple calls don't re-resolve.
// If the package isn't installed we swallow the ImportError once and
// force the fallback path from then on.

type InvokeFn = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>
type UnlistenFn = () => void
type ListenFn = <T = unknown>(
  event: string,
  cb: (payload: { payload: T }) => void,
) => Promise<UnlistenFn>

let cachedInvoke: InvokeFn | null = null
let cachedListen: ListenFn | null = null
let tauriLoadAttempted = false

async function loadTauri(): Promise<{
  invoke: InvokeFn
  listen: ListenFn
} | null> {
  if (!detectTauri()) return null
  if (cachedInvoke && cachedListen) {
    return { invoke: cachedInvoke, listen: cachedListen }
  }
  if (tauriLoadAttempted && (!cachedInvoke || !cachedListen)) {
    return null
  }
  tauriLoadAttempted = true
  try {
    // Split-specifier so the bundler treats these as optional peers.
    const core = (await import(
      /* webpackIgnore: true */ '@tauri-apps/api/core'
    )) as { invoke: InvokeFn }
    const ev = (await import(
      /* webpackIgnore: true */ '@tauri-apps/api/event'
    )) as { listen: ListenFn }
    cachedInvoke = core.invoke
    cachedListen = ev.listen
    return { invoke: cachedInvoke, listen: cachedListen }
  } catch {
    // Peer not installed, or we're not actually in Tauri despite
    // the heuristic. Silently degrade; callers get the fetch path.
    return null
  }
}

// ── Fetch-fallback primitives ─────────────────────────────────────

async function fetchJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${GATEWAY_URL}${path}`, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `gateway ${init?.method ?? 'GET'} ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`,
    )
  }
  return (await res.json()) as T
}

// ── Public API ────────────────────────────────────────────────────

export const ipc = {
  // Host wiring smoke tests ----------------------------------------

  async greet(name: string): Promise<string> {
    const t = await loadTauri()
    if (t) return t.invoke<string>('greet', { name })
    // No FastAPI equivalent; use /mcp as a wiring probe. Callers
    // that don't need a greeting should prefer ipc.versions().
    const data = await fetchJson<{ message?: string }>(
      `/mcp?name=${encodeURIComponent(name)}`,
    ).catch(() => ({ message: `HaloFire Studio says hi, ${name}` }))
    return data.message ?? `HaloFire Studio says hi, ${name}`
  },

  async versions(): Promise<HostVersions> {
    const t = await loadTauri()
    if (t) return t.invoke<HostVersions>('versions')
    // Gateway exposes /version with app info; rustc doesn't apply.
    const data = await fetchJson<Partial<HostVersions>>('/version').catch(
      () => ({}),
    )
    return {
      app: data.app ?? '0.0.0-dev',
      tauri: data.tauri ?? 'browser',
      rustc: data.rustc ?? 'n/a',
    }
  },

  // Pipeline -------------------------------------------------------

  async runPipeline(args: RunPipelineArgs): Promise<PipelineStarted> {
    const t = await loadTauri()
    if (t) {
      // Tauri's serde convention converts camelCase JS → snake_case
      // Rust field names automatically; pass as a single `args`
      // object because the Rust command takes `args: RunPipelineArgs`.
      return t.invoke<PipelineStarted>('run_pipeline', { args })
    }
    // FastAPI fallback: existing panels POST to /intake/dispatch
    // with a JSON body carrying the server-side path.
    const body = await fetchJson<{ job_id: string }>(
      `/intake/dispatch?project_id=${encodeURIComponent(args.projectId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server_path: args.pdfPath,
          project_id: args.projectId,
          mode: args.mode ?? 'pipeline',
        }),
      },
    )
    return { jobId: body.job_id }
  },

  async cancelPipeline(jobId: string): Promise<void> {
    const t = await loadTauri()
    if (t) {
      await t.invoke<void>('cancel_pipeline', { jobId })
      return
    }
    await fetchJson<unknown>(
      `/intake/cancel/${encodeURIComponent(jobId)}`,
      { method: 'POST' },
    )
  },

  async pipelineStatus(jobId: string): Promise<JobStatus> {
    const t = await loadTauri()
    if (t) return t.invoke<JobStatus>('pipeline_status', { jobId })
    return fetchJson<JobStatus>(
      `/intake/status/${encodeURIComponent(jobId)}`,
    )
  },

  // Catalog / OpenSCAD --------------------------------------------

  async renderScad(args: RenderScadArgs): Promise<RenderResult> {
    const t = await loadTauri()
    if (t) return t.invoke<RenderResult>('render_scad', { args })
    return fetchJson<RenderResult>('/scad/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: args.name,
        params: args.params,
        format: args.format ?? 'glb',
      }),
    })
  },

  async scadRuntimeStatus(): Promise<RuntimeStatus> {
    const t = await loadTauri()
    if (t) return t.invoke<RuntimeStatus>('scad_runtime_status')
    return fetchJson<RuntimeStatus>('/scad/status')
  },

  async listScadTemplates(): Promise<CatalogTemplate[]> {
    const t = await loadTauri()
    if (t) return t.invoke<CatalogTemplate[]>('list_scad_templates')
    return fetchJson<CatalogTemplate[]>('/catalog/scad/templates')
  },

  // Project --------------------------------------------------------

  async listProjects(): Promise<ProjectEntry[]> {
    const t = await loadTauri()
    if (t) return t.invoke<ProjectEntry[]>('list_projects')
    return fetchJson<ProjectEntry[]>('/projects')
  },

  // Event bus ------------------------------------------------------

  /**
   * Subscribe to pipeline progress events.
   *
   * * Tauri mode: listens to the global `pipeline:progress` event
   *   (which is emitted for every job — caller filters by `job_id`).
   * * Fetch mode: the FastAPI gateway's SSE stream is per-job at
   *   `/intake/stream/:job_id`. Because this top-level subscribe
   *   function has no jobId parameter, we return an EventSource
   *   opened against `/intake/stream` (a global-broadcast alias);
   *   if that endpoint is absent the EventSource stays silent until
   *   an unsubscribe is called. For per-job streaming the caller
   *   can pass a jobId via the options argument.
   *
   * @returns a zero-arg unsubscribe function.
   */
  onPipelineProgress(
    listener: (ev: PipelineProgressEvent) => void,
    opts?: { jobId?: string },
  ): () => void {
    // Kick off the async setup but return the unsubscribe handle
    // synchronously so callers can unmount cleanly.
    let disposed = false
    let unlisten: UnlistenFn | null = null
    let source: EventSource | null = null

    void (async () => {
      const t = await loadTauri()
      if (disposed) return
      if (t) {
        unlisten = await t.listen<PipelineProgressEvent>(
          'pipeline:progress',
          (msg) => listener(msg.payload),
        )
        if (disposed) {
          unlisten?.()
          unlisten = null
        }
        return
      }
      // Fetch / SSE fallback.
      if (typeof EventSource === 'undefined') return
      const url = opts?.jobId
        ? `${GATEWAY_URL}/intake/stream/${encodeURIComponent(opts.jobId)}`
        : `${GATEWAY_URL}/intake/stream`
      source = new EventSource(url)
      source.onmessage = (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data)
          listener(parsed as PipelineProgressEvent)
        } catch {
          // Drop malformed frames silently — the sidecar is the
          // authority; a bad line here isn't worth crashing for.
        }
      }
    })()

    return () => {
      disposed = true
      if (unlisten) {
        try {
          unlisten()
        } catch {
          /* best-effort */
        }
        unlisten = null
      }
      if (source) {
        try {
          source.close()
        } catch {
          /* best-effort */
        }
        source = null
      }
    }
  },

  /**
   * Subscribe to `catalog:updated` events (dev hot-reload).
   * Fetch fallback is a no-op — the gateway doesn't broadcast
   * catalog reloads — but we still return a working unsubscribe.
   */
  onCatalogUpdated(
    listener: (ev: CatalogUpdatedEvent) => void,
  ): () => void {
    let disposed = false
    let unlisten: UnlistenFn | null = null

    void (async () => {
      const t = await loadTauri()
      if (disposed || !t) return
      unlisten = await t.listen<CatalogUpdatedEvent>(
        'catalog:updated',
        (msg) => listener(msg.payload),
      )
      if (disposed) {
        unlisten?.()
        unlisten = null
      }
    })()

    return () => {
      disposed = true
      if (unlisten) {
        try {
          unlisten()
        } catch {
          /* best-effort */
        }
        unlisten = null
      }
    }
  },
} as const

export type Ipc = typeof ipc
