/**
 * Live Pascal scene → Halofire scene serializer.
 *
 * Pascal registers every rendered Object3D in `sceneRegistry` from
 * @pascal-app/core. We walk that registry to produce world-space
 * bounding boxes + type + metadata that the halopenclaw gateway's
 * validate tool understands.
 *
 * Units: Pascal's world is in METERS (Three.js convention). Halofire
 * gateway expects CENTIMETERS. This serializer multiplies by 100.
 *
 * Usage:
 *
 *    import { serializeLiveScene } from '@halofire/halopenclaw-client'
 *    const scene = serializeLiveScene({ useSceneRegistry: () => sceneRegistry })
 *    await client.validate('shell', scene)
 */

import type { SerializedNode, SerializedScene } from './types.js'

/**
 * Structural types we consider relevant to NFPA 13 validation + auditing.
 * Pascal has more types (scan, guide, fence, roof-segment, stair-segment)
 * that we skip for now — they're decorative or support geometry rather than
 * buildable architecture.
 */
const AUDITABLE_TYPES = new Set<string>([
  'site',
  'building',
  'level',
  'wall',
  'slab',
  'ceiling',
  'zone',
  'door',
  'window',
  'roof',
  'stair',
  'item',
])


/**
 * Interface matching Pascal's sceneRegistry shape, so callers can
 * pass it without this package taking a hard dep on @pascal-app/core.
 */
export interface SceneRegistryLike {
  nodes: Map<string, unknown>  // THREE.Object3D, but we don't import three
  byType: Record<string, Set<string>>
}


export interface SerializeLiveOptions {
  /** Supplier for the Pascal sceneRegistry. Injected so this package
   *  doesn't hard-depend on @pascal-app/core + three. */
  useSceneRegistry: () => SceneRegistryLike
  /** Subset of AUDITABLE_TYPES to include; default includes all. */
  includeTypes?: string[]
  /** Optional project-level metadata to stamp on the emitted scene */
  project?: Record<string, unknown>
}


export function serializeLiveScene(opts: SerializeLiveOptions): SerializedScene {
  const registry = opts.useSceneRegistry()
  const wanted = new Set(opts.includeTypes ?? Array.from(AUDITABLE_TYPES))
  const out: SerializedNode[] = []

  for (const [type, idSet] of Object.entries(registry.byType)) {
    if (!wanted.has(type)) continue
    for (const id of idSet) {
      const obj = registry.nodes.get(id)
      if (!obj) continue
      const bbox = computeWorldBBoxCm(obj)
      if (!bbox) continue
      out.push({
        id,
        type,
        bbox_world: bbox,
        // Metadata: label from Object3D.name if present
        metadata: pickMetadata(obj),
      })
    }
  }

  return {
    nodes: out,
    units: 'cm',
    ...(opts.project ? { project: opts.project } : {}),
  }
}


/**
 * Extract label + user-data metadata without importing three.
 *
 * `obj` is a THREE.Object3D at runtime; we access its standard
 * {name, userData} via bracket notation to keep the type loose.
 */
function pickMetadata(obj: unknown): Record<string, unknown> {
  const anyObj = obj as { name?: string; userData?: Record<string, unknown> }
  const meta: Record<string, unknown> = {}
  if (anyObj.name) meta.label = anyObj.name
  if (anyObj.userData) {
    // Carry through only safe JSON-serializable values
    for (const [k, v] of Object.entries(anyObj.userData)) {
      if (v === null) continue
      const t = typeof v
      if (t === 'string' || t === 'number' || t === 'boolean') {
        meta[k] = v
      }
    }
  }
  return meta
}


/**
 * Compute world-space AABB in centimeters for a Pascal Object3D.
 *
 * Uses THREE.Box3.setFromObject via bracket-accessor so we don't import
 * three at package level (keeps @halofire/halopenclaw-client tree-shakable
 * and three-version-agnostic).
 *
 * Returns null if the object has no renderable geometry.
 */
function computeWorldBBoxCm(obj: unknown):
  | { min: [number, number, number]; max: [number, number, number] }
  | null {
  // Duck-type lookup on the global THREE if available
  const three = (globalThis as { THREE?: unknown }).THREE as
    | { Box3?: new () => { setFromObject: (o: unknown) => { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number }; isEmpty: () => boolean } } }
    | undefined

  // Preferred path: runtime import of three
  // (We avoid a direct `import 'three'` at the module top because some
  // consumers bundle @halofire/halopenclaw-client without three.)
  let Box3Ctor: (new () => {
    setFromObject: (o: unknown) => { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number }; isEmpty: () => boolean }
  }) | undefined = three?.Box3

  if (!Box3Ctor) {
    // Dynamic require fallback only works in Node; browser bundlers may
    // tree-shake this. If three is not available, give up cleanly.
    return null
  }

  try {
    const box = new Box3Ctor().setFromObject(obj)
    if (box.isEmpty()) return null
    return {
      min: [box.min.x * 100, box.min.y * 100, box.min.z * 100],
      max: [box.max.x * 100, box.max.y * 100, box.max.z * 100],
    }
  } catch {
    return null
  }
}
