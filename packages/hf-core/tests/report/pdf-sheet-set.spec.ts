/**
 * pdf-sheet-set — R6.6 exporter tests.
 *
 * Runs under the Playwright test runner (hf-core project) in a Node
 * context. Verifies:
 *   1. A 3-sheet fixture produces a PDF with 3 pages.
 *   2. PDF page sizes match the sheet paper sizes (in points).
 *   3. The written file starts with the %PDF- magic header and is
 *      a plausible size (> 10 KB).
 */
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

import type { SheetNode } from '@pascal-app/core'
import {
  MM_TO_PT,
  paperSizeMm,
  renderSheetSet,
} from '@halofire/core/report/pdf-sheet-set'

function makeSheet(
  idx: number,
  paper: SheetNode['paper_size'],
  orientation: 'landscape' | 'portrait' = 'landscape',
): SheetNode {
  return {
    id: `sheet_FP-00${idx + 1}`,
    type: 'sheet',
    name: `FP-00${idx + 1}`,
    title: `Test Sheet ${idx + 1}`,
    paper_size: paper,
    orientation,
    title_block_id: 'halofire.standard',
    viewports: [],
    dimensions: [],
    annotations: [],
    hatches: [],
    revision_clouds: [],
    sheet_index: idx,
    discipline: 'fire_protection',
    revision: 'V0',
  } as SheetNode
}

test.describe('pdf-sheet-set — R6.6', () => {
  test('MM_TO_PT conversion factor', () => {
    // 914mm (ARCH_D width) → ~2591 pt
    expect(914 * MM_TO_PT).toBeCloseTo(2590.866, 2)
  })

  test('paperSizeMm respects orientation', () => {
    const land = makeSheet(0, 'ARCH_D', 'landscape')
    const port = makeSheet(0, 'ARCH_D', 'portrait')
    expect(paperSizeMm(land)).toEqual([914, 610])
    expect(paperSizeMm(port)).toEqual([610, 914])
  })

  test('3-sheet fixture produces a 3-page PDF with correct sizes', async () => {
    const sheets: SheetNode[] = [
      makeSheet(0, 'ARCH_D', 'landscape'),
      makeSheet(1, 'ISO_A3', 'landscape'),
      makeSheet(2, 'ANSI_B', 'portrait'),
    ]
    const outPath = join(
      tmpdir(),
      `halofire-pdf-sheet-set-${Date.now()}.pdf`,
    )

    await renderSheetSet({
      sheets,
      sceneSnapshot: {},
      titleBlockFields: { project_name: 'Halo Fire HQ' },
      outPath,
      // Lower DPI keeps the test fast while still producing > 10 KB PDFs.
      dpi: 96,
    })

    const buf = await fs.readFile(outPath)
    expect(buf.byteLength).toBeGreaterThan(10_000)
    // PDF magic header.
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-')

    const pdf = await PDFDocument.load(buf)
    const pages = pdf.getPages()
    expect(pages.length).toBe(3)

    // Page sizes should equal sheet paper size × MM_TO_PT.
    const expected: Array<[number, number]> = [
      [914 * MM_TO_PT, 610 * MM_TO_PT], // ARCH_D landscape
      [420 * MM_TO_PT, 297 * MM_TO_PT], // ISO_A3 landscape
      [279 * MM_TO_PT, 432 * MM_TO_PT], // ANSI_B portrait
    ]
    pages.forEach((page, i) => {
      const { width, height } = page.getSize()
      expect(width).toBeCloseTo(expected[i]![0], 1)
      expect(height).toBeCloseTo(expected[i]![1], 1)
    })

    // Pages should be emitted in sheet_index order even if input is
    // shuffled.
    const shuffled: SheetNode[] = [sheets[2]!, sheets[0]!, sheets[1]!]
    const outPath2 = join(
      tmpdir(),
      `halofire-pdf-sheet-set-sorted-${Date.now()}.pdf`,
    )
    await renderSheetSet({
      sheets: shuffled,
      sceneSnapshot: {},
      titleBlockFields: {},
      outPath: outPath2,
      dpi: 96,
    })
    const pdf2 = await PDFDocument.load(await fs.readFile(outPath2))
    const sz0 = pdf2.getPage(0).getSize()
    // First page should be ARCH_D landscape (sheet_index 0).
    expect(sz0.width).toBeCloseTo(914 * MM_TO_PT, 1)
    expect(sz0.height).toBeCloseTo(610 * MM_TO_PT, 1)

    await fs.unlink(outPath).catch(() => {})
    await fs.unlink(outPath2).catch(() => {})
  })
})
