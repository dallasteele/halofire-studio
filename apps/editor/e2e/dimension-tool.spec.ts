/**
 * R8.2 — DimensionTool (Pascal tool: click two points → place a
 * linear dimension on the active sheet).
 *
 * Smoke tests that exercise:
 *  1. Ribbon Annotate → Dimension button activates the tool and the
 *     first viewport click transitions idle → first-clicked.
 *  2. Two pointer clicks plus a third (dim-line-position) commit
 *     fires halofire:dimension-placed with a schema-valid record.
 *  3. Escape during routing cancels and no halofire:dimension-placed
 *     event fires.
 *  4. Tab cycles the kind: linear → continuous → aligned → linear.
 */
import { expect, test } from '@playwright/test'

test.describe('dimension-tool', () => {
  test('ribbon Annotate → Dimension activates and first click → first-clicked', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByTestId('halofire-ribbon')).toBeVisible()

    await page.getByTestId('ribbon-tab-annotate').click()
    await page.getByTestId('ribbon-btn-dimension').click()

    const overlay = page.getByTestId('halofire-dimension-tool')
    await expect(overlay).toBeVisible()
    await expect(overlay).toHaveAttribute('data-mode', 'idle')
    await expect(overlay).toHaveAttribute('data-kind', 'linear')

    // Dispatch a mousedown on the viewport canvas so the tool's
    // state machine advances idle → first-clicked.
    const mode = await page.evaluate(async () => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
      if (!canvas) return 'no-canvas'
      const r = canvas.getBoundingClientRect()
      canvas.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: r.left + r.width * 0.25,
          clientY: r.top + r.height * 0.5,
        }),
      )
      await new Promise((res) => setTimeout(res, 80))
      const el = document.querySelector(
        '[data-testid=halofire-dimension-tool]',
      ) as HTMLElement | null
      return el?.getAttribute('data-mode') ?? 'missing'
    })
    expect(mode).toBe('first-clicked')
  })

  test('two clicks + commit dispatches halofire:dimension-placed with a valid Dimension', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByTestId('ribbon-tab-annotate').click()
    await page.getByTestId('ribbon-btn-dimension').click()
    await expect(page.getByTestId('halofire-dimension-tool')).toBeVisible()

    const result = await page.evaluate(async () => {
      const events: Array<Record<string, unknown>> = []
      const handler = (e: Event) => {
        const d = (e as CustomEvent).detail as { dimension?: unknown }
        if (d?.dimension) events.push(d.dimension as Record<string, unknown>)
      }
      window.addEventListener('halofire:dimension-placed', handler)

      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
      if (!canvas) return { err: 'no-canvas', events }
      const r = canvas.getBoundingClientRect()
      const fire = (type: string, x: number, y: number) => {
        canvas.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            clientX: r.left + x,
            clientY: r.top + y,
          }),
        )
      }
      // Click 1 → firstPoint
      fire('mousedown', r.width * 0.2, r.height * 0.5)
      fire('mouseup', r.width * 0.2, r.height * 0.5)
      await new Promise((res) => setTimeout(res, 50))
      // Click 2 → secondPoint (enters dim-line-position)
      fire('mousedown', r.width * 0.6, r.height * 0.5)
      await new Promise((res) => setTimeout(res, 20))
      // Release in dim-line-position commits.
      fire('mouseup', r.width * 0.6, r.height * 0.5)
      await new Promise((res) => setTimeout(res, 100))

      window.removeEventListener('halofire:dimension-placed', handler)
      return { events }
    })

    expect(result.err).toBeUndefined()
    expect(result.events.length).toBeGreaterThanOrEqual(1)
    const dim = result.events[0] as {
      id: string
      kind: string
      points: number[][]
      dim_line_offset_m: number
      style_id: string
      unit_display: string
      precision: number
    }
    expect(dim.id).toMatch(/^dim_/)
    expect(dim.kind).toBe('linear')
    expect(dim.points).toHaveLength(2)
    expect(dim.points[0]).toHaveLength(2)
    expect(dim.points[1]).toHaveLength(2)
    expect(dim.dim_line_offset_m).toBeGreaterThan(0)
    expect(dim.style_id).toBe('halofire.default')
    expect(dim.unit_display).toBe('ft_in')
    expect(typeof dim.precision).toBe('number')
  })

  test('Escape during routing cancels — no halofire:dimension-placed fires', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByTestId('ribbon-tab-annotate').click()
    await page.getByTestId('ribbon-btn-dimension').click()
    await expect(page.getByTestId('halofire-dimension-tool')).toBeVisible()

    const result = await page.evaluate(async () => {
      const events: unknown[] = []
      const handler = (e: Event) => events.push((e as CustomEvent).detail)
      window.addEventListener('halofire:dimension-placed', handler)

      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
      if (!canvas) return { err: 'no-canvas', events }
      const r = canvas.getBoundingClientRect()
      canvas.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: r.left + r.width * 0.25,
          clientY: r.top + r.height * 0.5,
        }),
      )
      await new Promise((res) => setTimeout(res, 40))
      // Esc cancels before second click
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await new Promise((res) => setTimeout(res, 80))

      const overlay = document.querySelector(
        '[data-testid=halofire-dimension-tool]',
      )
      window.removeEventListener('halofire:dimension-placed', handler)
      return { events, overlayMounted: !!overlay }
    })

    expect(result.err).toBeUndefined()
    expect(result.events).toEqual([])
    // Esc deactivates the tool, so the overlay should also unmount.
    expect(result.overlayMounted).toBe(false)
  })

  test('Tab cycles kind: linear → continuous → aligned → linear', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByTestId('ribbon-tab-annotate').click()
    await page.getByTestId('ribbon-btn-dimension').click()

    const overlay = page.getByTestId('halofire-dimension-tool')
    await expect(overlay).toHaveAttribute('data-kind', 'linear')

    const cycled = await page.evaluate(async () => {
      const fireTab = () =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
        )
      const readKind = () =>
        (
          document.querySelector(
            '[data-testid=halofire-dimension-tool]',
          ) as HTMLElement | null
        )?.getAttribute('data-kind')
      const seen: Array<string | null | undefined> = [readKind()]
      fireTab()
      await new Promise((r) => setTimeout(r, 40))
      seen.push(readKind())
      fireTab()
      await new Promise((r) => setTimeout(r, 40))
      seen.push(readKind())
      fireTab()
      await new Promise((r) => setTimeout(r, 40))
      seen.push(readKind())
      return seen
    })
    expect(cycled).toEqual(['linear', 'continuous', 'aligned', 'linear'])
  })
})
