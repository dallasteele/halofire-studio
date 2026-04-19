'use client'

/**
 * Phase J — procedural building generator UI.
 *
 * "Generate test building" button calls the gateway's /building/generate,
 * fetches the resulting GLB URL, and spawns a Pascal scene node that
 * references the GLB so the Three.js viewport actually shows walls,
 * slabs, shafts. This fixes "the scene is empty" problem.
 *
 * Per AGENTIC_RULES §13 honesty: every generated building surfaces
 * the SYNTHESIZED banner in the UI so nobody mistakes it for a real
 * architect deliverable.
 */

import { generateId, useScene } from '@pascal-app/core'
import { useCallback, useState } from 'react'

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18080'

interface GenResult {
  project_id: string
  levels: number
  total_sqft: number
  footprint_m: { width?: number; length?: number }
  synthesized: boolean
  building_json: string
  glb_url: string
  glb_error: string | null
}

export function BuildingGenerator({ projectId }: { projectId: string }) {
  const [stories, setStories] = useState(4)
  const [garageLevels, setGarageLevels] = useState(2)
  const [totalSqft, setTotalSqft] = useState(100000)
  const [aspectRatio, setAspectRatio] = useState(1.5)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<GenResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const createNode = useScene((s) => s.createNode)

  const onGenerate = useCallback(async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`${GATEWAY_URL}/building/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          total_sqft_target: totalSqft,
          stories,
          garage_levels: garageLevels,
          aspect_ratio: aspectRatio,
        }),
      })
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(`HTTP ${res.status}: ${msg.slice(0, 200)}`)
      }
      const data: GenResult = await res.json()
      setResult(data)

      // Spawn a single Pascal item-node pointing at the GLB so the
      // Three.js viewport renders the shell.
      if (data.glb_url) {
        const widthM = data.footprint_m.width ?? 30
        const lengthM = data.footprint_m.length ?? 45
        const levelHeight = 3.0
        const totalHeight = (stories + garageLevels) * levelHeight
        try {
          createNode({
            id: generateId('item'),
            type: 'item',
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            children: [],
            asset: {
              id: `synthetic_building_${projectId}`,
              category: 'synthetic_building',
              name: `Synthetic Building (${projectId})`,
              thumbnail: '/icons/item.png',
              dimensions: [widthM, totalHeight, lengthM],
              src: `${GATEWAY_URL}${data.glb_url}`,
              attachTo: 'floor',
              offset: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              tags: ['halofire', 'synthetic', 'building_shell'],
            },
            // biome-ignore lint/suspicious/noExplicitAny: Pascal shape expected at runtime
          } as any, undefined)
        } catch (e) {
          setError(`Scene spawn failed: ${String(e)}`)
        }
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [projectId, totalSqft, stories, garageLevels, aspectRatio, createNode])

  return (
    <div className="rounded border border-neutral-300 p-2 text-xs dark:border-neutral-700">
      <h3 className="mb-1 text-xs font-semibold">
        Procedural Building Generator
      </h3>
      <p className="mb-2 text-[10px] text-neutral-500">
        Generate a plausible test building (walls, slabs, stair shafts)
        so the fire-protection agents have real geometry to operate on.
        Output is marked <code>synthesized=true</code> — not a real
        architect drawing.
      </p>
      <div className="mb-2 grid grid-cols-2 gap-1">
        <label className="flex flex-col">
          <span className="text-[9px] text-neutral-500">Total sqft</span>
          <input
            type="number"
            value={totalSqft}
            onChange={(e) => setTotalSqft(Number(e.target.value) || 100000)}
            className="rounded border border-neutral-300 bg-neutral-50 px-1 py-0.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-[9px] text-neutral-500">Aspect L/W</span>
          <input
            type="number"
            step="0.1"
            value={aspectRatio}
            onChange={(e) => setAspectRatio(Number(e.target.value) || 1.5)}
            className="rounded border border-neutral-300 bg-neutral-50 px-1 py-0.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-[9px] text-neutral-500">Stories</span>
          <input
            type="number"
            value={stories}
            onChange={(e) => setStories(Number(e.target.value) || 4)}
            className="rounded border border-neutral-300 bg-neutral-50 px-1 py-0.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-[9px] text-neutral-500">Garage levels</span>
          <input
            type="number"
            value={garageLevels}
            onChange={(e) => setGarageLevels(Number(e.target.value) || 0)}
            className="rounded border border-neutral-300 bg-neutral-50 px-1 py-0.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onGenerate}
        className="w-full rounded bg-indigo-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? 'Generating…' : 'Generate test building'}
      </button>

      {error && (
        <p className="mt-1 text-[10px] text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-2 rounded bg-amber-50 p-2 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-semibold">
            ⚠ SYNTHESIZED — not a real architect drawing
          </p>
          <p className="mt-1">
            {result.levels} levels · {Math.round(result.total_sqft).toLocaleString()} sqft ·
            {' '}
            {result.footprint_m.width?.toFixed(1)} m ×{' '}
            {result.footprint_m.length?.toFixed(1)} m footprint
          </p>
          <p className="mt-1">
            GLB:{' '}
            <a
              href={`${GATEWAY_URL}${result.glb_url}`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {result.glb_url}
            </a>
          </p>
          {result.glb_error && (
            <p className="mt-1 text-red-700 dark:text-red-300">
              GLB error: {result.glb_error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
