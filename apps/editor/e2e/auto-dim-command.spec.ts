/**
 * R8.3 — Auto-Dim-Pipe-Runs ribbon command.
 *
 * Verifies the new Analyze → Auto → "Auto-Dim Pipes" button wires
 * through `dispatchRibbon` → `handleAutoDim` → `autoDimensionPipeRun`
 * from @halofire/core, stashes the Dimension[] on `window.__hfAutoDim`
 * and broadcasts `halofire:dimensions-ready` for sheet consumers.
 *
 * Run:
 *   cd apps/editor
 *   ../../node_modules/.bin/playwright test auto-dim-command \
 *     --reporter=list
 */
import { expect, test } from '@playwright/test'

const gotoEditor = async (page: import('@playwright/test').Page) => {
  await page.goto('/')
  // Ribbon is always rendered — wait for it and then install a fallback
  // scene-hook if HalofireNodeWatcher's useEffect hasn't fired (the
  // Pascal Editor's three.js viewer occasionally throws under headless
  // chromium and that can block the mount chain that registers
  // __hfScene — the ribbon command itself doesn't need the real zustand
  // store, only a getState().nodes accessor).
  await page.waitForSelector('[data-testid="halofire-ribbon"]', {
    timeout: 15_000,
  })
  await page.evaluate(() => {
    const w = window as any
    if (!w.__hfScene) {
      const nodes: Record<string, any> = {}
      w.__hfScene = {
        getState: () => ({
          nodes,
          createNode: (n: any) => {
            nodes[n.id] = n
          },
          updateNode: (_id: string, _patch: any) => {},
          deleteNode: (id: string) => {
            delete nodes[id]
          },
        }),
      }
    }
  })
}

const seedPipeRun = async (page: import('@playwright/test').Page) => {
  // Drop a system + branch + 3 heads straight into the scene store
  // so we don't depend on the full auto-design pipeline.
  await page.evaluate(() => {
    const api = (window as any).__hfScene.getState()
    const nodes = api.nodes as Record<string, any>
    nodes['sys_e2e_r83'] = {
      id: 'sys_e2e_r83',
      type: 'system',
      name: 'E2E R8.3 system',
      systemType: 'wet',
    }
    nodes['pipe_e2e_br1'] = {
      id: 'pipe_e2e_br1',
      type: 'pipe',
      systemId: 'sys_e2e_r83',
      start_m: [0, 3.0, 0],
      end_m: [10, 3.0, 0],
      size_in: 1,
      schedule: 'SCH10',
      role: 'branch',
      downstreamPipeIds: [],
    }
    for (const [i, x] of [2.5, 5.0, 7.5].entries()) {
      const id = `sprinkler_head_e2e_${i}`
      nodes[id] = {
        id,
        type: 'sprinkler_head',
        systemId: 'sys_e2e_r83',
        branchId: 'pipe_e2e_br1',
        position: [x, 2.7, 0],
        rotation: [0, 0, 0],
        k_factor: 5.6,
        sku: 'TY-B',
        manufacturer: 'tyco',
        orientation: 'pendant',
        response: 'standard',
        temperature: 'ordinary_155F',
      }
    }
  })
}

test.describe('R8.3 Auto-Dim-Pipe-Runs ribbon command', () => {
  test('1. clicking the ribbon button fires halofire:ribbon with cmd=auto-dim-pipe-runs', async ({
    page,
  }) => {
    await gotoEditor(page)
    await page.evaluate(() => {
      ;(window as any).__hfRibbonEvents = [] as string[]
      window.addEventListener('halofire:ribbon', (e: Event) => {
        const detail = (e as CustomEvent).detail as { cmd?: string }
        if (detail?.cmd) (window as any).__hfRibbonEvents.push(detail.cmd)
      })
    })
    // Switch to the Analyze tab first.
    await page.getByTestId('ribbon-tab-analyze').click()
    await page
      .getByTestId('ribbon-btn-auto-dim-pipes')
      .waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByTestId('ribbon-btn-auto-dim-pipes').click()

    const fired: string[] = await page.evaluate(
      () => (window as any).__hfRibbonEvents,
    )
    expect(fired).toContain('auto-dim-pipe-runs')
  })

  test('2. 1 system + 3 heads on a branch → ≥ 1 Dimension on window.__hfAutoDim', async ({
    page,
  }) => {
    await gotoEditor(page)
    await seedPipeRun(page)

    await page.getByTestId('ribbon-tab-analyze').click()
    await page
      .getByTestId('ribbon-btn-auto-dim-pipes')
      .waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByTestId('ribbon-btn-auto-dim-pipes').click()

    await page.waitForFunction(
      () => Array.isArray((window as any).__hfAutoDim),
      null,
      { timeout: 5_000 },
    )
    const dims: any[] = await page.evaluate(
      () => (window as any).__hfAutoDim,
    )
    expect(dims.length).toBeGreaterThanOrEqual(1)
    expect(dims[0]?.points?.length).toBeGreaterThanOrEqual(2)
  })

  test('3. empty scene → toast event says "no systems to dimension"', async ({
    page,
  }) => {
    await gotoEditor(page)
    await page.evaluate(() => {
      // Wipe anything SceneBootstrap seeded so we have zero systems.
      const api = (window as any).__hfScene.getState()
      const nodes = api.nodes as Record<string, any>
      for (const id of Object.keys(nodes)) {
        if (nodes[id]?.type === 'system') delete nodes[id]
      }
      ;(window as any).__hfToasts = [] as Array<{
        level: string
        message: string
      }>
      window.addEventListener('halofire:toast', (e: Event) => {
        ;(window as any).__hfToasts.push((e as CustomEvent).detail)
      })
    })

    await page.getByTestId('ribbon-tab-analyze').click()
    await page
      .getByTestId('ribbon-btn-auto-dim-pipes')
      .waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByTestId('ribbon-btn-auto-dim-pipes').click()

    await page.waitForFunction(
      () => ((window as any).__hfToasts?.length ?? 0) > 0,
      null,
      { timeout: 5_000 },
    )
    const toasts: Array<{ level: string; message: string }> =
      await page.evaluate(() => (window as any).__hfToasts)
    expect(
      toasts.some((t) => /no systems to dimension/i.test(t.message)),
    ).toBe(true)
  })

  test('4. produced Dimension unit_display matches opts (ft_in)', async ({
    page,
  }) => {
    await gotoEditor(page)
    await seedPipeRun(page)

    await page.getByTestId('ribbon-tab-analyze').click()
    await page
      .getByTestId('ribbon-btn-auto-dim-pipes')
      .waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByTestId('ribbon-btn-auto-dim-pipes').click()

    await page.waitForFunction(
      () => ((window as any).__hfAutoDim?.length ?? 0) > 0,
      null,
      { timeout: 5_000 },
    )
    const dims: any[] = await page.evaluate(
      () => (window as any).__hfAutoDim,
    )
    for (const d of dims) {
      expect(d.unit_display).toBe('ft_in')
    }
  })
})
