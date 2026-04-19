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

import { useCallback, useState } from 'react'

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18790'

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
      const output = await callTool('halofire_validate', {
        mode: 'shell',
        scene: {
          nodes: [
            {
              id: 'demo_w1',
              type: 'wall',
              folder: 'Level/Walls/South',
              bbox_world: { min: [0, 0, 0], max: [400, 20, 400] },
              metadata: { label: 'South_OK' },
            },
            {
              id: 'demo_w2',
              type: 'wall',
              folder: 'Level/Walls/North',
              bbox_world: { min: [0, 3180, 200], max: [400, 3200, 600] },
              metadata: { label: 'North_FLOATING' },
            },
          ],
        },
      })
      setShell({ running: false, output })
    } catch (e) {
      setShell({ running: false, error: String(e) })
    }
  }, [])

  const runCollisions = useCallback(async () => {
    setCollisions({ running: true })
    try {
      const output = await callTool('halofire_validate', {
        mode: 'collisions',
        scene: {
          nodes: [
            {
              id: 'f1', type: 'slab', folder: 'Level/Floor',
              bbox_world: { min: [0, 0, 0], max: [400, 400, 20] },
              metadata: { label: 'Floor_0_0' },
            },
            {
              id: 'h1', type: 'head', folder: 'Level/Heads',
              bbox_world: { min: [100, 100, 380], max: [105, 105, 400] },
              metadata: { label: 'H1' },
            },
          ],
        },
      })
      setCollisions({ running: false, output })
    } catch (e) {
      setCollisions({ running: false, error: String(e) })
    }
  }, [])

  const runAutoGrid = useCallback(async () => {
    setPlacer({ running: true })
    try {
      const output = await callTool('halofire_place_head', {
        mode: 'auto_grid',
        scene_id: 'studio_demo',
        room_bbox_cm: { min: [0, 0, 0], max: [roomW, roomL, 400] },
        ceiling_z_cm: 380,
        hazard_class: hazard,
        head_model: 'SM_Head_Pendant_Standard_K56',
      })
      setPlacer({ running: false, output })
    } catch (e) {
      setPlacer({ running: false, error: String(e) })
    }
  }, [roomW, roomL, hazard])

  const runAutoRoute = useCallback(async () => {
    setRouter({ running: true })
    try {
      // Demo: a 3x2 grid of heads around a riser
      const heads = []
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
      const output = await callTool('halofire_route_pipe', {
        mode: 'auto_tree',
        scene_id: 'studio_demo',
        riser: { id: 'R1', x_cm: 50, y_cm: 50, z_cm: 380 },
        heads,
        pipe_schedule: 'sch10',
      })
      setRouter({ running: false, output })
    } catch (e) {
      setRouter({ running: false, error: String(e) })
    }
  }, [])

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
          Auto-tree route (3x2 demo heads)
        </Btn>
        <ResultBlock result={router} />
      </Section>

      <Section title="4. Hydraulic Calc" description="Hazen-Williams + equivalent length">
        <Btn onClick={runCalc} busy={calc.running}>
          Single-branch demo (60 gpm, 3 segments, +12 ft elev.)
        </Btn>
        <ResultBlock result={calc} />
      </Section>

      <Section title="5. Ingest + Export" description="M2 week 7-8 for full PDF; M3 for AHJ set">
        <p className="text-[11px] text-neutral-500">
          IFC upload UI: M1 week 3. PDF upload + L1-L4 pipeline: M2 week 7-8.
          AHJ-grade sheet set (FP-0..FP-5): M3 week 21-22.
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
