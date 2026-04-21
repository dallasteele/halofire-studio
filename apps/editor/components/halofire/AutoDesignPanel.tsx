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

import { emitter, generateId, LevelNode, SlabNode, WallNode, useScene } from '@pascal-app/core'

/** Compute the bbox of a flat list of 2D points. */
function bboxOf(pts: Iterable<[number, number]>): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}
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

  const createNode = useScene((s) => s.createNode)
  const sceneNodes = useScene((s) => s.nodes)
  const deleteNode = useScene((s) => s.deleteNode)
  const updateNode = useScene((s) => (s as any).updateNode ?? (() => undefined))

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
      return (
        (Array.isArray(aTags) && aTags.includes('auto_design')) ||
        (Array.isArray(mTags) && mTags.includes('auto_design'))
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

  // When pipeline completes, spawn building shell + heads + pipes
  // into the Three.js viewport automatically (no manual clicks).
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

        // Parent strategy: create one Pascal LevelNode per architectural
        // level (under the existing Building) and one SlabNode per level
        // with the REAL polygon — not a bbox rectangle, not an empty
        // `item` with src: ''. Previous version produced red placeholder
        // boxes because it spawned `type: 'item'` nodes with no mesh src.
        const buildingId = findBuildingId()
        const defaultLevelId = findLevelId()
        if (!buildingId || !defaultLevelId) {
          setError(
            'scene render: Pascal site/building/level tree not ready — try again in a moment',
          )
          return
        }
        // Fresh run — wipe any previous auto-design spawns so the
        // viewport reflects the latest pipeline output.
        clearPreviousAutoDesign()

        // Compute the global bbox of all level polygons so we can
        // center the building at world origin (CubiCasa outputs
        // coords in the +X/+Y quadrant; without translation the
        // whole building sits 80–250 m away from the default 30 m
        // property line and looks disconnected).
        const allLevelPts: [number, number][] = []
        for (const l of design.building?.levels ?? []) {
          for (const p of l.polygon_m ?? []) allLevelPts.push(p)
        }
        const bb = allLevelPts.length > 0
          ? bboxOf(allLevelPts)
          : { minX: -15, minY: -15, maxX: 15, maxY: 15 }
        const cx = (bb.minX + bb.maxX) / 2
        const cy = (bb.minY + bb.maxY) / 2
        const rawHalfW = Math.max((bb.maxX - bb.minX) / 2, 10)
        const rawHalfH = Math.max((bb.maxY - bb.minY) / 2, 10)
        // Pascal's default OrbitControls + camera at (10,10,10) with
        // FOV 50 see comfortably out to ~50 m. Anything bigger and
        // the building either clips or fills the screen with a
        // micro-detail. Auto-scale so the building's longest side
        // fits 60 m. This also helps pages misclassified as
        // 250m-wide site plans land at a viewable size.
        const TARGET_LONGEST_M = 60
        const longest = Math.max(rawHalfW, rawHalfH) * 2
        const scale = longest > TARGET_LONGEST_M
          ? TARGET_LONGEST_M / longest
          : 1
        const halfW = rawHalfW * scale
        const halfH = rawHalfH * scale
        const PAD = 5 // metres of green around the building
        /** Shift a 2D point so the building center is at origin AND
         *  scale to TARGET_LONGEST_M. */
        const T2 = (p: [number, number]): [number, number] => [
          (p[0] - cx) * scale, (p[1] - cy) * scale,
        ]
        /** Shift a 3D point the same way (Pascal's X/Z are our X/Y). */
        const T3 = (p: [number, number, number]): [number, number, number] => [
          (p[0] - cx) * scale, (p[1] - cy) * scale, p[2] * scale,
        ]

        // Resize the existing Site polygon so the ground grid wraps
        // the whole building. Pascal draws its property line at z=0
        // — we expand it to bbox + 5 m padding so the building sits
        // inside a real lot, not floating off the 30×30 default.
        try {
          const site = Object.values(sceneNodes ?? {}).find(
            (n) => (n as { type?: string }).type === 'site',
          ) as { id: string } | undefined
          if (site) {
            updateNode(site.id as any, {
              polygon: {
                type: 'polygon',
                points: [
                  [-halfW - PAD, -halfH - PAD],
                  [halfW + PAD, -halfH - PAD],
                  [halfW + PAD, halfH + PAD],
                  [-halfW - PAD, halfH + PAD],
                ],
              },
            })
          }
        } catch {
          // best effort — Pascal may reject if the shape type is wrong
        }
        const levels: Array<{
          id: string
          name: string
          elevation_m: number
          height_m?: number
          use?: string
          polygon_m?: [number, number][]
          walls?: Array<{
            id: string
            start_m: [number, number]
            end_m: [number, number]
            thickness_m?: number
            height_m?: number
            is_exterior?: boolean
          }>
        }> = design.building?.levels ?? []
        const systems: Array<{
          id: string
          heads?: Array<{
            id: string
            position_m: [number, number, number]
            sku?: string
          }>
          pipes?: Array<{
            id: string
            size_in: number
            start_m: [number, number, number]
            end_m: [number, number, number]
          }>
        }> = design.systems ?? []

        // Map each architectural level → Pascal LevelNode id + elevation
        // so we can attach heads/pipes to the right floor.
        const levelIdByArch: Map<string, { pascalId: string; elevation: number; topZ: number }> =
          new Map()

        levels.forEach((lvl, idx) => {
          if (!lvl.polygon_m || lvl.polygon_m.length < 3) return

          // First arch level reuses Pascal's default level_0; subsequent
          // levels get brand-new LevelNodes under the Building.
          let pascalLevelId: string
          if (idx === 0) {
            pascalLevelId = defaultLevelId
          } else {
            try {
              const newLevel = LevelNode.parse({
                name: lvl.name,
                level: idx,
                children: [],
                parentId: buildingId,
                metadata: { tags: ['halofire', 'level', 'auto_design'] },
              })
              createNode(newLevel as any, buildingId as any)
              pascalLevelId = newLevel.id
            } catch {
              pascalLevelId = defaultLevelId
            }
          }
          levelIdByArch.set(lvl.id, {
            pascalId: pascalLevelId,
            elevation: lvl.elevation_m,
            topZ: lvl.elevation_m + (lvl.height_m ?? 3.0),
          })

          // Slab with the REAL concave polygon. Pascal's SlabNode extrudes
          // `polygon: [[x, z], ...]` at `elevation` via ExtrudeGeometry —
          // this is what makes the floor visible (instead of a red bbox).
          try {
            const slab = SlabNode.parse({
              name: `${lvl.name} slab`,
              polygon: (lvl.polygon_m ?? []).map(T2),
              elevation: Math.max(0.05, lvl.elevation_m || 0.05),
              parentId: pascalLevelId,
              metadata: { tags: ['halofire', 'slab', 'auto_design'] },
            })
            createNode(slab as any, pascalLevelId as any)
          } catch {
            // per-level spawn is best-effort; don't block others
          }

          // Walls from intake — cap at 200 per level so a 3000-wall
          // CubiCasa output doesn't swamp the viewport. A real floor
          // plan has 50-150 walls typically.
          const wallCap = 200
          const lvlWalls = (lvl.walls ?? []).slice(0, wallCap)
          for (const w of lvlWalls) {
            try {
              const wallNode = WallNode.parse({
                start: T2(w.start_m),
                end: T2(w.end_m),
                thickness: w.thickness_m ?? 0.2,
                height: w.height_m ?? 3.0,
                parentId: pascalLevelId,
                metadata: {
                  tags: ['halofire', 'wall', 'auto_design'],
                  isExterior: !!w.is_exterior,
                },
              })
              createNode(wallNode as any, pascalLevelId as any)
            } catch {
              // skip one bad wall, keep going
            }
          }
        })

        /** Route a head/pipe to the Pascal level whose elevation band
         *  contains its Z coordinate. Falls back to the nearest level. */
        const levelForZ = (z: number): string => {
          let best = defaultLevelId
          let bestDist = Infinity
          for (const { pascalId, elevation, topZ } of levelIdByArch.values()) {
            if (z >= elevation - 0.5 && z <= topZ + 0.5) return pascalId
            const d = Math.min(Math.abs(z - elevation), Math.abs(z - topZ))
            if (d < bestDist) {
              bestDist = d
              best = pascalId
            }
          }
          return best
        }

        // Heads — 1 sphere per head ref'd at its 3D position.
        // Cap total heads in the viewport so a 583-head design doesn't
        // swamp the scene; the FULL set still lives in design.json.
        let headsSpawned = 0
        for (const sys of systems) {
          for (const h of sys.heads ?? []) {
            if (headsSpawned >= MAX_HEADS_VIEWPORT) break
            try {
              createNode(
                {
                  id: generateId('item'),
                  type: 'item',
                  position: T3(h.position_m),
                  rotation: [0, 0, 0],
                  scale: [1, 1, 1],
                  children: [],
                  asset: {
                    id: `head_${h.id}`,
                    category: 'sprinkler_head_pendant',
                    name: h.sku ?? 'K5.6 head',
                    thumbnail: '/icons/item.png',
                    dimensions: [0.1, 0.1, 0.1],
                    src: '/halofire-catalog/glb/SM_Head_Pendant_Standard_K56.glb',
                    attachTo: 'ceiling',
                    offset: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                    tags: ['halofire', 'sprinkler_head_pendant', 'auto_design'],
                  },
                } as any,
                levelForZ(h.position_m[2]) as any,
              )
              headsSpawned++
            } catch {
              // best-effort per head
            }
          }
          if (headsSpawned >= MAX_HEADS_VIEWPORT) break
        }

        let pipesSpawned = 0
        for (const sys of systems) {
          for (const p of sys.pipes ?? []) {
            if (pipesSpawned >= MAX_PIPES_VIEWPORT) break
            try {
              const mx = (p.start_m[0] + p.end_m[0]) / 2 - cx
              const my = (p.start_m[1] + p.end_m[1]) / 2 - cy
              const mz = (p.start_m[2] + p.end_m[2]) / 2
              const dx = p.end_m[0] - p.start_m[0]
              const dy = p.end_m[1] - p.start_m[1]
              const dz = p.end_m[2] - p.start_m[2]
              const len = Math.max(
                0.01,
                Math.sqrt(dx * dx + dy * dy + dz * dz),
              )
              createNode(
                {
                  id: generateId('item'),
                  type: 'item',
                  position: [mx, my, mz],
                  rotation: [0, 0, Math.atan2(dy, dx)],
                  scale: [len, 1, 1],
                  children: [],
                  asset: {
                    id: `pipe_${p.id}`,
                    category: 'pipe_steel_sch10',
                    name: `${p.size_in}" pipe`,
                    thumbnail: '/icons/item.png',
                    dimensions: [len, p.size_in * 0.0254, p.size_in * 0.0254],
                    src: `/halofire-catalog/glb/SM_Pipe_SCH10_${String(p.size_in).replace('.', '_')}in_1m.glb`,
                    attachTo: 'ceiling',
                    offset: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                    tags: [
                      'halofire',
                      'pipe_steel_sch10',
                      `size_${p.size_in}`,
                      'auto_design',
                    ],
                  },
                } as any,
                levelForZ(mz) as any,
              )
              pipesSpawned++
            } catch {
              // best-effort
            }
          }
          if (pipesSpawned >= MAX_PIPES_VIEWPORT) break
        }
        // Frame the camera on the freshly-spawned building so the
        // user sees what we just rendered. Without this the default
        // (10,10,10) → (0,0,0) frame can't see a 140×72 m level
        // that's centered at origin and the viewport looks blank.
        // Wait two animation frames so R3F has actually mounted the
        // new slab/wall meshes into sceneRegistry — emitting earlier
        // is a no-op because focusNode looks them up by id.
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
    [createNode, findLevelId, findBuildingId, clearPreviousAutoDesign],
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
