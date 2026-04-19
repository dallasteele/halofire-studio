/**
 * IFC import entry point.
 *
 * Phase M1 implementation uses @thatopen/components IfcLoader to parse
 * the file, then passes the resulting model to the mapper for
 * translation into Pascal nodes.
 *
 * Stub for now — wire-up during M1 week 1 full implementation.
 */

import type { IfcImportOptions, IfcImportResult } from './types.js'
import { mapIfcToNodeTree } from './mapper.js'

export async function importIfcFile(
  options: IfcImportOptions,
): Promise<IfcImportResult> {
  const start = performance.now()

  // TODO M1 week 1:
  // 1. Initialize @thatopen/components world
  //    const components = new OBC.Components()
  //    const ifcLoader = components.get(OBC.IfcLoader)
  //    await ifcLoader.setup()
  //
  // 2. Parse IFC bytes
  //    const model = await ifcLoader.load(new Uint8Array(options.file))
  //
  // 3. Walk hierarchy + map to Pascal
  //    const mapping = mapIfcToNodeTree(model, options)
  //
  // 4. Return diagnostics

  const mapping = await mapIfcToNodeTree(null, options)

  return {
    entitiesProcessed: 0,
    nodesCreated: mapping.nodesCreated,
    skippedEntities: [],
    warnings: [
      'IFC import is a stub. Full implementation scheduled for M1 week 1.',
    ],
    rootNodeIds: mapping.rootNodeIds,
    durationMs: performance.now() - start,
  }
}
