/**
 * measure-columns.mjs — REAL column extraction + VISIBLE OVERLAY on A-101 page 8.
 *
 * Wires the engine's detectColumnMarkers() against the actual Cooperative-1881 architectural
 * floor plan and proves it with a rendered overlay: faint plan ink + a colored ring on each
 * extracted column marker box (green = medium / amber = low confidence). This is the honest
 * structure-from-raster column path that REPLACES the grid-intersection heuristic — every ring
 * sits on a real marker box in the drawing.
 *
 * The set is VECTOR (CAD-exported): we rasterize from the stroke ops (extractSegmentsFromOpList),
 * NOT page.render() (which throws on an inline-image XObject in node-canvas). @napi-rs/canvas is
 * used ONLY to draw the overlay PNG — a measurement tool, not an app/deploy dependency.
 *
 * Usage: node scripts/measure-columns.mjs [--page 8] [--out DIR]
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractSegmentsFromOpList, parseArchitecturalScale } from '../src/engine/pdf-floorplan.js';
import { detectColumnMarkers } from '../src/engine/structure-from-plan.js';

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : dflt; };
const PAGE = Number(arg('--page', 8));
const OUT_DIR = arg('--out', path.resolve(process.cwd(), '../../out/raster-intake/raster-columns'));
const PDF = path.resolve(process.cwd(), 'plans/cooperative-1881/1881-architecturals.pdf');
const FT_PER_PT = 1 / ((3 / 32) * 72);
const PX_PER_FT = Number(arg('--pxPerFt', 4));

const segLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

export async function measureColumns({ page = PAGE, outDir = OUT_DIR, pxPerFt = PX_PER_FT } = {}) {
  const { DOMMatrix } = await import('canvas'); globalThis.DOMMatrix = DOMMatrix;
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!fs.existsSync(PDF)) throw new Error(`architectural PDF not found at ${PDF}`);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(PDF)), disableFontFace: true }).promise;
  const pg = await doc.getPage(page);
  const tc = await pg.getTextContent();
  const joined = (tc.items || []).map((it) => String(it.str || '')).join(' ');
  const fpu = parseArchitecturalScale(joined) || FT_PER_PT;
  const opList = await pg.getOperatorList();
  const { segments } = extractSegmentsFromOpList(opList, { scale: fpu });

  const res = detectColumnMarkers(segments, {});
  const cols = res.columns;
  const conf = cols.filter((c) => c.confidence === 'medium').length;
  const low = cols.length - conf;

  console.log('scale ft/pt:', fpu);
  console.log('segments:', segments.length, '| candidate boxes:', res.candidateBoxes, '| dropped table rows:', res.droppedTableRows);
  console.log('EXTRACTED COLUMNS:', cols.length, `(medium ${conf} / low ${low})`);
  console.log('median column size (ft):', res.medianSizeFt);
  console.log('grid: X-lines', res.xLines.length, 'Y-lines', res.yLines.length);
  if (cols.length) {
    const sizes = cols.map((c) => c.sizeFt).sort((a, b) => a - b);
    console.log('size range (ft):', sizes[0], '–', sizes[sizes.length - 1]);
    const bx = [Math.min(...cols.map((c) => c.x)), Math.max(...cols.map((c) => c.x))];
    const by = [Math.min(...cols.map((c) => c.y)), Math.max(...cols.map((c) => c.y))];
    console.log('column field span (ft):', Math.round(bx[1] - bx[0]), 'x', Math.round(by[1] - by[0]));
  }

  // ----- OVERLAY -----
  fs.mkdirSync(outDir, { recursive: true });
  const { createCanvas } = await import('@napi-rs/canvas');
  // bbox of all segments in feet
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of segments) { minX = Math.min(minX, s.x1, s.x2); minY = Math.min(minY, s.y1, s.y2); maxX = Math.max(maxX, s.x1, s.x2); maxY = Math.max(maxY, s.y1, s.y2); }
  const padFt = 4;
  const W = Math.ceil((maxX - minX + 2 * padFt) * pxPerFt);
  const H = Math.ceil((maxY - minY + 2 * padFt) * pxPerFt);
  const ftToPx = (x, y) => ({ px: (x - minX + padFt) * pxPerFt, py: H - (y - minY + padFt) * pxPerFt });
  const c = createCanvas(W, H); const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  // faint plan ink
  ctx.strokeStyle = 'rgba(40,40,40,0.16)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const s of segments) { if (segLen(s) > 60) continue; const a = ftToPx(s.x1, s.y1), b = ftToPx(s.x2, s.y2); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); }
  ctx.stroke();
  // grid datum lines (light blue)
  ctx.strokeStyle = 'rgba(40,120,255,0.35)'; ctx.lineWidth = 1;
  for (const x of res.xLines) { const a = ftToPx(x, minY), b = ftToPx(x, maxY); ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke(); }
  for (const y of res.yLines) { const a = ftToPx(minX, y), b = ftToPx(maxX, y); ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke(); }
  // column rings
  for (const col of cols) {
    const p = ftToPx(col.x, col.y);
    const r = Math.max(5, col.sizeFt * pxPerFt * 0.9);
    ctx.beginPath(); ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
    ctx.strokeStyle = col.confidence === 'medium' ? 'rgba(0,170,60,0.95)' : 'rgba(230,150,0,0.95)';
    ctx.lineWidth = 2; ctx.stroke();
  }
  const outPng = path.join(outDir, `columns-overlay-p${page}.png`);
  fs.writeFileSync(outPng, c.toBuffer('image/png'));
  console.log('wrote overlay:', outPng, `(${W}x${H})`);

  const report = {
    page, scaleFtPerPt: fpu, segments: segments.length,
    candidateBoxes: res.candidateBoxes, droppedTableRows: res.droppedTableRows,
    columns: cols.length, medium: conf, low,
    medianSizeFt: res.medianSizeFt, xLines: res.xLines.length, yLines: res.yLines.length,
    columnList: cols,
  };
  fs.writeFileSync(path.join(outDir, `columns-report-p${page}.json`), JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('measure-columns.mjs')) {
  measureColumns().catch((e) => { console.error(e); process.exit(1); });
}
