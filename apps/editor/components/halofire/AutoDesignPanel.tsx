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

  // Cap how many heads + pipes the auto-design dumps into the live
  // viewport at once — a 583-head / 194-pipe 1881 design would swamp
  // the scene. The full set stays in design.json for the pipeline;
  // this is viewport-only throttling.
  const MAX_HEADS_VIEWPORT = 150
  const MAX_PIPES_VIEWPORT = 150

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
      let uploadRes: Response
      const chosen = PRESETS.find((p) => p.id === preset)
      if (preset === 'upload') {
        if (!file) {
          throw new Error('pick a file first')
        }
        const form = new FormData()
        form.append('file', file)
        form.append('project_id', projectId)
        form.append('mode', 'pipeline')
        uploadRes = await fetch(
          `${GATEWAY_URL}/intake/upload?project_id=${projectId}`,
          { method: 'POST', body: form },
        )
      } else if (chosen?.path) {
        // Preset: just POST a JSON with server-side path. A
        // /intake/dispatch endpoint handles this flow for dev;
        // if unavailable, fall back to a client-side fetch+upload.
        uploadRes = await fetch(
          `${GATEWAY_URL}/intake/dispatch?project_id=${projectId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              server_path: chosen.path,
              project_id: projectId,
            }),
          },
        )
      } else {
        throw new Error('no file and no preset selected')
      }

      if (!uploadRes.ok) {
        const txt = await uploadRes.text()
        throw new Error(`upload HTTP ${uploadRes.status}: ${txt.slice(0, 200)}`)
      }
      const uploadBody = await uploadRes.json()
      const jobId = uploadBody.job_id
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
          const r = await fetch(`${GATEWAY_URL}/intake/status/${jobId}`)
          if (!r.ok) return
          const s = await r.json()
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
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-sm">
      <div>
        <h2 className="mb-1 text-base font-semibold">Auto-Design</h2>
        <p className="text-[11px] text-neutral-500">
          Drop an architect PDF / IFC / DWG. The agent pipeline runs:
          intake → classify → place heads → route pipes → hydraulic
          calc → rule check → BOM + labor → proposal + submittal.
          Everything renders in the viewport automatically.
        </p>
      </div>

      <div className="rounded border border-neutral-300 p-3 dark:border-neutral-700">
        <label className="block text-xs font-semibold">Source</label>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className="mt-1 w-full rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
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
              className="w-full text-[11px]"
            />
            {file && (
              <p className="mt-1 text-[10px] text-neutral-500">
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={run}
          className="mt-3 w-full rounded bg-[#e8432d] px-3 py-2 text-sm font-semibold text-white hover:bg-[#c43719] disabled:opacity-50"
        >
          {busy ? 'Dispatching…' : 'Run Auto-Design'}
        </button>

        {/* Quick re-populate after a page reload — reads the last
            design.json off disk and spawns the scene nodes without
            re-running the ~3-minute pipeline. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => { void renderResults(projectId) }}
          className="mt-2 w-full rounded border border-white/15 bg-transparent px-3 py-1.5 text-xs text-neutral-200 hover:bg-white/5 disabled:opacity-50"
          title="Load the last completed design into the viewport"
        >
          Render last bid
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => clearPreviousAutoDesign()}
          className="mt-2 w-full rounded border border-white/10 bg-transparent px-3 py-1.5 text-xs text-neutral-400 hover:bg-white/5 disabled:opacity-50"
          title="Wipe every auto-design slab/wall/level/item from the scene"
        >
          Clear scene
        </button>
      </div>

      {error && (
        <div className="rounded bg-red-50 p-2 text-[11px] text-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {job && (
        <div className="rounded border border-neutral-300 p-2 text-[11px] dark:border-neutral-700">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px]">
              {job.job_id.slice(0, 8)}
            </span>
            <span
              className={`rounded px-2 py-0.5 font-mono text-[10px] ${
                job.status === 'completed'
                  ? 'bg-green-200 text-green-900 dark:bg-green-950 dark:text-green-300'
                  : job.status === 'failed'
                    ? 'bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-300'
                    : 'bg-amber-200 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
              }`}
            >
              {job.status}
            </span>
          </div>
          {job.steps_complete.length > 0 && (
            <ol className="mt-2 space-y-0.5 text-[10px] text-neutral-600 dark:text-neutral-400">
              {job.steps_complete.map((s) => (
                <li key={s} className="font-mono">
                  ✓ {s}
                </li>
              ))}
            </ol>
          )}
          {job.summary?.steps && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[10px] text-neutral-500">
                Pipeline detail ({job.summary.steps.length} steps)
              </summary>
              <pre className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap rounded bg-neutral-100 p-1 text-[9px] dark:bg-neutral-900">
                {JSON.stringify(job.summary.steps, null, 2)}
              </pre>
            </details>
          )}
          {job.error && (
            <p className="mt-1 text-red-700 dark:text-red-300">
              {job.error}
            </p>
          )}
          {job.status === 'completed' && (
            <div className="mt-2 space-y-1">
              <p className="text-[10px] font-semibold">Deliverables:</p>
              {['proposal.json', 'proposal.pdf', 'design.dxf', 'design.glb', 'design.ifc'].map((name) => (
                <a
                  key={name}
                  href={`${GATEWAY_URL}/projects/${projectId}/deliverable/${name}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded bg-neutral-800 px-2 py-1 text-center text-[10px] text-white hover:bg-neutral-700"
                >
                  {name}
                </a>
              ))}
              <a
                href={`/bid/${projectId}`}
                target="_blank"
                rel="noreferrer"
                className="block rounded bg-[#e8432d] px-2 py-1 text-center text-[10px] font-semibold text-white hover:bg-[#c43719]"
              >
                Open bid viewer ↗
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
