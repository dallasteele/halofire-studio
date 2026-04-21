/**
 * AutoPilot — R4.3 streaming-slice consumer.
 *
 * Verifies that each pipeline-progress event translates into
 * incremental scene-node spawns, and that re-delivering the same
 * slice (SSE↔Tauri race) is a no-op thanks to translate-slice's
 * deterministic ids.
 *
 * Uses the `window.__hfAutoPilot.inject(stage)` test helper the
 * component installs in useEffect — that bypasses the gateway SSE
 * so the test is hermetic.
 *
 * Run:
 *   cd apps/editor
 *   ../../node_modules/.bin/playwright test autopilot-streaming \
 *     --reporter=list
 */
import { expect, test } from '@playwright/test'

// --- Fixture payloads (shape matches halofire-cad orchestrator) ----

const INTAKE_STAGE = {
  step: 'intake',
  done: true,
  walls: 4,
  slice: {
    building: {
      project_id: 'e2e_r43',
      construction_type: 'VB',
      total_sqft: 10_000,
      levels: [
        {
          id: 'lvl_0',
          name: 'Level 1',
          elevation_m: 0,
          height_m: 3,
          use: 'office',
          polygon_m: [
            [0, 0],
            [10, 0],
            [10, 8],
            [0, 8],
          ],
          ceiling: { kind: 'flat', height_m: 2.7, slope_deg: 0 },
          walls: [
            { id: 'w0', start_m: [0, 0], end_m: [10, 0], thickness_m: 0.2, height_m: 3 },
            { id: 'w1', start_m: [10, 0], end_m: [10, 8], thickness_m: 0.2, height_m: 3 },
            { id: 'w2', start_m: [10, 8], end_m: [0, 8], thickness_m: 0.2, height_m: 3 },
            { id: 'w3', start_m: [0, 8], end_m: [0, 0], thickness_m: 0.2, height_m: 3 },
          ],
        },
      ],
    },
  },
}

const PLACE_STAGE = {
  step: 'place',
  done: true,
  head_count: 3,
  slice: {
    sprinkler_heads: [
      {
        id: 'h_001',
        position_m: [2, 2, 2.7],
        k_factor: 5.6,
        sku: 'pendant-5.6',
        orientation: 'pendent',
      },
      {
        id: 'h_002',
        position_m: [5, 2, 2.7],
        k_factor: 5.6,
        sku: 'pendant-5.6',
        orientation: 'pendent',
      },
      {
        id: 'h_003',
        position_m: [8, 2, 2.7],
        k_factor: 5.6,
        sku: 'pendant-5.6',
        orientation: 'pendent',
      },
    ],
  },
}

const DONE_STAGE = { step: 'done', done: true }

// --- Shared page primer ------------------------------------------

const primeAutoPilot = async (page: import('@playwright/test').Page) => {
  await page.goto('/')
  // Scene store and HalofireNodeWatcher must be live.
  await page.waitForFunction(() => !!(window as any).__hfScene, null, {
    timeout: 15_000,
  })
  // AutoPilot only mounts when a jobId is dispatched.
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('halofire:job-started', {
        detail: { jobId: 'e2e-r43' },
      }),
    )
  })
  await page.waitForFunction(
    () => !!(window as any).__hfAutoPilot,
    null,
    { timeout: 10_000 },
  )
}

const countByType = async (page: import('@playwright/test').Page) => {
  return page.evaluate(() => {
    const nodes = (window as any).__hfScene.getState().nodes as Record<
      string,
      any
    >
    const out: Record<string, number> = {}
    for (const n of Object.values(nodes)) {
      const t = (n as any).type ?? 'unknown'
      out[t] = (out[t] ?? 0) + 1
    }
    return out
  })
}

test.describe('R4.3 AutoPilot — streaming slice spawn', () => {
  test('1. intake slice spawns walls + slabs into the scene', async ({
    page,
  }) => {
    await primeAutoPilot(page)
    const before = await countByType(page)

    await page.evaluate((stage) => {
      ;(window as any).__hfAutoPilot.inject(stage)
    }, INTAKE_STAGE)

    const after = await countByType(page)
    expect(after.wall ?? 0).toBeGreaterThanOrEqual((before.wall ?? 0) + 4)
    expect(after.slab ?? 0).toBeGreaterThanOrEqual((before.slab ?? 0) + 1)
    expect(after.level ?? 0).toBeGreaterThanOrEqual((before.level ?? 0) + 1)
  })

  test('2. place after intake adds heads without duplicating intake nodes', async ({
    page,
  }) => {
    await primeAutoPilot(page)
    await page.evaluate((stage) => {
      ;(window as any).__hfAutoPilot.inject(stage)
    }, INTAKE_STAGE)
    const afterIntake = await countByType(page)

    await page.evaluate((stage) => {
      ;(window as any).__hfAutoPilot.inject(stage)
    }, PLACE_STAGE)
    const afterPlace = await countByType(page)

    // Heads added.
    expect(afterPlace.sprinkler_head ?? 0).toBeGreaterThanOrEqual(3)
    // Intake-level nodes NOT duplicated by the place slice.
    expect(afterPlace.wall).toBe(afterIntake.wall)
    expect(afterPlace.slab).toBe(afterIntake.slab)
    expect(afterPlace.level).toBe(afterIntake.level)
  })

  test('3. re-applying the same place slice is idempotent (no new creates)', async ({
    page,
  }) => {
    await primeAutoPilot(page)
    await page.evaluate((stage) => {
      ;(window as any).__hfAutoPilot.inject(stage)
    }, INTAKE_STAGE)
    await page.evaluate((stage) => {
      ;(window as any).__hfAutoPilot.inject(stage)
    }, PLACE_STAGE)
    const once = await countByType(page)

    // Re-fire. translate-slice derives ids deterministically from the
    // payload, so the second pass must only emit updates.
    await page.evaluate((stage) => {
      ;(window as any).__hfAutoPilot.inject(stage)
    }, PLACE_STAGE)
    const twice = await countByType(page)

    expect(twice.sprinkler_head).toBe(once.sprinkler_head)
    expect(twice.wall).toBe(once.wall)
    expect(twice.slab).toBe(once.slab)
  })

  test('4. done event flips status to completed (camera-focus path)', async ({
    page,
  }) => {
    await primeAutoPilot(page)
    await page.evaluate((stage) => {
      ;(window as any).__hfAutoPilot.inject(stage)
    }, INTAKE_STAGE)
    await page.evaluate((stage) => {
      ;(window as any).__hfAutoPilot.inject(stage)
    }, DONE_STAGE)

    const status = await page
      .getByTestId('autopilot-status')
      .textContent()
    expect((status ?? '').toLowerCase()).toContain('completed')
  })
})
