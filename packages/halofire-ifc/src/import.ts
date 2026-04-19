/**
 * IFC import entry point — direct web-ifc (no @thatopen wrapper).
 *
 * web-ifc is the WebAssembly-compiled IFC parser maintained by
 * Tomas Lehtinen / ThatOpen Company. It powers @thatopen/components
 * underneath, but using it directly sidesteps the peer-dependency drama
 * between that-open's 2.x + 3.x lines and Pascal's three.js pinning.
 *
 * The real walk (M2 week 3 continuation) translates IFC spatial-tree
 * entities into Pascal node shapes. For this commit the scaffold
 * loads the file, enumerates IfcBuilding / IfcBuildingStorey /
 * IfcWall counts, and returns them in the warnings + summary so the
 * user sees concrete feedback that the file parsed.
 */

import type { IfcImportOptions, IfcImportResult } from './types.js'
import { mapIfcToNodeTree } from './mapper.js'

// IFC entity type IDs (from web-ifc's IfcTypes). Hardcoded to avoid the
// static import that would bundle the entire web-ifc constant map upfront.
const IFC_SITE = 4097
const IFC_BUILDING = 4098   // placeholder — web-ifc exposes IFCBUILDING via
                            // the instance; we'll look it up via GetLineIDsWithType.

export async function importIfcFile(
  options: IfcImportOptions,
): Promise<IfcImportResult> {
  const start =
    typeof performance !== 'undefined' ? performance.now() : Date.now()

  // Dynamic import to keep the 500+ KB WASM loader out of the initial
  // page bundle. Only loads when a user actually uploads an IFC.
  const webifc = await import('web-ifc')
  const { IfcAPI, IFCSITE, IFCBUILDING, IFCBUILDINGSTOREY, IFCWALL, IFCSLAB, IFCSPACE, IFCCOLUMN } = webifc

  const api = new IfcAPI()
  // WASM path: web-ifc.wasm needs to be served from /public. The default
  // `/` prefix works for Next.js apps.
  api.SetWasmPath('/', true)
  await api.Init()

  let modelID = -1
  const bytes = new Uint8Array(options.file)
  try {
    modelID = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true })
  } catch (e) {
    api.CloseModel?.(modelID)
    return {
      entitiesProcessed: 0,
      nodesCreated: 0,
      skippedEntities: [],
      warnings: [`web-ifc failed to open model: ${String(e)}`],
      rootNodeIds: [],
      durationMs:
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start,
    }
  }

  // Count entities by type (for the scaffold summary)
  const counts: Record<string, number> = {}
  const countType = (name: string, typeId: number) => {
    try {
      const ids = api.GetLineIDsWithType(modelID, typeId)
      const n = ids.size ? ids.size() : 0
      if (n > 0) counts[name] = n
    } catch {
      // ignore types that aren't in this schema version
    }
  }
  countType('IfcSite', IFCSITE)
  countType('IfcBuilding', IFCBUILDING)
  countType('IfcBuildingStorey', IFCBUILDINGSTOREY)
  countType('IfcWall', IFCWALL)
  countType('IfcSlab', IFCSLAB)
  countType('IfcSpace', IFCSPACE)
  countType('IfcColumn', IFCCOLUMN)

  const entitiesProcessed = Object.values(counts).reduce((a, b) => a + b, 0)

  // Run the mapper (still a scaffold — real walk emits Pascal nodes)
  const mapping = await mapIfcToNodeTree({ api, modelID, counts }, options)

  const entityLines = Object.entries(counts).map(
    ([name, n]) => `  - ${name}: ${n}`,
  )

  try {
    api.CloseModel(modelID)
  } catch {
    // best effort
  }

  const warnings = [
    `Parsed ${options.filename ?? 'file'} (${(options.file.byteLength / 1024).toFixed(1)} KB) via web-ifc`,
    `Entity inventory:`,
    ...entityLines,
    '',
    'Real spatial-tree walk → Pascal nodes pending.',
    'See packages/halofire-ifc/src/mapper.ts for the planned implementation.',
  ]

  return {
    entitiesProcessed,
    nodesCreated: mapping.nodesCreated,
    skippedEntities: mapping.skippedEntities ?? [],
    warnings,
    rootNodeIds: mapping.rootNodeIds,
    durationMs:
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start,
  }
}
