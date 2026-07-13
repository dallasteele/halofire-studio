import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildingOutlinePolygon, extractSegmentsFromOpList } from '../src/engine/pdf-floorplan.js';
import { extractGrid } from '../src/engine/plan-extract.js';
import { deriveExteriorConsensus, polygonBounds } from '../src/engine/source-bound-footprint.js';

const EXPECTED_SOURCE_SHA256 = '552ca656e22f9a113aafd0eb9bc95cd70696676797078936514e611864293929';
const DEFAULT_SOURCE = 'Y:\\Shared\\HaloOps\\02-Active jobs\\03-Closed\\LDS Temple - Nashville TN\\1-Bid Documents\\GC - Bid Plans\\Nashville, TN Temple Renovation\\2023.02.01_-_NASHVILLE_TN_TEMPLE_-_Bid_Set.pdf';
const EXPECTED_AS_BUILT_SHA256 = 'fa92c6ddbef4e1f25171e48a48e9c320e11121f0963d3931fa3f19baf7296614';
const DEFAULT_AS_BUILT = 'Y:\\Shared\\HaloOps\\02-Active jobs\\03-Closed\\LDS Temple - Nashville TN\\2-Internal Ops\\01-Design\\11-As-Built Set\\combinepdf (1).pdf';
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
  const textItems = (await page.getTextContent()).items
    .filter((item) => item.str?.trim())
    .map((item) => ({ s: item.str.trim(), xFt: item.transform[4] * sheet.scaleFtPerPoint, yFt: item.transform[5] * sheet.scaleFtPerPoint }));
  const text = textItems.map((item) => item.s);
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
  let controlledTrials = [];
  let cropGraphics = [];
  if (sheet.sheetId === 'A110') {
    const crop = { minX: 24, maxX: 190, minY: 24, maxY: 130 };
    const inCrop = (segment) => {
      const x = (segment.x1 + segment.x2) / 2; const y = (segment.y1 + segment.y2) / 2;
      return x >= crop.minX && x <= crop.maxX && y >= crop.minY && y <= crop.maxY;
    };
    const trials = [
      ['green-plus-black-cut-lines', (segment) => (segment.lineWidth === 2 && segment.strokeColor === '#007f00') || ([1, 10].includes(segment.lineWidth) && segment.strokeColor === '#000000'), 4],
      ['green-plus-black-cut-lines-bridge-8', (segment) => (segment.lineWidth === 2 && segment.strokeColor === '#007f00') || ([1, 10].includes(segment.lineWidth) && segment.strokeColor === '#000000'), 8],
      ['black-cut-lines', (segment) => [1, 10].includes(segment.lineWidth) && segment.strokeColor === '#000000', 8],
      ['filled-geometry', (segment) => segment.lineWidth == null && segment.strokeColor == null, 8],
      ['all-heavy-plan-geometry', (segment) => Number(segment.lineWidth) >= 1, 4],
    ];
    controlledTrials = trials.map(([id, predicate, bridgeGapsFt]) => {
      const members = segments.filter((segment) => inCrop(segment) && predicate(segment));
      const outline = buildingOutlinePolygon(members, { networkMode: 'all-wall-like', bridgeGapsFt, gridN: 420, minWallFt: 1 });
      const bounds = outline.polygon?.length ? polygonBounds(outline.polygon) : null;
      return { id, crop, bridgeGapsFt, segmentCount: members.length, areaSqft: outline.areaSqft, bounds, method: outline.method };
    });
    const groups = new Map();
    for (const segment of segments.filter(inCrop)) {
      const key = `${segment.lineWidth}|${segment.strokeColor}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(segment);
    }
    cropGraphics = [...groups.entries()].map(([graphicsState, members]) => ({
      graphicsState,
      segmentCount: members.length,
      bounds: polygonBounds(members.flatMap((segment) => [[segment.x1, segment.y1], [segment.x2, segment.y2]])),
    })).filter((entry) => entry.segmentCount >= 40).sort((left, right) => right.segmentCount - left.segmentCount);
  }
  results.push({
    ...sheet,
    pageSizeFt: {
      width: page.getViewport({ scale: 1 }).width * sheet.scaleFtPerPoint,
      height: page.getViewport({ scale: 1 }).height * sheet.scaleFtPerPoint,
    },
    textMarkers: text.filter((value) => /PLAN|SCALE|LEVEL|UTILITY|TOWER/i.test(value)).slice(-20),
    grid: extractGrid(textItems),
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
    controlledTrials,
    cropGraphics,
    issues: multiplePlanViewsUnsplit
      ? [...footprint.issues, { code: 'MULTIPLE_PLAN_VIEWS_UNSPLIT', message: 'Tower sheet contains multiple plan views; whole-page consensus cannot be accepted as one footprint.' }]
      : footprint.issues,
  });
}
await task.destroy();

const asBuiltPath = path.resolve(process.env.NASHVILLE_AS_BUILT_PDF || DEFAULT_AS_BUILT);
const asBuiltBytes = new Uint8Array(fs.readFileSync(asBuiltPath));
const asBuiltPdfSha256 = crypto.createHash('sha256').update(asBuiltBytes).digest('hex');
if (asBuiltPdfSha256 !== EXPECTED_AS_BUILT_SHA256) throw new Error(`Nashville as-built PDF hash mismatch: ${asBuiltPdfSha256}`);
const asBuiltTask = pdfjsLib.getDocument({ data: asBuiltBytes, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
const asBuiltDocument = await asBuiltTask.promise;
const asBuiltPage = await asBuiltDocument.getPage(2);
const asBuiltScaleFtPerPoint = 1 / 9;
const asBuiltText = (await asBuiltPage.getTextContent()).items
  .filter((item) => item.str?.trim())
  .map((item) => ({ s: item.str.trim(), xFt: item.transform[4] * asBuiltScaleFtPerPoint, yFt: item.transform[5] * asBuiltScaleFtPerPoint }));
const asBuiltGrid = extractGrid(asBuiltText);
const asBuiltPlanTitles = asBuiltText.filter((item) => /MAIN LEVEL|UPPER LEVEL|FIRE SPRINKLER PIPING PLAN|3\/D-MODEL|CROSS SECTION/i.test(item.s));
const sourceA110 = results.find((entry) => entry.sheetId === 'A110');
const fitTranslation = (sourceDatums, targetDatums, axis) => {
  const target = new Map(targetDatums.map((datum) => [datum.label, datum[axis]]));
  const controls = sourceDatums.filter((datum) => target.has(datum.label)).map((datum) => ({
    label: datum.label,
    sourceFt: datum[axis],
    targetFt: target.get(datum.label),
    deltaFt: target.get(datum.label) - datum[axis],
  }));
  const meanDeltaFt = controls.reduce((sum, control) => sum + control.deltaFt, 0) / controls.length;
  const rmsResidualFt = Math.sqrt(controls.reduce((sum, control) => sum + (control.deltaFt - meanDeltaFt) ** 2, 0) / controls.length);
  return { controls, meanDeltaFt, rmsResidualFt };
};
const xRegistration = fitTranslation(
  sourceA110.grid.colDatums.filter((datum) => ['1', '2', '2.5', '3', '4', '4.5', '5'].includes(datum.label)),
  asBuiltGrid.colDatums,
  'xFt',
);
const asBuiltMainRowDatums = asBuiltText
  .filter((item) => /^(A|B|B\.5|C|D)$/.test(item.s) && item.xFt >= 210 && item.xFt <= 225)
  .map((item) => ({ label: item.s, yFt: item.yFt }));
const yRegistration = fitTranslation(
  sourceA110.grid.rowDatums.filter((datum) => ['A', 'B', 'B.5', 'C', 'D'].includes(datum.label)),
  asBuiltMainRowDatums,
  'yFt',
);
const { segments: asBuiltSegments } = extractSegmentsFromOpList(await asBuiltPage.getOperatorList(), { scale: asBuiltScaleFtPerPoint });
const sourceCrop = { minX: 24, maxX: 190, minY: 24, maxY: 130 };
const asBuiltCrop = {
  minX: sourceCrop.minX + xRegistration.meanDeltaFt,
  maxX: sourceCrop.maxX + xRegistration.meanDeltaFt,
  minY: sourceCrop.minY + yRegistration.meanDeltaFt,
  maxY: sourceCrop.maxY + yRegistration.meanDeltaFt,
};
const asBuiltInCrop = (segment) => {
  const x = (segment.x1 + segment.x2) / 2; const y = (segment.y1 + segment.y2) / 2;
  return x >= asBuiltCrop.minX && x <= asBuiltCrop.maxX && y >= asBuiltCrop.minY && y <= asBuiltCrop.maxY;
};
const asBuiltTrials = [
  ['filled-geometry', (segment) => segment.lineWidth == null && segment.strokeColor == null, 8],
  ['all-heavy-plan-geometry', (segment) => Number(segment.lineWidth) >= 1, 4],
].map(([id, predicate, bridgeGapsFt]) => {
  const members = asBuiltSegments.filter((segment) => asBuiltInCrop(segment) && predicate(segment));
  const outline = buildingOutlinePolygon(members, { networkMode: 'all-wall-like', bridgeGapsFt, gridN: 420, minWallFt: 1 });
  const bounds = outline.polygon?.length ? polygonBounds(outline.polygon) : null;
  return { id, crop: asBuiltCrop, bridgeGapsFt, segmentCount: members.length, areaSqft: outline.areaSqft, bounds, method: outline.method };
});
const printedBuildingAreaSqft = 10770;
const sourceAreaControls = sourceA110.controlledTrials.map((trial) => ({
  id: trial.id,
  areaSqft: trial.areaSqft,
  printedAreaResidualPct: Math.abs(trial.areaSqft - printedBuildingAreaSqft) / printedBuildingAreaSqft * 100,
}));
const acceptedSourceAreas = sourceAreaControls.filter((trial) => trial.printedAreaResidualPct <= 5);
const scaleRegistrationPassed = xRegistration.controls.length >= 5 && yRegistration.controls.length >= 5
  && xRegistration.rmsResidualFt <= 0.5 && yRegistration.rmsResidualFt <= 0.05;
const towerViewSplitPassed = !results.find((entry) => entry.sheetId === 'A131.1').issues.some((entry) => entry.code === 'MULTIPLE_PLAN_VIEWS_UNSPLIT');
const automaticScaledExtrusionReady = scaleRegistrationPassed && acceptedSourceAreas.length > 0 && towerViewSplitPassed;
await asBuiltTask.destroy();
console.log(JSON.stringify({
  sourcePath,
  sourcePdfSha256,
  results,
  asBuiltControl: {
    asBuiltPath,
    asBuiltPdfSha256,
    physicalPageNumber: 2,
    scaleText: '1/8 inch = 1 foot',
    scaleFtPerPoint: asBuiltScaleFtPerPoint,
    pageSizeFt: {
      width: asBuiltPage.getViewport({ scale: 1 }).width * asBuiltScaleFtPerPoint,
      height: asBuiltPage.getViewport({ scale: 1 }).height * asBuiltScaleFtPerPoint,
    },
    planTitles: asBuiltPlanTitles,
    grid: asBuiltGrid,
    mainPlanRegistration: { x: xRegistration, y: yRegistration },
    footprintTrials: asBuiltTrials,
  },
  acceptance: {
    status: automaticScaledExtrusionReady ? 'passed' : 'blocked',
    printedBuildingAreaSqft,
    scaleRegistrationPassed,
    sourceAreaControls,
    acceptedSourceAreaCandidateIds: acceptedSourceAreas.map((trial) => trial.id),
    towerViewSplitPassed,
    automaticScaledExtrusionReady,
    issues: [
      ...(acceptedSourceAreas.length ? [] : [{ code: 'SOURCE_FOOTPRINT_PRINTED_AREA_CONTROL_FAILED', message: 'No independently selected A110 shell is within five percent of the printed 10,770 square-foot building-area control.' }]),
      ...(towerViewSplitPassed ? [] : [{ code: 'TOWER_PLAN_VIEWS_UNSPLIT', message: 'A131.1 contains multiple plan views and cannot be accepted as one tower footprint.' }]),
    ],
    claimStatus: 'source-and-as-built-grid-registration-calibration-not-yet-scaled-extrusion',
  },
}, null, 2));
