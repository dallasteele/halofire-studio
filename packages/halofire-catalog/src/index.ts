/**
 * @halofire/catalog — fire-sprinkler component catalog.
 *
 * Each component has:
 *   - GLB mesh (under assets/glb/) for 3D rendering
 *   - Structured metadata (NFPA params, manufacturer, dimensions)
 *   - A "mounting class" (floor / ceiling / wall / pipe-inline) that
 *     dictates how Halofire's placer tool attaches it to a node
 *
 * Manufacturer catalogs (Victaulic, Tyco, Reliable, Viking, Gem, Globe)
 * have license restrictions on redistribution. So we load their BIM
 * ON DEMAND (during a bid that uses that SKU), not bundled upfront.
 * This package ships only the open-authored meshes we generate via
 * Blender MCP.
 */

export type { ComponentCategory, MountingClass, CatalogEntry } from './types.js'
export { CATALOG } from './manifest.js'
export {
  findByCategory,
  findByName,
  findBySku,
  findHeadsByKFactor,
  findPipesBySize,
} from './query.js'
export {
  PIPE_COLOR_BY_SIZE_IN,
  pipeColorFor,
  pipeLineweightFor,
  pipeLayerName,
  FP_LAYER_NAMES,
} from './colors.js'
export type { MaterialSpec, MaterialKey } from './material.js'
export { MATERIAL_PRESETS, materialFor } from './material.js'
export type {
  Connector,
  ConnectionType,
  ConnectorRole,
} from './connectors.js'
export { connectorsFor, canMate } from './connectors.js'
