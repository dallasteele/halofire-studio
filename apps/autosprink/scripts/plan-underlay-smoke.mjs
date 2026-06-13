/**
 * Stream B smoke — render real plan-sheet pages to PNG via the SAME engine
 * module the app will use (src/engine/pdf-underlay.js renderSheetToCanvas),
 * with pdfjs legacy + @napi-rs/canvas in node. Visual proof the user's REAL
 * bid plans render correctly.
 *
 * Usage:
 *   node scripts/plan-underlay-smoke.mjs "<plans dir>" "<out dir>" [pageSpecJson]
 * Default renders page 1 of every *.pdf in the dir, plus the per-level
 * architectural overall plans (A-101..A-108) from the Architecturals set.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas, computeUnderlayTransform } from '../src/engine/pdf-underlay.js';

const plansDir = process.argv[2];
const outDir = process.argv[3] || 'out/plan-underlay-smoke';
if (!plansDir || !fs.existsSync(plansDir)) {
  console.error('usage: node scripts/plan-underlay-smoke.mjs <plansDir> <outDir>');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const jobs = [];
for (const f of fs.readdirSync(plansDir).filter((x) => x.toLowerCase().endsWith('.pdf'))) {
  jobs.push({ file: f, page: 1 });
}
// Per-level architectural overall floor plans (pages from PDF page labels).
const archFile = fs.readdirSync(plansDir).find((x) => /architectural/i.test(x));
if (archFile) {
  for (let lvl = 1; lvl <= 8; lvl++) {
    jobs.push({ file: archFile, page: 8 + (lvl - 1) * 3, tag: `A-10${lvl}-level${lvl}` });
  }
}

const results = [];
for (const job of jobs) {
  const full = path.join(plansDir, job.file);
  const safe = (job.tag ? job.tag : job.file.replace(/\.pdf$/i, '') + `-p${job.page}`)
    .replace(/[^A-Za-z0-9._-]+/g, '_');
  const outPng = path.join(outDir, `${safe}.png`);
  const t0 = Date.now();
  try {
    const rendered = await renderSheetToCanvas(pdfjsLib, { url: full, page: job.page, targetPx: 2400 });
    // exercise the same transform math the underlay mesh uses (1881 footprint)
    const transform = computeUnderlayTransform({
      pageWidthPt: rendered.widthPt,
      pageHeightPt: rendered.heightPt,
      targetWidthFt: 413,
      targetDepthFt: 413.2,
      elevationFt: 0,
    });
    const buf = rendered.canvas.encodeSync
      ? rendered.canvas.encodeSync('png')
      : rendered.canvas.toBuffer('image/png');
    fs.writeFileSync(outPng, buf);
    const ms = Date.now() - t0;
    results.push({ file: job.file, page: job.page, png: outPng, widthPx: rendered.widthPx, heightPx: rendered.heightPx, widthFt: transform.widthFt, depthFt: transform.depthFt, ms, ok: true });
    console.log(`OK  ${job.file} p${job.page} -> ${outPng} (${rendered.widthPx}x${rendered.heightPx}px, ${transform.widthFt.toFixed(1)}x${transform.depthFt.toFixed(1)}ft, ${ms}ms)`);
  } catch (err) {
    results.push({ file: job.file, page: job.page, ok: false, error: String(err && err.message ? err.message : err) });
    console.log(`ERR ${job.file} p${job.page}: ${err && err.message ? err.message : err}`);
  }
}
fs.writeFileSync(path.join(outDir, 'smoke-results.json'), JSON.stringify({ plansDir, generatedAt: new Date().toISOString(), results }, null, 2));
const okCount = results.filter((r) => r.ok).length;
console.log(`\n${okCount}/${results.length} renders OK; results -> ${path.join(outDir, 'smoke-results.json')}`);
process.exit(okCount > 0 ? 0 : 1);
