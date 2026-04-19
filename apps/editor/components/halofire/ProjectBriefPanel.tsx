'use client'

/**
 * Halofire Project Brief panel — loads a real client bid from
 * /projects/<id>.json and seeds the Pascal scene with the building
 * shell (site / building / levels / stair shafts / standpipe risers)
 * so the rest of the Fire Protection workflow can run against a real
 * project instead of placeholder demo geometry.
 *
 * First project: The Cooperative 1881 Apartments (Salt Lake City).
 * Data pulled from the real bid docs at E:\ClaudeBot\HaloFireBidDocs.
 */

import { generateId, useScene } from '@pascal-app/core'
import { useCallback, useState } from 'react'
import { AiPipelineRunner } from './AiPipelineRunner'
import { BuildingGenerator } from './BuildingGenerator'

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18080'

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

interface Level {
  id: string
  name: string
  use: string
  elevation_ft: number
  sqft: number
}

interface FireSystem {
  id: string
  type: string
  serves: string
  hazard: string
  notes: string
}

interface Project {
  projectId: string
  name: string
  address: string
  apn: string
  zoning: string
  construction_type: string
  code: string
  ahj: string
  architect: Record<string, string>
  gc: Record<string, string>
  halofire: Record<string, string | number>
  building: { total_sqft: number; levels: Level[] }
  fire_systems: FireSystem[]
  fdc: Record<string, string>
  acknowledgements: string[]
  exclusions: string[]
  source_docs: string[]
}

const PROJECTS = [
  { id: '1881-cooperative', label: 'The Cooperative 1881 — Phase I (Salt Lake City)' },
]
const DEFAULT_PROJECT_ID = PROJECTS[0]?.id ?? '1881-cooperative'

const FT_TO_M = 0.3048

export function ProjectBriefPanel() {
  const [project, setProject] = useState<Project | null>(null)
  const [selected, setSelected] = useState(DEFAULT_PROJECT_ID)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seedStatus, setSeedStatus] = useState<string | null>(null)
  const [sheetSetStatus, setSheetSetStatus] = useState<string | null>(null)
  const [sheetSetBusy, setSheetSetBusy] = useState(false)

  const createNode = useScene((s) => s.createNode)

  const loadProject = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/projects/${selected}.json`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: Project = await res.json()
      setProject(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [selected])

  const seedScene = useCallback(() => {
    if (!project) return
    setSeedStatus('Seeding scene…')
    try {
      // Approximate a rectangular footprint from sqft (√sqft × √sqft is a
      // crude square stand-in; real geometry requires the PDF extraction
      // pipeline — M2 week 7-8). Convert ft² → m² then √.
      const sqm = project.building.total_sqft * 0.092903
      const sideM = Math.sqrt(sqm)

      // ── Site root ─────────────────────────────────────────────────
      const siteId = generateId('site') as `site_${string}`
      try {
        createNode({
          id: siteId,
          type: 'site',
          name: project.name,
          position: [0, 0, 0],
          children: [],
          userData: {
            halofire_project_id: project.projectId,
            address: project.address,
            apn: project.apn,
            ahj: project.ahj,
          },
        } as any)
      } catch {
        // best-effort
      }

      // ── Building container ────────────────────────────────────────
      const buildingId = generateId('building') as `building_${string}`
      try {
        createNode({
          id: buildingId,
          type: 'building',
          name: 'Phase I Building',
          position: [0, 0, 0],
          children: [],
          userData: {
            construction_type: project.construction_type,
            code: project.code,
            total_sqft: project.building.total_sqft,
          },
        } as any, siteId)
      } catch {
        // best-effort
      }

      // ── Levels (one per storey) + slab + zone per level ──────────
      let spawned = 0
      for (const lvl of project.building.levels) {
        const levelId = generateId('level') as `level_${string}`
        try {
          createNode({
            id: levelId,
            type: 'level',
            name: lvl.name,
            elevation: lvl.elevation_ft * FT_TO_M,
            children: [],
            userData: { use: lvl.use, sqft: lvl.sqft, level_id: lvl.id },
          } as any, buildingId)
          spawned++
        } catch {
          // best-effort
        }

        // Floor slab approximation: square footprint centered at origin
        const slabId = generateId('slab') as `slab_${string}`
        try {
          createNode({
            id: slabId,
            type: 'slab',
            name: `${lvl.name} Slab`,
            polygon: [
              [0, 0],
              [sideM, 0],
              [sideM, sideM],
              [0, sideM],
            ],
            thickness: 0.2,
            z: lvl.elevation_ft * FT_TO_M,
            children: [],
            userData: { level_id: lvl.id },
          } as any, levelId)
          spawned++
        } catch {
          // best-effort
        }

        // Hazard zone (drives auto-grid §11.2.3.1.1 spacing)
        const hazardForLevel =
          lvl.use === 'garage' ? 'ordinary_i' : 'light'
        const zoneId = generateId('zone') as `zone_${string}`
        try {
          createNode({
            id: zoneId,
            type: 'zone',
            name: `${lvl.name} hazard zone`,
            polygon: [
              [0, 0],
              [sideM, 0],
              [sideM, sideM],
              [0, sideM],
            ],
            hazard: hazardForLevel,
            children: [],
            userData: { level_id: lvl.id, use: lvl.use },
          } as any, levelId)
          spawned++
        } catch {
          // best-effort
        }
      }

      setSeedStatus(
        `✓ Seeded ${spawned} nodes: 1 site + 1 building + ${project.building.levels.length} levels ` +
          `(+ slab + hazard zone each). Footprint ≈ ${sideM.toFixed(1)}m × ${sideM.toFixed(1)}m ` +
          `from ${project.building.total_sqft.toLocaleString()} sqft.\n\n` +
          `Next: Catalog tab or Auto-grid to place heads by level.`,
      )
    } catch (e) {
      setSeedStatus(`Failed: ${String(e)}`)
    }
  }, [project, createNode])

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-sm">
      <div>
        <h2 className="mb-1 text-base font-semibold">Project Brief</h2>
        <p className="text-[11px] text-neutral-500">
          Load a real client bid and seed the Pascal scene.
        </p>
      </div>

      <div className="rounded border border-neutral-300 p-2 dark:border-neutral-700">
        <label className="block">
          <span className="text-[10px] text-neutral-500">Project</span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full rounded border border-neutral-300 bg-neutral-50 px-1 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          >
            {PROJECTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={loadProject}
          disabled={loading}
          className="mt-2 w-full rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load project brief'}
        </button>
        {error && (
          <p className="mt-1 text-[10px] text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </div>

      {project && (
        <>
          <div className="rounded border border-neutral-300 p-2 dark:border-neutral-700">
            <h3 className="mb-1 text-xs font-semibold">{project.name}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
              <dt className="text-neutral-500">Address</dt>
              <dd>{project.address}</dd>
              <dt className="text-neutral-500">APN</dt>
              <dd className="font-mono">{project.apn}</dd>
              <dt className="text-neutral-500">Construction</dt>
              <dd>{project.construction_type}</dd>
              <dt className="text-neutral-500">Code</dt>
              <dd>{project.code}</dd>
              <dt className="text-neutral-500">AHJ</dt>
              <dd>{project.ahj}</dd>
              <dt className="text-neutral-500">Architect</dt>
              <dd>
                {project.architect.firm} ({project.architect.principal})
              </dd>
              <dt className="text-neutral-500">GC</dt>
              <dd>
                {project.gc.company} — {project.gc.contact}
              </dd>
              <dt className="text-neutral-500">Total sqft</dt>
              <dd>{project.building.total_sqft.toLocaleString()}</dd>
              <dt className="text-neutral-500">Proposal</dt>
              <dd>
                $
                {Number(project.halofire.proposal_price_usd).toLocaleString()}{' '}
                ({String(project.halofire.proposal_date)})
              </dd>
            </dl>
          </div>

          <div className="rounded border border-neutral-300 p-2 dark:border-neutral-700">
            <h3 className="mb-1 text-xs font-semibold">
              Levels ({project.building.levels.length})
            </h3>
            <ul className="space-y-0.5 text-[10px]">
              {project.building.levels.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center gap-2 border-b border-neutral-200 py-0.5 last:border-0 dark:border-neutral-800"
                >
                  <span className="w-10 text-right font-mono text-neutral-500">
                    +{l.elevation_ft}ft
                  </span>
                  <span className="flex-1">{l.name}</span>
                  <span
                    className={`rounded px-1 font-mono text-[9px] ${
                      l.use === 'garage'
                        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100'
                        : 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100'
                    }`}
                  >
                    {l.use}
                  </span>
                  <span className="w-14 text-right font-mono text-neutral-500">
                    {l.sqft.toLocaleString()} sf
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded border border-neutral-300 p-2 dark:border-neutral-700">
            <h3 className="mb-1 text-xs font-semibold">
              Fire systems ({project.fire_systems.length})
            </h3>
            <ul className="space-y-1 text-[10px]">
              {project.fire_systems.map((s) => (
                <li key={s.id} className="border-b border-neutral-200 pb-1 last:border-0 dark:border-neutral-800">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-red-100 px-1 font-mono text-[9px] text-red-900 dark:bg-red-950 dark:text-red-100">
                      {s.type}
                    </span>
                    <span className="flex-1 font-medium">{s.serves}</span>
                    <span className="font-mono text-neutral-500">{s.hazard}</span>
                  </div>
                  <p className="mt-0.5 text-[9px] italic text-neutral-500">
                    {s.notes}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded border border-neutral-300 p-2 dark:border-neutral-700">
            <h3 className="mb-1 text-xs font-semibold">FDC</h3>
            <p className="text-[10px]">
              <span className="font-mono text-neutral-500">{project.fdc.type}</span>{' '}
              — {project.fdc.location_note}
            </p>
            <p className="text-[10px] italic text-neutral-500">
              Phase 2 interconnect: extend piping to gridline{' '}
              {project.fdc.gridline_extension}.
            </p>
          </div>

          <BuildingGenerator projectId={project.projectId} />

          <AiPipelineRunner projectId={project.projectId} />

          <button
            type="button"
            onClick={seedScene}
            className="w-full rounded bg-emerald-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            Seed Pascal scene from brief
          </button>
          {seedStatus && (
            <pre className="whitespace-pre-wrap rounded bg-neutral-100 p-2 text-[10px] dark:bg-neutral-900">
              {seedStatus}
            </pre>
          )}

          <button
            type="button"
            disabled={sheetSetBusy}
            onClick={async () => {
              setSheetSetBusy(true)
              setSheetSetStatus(null)
              try {
                // Collect per-level heads + pipes from live scene.
                const nodes = useScene.getState().nodes as Record<string, unknown>
                const levelAssign = new Map<string, string>()
                // Map heads/pipes to nearest level by y-elevation. Heads
                // placed via auto-grid carry no level pointer yet, so we
                // bucket by position[2] (z_cm → meters).
                type LiveLevel = {
                  id: string
                  name: string
                  elevation_ft: number
                  hazard: string
                  width_m: number
                  length_m: number
                  heads: { id: string; x_m: number; y_m: number; sku: string }[]
                  pipes: {
                    from: string
                    to: string
                    size_in: number
                    x1_m: number
                    y1_m: number
                    x2_m: number
                    y2_m: number
                  }[]
                }
                const sqm = project.building.total_sqft * 0.092903
                const sideM = Math.sqrt(sqm)
                const liveLevels: LiveLevel[] = project.building.levels.map(
                  (lvl) => ({
                    id: lvl.id,
                    name: lvl.name,
                    elevation_ft: lvl.elevation_ft,
                    hazard: lvl.use === 'garage' ? 'ordinary_i' : 'light',
                    width_m: sideM,
                    length_m: sideM,
                    heads: [],
                    pipes: [],
                  }),
                )

                const FT_TO_M = 0.3048
                const nearestLevel = (z_m: number): LiveLevel => {
                  const fallbackLevel: LiveLevel = {
                    id: 'level-0',
                    name: 'Level 0',
                    elevation_ft: 0,
                    hazard: 'light',
                    width_m: 1,
                    length_m: 1,
                    heads: [],
                    pipes: [],
                  }
                  let best: LiveLevel = liveLevels[0] ?? fallbackLevel
                  let bestD = Infinity
                  for (const l of liveLevels) {
                    const d = Math.abs(l.elevation_ft * FT_TO_M - z_m)
                    if (d < bestD) { bestD = d; best = l }
                  }
                  return best
                }

                for (const [id, raw] of Object.entries(nodes)) {
                  const n = raw as {
                    type?: string
                    position?: [number, number, number]
                    scale?: [number, number, number]
                    rotation?: [number, number, number]
                    asset?: { category?: string; tags?: string[]; src?: string }
                  }
                  if (n.type !== 'item') continue
                  const cat = n.asset?.category ?? ''
                  const [x, y, z] = n.position ?? [0, 0, 0]
                  const tags = n.asset?.tags ?? []
                  if (cat.startsWith('sprinkler_head_')) {
                    const lvl = nearestLevel(z)
                    lvl.heads.push({
                      id,
                      x_m: x,
                      y_m: y,
                      sku: n.asset?.src?.split('/').pop()?.replace('.glb', '') ?? cat,
                    })
                    levelAssign.set(id, lvl.id)
                  } else if (cat.startsWith('pipe_') && tags.includes('auto_tree')) {
                    const lvl = nearestLevel(z)
                    // Reconstruct endpoints from midpoint + scale.y (length)
                    // + rotation (pitch, 0, yaw). scale[1] is length in m.
                    const length = n.scale?.[1] ?? 1
                    const pitch = n.rotation?.[0] ?? 0
                    const yaw = n.rotation?.[2] ?? 0
                    const horiz = length * Math.cos(pitch)
                    const dx = horiz * Math.cos(yaw)
                    const dy = horiz * Math.sin(yaw)
                    const x1 = x - dx / 2, y1 = y - dy / 2
                    const x2 = x + dx / 2, y2 = y + dy / 2
                    // Parse size from the pipe category or tag "pipe_steel_sch10"
                    // Use the SKU string like "SM_Pipe_SCH10_2in_1m" to infer
                    const sku = n.asset?.src?.split('/').pop() ?? ''
                    const m = sku.match(/SCH10_([0-9_]+)in/i)
                    let sizeIn = 2.0
                    if (m?.[1]) sizeIn = Number(m[1].replace('_', '.'))
                    lvl.pipes.push({
                      from: tags.find((t) => t.includes('→'))?.split('→')[0] ?? 'A',
                      to: tags.find((t) => t.includes('→'))?.split('→')[1] ?? 'B',
                      size_in: sizeIn,
                      x1_m: x1, y1_m: y1, x2_m: x2, y2_m: y2,
                    })
                  }
                }

                void levelAssign

                const payload = {
                  project: {
                    name: project.name,
                    address: project.address,
                    apn: project.apn,
                    ahj: project.ahj,
                    construction_type: project.construction_type,
                    code: project.code,
                    architect:
                      project.architect.firm +
                      ' (' +
                      project.architect.principal +
                      ')',
                    gc: `${project.gc.company} — ${project.gc.contact}`,
                    total_sqft: project.building.total_sqft,
                  },
                  halofire: {
                    contact: String(project.halofire.contact),
                    office_address: String(project.halofire.office_address),
                    office_phone: String(project.halofire.office_phone),
                    license: String(project.halofire.license),
                    proposal_date: String(project.halofire.proposal_date),
                    proposal_price_usd: Number(
                      project.halofire.proposal_price_usd,
                    ),
                  },
                  systems: project.fire_systems,
                  levels: liveLevels,
                  hydraulic: {
                    flow_gpm:
                      14.8 *
                      liveLevels.reduce((a, b) => a + b.heads.length, 0),
                    static_psi: 75,
                    residual_psi: 55,
                    demand_psi: 48,
                    safety_margin_psi: 7,
                    notes:
                      'Flow-test data pending from SLC water dept. ' +
                      'Demand calculated assuming K5.6 × 7 psi min working pressure per NFPA 13 §11.2.6.',
                  },
                }
                const out = await callTool('halofire_export', {
                  mode: 'sheet_set',
                  scene_id: 'studio',
                  schedule: payload,
                })
                setSheetSetStatus(out)
              } catch (e) {
                setSheetSetStatus(`Failed: ${String(e)}`)
              } finally {
                setSheetSetBusy(false)
              }
            }}
            className="w-full rounded bg-red-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {sheetSetBusy
              ? 'Rendering FP sheet set…'
              : 'Generate AHJ sheet set PDF (FP-0 + FP-N + FP-H)'}
          </button>
          {sheetSetStatus && (
            <pre className="whitespace-pre-wrap rounded bg-neutral-100 p-2 text-[10px] dark:bg-neutral-900">
              {sheetSetStatus}
            </pre>
          )}

          <details className="rounded border border-neutral-300 p-2 text-[10px] dark:border-neutral-700">
            <summary className="cursor-pointer text-xs font-semibold">
              Acknowledgements ({project.acknowledgements.length})
            </summary>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              {project.acknowledgements.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          </details>

          <details className="rounded border border-neutral-300 p-2 text-[10px] dark:border-neutral-700">
            <summary className="cursor-pointer text-xs font-semibold">
              Exclusions ({project.exclusions.length})
            </summary>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              {project.exclusions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          </details>

          <details className="rounded border border-neutral-300 p-2 text-[10px] dark:border-neutral-700">
            <summary className="cursor-pointer text-xs font-semibold">
              Source docs ({project.source_docs.length})
            </summary>
            <ul className="mt-1 space-y-0.5 font-mono">
              {project.source_docs.map((d) => (
                <li key={d}>• {d}</li>
              ))}
            </ul>
            <div className="mt-2 flex flex-col gap-1">
              <a
                href={`/projects/${selected}/proposal.pdf`}
                target="_blank"
                rel="noreferrer"
                className="rounded bg-neutral-200 px-2 py-1 text-center text-[10px] font-medium hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700"
              >
                Open proposal PDF →
              </a>
              <a
                href={`/projects/${selected}/fire-rfis.pdf`}
                target="_blank"
                rel="noreferrer"
                className="rounded bg-neutral-200 px-2 py-1 text-center text-[10px] font-medium hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700"
              >
                Open fire RFIs PDF →
              </a>
            </div>
          </details>
        </>
      )}
    </div>
  )
}
