/**
 * Catalog consumer helpers — load `catalog.json` in either a browser
 * (Next.js / Tauri webview) or Node (tests, scripts) context, plus a
 * handful of in-memory lookup + summary utilities.
 *
 * Blueprint reference: docs/blueprints/03_CATALOG_ENGINE.md §6.
 */

import type { Part } from './part.js'

/**
 * The envelope shape emitted by `scripts/build-catalog.ts`. Kept
 * intentionally loose on `parts` so downstream consumers that only
 * need `{sku, kind, category, display_name, manufacturer, price_usd}`
 * don't have to pull in the full SCAD-strict Part type.
 */
export interface Catalog {
  schema_version: number
  catalog_version: string
  generated_at: string
  parts: CatalogPart[]
}

/**
 * Runtime Part as emitted by `catalog.json`. This is a superset of the
 * SCAD-authored `Part` type — we allow snake_case fields because that
 * is the JSON-on-disk convention, and we keep everything optional so
 * the schema can grow without breaking consumers.
 */
export interface CatalogPart {
  sku: string
  kind: string
  category: string
  display_name: string
  manufacturer?: string
  mfg_part_number?: string
  price_usd?: number
  install_minutes?: number
  k_factor?: number
  orientation?: string
  response?: string
  temperature?: string
  listing?: string
  tags?: string[]
  warnings?: string[]
  // Allow additional build-pipeline fields (params, ports, etc.) without
  // forcing consumers to type them.
  [key: string]: unknown
}

export interface LoadCatalogOptions {
  /** Override the HTTP fetcher — used in tests. */
  fetchImpl?: typeof fetch
  /** Override the public URL where catalog.json is served. */
  url?: string
}

const DEFAULT_URL = '/halofire-catalog/catalog.json'

/**
 * Load the catalog.json bundled with `@halofire/catalog`.
 *
 * - In a browser / Tauri webview, fetches `/halofire-catalog/catalog.json`
 *   (copy the file into `apps/editor/public/halofire-catalog/` as part
 *   of the app's build step — see `scripts/copy-catalog-json.mjs`).
 * - In Node, resolves the monorepo path to
 *   `packages/halofire-catalog/catalog.json` and reads it via `node:fs`.
 * - A custom `fetchImpl` always takes precedence (test injection).
 */
export async function loadCatalog(
  opts: LoadCatalogOptions = {},
): Promise<Catalog> {
  const url = opts.url ?? DEFAULT_URL

  // Explicit fetch injection — always honored first.
  if (opts.fetchImpl) {
    const res = await opts.fetchImpl(url)
    if (!res.ok) {
      throw new Error(`loadCatalog: fetch ${url} failed: ${res.status}`)
    }
    return (await res.json()) as Catalog
  }

  // Browser / webview path.
  const hasWindow = typeof globalThis !== 'undefined' &&
    typeof (globalThis as { window?: unknown }).window !== 'undefined'
  if (hasWindow && typeof fetch === 'function') {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`loadCatalog: fetch ${url} failed: ${res.status}`)
    }
    return (await res.json()) as Catalog
  }

  // Node fallback — resolve via the workspace layout.
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const { dirname, resolve } = await import('node:path')
  const here = dirname(fileURLToPath(import.meta.url))
  // dist layout: packages/hf-core/dist/catalog/load.js
  // src layout:  packages/hf-core/src/catalog/load.ts
  // Both are 4 levels up from the workspace root's packages/halofire-catalog/.
  const candidates = [
    resolve(here, '../../../halofire-catalog/catalog.json'),
    resolve(here, '../../../../packages/halofire-catalog/catalog.json'),
  ]
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, 'utf8')
      return JSON.parse(raw) as Catalog
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    `loadCatalog: unable to locate catalog.json (tried ${candidates.join(', ')})`,
  )
}

/** Find a single part by SKU. */
export function findBySku(
  catalog: Catalog,
  sku: string,
): CatalogPart | undefined {
  return catalog.parts.find((p) => p.sku === sku)
}

/** Return every part in the given dotted category (exact match). */
export function findByCategory(
  catalog: Catalog,
  category: string,
): CatalogPart[] {
  return catalog.parts.filter((p) => p.category === category)
}

/** Return every part of the given kind. */
export function findByKind(catalog: Catalog, kind: string): CatalogPart[] {
  return catalog.parts.filter((p) => p.kind === kind)
}

/** Summary counters for display / sanity checks. */
export function catalogStats(catalog: Catalog): {
  total: number
  byKind: Record<string, number>
  byCategory: Record<string, number>
  byManufacturer: Record<string, number>
} {
  const byKind: Record<string, number> = {}
  const byCategory: Record<string, number> = {}
  const byManufacturer: Record<string, number> = {}
  for (const p of catalog.parts) {
    byKind[p.kind] = (byKind[p.kind] ?? 0) + 1
    byCategory[p.category] = (byCategory[p.category] ?? 0) + 1
    const mfg = p.manufacturer ?? 'unknown'
    byManufacturer[mfg] = (byManufacturer[mfg] ?? 0) + 1
  }
  return {
    total: catalog.parts.length,
    byKind,
    byCategory,
    byManufacturer,
  }
}

// Re-export Part for convenience.
export type { Part }
