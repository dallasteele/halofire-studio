'use client'

/**
 * Halofire client-facing bid viewer — standalone route the GC can
 * embed in their web bid package. No Pascal editor chrome; just:
 *   - Project brief header (Halo Fire branded)
 *   - Interactive 3D model (heads + pipes by level, orbit controls)
 *   - Per-level layer toggles
 *   - Proposal + sheet-set PDF download links
 *
 * URL: /bid/<projectId>  (e.g. /bid/1881-cooperative)
 * Data: pulled from /projects/<projectId>.json + optional scene snapshot
 * posted to sessionStorage by the editor's "publish" action (M2).
 */

import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import { use, useEffect, useMemo, useState } from 'react'

const FT_TO_M = 0.3048

interface Level {
  id: string
  name: string
  use: string
  elevation_ft: number
  sqft: number
}

interface Project {
  projectId: string
  name: string
  address: string
  ahj: string
  construction_type: string
  code: string
  architect: { firm: string; principal: string }
  gc: { company: string; contact: string }
  halofire: { contact: string; proposal_price_usd: number; proposal_date: string }
  building: { total_sqft: number; levels: Level[] }
  fire_systems: { id: string; type: string; serves: string; hazard: string }[]
  fdc: { type: string; location_note: string }
}

function HeadMarker({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.15, 12, 12]} />
      <meshStandardMaterial color="#e8432d" emissive="#e8432d" emissiveIntensity={0.3} />
    </mesh>
  )
}

function PipeSegment({
  from,
  to,
  sizeIn,
}: {
  from: [number, number, number]
  to: [number, number, number]
  sizeIn: number
}) {
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
  // Pipe cylinder's default axis is Y in three.js — orient Y along segment.
  // Compute Euler from direction vector (same approach as studio).
  const yaw = Math.atan2(dz, dx)
  const pitch = Math.atan2(dy, horiz) - Math.PI / 2
  const radius = (sizeIn * 0.0254) / 2 // inches → meters radius

  return (
    <mesh position={[midX, midY, midZ]} rotation={[0, -yaw, pitch]}>
      <cylinderGeometry args={[radius, radius, len, 10]} />
      <meshStandardMaterial color="#c00" metalness={0.6} roughness={0.4} />
    </mesh>
  )
}

function FloorSlab({
  level,
  sideM,
  visible,
}: {
  level: Level
  sideM: number
  visible: boolean
}) {
  if (!visible) return null
  const y = level.elevation_ft * FT_TO_M
  return (
    <mesh
      position={[sideM / 2, y, sideM / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[sideM, sideM]} />
      <meshStandardMaterial
        color={level.use === 'garage' ? '#3a3530' : '#5a5a6a'}
        transparent
        opacity={0.6}
        side={2}
      />
    </mesh>
  )
}

export default function BidView(props: {
  params: Promise<{ project: string }>
}) {
  const params = use(props.params)
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [visibleLevels, setVisibleLevels] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch(`/projects/${params.project}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: Project) => {
        setProject(data)
        setVisibleLevels(new Set(data.building.levels.map((l) => l.id)))
      })
      .catch((e) => setError(String(e)))
  }, [params.project])

  const sideM = useMemo(() => {
    if (!project) return 30
    return Math.sqrt(project.building.total_sqft * 0.092903)
  }, [project])

  // Demo heads + pipes per level (until an editor snapshot is published).
  const demoGeometry = useMemo(() => {
    if (!project) return { heads: [], pipes: [] }
    const heads: { id: string; pos: [number, number, number]; levelId: string }[] = []
    const pipes: {
      from: [number, number, number]
      to: [number, number, number]
      sizeIn: number
      levelId: string
    }[] = []
    for (const lvl of project.building.levels) {
      if (lvl.use !== 'residential') continue
      const z = lvl.elevation_ft * FT_TO_M + 3.2
      const nPerRow = 6
      const spacing = sideM / (nPerRow + 1)
      let prev: [number, number, number] | null = null
      for (let r = 0; r < nPerRow; r++) {
        for (let c = 0; c < nPerRow; c++) {
          const p: [number, number, number] = [
            (c + 1) * spacing,
            z,
            (r + 1) * spacing,
          ]
          heads.push({
            id: `${lvl.id}_h_${r}_${c}`,
            pos: p,
            levelId: lvl.id,
          })
          if (prev) {
            pipes.push({
              from: prev,
              to: p,
              sizeIn: c === 0 ? 2.0 : 1.0,
              levelId: lvl.id,
            })
          }
          prev = p
        }
        prev = null
      }
    }
    return { heads, pipes }
  }, [project, sideM])

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-red-400">
        <div>
          <h1 className="text-2xl font-bold">Couldn't load bid</h1>
          <p className="mt-2 font-mono text-sm">{error}</p>
        </div>
      </div>
    )
  }
  if (!project) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <p>Loading bid package…</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-white">
      {/* Halo Fire branded header */}
      <header className="flex items-center gap-4 border-b border-neutral-800 bg-neutral-900 px-6 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-[#e8432d] text-sm font-bold">
          HF
        </div>
        <div className="flex-1">
          <h1 className="text-sm font-semibold uppercase tracking-wide">
            {project.name}
          </h1>
          <p className="text-[11px] text-neutral-400">
            {project.address} · {project.ahj} · {project.construction_type}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-neutral-400">Halo Fire Protection</p>
          <p className="font-mono text-lg font-bold text-[#e8432d]">
            ${project.halofire.proposal_price_usd.toLocaleString()}
          </p>
          <p className="text-[10px] text-neutral-500">
            {project.halofire.contact} · {project.halofire.proposal_date}
          </p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: project facts + level toggles */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-neutral-800 bg-neutral-900 p-4 text-xs">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
            Project
          </h2>
          <dl className="mb-4 space-y-1">
            <div>
              <dt className="text-neutral-500">Architect</dt>
              <dd>{project.architect.firm}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">GC</dt>
              <dd>
                {project.gc.company} — {project.gc.contact}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">Code</dt>
              <dd className="font-mono">{project.code}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Total sqft</dt>
              <dd className="font-mono">
                {project.building.total_sqft.toLocaleString()}
              </dd>
            </div>
          </dl>

          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
            Levels ({project.building.levels.length})
          </h2>
          <ul className="mb-4 space-y-1">
            {project.building.levels.map((lvl) => (
              <li
                key={lvl.id}
                className="flex items-center gap-2 border-b border-neutral-800 pb-1 last:border-0"
              >
                <input
                  id={`lvl-${lvl.id}`}
                  type="checkbox"
                  checked={visibleLevels.has(lvl.id)}
                  onChange={(e) => {
                    const next = new Set(visibleLevels)
                    if (e.target.checked) next.add(lvl.id)
                    else next.delete(lvl.id)
                    setVisibleLevels(next)
                  }}
                  className="accent-[#e8432d]"
                />
                <label
                  htmlFor={`lvl-${lvl.id}`}
                  className="flex-1 cursor-pointer"
                >
                  <span className="font-mono text-[10px] text-neutral-500">
                    +{lvl.elevation_ft}ft
                  </span>{' '}
                  {lvl.name}
                </label>
                <span
                  className={`rounded px-1 font-mono text-[9px] ${
                    lvl.use === 'garage'
                      ? 'bg-amber-900 text-amber-200'
                      : 'bg-sky-900 text-sky-200'
                  }`}
                >
                  {lvl.use}
                </span>
              </li>
            ))}
          </ul>

          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
            Fire Systems ({project.fire_systems.length})
          </h2>
          <ul className="mb-4 space-y-1">
            {project.fire_systems.map((s) => (
              <li key={s.id} className="border-b border-neutral-800 pb-1 last:border-0">
                <span className="font-mono text-[9px] text-[#e8432d]">
                  {s.type}
                </span>
                <p className="text-[10px]">{s.serves}</p>
              </li>
            ))}
          </ul>

          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
            Deliverables
          </h2>
          <div className="flex flex-col gap-1">
            <a
              href={`/projects/${params.project}/proposal.pdf`}
              target="_blank"
              rel="noreferrer"
              className="rounded bg-neutral-800 px-2 py-1 text-center text-[10px] hover:bg-neutral-700"
            >
              Proposal PDF →
            </a>
            <a
              href={`/projects/${params.project}/fire-rfis.pdf`}
              target="_blank"
              rel="noreferrer"
              className="rounded bg-neutral-800 px-2 py-1 text-center text-[10px] hover:bg-neutral-700"
            >
              Fire RFIs PDF →
            </a>
          </div>

          <p className="mt-4 text-[9px] italic text-neutral-600">
            Interactive 3D bid viewer · Drag to orbit · Scroll to zoom
          </p>
        </aside>

        {/* 3D canvas */}
        <main className="flex-1">
          <Canvas camera={{ position: [sideM * 1.3, sideM * 0.9, sideM * 1.3], fov: 45 }}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[20, 30, 10]} intensity={1.2} castShadow />
            <Grid
              position={[sideM / 2, 0, sideM / 2]}
              args={[sideM * 1.5, sideM * 1.5]}
              cellSize={1}
              cellColor="#333"
              sectionSize={10}
              sectionColor="#555"
              fadeDistance={sideM * 3}
              infiniteGrid={false}
            />
            {project.building.levels.map((lvl) => (
              <FloorSlab
                key={lvl.id}
                level={lvl}
                sideM={sideM}
                visible={visibleLevels.has(lvl.id)}
              />
            ))}
            {demoGeometry.heads
              .filter((h) => visibleLevels.has(h.levelId))
              .map((h) => (
                <HeadMarker key={h.id} position={h.pos} />
              ))}
            {demoGeometry.pipes
              .filter((p) => visibleLevels.has(p.levelId))
              .map((p, i) => (
                <PipeSegment
                  key={i}
                  from={p.from}
                  to={p.to}
                  sizeIn={p.sizeIn}
                />
              ))}
            <OrbitControls
              target={[sideM / 2, (project.building.levels[2]?.elevation_ft ?? 24) * FT_TO_M, sideM / 2]}
              makeDefault
            />
          </Canvas>
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-neutral-800 bg-neutral-900 px-6 py-2 text-[10px] text-neutral-500">
        <span>
          HaloFire Studio · deferred-submittal preview — NOT FOR CONSTRUCTION ·
          Full plan set available via Halo Fire upon permit release
        </span>
      </footer>
    </div>
  )
}
