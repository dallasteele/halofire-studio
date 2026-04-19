/**
 * Pascal scene → halopenclaw serialized scene.
 *
 * Pascal's internal node tree lives in a Zustand store with its own
 * shape. This function walks it and produces the flattened `{nodes: [
 * {id, type, folder, bbox_world, metadata}]}` format the gateway expects.
 *
 * The Pascal scene shape is loosely typed here (`unknown`) because
 * @pascal-app/core's exact store surface evolves. Callers pass in their
 * store selector's output; the serializer iterates children recursively.
 *
 * Implementation status: scaffold. Real walk lands once the studio's
 * sidebar panels replace their hardcoded demo scenes with real store
 * snapshots (M1 week 4-ish, alongside the head placer).
 */

import type { SerializedNode, SerializedScene } from './types.js'

/**
 * Minimal shape we require from a Pascal node to emit gateway JSON.
 * The real Pascal types (@pascal-app/core) have more fields; the
 * serializer only reads what it needs.
 */
export interface PascalSceneNode {
  id: string
  type: string
  children?: PascalSceneNode[]
  /** World-space bounding box if already computed; optional for non-geometric nodes */
  bboxWorld?: {
    min: [number, number, number]
    max: [number, number, number]
  }
  /** Editor folder path for organization */
  folder?: string
  /** Free-form metadata: label, guid, hazard class, manufacturer, … */
  metadata?: Record<string, unknown>
}

export function serializePascalScene(
  roots: readonly PascalSceneNode[],
  opts: { units?: 'cm' | 'm'; project?: Record<string, unknown> } = {},
): SerializedScene {
  const flat: SerializedNode[] = []
  for (const root of roots) {
    walk(root, flat)
  }
  return {
    nodes: flat,
    units: opts.units ?? 'cm',
    ...(opts.project ? { project: opts.project } : {}),
  }
}

function walk(node: PascalSceneNode, out: SerializedNode[]): void {
  if (node.bboxWorld) {
    out.push({
      id: node.id,
      type: node.type,
      folder: node.folder,
      bbox_world: node.bboxWorld,
      metadata: node.metadata,
    })
  }
  if (node.children) {
    for (const c of node.children) walk(c, out)
  }
}
