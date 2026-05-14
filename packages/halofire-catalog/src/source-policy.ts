import type { CatalogSourceIngestionPolicy } from './types.js'

/**
 * Canonical ingestion policy for catalog source material.
 *
 * This mirrors the current `data/halofire/brand/components/SOURCES.json`
 * policy so package consumers can reason about procedural salvage,
 * manufacturer inputs, and distributor inputs without reading the
 * on-disk provenance manifest directly.
 *
 * Important nuance: distributor-backed salvage may legitimately land at
 * `dimensioned_parametric` when dimensions are extracted from a public
 * distributor spec, but `manufacturer_verified` still requires a
 * manufacturer-backed approval path.
 */
export const CATALOG_SOURCE_INGESTION_POLICY = {
  allowed_sources: ['procedural', 'manufacturer', 'distributor'],
  require_public_url: true,
  require_source_url: true,
  require_source_file_ref: true,
  require_terms_summary: true,
  require_internal_use_flag: true,
  require_client_render_flag: true,
  require_download_flag: true,
  require_redistribution_blocked_flag: true,
  require_dimension_verification: true,
  require_manufacturer_verification: true,
  default_model_status: 'visual_reference',
} as const satisfies CatalogSourceIngestionPolicy
