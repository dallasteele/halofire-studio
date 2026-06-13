/**
 * plan-verify-floor1-r2.mjs — VISUAL VERIFIER (round 2) for the extracted FLOOR 1 (A-101 p8).
 *
 * Proves the extracted floor-1 geometry actually matches the real A-101 sheet, not by markers
 * but by OVERLAYING the extracted walls (RED) over the grey sheet raster at the SAME
 * orientation/scale the extractor used, then QUANTITATIVELY measuring how far each sampled
 * extracted wall point sits from the sheet's own ink (nearest dark pixel within a search radius).
 *
 * Outputs: out/halofire-plan/overlay-floor1-r2.png  (extracted walls red over grey sheet)
 *          (alignment metrics printed + returned as JSON on stdout, tagged R2RESULT:)
 *
 * Mapping is IDENTICAL to plan-extract-smoke.mjs/drawOverlay: feet -> pdf-pt (÷ scaleFtPerUnit)
 * -> px (× pxPerPt), pdf y-up -> canvas y-down. No re-fit, no fudge.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';
import { extractLevelPlanFromPdf } from '../src/engine/plan-extract.js';

const ARCH = 'plans/cooperative-1881/1881-architecturals.pdf';
const PAGE = 8;
const OUT_DIR = path.resolve(process.cwd(), '../../out/halofire-plan');
fs.mkdirSync(OUT_DIR, { recursive: true });

function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pct(arr, p) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

(async () => {
  const url = path.resolve(process.cwd(), ARCH);

  // 1) Render the real sheet raster (grey/white sheet — the proven engine path).
  const rendered = await renderSheetToCanvas(pdfjsLib, { url, page: PAGE, targetPx: 2000 });
  const canvas = rendered.canvas;
  const W = canvas.width, H = canvas.height;
  const pxPerPt = rendered.widthPx / rendered.widthPt;

  // 2) Extract the LevelPlan (full geometry in feet; scale DERIVED from the sheet).
  const data = new Uint8Array(fs.readFileSync(url));
  const task = pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const doc = await task.promise;
  const pdfPage = await doc.getPage(PAGE);
  const plan = await extractLevelPlanFromPdf(pdfPage, {});
  try { await task.destroy(); } catch { /* torn down */ }

  const s = plan.scaleFtPerUnit;
  const ftToPx = (xFt, yFt) => [ (xFt / s) * pxPerPt, H - (yFt / s) * pxPerPt ];

  // 3) Snapshot the GREY sheet pixels BEFORE drawing overlay (for the ink-proximity metric).
  const ctx = canvas.getContext('2d');
  const sheet = ctx.getImageData(0, 0, W, H).data;
  const lumAt = (px, py) => {
    if (px < 0 || py < 0 || px >= W || py >= H) return 255;
    const i = (py * W + px) * 4;
    return 0.299 * sheet[i] + 0.587 * sheet[i + 1] + 0.114 * sheet[i + 2];
  };
  const INK = 140; // luminance below this = drawn ink (sheet lines are near-black on white)

  // 4) ALIGNMENT METRIC: sample points along each extracted WALL segment; for each, find the
  //    nearest sheet-ink pixel within a search radius; record the distance (px -> ft). A wall
  //    that sits ON the sheet's line has distance ~0. We also count "supported" samples (an ink
  //    pixel found within radius at all) vs "orphan" (the extracted line has no sheet ink near
  //    it — would indicate fabricated geometry).
  const SEARCH_R = Math.max(4, Math.round(2.0 / (s) * pxPerPt)); // ~2 ft search radius in px
  const ftPerPx = s / pxPerPt; // feet per pixel
  const errsFt = [];
  let supported = 0, orphan = 0, totalSamples = 0;
  const nearestInkDistPx = (px0, py0) => {
    if (lumAt(px0, py0) < INK) return 0;
    for (let r = 1; r <= SEARCH_R; r++) {
      // ring search
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (lumAt(px0 + dx, py0 + dy) < INK) return Math.hypot(dx, dy);
        }
      }
    }
    return Infinity;
  };
  // Sample every wall, ~1 sample per 3px along it (cap per wall to bound cost).
  for (const w of plan.walls) {
    const [ax, ay] = ftToPx(w.a[0], w.a[1]);
    const [bx, by] = ftToPx(w.b[0], w.b[1]);
    const lenPx = Math.hypot(bx - ax, by - ay);
    const n = Math.min(40, Math.max(1, Math.round(lenPx / 3)));
    for (let t = 0; t <= n; t++) {
      const f = t / n;
      const px = Math.round(ax + (bx - ax) * f), py = Math.round(ay + (by - ay) * f);
      totalSamples++;
      const d = nearestInkDistPx(px, py);
      if (Number.isFinite(d)) { supported++; errsFt.push(d * ftPerPx); }
      else orphan++;
    }
  }

  // 5) GRID spacing: measure the spacing between adjacent column datums (xs) in feet. A real
  //    structural bay on this building is ~ tens of feet; report the modal/median spacing.
  const xs = [...(plan.grid.xs || [])].sort((a, b) => a - b);
  const colSpacings = [];
  for (let i = 1; i < xs.length; i++) colSpacings.push(Math.abs(xs[i] - xs[i - 1]));
  const ys = [...(plan.grid.ys || [])].sort((a, b) => a - b);
  const rowSpacings = [];
  for (let i = 1; i < ys.length; i++) rowSpacings.push(Math.abs(ys[i] - ys[i - 1]));

  // 6) DRAW the overlay: grey sheet underneath, extracted WALLS in RED on top, plus footprint
  //    (magenta), stairs (red boxes), grid (blue dashed). Walls red per the task spec.
  // Dim the sheet to grey so red reads clearly.
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(0, 0, W, H);
  // Walls in RED.
  ctx.strokeStyle = 'rgba(225,30,30,0.95)';
  ctx.lineWidth = 1.4;
  for (const w of plan.walls) {
    const [ax, ay] = ftToPx(w.a[0], w.a[1]);
    const [bx, by] = ftToPx(w.b[0], w.b[1]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  // Footprint loop — bold magenta.
  if (plan.footprintFt && plan.footprintFt.length > 1) {
    ctx.strokeStyle = 'rgba(255,0,170,0.95)'; ctx.lineWidth = 3;
    ctx.beginPath();
    plan.footprintFt.forEach(([x, y], i) => { const [px, py] = ftToPx(x, y); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.closePath(); ctx.stroke();
  }
  // Stairs — red box + centroid + count tag.
  ctx.lineWidth = 2; ctx.font = 'bold 14px sans-serif';
  for (const st of plan.stairs) {
    const b = st.bbox;
    const [x0, y0] = ftToPx(b.minX, b.minY), [x1, y1] = ftToPx(b.maxX, b.maxY);
    ctx.strokeStyle = 'rgba(255,40,40,1)';
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    const cen = st.centroidFt || [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
    const [cx, cy] = ftToPx(cen[0], cen[1]);
    ctx.fillStyle = 'rgba(255,40,40,1)';
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#003'; ctx.fillText(`STAIR(${st.source})`, cx + 8, cy - 8);
  }
  // Grid datum lines — blue dashed.
  ctx.strokeStyle = 'rgba(20,90,220,0.5)'; ctx.setLineDash([7, 7]); ctx.lineWidth = 1;
  for (const x of xs) { const [px] = ftToPx(x, 0); ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke(); }
  for (const y of ys) { const [, py] = ftToPx(0, y); ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke(); }
  ctx.setLineDash([]);
  // Legend.
  ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(8, 8, 520, 132);
  ctx.fillStyle = '#fff'; ctx.font = '15px sans-serif';
  ctx.fillText(`OVERLAY R2 — extracted walls (RED) over A-101 sheet — ${plan.scaleText}`, 14, 30);
  ctx.fillText(`footprint ${plan.footprintBboxFt.widthFt.toFixed(1)} x ${plan.footprintBboxFt.heightFt.toFixed(1)} ft`, 14, 52);
  ctx.fillText(`walls ${plan.counts.wallSegments}  rooms ${plan.counts.rooms}  stairs ${plan.counts.stairs}`, 14, 74);
  ctx.fillText(`align: median ${median(errsFt).toFixed(2)} ft  p90 ${pct(errsFt, 90).toFixed(2)} ft  supported ${(100 * supported / Math.max(1, totalSamples)).toFixed(1)}%`, 14, 96);
  ctx.fillText(`col-spacing median ${median(colSpacings).toFixed(1)} ft  row-spacing median ${median(rowSpacings).toFixed(1)} ft`, 14, 118);

  const buf = canvas.encodeSync ? canvas.encodeSync('png') : canvas.toBuffer('image/png');
  const outPng = path.join(OUT_DIR, 'overlay-floor1-r2.png');
  fs.writeFileSync(outPng, buf);

  // Zoom crops straight from the LIVE canvas (no PNG redecode — that path returns blank on this
  // @napi-rs build). Re-render each crop region into a fresh 2x canvas via getImageData/putImageData.
  const { createCanvas } = await import('@napi-rs/canvas');
  const cropOut = (name, sx, sy, sw, sh) => {
    sx = Math.max(0, Math.min(W - 1, sx)); sy = Math.max(0, Math.min(H - 1, sy));
    sw = Math.min(sw, W - sx); sh = Math.min(sh, H - sy);
    const src = ctx.getImageData(sx, sy, sw, sh);
    const z = 2;
    const cc = createCanvas(sw * z, sh * z);
    const cctx = cc.getContext('2d');
    // nearest-neighbour upscale via a 1x temp then drawImage scale
    const tmp = createCanvas(sw, sh);
    tmp.getContext('2d').putImageData(src, 0, 0);
    cctx.imageSmoothingEnabled = false;
    cctx.drawImage(tmp, 0, 0, sw, sh, 0, 0, sw * z, sh * z);
    fs.writeFileSync(path.join(OUT_DIR, `r2z-${name}.png`), cc.encodeSync('png'));
  };
  // Tight crops centered on the three extracted stair centroids (px computed from their ft).
  for (let i = 0; i < plan.stairs.length; i++) {
    const st = plan.stairs[i];
    const cen = st.centroidFt || [(st.bbox.minX + st.bbox.maxX) / 2, (st.bbox.minY + st.bbox.maxY) / 2];
    const [cx, cy] = ftToPx(cen[0], cen[1]);
    cropOut(`stair${i + 1}`, Math.round(cx - 130), Math.round(cy - 110), 260, 220);
  }
  cropOut('lower-mid-walls', 560, 740, 620, 380);

  const result = {
    overlayPng: outPng,
    scaleText: plan.scaleText,
    scaleFtPerUnit: plan.scaleFtPerUnit,
    scaleSource: plan.scaleSource,
    footprintWidthFt: plan.footprintBboxFt.widthFt,
    footprintHeightFt: plan.footprintBboxFt.heightFt,
    counts: plan.counts,
    roomKinds: plan.roomKinds,
    stairCount: plan.stairs.length,
    stairSources: plan.stairs.map((x) => x.source),
    align: {
      searchRadiusPx: SEARCH_R,
      ftPerPx,
      totalSamples,
      supportedPct: 100 * supported / Math.max(1, totalSamples),
      orphanPct: 100 * orphan / Math.max(1, totalSamples),
      medianErrFt: median(errsFt),
      meanErrFt: errsFt.reduce((a, b) => a + b, 0) / Math.max(1, errsFt.length),
      p90ErrFt: pct(errsFt, 90),
    },
    grid: {
      cols: xs.length,
      rows: ys.length,
      colSpacingMedianFt: median(colSpacings),
      colSpacingMinFt: Math.min(...colSpacings),
      colSpacingMaxFt: Math.max(...colSpacings),
      rowSpacingMedianFt: median(rowSpacings),
    },
    renderPx: { W, H, pxPerPt, widthPt: rendered.widthPt, heightPt: rendered.heightPt },
  };
  console.log('R2RESULT:' + JSON.stringify(result));
})().catch((e) => { console.error('R2 VERIFY FAILED', e); process.exit(1); });
