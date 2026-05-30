import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { floorPlanFromPdf } from '../src/engine/pdf-floorplan.js';

// T28 — REAL vector-PDF smoke. Proves the extractor genuinely pulls building
// geometry out of the ACTUAL Bluebeam Revu plan set the user supplied for The
// Cooperative 1881 Apartments. The plan PDFs are untracked (large, local only),
// so this is SKIP-IF-ABSENT: a fresh clone / CI without the file still passes.
//
// HONESTY: the segments are REAL (the plan's own vector path ops); the `scale`
// here is an ARBITRARY positive number chosen only to exercise the points->feet
// mapping — it is NOT the drawing's true scale, so the bbox dimensions below are
// NOT real-world feet and NOT an accuracy/AHJ/PE claim. The point is solely that
// non-trivial vector geometry is extracted.
const REALPDF = 'C:/Users/dalla/Downloads/1-Bid Documents (1)/1-Bid Documents/GC - Bid Plans/1881 - Plumbing.pdf';
const HAVE_PDF = fs.existsSync(REALPDF);

const describeIf = HAVE_PDF ? describe : describe.skip;

describeIf('floorPlanFromPdf — real 1881 Plumbing Bluebeam PDF (page 0)', () => {
  test('extracts non-trivial vector geometry (>50 segments, positive bbox)', async () => {
    // Load the REAL pdfjs (legacy build) with a headless Node worker.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const require = createRequire(import.meta.url);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href;

    const data = new Uint8Array(fs.readFileSync(REALPDF));
    const result = await floorPlanFromPdf(data, {
      pageIndex: 0, // bound the parse to page 0 only
      scale: 1, // arbitrary positive ft/pt — exercises mapping, NOT the true scale
      hazard: 'ordinary',
      pdfjs,
    });

    // Real vector ops genuinely extracted.
    expect(result.segmentCount).toBeGreaterThan(50);
    expect(result.bbox.widthFt).toBeGreaterThan(0);
    expect(result.bbox.heightFt).toBeGreaterThan(0);
    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0].polygon).toHaveLength(4);
    expect(result.pageIndex).toBe(0);

    // Surface what was extracted in the test log for the evidence trail.
    // eslint-disable-next-line no-console
    console.log(
      `[real-pdf] 1881 Plumbing page 0: segmentCount=${result.segmentCount} ` +
      `bbox=${result.bbox.widthFt.toFixed(2)} x ${result.bbox.heightFt.toFixed(2)} (ft @ scale=1)`,
    );
  }, 120000);
});
