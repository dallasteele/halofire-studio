/**
 * HaloFire Studio editor — UI smoke tests.
 *
 * Covers:
 *  - page renders without console errors
 *  - Ribbon renders with core buttons
 *  - LayerPanel renders with 7 layer toggles
 *  - Toggling a layer fires halofire:layer-visibility and the
 *    SceneChangeBridge re-fires halofire:scene-changed (Phase G)
 *  - StatusBar renders with project chrome
 *  - Pascal R3F canvas mounts
 */
import { expect, test } from '@playwright/test'

test.describe('editor smoke', () => {
  test('page loads and core widgets mount', async ({ page }) => {
    const consoleErrors: string[] = []
    const failed404: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('response', (res) => {
      if (res.status() === 404) failed404.push(res.url())
    })

    await page.goto('/')
    await expect(page).toHaveTitle(/Halofire Studio/i)

    await expect(page.getByTestId('halofire-ribbon')).toBeVisible()
    await expect(page.getByTestId('halofire-layer-panel')).toBeVisible()

    const layerToggles = [
      'heads', 'pipes', 'walls', 'zones',
      'hangers', 'obstructions', 'arch',
    ]
    for (const id of layerToggles) {
      await expect(
        page.getByTestId(`layer-toggle-${id}`),
      ).toBeVisible()
    }

    // Pascal viewer mounts at least one WebGL canvas (it creates
    // extras for ortho/iso preview tiles, so we only assert ≥ 1).
    const canvasCount = await page.locator('canvas').count()
    expect(canvasCount).toBeGreaterThanOrEqual(1)

    // Filter canvas-related console noise (WebGL in headless is
    // tolerated) plus 404s for the favicon and optional GLB assets
    // that are shared across projects and may not be present in
    // every dev profile. Asset 404s are logged for visibility but
    // don't fail the smoke.
    const realErrors = consoleErrors.filter(
      (e) =>
        !/WebGL|THREE|webgl|Failed to load resource/i.test(e),
    )
    if (failed404.length > 0) {
      console.log('  (non-fatal 404s):', failed404.join(', '))
    }
    expect(realErrors, realErrors.join('\n')).toEqual([])
  })

  test('layer toggle fires scene-change bridge (Phase G)', async ({ page }) => {
    await page.goto('/')

    const bridgeFired = await page.evaluate(async () => {
      const events: Array<{ type: string; origin?: string }> = []
      const handler = (e: Event) => {
        events.push({
          type: e.type,
          origin: (e as CustomEvent).detail?.origin,
        })
      }
      window.addEventListener('halofire:layer-visibility', handler)
      window.addEventListener('halofire:scene-changed', handler)

      const btn = document.querySelector(
        '[data-testid=layer-toggle-pipes]',
      ) as HTMLButtonElement | null
      btn?.click()

      await new Promise((r) => setTimeout(r, 200))

      window.removeEventListener('halofire:layer-visibility', handler)
      window.removeEventListener('halofire:scene-changed', handler)
      return events
    })

    // One click should fire both events; SceneChangeBridge relays to
    // scene-changed with origin="layer-visibility".
    const kinds = bridgeFired.map((e) => e.type)
    expect(kinds).toContain('halofire:layer-visibility')
    expect(kinds).toContain('halofire:scene-changed')
    const sceneChange = bridgeFired.find(
      (e) => e.type === 'halofire:scene-changed',
    )
    expect(sceneChange?.origin).toBe('layer-visibility')
  })

  test('ribbon tabs switch tab content', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('ribbon-tab-analyze').click()
    await expect(
      page.getByTestId('ribbon-btn-calculate'),
    ).toBeVisible()
    await page.getByTestId('ribbon-tab-report').click()
    await expect(
      page.getByTestId('ribbon-btn-proposal'),
    ).toBeVisible()
  })

  test('status bar shows project chrome', async ({ page }) => {
    await page.goto('/')
    const body = await page.locator('body').innerText()
    expect(body).toMatch(/1881|Cooperative|Halo/i)
  })
})
