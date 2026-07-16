/**
 * Bake the exact Dillon S-020 / S-021 structural PDF sheets used by the
 * structural-roof evidence packet. The manifest binds each web raster back to
 * the protected PDF hash and preserves the original PDF point coordinate
 * system so evidence overlays cannot float on a blank or unrelated canvas.
 *
 * Source PDFs are intentionally not committed. Override the defaults with:
 *   DILLON_S020_PDF=... DILLON_S021_PDF=... node scripts/bake-dillon-structural-underlays.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');
const CALIBRATION_DIR = path.join(APP_DIR, 'tmp', 'pdfs', 'dillon-roof-calibration');
const OUT_DIR = path.join(APP_DIR, 'public', 'plan-underlays', 'dillon-structural-roof');
const TARGET_PX = 2268;
const SHEETS = [
  {
    sheetId: 'S-020',
    sourceId: 'main-framing-pdf',
    pdf: path.resolve(process.env.DILLON_S020_PDF || path.join(CALIBRATION_DIR, 'main-plans', 'Main Level Framing Plan.pdf')),
    file: 'S-020-main-level-framing.png',
  },
  {
    sheetId: 'S-021',
    sourceId: 'upper-framing-pdf',
    pdf: path.resolve(process.env.DILLON_S021_PDF || path.join(CALIBRATION_DIR, 'main-plans', 'Upper Level Framing.pdf')),
    file: 'S-021-upper-level-framing.png',
  },
];

fs.mkdirSync(OUT_DIR, { recursive: true });
const manifestSheets = [];
for (const sheet of SHEETS) {
  if (!fs.existsSync(sheet.pdf)) throw new Error(`missing protected structural source for ${sheet.sheetId}: ${sheet.pdf}`);
  const pdfBytes = fs.readFileSync(sheet.pdf);
  const sourcePdfSha256 = createHash('sha256').update(pdfBytes).digest('hex');
  const rendered = await renderSheetToCanvas(pdfjsLib, { url: sheet.pdf, page: 1, targetPx: TARGET_PX });
  const png = rendered.canvas.encodeSync ? rendered.canvas.encodeSync('png') : rendered.canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUT_DIR, sheet.file), png);
  manifestSheets.push({
    sheetId: sheet.sheetId,
    sourceId: sheet.sourceId,
    page: 1,
    file: sheet.file,
    url: `/public/plan-underlays/dillon-structural-roof/${sheet.file}`,
    widthPt: rendered.widthPt,
    heightPt: rendered.heightPt,
    widthPx: rendered.widthPx,
    heightPx: rendered.heightPx,
    bytes: png.length,
    pngSha256: createHash('sha256').update(png).digest('hex'),
    sourcePdfSha256,
  });
  console.log(`OK ${sheet.sheetId} ${sourcePdfSha256.slice(0, 12)} -> ${sheet.file} (${rendered.widthPx}x${rendered.heightPx})`);
}

const manifest = {
  artifactType: 'halofire.dillon-structural-underlay-manifest.v1',
  projectName: 'Dillon Residence',
  coordinateConvention: 'PDF top-left points',
  targetPx: TARGET_PX,
  note: 'Exact hash-bound structural PDF underlays. Overlays are evidence only; unresolved pitch/datum joins are not 3D, compliance, fabrication, or field-release evidence.',
  sheets: manifestSheets,
};
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest -> ${path.join(OUT_DIR, 'manifest.json')}`);
