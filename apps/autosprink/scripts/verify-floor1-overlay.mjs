/**
 * verify-floor1-overlay.mjs — INDEPENDENT visual verifier for extracted FLOOR 1 (A-101 p8).
 *
 * Re-extracts the floor-1 LevelPlan with the production engine, renders the real sheet to a
 * grey raster, OVERLAYS the extracted walls (RED) + footprint (magenta) + grid (blue) on top,
 * writes out/halofire-plan/overlay-floor1-r1.png, then QUANTITATIVELY measures:
 *   (a) wall-to-ink alignment error in ft: along the longest extracted walls, sample points and
 *       find the nearest dark (ink) pixel in the base raster; convert px error -> ft.
 *   (b) parking/stairs/small-room counts from the LevelPlan.
 *   (c) scale derived from drawing + a measured grid spacing in ft.
 *   (d) footprint dimensions in ft.
 * Emits STRICT JSON to stdout (last line, prefixed RESULT_JSON:).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, Image } from '@napi-rs/canvas';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';
import { extractLevelPlanFromPdf } from '../src/engine/plan-extract.js';

const ARCH = path.resolve(process.cwd(), 'plans/cooperative-1881/1881-architecturals.pdf');
const OUT_DIR = path.resolve(process.cwd(), '../../out/halofire-plan');
const OVERLAY = path.join(OUT_DIR, 'overlay-floor1-r1.png');
fs.mkdirSync(OUT_DIR, { recursive: true });

const TARGET_PX = 2000;

(async () => {
  // 1) Render the real sheet (white base) at known px/pt.
  //    NOTE: a PNG round-trip through @napi-rs/canvas Image decodes to all-black on this build,
  //    so we draw geometry DIRECTLY onto the rendered canvas (which holds the correct white
  //    sheet pixels) and read ink from THAT canvas — never from a re-decoded PNG buffer.
  const rendered = await renderSheetToCanvas(pdfjsLib, { url: ARCH, page: 8, targetPx: TARGET_PX });
  const pxPerPt = rendered.widthPx / rendered.widthPt;
  const W = rendered.widthPx, H = rendered.heightPx;

  // 2) Extract the LevelPlan (same engine the builder consumes).
  const data = new Uint8Array(fs.readFileSync(ARCH));
  const task = pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const doc = await task.promise;
  const pdfPage = await doc.getPage(8);
  const plan = await extractLevelPlanFromPdf(pdfPage, {});
  try { await task.destroy(); } catch { /* noop */ }

  const s = plan.scaleFtPerUnit;            // ft per PDF pt
  const ftToPx = (xFt, yFt) => [ (xFt / s) * pxPerPt, H - (yFt / s) * pxPerPt ];

  // 3) Read base raster pixels for ink-proximity alignment scoring — directly from the rendered
  //    canvas (correct white sheet + black ink), NOT a re-decoded PNG.
  const px = rendered.canvas.getContext('2d').getImageData(0, 0, W, H).data; // RGBA
  const isInk = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = (y * W + x) * 4;
    // luminance; "ink" = noticeably darker than the light-grey sheet background.
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    return lum < 140;
  };
  // nearest ink within radius R (px) using expanding ring search; returns dist px or null.
  const nearestInkPx = (x0, y0, R) => {
    x0 = Math.round(x0); y0 = Math.round(y0);
    if (isInk(x0, y0)) return 0;
    for (let r = 1; r <= R; r++) {
      for (let dx = -r; dx <= r; dx++) {
        if (isInk(x0 + dx, y0 - r) || isInk(x0 + dx, y0 + r)) return r;
      }
      for (let dy = -r + 1; dy <= r - 1; dy++) {
        if (isInk(x0 - r, y0 + dy) || isInk(x0 + r, y0 + dy)) return r;
      }
    }
    return null;
  };

  // 4) Compose the overlay directly onto the rendered (white-sheet) canvas: draw RED walls +
  //    magenta footprint + blue grid over the actual sheet.
  const canvas = rendered.canvas;
  const ctx = canvas.getContext('2d');

  // grid datum lines (blue dashed)
  ctx.strokeStyle = 'rgba(40,120,255,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
  for (const xg of plan.grid.xs) { const [pxX] = ftToPx(xg, 0); ctx.beginPath(); ctx.moveTo(pxX, 0); ctx.lineTo(pxX, H); ctx.stroke(); }
  for (const yg of plan.grid.ys) { const [, pxY] = ftToPx(0, yg); ctx.beginPath(); ctx.moveTo(0, pxY); ctx.lineTo(W, pxY); ctx.stroke(); }
  ctx.setLineDash([]);

  // walls (RED) — and collect alignment samples along the longest walls.
  ctx.strokeStyle = 'rgba(255,0,0,0.85)'; ctx.lineWidth = 1.4;
  const walls = plan.walls.map((w) => {
    const lenFt = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    return { ...w, lenFt };
  }).sort((a, b) => b.lenFt - a.lenFt);
  for (const w of walls) {
    const [ax, ay] = ftToPx(w.a[0], w.a[1]); const [bx, by] = ftToPx(w.b[0], w.b[1]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }

  // footprint (magenta, bold)
  if (Array.isArray(plan.footprintFt) && plan.footprintFt.length >= 2) {
    ctx.strokeStyle = 'rgba(255,0,200,0.95)'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    plan.footprintFt.forEach(([x, y], i) => { const [pX, pY] = ftToPx(x, y); if (i === 0) ctx.moveTo(pX, pY); else ctx.lineTo(pX, pY); });
    ctx.closePath(); ctx.stroke();
  }

  // legend
  ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(8, 8, 470, 92);
  ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif';
  ctx.fillText(`OVERLAY VERIFY (red=walls, magenta=footprint, blue=grid) — ${plan.scaleText}`, 14, 28);
  ctx.fillText(`footprint ${plan.footprintBboxFt.widthFt.toFixed(1)} x ${plan.footprintBboxFt.heightFt.toFixed(1)} ft`, 14, 48);
  ctx.fillText(`walls ${plan.counts.wallSegments}  rooms ${plan.counts.rooms}  stairs ${plan.counts.stairs}  grid ${plan.counts.gridCols}x${plan.counts.gridRows}`, 14, 68);
  ctx.fillText(`scaleSource ${plan.scaleSource}`, 14, 88);

  const overlayBuf = canvas.encodeSync ? canvas.encodeSync('png') : canvas.toBuffer('image/png');
  fs.writeFileSync(OVERLAY, overlayBuf);

  // 5) ALIGNMENT MEASURE: sample points along the longest N walls; nearest ink within 18px.
  const R = 18;
  const sampleErrs = [];
  const topWalls = walls.filter((w) => w.lenFt > 8).slice(0, 60);
  for (const w of topWalls) {
    const [ax, ay] = ftToPx(w.a[0], w.a[1]); const [bx, by] = ftToPx(w.b[0], w.b[1]);
    const segPx = Math.hypot(bx - ax, by - ay);
    const n = Math.max(2, Math.min(20, Math.floor(segPx / 12)));
    for (let t = 0; t <= n; t++) {
      const f = t / n;
      const d = nearestInkPx(ax + (bx - ax) * f, ay + (by - ay) * f, R);
      if (d != null) sampleErrs.push(d);
    }
  }
  const ftPerPx = s / pxPerPt; // ft per px
  const errsFt = sampleErrs.map((d) => d * ftPerPx).sort((a, b) => a - b);
  const median = errsFt.length ? errsFt[Math.floor(errsFt.length / 2)] : null;
  const p90 = errsFt.length ? errsFt[Math.floor(errsFt.length * 0.9)] : null;
  const meanFt = errsFt.length ? errsFt.reduce((a, b) => a + b, 0) / errsFt.length : null;
  const hitRate = topWalls.length ? sampleErrs.length / topWalls.reduce((acc, w) => {
    const [ax, ay] = ftToPx(w.a[0], w.a[1]); const [bx, by] = ftToPx(w.b[0], w.b[1]);
    const segPx = Math.hypot(bx - ax, by - ay);
    return acc + (Math.max(2, Math.min(20, Math.floor(segPx / 12))) + 1);
  }, 0) : 0;

  // 6) GRID spacing measure: median spacing between adjacent column datums (ft).
  const colXs = [...plan.grid.xs].sort((a, b) => a - b);
  const colGaps = [];
  for (let i = 1; i < colXs.length; i++) colGaps.push(Math.abs(colXs[i] - colXs[i - 1]));
  colGaps.sort((a, b) => a - b);
  const medianColGapFt = colGaps.length ? colGaps[Math.floor(colGaps.length / 2)] : null;

  // counts
  const roomKinds = plan.rooms.reduce((acc, r) => { acc[r.kind] = (acc[r.kind] || 0) + 1; return acc; }, {});
  const smallRooms = plan.rooms.filter((r) => r.areaSqft != null && r.areaSqft < 600).length;

  const result = {
    overlayPng: OVERLAY,
    widthPx: W, heightPx: H, pxPerPt: round(pxPerPt),
    scaleText: plan.scaleText,
    scaleFtPerUnit: plan.scaleFtPerUnit,
    scaleSource: plan.scaleSource,
    footprintWidthFt: plan.footprintBboxFt.widthFt,
    footprintHeightFt: plan.footprintBboxFt.heightFt,
    counts: plan.counts,
    roomKinds,
    smallRooms,
    stairs: plan.counts.stairs,
    alignment: {
      samples: sampleErrs.length,
      hitRate: round(hitRate),
      medianFt: median != null ? round(median) : null,
      meanFt: meanFt != null ? round(meanFt) : null,
      p90Ft: p90 != null ? round(p90) : null,
      searchRadiusFt: round(R * ftPerPx),
      ftPerPx: round(ftPerPx),
    },
    gridColCount: plan.grid.xs.length,
    gridRowCount: plan.grid.ys.length,
    medianColGapFt: medianColGapFt != null ? round(medianColGapFt) : null,
  };
  console.log('RESULT_JSON:' + JSON.stringify(result));
})().catch((e) => { console.error('VERIFY_FAILED', e && e.stack ? e.stack : e); process.exit(1); });

function round(n) { return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4; }
