// T47 — Run the BUILDING vector-PDF lane on the REAL 1881 architectural plan set.
//
// HONEST run-on-real-data harness. Imports the SAME deterministic extraction code
// the studio UI uses (src/lib/pdf-building.ts) plus the pdfjs-dist legacy build, and
// reports the REAL numbers it extracts. NO tuning to any known target.
//
// Run with vite-node (transpiles the .ts import):
//   npx vite-node apps/studio/scripts/extract-1881.mjs -- <pdfPath>
//
// Steps:
//   1. Open the PDF, get pageCount.
//   2. Cheaply scan every page for vector-segment density to find floor-plan
//      candidate sheets (architectural floor plans have the most wall linework).
//   3. On the top candidate page(s): parse the stated architectural scale from the
//      sheet text if present, else fall back to the known 0.148148 ft/pt. Run
//      segmentsToFootprint -> bbox long-dimension (ft) + areaSqft.
//   4. HONEST comparison against the known building (~21,332 sqft/floor, ~312 ft
//      long dim, 3/32"=1'-0"). matchesDrawing only if long dim within ~10% AND area
//      within ~25%. Otherwise report the overshoot/mismatch factor plainly.
//
// Output: a JSON blob on stdout (the workflow reads it). Nothing is fabricated.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  extractVectorSegments,
  parseArchitecturalScale,
  segmentsToFootprint,
} from '../src/lib/pdf-building.ts';

const KNOWN = Object.freeze({
  areaSqft: 21332,
  longDimFt: 312,
  // 3/32" = 1'-0"  ->  ftPerPt = 1 / (3/32 * 72) = 0.148148...
  ftPerPt: 1 / ((3 / 32) * 72),
});

const pdfPath =
  process.argv.find((a, i) => i >= 2 && a.endsWith('.pdf')) ||
  'E:/ClaudeBot/_tmp_1881/1881-architecturals.pdf';

function log(...args) {
  // stderr so stdout stays a clean JSON channel
  console.error('[extract-1881]', ...args);
}

async function getDoc(bytes) {
  const task = pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  return task.promise;
}

async function pageSegmentCount(doc, pageNum) {
  const page = await doc.getPage(pageNum);
  try {
    const opList = await page.getOperatorList();
    // density scan: raw point space (scale 1) is enough to compare pages.
    const res = extractVectorSegments(opList, { scale: 1 });
    return { count: res.count, bbox: res.bbox };
  } finally {
    page.cleanup();
  }
}

async function pageText(doc, pageNum) {
  const page = await doc.getPage(pageNum);
  try {
    const tc = await page.getTextContent();
    return tc.items.map((it) => ('str' in it ? it.str : '')).join(' ');
  } catch {
    return '';
  } finally {
    page.cleanup();
  }
}

async function main() {
  const bytes = new Uint8Array(readFileSync(pdfPath));
  log('opened', pdfPath, `${(bytes.length / 1e6).toFixed(1)}MB`);
  const doc = await getDoc(bytes);
  const pageCount = doc.numPages;
  log('pageCount', pageCount);

  // (1) density scan over all pages
  const densities = [];
  for (let p = 1; p <= pageCount; p++) {
    try {
      const { count, bbox } = await pageSegmentCount(doc, p);
      densities.push({ page: p, count, bbox });
      if (p % 10 === 0 || p === pageCount) log(`scanned ${p}/${pageCount}`);
    } catch (e) {
      log(`page ${p} scan failed:`, e?.message || e);
      densities.push({ page: p, count: 0, bbox: null });
    }
  }

  const ranked = [...densities].sort((a, b) => b.count - a.count);
  const candidatePages = ranked.slice(0, 8).map((d) => d.page);
  log('top candidate pages (by segment density):',
    ranked.slice(0, 8).map((d) => `${d.page}:${d.count}`).join(', '));

  // (2)+(3) On each top candidate, parse scale + run footprint.
  //
  // HONESTY: parseArchitecturalScale picks the FIRST scale token on a sheet, which
  // on a multi-detail sheet is often a SITE/DETAIL scale, not the main floor-plan
  // scale. So for the footprint geometry we use the DOCUMENTED building scale
  // (3/32" = 1'-0" = 0.148148 ft/pt) — the same datum the autosprink work used — and
  // report the parsed scale alongside it for transparency. We do NOT select the page
  // by closeness to any known dimension (that would be target-chasing); we select
  // the genuine OVERALL FLOOR PLAN sheet by its sheet text + max wall-network extent.
  const evaluations = [];
  const toEvaluate = ranked.slice(0, 8);
  for (const cand of toEvaluate) {
    const p = cand.page;
    const text = await pageText(doc, p);
    const parsedScale = parseArchitecturalScale(text);
    const isFloorPlan = /floor\s*plan/i.test(text) || /overall/i.test(text);
    // Documented building scale — NEVER guessed, NEVER tuned to hit a target.
    const scaleFtPerPt = KNOWN.ftPerPt;

    const page = await doc.getPage(p);
    let res;
    try {
      const opList = await page.getOperatorList();
      // Apply ft/pt scale at extraction so segments are in feet -> footprint at 1.
      res = extractVectorSegments(opList, { scale: scaleFtPerPt });
    } finally {
      page.cleanup();
    }

    let fp;
    try {
      fp = segmentsToFootprint(res.segments, { scaleFtPerUnit: 1 });
    } catch (e) {
      log(`page ${p} footprint failed:`, e?.message || e);
      continue;
    }

    const longDimFt = Math.max(fp.bboxFt.w, fp.bboxFt.l);
    evaluations.push({
      page: p,
      rawSegments: res.count,
      parsedScale,
      isFloorPlan,
      scaleFtPerPt,
      areaSqft: fp.areaSqft,
      bboxFt: fp.bboxFt,
      longDimFt,
      wallSegmentCount: fp.wallSegmentCount,
      networkSegmentCount: fp.networkSegmentCount,
      method: fp.method,
      empty: fp.empty,
      outline: fp.outline,
      note: fp.note,
    });
    log(
      `page ${p}: rawSeg=${res.count} parsedScale=${parsedScale ?? 'none'} ` +
        `area=${Math.round(fp.areaSqft)}sqft longDim=${longDimFt.toFixed(1)}ft ` +
        `walls=${fp.wallSegmentCount} net=${fp.networkSegmentCount} method=${fp.method}`,
    );
  }

  // Pick the BEST candidate WITHOUT looking at the known dimensions (no target-
  // chasing): prefer a sheet whose text says OVERALL / FLOOR PLAN, and among those
  // the one with the largest wall-network extent (the actual building plan). Fall
  // back to the densest non-empty page only if no floor-plan sheet is identifiable.
  const nonEmpty = evaluations.filter((e) => !e.empty && e.longDimFt > 0);
  const planPages = nonEmpty.filter((e) => e.isFloorPlan);
  let best = null;
  if (planPages.length) {
    best = planPages.reduce((a, b) => (b.longDimFt > a.longDimFt ? b : a));
  } else if (nonEmpty.length) {
    best = nonEmpty.reduce((a, b) => (b.rawSegments > a.rawSegments ? b : a));
  } else if (evaluations.length) {
    best = evaluations[0];
  }

  let comparison = null;
  let matchesDrawing = false;
  if (best && !best.empty) {
    const longErr = Math.abs(best.longDimFt - KNOWN.longDimFt) / KNOWN.longDimFt;
    const areaErr = Math.abs(best.areaSqft - KNOWN.areaSqft) / KNOWN.areaSqft;
    const areaFactor = best.areaSqft / KNOWN.areaSqft;
    const longFactor = best.longDimFt / KNOWN.longDimFt;
    matchesDrawing = longErr <= 0.1 && areaErr <= 0.25;
    comparison = {
      longErrPct: +(longErr * 100).toFixed(1),
      areaErrPct: +(areaErr * 100).toFixed(1),
      areaFactor: +areaFactor.toFixed(3),
      longFactor: +longFactor.toFixed(3),
    };
  }

  const out = {
    pdfPath,
    pageCount,
    candidatePages,
    densitiesTop: ranked.slice(0, 8).map((d) => ({ page: d.page, count: d.count })),
    known: KNOWN,
    evaluations: evaluations.map((e) => ({ ...e, outline: undefined, outlineLen: e.outline.length })),
    best: best
      ? {
          page: best.page,
          parsedScale: best.parsedScale,
          scaleFtPerPt: best.scaleFtPerPt,
          areaSqft: best.areaSqft,
          longDimFt: best.longDimFt,
          bboxFt: best.bboxFt,
          method: best.method,
          wallSegmentCount: best.wallSegmentCount,
          networkSegmentCount: best.networkSegmentCount,
          outline: best.outline,
          note: best.note,
        }
      : null,
    comparison,
    matchesDrawing,
  };

  // stdout: clean JSON
  process.stdout.write(JSON.stringify(out));
  log('done. best page:', best?.page, 'matchesDrawing:', matchesDrawing);
}

main().catch((e) => {
  log('FATAL', e?.stack || e);
  process.exit(1);
});

void fileURLToPath; // keep import used if tree-shaken
