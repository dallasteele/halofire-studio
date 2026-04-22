/**
 * @halofire/catalog — fire-sprinkler component catalog.
 *
 * TWO parallel paths live here:
 *
 * 1. **Canonical (NEW, use this for anything new)** — the catalog is
 *    generated from `authoring/scad/*.scad` into `catalog.json` by
 *    `scripts/build-catalog.ts`. The on-disk JSON is the source of
 *    truth. `CatalogEntry` / `CatalogManifest` below mirror its shape
 *    and `parseCatalog` validates it at runtime.
 *
 * 2. **Legacy (DO NOT EXTEND)** — a hard-coded `CATALOG` array + derived
 *    `materialFor`, `connectorsFor`, `findBySku`, etc. helpers that
 *    consume `LegacyCatalogEntry` (with `dims_cm`, `mounting`,
 *    `glb_path`, `connection`, `finish`). Retained so the editor's
 *    `CatalogPanel`, `SceneBootstrap`, and `FireProtectionPanel` keep
 *    working until they migrate to the JSON path.
 *
 * Manufacturer catalogs (Victaulic, Tyco, Reliable, Viking, Gem, Globe)
 * have license restrictions on redistribution. Their BIM is loaded ON
 * DEMAND — this package ships only the open-authored SCAD/GLB pair.
 */

// ── Canonical (JSON-backed) schema ──────────────────────────────────────
export type {
  CatalogEntry,
  CatalogManifest,
  CatalogParam,
  CatalogParamType,
  CatalogPort,
  CatalogPortRole,
  CatalogPortStyle,
  PartKind,
} from './types.js'

export {
  CatalogEntrySchema,
  CatalogManifestSchema,
  CatalogParamSchema,
  CatalogParamTypeSchema,
  CatalogPortRoleSchema,
  CatalogPortSchema,
  CatalogPortStyleSchema,
  PartKindSchema,
  parseCatalog,
  safeParseCatalog,
} from './schema.js'

// ── Legacy in-memory CATALOG + helpers (do not extend) ─────────────────
export type {
  LegacyCatalogEntry,
  LegacyComponentCategory,
  LegacyMountingClass,
  // Back-compat aliases (same as Legacy*). Prefer the Legacy-prefixed
  // names in new code so the deprecation is visible at the import site.
  ComponentCategory,
  MountingClass,
} from './types.js'
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
