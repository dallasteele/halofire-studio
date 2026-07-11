/**
 * probe-columns2.mjs — characterize ACTUAL column markers as small compact clusters of short
 * segments, independent of the (unreliable) text-bubble grid. Cluster short segments by
 * proximity; for each cluster report bbox size, segment count, fill-density, aspect. A real
 * column marker (HSS box / filled square / pier) is a SMALL (~0.4-2.5ft) compact cluster with
 * several short orthogonal segments. We then look at the SPATIAL REGULARITY of cluster centers
 * (columns sit on a regular grid) to separate columns from incidental small linework (text,
 * hatch, furniture corners).
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractSegmentsFromOpList, parseArchitecturalScale, isolatePlanExtent } from '../src/engine/pdf-floorplan.js';

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
  let { segments } = extractSegmentsFromOpList(opList, { scale: fpu });
  console.log('all segments:', segments.length);

  // clip to plan body to drop title block / legend / schedule tables
  let body = segments;
  try { const ip = isolatePlanExtent(segments, {}); if (ip && ip.segments && ip.segments.length > 1000) body = ip.segments; } catch (_) {}
  console.log('plan-body segments:', body.length);

  // SHORT orthogonal segments are the marker linework.
  const isOrtho = (s) => { const dx = Math.abs(s.x2 - s.x1), dy = Math.abs(s.y2 - s.y1); return dx < 0.06 || dy < 0.06; };
  const shorts = body.filter((s) => { const L = segLen(s); return L > 0.05 && L <= 2.5 && isOrtho(s); });
  console.log('short ortho segs (0.05-2.5ft):', shorts.length);

  // grid-bucket cluster (union-find on a 0.6ft grid of midpoints)
  const cell = 0.7;
  const buckets = new Map();
  const bkey = (x, y) => Math.round(x / cell) + ',' + Math.round(y / cell);
  shorts.forEach((s, i) => { const [mx, my] = segMid(s); const k = bkey(mx, my); let a = buckets.get(k); if (!a) { a = []; buckets.set(k, a); } a.push(i); });
  // BFS connect neighbouring occupied cells
  const visited = new Set(); const clusters = [];
  const keyOf = (cx, cy) => cx + ',' + cy;
  for (const k of buckets.keys()) {
    if (visited.has(k)) continue;
    const queue = [k]; visited.add(k); const members = [];
    while (queue.length) {
      const cur = queue.pop(); const [cx, cy] = cur.split(',').map(Number);
      const arr = buckets.get(cur); if (arr) members.push(...arr);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const nk = keyOf(cx + dx, cy + dy); if (buckets.has(nk) && !visited.has(nk)) { visited.add(nk); queue.push(nk); }
      }
    }
    clusters.push(members);
  }
  console.log('raw clusters:', clusters.length);

  // characterize each cluster: bbox, segcount; keep compact small ones
  const recs = [];
  for (const m of clusters) {
    if (m.length < 3) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of m) { const s = shorts[i]; minX = Math.min(minX, s.x1, s.x2); minY = Math.min(minY, s.y1, s.y2); maxX = Math.max(maxX, s.x1, s.x2); maxY = Math.max(maxY, s.y1, s.y2); }
    const w = maxX - minX, h = maxY - minY;
    recs.push({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w, h, n: m.length });
  }
  // column markers: compact box 0.3-3ft both dims, aspect <4
  const cols = recs.filter((r) => r.w >= 0.25 && r.w <= 3.0 && r.h >= 0.25 && r.h <= 3.0 && Math.max(r.w, r.h) / Math.max(0.05, Math.min(r.w, r.h)) <= 4 && r.n >= 4);
  console.log('compact box clusters (0.25-3ft, aspect<=4, >=4 segs):', cols.length);
  const ws = cols.map((c) => c.w), hs = cols.map((c) => c.h), nn = cols.map((c) => c.n);
  console.log('  w med', median(ws).toFixed(2), 'h med', median(hs).toFixed(2), 'n med', median(nn));
  // size histogram
  const sizes = cols.map((c) => Math.max(c.w, c.h));
  const sb = {}; for (const s of sizes) { const b = (Math.round(s * 2) / 2).toFixed(1); sb[b] = (sb[b] || 0) + 1; }
  console.log('  major-dim size histogram (ft):', JSON.stringify(sb));

  // SPATIAL REGULARITY: do cluster X-centers and Y-centers fall on a small set of datum lines?
  const snapLines = (vals, tol) => {
    const sorted = [...vals].sort((a, b) => a - b); const lines = [];
    for (const v of sorted) { const last = lines[lines.length - 1]; if (last && v - last.vals[last.vals.length - 1] <= tol) last.vals.push(v); else lines.push({ vals: [v] }); }
    return lines.map((l) => ({ coord: median(l.vals), n: l.vals.length }));
  };
  const xLines = snapLines(cols.map((c) => c.cx), 2.5).filter((l) => l.n >= 2);
  const yLines = snapLines(cols.map((c) => c.cy), 2.5).filter((l) => l.n >= 2);
  console.log('\nX datum lines (>=2 markers):', xLines.length, xLines.map((l) => Math.round(l.coord) + ':' + l.n).join(' '));
  console.log('Y datum lines (>=2 markers):', yLines.length, yLines.map((l) => Math.round(l.coord) + ':' + l.n).join(' '));
  const xg = xLines.map((l) => l.coord).slice(1).map((v, i) => v - xLines[i].coord);
  const yg = yLines.map((l) => l.coord).slice(1).map((v, i) => v - yLines[i].coord);
  console.log('X line gaps:', xg.map((g) => Math.round(g)).join(','));
  console.log('Y line gaps:', yg.map((g) => Math.round(g)).join(','));

  // how many markers sit on BOTH an x-line and a y-line (true grid columns)
  const onLine = (v, lines) => lines.some((l) => Math.abs(l.coord - v) <= 2.5);
  const onGrid = cols.filter((c) => onLine(c.cx, xLines) && onLine(c.cy, yLines));
  console.log('markers on a regular X-line AND Y-line:', onGrid.length, '/', cols.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
