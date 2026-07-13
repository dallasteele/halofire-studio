import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sealElevationDatumPacket, sha256Hex } from '../src/engine/elevation-datums.js';
import { polygonArea } from '../src/engine/source-bound-footprint.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePdfSha256 = '552ca656e22f9a113aafd0eb9bc95cd70696676797078936514e611864293929';
const renderProfile = (matrixScale) => ({
  renderer: 'Poppler pdftoppm', rendererVersion: '26.05.0', matrixScale, colorspace: 'rgb', alpha: false,
});
const binding = ({ physicalPageNumber, renderedPageSha256, sheetId, matrixScale, coordinateSpace = 'plan-feet' }) => ({
  sourcePdfSha256,
  physicalPageNumber,
  pageIndex: physicalPageNumber - 1,
  renderedPageSha256,
  sheetId,
  coordinateSpace,
  renderProfile: renderProfile(matrixScale),
});
const a110Binding = binding({
  physicalPageNumber: 17,
  renderedPageSha256: '7bd9b5899066145c729ec9621a74ea34c530d3b3357e7ea8b95a2dd5e637eb34',
  sheetId: 'A110',
  matrixScale: 1.388889,
});
const a131Binding = binding({
  physicalPageNumber: 29,
  renderedPageSha256: 'd0375c1868bbfc3725258ff50fadaa6a0bd0de521759d88b05244a014a13cf17',
  sheetId: 'A131.1',
  matrixScale: 1.666667,
});
const a301Binding = binding({
  physicalPageNumber: 31,
  renderedPageSha256: 'fc7f09f44133040b35d525ec5903f1d4e88220a673539f4ebe99be51faa686f2',
  sheetId: 'A301',
  matrixScale: 1.388889,
  coordinateSpace: 'pdf-points',
});

const analysisText = execFileSync(process.execPath, [path.join(here, 'analyze-nashville-source-geometry.mjs')], {
  cwd: path.resolve(here, '..'),
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
});
const analysis = JSON.parse(analysisText);
if (analysis.acceptance?.status !== 'passed') throw new Error('NASHVILLE_SOURCE_GEOMETRY_ANALYSIS_BLOCKED');
const a110 = analysis.results.find((entry) => entry.sheetId === 'A110');
const a131 = analysis.results.find((entry) => entry.sheetId === 'A131.1');
const f102 = analysis.results.find((entry) => entry.sheetId === 'F102');
const level1Trial = a110.controlledTrials.find((trial) => trial.id === 'fill-color-aaaaaa');
const towerView = a131.splitPlanViews.find((view) => view.id === 'tower-base-dimension');
const towerTrial = towerView?.outlineTrials.find((trial) => trial.id === 'fill-color-aaaaaa');
if (!level1Trial?.polygonPlanFt?.length || !towerTrial?.polygonViewFt?.length) throw new Error('NASHVILLE_SELECTED_POLYGONS_MISSING');

const bubbleCoordinate = (sheet, kind, label, crop) => {
  const bubbles = sheet.grid[kind === 'col' ? 'colBubbles' : 'rowBubbles'].filter((datum) => datum.label === label
    && datum.xFt >= crop.minX && datum.xFt <= crop.maxX && datum.yFt >= crop.minY && datum.yFt <= crop.maxY);
  const values = [...new Set(bubbles.map((datum) => datum[kind === 'col' ? 'xFt' : 'yFt']))];
  if (!values.length) throw new Error(`NASHVILLE_GRID_CONTROL_MISSING:${sheet.sheetId}:${kind}:${label}`);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};
const deltas = [
  bubbleCoordinate(a110, 'col', '3', level1Trial.crop) - bubbleCoordinate(a131, 'col', '3', towerView.crop),
  bubbleCoordinate(a110, 'col', '4', level1Trial.crop) - bubbleCoordinate(a131, 'col', '4', towerView.crop),
];
const rowLabels = ['B', 'B.5', 'C'];
const rowDeltas = rowLabels.map((label) => bubbleCoordinate(a110, 'row', label, level1Trial.crop)
  - bubbleCoordinate(a131, 'row', label, towerView.crop));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const rms = (values, center = mean(values)) => Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
const translateXFt = mean(deltas);
const translateYFt = mean(rowDeltas);
const towerPolygonPlanFt = towerTrial.polygonViewFt.map(([x, y]) => [
  Number((x + translateXFt).toFixed(6)),
  Number((y + translateYFt).toFixed(6)),
]);
const f102ColControlCrop = { minX: 110, maxX: 135, minY: 115, maxY: 125 };
const f102RowControlCrop = { minX: 170, maxX: 185, minY: 45, maxY: 90 };
const f102ColDeltas = ['3', '4'].map((label) => bubbleCoordinate(f102, 'col', label, f102ColControlCrop)
  - bubbleCoordinate(a131, 'col', label, towerView.crop));
const f102RowDeltas = rowLabels.map((label) => bubbleCoordinate(f102, 'row', label, f102RowControlCrop)
  - bubbleCoordinate(a131, 'row', label, towerView.crop));
const f102TranslateXFt = mean(f102ColDeltas);
const f102TranslateYFt = mean(f102RowDeltas);

const elevationPacket = await sealElevationDatumPacket({
  artifactType: 'halofire.elevation-datum-packet.v1',
  sourceDocumentId: 'nashville-tn-temple-bid-set-a301',
  sourceBinding: a301Binding,
  observations: [
    { id: 'level-01', kind: 'floor', label: 'LEVEL 01', elevationText: "100'-0\"", elevationFt: 100, sourceBinding: a301Binding },
    { id: 'mezzanine-a', kind: 'floor', label: 'MEZZANINE - A', elevationText: "108'-9 3/8\"", elevationFt: 108.78125, sourceBinding: a301Binding },
    { id: 'parapet-1', kind: 'roof-point', label: 'PARAPET 1', elevationText: "118'-3\"", elevationFt: 118.25, sourceBinding: a301Binding },
    { id: 'parapet-2', kind: 'roof-point', label: 'PARAPET 2', elevationText: "123'-0\"", elevationFt: 123, sourceBinding: a301Binding },
  ],
});

const levelsDraft = {
  artifactType: 'halofire.source-bound-level-footprints.v1',
  projectName: 'LDS Temple - Nashville TN',
  units: 'ft',
  sourcePdfSha256,
  scaleFtPerPoint: 2 / 27,
  scaleBasis: 'A110 uses 3/16 inch = 1 foot; A131.1 per-level derivation records 1/4 inch = 1 foot before shared-grid registration into A110 plan feet',
  elevationEvidenceReceiptSha256: elevationPacket.receiptSha256,
  levels: [
    {
      level: 1,
      sheetId: 'A110',
      sourceBinding: a110Binding,
      elevationFt: 100,
      elevationEvidenceReceiptSha256: elevationPacket.receiptSha256,
      status: 'passed',
      polygonPlanFt: level1Trial.polygonPlanFt,
      areaSqft: Number(polygonArea(level1Trial.polygonPlanFt).toFixed(6)),
      derivation: {
        method: 'pdf-vector-paint-semantics-wall-poche',
        paintMode: 'fill',
        fillColor: '#aaaaaa',
        sourceScaleFtPerPoint: 2 / 27,
        segmentCount: level1Trial.segmentCount,
        printedBuildingAreaSqft: 10770,
        printedAreaResidualPct: analysis.acceptance.sourceAreaControls.find((trial) => trial.id === 'fill-color-aaaaaa').printedAreaResidualPct,
        selectionPolicy: 'wall poche selected by PDF paint semantics before printed-area control',
        completedAsBuiltGridRegistration: analysis.asBuiltControl.mainPlanRegistration,
      },
      issues: [],
    },
    {
      level: 2,
      sheetId: 'A131.1',
      sourceBinding: a131Binding,
      elevationFt: 108.78125,
      elevationEvidenceReceiptSha256: elevationPacket.receiptSha256,
      status: 'passed',
      polygonPlanFt: towerPolygonPlanFt,
      areaSqft: Number(polygonArea(towerPolygonPlanFt).toFixed(6)),
      derivation: {
        method: 'three-view-pdf-vector-wall-poche-consensus-plus-shared-grid-registration',
        paintMode: 'fill',
        fillColor: '#aaaaaa',
        sourceScaleFtPerPoint: 1 / 18,
        selectedView: 'tower-base-dimension',
        independentViewIds: a131.splitConsensus.viewIds,
        independentViewAreaSqft: a131.splitConsensus.areaSqft,
        areaSpreadPct: a131.splitConsensus.areaSpreadPct,
        widthSpreadPct: a131.splitConsensus.widthSpreadPct,
        heightSpreadPct: a131.splitConsensus.heightSpreadPct,
        registration: {
          coordinateFrame: 'A110 plan feet',
          colControls: ['3', '4'],
          rowControls: rowLabels,
          translateXFt,
          translateYFt,
          rmsXFt: rms(deltas, translateXFt),
          rmsYFt: rms(rowDeltas, translateYFt),
        },
        level02FireProtectionPlanRegistration: {
          sheetId: 'F102',
          physicalPageNumber: 93,
          sourceScaleFtPerPoint: 2 / 27,
          colControls: ['3', '4'],
          rowControls: rowLabels,
          translateXFt: f102TranslateXFt,
          translateYFt: f102TranslateYFt,
          rmsXFt: rms(f102ColDeltas, f102TranslateXFt),
          rmsYFt: rms(f102RowDeltas, f102TranslateYFt),
          role: 'independent source-design grid registration control for the Level 02 sprinkler plan',
        },
      },
      issues: [],
    },
  ],
  coverage: { complete: true, passedLevels: [1, 2], blockedLevels: [], unresolved: [] },
  claimStatus: 'source-bound-building-geometry-only-not-sprinkler-code-compliance',
};
const levelsPacket = { ...levelsDraft, evidenceReceiptSha256: await sha256Hex(levelsDraft) };

const dataDir = path.resolve(here, '../src/data');
fs.writeFileSync(path.join(dataDir, 'elevation-datums.nashville.json'), `${JSON.stringify(elevationPacket, null, 2)}\n`);
fs.writeFileSync(path.join(dataDir, 'source-bound-footprints.nashville.json'), `${JSON.stringify(levelsPacket, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'passed',
  elevationReceiptSha256: elevationPacket.receiptSha256,
  footprintReceiptSha256: levelsPacket.evidenceReceiptSha256,
  levelCount: levelsPacket.levels.length,
  areasSqft: levelsPacket.levels.map((level) => level.areaSqft),
  registration: levelsPacket.levels[1].derivation.registration,
}, null, 2));
