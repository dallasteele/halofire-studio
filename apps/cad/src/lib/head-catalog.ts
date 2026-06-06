// HaloFire CAD — head SKU catalog access. SINGLE-SOURCE: re-uses the studio's
// authored manufacturer-catalog parser (apps/studio/src/lib/manufacturer-catalog)
// rather than reimplementing parsing — the K-factors and SKUs are the REAL ingested
// catalog values, never invented. This module adds only CAD-side convenience: a
// head-only filter and a SKU lookup.
//
// HONESTY: entries are catalog spec records from PUBLIC manufacturer data sheets.
// kFactor is a real extracted value (or null when the sheet did not yield one).
// The loader fail-softs to an empty catalog; no part is fabricated.

import {
  loadManufacturerCatalog,
  parseManufacturerCatalog,
  type CatalogPart,
  type ManufacturerCatalog,
} from '../../../studio/src/lib/manufacturer-catalog';

export {
  loadManufacturerCatalog,
  parseManufacturerCatalog,
  type CatalogPart,
  type ManufacturerCatalog,
};

/** True for a catalog part that is a sprinkler head with a usable K-factor. */
export function isHeadWithK(part: CatalogPart): boolean {
  return part.category === 'head' && typeof part.kFactor === 'number';
}

/**
 * The selectable head SKUs: real catalog heads that carry a K-factor, in catalog
 * order. These are what the LeftPanel offers for placement/auto-layout. Never
 * fabricates — returns [] when the catalog has no qualifying heads.
 */
export function headSkus(catalog: ManufacturerCatalog): CatalogPart[] {
  return catalog.entries.filter(isHeadWithK);
}

/** Find a head part by SKU id, or null. */
export function findHeadBySku(
  catalog: ManufacturerCatalog,
  sku: string | null | undefined,
): CatalogPart | null {
  if (!sku) return null;
  return catalog.entries.find((p) => p.id === sku) ?? null;
}
