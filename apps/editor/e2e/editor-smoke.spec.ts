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
    // SceneChangeBridge forwards the layer-visibility mutation event
    // as a scene-changed event with origin='layer-visibility'. Use
    // .some() rather than "first event" because HalofireNodeWatcher
    // may also fire independent scene-changed events for node
    // mutations that happen as SceneBootstrap spawns chrome.
    const layerVisChange = bridgeFired.some(
      (e) =>
        e.type === 'halofire:scene-changed' &&
        e.origin === 'layer-visibility',
    )
    expect(layerVisChange).toBe(true)
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

  test('HalofireNodeWatcher observes real scene mutations', async ({ page }) => {
    await page.goto('/')
    // Wait for the dev hook that HalofireNodeWatcher exposes.
    await page.waitForFunction(() => !!(window as any).__hfScene, null, {
      timeout: 5000,
    })

    const result = await page.evaluate(async () => {
      const events: Array<{
        origin?: string
        moved?: number
        added?: number
        removed?: number
      }> = []
      const handler = (e: Event) => {
        const d = (e as CustomEvent).detail
        events.push({
          origin: d?.origin,
          moved: d?.moved,
          added: d?.added,
          removed: d?.removed,
        })
      }
      window.addEventListener('halofire:scene-changed', handler)

      const hf = (window as any).__hfScene
      const st = hf.getState()
      const level = Object.values(st.nodes).find(
        (n: any) => n.type === 'level',
      ) as any
      if (!level) {
        window.removeEventListener('halofire:scene-changed', handler)
        return { err: 'no level' }
      }

      const id = 'item_pw_probe_' + Date.now()
      const probe = {
        id,
        type: 'item',
        position: [0, 1, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        children: [],
        parentId: level.id,
        asset: {
          id: 'probe',
          category: 'sprinkler_head_pendant',
          name: 'probe',
          thumbnail: '',
          dimensions: [0.4, 0.4, 0.4],
          src: '',
          attachTo: 'ceiling',
          offset: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          tags: ['halofire', 'sprinkler_head_pendant'],
        },
        metadata: { tags: ['halofire'] },
      }
      hf.createNode(probe, level.id)
      await new Promise((r) => setTimeout(r, 250))

      hf.updateNode(id, { position: [5, 1, 5] })
      await new Promise((r) => setTimeout(r, 250))

      hf.deleteNode(id)
      await new Promise((r) => setTimeout(r, 250))

      window.removeEventListener('halofire:scene-changed', handler)
      return { events }
    })

    expect(result.err).toBeUndefined()
    const origins = (result.events ?? []).map((e) => e.origin)
    expect(origins).toContain('add-head')
    expect(origins).toContain('move')
    expect(origins).toContain('remove-head')
  })
})
