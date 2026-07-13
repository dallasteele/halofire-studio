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
const round = (value, digits = 6) => Math.round((Number(value) + Number.EPSILON) * 10 ** digits) / 10 ** digits;
const relativeSpreadPct = (values) => {
  const finite = values.map(Number).filter(Number.isFinite);
  if (!finite.length) return null;
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  return mean > 0 ? round((Math.max(...finite) - Math.min(...finite)) / mean * 100) : null;
};
const sourcePath = path.resolve(process.env.NASHVILLE_SOURCE_PDF || DEFAULT_SOURCE);
const sourceBytes = new Uint8Array(fs.readFileSync(sourcePath));
const sourcePdfSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
if (sourcePdfSha256 !== EXPECTED_SOURCE_SHA256) throw new Error(`Nashville source PDF hash mismatch: ${sourcePdfSha256}`);

const sheets = [
  { sheetId: 'A110', physicalPageNumber: 17, scaleText: '3/16 inch = 1 foot', scaleFtPerPoint: 2 / 27, minSegments: 100, minAspect: 1.2 },
  { sheetId: 'A121.1', physicalPageNumber: 27, scaleText: '1/4 inch = 1 foot', scaleFtPerPoint: 1 / 18, minSegments: 40, minAspect: 1 },
  { sheetId: 'A131.1', physicalPageNumber: 29, scaleText: '1/4 inch = 1 foot', scaleFtPerPoint: 1 / 18, minSegments: 20, minAspect: 1 },
  { sheetId: 'F101', physicalPageNumber: 92, scaleText: '3/16 inch = 1 foot', scaleFtPerPoint: 2 / 27, minSegments: 100, minAspect: 1 },
  { sheetId: 'F102', physicalPageNumber: 93, scaleText: '3/16 inch = 1 foot', scaleFtPerPoint: 2 / 27, minSegments: 20, minAspect: 1 },
];

const summarizePaintGroups = (segments, predicate = () => true, minSegments = 20) => {
  const groups = new Map();
  for (const segment of segments.filter(predicate)) {
    const key = [
      segment.paintMode ?? 'legacy',
      segment.fillColor ?? 'none',
      segment.lineWidth ?? 'none',
      segment.strokeColor ?? 'none',
    ].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(segment);
  }
  return [...groups.entries()].map(([paintState, members]) => ({
    paintState,
    segmentCount: members.length,
    pathCount: new Set(members.map((segment) => segment.pathId).filter(Number.isFinite)).size,
    bounds: polygonBounds(members.flatMap((segment) => [[segment.x1, segment.y1], [segment.x2, segment.y2]])),
  })).filter((entry) => entry.segmentCount >= minSegments)
    .sort((left, right) => right.segmentCount - left.segmentCount);
};

const task = pdfjsLib.getDocument({ data: sourceBytes, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
const document = await task.promise;
const results = [];
for (const sheet of sheets) {
  const page = await document.getPage(sheet.physicalPageNumber);
  const textItems = (await page.getTextContent()).items
    .filter((item) => item.str?.trim())
    .map((item) => ({ s: item.str.trim(), xFt: item.transform[4] * sheet.scaleFtPerPoint, yFt: item.transform[5] * sheet.scaleFtPerPoint }));
  const text = textItems.map((item) => item.s);
  const { segments } = extractSegmentsFromOpList(await page.getOperatorList(), {
    scale: sheet.scaleFtPerPoint,
    includePaintMode: true,
  });
  const footprint = deriveExteriorConsensus(segments, {
    minSegments: sheet.minSegments,
    minAspect: sheet.minAspect,
    minOutlineFillRatio: 0.75,
    clusterTolerance: 0.04,
    bridgeGapsFt: 4,
    gridN: 360,
  });
  const planViewMarkers = textItems.filter((item) => /^PLAN\s*-/i.test(item.s));
  const planViewTitles = planViewMarkers.map((item) => item.s);
  const detailPlanViewMarkers = planViewMarkers.filter((item) => /TOWER BASE/i.test(item.s));
  const multiplePlanViewsDetected = sheet.sheetId === 'A131.1' && detailPlanViewMarkers.length > 1;
  let controlledTrials = [];
  let cropGraphics = [];
  let splitPlanViews = [];
  let splitConsensus = null;
  if (sheet.sheetId === 'A110') {
    const crop = { minX: 24, maxX: 190, minY: 24, maxY: 130 };
    const inCrop = (segment) => {
      const x = (segment.x1 + segment.x2) / 2; const y = (segment.y1 + segment.y2) / 2;
      return x >= crop.minX && x <= crop.maxX && y >= crop.minY && y <= crop.maxY;
    };
    const trials = [
      ['non-white-filled-paths', (segment) => ['fill', 'fill-stroke'].includes(segment.paintMode) && segment.fillColor !== '#ffffff', 4],
      ['black-filled-paths', (segment) => ['fill', 'fill-stroke'].includes(segment.paintMode) && segment.fillColor === '#000000', 4],
      ['all-filled-paths', (segment) => ['fill', 'fill-stroke'].includes(segment.paintMode), 4],
      ['stroke-only-paths', (segment) => segment.paintMode === 'stroke', 4],
      ['green-plus-black-cut-lines', (segment) => (segment.lineWidth === 2 && segment.strokeColor === '#007f00') || ([1, 10].includes(segment.lineWidth) && segment.strokeColor === '#000000'), 4],
      ['green-plus-black-cut-lines-bridge-8', (segment) => (segment.lineWidth === 2 && segment.strokeColor === '#007f00') || ([1, 10].includes(segment.lineWidth) && segment.strokeColor === '#000000'), 8],
      ['black-cut-lines', (segment) => [1, 10].includes(segment.lineWidth) && segment.strokeColor === '#000000', 8],
      ['filled-geometry', (segment) => segment.lineWidth == null && segment.strokeColor == null, 8],
      ['all-heavy-plan-geometry', (segment) => Number(segment.lineWidth) >= 1, 4],
    ];
    const fillColors = [...new Set(segments
      .filter((segment) => inCrop(segment) && ['fill', 'fill-stroke'].includes(segment.paintMode) && segment.fillColor)
      .map((segment) => segment.fillColor))];
    for (const fillColor of fillColors) {
      const count = segments.filter((segment) => inCrop(segment)
        && ['fill', 'fill-stroke'].includes(segment.paintMode)
        && segment.fillColor === fillColor).length;
      if (count >= 20) {
        trials.push([`fill-color-${fillColor.slice(1)}`, (segment) => ['fill', 'fill-stroke'].includes(segment.paintMode) && segment.fillColor === fillColor, 4]);
      }
    }
    controlledTrials = trials.map(([id, predicate, bridgeGapsFt]) => {
      const members = segments.filter((segment) => inCrop(segment) && predicate(segment));
      const outline = buildingOutlinePolygon(members, { networkMode: 'all-wall-like', bridgeGapsFt, gridN: 420, minWallFt: 1 });
      const bounds = outline.polygon?.length ? polygonBounds(outline.polygon) : null;
      return {
        id, crop, bridgeGapsFt, segmentCount: members.length, areaSqft: outline.areaSqft, bounds, method: outline.method,
        ...(id === 'fill-color-aaaaaa' ? { polygonPlanFt: outline.polygon.map((point) => point.map((value) => round(value))) } : {}),
      };
    });
    cropGraphics = summarizePaintGroups(segments, inCrop, 40);
  }
  if (sheet.sheetId === 'A131.1') {
    const viewDefinitions = [
      { id: 'tower-base-demolition', title: 'PLAN - TOWER BASE - DEMOLITION', crop: { minX: 20, maxX: 70, minY: 65, maxY: 116 } },
      { id: 'tower-base-annotated', title: 'PLAN - TOWER BASE - ANNOTATED', crop: { minX: 20, maxX: 70, minY: 7, maxY: 61 } },
      { id: 'tower-base-dimension', title: 'PLAN - TOWER BASE - DIMENSION', crop: { minX: 77, maxX: 127, minY: 7, maxY: 61 } },
    ];
    splitPlanViews = viewDefinitions.map((view) => {
      const inView = (segment) => {
        const x = (segment.x1 + segment.x2) / 2; const y = (segment.y1 + segment.y2) / 2;
        return x >= view.crop.minX && x <= view.crop.maxX && y >= view.crop.minY && y <= view.crop.maxY;
      };
      const members = segments.filter(inView);
      const predicates = [
        ['non-white-filled-paths', (segment) => ['fill', 'fill-stroke'].includes(segment.paintMode) && segment.fillColor !== '#ffffff'],
      ];
      const fillColors = [...new Set(members
        .filter((segment) => ['fill', 'fill-stroke'].includes(segment.paintMode) && segment.fillColor)
        .map((segment) => segment.fillColor))];
      for (const fillColor of fillColors) {
        if (members.filter((segment) => ['fill', 'fill-stroke'].includes(segment.paintMode) && segment.fillColor === fillColor).length >= 20) {
          predicates.push([`fill-color-${fillColor.slice(1)}`, (segment) => ['fill', 'fill-stroke'].includes(segment.paintMode) && segment.fillColor === fillColor]);
        }
      }
      const strokeStates = [...new Set(members
        .filter((segment) => segment.paintMode === 'stroke' && segment.strokeColor)
        .map((segment) => `${segment.lineWidth}|${segment.strokeColor}`))];
      for (const strokeState of strokeStates) {
        const [lineWidth, strokeColor] = strokeState.split('|');
        if (members.filter((segment) => segment.paintMode === 'stroke' && String(segment.lineWidth) === lineWidth && segment.strokeColor === strokeColor).length >= 40) {
          predicates.push([`stroke-${lineWidth}-${strokeColor.slice(1)}`, (segment) => segment.paintMode === 'stroke' && String(segment.lineWidth) === lineWidth && segment.strokeColor === strokeColor]);
        }
      }
      const outlineTrials = predicates.map(([id, predicate]) => {
        const selected = members.filter(predicate);
        const outline = buildingOutlinePolygon(selected, { networkMode: 'all-wall-like', bridgeGapsFt: 4, gridN: 360, minWallFt: 1 });
        return {
          id,
          segmentCount: selected.length,
          areaSqft: outline.areaSqft,
          bounds: outline.polygon?.length ? polygonBounds(outline.polygon) : null,
          method: outline.method,
          ...(id === 'fill-color-aaaaaa' ? { polygonViewFt: outline.polygon.map((point) => point.map((value) => round(value))) } : {}),
        };
      });
      return {
        ...view,
        titleMarker: planViewMarkers.find((marker) => marker.s === view.title) || null,
        segmentCount: members.length,
        paintGraphics: summarizePaintGroups(members, () => true, 20),
        outlineTrials,
      };
    });
    const selected = splitPlanViews.map((view) => ({
      view,
      trial: view.outlineTrials.find((trial) => trial.id === 'fill-color-aaaaaa'),
    }));
    const areas = selected.map((entry) => entry.trial?.areaSqft);
    const widths = selected.map((entry) => entry.trial?.bounds?.widthFt);
    const heights = selected.map((entry) => entry.trial?.bounds?.heightFt);
    const areaSpreadPct = relativeSpreadPct(areas);
    const widthSpreadPct = relativeSpreadPct(widths);
    const heightSpreadPct = relativeSpreadPct(heights);
    const allViewsBound = selected.length === 3 && selected.every((entry) => entry.view.titleMarker
      && entry.trial?.segmentCount >= 50
      && String(entry.trial?.method).startsWith('wall-network-occupancy-grid'));
    splitConsensus = {
      status: allViewsBound && areaSpreadPct <= 1 && widthSpreadPct <= 1 && heightSpreadPct <= 1 ? 'passed' : 'blocked',
      selectedPaintSemantics: 'fill|#aaaaaa',
      viewIds: selected.map((entry) => entry.view.id),
      areaSqft: areas.map((value) => round(value)),
      areaSpreadPct,
      widthSpreadPct,
      heightSpreadPct,
      independentViewCount: selected.length,
      claimStatus: 'three-view-source-vector-footprint-consensus-not-code-compliance',
    };
  }
  results.push({
    ...sheet,
    pageSizeFt: {
      width: page.getViewport({ scale: 1 }).width * sheet.scaleFtPerPoint,
      height: page.getViewport({ scale: 1 }).height * sheet.scaleFtPerPoint,
    },
    textMarkers: text.filter((value) => /PLAN|SCALE|LEVEL|UTILITY|TOWER/i.test(value)).slice(-20),
    planViewMarkers,
    grid: extractGrid(textItems),
    segmentCount: segments.length,
    paintGraphics: summarizePaintGroups(segments),
    status: multiplePlanViewsDetected ? splitConsensus?.status : footprint.status,
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
    splitPlanViews,
    splitConsensus,
    issues: multiplePlanViewsDetected && splitConsensus?.status !== 'passed'
      ? [...footprint.issues, { code: 'MULTIPLE_PLAN_VIEWS_UNSPLIT', message: 'Tower sheet contains multiple plan views without an accepted per-view geometry consensus.' }]
      : multiplePlanViewsDetected
        ? []
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
const { segments: asBuiltSegments } = extractSegmentsFromOpList(await asBuiltPage.getOperatorList(), {
  scale: asBuiltScaleFtPerPoint,
  includePaintMode: true,
});
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
  ['non-white-filled-paths', (segment) => ['fill', 'fill-stroke'].includes(segment.paintMode) && segment.fillColor !== '#ffffff', 4],
  ['black-filled-paths', (segment) => ['fill', 'fill-stroke'].includes(segment.paintMode) && segment.fillColor === '#000000', 4],
  ['all-filled-paths', (segment) => ['fill', 'fill-stroke'].includes(segment.paintMode), 4],
  ['stroke-only-paths', (segment) => segment.paintMode === 'stroke', 4],
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
const selectedSourceArea = sourceAreaControls.find((trial) => trial.id === 'fill-color-aaaaaa');
const selectedSourceAreaPassed = selectedSourceArea?.printedAreaResidualPct <= 2;
const scaleRegistrationPassed = xRegistration.controls.length >= 5 && yRegistration.controls.length >= 5
  && xRegistration.rmsResidualFt <= 0.5 && yRegistration.rmsResidualFt <= 0.05;
const towerViewSplitPassed = results.find((entry) => entry.sheetId === 'A131.1').splitConsensus?.status === 'passed';
const automaticScaledExtrusionReady = scaleRegistrationPassed && selectedSourceAreaPassed && towerViewSplitPassed;
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
    cropPaintGraphics: summarizePaintGroups(asBuiltSegments, asBuiltInCrop, 40),
  },
  acceptance: {
    status: automaticScaledExtrusionReady ? 'passed' : 'blocked',
    printedBuildingAreaSqft,
    scaleRegistrationPassed,
    sourceAreaControls,
    selectedSourceAreaCandidateId: selectedSourceArea?.id || null,
    selectedSourceAreaPaintSemantics: 'fill|#aaaaaa',
    selectedSourceAreaControlPassed: selectedSourceAreaPassed,
    acceptedSourceAreaCandidateIds: selectedSourceAreaPassed ? [selectedSourceArea.id] : [],
    towerViewSplitPassed,
    automaticScaledExtrusionReady,
    issues: [
      ...(selectedSourceAreaPassed ? [] : [{ code: 'SOURCE_FOOTPRINT_PRINTED_AREA_CONTROL_FAILED', message: 'The independently selected A110 gray wall-poche shell exceeds the two-percent printed 10,770 square-foot building-area control.' }]),
      ...(towerViewSplitPassed ? [] : [{ code: 'TOWER_PLAN_VIEWS_UNSPLIT', message: 'A131.1 contains multiple plan views and cannot be accepted as one tower footprint.' }]),
    ],
    claimStatus: 'source-and-as-built-grid-registration-calibration-not-yet-scaled-extrusion',
  },
}, null, 2));
