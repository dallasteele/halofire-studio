/**
 * Node-only catalog loader. Split out from `load.ts` so Turbopack / Next.js
 * NFT tracing does not pull Node built-ins (`node:fs/promises`, `node:url`,
 * `node:path`) into the browser / Tauri-webview client bundle.
 *
 * This module is imported lazily from `load.ts` via a
 * `/* turbopackIgnore: true *\/` dynamic import, which keeps it off the
 * client-SSR trace graph entirely. It only executes in Node test / script
 * environments.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import type { Catalog } from './load.js'

/** Resolve the monorepo `catalog.json` from the `dist/` or `src/` layout. */
export async function loadCatalogFromFs(): Promise<Catalog> {
  const here = dirname(fileURLToPath(import.meta.url))
  // dist layout: packages/hf-core/dist/catalog/load-node.js
  // src layout:  packages/hf-core/src/catalog/load-node.ts
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
    `loadCatalogFromFs: unable to locate catalog.json (tried ${candidates.join(', ')})`,
  )
}
