/** Crop a high-DPI region around a band of extracted columns to eyeball that rings sit on
 * real marker boxes (not empty space). */
import fs from 'node:fs';
import path from 'node:path';
import { extractSegmentsFromOpList, parseArchitecturalScale } from '../src/engine/pdf-floorplan.js';
import { detectColumnMarkers } from '../src/engine/structure-from-plan.js';

const PDF = path.resolve(process.cwd(), 'plans/cooperative-1881/1881-architecturals.pdf');
const FT_PER_PT = 1 / ((3 / 32) * 72);
const OUT = path.resolve(process.cwd(), '../../out/raster-intake/raster-columns');
const segLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
// crop window in FEET (a busy column band in the bottom wing)
const X0 = 70, X1 = 145, Y0 = 95, Y1 = 130, PXFT = 14;

async function main() {
  const { DOMMatrix } = await import('canvas'); globalThis.DOMMatrix = DOMMatrix;
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(PDF)), disableFontFace: true }).promise;
  const pg = await doc.getPage(8);
  const tc = await pg.getTextContent();
  const fpu = parseArchitecturalScale((tc.items || []).map((it) => String(it.str || '')).join(' ')) || FT_PER_PT;
  const { segments } = extractSegmentsFromOpList(await pg.getOperatorList(), { scale: fpu });
  const res = detectColumnMarkers(segments, {});
  const { createCanvas } = await import('@napi-rs/canvas');
  const W = Math.ceil((X1 - X0) * PXFT), H = Math.ceil((Y1 - Y0) * PXFT);
  const f = (x, y) => ({ px: (x - X0) * PXFT, py: H - (y - Y0) * PXFT });
  const c = createCanvas(W, H); const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(20,20,20,0.55)'; ctx.lineWidth = 1; ctx.beginPath();
  for (const s of segments) { if (segLen(s) > 40) continue; const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2; if (mx < X0 - 3 || mx > X1 + 3 || my < Y0 - 3 || my > Y1 + 3) continue; const a = f(s.x1, s.y1), b = f(s.x2, s.y2); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); }
  ctx.stroke();
  for (const col of res.columns) {
    if (col.x < X0 || col.x > X1 || col.y < Y0 || col.y > Y1) continue;
    const p = f(col.x, col.y); const r = Math.max(8, col.sizeFt * PXFT * 0.8);
    ctx.beginPath(); ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
    ctx.strokeStyle = col.confidence === 'medium' ? 'rgba(0,170,60,0.95)' : 'rgba(230,150,0,0.95)'; ctx.lineWidth = 2.5; ctx.stroke();
  }
  const out = path.join(OUT, 'columns-crop-p8.png');
  fs.writeFileSync(out, c.toBuffer('image/png'));
  console.log('wrote', out, W + 'x' + H, 'cols in crop:', res.columns.filter((c) => c.x >= X0 && c.x <= X1 && c.y >= Y0 && c.y <= Y1).length);
}
main().catch((e) => { console.error(e); process.exit(1); });
