/**
 * probe-columns.mjs — DISCOVERY probe: what do column markers actually look like on the
 * Cooperative-1881 architectural floor plan (A-101, page 8)? We need REAL columns (filled
 * squares / HSS boxes / circles on the structural grid), not a grid-intersection heuristic.
 *
 * Strategy:
 *   1) Extract vector segments (CTM->feet) from page 8 (NOT page.render — crashes on inline img).
 *   2) Recover the real structural grid from the text bubbles (integer col datums + A..K rows).
 *   3) At every grid intersection, characterize the LOCAL short-segment marker cluster:
 *      count, bbox, axis-aligned-ness, closed-loopness. Print the distribution so we can pick
 *      an honest column-marker detector threshold.
 *   4) Independently, find ALL small dense short-segment clusters in the plan body (DBSCAN-ish)
 *      and report how many sit ON a grid intersection vs off-grid.
 *
 * Usage: node scripts/probe-columns.mjs [--page 8]
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractSegmentsFromOpList, parseArchitecturalScale } from '../src/engine/pdf-floorplan.js';

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : dflt; };
const PAGE = Number(arg('--page', 8));
const PDF = path.resolve(process.cwd(), 'plans/cooperative-1881/1881-architecturals.pdf');
const FT_PER_PT = 1 / ((3 / 32) * 72); // A-101 3/32"=1'

const segLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const segMid = (s) => [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2];
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function main() {
  const { DOMMatrix } = await import('canvas');
  globalThis.DOMMatrix = DOMMatrix;
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(PDF)), disableFontFace: true }).promise;
  const page = await doc.getPage(PAGE);

  const tc = await page.getTextContent();
  const rawItems = (tc.items || []).map((it) => ({ s: String(it.str || '').trim(), xPt: it.transform[4], yPt: it.transform[5] }));
  const joined = rawItems.map((i) => i.s).join(' ');
  const fpu = parseArchitecturalScale(joined) || FT_PER_PT;
  console.log('scale ft/pt:', fpu, '(printed-derived; A-101 nominal', FT_PER_PT, ')');

  const opList = await page.getOperatorList();
  const { segments } = extractSegmentsFromOpList(opList, { scale: fpu });
  console.log('segments:', segments.length);

  // --- text bubbles -> structural grid (integer cols + letter rows) ---
  const textFt = rawItems.filter((i) => i.s).map((i) => ({ s: i.s, xFt: i.xPt * fpu, yFt: i.yPt * fpu }));
  const colRe = /^\d{1,2}$/, rowRe = /^[A-Z](?:\.\d)?$/;
  const colB = [], rowB = [];
  for (const t of textFt) { if (colRe.test(t.s)) colB.push(t); else if (rowRe.test(t.s)) rowB.push(t); }
  // cluster bubble coords per label, pick densest cluster median
  const datums = (bubs, axis) => {
    const byL = new Map();
    for (const b of bubs) { const v = axis === 'x' ? b.xFt : b.yFt; let a = byL.get(b.s); if (!a) { a = []; byL.set(b.s, a); } a.push(v); }
    const out = [];
    for (const [label, vals] of byL) {
      const sorted = [...vals].sort((a, b) => a - b); const clusters = [];
      for (const v of sorted) { const last = clusters[clusters.length - 1]; if (last && Math.abs(v - last[last.length - 1]) <= 4) last.push(v); else clusters.push([v]); }
      clusters.sort((a, b) => b.length - a.length); const best = clusters[0];
      if (best && best.length >= 2) out.push({ label, coord: median(best) });
    }
    out.sort((a, b) => a.coord - b.coord);
    return out;
  };
  const colD = datums(colB, 'x'), rowD = datums(rowB, 'y');
  console.log('raw col datums:', colD.length, colD.map((d) => d.label + '@' + Math.round(d.coord)).join(' '));
  console.log('raw row datums:', rowD.length, rowD.map((d) => d.label + '@' + Math.round(d.coord)).join(' '));

  // regular-spacing filter: keep the longest run of near-uniform gaps (real grid bays ~15-35ft)
  const xs = colD.map((d) => d.coord), ys = rowD.map((d) => d.coord);
  const gapsX = xs.slice(1).map((v, i) => v - xs[i]); const gapsY = ys.slice(1).map((v, i) => v - ys[i]);
  console.log('col gaps (ft):', gapsX.map((g) => Math.round(g)).join(','));
  console.log('row gaps (ft):', gapsY.map((g) => Math.round(g)).join(','));

  // --- marker characterization at grid intersections ---
  const shortMax = 3.0; // ft — column marker linework is short
  const shorts = segments.filter((s) => segLen(s) <= shortMax);
  console.log('short segs (<=3ft):', shorts.length);
  // spatial bucket the short segs
  const cell = 1.0; const grid = new Map();
  const key = (x, y) => Math.round(x / cell) + ',' + Math.round(y / cell);
  for (const s of shorts) { const [mx, my] = segMid(s); const k = key(mx, my); let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(s); }
  const near = (gx, gy, rFt) => { const out = []; const c = Math.ceil(rFt / cell); const cx = Math.round(gx / cell), cy = Math.round(gy / cell); for (let dx = -c; dx <= c; dx++) for (let dy = -c; dy <= c; dy++) { const a = grid.get((cx + dx) + ',' + (cy + dy)); if (a) for (const s of a) { const [mx, my] = segMid(s); if (Math.hypot(mx - gx, my - gy) <= rFt) out.push(s); } } return out; };

  const R = 2.0;
  const hist = [];
  for (const cx of xs) for (const cy of ys) {
    const cl = near(cx, cy, R);
    if (cl.length >= 2) hist.push({ x: Math.round(cx), y: Math.round(cy), n: cl.length });
  }
  hist.sort((a, b) => b.n - a.n);
  const ns = hist.map((h) => h.n);
  console.log('\nGRID-INTERSECTION marker clusters (>=2 short segs within', R, 'ft):', hist.length, '/', xs.length * ys.length, 'intersections');
  console.log('  cluster-size distribution: min', Math.min(...ns), 'med', median(ns), 'max', Math.max(...ns));
  console.log('  top 15:', hist.slice(0, 15).map((h) => `(${h.x},${h.y}):${h.n}`).join(' '));
  for (const thr of [3, 4, 6, 8, 10]) console.log('  intersections with >=' + thr + ' segs:', ns.filter((n) => n >= thr).length);
}
main().catch((e) => { console.error(e); process.exit(1); });
