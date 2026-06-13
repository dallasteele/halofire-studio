/**
 * Stream B — inventory the REAL Cooperative 1881 bid plan PDFs.
 * Usage: node scripts/plan-pdf-inventory.mjs "<dir with plan PDFs>" [outJson]
 * For each *.pdf: page count + page labels (Bluebeam usually sets sheet codes
 * as PDF page labels) + first-page media box. Read-only; no rendering.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const dir = process.argv[2];
const outJson = process.argv[3] || null;
if (!dir || !fs.existsSync(dir)) {
  console.error('usage: node scripts/plan-pdf-inventory.mjs <dir> [out.json]');
  process.exit(2);
}

const pdfs = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
const inventory = [];
for (const file of pdfs) {
  const full = path.join(dir, file);
  const sizeBytes = fs.statSync(full).size;
  const entry = { file, sizeBytes, pages: null, pageLabels: null, firstPageBox: null, error: null };
  try {
    const task = getDocument({
      url: full,
      // inventory only: skip fonts/images work where possible
      disableFontFace: true,
      isEvalSupported: false,
    });
    const doc = await task.promise;
    entry.pages = doc.numPages;
    try {
      entry.pageLabels = await doc.getPageLabels();
    } catch {
      entry.pageLabels = null;
    }
    const p1 = await doc.getPage(1);
    const vp = p1.getViewport({ scale: 1 });
    entry.firstPageBox = { widthPt: vp.width, heightPt: vp.height };
    await task.destroy();
  } catch (err) {
    entry.error = String(err && err.message ? err.message : err);
  }
  inventory.push(entry);
  console.log(
    `${file}: ${entry.pages ?? 'ERR'} pages, ${(sizeBytes / 1e6).toFixed(1)} MB` +
      (entry.pageLabels ? `, labels[0..5]=${entry.pageLabels.slice(0, 6).join(',')}` : ', no page labels') +
      (entry.error ? `, error=${entry.error}` : ''),
  );
}
if (outJson) {
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify({ dir, generatedAt: new Date().toISOString(), inventory }, null, 2));
  console.log('wrote ' + outJson);
}
