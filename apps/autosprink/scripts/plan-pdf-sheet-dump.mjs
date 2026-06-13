/**
 * Stream B — dump per-page sheet identity for one plan PDF.
 * Usage: node scripts/plan-pdf-sheet-dump.mjs <pdf> [--text]
 * Prints "page<TAB>label" using PDF page labels when present; with --text it
 * additionally scans each page's text content for a sheet-code token
 * (e.g. M-101, P201, E-102a, FP-1) when no labels exist.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const file = process.argv[2];
const useText = process.argv.includes('--text');
if (!file) {
  console.error('usage: node scripts/plan-pdf-sheet-dump.mjs <pdf> [--text]');
  process.exit(2);
}

const SHEET_CODE_RE = /^[A-Z]{1,3}[-.]?\d{1,3}(?:\.\d{1,2})?[a-z]?$/;

const task = getDocument({ url: file, disableFontFace: true, isEvalSupported: false });
const doc = await task.promise;
let labels = null;
try {
  labels = await doc.getPageLabels();
} catch {
  labels = null;
}
for (let i = 1; i <= doc.numPages; i++) {
  let id = labels ? labels[i - 1] : '';
  if (!id && useText) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const counts = new Map();
    for (const item of tc.items) {
      const s = (item.str || '').trim();
      if (SHEET_CODE_RE.test(s)) counts.set(s, (counts.get(s) || 0) + 1);
    }
    // The sheet's own number normally appears in the title block; pick the
    // largest-font candidate by frequency heuristic (most repeated short code).
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    id = sorted.length ? sorted.map(([code, n]) => `${code}(${n})`).slice(0, 4).join(' ') : '';
    page.cleanup();
  }
  console.log(`${i}\t${id}`);
}
await task.destroy();
