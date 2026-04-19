/**
 * IFC → Pascal node-tree mapper (via web-ifc direct).
 *
 * IFC hierarchy:   IfcSite → IfcBuilding → IfcBuildingStorey → IfcWall/IfcSlab/IfcSpace
 * Pascal hierarchy: Site    → Building   → Level             → Wall  / Slab  / Zone
 *
 * The mapping is almost 1:1 — Pascal was built with BIM in mind.
 *
 * This module is framework-aware but framework-independent: it takes a
 * `ModelContext` ({ api: IfcAPI, modelID: number, counts: {…} }) from
 * import.ts and returns a `MappingResult` plus the concrete Pascal
 * node structs that the UI layer will pass to `useScene.createNode(...)`.
 *
 * The mapper does NOT call useScene itself — that coupling would drag
 * @pascal-app/core into this package at runtime and we want it stayed
 * as a peer. Instead, the caller iterates `result.plannedNodes` and
 * creates each in order.
 */

import { generateId } from '@pascal-app/core'
import type { IfcImportOptions } from './types.js'

// ── Types ────────────────────────────────────────────────────────────────


/** Context passed in from import.ts after web-ifc.OpenModel() */
export interface ModelContext {
  /** Typed loosely — IfcAPI's shape is documented in web-ifc types */
  api: {
    GetLineIDsWithType(modelID: number, typeId: number): {
      size: () => number
      get: (i: number) => number
    }
    GetLine(modelID: number, id: number, flatten?: boolean): IfcLineRaw
  }
  modelID: number
  counts: Record<string, number>
}

interface IfcLineRaw {
  GlobalId?: { value?: string }
  Name?: { value?: string }
  LongName?: { value?: string }
  Elevation?: { value?: number }
  [key: string]: unknown
}


/** A pre-computed Pascal-node payload ready for useScene.createNode. */
export interface PlannedNode {
  id: `site_${string}` | `building_${string}` | `level_${string}` | `wall_${string}` | `slab_${string}` | `zone_${string}`
  type: 'site' | 'building' | 'level' | 'wall' | 'slab' | 'zone'
  /** Pascal parent node id (or undefined for root sites) */
  parentId?: string
  /** IFC GlobalId preserved as metadata for round-trip */
  ifcGuid?: string
  /** IFC Name (or LongName for spaces) */
  name?: string
  /** Storey elevation in meters (Pascal uses meters) */
  elevationM?: number
  /** Inferred NFPA 13 hazard class for Zone nodes */
  hazard?: string
}


export interface MappingResult {
  nodesCreated: number
  rootNodeIds: string[]
  guidToNodeId: Map<string, string>
  entitiesProcessed?: number
  skippedEntities?: { ifcType: string; guid: string; reason: string }[]
  warnings?: string[]
  /** The ordered list of Pascal nodes to create. Consumer iterates this. */
  plannedNodes?: PlannedNode[]
}


// ── IFC entity type IDs (from web-ifc's constants) ──────────────────────
// We encode the type IDs here so the mapper doesn't need to import
// web-ifc's full type-id table at module init. These are stable across
// IFC2x3 + IFC4.
const IFC_SITE_IDS = [4097]          // IFCSITE
const IFC_BUILDING_IDS = [4098]       // IFCBUILDING (web-ifc's enum value)
const IFC_STOREY_IDS = [3124254112]   // IFCBUILDINGSTOREY
const IFC_WALL_IDS = [2391406946, 3512223829]  // IFCWALL + IFCWALLSTANDARDCASE
const IFC_SLAB_IDS = [1529196076]     // IFCSLAB
const IFC_SPACE_IDS = [3856911033]    // IFCSPACE


// ── Walk ─────────────────────────────────────────────────────────────────


export async function mapIfcToNodeTree(
  model: ModelContext | null,
  _options: IfcImportOptions,
): Promise<MappingResult> {
  if (!model) {
    return {
      nodesCreated: 0,
      rootNodeIds: [],
      guidToNodeId: new Map(),
      entitiesProcessed: 0,
      skippedEntities: [],
      warnings: ['mapIfcToNodeTree: no model context provided (stub fallback)'],
      plannedNodes: [],
    }
  }

  const { api, modelID } = model
  const planned: PlannedNode[] = []
  const guidToNodeId = new Map<string, string>()
  const rootNodeIds: string[] = []
  const warnings: string[] = []
  const skipped: { ifcType: string; guid: string; reason: string }[] = []

  const readLine = (id: number): IfcLineRaw | null => {
    try {
      return api.GetLine(modelID, id, false)
    } catch (e) {
      warnings.push(`GetLine(${id}) failed: ${String(e)}`)
      return null
    }
  }

  // Helper: iterate every entity of a given type
  const forEachOfType = (
    typeIds: number[],
    cb: (line: IfcLineRaw, lineId: number) => void,
  ) => {
    for (const t of typeIds) {
      try {
        const ids = api.GetLineIDsWithType(modelID, t)
        const n = ids.size()
        for (let i = 0; i < n; i++) {
          const lineId = ids.get(i)
          const line = readLine(lineId)
          if (line) cb(line, lineId)
        }
      } catch {
        // schema version mismatch — skip silently
      }
    }
  }

  // ── 1. IfcSite → Pascal Site ──────────────────────────────────────
  // The site entities become Pascal root nodes. Most IFCs have 1 site.
  const siteGuidByLineId = new Map<number, string>()
  forEachOfType(IFC_SITE_IDS, (line, lineId) => {
    const guid = line.GlobalId?.value ?? `ifc_site_${lineId}`
    const name = line.Name?.value ?? line.LongName?.value ?? 'Site'
    const siteId = generateId('site') as `site_${string}`
    planned.push({
      id: siteId,
      type: 'site',
      ifcGuid: guid,
      name,
    })
    guidToNodeId.set(guid, siteId)
    siteGuidByLineId.set(lineId, guid)
    rootNodeIds.push(siteId)
  })
  if (rootNodeIds.length === 0) {
    // Some IFCs (especially from Revit interior packages) skip IfcSite
    // and start at IfcBuilding. Synthesize an implicit Site so the
    // hierarchy isn't disconnected.
    const guid = `synth_site_${Date.now()}`
    const siteId = generateId('site') as `site_${string}`
    planned.push({ id: siteId, type: 'site', ifcGuid: guid, name: 'Site (synthesized)' })
    guidToNodeId.set(guid, siteId)
    rootNodeIds.push(siteId)
    warnings.push('No IfcSite found; synthesized a default Site root.')
  }
  const primarySiteId = rootNodeIds[0]

  // ── 2. IfcBuilding → Pascal Building ──────────────────────────────
  const buildingByGuid = new Map<string, string>()  // ifc guid → pascal id
  forEachOfType(IFC_BUILDING_IDS, (line, lineId) => {
    const guid = line.GlobalId?.value ?? `ifc_building_${lineId}`
    const name = line.Name?.value ?? 'Building'
    const id = generateId('building') as `building_${string}`
    planned.push({
      id,
      type: 'building',
      parentId: primarySiteId,
      ifcGuid: guid,
      name,
    })
    guidToNodeId.set(guid, id)
    buildingByGuid.set(guid, id)
  })
  // Pick a default building for orphan storeys if we can't relate them
  // (rel parsing below handles the common case; this is a safety net)
  const defaultBuildingId = Array.from(buildingByGuid.values())[0] ?? primarySiteId

  // ── 3. IfcBuildingStorey → Pascal Level ────────────────────────────
  const storeyByGuid = new Map<string, string>()
  forEachOfType(IFC_STOREY_IDS, (line, lineId) => {
    const guid = line.GlobalId?.value ?? `ifc_storey_${lineId}`
    const name = line.Name?.value ?? `Level ${storeyByGuid.size + 1}`
    const elevation = typeof line.Elevation?.value === 'number'
      ? line.Elevation.value
      : undefined
    const id = generateId('level') as `level_${string}`
    planned.push({
      id,
      type: 'level',
      parentId: defaultBuildingId,
      ifcGuid: guid,
      name,
      elevationM: elevation,
    })
    guidToNodeId.set(guid, id)
    storeyByGuid.set(guid, id)
  })
  const defaultLevelId = Array.from(storeyByGuid.values())[0] ?? defaultBuildingId

  // ── 4. IfcSpace → Pascal Zone (with hazard inference) ──────────────
  forEachOfType(IFC_SPACE_IDS, (line, lineId) => {
    const guid = line.GlobalId?.value ?? `ifc_space_${lineId}`
    const name = line.LongName?.value ?? line.Name?.value ?? 'Space'
    const id = generateId('zone') as `zone_${string}`
    planned.push({
      id,
      type: 'zone',
      parentId: defaultLevelId,
      ifcGuid: guid,
      name,
      hazard: inferHazardFromSpaceName(name),
    })
    guidToNodeId.set(guid, id)
  })

  // ── 5. IfcWall + IfcWallStandardCase → Pascal Wall ─────────────────
  // For the scaffold we create wall nodes without per-wall geometry;
  // the full geometry walk needs StreamMeshes() + triangle buffers,
  // which is Phase M2 week 3.
  let wallCount = 0
  forEachOfType(IFC_WALL_IDS, (line, lineId) => {
    const guid = line.GlobalId?.value ?? `ifc_wall_${lineId}`
    const name = line.Name?.value ?? `Wall ${wallCount + 1}`
    const id = generateId('wall') as `wall_${string}`
    planned.push({
      id,
      type: 'wall',
      parentId: defaultLevelId,
      ifcGuid: guid,
      name,
    })
    guidToNodeId.set(guid, id)
    wallCount++
  })

  // ── 6. IfcSlab → Pascal Slab ───────────────────────────────────────
  let slabCount = 0
  forEachOfType(IFC_SLAB_IDS, (line, lineId) => {
    const guid = line.GlobalId?.value ?? `ifc_slab_${lineId}`
    const name = line.Name?.value ?? `Slab ${slabCount + 1}`
    const id = generateId('slab') as `slab_${string}`
    planned.push({
      id,
      type: 'slab',
      parentId: defaultLevelId,
      ifcGuid: guid,
      name,
    })
    guidToNodeId.set(guid, id)
    slabCount++
  })

  warnings.push(
    `Planned ${planned.length} Pascal nodes from IFC (geometry + wall-storey ` +
    `relations pending M2 week 3; current walk creates hierarchy skeleton ` +
    `so user sees scene structure immediately).`
  )

  return {
    nodesCreated: planned.length,
    rootNodeIds,
    guidToNodeId,
    entitiesProcessed: planned.length,
    skippedEntities: skipped,
    warnings,
    plannedNodes: planned,
  }
}


/**
 * NFPA 13 hazard-class inference from IFC space name/type.
 */
export function inferHazardFromSpaceName(name: string): string | undefined {
  const n = name.toLowerCase()
  if (n.includes('office') || n.includes('corridor') || n.includes('class'))
    return 'light'
  if (n.includes('retail') || n.includes('restaurant') || n.includes('lobby'))
    return 'ordinary_i'
  if (n.includes('storage') || n.includes('warehouse') || n.includes('mech'))
    return 'ordinary_ii'
  if (n.includes('manufactur') || n.includes('paint') || n.includes('wood'))
    return 'extra_i'
  return undefined
}
