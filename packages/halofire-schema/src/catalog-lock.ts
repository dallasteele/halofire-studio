/**
 * CatalogLock — `catalog-lock.json`. Pins the catalog snapshot used
 * by a bid so the BOM doesn't silently drift when the global
 * catalog is updated. See docs/blueprints/01_DATA_MODEL.md §2.6.
 */
import { z } from 'zod'

export const CatalogLockPart = z.object({
  sku: z.string(),
  part_hash: z.string(),
  unit_cost_usd: z.number(),
  price_source: z.string(),
})
export type CatalogLockPart = z.infer<typeof CatalogLockPart>

export const CatalogLock = z.object({
  schema_version: z.literal(1),
  catalog_version: z.string(),
  catalog_hash: z.string(),
  frozen_at: z.string(),
  parts: z.array(CatalogLockPart),
})

export type CatalogLock = z.infer<typeof CatalogLock>
