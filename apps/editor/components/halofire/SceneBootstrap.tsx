'use client'

/**
 * SceneBootstrap — on first mount, spawn a visible 3D scene so the
 * viewport is never empty.
 *
 * Strategy:
 *   1. If gateway is up, POST /building/generate → get GLB URL →
 *      spawn a Pascal item-node referencing it
 *   2. Place a "catalog showcase" — one copy of each of the 20
 *      catalog SKUs laid out in a grid so the user can see what
 *      components are available without clicking + placing each
 *      one individually
 *
 * Addresses the explicit feedback: "none of these catalog items are
 * real models" — now every catalog SKU renders on load at a
 * designated showcase coordinate.
 *
 * Runs ONCE per session. Guarded by a sessionStorage flag.
 */

import { CATALOG } from '@halofire/catalog'
import { generateId, useScene } from '@pascal-app/core'
import { useEffect, useRef } from 'react'

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18080'
const SESSION_KEY = 'halofire-scene-bootstrapped'

// Grid layout for the catalog showcase. One SKU per cell, 2 m apart,
// laid out behind where the generated building drops.
const SHOWCASE_ORIGIN: [number, number, number] = [-50, 0, -50]
const SHOWCASE_SPACING = 3.0
const SHOWCASE_COLS = 5

export function SceneBootstrap({ projectId }: { projectId: string }) {
  const createNode = useScene((s) => s.createNode)
  const nodes = useScene((s) => s.nodes)
  const nodeCount = Object.keys(nodes ?? {}).length
  const ranRef = useRef(false)

  useEffect(() => {
    // Guard: only run once per session AND only if the scene is
    // essentially empty (< 5 pre-existing nodes)
    if (ranRef.current) return
    if (typeof window === 'undefined') return
    if (sessionStorage.getItem(SESSION_KEY) === 'done') return
    if (nodeCount > 5) {
      // Scene has stuff — probably user-placed. Don't spawn.
      return
    }
    ranRef.current = true

    void (async () => {
      try {
        await bootstrapScene({ projectId, createNode })
        sessionStorage.setItem(SESSION_KEY, 'done')
      } catch (e) {
        // Failure is non-fatal — the user can still manually use the
        // Auto-Design or Catalog tabs.
        console.warn('[HaloFire] scene bootstrap skipped:', e)
      }
    })()
  }, [projectId, createNode, nodeCount])

  return null
}

// biome-ignore lint/suspicious/noExplicitAny: Pascal's createNode has a
// complex AnyNode union; casting at the type boundary keeps parity with
// the rest of the HaloFire call sites.
type CreateNodeFn = (node: any, parentId?: any) => void

async function bootstrapScene(opts: {
  projectId: string
  createNode: CreateNodeFn
}): Promise<void> {
  const { projectId, createNode } = opts

  // Always place the catalog showcase first — works even with gateway
  // offline because GLBs are static assets under /halofire-catalog/glb/
  placeCatalogShowcase({ createNode })

  // Try the building shell (requires gateway). If offline, we at
  // least have the catalog visible so the user sees assets.
  try {
    const res = await fetch(`${GATEWAY_URL}/building/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        total_sqft_target: 100000,
        stories: 4,
        garage_levels: 2,
        aspect_ratio: 1.6,
      }),
    })
    if (!res.ok) return
    const data = await res.json()
    if (!data.glb_url) return

    const widthM = data.footprint_m?.width ?? 30
    const lengthM = data.footprint_m?.length ?? 45
    const stories = 4 + 2
    const totalHeight = stories * 3.0

    createNode(
      {
        id: generateId('item'),
        type: 'item',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        children: [],
        asset: {
          id: `synthetic_building_${projectId}`,
          category: 'synthetic_building',
          name: 'Synthetic bid building',
          thumbnail: '/icons/item.png',
          dimensions: [widthM, totalHeight, lengthM],
          src: `${GATEWAY_URL}${data.glb_url}`,
          attachTo: 'floor',
          offset: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          tags: ['halofire', 'synthetic', 'building_shell', 'bootstrap'],
        },
      },
      undefined,
    )
  } catch (e) {
    console.warn('[HaloFire] gateway unreachable during bootstrap:', e)
  }
}

function placeCatalogShowcase(opts: {
  createNode: CreateNodeFn
}): void {
  const { createNode } = opts
  let idx = 0
  for (const entry of CATALOG) {
    const row = Math.floor(idx / SHOWCASE_COLS)
    const col = idx % SHOWCASE_COLS
    const x = SHOWCASE_ORIGIN[0] + col * SHOWCASE_SPACING
    const z = SHOWCASE_ORIGIN[2] + row * SHOWCASE_SPACING
    const y = SHOWCASE_ORIGIN[1]

    const [dw, dd, dh] = entry.dims_cm
    const dimsMeters: [number, number, number] = [dw / 100, dh / 100, dd / 100]

    try {
      createNode(
        {
          id: generateId('item'),
          type: 'item',
          position: [x, y, z],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          children: [],
          asset: {
            id: `showcase_${entry.sku}`,
            category: entry.category,
            name: entry.name,
            thumbnail: '/icons/item.png',
            dimensions: dimsMeters,
            src: `/halofire-catalog/glb/${entry.sku}.glb`,
            attachTo: 'floor',
            offset: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            tags: ['halofire', entry.category, 'catalog_showcase'],
          },
        },
        undefined,
      )
      idx++
    } catch (e) {
      // per-SKU failure is fine — keep placing others
      console.warn('[HaloFire] showcase skipped', entry.sku, e)
    }
  }
}
