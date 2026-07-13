import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractSegmentsFromOpList } from '../src/engine/pdf-floorplan.js';
import { deriveExteriorConsensus, polygonBounds } from '../src/engine/source-bound-footprint.js';

const EXPECTED_SOURCE_SHA256 = '552ca656e22f9a113aafd0eb9bc95cd70696676797078936514e611864293929';
const DEFAULT_SOURCE = 'Y:\\Shared\\HaloOps\\02-Active jobs\\03-Closed\\LDS Temple - Nashville TN\\1-Bid Documents\\GC - Bid Plans\\Nashville, TN Temple Renovation\\2023.02.01_-_NASHVILLE_TN_TEMPLE_-_Bid_Set.pdf';
const sourcePath = path.resolve(process.env.NASHVILLE_SOURCE_PDF || DEFAULT_SOURCE);
const sourceBytes = new Uint8Array(fs.readFileSync(sourcePath));
const sourcePdfSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
if (sourcePdfSha256 !== EXPECTED_SOURCE_SHA256) throw new Error(`Nashville source PDF hash mismatch: ${sourcePdfSha256}`);

const sheets = [
  { sheetId: 'A110', physicalPageNumber: 17, scaleText: '3/16 inch = 1 foot', scaleFtPerPoint: 2 / 27, minSegments: 100, minAspect: 1.2 },
  { sheetId: 'A121.1', physicalPageNumber: 27, scaleText: '1/4 inch = 1 foot', scaleFtPerPoint: 1 / 18, minSegments: 40, minAspect: 1 },
  { sheetId: 'A131.1', physicalPageNumber: 29, scaleText: '1/4 inch = 1 foot', scaleFtPerPoint: 1 / 18, minSegments: 20, minAspect: 1 },
];

const task = pdfjsLib.getDocument({ data: sourceBytes, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
const document = await task.promise;
const results = [];
for (const sheet of sheets) {
  const page = await document.getPage(sheet.physicalPageNumber);
  const text = (await page.getTextContent()).items.map((item) => item.str?.trim()).filter(Boolean);
  const { segments } = extractSegmentsFromOpList(await page.getOperatorList(), { scale: sheet.scaleFtPerPoint });
  const footprint = deriveExteriorConsensus(segments, {
    minSegments: sheet.minSegments,
    minAspect: sheet.minAspect,
    minOutlineFillRatio: 0.75,
    clusterTolerance: 0.04,
    bridgeGapsFt: 4,
    gridN: 360,
  });
  const planViewTitles = text.filter((value) => /^PLAN\s*-|PLAN\s*-\s*TOWER/i.test(value));
  const multiplePlanViewsUnsplit = sheet.sheetId === 'A131.1' && planViewTitles.length > 1;
  results.push({
    ...sheet,
    pageSizeFt: {
      width: page.getViewport({ scale: 1 }).width * sheet.scaleFtPerPoint,
      height: page.getViewport({ scale: 1 }).height * sheet.scaleFtPerPoint,
    },
    textMarkers: text.filter((value) => /PLAN|SCALE|LEVEL|UTILITY|TOWER/i.test(value)).slice(-20),
    segmentCount: segments.length,
    status: multiplePlanViewsUnsplit ? 'blocked' : footprint.status,
    areaSqft: footprint.areaSqft ?? null,
    bounds: footprint.bounds ?? null,
    consensus: footprint.consensus ?? [],
    candidateSummary: (footprint.candidates || []).map((candidate) => ({
      graphicsState: candidate.graphicsState,
      segmentCount: candidate.segmentCount,
      hullAreaSqft: candidate.hullAreaSqft,
      hullBounds: candidate.hullBounds,
      outlineAreaSqft: candidate.outlineAreaSqft,
      outlineBounds: candidate.outline?.length ? polygonBounds(candidate.outline) : null,
      outlineFillRatio: candidate.outlineFillRatio,
    })),
    issues: multiplePlanViewsUnsplit
      ? [...footprint.issues, { code: 'MULTIPLE_PLAN_VIEWS_UNSPLIT', message: 'Tower sheet contains multiple plan views; whole-page consensus cannot be accepted as one footprint.' }]
      : footprint.issues,
  });
}
await task.destroy();
console.log(JSON.stringify({ sourcePath, sourcePdfSha256, results }, null, 2));
