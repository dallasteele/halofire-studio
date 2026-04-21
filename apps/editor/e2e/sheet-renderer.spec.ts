/**
 * R6.5 — SheetRenderer composite tests.
 *
 * Pure unit tests running under the Playwright test runner in a
 * Node context. Imports the pure `composeSheetSvg` helper so we
 * can exercise the full compositor without needing a browser or
 * React reconciler.
 */
import { expect, test } from '@playwright/test'
import type { SheetNode } from '@pascal-app/core'
import {
  PAPER_SIZES_MM,
  composeSheetSvg,
  paperSizeMm,
} from '../../../packages/editor/src/components/sheet/sheet-renderer'

function minimalSheet(
  overrides: Partial<SheetNode> = {},
): SheetNode {
  return {
    id: 'sheet_FP-001',
    type: 'sheet',
    name: 'FP-001',
    title: 'Level 1 — Sprinkler Plan',
    paper_size: 'ARCH_D',
    orientation: 'landscape',
    title_block_id: 'halofire.standard',
    viewports: [],
    dimensions: [],
    annotations: [],
    hatches: [],
    revision_clouds: [],
    sheet_index: 0,
    discipline: 'fire_protection',
    revision: 'V0',
    ...overrides,
  } as SheetNode
}

test.describe('SheetRenderer — R6.5', () => {
  test('ARCH_D landscape → viewBox 0 0 914 610', () => {
    const svg = composeSheetSvg(
      minimalSheet(),
      {},
      { project_name: 'Halo Fire HQ' },
    )
    expect(svg).toContain('viewBox="0 0 914 610"')
    expect(svg).toContain('Halo Fire HQ')
    expect(paperSizeMm(minimalSheet())).toEqual([914, 610])
  })

  test('portrait orientation swaps width and height', () => {
    const sheet = minimalSheet({
      paper_size: 'ISO_A3',
      orientation: 'portrait',
    })
    expect(paperSizeMm(sheet)).toEqual([297, 420])
    const svg = composeSheetSvg(sheet, {}, {})
    expect(svg).toContain('viewBox="0 0 297 420"')
  })

  test('every paper size has a landscape and portrait form', () => {
    for (const key of Object.keys(PAPER_SIZES_MM) as Array<
      SheetNode['paper_size']
    >) {
      const [w, h] = PAPER_SIZES_MM[key]
      expect(w).toBeGreaterThan(0)
      expect(h).toBeGreaterThan(0)
      const land = paperSizeMm(minimalSheet({ paper_size: key }))
      const port = paperSizeMm(
        minimalSheet({ paper_size: key, orientation: 'portrait' }),
      )
      expect(land).toEqual([w, h])
      expect(port).toEqual([h, w])
    }
  })

  test('viewports, hatches, dimensions, annotations, revision clouds all render', () => {
    const sheet = minimalSheet({
      viewports: [
        {
          id: 'vp1',
          paper_rect_mm: [50, 50, 400, 300],
          camera: { kind: 'top' },
          scale: '1_96',
        },
      ],
      hatches: [
        {
          id: 'h1',
          polygon_m: [
            [0, 0],
            [5, 0],
            [5, 5],
            [0, 5],
          ],
          pattern: 'solid',
          color: '#ff8800',
          opacity: 0.3,
        },
      ],
      dimensions: [
        {
          id: 'd1',
          kind: 'linear',
          points: [
            [0, 0],
            [3, 0],
          ],
          dim_line_offset_m: 0.5,
          precision: 2,
          unit_display: 'ft_in',
          style_id: 'default',
        },
      ],
      annotations: [
        {
          id: 'a1',
          kind: 'note',
          text: 'NOTE 1',
          text_position_paper_mm: [100, 100],
          leader_polyline_mm: [
            [100, 100],
            [120, 120],
          ],
          style_id: 'default',
        },
      ],
      revision_clouds: [
        {
          id: 'rc1',
          revision_id: 'v2',
          polyline_m: [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 0],
          ],
          bubble_number: 1,
          note: 'shifted pipe',
          status: 'open',
        },
      ],
    })
    const svg = composeSheetSvg(sheet, {}, {})
    expect(svg).toContain('data-viewport-id="vp1"')
    expect(svg).toContain('data-hatch-id="h1"')
    expect(svg).toContain('data-dim-id="d1"')
    expect(svg).toContain('NOTE 1')
    expect(svg).toContain('data-rev-id="rc1"')
    expect(svg).toContain('class="title-block"')
  })

  test('annotation text is XML-escaped (no raw angle brackets)', () => {
    const sheet = minimalSheet({
      annotations: [
        {
          id: 'a1',
          kind: 'note',
          text: '<script>alert(1)</script>',
          text_position_paper_mm: [10, 10],
          leader_polyline_mm: [],
          style_id: 'default',
        },
      ],
    })
    const svg = composeSheetSvg(sheet, {}, {})
    expect(svg).not.toContain('<script>alert(1)</script>')
    expect(svg).toContain('&lt;script&gt;')
  })
})
