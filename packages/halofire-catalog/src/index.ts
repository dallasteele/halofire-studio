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
export { findByCategory, findByName, findBySku } from './query.js'
