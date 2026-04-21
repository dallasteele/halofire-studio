/**
 * R1.6 — HydraulicSystem boot-install.
 *
 * Verifies that `installHydraulicSystem` is mounted in a top-level
 * `useEffect` on the editor page, so that any pipe / system / head
 * mutation routed through the Pascal scene store triggers the
 * Hazen-Williams demand solver and writes `.demand` back onto the
 * SystemNode within the debounce window (300 ms).
 */
import { expect, test } from '@playwright/test'

test.describe('HydraulicSystem boot-install', () => {
  test('system.demand populates within 5000ms of a pipe-resize mutation', async ({ page }) => {
    await page.goto('/')

    // Wait for the dev hook exposed by HalofireNodeWatcher.
    await page.waitForFunction(() => !!(window as any).__hfScene, null, {
      timeout: 10_000,
    })
    // Let SceneBootstrap + initial chrome emits settle. 1500ms
    // gives the HydraulicSystem install + initial prime solve time
    // to complete before the probe mutations fire, which keeps this
    // deterministic even when run after a full-suite warmup.
    await page.waitForTimeout(1500)

    const result = await page.evaluate(async () => {
      const hf = (window as any).__hfScene as {
        getState: () => {
          nodes: Record<string, any>
          createNode: (n: any, parentId: string) => void
          updateNode: (id: string, data: any) => void
        }
        createNode: (n: any, parentId: string) => void
        updateNode: (id: string, data: any) => void
      }
      const st = hf.getState()
      const level = Object.values(st.nodes).find(
        (n: any) => n.type === 'level',
      ) as any
      if (!level) return { err: 'no level' }

      const sysId = 'system_hyd_probe_' + Date.now()
      const pipeId = 'pipe_hyd_probe_' + Date.now()

      hf.createNode(
        {
          id: sysId,
          type: 'system',
          kind: 'wet',
          hazard: 'ordinary_group_1',
          name: 'probe',
          children: [],
          parentId: level.id,
          supply: { static_psi: 80, residual_psi: 60, test_flow_gpm: 1000 },
        },
        level.id,
      )
      hf.createNode(
        {
          id: pipeId,
          type: 'pipe',
          systemId: sysId,
          start_m: [0, 3, 0],
          end_m: [0, 3, 10],
          size_in: 2,
          schedule: 'SCH40',
          children: [],
          parentId: level.id,
        },
        level.id,
      )

      // Trigger a pipe-resize mutation; debounce is 300 ms.
      hf.updateNode(pipeId, { end_m: [0, 3, 20] })

      // Wait up to 5000 ms for the solver to write `.demand`.
      // (Debounce is 300ms; wider window covers poll-fallback ticks
      // when a continuous-mutation storm keeps resetting the debounce.)
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const sys = hf.getState().nodes[sysId]
        if (sys && sys.demand && typeof sys.demand.required_psi === 'number') {
          return {
            ok: true,
            demand: sys.demand,
          }
        }
        await new Promise((r) => setTimeout(r, 50))
      }
      return { err: 'demand not populated within 5000ms' }
    })

    expect(result.err, JSON.stringify(result)).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.demand.required_psi).toBeGreaterThan(0)
    expect(result.demand.sprinkler_flow_gpm).toBeGreaterThan(0)
  })
})
