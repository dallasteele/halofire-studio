/**
 * R8.4 + R8.5 — Annotation tools smoke tests.
 *
 *  1. Ribbon Annotate → Text activates the text tool.
 *  2. `T` keydown (outside a text field) activates the text tool.
 *  3. Commit fires halofire:annotation-placed with kind='note' and a
 *     schema-shaped Annotation record.
 *  4. Ribbon Annotate → Revision Cloud activates the cloud tool.
 *  5. Shift+R keydown activates the cloud tool.
 *  6. Drag commit fires halofire:revision-cloud-placed with a valid
 *     RevisionCloud (bubble_number, polyline_m, status='open').
 */
import { expect, test } from '@playwright/test'

test.describe('annotation-tools', () => {
  test('ribbon Annotate → Text activates text tool', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('halofire-ribbon')).toBeVisible()

    await page.getByTestId('ribbon-tab-annotate').click()
    await page.getByTestId('ribbon-btn-text').click()

    const overlay = page.getByTestId('halofire-text-tool')
    await expect(overlay).toBeVisible()
    await expect(overlay).toHaveAttribute('data-mode', 'placing')
    await expect(overlay).toHaveAttribute('data-kind', 'note')
  })

  test('T key activates text tool', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('halofire-ribbon')).toBeVisible()

    const mode = await page.evaluate(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 't', bubbles: true }),
      )
      await new Promise((res) => setTimeout(res, 80))
      return (
        document
          .querySelector('[data-testid=halofire-text-tool]')
          ?.getAttribute('data-mode') ?? 'missing'
      )
    })
    expect(mode).toBe('placing')
  })

  test('text commit dispatches halofire:annotation-placed with kind=note', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByTestId('ribbon-tab-annotate').click()
    await page.getByTestId('ribbon-btn-text').click()
    await expect(page.getByTestId('halofire-text-tool')).toBeVisible()

    const result = await page.evaluate(async () => {
      const events: Array<Record<string, unknown>> = []
      const handler = (e: Event) => {
        const d = (e as CustomEvent).detail as { annotation?: unknown }
        if (d?.annotation)
          events.push(d.annotation as Record<string, unknown>)
      }
      window.addEventListener('halofire:annotation-placed', handler)

      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
      if (!canvas) return { err: 'no-canvas', events }
      const r = canvas.getBoundingClientRect()

      // Click anchor → enters 'typing'.
      canvas.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: r.left + r.width * 0.3,
          clientY: r.top + r.height * 0.4,
        }),
      )
      canvas.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: r.left + r.width * 0.3,
          clientY: r.top + r.height * 0.4,
        }),
      )
      await new Promise((res) => setTimeout(res, 80))

      // Type note in the inline input.
      const input = document.querySelector(
        '[data-testid=halofire-text-tool-input]',
      ) as HTMLInputElement | null
      if (!input) return { err: 'no-input', events }
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set
      setter?.call(input, 'branch line A-1')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((res) => setTimeout(res, 40))

      // Enter commits.
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
      await new Promise((res) => setTimeout(res, 120))

      window.removeEventListener('halofire:annotation-placed', handler)
      return { events }
    })

    expect(result.err).toBeUndefined()
    expect(result.events.length).toBeGreaterThanOrEqual(1)
    const ann = result.events[0] as {
      id: string
      kind: string
      text: string
      text_position_paper_mm: number[]
      style_id: string
      leader_polyline_mm: unknown[]
    }
    expect(ann.id).toMatch(/^ann_/)
    expect(ann.kind).toBe('note')
    expect(ann.text).toBe('branch line A-1')
    expect(ann.text_position_paper_mm).toHaveLength(2)
    expect(ann.style_id).toBe('halofire.default')
    expect(Array.isArray(ann.leader_polyline_mm)).toBe(true)
  })

  test('ribbon Annotate → Revision Cloud activates cloud tool', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByTestId('ribbon-tab-annotate').click()
    await page.getByTestId('ribbon-btn-revision-cloud').click()

    const overlay = page.getByTestId('halofire-revision-cloud-tool')
    await expect(overlay).toBeVisible()
    await expect(overlay).toHaveAttribute('data-mode', 'idle')
  })

  test('Shift+R activates cloud tool', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('halofire-ribbon')).toBeVisible()

    const mode = await page.evaluate(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'R',
          shiftKey: true,
          bubbles: true,
        }),
      )
      await new Promise((res) => setTimeout(res, 80))
      return (
        document
          .querySelector('[data-testid=halofire-revision-cloud-tool]')
          ?.getAttribute('data-mode') ?? 'missing'
      )
    })
    expect(mode).toBe('idle')
  })

  test('revision-cloud commit dispatches halofire:revision-cloud-placed with valid shape', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByTestId('ribbon-tab-annotate').click()
    await page.getByTestId('ribbon-btn-revision-cloud').click()
    await expect(page.getByTestId('halofire-revision-cloud-tool')).toBeVisible()

    const result = await page.evaluate(async () => {
      const events: Array<Record<string, unknown>> = []
      const handler = (e: Event) => {
        const d = (e as CustomEvent).detail as { revision_cloud?: unknown }
        if (d?.revision_cloud)
          events.push(d.revision_cloud as Record<string, unknown>)
      }
      window.addEventListener('halofire:revision-cloud-placed', handler)

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

      fire('mousedown', r.width * 0.2, r.height * 0.3)
      await new Promise((res) => setTimeout(res, 20))
      fire('mousemove', r.width * 0.35, r.height * 0.35)
      await new Promise((res) => setTimeout(res, 20))
      fire('mousemove', r.width * 0.5, r.height * 0.45)
      await new Promise((res) => setTimeout(res, 20))
      fire('mousemove', r.width * 0.6, r.height * 0.6)
      await new Promise((res) => setTimeout(res, 20))
      fire('mouseup', r.width * 0.6, r.height * 0.6)
      await new Promise((res) => setTimeout(res, 60))

      // Now in numbering — type note + Enter.
      const input = document.querySelector(
        '[data-testid=halofire-revision-cloud-note]',
      ) as HTMLInputElement | null
      if (!input) return { err: 'no-note-input', events }
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set
      setter?.call(input, 'relocated main')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((res) => setTimeout(res, 40))
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
      await new Promise((res) => setTimeout(res, 120))

      window.removeEventListener('halofire:revision-cloud-placed', handler)
      return { events }
    })

    expect(result.err).toBeUndefined()
    expect(result.events.length).toBeGreaterThanOrEqual(1)
    const cloud = result.events[0] as {
      id: string
      revision_id: string
      polyline_m: number[][]
      bubble_number: number
      note: string
      status: string
    }
    expect(cloud.id).toMatch(/^rev_/)
    expect(cloud.revision_id).toBe('current')
    expect(Array.isArray(cloud.polyline_m)).toBe(true)
    expect(cloud.polyline_m.length).toBeGreaterThanOrEqual(2)
    expect(cloud.polyline_m[0]).toHaveLength(2)
    expect(Number.isInteger(cloud.bubble_number)).toBe(true)
    expect(cloud.bubble_number).toBeGreaterThanOrEqual(1)
    expect(cloud.note).toBe('relocated main')
    expect(cloud.status).toBe('open')
  })
})
