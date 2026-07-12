import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildingOutlinePolygon, extractSegmentsFromOpList } from '../src/engine/pdf-floorplan.js';
import { computeWingRegistration, extractGrid, splitStackedPlanViews } from '../src/engine/plan-extract.js';
import { extractElevationDatums } from '../src/engine/elevation-datums.js';
import {
  convexHull,
  clipPolygonToRect,
  deriveExteriorConsensus,
  isSimplePolygon,
  polygonArea,
  polygonBounds,
  rasterUnionPolygons,
} from '../src/engine/source-bound-footprint.js';

const EXPECTED_PDF_SHA256 = '179a572ea380be805131aabdeb7c3a3a041f9c2f5aaf55d2fcde673289ab6d53';
const SCALE_FT_PER_POINT = 4 / 27;
const PAGES = [8, 11, 14, 17, 20, 23, 26, 29];
const RENDERED_PAGE_SHA256 = [
  '6cdde061de3593155b47062efbfdb4e34d628a4891ad3f05ef00378c53fa93a5',
  '4cd01de9bfe78f8af548a60750f9901b66ed82f5dfa271c72d842a065c122d54',
  '3de969fb18ed2474b56d62dc9cf9a9e2df3cbbffa90e73ee080f0ed59198cd9e',
  '09dfedd6cb7498664742d4f1dfa4f0a1d91b1e8607afe134cbb327b4caa346ff',
  '8c52ac61afeabf72f065fb762428ef99e74e3793673a7b08f129afb7a95e2c6d',
  '05f9f3aee716f002eeee3509d01a77e18af98046c809ef8b39949362f9ce82cd',
  'a1b341d515523868e860f799d696d70e03c4d2150ad8e5bb596a17614b10ccb8',
  '50dfcc5dcf3a63845e5adef6ff95ab317731760b0ea2034d9476972209927e6b',
];
const sourcePdf = path.resolve(process.env.COOPERATIVE_1881_ARCH_PDF || 'plans/cooperative-1881/1881-updated-architectural.pdf');
const elevationPath = path.resolve('src/data/elevation-datums.cooperative-1881.json');
const outputPath = path.resolve(process.env.COOPERATIVE_1881_FOOTPRINT_OUTPUT || 'src/data/source-bound-footprints.cooperative-1881.json');
const bytes = new Uint8Array(fs.readFileSync(sourcePdf));
const sourcePdfSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
if (sourcePdfSha256 !== EXPECTED_PDF_SHA256) throw new Error(`architectural source PDF hash mismatch: ${sourcePdfSha256}`);

const elevationPacket = JSON.parse(fs.readFileSync(elevationPath, 'utf8'));
const elevationResult = await extractElevationDatums(elevationPacket, { expectedSourcePdfSha256: sourcePdfSha256 });
if (elevationResult.status !== 'passed') throw new Error(`elevation packet rejected: ${elevationResult.issues.map((entry) => entry.code).join(',')}`);
const elevations = new Map(elevationResult.datums.filter((datum) => datum.kind === 'floor').map((datum) => [Number(datum.id.replace('floor-', '')), datum.elevationFt]));
const task = pdfjsLib.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
const doc = await task.promise;

const sourceBinding = (level) => ({
  sourcePdfSha256, physicalPageNumber: PAGES[level - 1], pageIndex: PAGES[level - 1] - 1,
  renderedPageSha256: RENDERED_PAGE_SHA256[level - 1], sheetId: `A-10${level}`, coordinateSpace: 'pdf-points',
  renderProfile: { renderer: 'PyMuPDF', rendererVersion: '1.27.2.2', matrixScale: 2.5, colorspace: 'rgb', alpha: false },
});
const graphics = (segments, lineWidth, strokeColor) => segments.filter((segment) => Math.abs(Number(segment.lineWidth) - lineWidth) < 1e-6 && segment.strokeColor === strokeColor);
const textItems = async (page) => (await page.getTextContent()).items.filter((item) => item.str && item.str.trim()).map((item) => ({
  s: item.str.trim(), xFt: item.transform[4] * SCALE_FT_PER_POINT, yFt: item.transform[5] * SCALE_FT_PER_POINT,
}));
const round = (value) => Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;

const levels = [];
for (let index = 0; index < PAGES.length; index += 1) {
  const level = index + 1; const page = await doc.getPage(PAGES[index]); const text = await textItems(page);
  const { segments } = extractSegmentsFromOpList(await page.getOperatorList(), { scale: SCALE_FT_PER_POINT });
  if (level === 1) {
    const split = splitStackedPlanViews(segments, text, { pageWidthFt: page.getViewport({ scale: 1 }).width * SCALE_FT_PER_POINT });
    if (!split.isStacked || split.views.length !== 2) throw new Error('A-101 split-wing control not found');
    const wings = split.views.map((view) => {
      const members = graphics(view.segments, 0.18, '#4a4a4a');
      const polygon = convexHull(members.flatMap((segment) => [[segment.x1, segment.y1], [segment.x2, segment.y2]]));
      const bounds = polygonBounds(polygon);
      return { polygon, grid: extractGrid(view.textItemsFt), wallBboxFt: bounds, footprintBboxFt: bounds, segmentCount: members.length };
    });
    const registration = computeWingRegistration(wings[0], wings[1]);
    const shifted = wings[1].polygon.map(([x, y]) => [x + registration.dx, y + registration.dy]);
    const union = rasterUnionPolygons([wings[0].polygon, shifted], { cellSizeFt: 0.25 });
    const passed = union.status === 'passed' && registration.colInlierCount >= 3 && isSimplePolygon(union.polygon);
    levels.push({
      level, sheetId: 'A-101', sourceBinding: sourceBinding(level), elevationFt: elevations.get(level),
      elevationEvidenceReceiptSha256: elevationResult.evidenceReceiptSha256,
      status: passed ? 'passed' : 'blocked', polygonPlanFt: passed ? union.polygon : null, areaSqft: passed ? union.areaSqft : null,
      derivation: {
        method: 'registered-split-wing-heavy-neutral-layer-hull-union', graphicsState: '0.18|#4a4a4a',
        wingSegmentCounts: wings.map((wing) => wing.segmentCount), registration,
        rasterUnionCellSizeFt: union.cellSizeFt, simplePolygon: passed,
      },
      issues: passed ? [] : [{ code: 'LEVEL1_SPLIT_WING_REGISTRATION_FAILED' }],
    });
    continue;
  }
  if (level === 2) {
    const baseMembers = graphics(segments, 0.18, '#506e96');
    const shellMembers = graphics(segments, 0.18, '#4a4a4a');
    const base = convexHull(baseMembers.flatMap((segment) => [[segment.x1, segment.y1], [segment.x2, segment.y2]]));
    const baseBounds = polygonBounds(base);
    const shellResult = buildingOutlinePolygon(shellMembers, { networkMode: 'all-wall-like', bridgeGapsFt: 8, gridN: 420, minWallFt: 1 });
    const shellBounds = polygonBounds(shellResult.polygon);
    const overallDepthFt = 69.5; // A-102 printed overall vertical dimension: 69'-6".
    const centerY = (baseBounds.minY + baseBounds.maxY) / 2;
    const clippedShell = clipPolygonToRect(shellResult.polygon, {
      minX: shellBounds.minX, maxX: shellBounds.maxX,
      minY: centerY - overallDepthFt / 2, maxY: centerY + overallDepthFt / 2,
    });
    const union = rasterUnionPolygons([base, clippedShell], { cellSizeFt: 0.25 });
    const grid = extractGrid(text); const gridByLabel = new Map((grid.colDatums || []).map((entry) => [entry.label, entry.xFt]));
    const gridSpanFt = Math.abs(Number(gridByLabel.get('0.9')) - Number(gridByLabel.get('28.1')));
    const printedInnerLengthFt = 312 + 4.75 / 12; // A-102 printed inner length: 312'-4 3/4".
    const controls = {
      baseLengthFt: round(baseBounds.widthFt), printedInnerLengthFt,
      innerLengthResidualPct: round(Math.abs(baseBounds.widthFt - printedInnerLengthFt) / printedInnerLengthFt * 100),
      gridSpanFt: round(gridSpanFt), gridResidualPct: round(Math.abs(baseBounds.widthFt - gridSpanFt) / gridSpanFt * 100),
      baseDepthFt: round(baseBounds.heightFt), printedMainDepthFt: 60,
      mainDepthResidualPct: round(Math.abs(baseBounds.heightFt - 60) / 60 * 100),
      printedOverallDepthFt: overallDepthFt,
    };
    const passed = union.status === 'passed' && isSimplePolygon(union.polygon)
      && controls.innerLengthResidualPct <= 1 && controls.gridResidualPct <= 2 && controls.mainDepthResidualPct <= 4;
    levels.push({
      level, sheetId: 'A-102', sourceBinding: sourceBinding(level), elevationFt: elevations.get(level),
      elevationEvidenceReceiptSha256: elevationResult.evidenceReceiptSha256,
      status: passed ? 'passed' : 'blocked', polygonPlanFt: passed ? union.polygon : null, areaSqft: passed ? union.areaSqft : null,
      derivation: {
        method: 'dimension-and-grid-controlled-two-layer-open-floor-union',
        baseGraphicsState: '0.18|#506e96', shellGraphicsState: '0.18|#4a4a4a',
        baseSegmentCount: baseMembers.length, shellSegmentCount: shellMembers.length,
        controls, rasterUnionCellSizeFt: union.cellSizeFt,
        submittedCalibrationBinding: {
          sourcePdfSha256: 'bae3cbfeb4c93812fe9a5a168dcf3e16836a6d13a3a75bb33c147cc1ebc0ac29',
          physicalPageNumber: 6, pageIndex: 5, renderedPageSha256: 'cf476dc5a98e51e51d90e8bda8b8e5232e2ded6d1fc199153e5f1cbf84647731',
          sheetId: 'FP-2-R2', coordinateSpace: 'pdf-points',
          approvalStatus: 'submittal-only-not-approved', role: 'calibration-answer-key',
        },
        sourceConflict: 'A-102 also contains a 346 foot dimension token that conflicts with the 312 foot 4 3/4 inch inner control, the 316.6 foot grid span, and the sealed vector geometry. It is retained as a source-quality warning and is not used to fit the footprint.',
      },
      issues: passed ? [] : [{ code: 'LEVEL2_DIMENSION_GRID_CONTROL_FAILED' }],
    });
    continue;
  }
  const control = level === 3 ? { expectedAreaSqft: 22359.12, controlTolerancePct: 2 } : {};
  const result = deriveExteriorConsensus(segments, { ...control, clusterTolerance: 0.03, minOutlineFillRatio: 0.85, bridgeGapsFt: 8, gridN: 420 });
  levels.push({
    level, sheetId: `A-10${level}`, sourceBinding: sourceBinding(level), elevationFt: elevations.get(level),
    elevationEvidenceReceiptSha256: elevationResult.evidenceReceiptSha256,
    status: result.status, polygonPlanFt: result.status === 'passed' ? result.polygon : null,
    areaSqft: result.status === 'passed' ? result.areaSqft : null,
    derivation: {
      method: 'independent-heavy-graphics-state-consensus', graphicsState: result.graphicsState || null,
      consensus: result.consensus || [], controlResidualPct: result.controlResidualPct ?? null,
      candidateSummary: (result.candidates || []).map((candidate) => ({
        graphicsState: candidate.graphicsState, segmentCount: candidate.segmentCount,
        hullAreaSqft: round(candidate.hullAreaSqft), outlineAreaSqft: round(candidate.outlineAreaSqft), outlineFillRatio: round(candidate.outlineFillRatio),
      })),
      ...(level === 8 ? {
        submittedCalibrationBinding: {
          sourcePdfSha256: 'bae3cbfeb4c93812fe9a5a168dcf3e16836a6d13a3a75bb33c147cc1ebc0ac29',
          physicalPageNumber: 12, pageIndex: 11,
          renderedPageSha256: '2f20907cec537c92bff749f476d7c14712941421b367c2f6f4b428ccae2e6d20',
          sheetId: 'FP-8-R2', coordinateSpace: 'pdf-points',
          approvalStatus: 'submittal-only-not-approved', role: 'node-comparison-registration-answer-key',
        },
      } : {}),
    },
    issues: result.issues,
  });
}
await task.destroy();

const draft = {
  artifactType: 'halofire.source-bound-level-footprints.v1', projectName: 'The Cooperative 1881 - Salt Lake City UT',
  units: 'ft', sourcePdfSha256, scaleFtPerPoint: SCALE_FT_PER_POINT,
  scaleBasis: 'Each A-101 through A-108 sheet prints SCALE: 3/32 inch = 1 foot.',
  elevationEvidenceReceiptSha256: elevationResult.evidenceReceiptSha256,
  levels,
  coverage: {
    complete: levels.every((entry) => entry.status === 'passed'),
    passedLevels: levels.filter((entry) => entry.status === 'passed').map((entry) => entry.level),
    blockedLevels: levels.filter((entry) => entry.status !== 'passed').map((entry) => entry.level),
    unresolved: levels.filter((entry) => entry.status !== 'passed').map((entry) => `level-${entry.level}-exterior-consensus`),
  },
  claimStatus: 'source-bound-building-geometry-only-not-sprinkler-code-compliance',
};
const canonicalize = (value) => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])) : value;
draft.evidenceReceiptSha256 = crypto.createHash('sha256').update(JSON.stringify(canonicalize(draft))).digest('hex');
fs.writeFileSync(outputPath, `${JSON.stringify(draft, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, receipt: draft.evidenceReceiptSha256, coverage: draft.coverage, levels: levels.map((entry) => ({ level: entry.level, status: entry.status, areaSqft: entry.areaSqft, issues: entry.issues.map((issue) => issue.code) })) }, null, 2));
