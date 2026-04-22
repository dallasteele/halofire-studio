/**
 * Catalog query helpers.
 */

import { CATALOG } from './manifest.js'
import type { LegacyCatalogEntry, LegacyComponentCategory } from './types.js'

/** Return all entries in a given category. */
export function findByCategory(
  category: LegacyComponentCategory,
): readonly LegacyCatalogEntry[] {
  return CATALOG.filter((e) => e.category === category)
}

/** Case-insensitive name substring match. */
export function findByName(query: string): readonly LegacyCatalogEntry[] {
  const q = query.toLowerCase()
  return CATALOG.filter(
    (e) => e.name.toLowerCase().includes(q) || e.sku.toLowerCase().includes(q),
  )
}

/** Exact SKU lookup. Throws if not found. */
export function findBySku(sku: string): LegacyCatalogEntry {
  const entry = CATALOG.find((e) => e.sku === sku)
  if (!entry) throw new Error(`Unknown catalog SKU: ${sku}`)
  return entry
}

/** Convenience: all K-factor heads matching a NFPA requirement. */
export function findHeadsByKFactor(
  kFactor: number,
): readonly LegacyCatalogEntry[] {
  return CATALOG.filter(
    (e) => e.category.startsWith('sprinkler_head_') && e.k_factor === kFactor,
  )
}

/** All pipe SKUs for a given nominal diameter (inches). */
export function findPipesBySize(
  pipeSizeIn: number,
): readonly LegacyCatalogEntry[] {
  return CATALOG.filter(
    (e) => e.category.startsWith('pipe_') && e.pipe_size_in === pipeSizeIn,
  )
}
