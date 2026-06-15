/**
 * measure-openings.mjs — REAL doors / windows / cased-openings extraction + a VISIBLE overlay on
 * the actual Cooperative-1881 architectural set (A-101, page 8).
 *
 * This is the OPENINGS counterpart to measure-raster-wall-recall.mjs. The chunk: detect DOORS
 * (swing arcs), WINDOWS (mullion bundles), and cased OPENINGS (collinear wall gaps), host each to
 * a wall, count them, report a sensible distribution, and HONESTLY separate confident detections
 * from heuristic guesses.
 *
 * Pipeline:
 *   1) Load the architectural PDF, page 8 (A-101 OVERALL FLOOR PLAN, scale 3/32" = 1').
 *   2) extractArcsFromOpList -> swing arcs (FEET); extractSegmentsFromOpList -> wall-band segments.
 *   3) detectDoors(arcs, walls) / detectWindows(wallSegs, doors) / detectOpenings(walls, doors).
 *   4) Rasterize the wall ink faintly + paint each detection (confident vs suspect) and write a
 *      PNG overlay so you can SEE where the doors/windows/openings landed. Print ACTUAL counts.
 *
 * Native `canvas` is used ONLY to write the overlay PNG (measurement tool, not an app dep).
 *
 * Usage: node scripts/measure-openings.mjs [--page N] [--pxPerFt N] [--out DIR]
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractSegmentsFromOpList, selectWallLayer } from '../src/engine/pdf-floorplan.js';
import { extractArcsFromOpList, detectDoors, detectWindows, detectOpenings } from '../src/engine/plan-doors.js';

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : dflt; };
const PAGE = Number(arg('--page', 8));
const PX_PER_FT = Number(arg('--pxPerFt', 4));
const OUT_DIR = arg('--out', 'E:/ClaudeBot/out/raster-intake/raster-openings');
const PDF = path.resolve(process.cwd(), 'plans/cooperative-1881/1881-architecturals.pdf');
const FT_PER_PT = 1 / ((3 / 32) * 72);   // 3/32" = 1'-0" on A-101

export async function measureOpenings({ page = PAGE, pxPerFt = PX_PER_FT, outDir = OUT_DIR } = {}) {
  const { createCanvas, DOMMatrix } = await import('canvas');
  globalThis.DOMMatrix = DOMMatrix;
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  if (!fs.existsSync(PDF)) throw new Error(`architectural PDF not found at ${PDF}`);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(PDF)), disableFontFace: true }).promise;
  const pdfPage = await doc.getPage(page);
  const opList = await pdfPage.getOperatorList();

  const { segments } = extractSegmentsFromOpList(opList, { scale: FT_PER_PT });
  const { arcs } = extractArcsFromOpList(opList, { scale: FT_PER_PT });

  // wall band (heavier-than-baseline, partition-inclusive) — doors host on these, windows mullions live here.
  const wl = selectWallLayer(segments, { partitionInclusive: true });
  const wallSegs = wl.wallSegments.map((s) => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }));

  // SINGLE-BAND major walls (perimeter + primary partitions) for the cased-opening signal: the dense
  // partition-inclusive band produces O(n^2) spurious collinear "gaps" at every column bay, so cased
  // openings are detected on the major-wall band only (mirrors the committed augment path). Doors host
  // on the full band (the real door leaf can sit on a thin partition), windows live in the full band.
  const wlMajor = selectWallLayer(segments, {});
  const majorWalls = wlMajor.wallSegments.map((s) => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }));

  const { doors, confidentCount: doorConfident, suspectCount: doorSuspect } = detectDoors(arcs, wallSegs, {});
  const { windows, confidentCount: winConfident, suspectCount: winSuspect } = detectWindows(wallSegs, doors, {});
  const { openings } = detectOpenings(majorWalls, doors, {});

  // ---- overlay PNG: faint wall ink + colored detection markers ----
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of wallSegs) { minX = Math.min(minX, s.x1, s.x2); minY = Math.min(minY, s.y1, s.y2); maxX = Math.max(maxX, s.x1, s.x2); maxY = Math.max(maxY, s.y1, s.y2); }
  const PAD = 4;
  const W = Math.max(1, Math.ceil((maxX - minX) * pxPerFt) + PAD * 2);
  const H = Math.max(1, Math.ceil((maxY - minY) * pxPerFt) + PAD * 2);
  const toPx = (x, y) => [Math.round((x - minX) * pxPerFt) + PAD, H - 1 - (Math.round((y - minY) * pxPerFt) + PAD)];

  fs.mkdirSync(outDir, { recursive: true });
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f8f8f8'; ctx.fillRect(0, 0, W, H);
  // faint wall ink
  ctx.strokeStyle = 'rgba(150,160,180,0.5)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const s of wallSegs) { const [ax, ay] = toPx(s.x1, s.y1); const [bx, by] = toPx(s.x2, s.y2); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
  ctx.stroke();
  const ring = (x, y, r, color, fill) => { const [px, py] = toPx(x, y); ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); if (fill) { ctx.fillStyle = color; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1; } else { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); } };
  // openings (blue squares)
  for (const o of openings) { const [px, py] = toPx(o.position[0], o.position[1]); ctx.fillStyle = '#2a7fff'; ctx.globalAlpha = 0.8; ctx.fillRect(px - 3, py - 3, 6, 6); ctx.globalAlpha = 1; }
  // windows (cyan rings: medium=filled, low=outline)
  for (const w of windows) ring(w.position[0], w.position[1], 4, '#00c8d4', w.confidence === 'medium');
  // doors (amber=confident filled, grey=suspect outline)
  for (const d of doors) ring(d.position[0], d.position[1], 4, d.suspect ? '#9aa0aa' : '#ffb454', !d.suspect);
  const overlayPath = path.join(outDir, `openings-overlay-p${page}.png`);
  fs.writeFileSync(overlayPath, canvas.toBuffer('image/png'));

  // distribution buckets
  const widthBuckets = (items, step) => {
    const b = {}; for (const it of items) { const k = (Math.floor((it.width || 0) / step) * step).toFixed(1); b[k] = (b[k] || 0) + 1; } return b;
  };
  const onWall = doors.filter((d) => d.onWall).length;

  const report = {
    page, pxPerFt, ftPerPt: FT_PER_PT, raster: { W, H },
    arcsTotal: arcs.length, wallBandSegs: wallSegs.length, majorWallSegs: majorWalls.length,
    doors: {
      total: doors.length, confident: doorConfident, suspect: doorSuspect, onWall,
      widthBucketsFt: widthBuckets(doors, 0.5),
      definition: "confident = hosts on a wall AND real-door leaf width (2.3-4.0 ft); suspect = off-wall OR sub/over-door radius (small swing glyphs / mirrored half-leaves).",
    },
    windows: {
      total: windows.length, confident: winConfident, suspect: winSuspect,
      widthBucketsFt: widthBuckets(windows, 1),
      definition: "mullion bundle: >=3 short parallel sill/glazing lines packed in a wall-thickness band, no swing arc on it.",
    },
    openings: {
      total: openings.length,
      widthsFt: openings.map((o) => Math.round(o.width * 10) / 10).sort((a, b) => a - b),
      definition: "cased opening / passage: a 2.5-8 ft gap between two collinear substantial wall ends with no door arc.",
    },
    overlay: path.relative(process.cwd(), overlayPath).replace(/\\/g, '/'),
    provenance: 'Doors/windows/openings EXTRACTED from the A-101 vector PDF (bezier swing arcs + parallel mullion bundles + collinear wall gaps), CTM-mapped to feet via the printed 3/32"=1\' scale. Best-effort, deterministic, hosted-to-wall. NOT a verified door/window/hardware schedule; NOT AHJ/egress parity. needs-verification.',
    needsVerification: true,
  };
  pdfPage.cleanup();
  try { await doc.destroy?.(); } catch { /* torn down */ }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url === pathToHref(process.argv[1])) {
  measureOpenings()
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => { console.error('OPENINGS MEASURE FAILED', e); process.exit(1); });
}
function pathToHref(p) { try { return new URL(`file://${p}`).href; } catch { return ''; } }
