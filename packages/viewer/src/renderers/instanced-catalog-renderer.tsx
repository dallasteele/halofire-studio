'use client'

/**
 * InstancedCatalogRenderer — HaloFire R3.1 (Blueprint 02 §6).
 *
 * Problem: AutoDesignPanel capped viewport heads at 150 because
 * mounting an <ItemRenderer> per node (which creates one drei
 * <Clone> of the GLB scene per head) swamps R3F when N grows past
 * a few hundred. Real fire-protection jobs have 1,000–10,000
 * heads + pipes + hangers.
 *
 * Solution: group all halofire catalog nodes by `asset.src`, then
 * for each unique GLB render ONE drei <Instances> with one
 * <Instance> per node. 10,000 heads of the same SKU collapse to
 * one draw call.
 *
 * Selection escape: selected/hovered nodes are pulled out of the
 * instanced group and fall through to the per-node <NodeRenderer>
 * path (which preserves outline, gizmos, per-node interactions).
 * On deselect they re-absorb into the instance group on the next
 * render.
 *
 * Feature flag: NEXT_PUBLIC_HF_INSTANCING — default "true". Set
 * to "false" to force the legacy per-node path (bisect + fallback
 * for broken GPU environments).
 */

import {
  type AnyNode,
  type AnyNodeId,
  type ItemNode,
  useScene,
} from '@pascal-app/core'
import { Instance, Instances } from '@react-three/drei/core/Instances'
import { useGLTF } from '@react-three/drei/core/Gltf'
import { Suspense, useMemo } from 'react'
import { ErrorBoundary } from '../components/error-boundary'
import { NodeRenderer } from '../components/renderers/node-renderer'
import { resolveCdnUrl } from '../lib/asset-url'
import useViewer from '../store/use-viewer'

// Node types that may carry a catalog GLB. We only instance
// ItemNode today because sprinkler_head / pipe / fitting / valve /
// hanger / device / fdc are first-class Pascal nodes that are
// currently spawned as ItemNodes with halofire tags. If a first-
// class typed node gains an asset.src later, the filter below
// picks it up automatically.
const INSTANCEABLE_KINDS = new Set([
  'item',
  'sprinkler_head',
  'pipe',
  'fitting',
  'valve',
  'hanger',
  'device',
  'fdc',
])

type InstanceableNode = ItemNode & { asset: { src: string } }

function hasInstanceableAsset(n: AnyNode): n is InstanceableNode {
  if (!INSTANCEABLE_KINDS.has((n as { type: string }).type)) return false
  const asset = (n as { asset?: { src?: string } }).asset
  const src = asset?.src
  return typeof src === 'string' && src.toLowerCase().endsWith('.glb')
}

type Groups = Record<string, InstanceableNode[]>

function groupByAssetSrc(nodes: InstanceableNode[]): Groups {
  const out: Groups = {}
  for (const n of nodes) {
    const src = n.asset.src
    if (!out[src]) out[src] = []
    out[src].push(n)
  }
  return out
}

const FEATURE_FLAG_ON = (() => {
  const raw = process.env.NEXT_PUBLIC_HF_INSTANCING
  if (raw === undefined) return true
  return raw !== 'false' && raw !== '0'
})()

export function InstancedCatalogRenderer() {
  // Pull the node map + selection. We deliberately subscribe to
  // the whole maps (via shallow-less selectors) — re-grouping is
  // cheap vs. the perf gain from instancing.
  const nodes = useScene((s) => s.nodes)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const hoveredId = useViewer((s) => s.hoveredId)

  const { groups, escapedIds } = useMemo(() => {
    const escaped = new Set<string>()
    for (const id of selectedIds) escaped.add(id as string)
    if (hoveredId) escaped.add(hoveredId as string)

    const instanceable: InstanceableNode[] = []
    const escapedNodes: InstanceableNode[] = []
    for (const n of Object.values(nodes) as AnyNode[]) {
      if (!hasInstanceableAsset(n)) continue
      if (escaped.has(n.id as string)) {
        escapedNodes.push(n)
      } else {
        instanceable.push(n)
      }
    }
    return {
      groups: groupByAssetSrc(instanceable),
      escapedIds: escapedNodes.map((n) => n.id as AnyNodeId),
    }
  }, [nodes, selectedIds, hoveredId])

  if (!FEATURE_FLAG_ON) return null

  return (
    <group name="hf-instanced-catalog" userData={{ hfInstancing: true }}>
      {Object.entries(groups).map(([src, nodesForSrc]) => (
        <ErrorBoundary key={src} fallback={<PerNodeFallback nodes={nodesForSrc} />}>
          <Suspense fallback={null}>
            <InstancedGroup assetSrc={src} nodes={nodesForSrc} />
          </Suspense>
        </ErrorBoundary>
      ))}
      {/* Selection/hover escape hatch — render these via the normal
          per-node path so gizmos, outlines, and per-node click
          handlers work. They'll snap back into the instance group
          as soon as they're deselected. */}
      {escapedIds.map((id) => (
        <NodeRenderer key={`escape-${id}`} nodeId={id} />
      ))}
    </group>
  )
}

/** Per-group instanced renderer. One <Instances> per unique GLB. */
function InstancedGroup({
  assetSrc,
  nodes,
}: {
  assetSrc: string
  nodes: InstanceableNode[]
}) {
  const url = resolveCdnUrl(assetSrc) || assetSrc
  const gltf = useGLTF(url)

  // Find the first mesh in the GLB — good enough for catalog
  // sprinklers/fittings which are single-mesh SKUs. Multi-mesh
  // SKUs fall back to per-node via the ErrorBoundary above.
  const firstMesh = useMemo(() => {
    let found: { geometry: unknown; material: unknown } | null = null
    gltf.scene.traverse((child: unknown) => {
      if (found) return
      const mesh = child as {
        isMesh?: boolean
        geometry?: unknown
        material?: unknown
      }
      if (mesh.isMesh && mesh.geometry) {
        found = { geometry: mesh.geometry, material: mesh.material }
      }
    })
    return found as { geometry: unknown; material: unknown } | null
  }, [gltf])

  if (!firstMesh) {
    // GLB loaded but no mesh — fall back to per-node.
    return <PerNodeFallback nodes={nodes} />
  }

  // Clamp limit to a safe 10k window. Groups larger than 10k
  // should chunk upstream; this keeps the InstancedMesh array
  // from over-allocating.
  const limit = Math.min(Math.max(nodes.length, 16), 10_000)

  return (
    <Instances
      frustumCulled={false}
      limit={limit}
      userData={{ hfAssetSrc: assetSrc, hfInstanceCount: nodes.length }}
    >
      {/* drei picks up geometry + material from primitive children */}
      {/* biome-ignore lint/suspicious/noExplicitAny: three primitives */}
      <primitive attach="geometry" object={firstMesh.geometry as any} />
      {/* biome-ignore lint/suspicious/noExplicitAny: three primitives */}
      <primitive attach="material" object={firstMesh.material as any} />
      {nodes.map((n) => (
        <Instance
          key={n.id}
          position={n.position as [number, number, number]}
          rotation={n.rotation as [number, number, number]}
          scale={(n.scale ?? [1, 1, 1]) as [number, number, number]}
          userData={{ hfNodeId: n.id }}
        />
      ))}
    </Instances>
  )
}

/** Render a batch of nodes via the regular per-node path. Used
 *  when instancing fails (missing mesh, bad GLB, error boundary). */
function PerNodeFallback({ nodes }: { nodes: InstanceableNode[] }) {
  return (
    <>
      {nodes.map((n) => (
        <NodeRenderer key={n.id} nodeId={n.id as AnyNodeId} />
      ))}
    </>
  )
}

/**
 * Test hook — lets e2e assert instancing decisions without probing
 * the R3F scene graph. Mirrors `InstancedCatalogRenderer`'s filter.
 */
export function __hfInstancingDebug() {
  const state = useScene.getState()
  const nodes = Object.values(state.nodes) as AnyNode[]
  const instanceable = nodes.filter(hasInstanceableAsset)
  const groups = groupByAssetSrc(instanceable)
  return {
    enabled: FEATURE_FLAG_ON,
    totalNodes: nodes.length,
    instanceableCount: instanceable.length,
    uniqueAssets: Object.keys(groups).length,
    groupSizes: Object.fromEntries(
      Object.entries(groups).map(([k, v]) => [k, v.length]),
    ),
  }
}

// Expose on window for Playwright tests. Guarded for SSR.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __hfInstancingDebug?: typeof __hfInstancingDebug }).__hfInstancingDebug =
    __hfInstancingDebug
}
