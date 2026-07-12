/**
 * Bake small, web-friendly REGISTERED underlay PNGs for the architectural floor
 * plans, so the LIVE app can fetch a ~1-2 MB PNG instead of rasterizing the
 * 173 MB architecturals PDF in the browser (which fails on the VPS / headless,
 * leaving window.__planState().underlay === null and the walls floating on a
 * blank slab).
 *
 * Uses the SAME engine the app uses (src/engine/pdf-underlay.js
 * renderSheetToCanvas) with pdfjs-dist/legacy + @napi-rs/canvas in node — so the
 * baked raster is pixel-for-pixel what the in-browser path would have produced.
 *
 * Output: public/plan-underlays/cooperative-1881/A-10{N}-p{page}.png
 *         + a manifest.json carrying each sheet's PDF page widthPt/heightPt so
 *           the runtime can register the PNG with computePlanUnderlayTransform
 *           WITHOUT re-opening the PDF.
 *
 * Usage:
 *   node scripts/bake-plan-underlays.mjs            # bake all 8 levels
 *   node scripts/bake-plan-underlays.mjs 1          # bake only L1 (A-101 p8)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');
const ARCH_PDF = path.resolve(process.env.COOPERATIVE_1881_ARCH_PDF
  || path.join(APP_DIR, 'plans', 'cooperative-1881', '1881-architecturals.pdf'));
const PLAN_LEVELS = path.join(APP_DIR, 'src', 'data', 'plan-levels.cooperative-1881.json');
const OUT_DIR = path.join(APP_DIR, 'public', 'plan-underlays', 'cooperative-1881');
// Same mapping the app uses (autosprink.html PLAN_BUILD_LEVEL_PAGES).
const LEVEL_PAGES = { 1: 8, 2: 11, 3: 14, 4: 17, 5: 20, 6: 23, 7: 26, 8: 29 };
// Same web-friendly longest-edge the app renders at (LEVEL_TARGET_PX).
const TARGET_PX = 2400;

const onlyLevel = process.argv[2] ? Number(process.argv[2]) : null;
const levels = onlyLevel ? [onlyLevel] : Object.keys(LEVEL_PAGES).map(Number);

if (!fs.existsSync(ARCH_PDF)) {
  console.error('missing architecturals PDF:', ARCH_PDF);
  process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const sourcePdfSha256 = createHash('sha256').update(fs.readFileSync(ARCH_PDF)).digest('hex');
const planLevels = JSON.parse(fs.readFileSync(PLAN_LEVELS, 'utf8'));
if (planLevels.sourcePdfSha256 !== sourcePdfSha256 || planLevels.perLevelFootprintsVerified !== true) {
  throw new Error('underlay source does not match the current verified per-level geometry packet');
}

const sheets = [];
for (const lvl of levels) {
  const page = LEVEL_PAGES[lvl];
  if (!page) { console.error('no page mapping for level', lvl); continue; }
  const sheet = `A-10${lvl}`;
  const name = `${sheet}-p${page}.png`;
  const outPng = path.join(OUT_DIR, name);
  const t0 = Date.now();
  const rendered = await renderSheetToCanvas(pdfjsLib, { url: ARCH_PDF, page, targetPx: TARGET_PX });
  const buf = rendered.canvas.encodeSync
    ? rendered.canvas.encodeSync('png')
    : rendered.canvas.toBuffer('image/png');
  fs.writeFileSync(outPng, buf);
  const bytes = buf.length;
  const ms = Date.now() - t0;
  const sourceLevel = planLevels.levels.find((entry) => Number(entry.level) === lvl);
  if (sourceLevel?.plan?.sourceBinding?.sheetId !== sheet || sourceLevel?.plan?.sourceBinding?.physicalPageNumber !== page) {
    throw new Error(`L${lvl} source binding mismatch`);
  }
  sheets.push({
    level: lvl,
    sheet,
    page,
    file: name,
    url: `/public/plan-underlays/cooperative-1881/${name}`,
    widthPt: rendered.widthPt,
    heightPt: rendered.heightPt,
    widthPx: rendered.widthPx,
    heightPx: rendered.heightPx,
    bytes,
    pngSha256: createHash('sha256').update(buf).digest('hex'),
    sourcePdfSha256,
    sourceRenderedPageSha256: sourceLevel.plan.sourceBinding.renderedPageSha256,
    footprintEvidenceReceiptSha256: sourceLevel.plan.sourceBoundFootprintEvidenceReceiptSha256,
  });
  console.log(`OK  L${lvl} ${sheet} p${page} -> ${name} (${rendered.widthPx}x${rendered.heightPx}px, ${(bytes / 1e6).toFixed(2)} MB, ${ms}ms, page ${rendered.widthPt.toFixed(1)}x${rendered.heightPt.toFixed(1)}pt)`);
}

// Merge into an existing manifest if baking a subset, so a single-level rebake
// doesn't drop the other levels.
const manifestPath = path.join(OUT_DIR, 'manifest.json');
let prior = { sheets: [] };
if (fs.existsSync(manifestPath)) {
  try { prior = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* rewrite */ }
}
const byKey = new Map((prior.sheets || []).map((s) => [`${s.level}`, s]));
for (const s of sheets) byKey.set(`${s.level}`, s);
const merged = [...byKey.values()].sort((a, b) => a.level - b.level);
fs.writeFileSync(manifestPath, JSON.stringify({
  project: 'cooperative-1881',
  source: path.basename(ARCH_PDF),
  sourcePdfSha256,
  footprintEvidenceReceiptSha256: planLevels.footprintEvidenceReceiptSha256,
  targetPx: TARGET_PX,
  generatedAt: new Date().toISOString(),
  note: 'Current hash-bound baked underlays. Building footprint/elevation geometry is source-bound; sprinkler layout and code acceptance remain separate and fail-closed.',
  sheets: merged,
}, null, 2));
console.log(`\nmanifest -> ${manifestPath} (${merged.length} sheets)`);
