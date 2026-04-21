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

import { CeilingNode, emitter, generateId, LevelNode, SlabNode, WallNode, useScene } from '@pascal-app/core'

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

/** Signed area (positive = CCW in plan, negative = CW). */
function signedArea(pts: [number, number][]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

/** Orient polygon CCW so Pascal's slab extrudes with normals UP. */
function ccwOrient(pts: [number, number][]): [number, number][] {
  return signedArea(pts) >= 0 ? pts : [...pts].reverse()
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

        // Per-level centering. Each PDF page has walls in a
        // different part of page-coordinate space, so a global
        // bbox-center makes each level's polygon land at a
        // different XY position relative to origin → floors look
        // stacked but offset laterally. Computing per-level
        // centroids and shifting each level's geometry by ITS OWN
        // centroid lines all the floors up under each other,
        // matching how the real building stacks.
        //
        // Render at 1:1 metres. The previous autoscale shrank a
        // 250 m bbox to 60 m → 0.2 m walls became 0.05 m walls and
        // pipes became 6 mm specks. Real residential floors are
        // 30-60 m wide; a camera that can't frame them needs to
        // dolly back, not shrink the building.
        const scale = 1.0
        const PAD = 5 // metres of green around the building
        // Per-level centroid map: levelId → [cx, cy]
        const levelCenter: Map<string, [number, number]> = new Map()
        for (const l of design.building?.levels ?? []) {
          const pts = l.polygon_m ?? []
          if (pts.length < 1) {
            levelCenter.set(l.id, [0, 0])
            continue
          }
          const bb = bboxOf(pts)
          levelCenter.set(l.id, [
            (bb.minX + bb.maxX) / 2,
            (bb.minY + bb.maxY) / 2,
          ])
        }
        // Global anchor = centroid of the FIRST level's centroid, so
        // ground floor is centered at origin and upper floors stack
        // by elevation alone.
        const firstLevelId = (design.building?.levels ?? [])[0]?.id ?? ''
        const [gx, gy] = levelCenter.get(firstLevelId) ?? [0, 0]
        // Site polygon size = bbox of FIRST level's polygon (the
        // actual ground footprint).
        const firstLevelPts = (design.building?.levels ?? [])[0]?.polygon_m ?? []
        const firstBB = firstLevelPts.length
          ? bboxOf(firstLevelPts)
          : { minX: -15, minY: -15, maxX: 15, maxY: 15 }
        const halfW = Math.max((firstBB.maxX - firstBB.minX) / 2, 10)
        const halfH = Math.max((firstBB.maxY - firstBB.minY) / 2, 10)

        /** Shift a 2D plan point by THIS LEVEL's centroid so the
         *  level lands centered at origin. */
        const T2 = (
          p: [number, number], levelId: string,
        ): [number, number] => {
          const [lcx, lcy] = levelCenter.get(levelId) ?? [gx, gy]
          return [(p[0] - lcx) * scale, (p[1] - lcy) * scale]
        }
        /** Convert plan (x, y, z_world) → Pascal LEVEL-LOCAL
         *  (x, y_in_level, z) for ItemNode positions. Pascal's
         *  level-system positions each LevelNode at the right
         *  world-Y; children of the level get position in the level
         *  frame where Y=0 is the level floor. So we need to:
         *    * x → x - level_centroid_x       (centred on level)
         *    * y → z_world - level.elevation  (height inside level)
         *    * z → y_plan - level_centroid_y  (centred on level)
         *  This puts a head with deflector 0.1 m below the ceiling
         *  at level-local Y = 2.9 inside a 3 m level frame.
         */
        const archLevels = design.building?.levels ?? []
        const T3 = (
          p: [number, number, number], levelId: string,
        ): [number, number, number] => {
          const [lcx, lcy] = levelCenter.get(levelId) ?? [gx, gy]
          const lvl = archLevels.find((l: any) => l.id === levelId)
          const baseElev = lvl?.elevation_m ?? 0
          return [
            (p[0] - lcx) * scale,
            (p[2] - baseElev) * scale,
            (p[1] - lcy) * scale,
          ]
        }

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
            role?: string
          }>
        }> = design.systems ?? []

        // Map each architectural level → Pascal LevelNode id + elevation
        // so we can attach heads/pipes to the right floor.
        const levelIdByArch: Map<string, { pascalId: string; elevation: number; topZ: number }> =
          new Map()

        levels.forEach((lvl, idx) => {
          if (!lvl.polygon_m || lvl.polygon_m.length < 3) return

          // Create a brand-new LevelNode for every architectural
          // level. We previously reused Pascal's default level_0
          // for idx=0, but that left a competing un-tagged level
          // at level=0 when we also created level=0 ourselves —
          // Pascal's level-system stacks by `level` integer so the
          // duplicate collapsed everything to Y=0. Now every level
          // we spawn is auto_design-tagged and gets a clean
          // sequential level number.
          let pascalLevelId: string
          try {
            const newLevel = LevelNode.parse({
              name: lvl.name,
              // LevelSystem sorts by `level` integer + stacks via
              // cumulative getLevelHeight(). Sequential 0..N so the
              // building stacks bottom-up with no gaps.
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
          levelIdByArch.set(lvl.id, {
            pascalId: pascalLevelId,
            elevation: lvl.elevation_m,
            topZ: lvl.elevation_m + (lvl.height_m ?? 3.0),
          })

          // Pascal SlabNode: polygon is [x, z] LEVEL-LOCAL coords
          // and `elevation` is SLAB THICKNESS (default 0.05). Setting
          // it to lvl.elevation_m (e.g. 30 m for the top floor)
          // produced 30 m-thick concrete blocks. Slab thickness is
          // ~0.2 m for real concrete; LevelSystem stacks levels
          // vertically by reading getLevelHeight() of each level's
          // children. We add a CeilingNode below to set that to 3 m.
          // CCW-orient the polygon so Pascal's slab extrudes with
          // normals UP (visible from above as a floor, not a ceiling).
          const slabPoly: [number, number][] = ccwOrient(
            (lvl.polygon_m ?? []).map((p) => T2(p, lvl.id)),
          )

          try {
            const slab = SlabNode.parse({
              name: `${lvl.name} slab`,
              polygon: slabPoly,
              elevation: 0.2,
              parentId: pascalLevelId,
              metadata: { tags: ['halofire', 'slab', 'auto_design'] },
            })
            createNode(slab as any, pascalLevelId as any)
          } catch {
            // per-level spawn is best-effort; don't block others
          }
          // Ceiling drives level height — without it Pascal's
          // getLevelHeight defaults to 2.5 m and stacking is wrong.
          try {
            const ceil = CeilingNode.parse({
              name: `${lvl.name} ceiling`,
              polygon: slabPoly,
              height: lvl.height_m ?? 3.0,
              parentId: pascalLevelId,
              metadata: { tags: ['halofire', 'ceiling', 'auto_design'] },
            } as any)
            createNode(ceil as any, pascalLevelId as any)
          } catch {
            // ceiling is optional — fall through with default 2.5 m
          }

          // STRUCTURAL COLUMNS — proper catalog item rendered from
          // OpenSCAD-authored geometry (column.scad / Trimesh
          // fallback at packages/halofire-catalog/authoring/scad/).
          // The GLB lives at /halofire-catalog/glb/SM_Column_*. We
          // pre-rendered a 16"-square × 10' tall reinforced
          // concrete column; AutoDesignPanel scales it to match
          // the per-column dimension from intake's obstruction
          // polygon. NO MORE BrokenItemFallback red wireframes.
          const obstructions = (lvl as any).obstructions ?? []
          for (const o of obstructions) {
            if (o.kind !== 'column' || !o.polygon_m || o.polygon_m.length < 3) continue
            try {
              const xs = o.polygon_m.map((p: [number, number]) => p[0])
              const ys = o.polygon_m.map((p: [number, number]) => p[1])
              const cx = xs.reduce((a: number, b: number) => a + b, 0) / xs.length
              const cy = ys.reduce((a: number, b: number) => a + b, 0) / ys.length
              const w = Math.max(0.2, Math.max(...xs) - Math.min(...xs))
              const d = Math.max(0.2, Math.max(...ys) - Math.min(...ys))
              const h = (o.top_z_m ?? 3.0) - (o.bottom_z_m ?? 0.0)
              // GLB is 16" × 10' reinforced concrete. Scale to fit
              // the obstruction's actual footprint + height.
              const baselineMmX = 16 * 0.0254  // 0.4064 m
              const baselineHM = 10 * 0.3048   // 3.048 m
              const sx = w / baselineMmX
              const sz = d / baselineMmX
              const sy = h / baselineHM
              createNode(
                {
                  id: generateId('item'),
                  type: 'item',
                  // Column GLB is centered at origin; Pascal item
                  // position[1] is level-local Y, so place at h/2
                  // so the column sits on the slab.
                  position: [cx, h / 2, cy],
                  rotation: [0, 0, 0],
                  scale: [sx, sy, sz],
                  children: [],
                  asset: {
                    id: `column_${o.id}`,
                    category: 'column',
                    name: 'Reinforced concrete column',
                    thumbnail: '/icons/item.png',
                    dimensions: [w, h, d],
                    src: '/halofire-catalog/glb/SM_Column_Concrete_16in_10ft.glb',
                    attachTo: 'floor',
                    offset: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                    tags: [
                      'halofire', 'column', 'auto_design',
                      'halofire_pipe_color:#71717a',
                    ],
                  },
                  metadata: { tags: ['halofire', 'column', 'auto_design'] },
                } as any,
                pascalLevelId as any,
              )
            } catch {
              // best effort
            }
          }

          // CLEAN PERIMETER WALLS — one wall per slab edge, NOT the
          // 100-500 fragmented CubiCasa segments. Real fire-protection
          // visualizations show the building shell + interior
          // partitions; CubiCasa noise (dimension hatching, leaders,
          // etc.) only adds visual chaos. We extrude one 0.2 m × 3 m
          // wall along each slab perimeter edge.
          if (slabPoly.length >= 3) {
            for (let i = 0; i < slabPoly.length; i++) {
              const a = slabPoly[i]!
              const b = slabPoly[(i + 1) % slabPoly.length]!
              const dx = b[0] - a[0]
              const dy = b[1] - a[1]
              if (dx * dx + dy * dy < 0.25) continue // skip < 0.5 m stubs
              try {
                const wallNode = WallNode.parse({
                  start: a,
                  end: b,
                  thickness: 0.2,
                  height: lvl.height_m ?? 3.0,
                  parentId: pascalLevelId,
                  metadata: {
                    tags: ['halofire', 'wall', 'auto_design', 'perimeter'],
                  },
                })
                createNode(wallNode as any, pascalLevelId as any)
              } catch {
                // best effort
              }
            }
          }

          // INTERIOR PARTITION WALLS — derived from each room's
          // polygon edges. Cap at 100/level so a noisy CubiCasa
          // run doesn't repaint the porcupine. Walls thinner than
          // perimeter (0.1 m vs 0.2 m) and slightly shorter so
          // they read as interior partitions, not exterior shell.
          const rooms = (lvl as any).rooms ?? []
          let partitionCount = 0
          const PARTITION_CAP = 100
          for (const r of rooms) {
            if (!r.polygon_m || r.polygon_m.length < 3) continue
            // Intake's canonicalize pass already shifted room
            // polygons onto the canonical centroid, so they're
            // already in the same coord frame as slabPoly.
            for (let i = 0; i < r.polygon_m.length; i++) {
              if (partitionCount >= PARTITION_CAP) break
              const a = r.polygon_m[i] as [number, number]
              const b = r.polygon_m[(i + 1) % r.polygon_m.length] as [number, number]
              const dx = b[0] - a[0]
              const dy = b[1] - a[1]
              const len2 = dx * dx + dy * dy
              if (len2 < 1.0 || len2 > 400) continue // 1 - 20 m walls only
              try {
                const wallNode = WallNode.parse({
                  start: a,
                  end: b,
                  thickness: 0.1,
                  height: (lvl.height_m ?? 3.0) * 0.85,
                  parentId: pascalLevelId,
                  metadata: {
                    tags: [
                      'halofire', 'wall', 'auto_design', 'partition',
                    ],
                  },
                })
                createNode(wallNode as any, pascalLevelId as any)
                partitionCount++
              } catch {
                // best effort
              }
            }
            if (partitionCount >= PARTITION_CAP) break
          }
        })

        /** Find the architectural level id (design.json key) whose
         *  elevation band contains z. Used to look up the matching
         *  per-level centroid when re-centering heads + pipes. */
        const archLevelForZ = (z: number): string => {
          let best = (design.building?.levels ?? [])[0]?.id ?? ''
          let bestDist = Infinity
          for (const l of design.building?.levels ?? []) {
            const top = l.elevation_m + (l.height_m ?? 3.0)
            if (z >= l.elevation_m - 0.5 && z <= top + 0.5) return l.id
            const d = Math.min(
              Math.abs(z - l.elevation_m), Math.abs(z - top),
            )
            if (d < bestDist) {
              bestDist = d
              best = l.id
            }
          }
          return best
        }

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
                  position: T3(h.position_m, archLevelForZ(h.position_m[2])),
                  rotation: [0, 0, 0],
                  scale: [1, 1, 1],
                  children: [],
                  asset: {
                    id: `head_${h.id}`,
                    category: 'sprinkler_head_pendant',
                    name: h.sku ?? 'K5.6 head',
                    thumbnail: '/icons/item.png',
                    // 0.4 m sphere reads at building scale; real
                    // pendant deflectors are ~10 cm but invisible
                    // when the building is 100 m wide. Visualization
                    // exaggeration so the user can see what's there.
                    dimensions: [0.4, 0.4, 0.4],
                    src: '/halofire-catalog/glb/SM_Head_Pendant_Standard_K56.glb',
                    attachTo: 'ceiling',
                    offset: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                    tags: [
                      'halofire',
                      'sprinkler_head_pendant',
                      'halofire_pipe_color:#ef4444',
                      'auto_design',
                    ],
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
              // Plan midpoint → LEVEL-LOCAL coords (matching head
              // logic). Pipe lives inside the level frame; world-Y
              // for the level itself is set by Pascal's level-system.
              const midZworld = (p.start_m[2] + p.end_m[2]) / 2
              const archId = archLevelForZ(midZworld)
              const [pcx, pcy] = levelCenter.get(archId) ?? [gx, gy]
              const archLvl = archLevels.find((l: any) => l.id === archId)
              const baseElev = archLvl?.elevation_m ?? 0
              const mx_plan = (p.start_m[0] + p.end_m[0]) / 2 - pcx
              const my_plan = (p.start_m[1] + p.end_m[1]) / 2 - pcy
              const mz_plan = midZworld - baseElev
              const dx = p.end_m[0] - p.start_m[0]
              const dy = p.end_m[1] - p.start_m[1]
              const dz = p.end_m[2] - p.start_m[2]
              const len = Math.max(
                0.01,
                Math.sqrt(dx * dx + dy * dy + dz * dz),
              )
              // Convert plan→three.js (Y up). Position: plan(x,y,z)
              // becomes three.js(x, z, y) so elevation goes up.
              const mx = mx_plan * scale
              const my = mz_plan * scale         // elevation → height
              const mz = my_plan * scale         // plan Y → three.js Z
              // Rotation: pipe lies flat in the X-Z plane (horizontal
              // axis). Original pipe yaw was atan2(dy_plan, dx_plan).
              // After axis swap, that's still rotation around three.js
              // Y axis = position[1] axis. Three.js Euler rotation
              // [rx, ry, rz] applied to a 1×1×1 box scaled along X
              // means we rotate around Y to point the X-axis along
              // the plan vector.
              const yaw = Math.atan2(dy, dx)
              const isVertical = Math.abs(dz) > Math.max(Math.abs(dx), Math.abs(dy))
              // Smart-Pipe color code per AutoSPRINK convention
              const role = p.role || 'unknown'
              const roleColor: Record<string, string> = {
                drop: '#3b82f6',          // blue — heads-to-branch
                branch: '#22c55e',        // green — horizontal carrying heads
                cross_main: '#f59e0b',    // amber — feeds branches
                main: '#ef4444',          // red — system trunk
                riser_nipple: '#a855f7',  // purple — vertical at riser
                unknown: '#6b7280',       // grey — fallback
              }
              const color = roleColor[role] ?? roleColor.unknown
              createNode(
                {
                  id: generateId('item'),
                  type: 'item',
                  position: [mx, my, mz],
                  // Vertical drops point up the Y axis; horizontal
                  // pipes lie in the X-Z plane and yaw around Y.
                  rotation: isVertical ? [0, 0, Math.PI / 2] : [0, -yaw, 0],
                  scale: [len, 1, 1],
                  children: [],
                  asset: {
                    id: `pipe_${p.id}`,
                    category: 'pipe_steel_sch10',
                    name: `${p.size_in}" ${role}`,
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
                      `role_${role}`,
                      `halofire_pipe_color:${color}`,
                      'auto_design',
                    ],
                    color,
                  },
                  metadata: {
                    color,
                    role,
                    size_in: p.size_in,
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
