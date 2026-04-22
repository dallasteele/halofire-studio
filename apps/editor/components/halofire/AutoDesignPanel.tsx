'use client'

/**
 * AutoDesignPanel — ONE button, one result.
 *
 * Replaces the 6-section click-through Fire Protection panel. The
 * agent roster does the work:
 *   1. Upload / select an architect PDF (or the embedded 1881 arch)
 *   2. Pipeline runs: intake → classify → place → route → calc →
 *      rulecheck → bom → labor → proposal → submittal
 *   3. Scene auto-renders building shell + placed heads + routed
 *      pipes as the pipeline stages finish
 *   4. Deliverables served directly from gateway
 *
 * Per AGENTIC_RULES §13: honest status every step. If intake returns
 * zero walls, the UI says so — it does NOT spawn a fake building.
 */

import { emitter, useScene } from '@pascal-app/core'
import { translateDesignToScene } from '@halofire/core/scene/spawn-from-design'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ipc } from '@/lib/ipc'

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18080'

interface Step {
  step: string
  stats?: Record<string, unknown>
  error?: string | null
}

interface JobStatus {
  job_id: string
  project_id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  percent: number
  steps_complete: string[]
  error?: string | null
  summary?: {
    project_id: string
    steps: Step[]
    files: Record<string, string>
  } | null
}

const PRESETS = [
  {
    id: 'upload',
    label: 'Upload your own architect PDF / IFC / DWG',
  },
  {
    id: '1881-architecturals',
    label: '1881 Cooperative — full architectural set (110 pages)',
    path: 'E:/ClaudeBot/HaloFireBidDocs/1-Bid Documents/GC - Bid Plans/1881 - Architecturals.pdf',
  },
  {
    id: '1881-fire-rfis',
    label: '1881 Fire RFIs (small, fast smoke test)',
    path: 'E:/ClaudeBot/HaloFireBidDocs/1-Bid Documents/GC - Bid Plans/1881 Fire RFI\'s.pdf',
  },
]

export function AutoDesignPanel({ projectId }: { projectId: string }) {
  const [preset, setPreset] = useState<string>('1881-architecturals')
  const [file, setFile] = useState<File | null>(null)
  const [job, setJob] = useState<JobStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const createNodes = useScene((s) => s.createNodes)
  const sceneNodes = useScene((s) => s.nodes)
  const deleteNode = useScene((s) => s.deleteNode)

  /** Find the first `building` node — we need it as the parent when
   *  we create one Pascal LevelNode per architectural level. */
  const findBuildingId = useCallback((): string | undefined => {
    for (const n of Object.values(sceneNodes ?? {})) {
      const typed = n as { type?: string; id?: string }
      if (typed?.type === 'building' && typed.id) return typed.id
    }
    return undefined
  }, [sceneNodes])

  /** Locate the first `level` node in the scene tree — same pattern
   *  SceneBootstrap uses. Returns undefined if the tree isn't ready
   *  yet; caller will retry on next render.
   *
   *  The cast to any is intentional: Pascal's AnyNodeId is a
   *  template-literal union (`site_${string}` | `level_${string}`
   *  | …). A level-node id looked up at runtime is the same string
   *  shape the type system wants, but TypeScript can't prove that
   *  from a `for…of Object.values(…)` walk. The createNode call
   *  already uses `as any` at the node boundary for the same
   *  reason. */
  const findLevelId = useCallback((): string | undefined => {
    for (const n of Object.values(sceneNodes ?? {})) {
      const typed = n as { type?: string; id?: string }
      if (typed?.type === 'level' && typed.id) return typed.id
    }
    return undefined
  }, [sceneNodes])

  /** Find the first `site` node, so we can tell translateDesignToScene
   *  to reuse it instead of spawning a duplicate SiteNode. */
  const findSiteId = useCallback((): string | undefined => {
    for (const n of Object.values(sceneNodes ?? {})) {
      const typed = n as { type?: string; id?: string }
      if (typed?.type === 'site' && typed.id) return typed.id
    }
    return undefined
  }, [sceneNodes])

  /** Remove any previous auto_design spawns so re-runs don't pile up.
   *  Pascal's deleteNode is forgiving when called on already-deleted
   *  ids, but it can leave orphaned children if a parent goes first.
   *  Two-pass delete: leaves first (walls, slabs, items), containers
   *  second (levels) — keeps the default level_0 + building + site so
   *  a fresh render still has a parent tree to attach into.
   *
   *  Scans both `asset.tags` (item nodes) and `metadata.tags` (slab /
   *  level / wall nodes) — base Pascal nodes have no `asset` field so
   *  we tag them via metadata.tags instead. Always reads the LIVE
   *  store via useScene.getState() so back-to-back clear calls see
   *  fresh state.
   */
  const clearPreviousAutoDesign = useCallback(() => {
    const isAutoDesign = (n: any): boolean => {
      const aTags = n?.asset?.tags ?? []
      const mTags = n?.metadata?.tags ?? []
      const tagSet = [...(Array.isArray(aTags) ? aTags : []), ...(Array.isArray(mTags) ? mTags : [])]
      return (
        tagSet.includes('auto_design')
        // Also wipe stale BuildingGenerator artifacts that 404 on
        // load (their `building_shell` ItemNode points at a GLB the
        // gateway doesn't actually serve, throwing a Runtime Error
        // that blocks the whole viewport).
        || tagSet.includes('building_shell')
        || tagSet.includes('synthetic')
      )
    }
    const live = (useScene.getState() as any).nodes ?? {}
    const all = Object.values(live) as any[]
    // Pass 1: leaves
    const leafTypes = new Set(['wall', 'slab', 'item', 'zone'])
    for (const n of all) {
      if (leafTypes.has(n.type) && isAutoDesign(n)) {
        try { deleteNode(n.id as any) } catch { /* best effort */ }
      }
    }
    // Pass 2: containers (levels) — re-read live state because pass-1
    // edits may have removed children
    const live2 = (useScene.getState() as any).nodes ?? {}
    for (const n of Object.values(live2) as any[]) {
      if (n.type === 'level' && isAutoDesign(n)) {
        try { deleteNode(n.id as any) } catch { /* best effort */ }
      }
    }
    // Pass 3: kill Pascal's stock default LevelNode (level=0) — it
    // collides with our level=0 and Pascal's level-system stacks
    // duplicates at Y=0, collapsing the building. The default level
    // has no children of its own (no walls/slabs/items), so removing
    // it is safe.
    const live3 = (useScene.getState() as any).nodes ?? {}
    for (const n of Object.values(live3) as any[]) {
      if (
        n.type === 'level'
        && (!n.children || n.children.length === 0)
      ) {
        try { deleteNode(n.id as any) } catch { /* best effort */ }
      }
    }
    // Pass 4: collapse duplicate Building / Site nodes to one each.
    // Pascal's stock + ProjectBriefPanel each spawn a Site/Building
    // pair, and every "Render last bid" without a clean-up adds
    // another. Multiple Buildings at the same coordinates means the
    // viewer renders them stacked / clipping / fighting for the
    // camera's attention. Keep the FIRST of each type, delete the
    // rest.
    const live4 = (useScene.getState() as any).nodes ?? {}
    const seenBuilding = new Set<string>()
    const seenSite = new Set<string>()
    for (const n of Object.values(live4) as any[]) {
      if (n.type === 'building') {
        if (seenBuilding.size > 0) {
          try { deleteNode(n.id as any) } catch { /* best effort */ }
        } else seenBuilding.add(n.id)
      }
      if (n.type === 'site') {
        if (seenSite.size > 0) {
          try { deleteNode(n.id as any) } catch { /* best effort */ }
        } else seenSite.add(n.id)
      }
    }
  }, [deleteNode])

  // R3.1 — the 150-head cap was necessary when each head mounted a
  // per-node <ItemRenderer> (+ a drei <Clone> of the GLB scene).
  // InstancedCatalogRenderer now collapses N heads of the same SKU
  // into one draw call, so jobs with thousands of heads render at
  // 60 fps. We keep a 10k safety ceiling so a corrupt design.json
  // can't allocate an unbounded InstancedMesh. The full set still
  // lives in design.json for the pipeline.
  const MAX_HEADS_VIEWPORT = 10_000
  const MAX_PIPES_VIEWPORT = 10_000

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stopPoll(), [stopPoll])

  // (Previous iteration auto-cleared on mount to wipe stale 404
  // building_shell nodes — but that nuked the rendered building
  // 100 ms after every page reload. Removed. Stale-node sweep now
  // runs only on explicit Clear scene / Render last bid clicks.)

  // When pipeline completes, spawn building shell + heads + pipes
  // into the Three.js viewport automatically (no manual clicks).
  //
  // R2.2 — the 500-line inline scene-spawn has been extracted to
  // `@halofire/core/scene/spawn-from-design`. This callback now:
  //   1. Fetches design.json from the gateway (unchanged)
  //   2. Asks hf-core for a typed NodeCreateOp[] with the viewport
  //      caps baked in
  //   3. Clears stale auto-design nodes, reuses the existing Site +
  //      Building if present, then batches the ops through
  //      useScene.createNodes
  //   4. Emits camera-controls:focus on the Building so the user
  //      sees what was spawned
  const renderResults = useCallback(
    async (pid: string) => {
      try {
        // Load the design.json (generated by the pipeline) to know
        // what to spawn.
        // TODO(R10.3 gap): no Tauri command yet for reading a
        // project's design.json — follow-up can add
        // `ipc.readProjectFile({ projectId, name: 'design.json' })`
        // so the desktop shell reads from disk without a gateway.
        const res = await fetch(
          `${GATEWAY_URL}/projects/${pid}/design.json`,
        )
        if (!res.ok) return
        const design = await res.json()

        // Fresh run — wipe any previous auto-design spawns so the
        // viewport reflects the latest pipeline output. Cleanup still
        // needs to happen here because translateDesignToScene only
        // emits create ops; it does not know about the prior scene.
        clearPreviousAutoDesign()

        // Reuse the pre-existing Site + Building if any survived the
        // clear pass (default Pascal SceneBootstrap spawns them). If
        // they don't exist, translateDesignToScene will emit fresh
        // SiteNode + BuildingNode ops at the head of the list.
        const existingSiteId = findSiteId()
        const existingBuildingId = findBuildingId()

        const ops = translateDesignToScene(design, {
          site_id: existingSiteId,
          building_id: existingBuildingId,
          max_heads: MAX_HEADS_VIEWPORT,
          max_pipes: MAX_PIPES_VIEWPORT,
        })

        // Single batched scene transaction — createNodes runs one
        // zustand `set` for the whole list, so the viewport only
        // re-renders once instead of per-op.
        createNodes(
          ops.map((op) => ({ node: op.node as any, parentId: op.parentId as any })),
        )

        // Locate the Building we just spawned (or the reused one) for
        // camera framing.
        const buildingId = existingBuildingId
          ?? ops.find((o) => o.node?.type === 'building')?.node?.id
          ?? findBuildingId()
        if (!buildingId) {
          setError(
            'scene render: no Building node present after spawn — check design.json',
          )
          return
        }

        // Camera framing — wait two animation frames so R3F has
        // actually mounted the new slab/wall meshes into
        // sceneRegistry before emitting focus. Emitting earlier is
        // a no-op because focusNode looks nodes up by id.
        try {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            emitter.emit('camera-controls:focus', { nodeId: buildingId })
          }))
        } catch {
          // emitter may be uninitialized in tests
        }
      } catch (e) {
        setError(`scene render: ${String(e)}`)
      }
      // Diagnostic: expose scene store to window so we can
      // self-verify node counts from the preview browser.
      try {
        const allNodes = Object.values(
          (useScene.getState() as any).nodes ?? {},
        )
        const byType: Record<string, number> = {}
        const autoDesign: Record<string, number> = {}
        for (const n of allNodes as any[]) {
          byType[n.type] = (byType[n.type] || 0) + 1
          const tags = [
            ...((n.asset?.tags as string[]) ?? []),
            ...((n.metadata?.tags as string[]) ?? []),
          ]
          if (tags.includes('auto_design')) {
            autoDesign[n.type] = (autoDesign[n.type] || 0) + 1
          }
        }
        ;(window as any).__hf_scene_snapshot = {
          total: allNodes.length,
          byType,
          autoDesign,
          at: new Date().toISOString(),
        }
      } catch {
        // best-effort diagnostic
      }
    },
    [createNodes, findBuildingId, findSiteId, clearPreviousAutoDesign],
  )

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    setJob(null)
    stopPoll()

    try {
      let jobId: string
      const chosen = PRESETS.find((p) => p.id === preset)
      if (preset === 'upload') {
        if (!file) {
          throw new Error('pick a file first')
        }
        // Multipart upload has no Tauri IPC command yet (files live
        // only in the browser memory, not on a server-side path the
        // Rust side can read). Keep the fetch-multipart path here —
        // TODO R10.4: add a `upload_pipeline` Tauri command that
        // streams the File buffer into a gateway multipart request.
        const form = new FormData()
        form.append('file', file)
        form.append('project_id', projectId)
        form.append('mode', 'pipeline')
        const uploadRes = await fetch(
          `${GATEWAY_URL}/intake/upload?project_id=${projectId}`,
          { method: 'POST', body: form },
        )
        if (!uploadRes.ok) {
          const txt = await uploadRes.text()
          throw new Error(
            `upload HTTP ${uploadRes.status}: ${txt.slice(0, 200)}`,
          )
        }
        const uploadBody = await uploadRes.json()
        jobId = uploadBody.job_id
      } else if (chosen?.path) {
        // Server-path preset: go through the ipc facade. In Tauri it
        // dispatches `run_pipeline`; in browser dev it POSTs to
        // /intake/dispatch via the fetch fallback.
        const started = await ipc.runPipeline({
          pdfPath: chosen.path,
          projectId,
        })
        jobId = started.jobId
      } else {
        throw new Error('no file and no preset selected')
      }

      setJob({
        job_id: jobId,
        project_id: projectId,
        status: 'queued',
        percent: 0,
        steps_complete: [],
      })
      // V2 step 5 — tell AutoPilot to attach to this job's SSE stream.
      window.dispatchEvent(
        new CustomEvent('halofire:job-started', { detail: { jobId } }),
      )

      pollRef.current = setInterval(async () => {
        try {
          const s = await ipc.pipelineStatus(jobId)
          setJob(s)
          if (s.status === 'completed') {
            stopPoll()
            await renderResults(projectId)
          } else if (s.status === 'failed') {
            stopPoll()
          }
        } catch {
          // transient; keep polling
        }
      }, 2500)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [preset, file, projectId, stopPoll, renderResults])

  return (
    <div className="hf-scroll flex h-full flex-col gap-4 overflow-y-auto px-3 py-4">
      {/* Hero header — the single most important entry point in the
          whole app. Fraunces wordmark, small-caps crumb, prose intent. */}
      <header className="pb-1">
        <div className="hf-label tracking-[0.24em] pb-1">Primary action</div>
        <h2
          className="text-[26px] leading-none tracking-tight text-[var(--color-hf-paper)]"
          style={{
            fontFamily: 'var(--font-fraunces), serif',
            fontVariationSettings: '"SOFT" 30, "WONK" 0, "opsz" 144',
          }}
        >
          Auto-Design
        </h2>
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--color-hf-ink-mute)]">
          Drop an architect set. The agent roster runs intake, classification,
          head placement, pipe routing, hydraulic solve, rule check, BOM, labor
          and proposal — every stage streams into the viewport as it lands.
        </p>
      </header>

      <div className="hf-card p-3">
        <label className="hf-label tracking-[0.22em]">Source</label>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          style={{ borderRadius: 0 }}
          className="mt-1.5 w-full border border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)] px-2 py-1.5 text-[11.5px] text-[var(--color-hf-paper)] focus:border-[var(--color-hf-accent)] focus:outline-none"
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>

        {preset === 'upload' && (
          <div className="mt-2">
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.ifc,.dwg,.dxf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-[11px] text-[var(--color-hf-ink-mute)] file:mr-2 file:border file:border-[var(--color-hf-edge)] file:bg-[var(--color-hf-surface-2)] file:px-2 file:py-1 file:text-[10px] file:uppercase file:tracking-wider file:text-[var(--color-hf-paper)]"
            />
            {file && (
              <p className="mt-1 hf-num text-[10px] text-[var(--color-hf-ink-dim)]">
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={run}
          style={{ borderRadius: 0 }}
          className="mt-3 w-full border border-[rgba(232,67,45,0.8)] bg-[linear-gradient(180deg,rgba(232,67,45,0.3),rgba(232,67,45,0.1))] px-3 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-white hover:border-[var(--color-hf-accent)] hover:bg-[rgba(232,67,45,0.35)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? 'Dispatching…' : 'Run Auto-Design'}
        </button>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => { void renderResults(projectId) }}
            style={{ borderRadius: 0 }}
            className="border border-[var(--color-hf-edge)] bg-transparent px-2 py-1.5 text-[10.5px] uppercase tracking-[0.1em] text-[var(--color-hf-paper)] hover:border-[var(--color-hf-accent)]/60 hover:bg-[var(--color-hf-surface-2)] disabled:opacity-40"
            title="Load the last completed design into the viewport"
          >
            Render last
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => clearPreviousAutoDesign()}
            style={{ borderRadius: 0 }}
            className="border border-[var(--color-hf-edge)] bg-transparent px-2 py-1.5 text-[10.5px] uppercase tracking-[0.1em] text-[var(--color-hf-ink-mute)] hover:border-[var(--color-hf-edge-strong)] hover:text-[var(--color-hf-paper)] disabled:opacity-40"
            title="Wipe every auto-design slab/wall/level/item from the scene"
          >
            Clear scene
          </button>
        </div>
      </div>

      {error && (
        <div
          className="border-l-2 border-[var(--color-hf-brick)] bg-[rgba(154,60,60,0.08)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-hf-paper)]"
          style={{ borderRadius: 0 }}
        >
          <div className="hf-label text-[var(--color-hf-brick)]">Error</div>
          <div className="mt-1 font-[var(--font-plex)]">{error}</div>
        </div>
      )}

      {job && (
        <div className="hf-card p-3">
          <div className="flex items-center justify-between pb-2">
            <span className="hf-num text-[10px] text-[var(--color-hf-ink-dim)]">
              {job.job_id.slice(0, 8)}
            </span>
            <JobStatusPill status={job.status} />
          </div>
          {job.steps_complete.length > 0 && (
            <ol className="mt-1 space-y-1 border-t border-[var(--color-hf-edge)] pt-2">
              {job.steps_complete.map((s, i) => (
                <li
                  key={s}
                  className="flex items-center gap-2 text-[10.5px] text-[var(--color-hf-ink-mute)]"
                >
                  <span
                    aria-hidden
                    className="inline-block h-1 w-1 bg-[var(--color-hf-moss)]"
                  />
                  <span className="hf-num text-[9px] text-[var(--color-hf-ink-deep)]">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="font-[var(--font-plex)]">{s}</span>
                </li>
              ))}
            </ol>
          )}
          {job.summary?.steps && (
            <details className="mt-2">
              <summary className="cursor-pointer hf-label hover:text-[var(--color-hf-paper)]">
                Pipeline detail · {job.summary.steps.length} steps
              </summary>
              <pre
                className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap border border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)] p-1.5 font-[var(--font-numeric)] text-[9px] text-[var(--color-hf-ink-mute)] hf-scroll"
                style={{ borderRadius: 0 }}
              >
                {JSON.stringify(job.summary.steps, null, 2)}
              </pre>
            </details>
          )}
          {job.error && (
            <p className="mt-2 text-[11px] text-[var(--color-hf-brick)]">
              {job.error}
            </p>
          )}
          {job.status === 'completed' && (
            <div className="mt-3 space-y-1 border-t border-[var(--color-hf-edge)] pt-2">
              <p className="hf-label pb-1">Deliverables</p>
              {['proposal.json', 'proposal.pdf', 'design.dxf', 'design.glb', 'design.ifc'].map((name) => (
                <a
                  key={name}
                  href={`${GATEWAY_URL}/projects/${projectId}/deliverable/${name}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ borderRadius: 0 }}
                  className="flex items-center justify-between border border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)] px-2 py-1.5 hf-num text-[10.5px] text-[var(--color-hf-paper)] hover:border-[var(--color-hf-accent)]/60 hover:bg-[var(--color-hf-surface-2)] transition-colors"
                >
                  <span>{name}</span>
                  <span className="hf-label text-[var(--color-hf-accent)]">open ↗</span>
                </a>
              ))}
              <a
                href={`/bid/${projectId}`}
                target="_blank"
                rel="noreferrer"
                style={{ borderRadius: 0 }}
                className="mt-2 flex items-center justify-between border border-[rgba(232,67,45,0.7)] bg-[linear-gradient(180deg,rgba(232,67,45,0.22),rgba(232,67,45,0.08))] px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-white hover:bg-[rgba(232,67,45,0.3)]"
              >
                <span>Open bid viewer</span>
                <span>↗</span>
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function JobStatusPill({
  status,
}: {
  status: JobStatus['status']
}) {
  const [bg, fg, dot] =
    status === 'completed'
      ? ['rgba(107,142,58,0.14)', 'var(--color-hf-moss)', 'var(--color-hf-moss)']
      : status === 'failed'
        ? ['rgba(154,60,60,0.14)', 'var(--color-hf-brick)', 'var(--color-hf-brick)']
        : ['rgba(200,154,60,0.14)', 'var(--color-hf-gold)', 'var(--color-hf-gold)']
  return (
    <span
      className="inline-flex items-center gap-1.5 border px-2 py-0.5 hf-label"
      style={{
        background: bg,
        color: fg,
        borderColor: bg,
        borderRadius: 0,
      }}
    >
      <span
        aria-hidden
        className={
          'inline-block h-1 w-1 ' +
          (status === 'running' || status === 'queued' ? 'hf-pulse-hot' : '')
        }
        style={{ background: dot }}
      />
      {status}
    </span>
  )
}
