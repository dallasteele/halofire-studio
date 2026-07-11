/**
 * augment-columns-fixtures.mjs — extract REAL columns from the Cooperative-1881 architectural
 * floor plan (A-101, page 8) via detectColumnMarkers() and write them as first-class
 * plan.columns into the L1 level of src/data/plan-levels.cooperative-1881.json.
 *
 * This makes building-from-plan use columnSource:'extracted' (real marker boxes) instead of
 * the grid-intersection SYNTH heuristic. Each column carries x/y (ft, plan frame), sizeFt,
 * source:'marker-extraction', confidence, and needsVerification. Honest: NOT AHJ/PE/fab-ready.
 *
 * Usage: node scripts/augment-columns-fixtures.mjs [--page 8] [--write]
 *   (omit --write to dry-run / print the count only)
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractSegmentsFromOpList, parseArchitecturalScale } from '../src/engine/pdf-floorplan.js';
import { detectColumnMarkers } from '../src/engine/structure-from-plan.js';

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : dflt; };
const PAGE = Number(arg('--page', 8));
const WRITE = process.argv.includes('--write');
const PDF = path.resolve(process.cwd(), 'plans/cooperative-1881/1881-architecturals.pdf');
const DATA = path.resolve(process.cwd(), 'src/data/plan-levels.cooperative-1881.json');
const FT_PER_PT = 1 / ((3 / 32) * 72);

async function main() {
  const { DOMMatrix } = await import('canvas'); globalThis.DOMMatrix = DOMMatrix;
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!fs.existsSync(PDF)) throw new Error(`architectural PDF not found at ${PDF}`);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(PDF)), disableFontFace: true }).promise;
  const pg = await doc.getPage(PAGE);
  const tc = await pg.getTextContent();
  const fpu = parseArchitecturalScale((tc.items || []).map((it) => String(it.str || '')).join(' ')) || FT_PER_PT;
  const { segments } = extractSegmentsFromOpList(await pg.getOperatorList(), { scale: fpu });
  const res = detectColumnMarkers(segments, {});

  const cols = res.columns.map((c) => ({
    x: c.x, y: c.y, sizeFt: c.sizeFt, w: c.w, h: c.h,
    gridLabel: c.gridLabel, source: c.source, confidence: c.confidence,
    markerSegs: c.markerSegs, needsVerification: true,
  }));
  const medium = cols.filter((c) => c.confidence === 'medium').length;
  console.log(`extracted ${cols.length} columns (medium ${medium} / low ${cols.length - medium}), median size ${res.medianSizeFt}ft, grid ${res.xLines.length}x${res.yLines.length}`);

  if (!WRITE) { console.log('(dry run — pass --write to bake into the data JSON)'); return; }

  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const L1 = data.levels.find((l) => l.level === 'L1' || l.level === 1 || l.level === '1') || data.levels[0];
  if (!L1 || !L1.plan) throw new Error('L1.plan not found in data JSON');
  L1.plan.columns = cols;
  L1.plan.columnSource = 'marker-extraction';
  L1.plan.columnExtraction = {
    method: 'detectColumnMarkers (compact ortho marker boxes on a regular 2-D grid; A-101 p8)',
    count: cols.length, medium, low: cols.length - medium,
    medianSizeFt: res.medianSizeFt, candidateBoxes: res.candidateBoxes,
    droppedTableRows: res.droppedTableRows, gridXLines: res.xLines.length, gridYLines: res.yLines.length,
    provenance: 'EXTRACTED real column marker boxes from the architectural floor plan — NOT synthesized at grid crossings. needs-verification; NOT AHJ/PE/fabrication-ready.',
  };
  if (!L1.plan.counts) L1.plan.counts = {};
  L1.plan.counts.columns = cols.length;
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2));
  console.log('WROTE plan.columns + columnSource=marker-extraction into', DATA);
}
main().catch((e) => { console.error(e); process.exit(1); });
