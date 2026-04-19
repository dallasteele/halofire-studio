/**
 * @halofire/ifc — IFC → Pascal node-tree import
 *
 * Uses @thatopen/components (open-source web BIM toolkit, MIT, successor
 * to IFC.js). Reads IFC 2x3 / IFC4 files in the browser, walks the
 * hierarchy, and maps IFC entities to Pascal's Sites/Buildings/Levels/
 * Walls/Slabs/Zones/Items node types.
 *
 * Phase M1 week 1 scope: get a sample IFC parsed + walls visible in the
 * viewport. Door/window CSG cutouts follow in week 2.
 */

export type { IfcImportOptions, IfcImportResult } from './types.js'
export { importIfcFile } from './import.js'
export { mapIfcToNodeTree } from './mapper.js'
