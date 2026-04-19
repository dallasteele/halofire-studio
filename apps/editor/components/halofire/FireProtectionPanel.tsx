'use client'

/**
 * Halofire Fire Protection panel — live tool calls against halopenclaw.
 *
 * M1 scope (all live by the end of week 4):
 *   - Shell audit + collision audit
 *   - Auto-grid head placer per NFPA 13 §11.2.3.1.1
 *   - Auto-tree pipe router (Prim's MST) with schedule-method sizing
 *   - Hazen-Williams hydraulic calc + K-factor flow
 *   - Layer 1 PDF ingest (pdfplumber vector)
 *   - Single-sheet PDF plan export
 *
 * M2-M3 adds: L2-L4 PDF, density-area calc, AHJ sheet set.
 */

import { generateId, sceneRegistry, useScene } from '@pascal-app/core'
import { serializeLiveScene } from '@halofire/halopenclaw-client'
import { findBySku, findPipesBySize } from '@halofire/catalog'
import { useCallback, useState } from 'react'
import { IfcUploadButton } from './IfcUploadButton'

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18790'

/**
 * Serialize the live Pascal scene for gateway tool calls. Falls back to
 * a demo scene if the registry is empty (user hasn't drawn anything).
 */
function captureScene(demo: Record<string, unknown>): Record<string, unknown> {
  const serialized = serializeLiveScene({
    useSceneRegistry: () => sceneRegistry,
  })
  if (serialized.nodes.length === 0) {
    return demo
  }
  return serialized as unknown as Record<string, unknown>
}

type HazardClass = 'light' | 'ordinary_i' | 'ordinary_ii' | 'extra_i' | 'extra_ii'

interface ToolResult {
  running: boolean
  output?: string
  error?: string
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const response = await fetch(`${GATEWAY_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 10_000),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  if (!response.ok) throw new Error(`gateway: HTTP ${response.status}`)
  const body = await response.json()
  if (body.error) throw new Error(`rpc: ${JSON.stringify(body.error)}`)
  return String(body.result?.content?.[0]?.text ?? '')
}

export function FireProtectionPanel() {
  const [shell, setShell] = useState<ToolResult>({ running: false })
  const [collisions, setCollisions] = useState<ToolResult>({ running: false })
  const [placer, setPlacer] = useState<ToolResult>({ running: false })
  const [router, setRouter] = useState<ToolResult>({ running: false })
  const [calc, setCalc] = useState<ToolResult>({ running: false })

  const [roomW, setRoomW] = useState(1000)
  const [roomL, setRoomL] = useState(800)
  const [hazard, setHazard] = useState<HazardClass>('light')

  const runShell = useCallback(async () => {
    setShell({ running: true })
    try {
      const scene = captureScene({
        nodes: [
          {
            id: 'demo_w1',
            type: 'wall',
            folder: 'Level/Walls/South',
            bbox_world: { min: [0, 0, 0], max: [400, 20, 400] },
            metadata: { label: 'South_OK (demo — no live scene)' },
          },
          {
            id: 'demo_w2',
            type: 'wall',
            folder: 'Level/Walls/North',
            bbox_world: { min: [0, 3180, 200], max: [400, 3200, 600] },
            metadata: { label: 'North_FLOATING (demo)' },
          },
        ],
      })
      const output = await callTool('halofire_validate', { mode: 'shell', scene })
      setShell({ running: false, output })
    } catch (e) {
      setShell({ running: false, error: String(e) })
    }
  }, [])

  const runCollisions = useCallback(async () => {
    setCollisions({ running: true })
    try {
      const scene = captureScene({
        nodes: [
          {
            id: 'f1', type: 'slab', folder: 'Level/Floor',
            bbox_world: { min: [0, 0, 0], max: [400, 400, 20] },
            metadata: { label: 'Floor_0_0 (demo — no live scene)' },
          },
          {
            id: 'h1', type: 'head', folder: 'Level/Heads',
            bbox_world: { min: [100, 100, 380], max: [105, 105, 400] },
            metadata: { label: 'H1 (demo)' },
          },
        ],
      })
      const output = await callTool('halofire_validate', { mode: 'collisions', scene })
      setCollisions({ running: false, output })
    } catch (e) {
      setCollisions({ running: false, error: String(e) })
    }
  }, [])

  const createNode = useScene((s) => s.createNode)
  const deleteNodes = useScene((s) => s.deleteNodes)
  const rootNodeIds = useScene((s) => s.rootNodeIds)

  const clearAutoRouted = useCallback(() => {
    const nodes = useScene.getState().nodes as Record<string, unknown>
    const toDelete: string[] = []
    for (const [id, raw] of Object.entries(nodes)) {
      const n = raw as { type?: string; asset?: { tags?: string[] } }
      if (n.type !== 'item') continue
      if (!n.asset?.tags?.includes('auto_tree')) continue
      toDelete.push(id)
    }
    if (toDelete.length === 0) {
      setRouter({ running: false, output: 'No auto-routed pipes in scene.' })
      return
    }
    try {
      // @ts-expect-error — id is string; Pascal expects branded NodeId
      deleteNodes(toDelete)
      setRouter({ running: false, output: `✓ Removed ${toDelete.length} auto-routed pipe segments.` })
    } catch (e) {
      setRouter({ running: false, error: `deleteNodes failed: ${String(e)}` })
    }
  }, [deleteNodes])

  const runAutoGrid = useCallback(async () => {
    setPlacer({ running: true })
    try {
      const headSku = 'SM_Head_Pendant_Standard_K56'
      const output = await callTool('halofire_place_head', {
        mode: 'auto_grid',
        scene_id: 'studio_demo',
        room_bbox_cm: { min: [0, 0, 0], max: [roomW, roomL, 400] },
        ceiling_z_cm: 380,
        hazard_class: hazard,
        head_model: headSku,
      })

      // Parse the "@ (x, y, z)" lines from the output and spawn each as
      // a Pascal ItemNode. Format: "  @ (228.6, 228.6, 380.0) cm"
      const entry = findBySku(headSku)
      const [dw, dd, dh] = entry.dims_cm
      const dimsMeters: [number, number, number] = [dw / 100, dh / 100, dd / 100]
      const parentId = rootNodeIds?.[0]
      let spawned = 0
      const coordRegex = /^\s*@ \(([-\d.]+), ([-\d.]+), ([-\d.]+)\)/gm
      for (const m of output.matchAll(coordRegex)) {
        const px = Number(m[1]) / 100
        const py = Number(m[2]) / 100
        const pz = Number(m[3]) / 100
        try {
          // @ts-expect-error — runtime accepts the shape
          createNode({
            id: generateId('item'),
            type: 'item',
            position: [px, py, pz],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            children: [],
            asset: {
              category: entry.category,
              dimensions: dimsMeters,
              src: `/halofire-catalog/glb/${entry.sku}.glb`,
              attachTo: 'ceiling',
              offset: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              tags: ['halofire', entry.category, 'auto_grid'],
            },
          }, parentId)
          spawned++
        } catch {
          // best-effort spawn; ignore per-head failures
        }
      }
      const suffix = spawned > 0
        ? `\n\n✓ Spawned ${spawned} heads into the Pascal scene.`
        : '\n\n(No heads spawned — check output for layout.)'
      setPlacer({ running: false, output: output + suffix })
    } catch (e) {
      setPlacer({ running: false, error: String(e) })
    }
  }, [roomW, roomL, hazard, createNode, rootNodeIds])

  const runAutoRoute = useCallback(async () => {
    setRouter({ running: true })
    try {
      // Pull live heads from the scene — any ItemNode tagged 'halofire'
      // + category starting 'sprinkler_head_' counts as a head for routing.
      // Fall back to a demo 3x2 grid when nothing has been placed yet.
      const heads: { id: string; x_cm: number; y_cm: number; z_cm: number }[] = []
      const nodes = useScene.getState().nodes as Record<string, unknown>
      for (const [id, raw] of Object.entries(nodes)) {
        const n = raw as { type?: string; position?: [number, number, number]; asset?: { category?: string } }
        if (n.type !== 'item') continue
        if (!n.asset?.category?.startsWith('sprinkler_head_')) continue
        const [x, y, z] = n.position ?? [0, 0, 0]
        heads.push({ id, x_cm: x * 100, y_cm: y * 100, z_cm: z * 100 })
      }
      const usingLive = heads.length > 0
      if (!usingLive) {
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < 3; c++) {
            heads.push({
              id: `H${r}${c}`,
              x_cm: 228 + c * 272,
              y_cm: 228 + r * 343,
              z_cm: 380,
            })
          }
        }
      }
      const riser = { id: 'R1', x_cm: 50, y_cm: 50, z_cm: 380 }
      const output = await callTool('halofire_route_pipe', {
        mode: 'auto_tree',
        scene_id: 'studio_demo',
        riser,
        heads,
        pipe_schedule: 'sch10',
      })

      // Parse segment lines from gateway output:
      //   "  RISER → H0          332.8cm  (10.92ft)"
      // Build id → position map so each segment can be spawned as a
      // scaled pipe ItemNode between its endpoints.
      const posById = new Map<string, [number, number, number]>()
      posById.set(riser.id, [riser.x_cm / 100, riser.y_cm / 100, riser.z_cm / 100])
      for (const h of heads) {
        posById.set(h.id, [h.x_cm / 100, h.y_cm / 100, h.z_cm / 100])
      }

      // NFPA 13 §28.5 pipe-schedule sizing helper.
      const sizeForCount = (n: number): number =>
        n <= 1 ? 1.0
        : n <= 2 ? 1.25
        : n <= 3 ? 1.5
        : n <= 5 ? 2.0
        : n <= 10 ? 2.5
        : n <= 30 ? 3.0
        : 4.0

      // Parse all segments first so we can do a downstream head-count
      // walk (§28.5 sizing is per-segment, not per-system).
      const segRegex = /^\s+(\S+)\s+→\s+(\S+)\s+([\d.]+)cm\s+\(([\d.]+)ft\)/gm
      type ParsedSeg = { fromId: string; toId: string }
      const parsedSegs: ParsedSeg[] = []
      for (const m of output.matchAll(segRegex)) {
        parsedSegs.push({ fromId: m[1], toId: m[2] })
      }
      // Build children adjacency assuming the MST roots at the riser:
      // each segment's `to` is a child of `from`.
      const childrenOf = new Map<string, string[]>()
      for (const s of parsedSegs) {
        const arr = childrenOf.get(s.fromId) ?? []
        arr.push(s.toId)
        childrenOf.set(s.fromId, arr)
      }
      const isHead = new Set(heads.map((h) => h.id))
      // Count downstream heads from a node via DFS, memoized.
      const dsCache = new Map<string, number>()
      const downstreamHeads = (nodeId: string): number => {
        const cached = dsCache.get(nodeId)
        if (cached !== undefined) return cached
        let c = isHead.has(nodeId) ? 1 : 0
        for (const ch of childrenOf.get(nodeId) ?? []) {
          c += downstreamHeads(ch)
        }
        dsCache.set(nodeId, c)
        return c
      }

      let spawned = 0
      const sizesUsed = new Map<number, number>() // pipeSizeIn → count
      const parentId = rootNodeIds?.[0]
      for (const seg of parsedSegs) {
        const { fromId, toId } = seg
        const p1 = posById.get(fromId)
        const p2 = posById.get(toId)
        if (!p1 || !p2) continue
        // This segment carries flow for every head downstream of `to`.
        const dsCount = Math.max(1, downstreamHeads(toId))
        const pipeSizeIn = sizeForCount(dsCount)
        const pipeEntries = findPipesBySize(pipeSizeIn)
        const pipeEntry = pipeEntries[0] ?? findBySku('SM_Pipe_SCH10_2in_1m')
        const [pw, pd, ph] = pipeEntry.dims_cm
        const pipeDimsMeters: [number, number, number] = [pw / 100, ph / 100, pd / 100]
        sizesUsed.set(pipeSizeIn, (sizesUsed.get(pipeSizeIn) ?? 0) + 1)

        const dx = p2[0] - p1[0]
        const dy = p2[1] - p1[1]
        const dz = p2[2] - p1[2]
        const length_m = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (length_m < 0.001) continue
        const mid: [number, number, number] = [
          (p1[0] + p2[0]) / 2,
          (p1[1] + p2[1]) / 2,
          (p1[2] + p2[2]) / 2,
        ]
        // Align pipe's local Y (its 1m length axis) to segment direction.
        // Yaw around world up (position[2]) + pitch tilts off horizontal.
        const horiz = Math.sqrt(dx * dx + dy * dy)
        const yaw = Math.atan2(dy, dx)
        const pitch = Math.atan2(dz, horiz)
        try {
          // @ts-expect-error — runtime accepts the shape
          createNode({
            id: generateId('item'),
            type: 'item',
            position: mid,
            rotation: [pitch, 0, yaw] as [number, number, number],
            // Scale local Y to segment length (pipe GLB is 1m long)
            scale: [1, length_m, 1] as [number, number, number],
            children: [],
            asset: {
              category: pipeEntry.category,
              dimensions: pipeDimsMeters,
              src: `/halofire-catalog/glb/${pipeEntry.sku}.glb`,
              attachTo: 'ceiling',
              offset: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              tags: ['halofire', pipeEntry.category, 'auto_tree', `${fromId}→${toId}`],
            },
          }, parentId)
          spawned++
        } catch {
          // best-effort
        }
      }

      const prefix = usingLive
        ? `Using ${heads.length} live heads from Pascal scene.\n\n`
        : `No live heads; using 3x2 demo grid.\n\n`
      const sizeBreakdown = Array.from(sizesUsed.entries())
        .sort((a, b) => b[0] - a[0])
        .map(([sz, n]) => `${n}×${sz}"`)
        .join(', ')
      const suffix = spawned > 0
        ? `\n\n✓ Spawned ${spawned} pipe segments into the Pascal scene (${sizeBreakdown}) — per-branch §28.5 sizing by downstream head count.`
        : '\n\n(No pipe segments spawned — parser found 0 matching rows.)'
      setRouter({ running: false, output: prefix + output + suffix })
    } catch (e) {
      setRouter({ running: false, error: String(e) })
    }
  }, [createNode, rootNodeIds])

  const runCalc = useCallback(async () => {
    setCalc({ running: true })
    try {
      const output = await callTool('halofire_calc', {
        mode: 'single_branch',
        flow_gpm: 60,
        segments: [
          { from_node: 'HEAD-1', to_node: 'TEE-A', length_ft: 10, pipe_schedule: 'sch10', nominal_size_in: 1.0, fittings: [['elbow_90', 1.0, 1]] },
          { from_node: 'TEE-A', to_node: 'TEE-B', length_ft: 20, pipe_schedule: 'sch10', nominal_size_in: 1.5, fittings: [['tee_branch', 1.5, 1]] },
          { from_node: 'TEE-B', to_node: 'RISER', length_ft: 8, pipe_schedule: 'sch10', nominal_size_in: 2.0, fittings: [['gate_valve', 2.0, 1]], elevation_change_ft: 12 },
        ],
      })
      setCalc({ running: false, output })
    } catch (e) {
      setCalc({ running: false, error: String(e) })
    }
  }, [])

  const runCalcFromScene = useCallback(async () => {
    setCalc({ running: true })
    try {
      // Pull live heads + riser → call route_pipe auto_tree → parse
      // segments → feed into halofire_calc single_branch with per-segment
      // §28.5 pipe-schedule sizing and approximate fittings.
      const heads: { id: string; x_cm: number; y_cm: number; z_cm: number }[] = []
      const nodes = useScene.getState().nodes as Record<string, unknown>
      for (const [id, raw] of Object.entries(nodes)) {
        const n = raw as { type?: string; position?: [number, number, number]; asset?: { category?: string } }
        if (n.type !== 'item') continue
        if (!n.asset?.category?.startsWith('sprinkler_head_')) continue
        const [x, y, z] = n.position ?? [0, 0, 0]
        heads.push({ id, x_cm: x * 100, y_cm: y * 100, z_cm: z * 100 })
      }
      if (heads.length === 0) {
        setCalc({
          running: false,
          error: 'No sprinkler heads in scene. Place heads first (Catalog tab or auto-grid).',
        })
        return
      }
      const riser = { id: 'R1', x_cm: 50, y_cm: 50, z_cm: 380 }
      const mstOutput = await callTool('halofire_route_pipe', {
        mode: 'auto_tree',
        scene_id: 'studio_calc',
        riser,
        heads,
        pipe_schedule: 'sch10',
      })
      const segRegex = /^\s+(\S+)\s+→\s+(\S+)\s+([\d.]+)cm\s+\(([\d.]+)ft\)/gm
      type ParsedSeg = { from: string; to: string; length_ft: number }
      const parsedSegs: ParsedSeg[] = []
      for (const m of mstOutput.matchAll(segRegex)) {
        parsedSegs.push({
          from: m[1],
          to: m[2],
          length_ft: Number(m[4]),
        })
      }
      if (parsedSegs.length === 0) {
        setCalc({ running: false, error: 'Router returned no segments.' })
        return
      }
      // Tree adjacency for downstream-head counts.
      const childrenOf = new Map<string, string[]>()
      for (const s of parsedSegs) {
        const arr = childrenOf.get(s.from) ?? []
        arr.push(s.to)
        childrenOf.set(s.from, arr)
      }
      const isHead = new Set(heads.map((h) => h.id))
      const dsCache = new Map<string, number>()
      const downstreamHeads = (id: string): number => {
        const c = dsCache.get(id)
        if (c !== undefined) return c
        let out = isHead.has(id) ? 1 : 0
        for (const ch of childrenOf.get(id) ?? []) out += downstreamHeads(ch)
        dsCache.set(id, out)
        return out
      }
      const sizeForCount = (n: number): number =>
        n <= 1 ? 1.0 : n <= 2 ? 1.25 : n <= 3 ? 1.5 : n <= 5 ? 2.0
        : n <= 10 ? 2.5 : n <= 30 ? 3.0 : 4.0

      // Build segment payload: flow for the branch is K√p for one head
      // at min working pressure — hard-code the K5.6 × 7 psi = ~14.8 gpm
      // per head (NFPA 13 §11.2.6). Total system flow = heads × per-head.
      // For a single-branch approximation, we walk the longest path from
      // riser to deepest head and call halofire_calc on those segments.
      const segPayload: Record<string, unknown>[] = []
      for (const s of parsedSegs) {
        const ds = Math.max(1, downstreamHeads(s.to))
        const size = sizeForCount(ds)
        // Fittings approximation: each tee node gets a tee_branch, leaves
        // get an elbow_90 at the connection.
        const fittings: [string, number, number][] =
          (childrenOf.get(s.to)?.length ?? 0) > 1
            ? [['tee_branch', size, 1]]
            : [['elbow_90', size, 1]]
        segPayload.push({
          from_node: s.from,
          to_node: s.to,
          length_ft: s.length_ft,
          pipe_schedule: 'sch10',
          nominal_size_in: size,
          fittings,
        })
      }
      // System flow: 14.8 gpm per head × head count (K5.6 @ 7 psi).
      const systemFlow = Number((14.8 * heads.length).toFixed(1))
      const output = await callTool('halofire_calc', {
        mode: 'single_branch',
        flow_gpm: systemFlow,
        segments: segPayload,
      })
      const header =
        `Using ${heads.length} live heads, ${parsedSegs.length} MST segments, ` +
        `${systemFlow} gpm (K5.6 × 7 psi/head).\n\n`
      setCalc({ running: false, output: header + output })
    } catch (e) {
      setCalc({ running: false, error: String(e) })
    }
  }, [])

  const [exportResult, setExportResult] = useState<ToolResult>({ running: false })

  const runExport = useCallback(async () => {
    setExportResult({ running: true })
    try {
      // Build a minimal schedule from the live Pascal scene's sprinkler
      // heads. The drafting renderer accepts the same YAML schema the
      // ClaudeBot skill's draft_plan_png.py uses.
      const nodes = useScene.getState().nodes as Record<string, unknown>
      const equipment: unknown[] = []
      let i = 0
      for (const [id, raw] of Object.entries(nodes)) {
        const n = raw as { type?: string; position?: [number, number, number]; asset?: { category?: string; dimensions?: [number, number, number] } }
        if (n.type !== 'item') continue
        if (!n.asset?.category?.startsWith('sprinkler_head_')) continue
        const [x, y, z] = n.position ?? [0, 0, 0]
        const [dw, dh, dd] = n.asset.dimensions ?? [0.05, 0.05, 0.05]
        equipment.push({
          tag: `S-${++i}`,
          name: 'Sprinkler head',
          model: n.asset.category,
          dims_cm: [dw * 100, dd * 100, dh * 100],
          mounting: 'ceiling',
          plan_xy_cm: [x * 100, y * 100],
          yaw: 0,
        })
        void id
      }
      if (equipment.length === 0) {
        setExportResult({
          running: false,
          error:
            'No sprinkler heads in scene. Place some via the Catalog tab or the Place Heads section first, then export.',
        })
        return
      }
      const schedule = {
        project: 'halofire_studio_session',
        config: 'linear',
        seats_target: 0,
        room: { width_cm: roomW, length_cm: roomL, wall_height_cm: 400 },
        zones: [
          { id: 'dining', bbox_cm: [[0, 0], [roomW, roomL]] },
        ],
        equipment,
      }
      const output = await callTool('halofire_export', {
        mode: 'pdf_plan',
        scene_id: 'studio',
        schedule,
      })
      setExportResult({ running: false, output })
    } catch (e) {
      setExportResult({ running: false, error: String(e) })
    }
  }, [roomW, roomL])

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-sm">
      <div>
        <h2 className="mb-1 text-base font-semibold">Fire Protection</h2>
        <p className="text-[11px] text-neutral-500">
          Halopenclaw:{' '}
          <code className="rounded bg-neutral-200 px-1 py-0.5 text-[10px] dark:bg-neutral-800">
            {GATEWAY_URL}
          </code>
        </p>
      </div>

      <Section title="1. Validate" description="Structural + rule audits (M1)">
        <Btn onClick={runShell} busy={shell.running}>
          Shell audit (walls touch floor)
        </Btn>
        <ResultBlock result={shell} />
        <Btn onClick={runCollisions} busy={collisions.running}>
          Collision audit
        </Btn>
        <ResultBlock result={collisions} />
      </Section>

      <Section title="2. Place Heads (auto grid)" description="NFPA 13 §11.2.3.1.1">
        <div className="mb-2 flex gap-2">
          <label className="flex-1">
            <span className="text-[10px] text-neutral-500">Width (cm)</span>
            <input
              type="number" value={roomW}
              onChange={(e) => setRoomW(Number(e.target.value) || 0)}
              className="w-full rounded border border-neutral-300 bg-neutral-50 px-1 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <label className="flex-1">
            <span className="text-[10px] text-neutral-500">Length (cm)</span>
            <input
              type="number" value={roomL}
              onChange={(e) => setRoomL(Number(e.target.value) || 0)}
              className="w-full rounded border border-neutral-300 bg-neutral-50 px-1 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
        </div>
        <label className="mb-2 block">
          <span className="text-[10px] text-neutral-500">Hazard class</span>
          <select
            value={hazard}
            onChange={(e) => setHazard(e.target.value as HazardClass)}
            className="w-full rounded border border-neutral-300 bg-neutral-50 px-1 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="light">Light</option>
            <option value="ordinary_i">Ordinary I</option>
            <option value="ordinary_ii">Ordinary II</option>
            <option value="extra_i">Extra I</option>
            <option value="extra_ii">Extra II</option>
          </select>
        </label>
        <Btn onClick={runAutoGrid} busy={placer.running}>
          Compute auto-grid
        </Btn>
        <ResultBlock result={placer} />
      </Section>

      <Section title="3. Route Pipes" description="Prim's MST, pipe-schedule sizing">
        <Btn onClick={runAutoRoute} busy={router.running}>
          Auto-tree route (spawns pipe segments)
        </Btn>
        <button
          type="button"
          onClick={clearAutoRouted}
          className="mt-1 w-full rounded border border-neutral-400 bg-neutral-100 px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-200 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
        >
          Clear auto-routed pipes
        </button>
        <ResultBlock result={router} />
      </Section>

      <Section title="4. Hydraulic Calc" description="Hazen-Williams + equivalent length">
        <Btn onClick={runCalc} busy={calc.running}>
          Single-branch demo (60 gpm, 3 segments, +12 ft elev.)
        </Btn>
        <button
          type="button"
          onClick={runCalcFromScene}
          disabled={calc.running}
          className="mt-1 w-full rounded border border-emerald-400 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100 dark:hover:bg-emerald-900"
        >
          Calc from live scene (K5.6 heads, §28.5 sizing)
        </button>
        <ResultBlock result={calc} />
      </Section>

      <Section title="5. Ingest IFC" description="Upload an architect's .ifc file">
        <IfcUploadButton />
        <p className="mt-2 text-[10px] text-neutral-500">
          PDF upload via the 4-layer free pipeline (pdfplumber → opencv →
          CubiCasa5k → Claude Vision) ships M2 week 7-8. DWG import M2 week 8.
        </p>
      </Section>

      <Section title="6. Export PDF plan" description="Renders live scene heads as a 2D plan">
        <Btn onClick={runExport} busy={exportResult.running}>
          Export PDF plan from scene
        </Btn>
        <ResultBlock result={exportResult} />
        <p className="mt-1 text-[10px] text-neutral-500">
          Uses the live scene's sprinkler heads as the equipment schedule.
          Full AHJ sheet set (FP-0..FP-5 + title blocks + dimensions +
          schedules + hydraulic placard) ships M3 weeks 21-22.
        </p>
      </Section>
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded border border-neutral-300 p-2 dark:border-neutral-700">
      <h3 className="mb-0.5 text-xs font-semibold">{title}</h3>
      <p className="mb-2 text-[10px] text-neutral-500">{description}</p>
      {children}
    </div>
  )
}

function Btn({
  onClick,
  busy,
  children,
}: {
  onClick: () => void
  busy: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="mt-1 w-full rounded bg-emerald-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
    >
      {busy ? 'Running…' : children}
    </button>
  )
}

function ResultBlock({ result }: { result: ToolResult }) {
  if (!result.output && !result.error) return null
  return (
    <pre
      className={`mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap rounded p-2 text-[10px] leading-tight ${
        result.error
          ? 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100'
          : 'bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100'
      }`}
    >
      {result.error ?? result.output}
    </pre>
  )
}
