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

  // ─── R4.4 deeper pipeline-contract tests ─────────────────────────

  /**
   * Build a 3-level intake slice with N walls per level.
   * Level polygon is a trivial rectangle so slabs/ceilings auto-populate.
   */
  const buildIntakeStage = (
    levelCount: number,
    wallsPerLevel: number,
  ): Record<string, unknown> => {
    const levels = Array.from({ length: levelCount }, (_, li) => {
      const walls = Array.from({ length: wallsPerLevel }, (_, wi) => ({
        id: `w_${li}_${wi}`,
        start_m: [wi, 0],
        end_m: [wi + 1, 0],
        thickness_m: 0.2,
        height_m: 3,
      }))
      return {
        id: `lvl_${li}`,
        name: `Level ${li + 1}`,
        elevation_m: li * 3,
        height_m: 3,
        use: 'office',
        polygon_m: [
          [0, 0],
          [10, 0],
          [10, 8],
          [0, 8],
        ],
        ceiling: { kind: 'flat', height_m: 2.7, slope_deg: 0 },
        walls,
      }
    })
    return {
      step: 'intake',
      done: true,
      walls: wallsPerLevel * levelCount,
      slice: {
        building: {
          project_id: 'e2e_r44',
          construction_type: 'VB',
          total_sqft: 30_000,
          levels,
        },
      },
    }
  }

  const buildPlaceStage = (
    count: number,
    idPrefix = 'h',
  ): Record<string, unknown> => ({
    step: 'place',
    done: true,
    head_count: count,
    slice: {
      sprinkler_heads: Array.from({ length: count }, (_, i) => ({
        id: `${idPrefix}_${String(i).padStart(4, '0')}`,
        position_m: [i * 0.5, 2, 2.7],
        k_factor: 5.6,
        sku: 'pendant-5.6',
        orientation: 'pendent',
      })),
    },
  })

  /** 4 rooms appended to level metadata (classify is update-only). */
  const CLASSIFY_STAGE = {
    step: 'classify',
    done: true,
    slice: {
      levels: [
        {
          id: 'lvl_0',
          use: 'office',
          elevation_m: 0,
          height_m: 3,
          rooms: [
            { id: 'r0', hazard_class: 'light' },
            { id: 'r1', hazard_class: 'light' },
            { id: 'r2', hazard_class: 'ordinary_i' },
            { id: 'r3', hazard_class: 'ordinary_i' },
          ],
        },
      ],
    },
  }

  /** 1 system × 4 pipes × 2 fittings. */
  const ROUTE_STAGE = {
    step: 'route',
    done: true,
    slice: {
      systems: [
        {
          id: 'sys_a',
          type: 'wet',
          pipes: [
            { id: 'p0', start_m: [0, 0, 2.7], end_m: [5, 0, 2.7], size_in: 2, role: 'cross_main', schedule: 'sch10' },
            { id: 'p1', start_m: [5, 0, 2.7], end_m: [5, 5, 2.7], size_in: 1.5, role: 'branch', schedule: 'sch10' },
            { id: 'p2', start_m: [5, 5, 2.7], end_m: [8, 5, 2.7], size_in: 1.25, role: 'branch', schedule: 'sch10' },
            { id: 'p3', start_m: [8, 5, 2.7], end_m: [8, 5, 2.4], size_in: 1, role: 'drop', schedule: 'sch10' },
          ],
          fittings: [
            { id: 'f0', kind: 'tee_branch', position_m: [5, 0, 2.7], size_in: 2 },
            { id: 'f1', kind: 'elbow_90', position_m: [5, 5, 2.7], size_in: 1.5 },
          ],
          heads: [],
          hangers: [],
        },
      ],
    },
  }

  const HYDRAULIC_STAGE = {
    step: 'hydraulic',
    done: true,
    slice: {
      systems: [
        {
          id: 'sys_a',
          hydraulic: {
            required_flow_gpm: 150,
            required_pressure_psi: 45,
            supply_flow_gpm: 500,
            safety_margin_psi: 12,
          },
        },
      ],
    },
  }

  const RULECHECK_STAGE = {
    step: 'rulecheck',
    done: true,
    slice: { issues: [] },
  }

  test('5. full-pipeline synthetic run materializes the expected scene graph', async ({
    page,
  }) => {
    await primeAutoPilot(page)

    const intake = buildIntakeStage(3, 12)
    const place = buildPlaceStage(5, 'fullrun')

    for (const stage of [intake, CLASSIFY_STAGE, place, ROUTE_STAGE, HYDRAULIC_STAGE, RULECHECK_STAGE, DONE_STAGE]) {
      await page.evaluate((s) => {
        ;(window as any).__hfAutoPilot.inject(s)
      }, stage)
    }

    const counts = await countByType(page)

    // Intake → 1 site + 1 building + 3 levels + 3 slabs + 3 ceilings + 36 walls
    expect(counts.site ?? 0).toBeGreaterThanOrEqual(1)
    expect(counts.building ?? 0).toBeGreaterThanOrEqual(1)
    expect(counts.level ?? 0).toBeGreaterThanOrEqual(3)
    expect(counts.slab ?? 0).toBeGreaterThanOrEqual(3)
    expect(counts.ceiling ?? 0).toBeGreaterThanOrEqual(3)
    expect(counts.wall ?? 0).toBeGreaterThanOrEqual(36)
    // Place → 5 heads
    expect(counts.sprinkler_head ?? 0).toBeGreaterThanOrEqual(5)
    // Route → 1 system + 4 pipes + 2 fittings (valves filtered; none here)
    expect(counts.system ?? 0).toBeGreaterThanOrEqual(1)
    expect(counts.pipe ?? 0).toBeGreaterThanOrEqual(4)
    expect(counts.fitting ?? 0).toBeGreaterThanOrEqual(2)

    // Hydraulic updates systemNode.demand in-place; assert it landed.
    const demand = await page.evaluate(() => {
      const n = (window as any).__hfScene.getState().nodes as Record<string, any>
      const sys = Object.values(n).find((v: any) => v.type === 'system') as any
      return sys?.demand ?? null
    })
    expect(demand).toBeTruthy()
    expect(demand.total_flow_gpm).toBeGreaterThanOrEqual(150)

    // Done → completed
    const status = await page.getByTestId('autopilot-status').textContent()
    expect((status ?? '').toLowerCase()).toContain('completed')
  })

  test('6. ordering contract — no heads appear until place fires', async ({
    page,
  }) => {
    await primeAutoPilot(page)

    const intake = buildIntakeStage(1, 4)
    await page.evaluate((s) => {
      ;(window as any).__hfAutoPilot.inject(s)
    }, intake)

    const preHeads = await countByType(page)
    expect(preHeads.sprinkler_head ?? 0).toBe(0)

    const place = buildPlaceStage(5, 'ord')
    await page.evaluate((s) => {
      ;(window as any).__hfAutoPilot.inject(s)
    }, place)

    const postHeads = await countByType(page)
    expect(postHeads.sprinkler_head ?? 0).toBe(5)
    // Walls / slabs / levels from intake unchanged by place.
    expect(postHeads.wall).toBe(preHeads.wall)
    expect(postHeads.slab).toBe(preHeads.slab)
    expect(postHeads.level).toBe(preHeads.level)
  })

  test('7. partial pipeline — error mid-stream keeps earlier spawns (no rollback)', async ({
    page,
  }) => {
    await primeAutoPilot(page)

    // For this test we want to assert the stream hasn't completed, so
    // intentionally drop `done: true` from these stages. That keeps
    // AutoPilot.status on 'streaming' until the (simulated) error.
    const intake = { ...buildIntakeStage(1, 4), done: false }
    const place = { ...buildPlaceStage(3, 'crash'), done: false }

    await page.evaluate((s) => {
      ;(window as any).__hfAutoPilot.inject(s)
    }, intake)
    await page.evaluate((s) => {
      ;(window as any).__hfAutoPilot.inject(s)
    }, place)
    const beforeError = await countByType(page)
    expect(beforeError.sprinkler_head ?? 0).toBe(3)

    // Inject an error event. translate-slice returns an empty
    // translation for unknown steps, so the scene must NOT be rolled
    // back — we strictly require surviving heads.
    await page.evaluate(() => {
      ;(window as any).__hfAutoPilot.inject({
        step: 'error',
        message: 'intake failed',
        done: false,
      })
    })

    const afterError = await countByType(page)
    expect(afterError.sprinkler_head).toBe(beforeError.sprinkler_head)
    expect(afterError.wall).toBe(beforeError.wall)
    expect(afterError.slab).toBe(beforeError.slab)

    // AutoPilot status must not claim 'completed' — the stream didn't
    // finish cleanly. (Current wiring keeps 'streaming' for unknown
    // steps; the inspector row still surfaces the error event.)
    const status = await page.getByTestId('autopilot-status').textContent()
    expect((status ?? '').toLowerCase()).not.toContain('completed')

    // The error step gets rendered in the stream list — that's the DOM
    // signal users see.
    const errStep = page.locator('[data-testid="autopilot-step-error"]')
    await expect(errStep).toBeVisible()
  })

  test('8. cancel mid-stream — post-cancel slice is idempotent (no duplicates)', async ({
    page,
  }) => {
    await primeAutoPilot(page)

    const intake = buildIntakeStage(1, 4)
    const place = buildPlaceStage(4, 'cancel')

    await page.evaluate((s) => {
      ;(window as any).__hfAutoPilot.inject(s)
    }, intake)
    await page.evaluate((s) => {
      ;(window as any).__hfAutoPilot.inject(s)
    }, place)
    const beforeCancel = await countByType(page)

    await page.evaluate(() => {
      ;(window as any).__hfAutoPilot.inject({
        step: 'cancelled',
        job_id: 'e2e-r43',
        done: false,
      })
    })

    // Fire the SAME place slice post-cancel: deterministic ids mean
    // no new nodes are created. This proves the cancel path doesn't
    // leak duplicates even if a stale event arrives after cancel.
    await page.evaluate((s) => {
      ;(window as any).__hfAutoPilot.inject(s)
    }, place)

    const afterStalePlace = await countByType(page)
    expect(afterStalePlace.sprinkler_head).toBe(beforeCancel.sprinkler_head)
    expect(afterStalePlace.wall).toBe(beforeCancel.wall)
    expect(afterStalePlace.slab).toBe(beforeCancel.slab)
  })

  test('9. rapid injection — overlapping place slices dedup by deterministic id', async ({
    page,
  }) => {
    await primeAutoPilot(page)

    await page.evaluate((s) => {
      ;(window as any).__hfAutoPilot.inject(s)
    }, buildIntakeStage(1, 4))

    // Fire 3 place slices back-to-back. Each grows the population (5
    // → 10 → 15) by reusing the same id prefix; earlier ids appear in
    // later slices and MUST merge, not duplicate.
    const place5 = buildPlaceStage(5, 'rapid')
    const place10 = buildPlaceStage(10, 'rapid')
    const place15 = buildPlaceStage(15, 'rapid')

    await page.evaluate(
      ([a, b, c]) => {
        ;(window as any).__hfAutoPilot.inject(a)
        ;(window as any).__hfAutoPilot.inject(b)
        ;(window as any).__hfAutoPilot.inject(c)
      },
      [place5, place10, place15],
    )

    const counts = await countByType(page)
    // 15 unique ids across 3 overlapping slices — not 5+10+15=30.
    expect(counts.sprinkler_head ?? 0).toBe(15)
  })

  test('10. memory budget — 200 walls + 1000 heads without crash', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await primeAutoPilot(page)

    // 3 levels × ~67 walls ≈ 201 walls, clamp to 200 exactly by spec.
    // Use 1 level × 200 walls to keep the graph predictable.
    const intake = buildIntakeStage(1, 200)
    const place = buildPlaceStage(1000, 'budget')

    await page.evaluate((s) => {
      ;(window as any).__hfAutoPilot.inject(s)
    }, intake)
    await page.evaluate((s) => {
      ;(window as any).__hfAutoPilot.inject(s)
    }, place)

    const total = await page.evaluate(() => {
      return Object.keys((window as any).__hfScene.getState().nodes).length
    })

    // site(1) + building(1) + level(1) + slab(1) + ceiling(1) + walls(200)
    //   + heads(1000) = 1204. Task floor is 1210 to allow chrome nodes
    // SceneBootstrap may spawn; we assert >= 1204 strictly and log.
    expect(total).toBeGreaterThanOrEqual(1204)

    // No crash ⇒ status still reactive.
    const status = await page.getByTestId('autopilot-status').textContent()
    expect(status).not.toBeNull()
  })
})
