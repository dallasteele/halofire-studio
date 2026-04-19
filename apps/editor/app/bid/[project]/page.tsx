'use client'

/**
 * HaloFire client-facing bid viewer — responsive desktop + mobile.
 *
 * Data source: /projects/<id>.json (static project brief) AND
 * GATEWAY_URL/projects/<id>/proposal.json (live proposal from the
 * CAD pipeline once the agent run completes).
 *
 * Desktop layout: left sidebar facts, large 3D canvas, right drawer
 * with proposal numbers + sheet-set download links.
 * Mobile layout: tabbed (Overview / 3D / Sheets / Price) — swipe.
 */

import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import { use, useEffect, useMemo, useState } from 'react'

const FT_TO_M = 0.3048

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18080'

// Industry pipe-size colors (AutoSprink convention)
const PIPE_COLOR: Record<number, string> = {
  1.0: '#FFFF00',
  1.25: '#FF00FF',
  1.5: '#00FFFF',
  2.0: '#0066FF',
  2.5: '#00C040',
  3.0: '#E8432D',
  4.0: '#FFFFFF',
}

interface ProposalData {
  version: number
  generated_at: string
  project: {
    id: string
    name: string
    address: string
    ahj?: string
    code?: string
    construction_type?: string
    halofire?: { name?: string; contact?: string; license?: string }
  }
  building_summary: {
    total_sqft?: number
    construction_type?: string
    level_count: number
  }
  levels: {
    id: string
    name: string
    use: string
    elevation_ft: number
    head_count: number
    pipe_count: number
    pipe_total_ft: number
    room_count: number
  }[]
  systems: {
    id: string
    type: string
    head_count: number
    pipe_count: number
    pipe_total_m: number
    hydraulic?: {
      required_flow_gpm?: number
      required_pressure_psi?: number
      supply_static_psi?: number
      supply_residual_psi?: number
      demand_psi?: number
      safety_margin_psi?: number
    }
  }[]
  scope_of_work: string[]
  acknowledgements: string[]
  inclusions: string[]
  exclusions: string[]
  bom: { sku: string; description: string; qty: number; unit: string; extended_usd: number }[]
  labor: { role: string; hours: number; rate_usd_hr: number; extended_usd: number }[]
  violations: { rule_id: string; severity: string; message: string }[]
  pricing: {
    materials_usd: number
    labor_usd: number
    permit_allowance_usd: number
    taxes_usd: number
    subtotal_usd: number
    total_usd: number
  }
  deliverables: Record<string, string>
}

interface LegacyProject {
  projectId: string
  name: string
  address: string
  ahj: string
  halofire: { proposal_price_usd: number; proposal_date: string; contact: string }
  building: { total_sqft: number; levels: { id: string; name: string; use: string; elevation_ft: number; sqft: number }[] }
  fire_systems: { id: string; type: string; serves: string; hazard: string }[]
}

type Vec2 = [number, number]
type Vec3 = [number, number, number]

interface DesignData {
  project: {
    id: string
    name: string
    address: string
    ahj?: string
    total_sqft?: number | null
  }
  building: {
    total_sqft?: number | null
    levels: DesignLevel[]
  }
  systems: DesignSystem[]
  confidence?: {
    overall?: number
    ingest?: number
    layout?: number
    hydraulic?: number
  }
  issues?: { code: string; severity: string; message: string }[]
  deliverables?: { files?: Record<string, string>; warnings?: string[] }
  metadata?: { capabilities?: Record<string, boolean> }
}

interface DesignLevel {
  id: string
  name: string
  elevation_m: number
  height_m?: number
  use?: string
  polygon_m?: Vec2[]
  rooms?: { id: string; polygon_m?: Vec2[] }[]
}

interface DesignSystem {
  id: string
  supplies?: string[]
  heads?: {
    id: string
    position_m: Vec3
    room_id?: string | null
  }[]
  pipes?: {
    id: string
    size_in: number
    start_m: Vec3
    end_m: Vec3
    system_id?: string | null
  }[]
}

interface RenderLevel {
  id: string
  name: string
  use: string
  elevation_ft: number
  elevation_m: number
  sqft?: number
}

interface RenderGeometry {
  heads: { id: string; pos: Vec3; levelId: string }[]
  pipes: { id: string; from: Vec3; to: Vec3; sizeIn: number; levelId: string }[]
  source: 'design' | 'empty'
}

function toViewerPoint([x, y, z]: Vec3): Vec3 {
  return [x, z, y]
}

// ── 3D building blocks ──────────────────────────────────────────────

function HeadMarker({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.1, 10, 10]} />
      <meshStandardMaterial color="#e8432d" emissive="#e8432d" emissiveIntensity={0.3} />
    </mesh>
  )
}

function PipeSegment({
  from, to, sizeIn,
}: { from: [number, number, number]; to: [number, number, number]; sizeIn: number }) {
  const [midX, midY, midZ] = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2,
  ]
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  const len = Math.max(0.01, Math.sqrt(dx * dx + dy * dy + dz * dz))
  const horiz = Math.sqrt(dx * dx + dz * dz)
  const yaw = Math.atan2(dz, dx)
  const pitch = Math.atan2(dy, horiz) - Math.PI / 2
  const radius = Math.max(0.025, (sizeIn * 0.0254) / 2)
  return (
    <mesh position={[midX, midY, midZ]} rotation={[0, -yaw, pitch]}>
      <cylinderGeometry args={[radius, radius, len, 10]} />
      <meshStandardMaterial color={PIPE_COLOR[sizeIn] ?? '#888'} metalness={0.6} roughness={0.4} />
    </mesh>
  )
}

function FloorSlab({
  elevation_ft, sideM, visible, isGarage,
}: { elevation_ft: number; sideM: number; visible: boolean; isGarage: boolean }) {
  if (!visible) return null
  const y = elevation_ft * FT_TO_M
  return (
    <mesh
      position={[sideM / 2, y, sideM / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[sideM, sideM]} />
      <meshStandardMaterial
        color={isGarage ? '#3a3530' : '#5a5a6a'}
        transparent
        opacity={0.45}
        side={2}
      />
    </mesh>
  )
}

function LevelSlab({
  level, sideM, visible,
}: { level: RenderLevel; sideM: number; visible: boolean }) {
  return (
    <FloorSlab
      elevation_ft={level.elevation_ft}
      sideM={sideM}
      visible={visible}
      isGarage={level.use === 'garage'}
    />
  )
}

// ── Page component ─────────────────────────────────────────────────

export default function BidView(props: { params: Promise<{ project: string }> }) {
  const params = use(props.params)
  const [project, setProject] = useState<LegacyProject | null>(null)
  const [proposal, setProposal] = useState<ProposalData | null>(null)
  const [design, setDesign] = useState<DesignData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [visibleLevels, setVisibleLevels] = useState<Set<string>>(new Set())
  const [isMobile, setIsMobile] = useState(false)
  const [mobileTab, setMobileTab] = useState<'overview' | 'model' | 'sheets' | 'price'>('overview')

  // Detect mobile viewport
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Load static project metadata
  useEffect(() => {
    fetch(`/projects/${params.project}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LegacyProject | null) => {
        if (d) {
          setProject(d)
          setVisibleLevels(new Set(d.building.levels.map((l) => l.id)))
        }
      })
      .catch((e) => setError(String(e)))
  }, [params.project])

  // Load live proposal from the CAD pipeline
  useEffect(() => {
    fetch(`${GATEWAY_URL}/projects/${params.project}/proposal.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ProposalData | null) => {
        if (d) setProposal(d)
      })
      .catch(() => {
        // No pipeline run yet — fall back to static data
      })
  }, [params.project])

  // Load the generated CAD design. This is the geometry source of truth
  // when the agentic pipeline has produced heads + pipe networks.
  useEffect(() => {
    fetch(`${GATEWAY_URL}/projects/${params.project}/design.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DesignData | null) => {
        if (d) setDesign(d)
      })
      .catch(() => {
        // No design run yet; the viewer can still show static bid context.
      })
  }, [params.project])

  const levels: RenderLevel[] = useMemo(() => {
    if (design?.building?.levels?.length) {
      return design.building.levels.map((level) => ({
        id: level.id,
        name: level.name,
        use: level.use ?? 'other',
        elevation_ft: Number((level.elevation_m * 3.28084).toFixed(1)),
        elevation_m: level.elevation_m,
      }))
    }
    return (project?.building?.levels ?? []).map((level) => ({
      id: level.id,
      name: level.name,
      use: level.use,
      elevation_ft: level.elevation_ft,
      elevation_m: level.elevation_ft * FT_TO_M,
      sqft: level.sqft,
    }))
  }, [design, project])

  useEffect(() => {
    if (visibleLevels.size > 0 || levels.length === 0) return
    setVisibleLevels(new Set(levels.map((level) => level.id)))
  }, [levels, visibleLevels.size])

  const sideM = useMemo(() => {
    const sqft = proposal?.building_summary?.total_sqft
      ?? design?.building?.total_sqft
      ?? project?.building?.total_sqft
      ?? 50000
    return Math.sqrt(sqft * 0.092903)
  }, [design, project, proposal])

  const renderedGeometry: RenderGeometry = useMemo(() => {
    const heads: RenderGeometry['heads'] = []
    const pipes: RenderGeometry['pipes'] = []
    if (design?.systems?.length) {
      const levelByRoom = new Map<string, string>()
      for (const level of design.building.levels) {
        for (const room of level.rooms ?? []) {
          levelByRoom.set(room.id, level.id)
        }
      }
      const nearestLevel = (verticalM: number): string => {
        if (levels.length === 0) return 'design'
        return levels.reduce((best, level) =>
          Math.abs(level.elevation_m - verticalM) < Math.abs(best.elevation_m - verticalM)
            ? level
            : best,
        ).id
      }

      for (const system of design.systems) {
        const defaultLevelId = system.supplies?.[0] ?? levels[0]?.id ?? 'design'
        for (const head of system.heads ?? []) {
          heads.push({
            id: head.id,
            levelId: head.room_id ? (levelByRoom.get(head.room_id) ?? defaultLevelId) : defaultLevelId,
            pos: toViewerPoint(head.position_m),
          })
        }
        for (const pipe of system.pipes ?? []) {
          pipes.push({
            id: pipe.id,
            from: toViewerPoint(pipe.start_m),
            to: toViewerPoint(pipe.end_m),
            sizeIn: pipe.size_in,
            levelId: system.supplies?.[0] ?? nearestLevel(pipe.start_m[2]),
          })
        }
      }
      if (heads.length > 0 || pipes.length > 0) {
        return { heads, pipes, source: 'design' }
      }
    }

    return { heads, pipes, source: 'empty' }
  }, [design, levels])
  const displayPrice =
    proposal?.pricing?.total_usd ?? project?.halofire?.proposal_price_usd ?? 0
  const displayProjectName = proposal?.project?.name ?? project?.name ?? params.project
  const designWarnings = [
    ...(design?.issues ?? [])
      .filter((issue) => ['warning', 'error', 'blocking'].includes(issue.severity))
      .map((issue) => `${issue.code}: ${issue.message}`),
    ...(design?.deliverables?.warnings ?? []),
  ].slice(0, 6)
  const confidencePct = design?.confidence?.overall !== undefined
    ? Math.round((design.confidence.overall ?? 0) * 100)
    : null

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-red-400">
        <div>
          <h1 className="text-xl font-bold">Couldn't load bid</h1>
          <p className="mt-2 font-mono text-xs">{error}</p>
        </div>
      </div>
    )
  }
  if (!project && !proposal) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <p>Loading bid package…</p>
      </div>
    )
  }

  // ── MOBILE layout ──────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="flex h-screen flex-col bg-neutral-950 text-white">
        <header className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-[#e8432d] text-xs font-bold">
            HF
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xs font-semibold">{displayProjectName}</h1>
            <p className="truncate text-[10px] text-neutral-400">{project?.address}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm font-bold text-[#e8432d]">
              ${Number(displayPrice).toLocaleString()}
            </p>
          </div>
        </header>

        {/* Tab bar */}
        <nav className="grid grid-cols-4 border-b border-neutral-800 bg-neutral-900 text-[11px]">
          {(['overview', 'model', 'sheets', 'price'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setMobileTab(t)}
              className={`py-2 capitalize ${
                mobileTab === t
                  ? 'border-b-2 border-[#e8432d] text-white'
                  : 'text-neutral-400'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto">
          {mobileTab === 'overview' && (
            <div className="space-y-3 p-3 text-xs">
              <div>
                <h2 className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">Project</h2>
                <p className="mt-1">{project?.address}</p>
                <p className="mt-1 text-neutral-400">{project?.ahj}</p>
                <p className="mt-1 text-[10px] text-neutral-500">
                  {confidencePct !== null ? `Design confidence ${confidencePct}%` : 'No generated design artifact loaded'}
                </p>
              </div>
              {designWarnings.length > 0 && (
                <div className="rounded border border-amber-900 bg-amber-950/40 p-2">
                  <h2 className="text-[10px] font-semibold uppercase tracking-widest text-amber-300">Alpha warnings</h2>
                  <ul className="mt-1 space-y-1 text-[10px] text-amber-100">
                    {designWarnings.map((warning, i) => <li key={i}>{warning}</li>)}
                  </ul>
                </div>
              )}
              <div>
                <h2 className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                  Levels ({levels.length})
                </h2>
                <ul className="mt-1 space-y-0.5">
                  {levels.map((l) => (
                    <li key={l.id} className="flex items-center gap-2 border-b border-neutral-800 py-1">
                      <span className="w-12 font-mono text-[10px] text-neutral-500">+{l.elevation_ft}ft</span>
                      <span className="flex-1">{l.name}</span>
                      <span className={`rounded px-1 font-mono text-[9px] ${l.use === 'garage' ? 'bg-amber-900 text-amber-200' : 'bg-sky-900 text-sky-200'}`}>
                        {l.use}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {proposal && (
                <div>
                  <h2 className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">Systems</h2>
                  <ul className="mt-1 space-y-1">
                    {proposal.systems.map((s) => (
                      <li key={s.id} className="border-b border-neutral-800 pb-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-red-900 px-1 font-mono text-[9px] text-red-200">{s.type}</span>
                          <span>{s.head_count} heads</span>
                          <span className="text-neutral-500">·</span>
                          <span>{(s.pipe_total_m * 3.281).toFixed(0)}ft pipe</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {mobileTab === 'model' && (
            <div className="h-full">
              <Canvas camera={{ position: [sideM * 1.3, sideM * 0.9, sideM * 1.3], fov: 50 }}>
                <ambientLight intensity={0.55} />
                <directionalLight position={[20, 30, 10]} intensity={1.2} />
                <Grid
                  position={[sideM / 2, 0, sideM / 2]}
                  args={[sideM * 1.5, sideM * 1.5]}
                  cellSize={1} cellColor="#333" sectionSize={10} sectionColor="#555"
                  fadeDistance={sideM * 3} infiniteGrid={false}
                />
                {levels.map((l) => (
                  <LevelSlab
                    key={l.id}
                    level={l}
                    sideM={sideM}
                    visible={visibleLevels.has(l.id)}
                  />
                ))}
                {renderedGeometry.heads
                  .filter((h) => visibleLevels.has(h.levelId))
                  .map((h) => <HeadMarker key={h.id} position={h.pos} />)}
                {renderedGeometry.pipes
                  .filter((p) => visibleLevels.has(p.levelId))
                  .map((p) => <PipeSegment key={p.id} from={p.from} to={p.to} sizeIn={p.sizeIn} />)}
                <OrbitControls
                  target={[sideM / 2, (levels[Math.floor(levels.length / 2)]?.elevation_ft ?? 24) * FT_TO_M, sideM / 2]}
                  makeDefault
                />
              </Canvas>
            </div>
          )}

          {mobileTab === 'sheets' && (
            <div className="space-y-2 p-3">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">Deliverables</h2>
              <a href={`${GATEWAY_URL}/projects/${params.project}/deliverable/proposal.pdf`} target="_blank" rel="noopener" className="block rounded bg-neutral-800 px-3 py-2 text-center text-xs">Proposal PDF</a>
              <a href={`${GATEWAY_URL}/projects/${params.project}/deliverable/proposal.xlsx`} target="_blank" rel="noopener" className="block rounded bg-neutral-800 px-3 py-2 text-center text-xs">Pricing XLSX</a>
              <a href={`${GATEWAY_URL}/projects/${params.project}/deliverable/design.dxf`} target="_blank" rel="noopener" className="block rounded bg-neutral-800 px-3 py-2 text-center text-xs">AutoCAD DXF</a>
              <a href={`${GATEWAY_URL}/projects/${params.project}/deliverable/design.ifc`} target="_blank" rel="noopener" className="block rounded bg-neutral-800 px-3 py-2 text-center text-xs">IFC (BIM)</a>
              <a href={`${GATEWAY_URL}/projects/${params.project}/deliverable/design.glb`} target="_blank" rel="noopener" className="block rounded bg-neutral-800 px-3 py-2 text-center text-xs">3D Model (GLB)</a>
              <a href={`/projects/${params.project}/proposal.pdf`} target="_blank" rel="noopener" className="block rounded bg-neutral-800 px-3 py-2 text-center text-xs">Original Halo Proposal</a>
              <a href={`/projects/${params.project}/fire-rfis.pdf`} target="_blank" rel="noopener" className="block rounded bg-neutral-800 px-3 py-2 text-center text-xs">Fire RFIs</a>
            </div>
          )}

          {mobileTab === 'price' && proposal && (
            <div className="space-y-2 p-3 text-xs">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">Pricing</h2>
              <div className="rounded border border-neutral-800 bg-neutral-900 p-3">
                <Row label="Materials" usd={proposal.pricing.materials_usd} />
                <Row label="Labor" usd={proposal.pricing.labor_usd} />
                <Row label="Permit allowance" usd={proposal.pricing.permit_allowance_usd} />
                <Row label="Subtotal" usd={proposal.pricing.subtotal_usd} />
                <Row label="Taxes" usd={proposal.pricing.taxes_usd} />
                <div className="mt-2 flex justify-between border-t border-neutral-800 pt-2 text-sm font-bold">
                  <span>Total</span>
                  <span className="font-mono text-[#e8432d]">${proposal.pricing.total_usd.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}
          {mobileTab === 'price' && !proposal && (
            <div className="p-3 text-xs text-neutral-400">
              No live proposal generated yet. Run the CAD pipeline via Studio or POST to /intake/upload.
            </div>
          )}
        </div>

        <footer className="border-t border-neutral-800 bg-neutral-900 px-3 py-2 text-[10px] text-neutral-500">
          HaloFire CAD · deferred-submittal preview · NOT FOR CONSTRUCTION
        </footer>
      </div>
    )
  }

  // ── DESKTOP layout ─────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-white">
      <header className="flex items-center gap-4 border-b border-neutral-800 bg-neutral-900 px-6 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-[#e8432d] text-sm font-bold">HF</div>
        <div className="flex-1">
          <h1 className="text-sm font-semibold uppercase tracking-wide">{displayProjectName}</h1>
          <p className="text-[11px] text-neutral-400">
            {project?.address} · {project?.ahj} · {project?.halofire?.contact ?? 'Halo Fire Protection'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-neutral-400">HaloFire CAD bid</p>
          <p className="font-mono text-lg font-bold text-[#e8432d]">
            ${Number(displayPrice).toLocaleString()}
          </p>
          <p className="text-[10px] text-neutral-500">
            {proposal ? `v${proposal.version} · ${proposal.generated_at}` : project?.halofire?.proposal_date}
          </p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-neutral-800 bg-neutral-900 p-4 text-xs">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">Project</h2>
          <dl className="mb-4 space-y-1">
            <div><dt className="text-neutral-500">Address</dt><dd>{project?.address}</dd></div>
            <div><dt className="text-neutral-500">AHJ</dt><dd>{project?.ahj}</dd></div>
            <div><dt className="text-neutral-500">Total sqft</dt><dd className="font-mono">{(proposal?.building_summary?.total_sqft ?? project?.building.total_sqft ?? 0).toLocaleString()}</dd></div>
            <div><dt className="text-neutral-500">Design confidence</dt><dd className="font-mono">{confidencePct !== null ? `${confidencePct}%` : 'not generated'}</dd></div>
          </dl>
          {designWarnings.length > 0 && (
            <div className="mb-4 rounded border border-amber-900 bg-amber-950/40 p-2">
              <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-amber-300">Alpha warnings</h2>
              <ul className="space-y-1 text-[10px] text-amber-100">
                {designWarnings.map((warning, i) => <li key={i}>{warning}</li>)}
              </ul>
            </div>
          )}

          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">Levels ({levels.length})</h2>
          <ul className="mb-4 space-y-1">
            {levels.map((l) => (
              <li key={l.id} className="flex items-center gap-2 border-b border-neutral-800 pb-1 last:border-0">
                <input
                  id={`lvl-${l.id}`} type="checkbox"
                  checked={visibleLevels.has(l.id)}
                  onChange={(e) => {
                    const next = new Set(visibleLevels)
                    if (e.target.checked) next.add(l.id); else next.delete(l.id)
                    setVisibleLevels(next)
                  }}
                  className="accent-[#e8432d]"
                />
                <label htmlFor={`lvl-${l.id}`} className="flex-1 cursor-pointer">
                  <span className="font-mono text-[10px] text-neutral-500">+{l.elevation_ft}ft</span> {l.name}
                </label>
                <span className={`rounded px-1 font-mono text-[9px] ${l.use === 'garage' ? 'bg-amber-900 text-amber-200' : 'bg-sky-900 text-sky-200'}`}>
                  {l.use}
                </span>
              </li>
            ))}
          </ul>

          {proposal && (
            <>
              <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">Systems ({proposal.systems.length})</h2>
              <ul className="mb-4 space-y-1">
                {proposal.systems.map((s) => (
                  <li key={s.id} className="border-b border-neutral-800 pb-1 text-[10px]">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[#e8432d]">{s.type}</span>
                      <span>{s.head_count} heads</span>
                    </div>
                    {s.hydraulic && (
                      <div className="mt-0.5 font-mono text-[9px] text-neutral-500">
                        {s.hydraulic.required_flow_gpm} gpm · {s.hydraulic.demand_psi} psi demand · margin {s.hydraulic.safety_margin_psi}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">Deliverables</h2>
          <div className="flex flex-col gap-1">
            <a href={`${GATEWAY_URL}/projects/${params.project}/deliverable/proposal.pdf`} target="_blank" rel="noopener" className="rounded bg-neutral-800 px-2 py-1 text-center text-[10px] hover:bg-neutral-700">Proposal PDF</a>
            <a href={`${GATEWAY_URL}/projects/${params.project}/deliverable/proposal.xlsx`} target="_blank" rel="noopener" className="rounded bg-neutral-800 px-2 py-1 text-center text-[10px] hover:bg-neutral-700">Pricing XLSX</a>
            <a href={`${GATEWAY_URL}/projects/${params.project}/deliverable/design.dxf`} target="_blank" rel="noopener" className="rounded bg-neutral-800 px-2 py-1 text-center text-[10px] hover:bg-neutral-700">AutoCAD DXF</a>
            <a href={`${GATEWAY_URL}/projects/${params.project}/deliverable/design.ifc`} target="_blank" rel="noopener" className="rounded bg-neutral-800 px-2 py-1 text-center text-[10px] hover:bg-neutral-700">IFC</a>
            <a href={`${GATEWAY_URL}/projects/${params.project}/deliverable/design.glb`} target="_blank" rel="noopener" className="rounded bg-neutral-800 px-2 py-1 text-center text-[10px] hover:bg-neutral-700">3D Model GLB</a>
            <a href={`/projects/${params.project}/proposal.pdf`} target="_blank" rel="noopener" className="rounded bg-neutral-800 px-2 py-1 text-center text-[10px] hover:bg-neutral-700">Halo Proposal</a>
            <a href={`/projects/${params.project}/fire-rfis.pdf`} target="_blank" rel="noopener" className="rounded bg-neutral-800 px-2 py-1 text-center text-[10px] hover:bg-neutral-700">Fire RFIs</a>
          </div>

          <p className="mt-4 text-[9px] italic text-neutral-600">
            Interactive 3D bid viewer · Drag to orbit · Scroll to zoom
          </p>
        </aside>

        {/* 3D canvas */}
        <main className="relative flex-1">
          <Canvas camera={{ position: [sideM * 1.3, sideM * 0.9, sideM * 1.3], fov: 45 }}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[20, 30, 10]} intensity={1.2} castShadow />
            <Grid
              position={[sideM / 2, 0, sideM / 2]}
              args={[sideM * 1.5, sideM * 1.5]}
              cellSize={1} cellColor="#333" sectionSize={10} sectionColor="#555"
              fadeDistance={sideM * 3} infiniteGrid={false}
            />
            {levels.map((l) => (
              <LevelSlab
                key={l.id}
                level={l}
                sideM={sideM}
                visible={visibleLevels.has(l.id)}
              />
            ))}
            {renderedGeometry.heads
              .filter((h) => visibleLevels.has(h.levelId))
              .map((h) => <HeadMarker key={h.id} position={h.pos} />)}
            {renderedGeometry.pipes
              .filter((p) => visibleLevels.has(p.levelId))
              .map((p) => <PipeSegment key={p.id} from={p.from} to={p.to} sizeIn={p.sizeIn} />)}
            <OrbitControls
              target={[sideM / 2, (levels[Math.floor(levels.length / 2)]?.elevation_ft ?? 24) * FT_TO_M, sideM / 2]}
              makeDefault
            />
          </Canvas>
          {renderedGeometry.source === 'empty' && (
            <div className="pointer-events-none absolute inset-x-8 top-8 rounded border border-amber-900 bg-neutral-950/85 p-3 text-xs text-amber-100">
              No generated sprinkler geometry is loaded. Run the intake pipeline
              and wait for a real design.json before using this model view for review.
            </div>
          )}
        </main>

        {/* Right drawer — pricing + violations */}
        {proposal && (
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-900 p-4 text-xs">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">Pricing</h2>
            <div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-[11px]">
              <Row label="Materials" usd={proposal.pricing.materials_usd} />
              <Row label="Labor" usd={proposal.pricing.labor_usd} />
              <Row label="Permit" usd={proposal.pricing.permit_allowance_usd} />
              <Row label="Subtotal" usd={proposal.pricing.subtotal_usd} />
              <Row label="Taxes" usd={proposal.pricing.taxes_usd} />
              <div className="mt-2 flex justify-between border-t border-neutral-800 pt-2 text-sm font-bold">
                <span>TOTAL</span>
                <span className="font-mono text-[#e8432d]">${proposal.pricing.total_usd.toLocaleString()}</span>
              </div>
            </div>

            <h2 className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
              Rule check ({proposal.violations.length})
            </h2>
            {proposal.violations.length === 0 ? (
              <p className="text-[10px] text-green-400">✓ All NFPA 13 rules passing.</p>
            ) : (
              <ul className="space-y-1">
                {proposal.violations.slice(0, 10).map((v, i) => (
                  <li key={i} className={`rounded border px-2 py-1 text-[10px] ${
                    v.severity === 'error'
                      ? 'border-red-900 bg-red-950/50 text-red-200'
                      : 'border-amber-900 bg-amber-950/50 text-amber-200'
                  }`}>
                    <span className="font-mono">{v.rule_id}</span>
                    <p className="mt-0.5">{v.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>

      <footer className="border-t border-neutral-800 bg-neutral-900 px-6 py-2 text-[10px] text-neutral-500">
        HaloFire CAD · deferred-submittal preview — NOT FOR CONSTRUCTION · Full plan set on permit release
      </footer>
    </div>
  )
}

function Row({ label, usd }: { label: string; usd: number }) {
  return (
    <div className="flex justify-between border-b border-neutral-800 py-1 last:border-0">
      <span className="text-neutral-400">{label}</span>
      <span className="font-mono">${usd.toLocaleString()}</span>
    </div>
  )
}
