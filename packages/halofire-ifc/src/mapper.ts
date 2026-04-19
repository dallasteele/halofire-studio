/**
 * IFC → Pascal node-tree mapper.
 *
 * IFC hierarchy:   IfcSite → IfcBuilding → IfcBuildingStorey → IfcWall/IfcSlab/IfcSpace/IfcDoor/IfcWindow
 * Pascal hierarchy: Site    → Building   → Level              → Wall  / Slab  / Zone  / (item w/ CSG cutout)
 *
 * The mapping is almost 1:1, which is a happy accident — Pascal was built
 * with IFC in mind. The only things we handle specially:
 *
 * - IfcDoor + IfcWindow → NOT separate Pascal nodes; they become CSG cutouts
 *   on their parent wall, using Pascal's existing three-bvh-csg boolean pipeline
 * - IfcSpace → Pascal Zone with metadata for hazard class derivation later
 * - IfcColumn / IfcBeam → structure nodes (new Halofire type — added under
 *   a Building's "structure" group rather than in the level nodes)
 */

import type { IfcImportOptions } from './types.js'

export interface MappingResult {
  nodesCreated: number
  rootNodeIds: string[]
  guidToNodeId: Map<string, string>
  /** Count of IFC entities visited during the walk */
  entitiesProcessed?: number
  /** Entities that couldn't be mapped */
  skippedEntities?: { ifcType: string; guid: string; reason: string }[]
  /** Human-readable warnings */
  warnings?: string[]
}

export async function mapIfcToNodeTree(
  // @thatopen/components model type; typed as unknown for scaffold stage
  _model: unknown,
  _options: IfcImportOptions,
): Promise<MappingResult> {
  // TODO M1 week 1: walk IFC spatial tree, emit Pascal nodes.
  //
  // Rough shape:
  //   const sites = model.getSpatialTree()
  //   for (const site of sites) {
  //     const siteNode = createPascalNode('site', { name: site.GlobalId })
  //     for (const building of site.children) {
  //       const buildingNode = createPascalNode('building', {
  //         name: building.Name, parent: siteNode.id
  //       })
  //       for (const storey of building.children) {
  //         const levelNode = createPascalNode('level', {
  //           name: storey.Name, elevation: storey.Elevation,
  //           parent: buildingNode.id
  //         })
  //         for (const wall of storey.walls) { ... }
  //         for (const slab of storey.slabs) { ... }
  //         for (const space of storey.spaces) { ... }
  //       }
  //     }
  //   }
  return {
    nodesCreated: 0,
    rootNodeIds: [],
    guidToNodeId: new Map(),
    entitiesProcessed: 0,
    skippedEntities: [],
    warnings: [
      'mapIfcToNodeTree: walk logic is a stub. M1 week 3 wires the real spatial-tree walk with @thatopen/components IfcRelationsIndexer once the Halofire Studio app has a PDF/IFC upload UI for end-to-end testing.',
    ],
  }
}

/**
 * NFPA 13 hazard-class inference from IFC space name/type.
 * Run during or after mapping to tag spaces with their default hazard.
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
