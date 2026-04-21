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
  test('system.demand populates within 600ms of a pipe-resize mutation', async ({ page }) => {
    await page.goto('/')

    // Wait for the dev hook exposed by HalofireNodeWatcher.
    await page.waitForFunction(() => !!(window as any).__hfScene, null, {
      timeout: 10_000,
    })
    // Let SceneBootstrap + initial chrome emits settle.
    await page.waitForTimeout(600)

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
          start: [0, 3, 0],
          end: [0, 3, 10],
          diameter_nominal_in: 2,
          material: 'steel_sch40',
          children: [],
          parentId: level.id,
        },
        level.id,
      )

      // Trigger a pipe-resize mutation; debounce is 300 ms.
      hf.updateNode(pipeId, { end: [0, 3, 20] })

      // Wait up to 600 ms for the solver to write `.demand`.
      const deadline = Date.now() + 600
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
      return { err: 'demand not populated within 600ms' }
    })

    expect(result.err, JSON.stringify(result)).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.demand.required_psi).toBeGreaterThan(0)
    expect(result.demand.sprinkler_flow_gpm).toBeGreaterThan(0)
  })
})
