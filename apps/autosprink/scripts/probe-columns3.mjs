/**
 * probe-columns3.mjs — refine: visualize WHERE the 233 compact box clusters sit, separate
 * the dense-row artifacts (schedule tables / symbol legends repeat small boxes in a line) from
 * real grid columns. Real columns: near-square, on a 2D grid (regular in BOTH axes), spread
 * across the plan body — NOT packed in one tight row/table.
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractSegmentsFromOpList, parseArchitecturalScale } from '../src/engine/pdf-floorplan.js';

const PDF = path.resolve(process.cwd(), 'plans/cooperative-1881/1881-architecturals.pdf');
const FT_PER_PT = 1 / ((3 / 32) * 72);
const segLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const segMid = (s) => [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2];
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function main() {
  const { DOMMatrix } = await import('canvas'); globalThis.DOMMatrix = DOMMatrix;
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(PDF)), disableFontFace: true }).promise;
  const page = await doc.getPage(8);
  const tc = await page.getTextContent();
  const joined = (tc.items || []).map((it) => String(it.str || '')).join(' ');
  const fpu = parseArchitecturalScale(joined) || FT_PER_PT;
  const opList = await page.getOperatorList();
  const { segments } = extractSegmentsFromOpList(opList, { scale: fpu });

  const isOrtho = (s) => { const dx = Math.abs(s.x2 - s.x1), dy = Math.abs(s.y2 - s.y1); return dx < 0.06 || dy < 0.06; };
  const shorts = segments.filter((s) => { const L = segLen(s); return L > 0.05 && L <= 2.5 && isOrtho(s); });
  const cell = 0.7; const buckets = new Map();
  const bkey = (x, y) => Math.round(x / cell) + ',' + Math.round(y / cell);
  shorts.forEach((s, i) => { const [mx, my] = segMid(s); const k = bkey(mx, my); let a = buckets.get(k); if (!a) { a = []; buckets.set(k, a); } a.push(i); });
  const visited = new Set(); const clusters = [];
  for (const k of buckets.keys()) {
    if (visited.has(k)) continue; const queue = [k]; visited.add(k); const members = [];
    while (queue.length) { const cur = queue.pop(); const [cx, cy] = cur.split(',').map(Number); const arr = buckets.get(cur); if (arr) members.push(...arr);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const nk = (cx + dx) + ',' + (cy + dy); if (buckets.has(nk) && !visited.has(nk)) { visited.add(nk); queue.push(nk); } } }
    clusters.push(members);
  }
  const recs = [];
  for (const m of clusters) {
    if (m.length < 4) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasH = false, hasV = false;
    for (const i of m) { const s = shorts[i]; minX = Math.min(minX, s.x1, s.x2); minY = Math.min(minY, s.y1, s.y2); maxX = Math.max(maxX, s.x1, s.x2); maxY = Math.max(maxY, s.y1, s.y2); const dx = Math.abs(s.x2 - s.x1), dy = Math.abs(s.y2 - s.y1); if (dx >= dy) hasH = true; else hasV = true; }
    const w = maxX - minX, h = maxY - minY;
    if (w >= 0.25 && w <= 3 && h >= 0.25 && h <= 3 && Math.max(w, h) / Math.max(0.05, Math.min(w, h)) <= 4 && hasH && hasV)
      recs.push({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w, h, n: m.length });
  }
  console.log('square box clusters (both H+V edges):', recs.length);

  // identify dense rows: a Y-band holding many boxes packed with small X-spacing = a table/legend.
  const byY = new Map();
  for (const r of recs) { const yk = Math.round(r.cy / 3); let a = byY.get(yk); if (!a) { a = []; byY.set(yk, a); } a.push(r); }
  const tableRows = [];
  for (const [yk, arr] of byY) {
    if (arr.length < 8) continue;
    const xs = arr.map((r) => r.cx).sort((a, b) => a - b);
    const gaps = xs.slice(1).map((v, i) => v - xs[i]);
    const medGap = median(gaps);
    if (medGap < 6) tableRows.push({ y: yk * 3, n: arr.length, medGap: medGap.toFixed(1) }); // packed row
  }
  console.log('dense packed rows (likely tables/legends):', tableRows.length, JSON.stringify(tableRows));

  // exclude boxes that belong to packed rows
  const inTableRow = (r) => tableRows.some((t) => Math.abs(r.cy - t.y) <= 3);
  const candidate = recs.filter((r) => !inTableRow(r));
  console.log('candidates after table exclusion:', candidate.length);

  // mutual-grid consensus: build X/Y datum lines from candidate centers, keep markers on BOTH
  const snapLines = (vals, tol, minN) => { const sorted = [...vals].sort((a, b) => a - b); const lines = []; for (const v of sorted) { const last = lines[lines.length - 1]; if (last && v - last.vals[last.vals.length - 1] <= tol) last.vals.push(v); else lines.push({ vals: [v] }); } return lines.map((l) => ({ coord: median(l.vals), n: l.vals.length })).filter((l) => l.n >= minN); };
  const xL = snapLines(candidate.map((c) => c.cx), 2.0, 2);
  const yL = snapLines(candidate.map((c) => c.cy), 2.0, 2);
  const onLine = (v, L) => L.some((l) => Math.abs(l.coord - v) <= 2.0);
  const onGrid = candidate.filter((c) => onLine(c.cx, xL) && onLine(c.cy, yL));
  console.log('X-lines:', xL.length, 'Y-lines:', yL.length);
  console.log('candidates ON 2D grid (regular X AND Y):', onGrid.length);
  const ws = onGrid.map((c) => c.w), hs = onGrid.map((c) => c.h);
  console.log('  on-grid w med', median(ws).toFixed(2), 'h med', median(hs).toFixed(2));
  console.log('  X-line coords:', xL.map((l) => Math.round(l.coord)).join(','));
  console.log('  Y-line coords:', yL.map((l) => Math.round(l.coord)).join(','));
  // bbox of on-grid columns
  if (onGrid.length) {
    const bx = [Math.min(...onGrid.map((c) => c.cx)), Math.max(...onGrid.map((c) => c.cx))];
    const by = [Math.min(...onGrid.map((c) => c.cy)), Math.max(...onGrid.map((c) => c.cy))];
    console.log('  on-grid bbox X', bx.map(Math.round), 'Y', by.map(Math.round), 'spanFt', Math.round(bx[1]-bx[0]), 'x', Math.round(by[1]-by[0]));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
