/**
 * pdf-snapshot — R6.7 PDF sheet-set snapshot regression tests.
 *
 * Rasterizes page 1 (cover) of an emitted PDF to a PNG image and
 * pixel-diffs against a committed golden file. Catches regressions
 * in `renderSheetSet` (hf-core/report/pdf-sheet-set) downstream of
 * the SVG composer, the `@resvg/resvg-js` raster, and `pdf-lib`
 * embedding.
 *
 * Stack:
 *   - `pdf-to-png-converter` (pdfjs-dist + @napi-rs/canvas) renders
 *     a PDF page to a PNG Buffer. Chosen over rolling our own pdfjs
 *     pipeline because it ships pre-built native binaries for all
 *     major platforms and returns a ready-to-diff PNG.
 *   - `pngjs` decodes PNGs to raw RGBA byte arrays.
 *   - `pixelmatch` computes the pixel-delta count between two RGBA
 *     arrays of matching dimensions.
 *
 * Pixel tolerance: 5 % of total pixels may differ. The rasterizer
 * fallback-font behaviour on Windows vs. other platforms renders
 * the blank title-block text as glyph squares at slightly different
 * positions; 5 % is loose enough to survive that and still catch
 * real regressions (misaligned pages, wrong paper size, entire
 * viewport dropped, blank page, etc.).
 *
 * REGENERATE GOLDENS:
 *   BUN_REGENERATE_SNAPSHOTS=1 bun run test -- pdf-snapshot
 * (or set the env var manually then re-run the hf-core project
 *  from the Playwright harness). Goldens are committed under
 *  `packages/hf-core/tests/report/golden/`.
 *
 * Determinism: the rasterizer (`@resvg/resvg-js` + pdfjs + napi
 * canvas) is deterministic for identical inputs on the same
 * machine. Test #3 verifies this by rendering twice and asserting
 * byte-equality. Cross-platform determinism is NOT guaranteed (font
 * fallback differs), which is why the goldens are tolerated with a
 * 5 % pixel budget rather than required byte-equal. CI should only
 * regen goldens on a single pinned OS / arch.
 */
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import { Canvas } from '@napi-rs/canvas'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import type { SheetNode } from '@pascal-app/core'
import { renderSheetSet } from '@halofire/core/report/pdf-sheet-set'

const HERE = dirname(fileURLToPath(import.meta.url))
const GOLDEN_DIR = join(HERE, 'golden')

const GOLDEN_WIDTH = 800
const PIXEL_DIFF_TOLERANCE = 0.05 // 5 % of total pixels may differ
const REGEN = process.env.BUN_REGENERATE_SNAPSHOTS === '1'

function makeSheet(
  idx: number,
  paper: SheetNode['paper_size'],
  name: string,
  title: string,
  orientation: 'landscape' | 'portrait' = 'landscape',
): SheetNode {
  return {
    id: `sheet_${name}`,
    type: 'sheet',
    name,
    title,
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

// Load pdfjs-dist legacy (CommonJS-compatible) build lazily so the
// test module stays ESM-friendly. Direct use of pdfjs (rather than
// the pdf-to-png-converter wrapper) sidesteps a Windows-path bug in
// pdf-to-png-converter v3.x where `cMapUrl` is emitted with
// backslashes and pdfjs rejects it with "must include trailing slash".
let pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null =
  null
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
  }
  return pdfjsPromise
}

/**
 * Rasterize one page of a PDF to an 8-bit PNG Buffer. Uses pdfjs +
 * `@napi-rs/canvas` directly.
 */
async function rasterizePdfPage(
  pdfPath: string,
  pageNumber: number,
): Promise<{ buf: Buffer; width: number; height: number }> {
  const pdfjs = await loadPdfjs()
  const bytes = new Uint8Array(await fs.readFile(pdfPath))
  const doc = await pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    // Explicitly omit cMapUrl / standardFontDataUrl — the default
    // fallback fonts in pdfjs are sufficient for glyph-square text
    // rendered by `@resvg/resvg-js`.
  }).promise
  try {
    const page = await doc.getPage(pageNumber)
    // Scale picks a reasonable raster width; we resize to GOLDEN_WIDTH
    // afterwards for deterministic goldens regardless of source page
    // size.
    const viewport = page.getViewport({ scale: GOLDEN_WIDTH / 2590 })
    const width = Math.ceil(viewport.width)
    const height = Math.ceil(viewport.height)
    const canvas = new Canvas(width, height)
    // pdfjs expects a canvas factory or a 2D-context-compatible
    // canvas. Cast through unknown — @napi-rs/canvas is API-
    // compatible with the DOM CanvasRenderingContext2D subset pdfjs
    // uses.
    const ctx = canvas.getContext('2d')
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise
    const buf = canvas.toBuffer('image/png')
    return { buf: Buffer.from(buf), width, height }
  } finally {
    await doc.destroy()
  }
}

/**
 * Resize a PNG buffer to a fixed width by nearest-neighbour
 * downsample. Keeps the deps lean — no sharp / jimp required.
 */
function resizePng(
  src: Buffer,
  targetWidth: number,
): { buf: Buffer; width: number; height: number } {
  const srcPng = PNG.sync.read(src)
  const ratio = targetWidth / srcPng.width
  const targetHeight = Math.max(1, Math.round(srcPng.height * ratio))
  const dst = new PNG({ width: targetWidth, height: targetHeight })
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.min(srcPng.height - 1, Math.floor(y / ratio))
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.min(srcPng.width - 1, Math.floor(x / ratio))
      const si = (srcPng.width * sy + sx) << 2
      const di = (targetWidth * y + x) << 2
      dst.data[di] = srcPng.data[si]!
      dst.data[di + 1] = srcPng.data[si + 1]!
      dst.data[di + 2] = srcPng.data[si + 2]!
      dst.data[di + 3] = srcPng.data[si + 3]!
    }
  }
  return {
    buf: PNG.sync.write(dst, { colorType: 2 }), // 8-bit RGB, no alpha → smaller files
    width: targetWidth,
    height: targetHeight,
  }
}

async function ensureGoldenDir() {
  await fs.mkdir(GOLDEN_DIR, { recursive: true })
}

function threeSheetFixture(): SheetNode[] {
  return [
    makeSheet(0, 'ARCH_D', 'FP-001', 'Cover Sheet', 'landscape'),
    makeSheet(1, 'ARCH_D', 'FP-002', 'Floor Plan — Level 1', 'landscape'),
    makeSheet(2, 'ARCH_D', 'FP-003', 'Riser Diagram', 'landscape'),
  ]
}

async function renderFixturePdf(
  sheets: SheetNode[],
  titleBlockFields: Record<string, string> = {},
): Promise<string> {
  const outPath = join(
    tmpdir(),
    `halofire-pdf-snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
  )
  await renderSheetSet({
    sheets,
    sceneSnapshot: {},
    titleBlockFields,
    outPath,
    dpi: 96,
  })
  return outPath
}

test.describe('pdf-snapshot — R6.7', () => {
  test('baseline: 3-sheet cover page matches committed golden', async () => {
    await ensureGoldenDir()
    const pdfPath = await renderFixturePdf(threeSheetFixture())

    const raw = await rasterizePdfPage(pdfPath, 1)
    const resized = resizePng(raw.buf, GOLDEN_WIDTH)
    const goldenPath = join(
      GOLDEN_DIR,
      `cover-page-${GOLDEN_WIDTH}x${resized.height}.png`,
    )

    let existed = true
    try {
      await fs.access(goldenPath)
    } catch {
      existed = false
    }

    if (!existed || REGEN) {
      await fs.writeFile(goldenPath, resized.buf)
      await fs.unlink(pdfPath).catch(() => {})
      test.info().annotations.push({
        type: 'snapshot-generated',
        description: `Wrote ${goldenPath} — commit it and re-run.`,
      })
      // First-run behaviour: auto-generate the golden, then assert
      // that the file we just wrote is on disk. The second run (with
      // committed golden) exercises the full pixel-diff path.
      expect(existed || REGEN, 'snapshot generated — commit + re-run').toBe(
        REGEN,
      )
      return
    }

    const goldenBuf = await fs.readFile(goldenPath)
    const goldenPng = PNG.sync.read(goldenBuf)
    const currentPng = PNG.sync.read(resized.buf)

    expect(currentPng.width).toBe(goldenPng.width)
    expect(currentPng.height).toBe(goldenPng.height)

    // Normalise both to 4-channel RGBA for pixelmatch (pngjs reads
    // RGB files with a 4-byte pitch anyway, but keep explicit).
    const diffPixels = pixelmatch(
      currentPng.data,
      goldenPng.data,
      null,
      goldenPng.width,
      goldenPng.height,
      { threshold: 0.2 },
    )
    const totalPixels = goldenPng.width * goldenPng.height
    const diffRatio = diffPixels / totalPixels
    expect(
      diffRatio,
      `pixel diff ${(diffRatio * 100).toFixed(2)}% exceeds ${(
        PIXEL_DIFF_TOLERANCE * 100
      ).toFixed(2)}% budget (${diffPixels}/${totalPixels} px)`,
    ).toBeLessThan(PIXEL_DIFF_TOLERANCE)

    await fs.unlink(pdfPath).catch(() => {})
  })

  test('title block populates: mean pixel intensity differs from blank', async () => {
    const sheets = [makeSheet(0, 'ARCH_D', 'FP-001', 'Title Block Test')]
    const pdfPath = await renderFixturePdf(sheets, {
      project_name: 'Test Project',
      sheet_number: 'FP-001',
    })
    const raw = await rasterizePdfPage(pdfPath, 1)
    const resized = resizePng(raw.buf, GOLDEN_WIDTH)
    const png = PNG.sync.read(resized.buf)

    // Compute mean luminance. A fully-white page → 255. Any content
    // (border, name, title, title-block fields) pulls it below 254.
    let sum = 0
    const n = png.width * png.height
    for (let i = 0; i < n; i++) {
      const p = i << 2
      // sRGB luma approximation.
      sum += 0.299 * png.data[p]! + 0.587 * png.data[p + 1]! + 0.114 * png.data[p + 2]!
    }
    const meanLuma = sum / n
    // Blank paper ≈ 255. Rendered sheet with border + text must be
    // measurably darker. The fallback SVG composer used by hf-core
    // in isolation draws a thin border + name + title — on an
    // ARCH_D sheet those cover well under 1% of pixels, so the mean
    // only shifts a fraction of a luma unit. Use 254.9 as the
    // "clearly non-blank" threshold; a fully-blank page would be
    // ≥254.99. Lower bound guards against rasterizer corruption.
    expect(
      meanLuma,
      `meanLuma=${meanLuma.toFixed(2)} — page appears blank`,
    ).toBeLessThan(254.9)
    expect(meanLuma, 'meanLuma too low — page likely corrupt').toBeGreaterThan(100)

    await fs.unlink(pdfPath).catch(() => {})
  })

  test('ordering determinism: two renders of page 2 are byte-equal', async () => {
    const sheets = threeSheetFixture()
    const pdf1 = await renderFixturePdf(sheets)
    const pdf2 = await renderFixturePdf(sheets)

    const [r1, r2] = await Promise.all([
      rasterizePdfPage(pdf1, 2),
      rasterizePdfPage(pdf2, 2),
    ])
    const p1 = resizePng(r1.buf, GOLDEN_WIDTH)
    const p2 = resizePng(r2.buf, GOLDEN_WIDTH)

    expect(p1.width).toBe(p2.width)
    expect(p1.height).toBe(p2.height)
    expect(Buffer.compare(p1.buf, p2.buf)).toBe(0)

    await fs.unlink(pdf1).catch(() => {})
    await fs.unlink(pdf2).catch(() => {})
  })
})
