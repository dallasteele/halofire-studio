/**
 * pdf-sheet-set — R6.6 / blueprint 07 §9.
 *
 * Renders a set of SheetNodes into a single multi-page PDF. For each
 * sheet:
 *   1. `composeSheetSvg` produces a paper-space SVG (mm units).
 *   2. `@resvg/resvg-js` rasterizes that SVG to a PNG byte buffer.
 *   3. `pdf-lib` embeds the PNG on a PDF page whose size matches
 *      the sheet's paper size (mm → PDF points at 72 / 25.4).
 *
 * v1 ships the raster round-trip because it keeps the dependency
 * footprint small (two pure-Node packages, no cairo / librsvg /
 * headless chromium). R8 / R9 can refine to vector PDF emission
 * once the sheet-renderer stabilises.
 *
 * NOTE ON SVG COMPOSITION: the pure helper `composeSheetSvg` lives
 * in `@pascal-app/editor` (alongside the React SheetRenderer). That
 * package isn't wired as a hf-core dependency, so this exporter
 * re-implements a minimal façade over the same data by accepting a
 * `composeSvg` callback. Callers from the editor app inject
 * `composeSheetSvg` directly; the default fallback emits a blank
 * sheet so the exporter can still be exercised in isolation.
 */

import { promises as fs } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { PDFDocument } from 'pdf-lib'
import type {
  AnyNode,
  SheetNode,
} from '@pascal-app/core'

/** 1 mm = 72 / 25.4 PDF points. */
export const MM_TO_PT = 72 / 25.4

/**
 * Paper sizes in millimetres. Kept in-sync with
 * `packages/editor/src/components/sheet/sheet-renderer.tsx`.
 */
const PAPER_SIZES_MM: Record<SheetNode['paper_size'], [number, number]> = {
  ARCH_A: [305, 229], ARCH_B: [457, 305], ARCH_C: [610, 457],
  ARCH_D: [914, 610], ARCH_E: [1219, 914],
  ANSI_A: [279, 216], ANSI_B: [432, 279], ANSI_C: [559, 432],
  ANSI_D: [864, 559], ANSI_E: [1118, 864],
  ISO_A4: [297, 210], ISO_A3: [420, 297], ISO_A2: [594, 420],
  ISO_A1: [841, 594], ISO_A0: [1189, 841],
}

export function paperSizeMm(sheet: SheetNode): [number, number] {
  const [w, h] = PAPER_SIZES_MM[sheet.paper_size]
  return sheet.orientation === 'portrait' ? [h, w] : [w, h]
}

/**
 * Minimal fallback SVG composer used when the caller doesn't inject
 * the editor's richer `composeSheetSvg`. Emits a blank paper page
 * with the sheet's name so the exporter can be exercised without
 * dragging the editor package into hf-core's dependency graph.
 */
function fallbackComposeSvg(sheet: SheetNode): string {
  const [w, h] = paperSizeMm(sheet)
  const safeName = sheet.name.replace(/[<>&"']/g, '')
  const safeTitle = sheet.title.replace(/[<>&"']/g, '')
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm">` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>` +
    `<rect x="5" y="5" width="${w - 10}" height="${h - 10}" ` +
    `fill="none" stroke="#000" stroke-width="0.5"/>` +
    `<text x="${w / 2}" y="${h / 2}" font-size="20" ` +
    `text-anchor="middle" fill="#000">${safeName}</text>` +
    `<text x="${w / 2}" y="${h / 2 + 24}" font-size="10" ` +
    `text-anchor="middle" fill="#333">${safeTitle}</text>` +
    `</svg>`
  )
}

export type ComposeSvgFn = (
  sheet: SheetNode,
  sceneSnapshot: Record<string, AnyNode>,
  titleBlockFields: Record<string, string>,
) => string

export interface RenderSheetSetArgs {
  sheets: SheetNode[]
  sceneSnapshot: Record<string, AnyNode>
  titleBlockFields: Record<string, string>
  outPath: string
  /**
   * Optional override for the SVG composer. Editor-side callers
   * should inject `composeSheetSvg` from
   * `@pascal-app/editor/components/sheet/sheet-renderer`.
   */
  composeSvg?: ComposeSvgFn
  /**
   * Raster DPI. Defaults to 200 — plenty for review PDFs; R8 will
   * switch to a vector path and drop this entirely.
   */
  dpi?: number
}

/**
 * Rasterize a sheet's SVG into a PNG byte buffer sized so the full
 * paper matches the requested DPI.
 */
function rasterizeSheet(
  svg: string,
  paperMm: [number, number],
  dpi: number,
): Uint8Array {
  const [wMm] = paperMm
  const widthPx = Math.round((wMm / 25.4) * dpi)
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: widthPx },
    background: 'rgba(255,255,255,1)',
    // Avoid font crashes on Windows when no system fonts are loadable
    // — text falls back to glyph squares, which is fine for v1 PDFs.
    font: { loadSystemFonts: false },
  })
  const pngData = resvg.render().asPng()
  // pngData is a Node Buffer; pdf-lib accepts Uint8Array.
  return new Uint8Array(pngData)
}

/**
 * Render a sheet set to a single PDF at `outPath`.
 *
 * One sheet = one PDF page. Pages are emitted in `sheet_index`
 * order; the input array is not mutated.
 */
export async function renderSheetSet(args: RenderSheetSetArgs): Promise<void> {
  const {
    sheets,
    sceneSnapshot,
    titleBlockFields,
    outPath,
    composeSvg = fallbackComposeSvg,
    dpi = 200,
  } = args

  const sorted = [...sheets].sort((a, b) => a.sheet_index - b.sheet_index)

  const pdf = await PDFDocument.create()

  for (const sheet of sorted) {
    const svg = composeSvg(sheet, sceneSnapshot, titleBlockFields)
    const [wMm, hMm] = paperSizeMm(sheet)
    const pngBytes = rasterizeSheet(svg, [wMm, hMm], dpi)
    const png = await pdf.embedPng(pngBytes)

    const pageWidthPt = wMm * MM_TO_PT
    const pageHeightPt = hMm * MM_TO_PT
    const page = pdf.addPage([pageWidthPt, pageHeightPt])
    page.drawImage(png, {
      x: 0,
      y: 0,
      width: pageWidthPt,
      height: pageHeightPt,
    })
  }

  const bytes = await pdf.save()
  await fs.writeFile(outPath, bytes)
}
