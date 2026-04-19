/**
 * IFC import entry point (M1 week 1 wire-up).
 *
 * Uses @thatopen/components IfcLoader: initialize a headless components
 * world, configure web-ifc WASM path, load the user's IFC bytes, walk
 * the spatial tree, and emit Pascal nodes.
 *
 * This module runs in the browser (Next.js app). The components library
 * handles the web-ifc WASM worker itself, but we must tell it where to
 * find the .wasm file — normally `/web-ifc.wasm` served from public/.
 *
 * Implementation status: wired against @thatopen/components@^2.4.
 * Untested with real IFC files until the Halofire Studio app exposes an
 * upload UI in M1 week 3. Function signature is stable.
 */

import * as OBC from '@thatopen/components'
import type { IfcImportOptions, IfcImportResult } from './types.js'
import { mapIfcToNodeTree } from './mapper.js'

export async function importIfcFile(
  options: IfcImportOptions,
): Promise<IfcImportResult> {
  const start =
    typeof performance !== 'undefined' ? performance.now() : Date.now()

  // 1. Initialize a world + loader
  const components = new OBC.Components()
  const ifcLoader = components.get(OBC.IfcLoader)

  // Tell web-ifc where the WASM worker lives. In a Next.js app the WASM
  // is served from public/. setup() accepts { autoSetWasm, wasm: {path, absolute} }.
  await ifcLoader.setup({
    autoSetWasm: false,
    wasm: { path: '/', absolute: true },
  })

  // 2. Parse IFC bytes into a @thatopen/fragments model
  const model = await ifcLoader.load(new Uint8Array(options.file))

  // 3. Walk the hierarchy + create Pascal nodes
  const mapping = await mapIfcToNodeTree(model, options)

  return {
    entitiesProcessed: mapping.entitiesProcessed ?? 0,
    nodesCreated: mapping.nodesCreated,
    skippedEntities: mapping.skippedEntities ?? [],
    warnings: mapping.warnings ?? [],
    rootNodeIds: mapping.rootNodeIds,
    durationMs:
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start,
  }
}
