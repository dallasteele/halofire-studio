/**
 * plan-extract-smoke.mjs — standalone node proof for the PLAN-COMPREHENSION pipeline.
 *
 * For FLOOR 1 (A-101 "OVERALL FIRST FLOOR PLAN", page 8 of the architecturals), and
 * optionally A-101..A-108:
 *   - extract a structured LevelPlan via src/engine/plan-extract.js (scale DERIVED from the
 *     sheet's printed notation, real CTM-mapped vector geometry, rooms/stairs/grid),
 *   - render the actual sheet to a raster (the proven renderSheetToCanvas), then OVERLAY the
 *     extracted geometry (footprint, walls, rooms, stairs, grid) on top — the honest visual
 *     verification (geometry over the real sheet, not markers),
 *   - emit numbers (footprint ft, room count, stair count, scaleText, scaleFtPerUnit) to JSON.
 *   - attempt SAM 3 (GX10 :9003 /text) reconciliation of ambiguous spaces; skip gracefully
 *     if unreachable and flag those spaces lower-confidence.
 *
 * Usage:
 *   node scripts/plan-extract-smoke.mjs            # floor 1 only (+ all-levels coverage pass)
 *   node scripts/plan-extract-smoke.mjs --all      # render overlays for A-101..A-108
 *
 * Outputs (repo-root relative): out/halofire-plan/floor1-extracted.png + .json,
 * and out/halofire-plan/levelN-extracted.png + plan-levels.cooperative-1881.json coverage.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';
import { extractLevelPlanFromPdf } from '../src/engine/plan-extract.js';

const ARCH = 'plans/cooperative-1881/1881-architecturals.pdf';
// A-101..A-108 overall floor plans at pages 8,11,...,29 (3-page stride; PDF page labels).
const LEVEL_PAGES = [8, 11, 14, 17, 20, 23, 26, 29];
const SAM_URL = process.env.HALOFIRE_SAM_URL || 'http://192.168.1.76:9003';
const OUT_DIR = path.resolve(process.cwd(), '../../out/halofire-plan'); // repo-root/out/halofire-plan
const renderAll = process.argv.includes('--all');

fs.mkdirSync(OUT_DIR, { recursive: true });

const KIND_FILL = {
  parking: 'rgba(91,107,122,0.30)', stair: 'rgba(255,107,74,0.55)', elevator: 'rgba(255,169,74,0.5)',
  mech: 'rgba(155,89,182,0.45)', elec: 'rgba(241,196,15,0.45)', ramp: 'rgba(127,140,141,0.4)',
  storage: 'rgba(74,107,91,0.4)', lobby: 'rgba(74,176,255,0.4)', corridor: 'rgba(58,74,90,0.4)',
  restroom: 'rgba(74,214,192,0.4)', unit: 'rgba(46,204,113,0.35)', unknown: 'rgba(68,80,106,0.28)',
};

/** Build a SAM-3 invoker hitting the real GX10 /text endpoint; fail-soft. */
function makeSamInvoker(baseRaster) {
  return async (_payload) => {
    // Probe status first; bail fast if down.
    let up = false;
    try {
      const st = await fetch(`${SAM_URL}/status`, { signal: AbortSignal.timeout(5000) });
      const j = await st.json();
      up = !!(j && j.ok && j.model_loaded);
    } catch { up = false; }
    if (!up) throw new Error('sam-status-unavailable');
    const image_b64 = baseRaster.toString('base64');
    // Ask SAM to find parking spaces (the dominant floor-1 space) as a comprehension probe.
    const res = await fetch(`${SAM_URL}/text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image_b64, prompt: 'parking stalls and stairwells', confidence_threshold: 0.3 }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`sam-text-http-${res.status}`);
    const data = await res.json();
    // Normalize to { spaces:[{kind, centroidFt}] } — but we DON'T have a pixel->ft map for SAM
    // masks here without the same crop, so we only surface that SAM RAN and how many masks it
    // found (honest: we do not fabricate centroid->room upgrades from an unaligned raster).
    const maskCount = Array.isArray(data.masks) ? data.masks.length
      : Array.isArray(data.detections) ? data.detections.length
      : Array.isArray(data.instances) ? data.instances.length
      : (data.mask_b64 ? 1 : 0);
    globalThis.__samMaskCount = maskCount;
    globalThis.__samKeys = Object.keys(data || {});
    // We surface that SAM RAN and how many masks it found. We do NOT fabricate centroid->room
    // upgrades from a sheet raster whose pixel->ft map is not aligned to the vector frame here
    // (honest: no unverified upgrades). spaces stays [] so reconcileWithSam reports the run.
    return { spaces: [], samRanMaskCount: maskCount };
  };
}

function drawOverlay(canvas, plan, bounds) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  // Map plan feet -> pixels. The base raster spans the WHOLE sheet (page bbox), and the
  // extracted geometry is in feet at the page-space scale, so plan-ft / scaleFtPerUnit = PDF pt,
  // and px = pt * (renderPx / pagePt). We instead map via the footprint bbox proportion of the
  // page: simplest honest mapping is feet -> pdf points (÷ scaleFtPerUnit) -> px (× pxPerPt).
  const pxPerPt = bounds.pxPerPt;
  const s = plan.scaleFtPerUnit;
  const ftToPx = (xFt, yFt) => {
    const xPt = xFt / s, yPt = yFt / s;
    // pdf y-up -> canvas y-down
    return [xPt * pxPerPt, H - yPt * pxPerPt];
  };
  const poly = (pts, stroke, fill) => {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const [px, py] = ftToPx(x, y); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  };
  // Rooms (filled by kind).
  for (const r of plan.rooms) poly(r.poly, 'rgba(20,30,45,0.5)', KIND_FILL[r.kind] || KIND_FILL.unknown);
  // Walls (thin cyan).
  ctx.strokeStyle = 'rgba(45,212,191,0.9)'; ctx.lineWidth = 1;
  for (const w of plan.walls) {
    const [ax, ay] = ftToPx(w.a[0], w.a[1]); const [bx, by] = ftToPx(w.b[0], w.b[1]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  // Footprint (bold magenta).
  poly(plan.footprintFt, 'rgba(255,0,170,0.95)', null);
  // Stairs (red outline + fill + centroid dot + evidence tag).
  ctx.font = 'bold 13px sans-serif';
  for (const st of plan.stairs) {
    poly(st.poly, 'rgba(255,40,40,1)', 'rgba(255,107,74,0.55)');
    const cen = st.centroidFt || [(st.bbox.minX + st.bbox.maxX) / 2, (st.bbox.minY + st.bbox.maxY) / 2];
    const [cx, cy] = ftToPx(cen[0], cen[1]);
    ctx.fillStyle = 'rgba(255,40,40,1)';
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(`STAIR (${st.source}${st.hatchSegs ? ', hatch ' + st.hatchSegs : ''})`, cx + 8, cy - 6);
  }
  // Grid datum lines.
  ctx.strokeStyle = 'rgba(74,176,255,0.55)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1;
  for (const x of plan.grid.xs) { const [px] = ftToPx(x, 0); ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke(); }
  for (const y of plan.grid.ys) { const [, py] = ftToPx(0, y); ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke(); }
  ctx.setLineDash([]);
  // Legend.
  const rk = plan.roomKinds || {};
  ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(8, 8, 430, 108);
  ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif';
  ctx.fillText(`EXTRACTED (needs-verification) — ${plan.scaleText}`, 14, 28);
  ctx.fillText(`footprint ${plan.footprintBboxFt.widthFt.toFixed(1)} x ${plan.footprintBboxFt.heightFt.toFixed(1)} ft  bboxArea ${Math.round(plan.footprintBboxAreaSqft)} sqft`, 14, 48);
  ctx.fillText(`walls ${plan.counts.wallSegments}  rooms ${plan.counts.rooms}  stairs ${plan.counts.stairs} (geom ${plan.counts.stairCoresGeometric}, label ${plan.counts.stairsLabelBased})`, 14, 68);
  ctx.fillText(`grid ${plan.counts.gridCols} cols x ${plan.counts.gridRows} rows`, 14, 88);
  ctx.fillText(`roomKinds: parking ${rk.parking || 0}  stair ${rk.stair || 0}  unknown ${rk.unknown || 0}`, 14, 108);
}

async function processLevel(level, page, samInvoker) {
  const url = path.resolve(process.cwd(), ARCH);
  // Base sheet raster (proven engine path).
  const rendered = await renderSheetToCanvas(pdfjsLib, { url, page, targetPx: 2000 });
  // Extract the LevelPlan (open the page directly for the extractor).
  const data = new Uint8Array(fs.readFileSync(url));
  const task = pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const doc = await task.promise;
  const pdfPage = await doc.getPage(page);
  const plan = await extractLevelPlanFromPdf(pdfPage, samInvoker ? { samInvoker } : {});
  try { await task.destroy(); } catch { /* already torn down */ }

  // OVERLAY COMPOSITING FIX (round-1 bug): @napi-rs/canvas Image.decode of an encodeSync('png')
  // buffer returns an ALL-BLACK bitmap on this build, so the previous path
  // (new Image(); img.src = baseBuf; drawImage(...) onto a fresh canvas) produced a black
  // underlay and a meaningless alignment metric. Draw the extracted geometry DIRECTLY onto the
  // already-rendered white-sheet canvas (rendered.canvas) — no PNG re-decode round-trip.
  const canvas = rendered.canvas;
  const pxPerPt = rendered.widthPx / rendered.widthPt;
  drawOverlay(canvas, plan, { pxPerPt });

  // AUTHORITATIVE underlay check: read luminance DIRECTLY from the live render-canvas (no
  // PNG encode/decode round-trip — the @napi-rs/canvas Image-redecode path returns all-black on
  // this build and would give a false negative). A correct sheet is predominantly light.
  const lumBuckets = [0, 0, 0, 0, 0];
  try {
    const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      lumBuckets[Math.min(4, Math.floor(l / 51))] += 1;
    }
  } catch { /* getImageData unavailable */ }
  const totalPx = canvas.width * canvas.height;
  const whiteFrac = totalPx ? lumBuckets[4] / totalPx : 0;

  const overlayBuf = canvas.encodeSync ? canvas.encodeSync('png') : canvas.toBuffer('image/png');
  const pngName = level === 1 ? 'floor1-extracted.png' : `level${level}-extracted.png`;
  fs.writeFileSync(path.join(OUT_DIR, pngName), overlayBuf);

  return { level, page, plan, png: path.join(OUT_DIR, pngName), widthPx: rendered.widthPx, heightPx: rendered.heightPx, lumBuckets, whiteFrac };
}

(async () => {
  const results = [];
  let samUsed = false, samReason = 'not-attempted';

  // FLOOR 1 first, with SAM attempt.
  let floor1Base = null;
  {
    const url = path.resolve(process.cwd(), ARCH);
    const rendered = await renderSheetToCanvas(pdfjsLib, { url, page: 8, targetPx: 2000 });
    floor1Base = rendered.canvas.encodeSync ? rendered.canvas.encodeSync('png') : rendered.canvas.toBuffer('image/png');
  }
  const samInvoker = makeSamInvoker(floor1Base);
  const f1 = await processLevel(1, 8, samInvoker);
  samUsed = !!f1.plan.samUsed;
  samReason = f1.plan.samReason || 'unknown';
  const samMaskCount = globalThis.__samMaskCount;
  if (samMaskCount != null) samReason = `${samReason} (sam-3 ran, masks=${samMaskCount}, keys=${(globalThis.__samKeys || []).join('|')})`;
  results.push(f1);
  console.log(`FLOOR 1: footprint ${f1.plan.footprintBboxFt.widthFt}x${f1.plan.footprintBboxFt.heightFt}ft area ${Math.round(f1.plan.footprintAreaSqft)}sqft rooms ${f1.plan.counts.rooms} stairs ${f1.plan.counts.stairs} scale "${f1.plan.scaleText}" (${f1.plan.scaleFtPerUnit}) samUsed=${samUsed} (${samReason})`);
  console.log(`FLOOR 1 OVERLAY: lumBuckets=${JSON.stringify(f1.lumBuckets)} whiteFrac=${f1.whiteFrac.toFixed(3)} -> ${f1.whiteFrac >= 0.3 ? 'PASS white sheet underlay (compositing fix verified)' : 'FAIL dark underlay'}`);
  console.log(`FLOOR 1 COMPREHENSION: stairCores=${f1.plan.counts.stairCoresGeometric} roomKinds=${JSON.stringify(f1.plan.roomKinds)} occupancyHint=${f1.plan.occupancyHint ? f1.plan.occupancyHint.kind : 'none'}`);

  if (renderAll) {
    for (let i = 1; i < LEVEL_PAGES.length; i++) {
      try {
        const r = await processLevel(i + 1, LEVEL_PAGES[i], null);
        results.push(r);
        console.log(`L${i + 1}: footprint ${r.plan.footprintBboxFt.widthFt}x${r.plan.footprintBboxFt.heightFt}ft rooms ${r.plan.counts.rooms} stairs ${r.plan.counts.stairs}`);
      } catch (e) {
        console.log(`L${i + 1}: extract FAILED ${e.message}`);
        results.push({ level: i + 1, page: LEVEL_PAGES[i], error: e.message });
      }
    }
  }

  // Emit floor-1 numbers JSON.
  const f1plan = f1.plan;
  const summary = {
    generatedAt: new Date().toISOString(),
    project: 'The Cooperative 1881 - Salt Lake City UT',
    sheet: 'A-101 OVERALL FIRST FLOOR PLAN (page 8)',
    scaleText: f1plan.scaleText,
    scaleFtPerUnit: f1plan.scaleFtPerUnit,
    scaleSource: f1plan.scaleSource,
    footprintFt: { widthFt: f1plan.footprintBboxFt.widthFt, heightFt: f1plan.footprintBboxFt.heightFt, enclosedAreaSqft: f1plan.footprintAreaSqft, bboxAreaSqft: f1plan.footprintBboxAreaSqft, enclosedAreaReliable: f1plan.footprintAreaReliable, method: f1plan.footprintMethod },
    counts: f1plan.counts,
    roomKinds: f1plan.roomKinds || f1plan.rooms.reduce((acc, r) => { acc[r.kind] = (acc[r.kind] || 0) + 1; return acc; }, {}),
    stairs: f1plan.stairs.map((s) => ({ bbox: s.bbox, centroidFt: s.centroidFt, source: s.source, evidence: s.evidence, hatchSegs: s.hatchSegs, dirTokens: s.dirTokens, confidence: s.confidence })),
    grid: { cols: f1plan.counts.gridCols, rows: f1plan.counts.gridRows, colLabels: f1plan.grid.labels.cols, rowLabels: f1plan.grid.labels.rows },
    occupancyHint: f1plan.occupancyHint,
    samUsed, samReason,
    provenance: f1plan.provenance,
    needsVerification: true,
    overlayPng: f1.png,
    coverage: results.map((r) => r.error
      ? { level: r.level, page: r.page, error: r.error }
      : { level: r.level, page: r.page, footprintWidthFt: r.plan.footprintBboxFt.widthFt, footprintHeightFt: r.plan.footprintBboxFt.heightFt, rooms: r.plan.counts.rooms, stairs: r.plan.counts.stairs, scaleText: r.plan.scaleText }),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'floor1-extracted.json'), JSON.stringify(summary, null, 2));
  console.log(`WROTE ${path.join(OUT_DIR, 'floor1-extracted.json')} and overlay PNG(s) in ${OUT_DIR}`);
})().catch((e) => { console.error('SMOKE FAILED', e); process.exit(1); });
