/**
 * HaloFire catalog consumer smoke — covers `@halofire/core` loadCatalog
 * helpers (Node context) and the new `CatalogPanel` parts browser
 * section (Playwright against the live Next dev/start server).
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

import {
  catalogStats,
  findBySku,
  loadCatalog,
} from '@halofire/core/catalog/load'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Monorepo root: apps/editor/e2e/../../../
const CATALOG_JSON = resolve(
  __dirname,
  '../../../packages/halofire-catalog/catalog.json',
)

test.describe('@halofire/core — loadCatalog (Node)', () => {
  test('loadCatalog returns 28+ parts', async () => {
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(CATALOG_JSON, 'utf8')
    const catalog = await loadCatalog({
      // Inject a fetch that ignores the URL and returns our disk copy.
      fetchImpl: (async () =>
        new Response(raw, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    })
    expect(catalog.parts.length).toBeGreaterThanOrEqual(28)
    expect(catalog.schema_version).toBe(1)
    expect(typeof catalog.catalog_version).toBe('string')
  })

  test('findBySku(cap_end) returns the grooved end cap', async () => {
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(CATALOG_JSON, 'utf8')
    const catalog = await loadCatalog({
      fetchImpl: (async () =>
        new Response(raw, { status: 200 })) as unknown as typeof fetch,
    })
    const part = findBySku(catalog, 'cap_end')
    expect(part).toBeDefined()
    expect(part?.kind).toBe('fitting')
    expect(part?.category).toBe('fitting.cap')
  })

  test('catalogStats().byKind.fitting >= 8', async () => {
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(CATALOG_JSON, 'utf8')
    const catalog = await loadCatalog({
      fetchImpl: (async () =>
        new Response(raw, { status: 200 })) as unknown as typeof fetch,
    })
    const stats = catalogStats(catalog)
    expect(stats.total).toBe(catalog.parts.length)
    expect(stats.byKind.fitting ?? 0).toBeGreaterThanOrEqual(8)
  })
})

test.describe('CatalogPanel — @halofire/core browser UI', () => {
  test('renders a search box + kind-filter pills', async ({ page }) => {
    await page.goto('/')
    // The Catalog panel lives behind a sidebar tab. Click it if the
    // browser isn't already visible.
    const browser = page.locator('[data-testid="hf-catalog-browser"]')
    if (!(await browser.isVisible().catch(() => false))) {
      const tab = page.getByRole('button', { name: 'Catalog', exact: true }).first()
      if (await tab.count()) await tab.click()
    }
    await expect(browser).toBeVisible({ timeout: 15_000 })
    await expect(
      page.locator('[data-testid="hf-catalog-search"]'),
    ).toBeVisible()
    await expect(page.locator('[data-testid="hf-catalog-kind-pills"]')).toBeVisible()
    // Kind pills: All + at least Fittings.
    await expect(page.locator('[data-testid="hf-kind-pill-all"]')).toBeVisible()
    await expect(page.locator('[data-testid="hf-kind-pill-fitting"]')).toBeVisible()
  })
})
