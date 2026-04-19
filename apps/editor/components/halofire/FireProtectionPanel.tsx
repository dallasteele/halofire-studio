'use client'

/**
 * Halofire Fire Protection panel.
 *
 * Exposes the halopenclaw-gateway tools:
 *   - halofire_validate (shell audit, collisions)
 *   - halofire_ingest (PDF/IFC/DWG upload → structured scene)
 *   - halofire_place_head (placement UI)
 *   - halofire_route_pipe (routing UI)
 *   - halofire_calc (hydraulic calc)
 *   - halofire_export (sheet-set, proposal, DXF)
 *
 * For M1 we wire the Validate + Ingest entry points. The rest ship with
 * their respective milestone weeks.
 */

import { useCallback, useState } from 'react'

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18790'

interface ValidationResult {
  running: boolean
  output?: string
  error?: string
}

async function callGatewayTool(
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
  if (!response.ok) {
    throw new Error(`gateway error: ${response.status}`)
  }
  const body = await response.json()
  if (body.error) {
    throw new Error(`gateway error: ${JSON.stringify(body.error)}`)
  }
  const content = body.result?.content?.[0]?.text ?? ''
  return String(content)
}

export function FireProtectionPanel() {
  const [shell, setShell] = useState<ValidationResult>({ running: false })
  const [collisions, setCollisions] = useState<ValidationResult>({ running: false })

  const runShell = useCallback(async () => {
    setShell({ running: true })
    try {
      // Demo scene — replace with actual scene dump from Pascal store
      // once the halopenclaw-client package can serialize a Pascal scene.
      const demoScene = {
        nodes: [
          {
            id: 'demo_w1',
            type: 'wall',
            folder: 'Level/Walls/South',
            bbox_world: { min: [0, 0, 0], max: [400, 20, 400] },
            metadata: { label: 'DemoWall_OK' },
          },
          {
            id: 'demo_w2',
            type: 'wall',
            folder: 'Level/Walls/North',
            bbox_world: { min: [0, 3180, 200], max: [400, 3200, 600] },
            metadata: { label: 'DemoWall_FLOATING' },
          },
        ],
      }
      const output = await callGatewayTool('halofire_validate', {
        mode: 'shell',
        scene: demoScene,
      })
      setShell({ running: false, output })
    } catch (e) {
      setShell({ running: false, error: String(e) })
    }
  }, [])

  const runCollisions = useCallback(async () => {
    setCollisions({ running: true })
    try {
      const demoScene = {
        nodes: [
          {
            id: 'f1',
            type: 'slab',
            folder: 'Level/Floor',
            bbox_world: { min: [0, 0, 0], max: [400, 400, 20] },
            metadata: { label: 'Floor_0_0' },
          },
          {
            id: 'w1',
            type: 'wall',
            folder: 'Level/Walls/South',
            bbox_world: { min: [0, 0, 0], max: [400, 20, 400] },
            metadata: { label: 'South_0' },
          },
          {
            id: 'h1',
            type: 'head',
            folder: 'Level/Heads',
            bbox_world: { min: [100, 100, 380], max: [105, 105, 400] },
            metadata: { label: 'Head_1' },
          },
        ],
      }
      const output = await callGatewayTool('halofire_validate', {
        mode: 'collisions',
        scene: demoScene,
      })
      setCollisions({ running: false, output })
    } catch (e) {
      setCollisions({ running: false, error: String(e) })
    }
  }, [])

  return (
    <div className="flex h-full flex-col gap-4 p-3 text-sm">
      <div>
        <h2 className="mb-2 text-base font-semibold">Fire Protection</h2>
        <p className="text-xs text-neutral-500">
          Halopenclaw gateway @{' '}
          <code className="rounded bg-neutral-200 px-1 py-0.5 text-[10px] dark:bg-neutral-800">
            {GATEWAY_URL}
          </code>
        </p>
      </div>

      <Section title="1. Validate" description="Run structural + rule audits on the current scene.">
        <button
          type="button"
          onClick={runShell}
          disabled={shell.running}
          className="w-full rounded bg-emerald-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {shell.running ? 'Running…' : 'Shell audit (floors touch Z=0)'}
        </button>
        <ResultBlock result={shell} />

        <button
          type="button"
          onClick={runCollisions}
          disabled={collisions.running}
          className="mt-1 w-full rounded bg-emerald-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {collisions.running ? 'Running…' : 'Collision audit (AABB overlap)'}
        </button>
        <ResultBlock result={collisions} />
      </Section>

      <Section
        title="2. Ingest"
        description="Upload architect PDF / IFC / DWG to extract the building model."
      >
        <button
          type="button"
          disabled
          className="w-full rounded bg-neutral-400 px-2 py-1.5 text-xs font-medium text-white opacity-60"
        >
          Upload PDF (M2 week 7)
        </button>
        <button
          type="button"
          disabled
          className="mt-1 w-full rounded bg-neutral-400 px-2 py-1.5 text-xs font-medium text-white opacity-60"
        >
          Upload IFC (M1 week 3)
        </button>
      </Section>

      <Section
        title="3. Design"
        description="Place sprinkler heads, route pipes, run hydraulic calcs."
      >
        <p className="text-[11px] text-neutral-500">
          Tools ship in M1 week 3-4: placer + linear routing + Hazen-Williams
          single-branch calc. Auto-routing + density-area method in M3.
        </p>
      </Section>

      <Section
        title="4. Export"
        description="Generate shop-drawing sheet set + proposal."
      >
        <p className="text-[11px] text-neutral-500">
          Single-sheet PDF output in M1 week 5. AHJ-grade sheet set in M3.
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
      <h3 className="mb-1 text-xs font-semibold">{title}</h3>
      <p className="mb-2 text-[11px] text-neutral-500">{description}</p>
      {children}
    </div>
  )
}

function ResultBlock({ result }: { result: ValidationResult }) {
  if (!result.output && !result.error) return null
  return (
    <pre
      className={`mt-2 max-h-60 overflow-y-auto rounded p-2 text-[10px] leading-tight ${
        result.error
          ? 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100'
          : 'bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100'
      }`}
    >
      {result.error ?? result.output}
    </pre>
  )
}
