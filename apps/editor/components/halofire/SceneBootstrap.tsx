'use client'

/**
 * SceneBootstrap — on first mount, spawn a visible catalog showcase
 * under the active Pascal level so the viewport is never empty.
 *
 * Strategy:
 *   1. Place a "catalog showcase" — one copy of each of the 20
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

import { CATALOG, materialFor } from '@halofire/catalog'
import { generateId, useScene } from '@pascal-app/core'
import { useEffect, useRef } from 'react'

const SESSION_KEY = 'halofire-scene-bootstrapped'

// Grid layout for the catalog showcase. One SKU per cell, 2 m apart,
// laid out behind where the generated building drops.
// Placed inside the default 30x30 site polygon so items are visible
// in the initial camera view. Grid origin is the back-left corner
// of a 5-wide x 4-deep showcase grid with 2.5m spacing.
const SHOWCASE_ORIGIN: [number, number, number] = [-6, 0, -6]
const SHOWCASE_SPACING = 2.5
const SHOWCASE_COLS = 5

export function SceneBootstrap({ projectId }: { projectId: string }) {
  const createNode = useScene((s) => s.createNode)
  const nodes = useScene((s) => s.nodes)
  const rootNodeIds = useScene((s) => s.rootNodeIds)
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    if (typeof window === 'undefined') return

    // Wait until Pascal has set up the default site/building/level
    // tree. rootNodeIds is populated after the first scene-store
    // commit. If it's still empty, bail and let the next render try.
    if (!rootNodeIds || rootNodeIds.length === 0) return

    // Smart gate: check if catalog showcase is already present
    // (by scanning existing node tags for 'catalog_showcase').
    // If so, the bootstrap already ran; skip regardless of
    // sessionStorage. If not, run — even if the session flag is
    // stale from a prior session.
    const existing = Object.values(nodes ?? {}).some((n) => {
      const asset = (n as { asset?: { tags?: string[] } }).asset
      return asset?.tags?.includes('catalog_showcase')
    })
    if (existing) {
      ranRef.current = true
      return
    }
    ranRef.current = true

    // Find the first Level node in the flat node dict.
    // Catalog items must be parented to a Level, not the Site root,
    // otherwise Pascal's viewer filters them out ("No elements on this level").
    let levelId: string | undefined
    for (const n of Object.values(nodes ?? {})) {
      const typed = n as { type?: string; id?: string }
      if (typed?.type === 'level' && typed.id) {
        levelId = typed.id
        break
      }
    }
    if (!levelId) {
      // Scene tree not ready yet — wait for next render
      ranRef.current = false
      return
    }

    console.info(
      '[HaloFire] SceneBootstrap running — spawning catalog showcase under level',
      levelId,
    )
    void (async () => {
      try {
        await bootstrapScene({
          projectId,
          createNode,
          parentId: levelId,
        })
        sessionStorage.setItem(SESSION_KEY, 'done')
        console.info('[HaloFire] SceneBootstrap complete')
      } catch (e) {
        console.warn('[HaloFire] scene bootstrap failed:', e)
      }
    })()
  }, [projectId, createNode, nodes, rootNodeIds])

  return null
}

type CreateNodeFn = (node: any, parentId?: any) => void

async function bootstrapScene(opts: {
  projectId: string
  createNode: CreateNodeFn
  parentId?: unknown
}): Promise<void> {
  const { createNode, parentId } = opts
  void opts.projectId

  // Place the catalog showcase (static GLBs).
  // SceneBootstrap passes Pascal's rootNodeIds[0] as parentId so
  // the items are attached to the active site/level tree — otherwise
  // they're orphans and don't show in the viewport.
  placeCatalogShowcase({ createNode, parentId })
}

function placeCatalogShowcase(opts: {
  createNode: CreateNodeFn
  parentId?: unknown
}): void {
  const { createNode, parentId } = opts
  let idx = 0
  let spawned = 0
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
            tags: [
              'halofire',
              entry.category,
              'catalog_showcase',
              // Renderer's getHalofireTint reads this and applies a
              // MeshStandardNodeMaterial with the given base color,
              // so chrome heads, brass gauges, and red-painted pipes
              // actually look like their real-world finish instead
              // of the GLB's raw grey default.
              `halofire_pipe_color:${materialFor(entry).color_hex}`,
              `halofire_material:${materialFor(entry).name}`,
            ],
          },
        },
        parentId,
      )
      idx++
      spawned++
    } catch (e) {
      // per-SKU failure is fine — keep placing others
      console.warn('[HaloFire] showcase skipped', entry.sku, e)
      idx++
    }
  }
  console.info(
    `[HaloFire] catalog showcase: spawned ${spawned}/${CATALOG.length} `
    + `at origin ${SHOWCASE_ORIGIN.join(',')} under parent ${String(parentId)}`,
  )
}
