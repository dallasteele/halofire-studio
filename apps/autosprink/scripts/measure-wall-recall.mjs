/**
 * measure-wall-recall.mjs — HONEST wall-recall measurement for the W2 extraction-completeness
 * readout. Rasterizes the COMMITTED merged-frame wallsFull[] from the plan-levels data file and
 * measures what fraction of the A-101 (page 8) sheet WALL-INK it covers, then writes the figure
 * into level.plan.wallsFullMeta.{recallPct,recallMeasure} and emits a covered/missed heatmap.
 *
 * WHY "both candidate page bands": A-101 is a STACKED two-wing sheet. The merge OVERLAYS the upper
 * wing onto the lower by (dx,dy), so the stored wallsFull live in one merged frame while the sheet
 * ink occupies two distinct page bands. A stored wall is genuinely SHOWN to the user regardless of
 * which wing it reconstructs, so we stamp each wall in BOTH its candidate page positions (as-is for
 * the lower wing; inverse-translated by (dx,dy) for the upper) and credit ink it covers in either.
 * This is the honest "is this sheet wall-ink covered by SOME rendered wall" recall. It is LOWER than
 * a fresh per-wing re-derivation (~99%) because the stacked-view merge round-trip degrades the stored
 * set — we report the number the live Studio actually delivers, never the optimistic re-derivation.
 *
 * Wall-ink denominator = dark raster ink inside the medium-lineweight building bands (Y-histogram
 * locator) MINUS hatch-fill (local density > 55%), text glyph boxes, and the title block — so the
 * denominator is independent of the wall set being scored.
 *
 * `canvas` is required (native) and is intentionally NOT an app dependency; run this only when
 * (re)measuring recall, not in the app/deploy path.
 *
 * Usage: node scripts/measure-wall-recall.mjs [--strict] [--write] [--heatmap <path>]
 *   --write    persist recallPct + recallMeasure into the data file (default: dry-run, prints JSON)
 *   --heatmap  output path for the heatmap PNG (default: public/halofire-W2/recall-heatmap.png)
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const WRITE = process.argv.includes('--write');
const heatIdx = process.argv.indexOf('--heatmap');
const HEAT_OUT = heatIdx >= 0 ? process.argv[heatIdx + 1] : path.resolve(process.cwd(), 'public/halofire-W2/recall-heatmap.png');
const DATA = path.resolve(process.cwd(), 'src/data/plan-levels.cooperative-1881.json');
const PDF = path.resolve(process.cwd(), 'plans/cooperative-1881/1881-architecturals.pdf');
const FT = 1 / ((3 / 32) * 72);
const PX_PER_FT = 6;

export async function measureWallRecall({ strict = false, write = false, heatOut = HEAT_OUT } = {}) {
  const { createCanvas, DOMMatrix } = await import('canvas');
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  globalThis.DOMMatrix = DOMMatrix;
  const OPS = pdfjsLib.OPS;
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

  const dataObj = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const L1 = dataObj.levels.find((l) => l.level === 1);
  const plan = L1.plan;
  const reg = (plan.merged && plan.merged.registration) || { dx: 0, dy: 0 };
  const splitYFt = plan.stackedSplit ? plan.stackedSplit.splitYFt : 0;
  const wallsFull = plan.wallsFull || plan.walls;

  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(PDF)), disableFontFace: true }).promise;
  const page = await doc.getPage(L1.page || 8);
  const vpPt = page.getViewport({ scale: 1 });
  const Wpt = vpPt.width, Hpt = vpPt.height;
  const sc = PX_PER_FT * FT;
  const rvp = page.getViewport({ scale: sc });
  const Wp = Math.ceil(rvp.width), Hp = Math.ceil(rvp.height);
  const canvas = createCanvas(Wp, Hp);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, Wp, Hp);
  await page.render({ canvasContext: ctx, viewport: rvp }).promise;
  const img = ctx.getImageData(0, 0, Wp, Hp).data;
  const T = rvp.transform;
  const toPx = (x, y) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]];

  // segments (for the medium-lineweight band locator) in PDF points
  let ctm = [1, 0, 0, 1, 0, 0]; const st = []; let lw = null; const ls = []; const segs = [];
  const opList = await page.getOperatorList();
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i], a = opList.argsArray[i];
    if (fn === OPS.save) { st.push(ctm.slice()); ls.push(lw); }
    else if (fn === OPS.restore) { ctm = st.pop() || [1, 0, 0, 1, 0, 0]; lw = ls.length ? ls.pop() : null; }
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.setLineWidth) lw = a[0];
    else if (fn === OPS.constructPath) {
      const ops = a[0], c = a[1]; if (!Array.isArray(ops) || !Array.isArray(c)) continue;
      let ci = 0, px = 0, py = 0, sx = 0, sy = 0, h = false;
      const scl = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1; const e = lw == null ? 0 : lw * scl;
      const pu = (x1, y1, x2, y2) => segs.push({ x1, y1, x2, y2, lw: e });
      for (const op of ops) {
        if (op === OPS.moveTo) { const [x, y] = ap(ctm, c[ci], c[ci + 1]); ci += 2; px = x; py = y; sx = x; sy = y; h = true; }
        else if (op === OPS.lineTo) { const [x, y] = ap(ctm, c[ci], c[ci + 1]); ci += 2; if (h) pu(px, py, x, y); px = x; py = y; h = true; }
        else if (op === OPS.curveTo) { const [x, y] = ap(ctm, c[ci + 4], c[ci + 5]); ci += 6; if (h) pu(px, py, x, y); px = x; py = y; h = true; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { const [x, y] = ap(ctm, c[ci + 2], c[ci + 3]); ci += 4; if (h) pu(px, py, x, y); px = x; py = y; h = true; }
        else if (op === OPS.closePath) { if (h) pu(px, py, sx, sy); px = sx; py = sy; }
        else if (op === OPS.rectangle) { const x = c[ci], y = c[ci + 1], w = c[ci + 2], hh = c[ci + 3]; ci += 4; const cc = [ap(ctm, x, y), ap(ctm, x + w, y), ap(ctm, x + w, y + hh), ap(ctm, x, y + hh)]; for (let k = 0; k < 4; k++) { const A = cc[k], B = cc[(k + 1) % 4]; pu(A[0], A[1], B[0], B[1]); } }
      }
    }
  }
  const tc = await page.getTextContent();
  const glyphs = tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width || 0, h: it.height || Math.abs(it.transform[3]) || 6 }));

  const N = Wp * Hp; const dark = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const r = img[i * 4], g = img[i * 4 + 1], b = img[i * 4 + 2]; if (0.299 * r + 0.587 * g + 0.114 * b < 110) dark[i] = 1; }
  const titleCutPx = 0.78 * Wp; const NBy = 256; const yLen = new Float64Array(NBy); const titlePt = 0.78 * Wpt;
  for (const s of segs) { if ((s.lw ?? 0) < 0.25) continue; const mx = (s.x1 + s.x2) / 2; if (mx > titlePt) continue; const my = (s.y1 + s.y2) / 2; const b = Math.min(NBy - 1, Math.max(0, Math.floor(my / Hpt * NBy))); yLen[b] += Math.hypot(s.x2 - s.x1, s.y2 - s.y1); }
  const yPeak = Math.max(...yLen); const bandRow = new Uint8Array(NBy); for (let b = 0; b < NBy; b++) bandRow[b] = yLen[b] >= 0.02 * yPeak ? 1 : 0;
  const bandG = new Uint8Array(NBy); for (let b = 0; b < NBy; b++) { if (bandRow[b]) for (let k = -2; k <= 2; k++) { const j = b + k; if (j >= 0 && j < NBy) bandG[j] = 1; } }
  const inBandPx = (py) => { const yPt = (py - T[5]) / (T[3] || 1); const b = Math.min(NBy - 1, Math.max(0, Math.floor(yPt / Hpt * NBy))); return bandG[b]; };
  const ii = new Float64Array((Wp + 1) * (Hp + 1)); for (let y = 0; y < Hp; y++) { let row = 0; for (let x = 0; x < Wp; x++) { row += dark[y * Wp + x]; ii[(y + 1) * (Wp + 1) + (x + 1)] = ii[y * (Wp + 1) + (x + 1)] + row; } }
  const win = Math.max(3, Math.round(1.3 * PX_PER_FT)); const dense = (x, y) => { const x0 = Math.max(0, x - win), y0 = Math.max(0, y - win), x1 = Math.min(Wp, x + win + 1), y1 = Math.min(Hp, y + win + 1); const area = (x1 - x0) * (y1 - y0); const s = ii[y1 * (Wp + 1) + x1] - ii[y0 * (Wp + 1) + x1] - ii[y1 * (Wp + 1) + x0] + ii[y0 * (Wp + 1) + x0]; return s / area > 0.55; };
  const isText = new Uint8Array(N); for (const gl of glyphs) { const a = toPx(gl.x, gl.y), b = toPx(gl.x + gl.w, gl.y + gl.h); const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0])) - 1), x1 = Math.min(Wp - 1, Math.ceil(Math.max(a[0], b[0])) + 1), y0 = Math.max(0, Math.floor(Math.min(a[1], b[1])) - 1), y1 = Math.min(Hp - 1, Math.ceil(Math.max(a[1], b[1])) + 1); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) isText[y * Wp + x] = 1; }
  const inkWall = new Uint8Array(N); let inkN = 0;
  for (let i = 0; i < N; i++) { if (!dark[i]) continue; const x = i % Wp, y = (i - x) / Wp; if (x >= titleCutPx) continue; if (isText[i]) continue; if (!strict && !inBandPx(y)) continue; if (dense(x, y)) continue; inkWall[i] = 1; inkN++; }

  // stamp wallsFull in BOTH candidate page positions (lower as-is; upper inverse-translated)
  const wallMask = new Uint8Array(N);
  const stamp = (x1p, y1p, x2p, y2p) => { const dx = x2p - x1p, dy = y2p - y1p; const len = Math.hypot(dx, dy); const steps = Math.max(1, Math.ceil(len)); for (let t = 0; t <= steps; t++) { const f = t / steps; const x = Math.round(x1p + dx * f), y = Math.round(y1p + dy * f); if (x >= 0 && y >= 0 && x < Wp && y < Hp) wallMask[y * Wp + x] = 1; } };
  for (const w of wallsFull) {
    let a = toPx(w.a[0] / FT, w.a[1] / FT), b = toPx(w.b[0] / FT, w.b[1] / FT); stamp(a[0], a[1], b[0], b[1]);
    a = toPx((w.a[0] - reg.dx) / FT, (w.a[1] - reg.dy) / FT); b = toPx((w.b[0] - reg.dx) / FT, (w.b[1] - reg.dy) / FT); stamp(a[0], a[1], b[0], b[1]);
  }
  const rad = Math.max(1, Math.round(1.0 * PX_PER_FT)); const dil = new Uint8Array(N);
  for (let y = 0; y < Hp; y++) for (let x = 0; x < Wp; x++) { if (!wallMask[y * Wp + x]) continue; for (let yy = Math.max(0, y - rad); yy <= Math.min(Hp - 1, y + rad); yy++) for (let xx = Math.max(0, x - rad); xx <= Math.min(Wp - 1, x + rad); xx++) { if ((xx - x) ** 2 + (yy - y) ** 2 <= rad * rad) dil[yy * Wp + xx] = 1; } }
  let cov = 0, miss = 0; for (let i = 0; i < N; i++) { if (inkWall[i]) { if (dil[i]) cov++; else miss++; } }
  const recallPct = inkN ? Math.round(1000 * cov / inkN) / 10 : 0;

  // heatmap: covered green / missed red over a faint sheet
  const out = ctx.createImageData(Wp, Hp);
  for (let i = 0; i < N; i++) { const r = img[i * 4], g = img[i * 4 + 1], b = img[i * 4 + 2]; const lum = 0.299 * r + 0.587 * g + 0.114 * b; let R = 205 + lum * 0.18, G = 205 + lum * 0.18, B = 205 + lum * 0.18; if (inkWall[i]) { if (dil[i]) { R = 70; G = 175; B = 80; } else { R = 225; G = 30; B = 30; } } out.data[i * 4] = R; out.data[i * 4 + 1] = G; out.data[i * 4 + 2] = B; out.data[i * 4 + 3] = 255; }
  ctx.putImageData(out, 0, 0);
  fs.mkdirSync(path.dirname(heatOut), { recursive: true });
  fs.writeFileSync(heatOut, canvas.toBuffer('image/png'));

  const recallMeasure = {
    method: 'stored-wallsFull-vs-rasterized-A101-wall-ink (both candidate page bands credited)',
    wallInkPx: inkN, coveredPx: cov, missedPx: miss, strict,
    note: 'Honest recall of the COMMITTED merged-frame wallsFull[] as rendered, vs the rasterized A-101 (page 8) sheet wall-ink (dark ink in the medium-lineweight building bands minus hatch-fill, text glyphs, title block). The live Studio delivers this number from the stored data; a fresh per-wing re-derivation scores higher but the stacked-view merge round-trip degrades the stored set. Reported honestly per W2 doctrine — NOT weakened to pass. needs-verification.',
    heatmap: path.relative(process.cwd(), heatOut).replace(/\\/g, '/'),
  };

  if (write) {
    plan.wallsFullMeta = { ...(plan.wallsFullMeta || {}), recallPct, recallMeasure, needsVerification: true };
    fs.writeFileSync(DATA, JSON.stringify(dataObj));
  }
  try { await doc.destroy?.(); } catch { /* torn down */ }
  return { recallPct, wallsFull: wallsFull.length, ...recallMeasure, wrote: write };
}

// Direct invocation (not when imported).
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url === pathToHref(process.argv[1])) {
  measureWallRecall({ strict: STRICT, write: WRITE, heatOut: HEAT_OUT })
    .then((r) => { console.log(JSON.stringify(r, null, 2)); })
    .catch((e) => { console.error('MEASURE FAILED', e); process.exit(1); });
}
function pathToHref(p) { try { return new URL(`file://${p}`).href; } catch { return ''; } }
