/**
 * gen-plan-levels.mjs — run the plan-extract pipeline over A-101..A-108 and write the
 * structured per-level data file src/data/plan-levels.cooperative-1881.json.
 *
 * Each LevelPlan carries its OWN derived scale (read from that sheet's printed notation) and
 * an elevation. Elevations are ESTIMATED uniform floor-to-floor (the same honest convention as
 * plan-manifest.js ESTIMATED_FLOOR_TO_FLOOR_FT) and FLAGGED — no structural datum was machine-
 * verified. Structural sheets are noted for later beam extraction.
 *
 * Usage: node scripts/gen-plan-levels.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractLevelPlanFromPdf, extractStackedFloorPlanFromPdf } from '../src/engine/plan-extract.js';

// Sheets known to carry TWO STACKED plan views (a building broken at a match line into an upper +
// lower view on one sheet). A-101 (page 8) is the canonical case. For these, extract BOTH wings
// and MERGE; for the rest, the single-region extractor is correct. (A-102..A-108 are single-view.)
const STACKED_PAGES = new Set([8]); // A-101 first floor — both wings stacked on the sheet.

const ARCH = path.resolve(process.cwd(), 'plans/cooperative-1881/1881-architecturals.pdf');
const OUT = path.resolve(process.cwd(), 'src/data/plan-levels.cooperative-1881.json');
const LEVEL_PAGES = [8, 11, 14, 17, 20, 23, 26, 29]; // A-101..A-108 overall floor plans
const ESTIMATED_FLOOR_TO_FLOOR_FT = 10.5; // matches plan-manifest.js (NOT machine-verified)
const LEVEL_WORDS = [null, 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH'];

// Structural sheets for later beam/column extraction (page labels from plan-manifest.js).
const STRUCTURAL_SHEETS = [
  { level: 1, sheet: 'S-110', page: 8, title: 'OVERALL FOOTING AND FOUNDATION PLAN' },
  { level: 2, sheet: 'S-120', page: 21, title: 'OVERALL SECOND FLOOR PLAN' },
  { level: 3, sheet: 'S-130', page: 30, title: 'OVERALL THIRD FLOOR PLAN' },
  { level: 4, sheet: 'S-140', page: 39, title: 'OVERALL FOURTH FLOOR PLAN' },
  { level: 5, sheet: 'S-150', page: 50, title: 'OVERALL FIFTH FLOOR PLAN' },
  { level: 6, sheet: 'S-160', page: 53, title: 'OVERALL SIXTH FLOOR PLAN' },
  { level: 7, sheet: 'S-170', page: 56, title: 'OVERALL SEVENTH FLOOR PLAN' },
  { level: 8, sheet: 'S-180', page: 59, title: 'OVERALL EIGHTH FLOOR PLAN' },
];

const data = new Uint8Array(fs.readFileSync(ARCH));

(async () => {
  const task = pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const doc = await task.promise;
  const levels = [];
  for (let i = 0; i < LEVEL_PAGES.length; i++) {
    const level = i + 1;
    const page = LEVEL_PAGES[i];
    const elevationFt = Math.round((level - 1) * ESTIMATED_FLOOR_TO_FLOOR_FT * 100) / 100;
    try {
      const pdfPage = await doc.getPage(page);
      // Stacked-view sheets (A-101) carry BOTH wings of an over-length floor: extract each wing
      // and MERGE into one complete-floor plan. Other sheets are single plan views.
      const plan = STACKED_PAGES.has(page)
        ? await extractStackedFloorPlanFromPdf(pdfPage, {})
        : await extractLevelPlanFromPdf(pdfPage, {});
      levels.push({
        level,
        name: `Level ${level} (${LEVEL_WORDS[level]} FLOOR)`,
        sheet: `A-10${level}`,
        page,
        elevationFt,
        elevationSource: 'ESTIMATED_FLOOR_TO_FLOOR_NOT_VERIFIED',
        structuralSheet: STRUCTURAL_SHEETS[i],
        plan,
      });
      console.log(`L${level} A-10${level} p${page}: ${plan.footprintBboxFt.widthFt.toFixed(1)}x${plan.footprintBboxFt.heightFt.toFixed(1)}ft rooms=${plan.counts.rooms} stairs=${plan.counts.stairs} scale="${plan.scaleText}"`);
    } catch (e) {
      levels.push({ level, sheet: `A-10${level}`, page, elevationFt, elevationSource: 'ESTIMATED_FLOOR_TO_FLOOR_NOT_VERIFIED', error: e.message });
      console.log(`L${level} p${page}: EXTRACT FAILED ${e.message}`);
    }
  }
  try { await task.destroy(); } catch { /* torn down */ }

  const out = {
    project: 'The Cooperative 1881 - Salt Lake City UT',
    bidId: '1881',
    units: 'ft',
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/gen-plan-levels.mjs (src/engine/plan-extract.js)',
    estimatedFloorToFloorFt: ESTIMATED_FLOOR_TO_FLOOR_FT,
    scaleNote: 'Each level scale is DERIVED from that sheet\'s printed SCALE notation (never hardcoded).',
    elevationNote: 'Elevations are ESTIMATED uniform floor-to-floor; NOT machine-verified against sections/S-sheets. needs-verification.',
    structuralSheetsNote: 'structuralSheet on each level is recorded for LATER beam/column extraction; not yet extracted.',
    needsVerification: true,
    provenance: 'extracted from real Bluebeam vector PDFs (1881-architecturals.pdf) — needs-verification; NOT AHJ/PE/AutoSprink parity',
    levels,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  const ok = levels.filter((l) => !l.error).length;
  console.log(`WROTE ${OUT} — ${ok}/${levels.length} levels extracted`);
})().catch((e) => { console.error('GEN FAILED', e); process.exit(1); });
