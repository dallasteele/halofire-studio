/**
 * Catalog consumer helpers — load `catalog.json` in either a browser
 * (Next.js / Tauri webview) or Node (tests, scripts) context, plus a
 * handful of in-memory lookup + summary utilities.
 *
 * Blueprint reference: docs/blueprints/03_CATALOG_ENGINE.md §6.
 *
 * Schema: see `@halofire/catalog` (`CatalogEntry`, `CatalogManifest`,
 * `parseCatalog`). That package is the single source of truth for the
 * shape of `catalog.json`; everything here validates + re-exports it.
 */

import {
  type CatalogEntry,
  type CatalogManifest,
  parseCatalog,
} from '@halofire/catalog'
import type { Part } from './part.js'

/**
 * The envelope shape emitted by `scripts/build-catalog.ts`.
 *
 * Alias of `CatalogManifest` from `@halofire/catalog`. Kept as a
 * separate name so existing consumers that import `Catalog` from this
 * module don't have to change — but new code should prefer the
 * canonical name.
 */
export type Catalog = CatalogManifest

/**
 * Runtime Part as emitted by `catalog.json`.
 *
 * Alias of `CatalogEntry` from `@halofire/catalog`. See that type for
 * the authoritative field list; do NOT add fields here without adding
 * them to the canonical schema first.
 */
export type CatalogPart = CatalogEntry

export interface LoadCatalogOptions {
  /** Override the HTTP fetcher — used in tests. */
  fetchImpl?: typeof fetch
  /** Override the public URL where catalog.json is served. */
  url?: string
  /**
   * Skip Zod validation. Default `false` — you almost never want this.
   * The one legitimate case is a test that deliberately feeds a partial
   * fixture; production consumers must leave validation on.
   */
  skipValidation?: boolean
}

const DEFAULT_URL = '/halofire-catalog/catalog.json'

function validate(raw: unknown, skip: boolean | undefined): Catalog {
  if (skip) return raw as Catalog
  try {
    return parseCatalog(raw)
  } catch (e) {
    // Surface the schema violation with enough detail that the build /
    // CI log actually tells the dev what drifted.
    throw new Error(
      `loadCatalog: catalog.json failed schema validation: ${
        e instanceof Error ? e.message : String(e)
      }`,
    )
  }
}

/**
 * Load the catalog.json bundled with `@halofire/catalog`.
 *
 * - In a browser / Tauri webview, fetches `/halofire-catalog/catalog.json`
 *   (copy the file into `apps/editor/public/halofire-catalog/` as part
 *   of the app's build step — see `scripts/copy-catalog-json.mjs`).
 * - In Node, resolves the monorepo path to
 *   `packages/halofire-catalog/catalog.json` and reads it via `node:fs`.
 * - A custom `fetchImpl` always takes precedence (test injection).
 *
 * The loaded JSON is validated against the canonical Zod schema from
 * `@halofire/catalog` before being returned — if the on-disk shape
 * drifts from the TS types, this throws immediately instead of
 * silently handing back garbage.
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
    return validate(await res.json(), opts.skipValidation)
  }

  // Browser / webview path.
  const hasWindow = typeof globalThis !== 'undefined' &&
    typeof (globalThis as { window?: unknown }).window !== 'undefined'
  if (hasWindow && typeof fetch === 'function') {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`loadCatalog: fetch ${url} failed: ${res.status}`)
    }
    return validate(await res.json(), opts.skipValidation)
  }

  // Node fallback — delegated to a side module so Turbopack / Next.js NFT
  // tracing only sees `fetch` in the primary module's import graph. This
  // branch only runs under Node (tests/scripts); browser/Tauri webview
  // always takes the `fetch` path above.
  const { loadCatalogFromFs } = (await import(
    /* turbopackIgnore: true */ './load-node.js'
  )) as typeof import('./load-node.js')
  return validate(await loadCatalogFromFs(), opts.skipValidation)
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
