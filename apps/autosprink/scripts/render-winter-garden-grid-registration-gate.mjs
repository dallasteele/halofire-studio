import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';
import { clipSegmentsToBounds, deriveOverallDimensionViewport, verifyDimensionViewportWallSupport } from '../src/engine/dimension-plan.js';
import { buildLevelPlan, deriveScaleFromText } from '../src/engine/plan-extract.js';
import { buildingOutlinePolygon, extractSegmentsFromOpList, selectWallLayer } from '../src/engine/pdf-floorplan.js';
import {
  extractLabeledGridFrame,
  registerPointViaLabeledGrid,
  verifyLabeledGridRegistration,
} from '../src/engine/labeled-grid-registration.js';

const ROOT = 'Y:\\Shared\\HaloOps';
const SOURCE_SET = new URL('../src/data/winter-garden-cross-project-source-set.json', import.meta.url);
const OUT_DIR = path.resolve(process.cwd(), 'out/visual-proof');
const sourceSet = JSON.parse(fs.readFileSync(SOURCE_SET, 'utf8'));
const wanted = ['dimension_plan', 'roof_plan', 'reflected_ceiling_plan'];
const entries = Object.fromEntries(wanted.map((view) => [view, sourceSet.files.find((entry) => entry.phase === 'source_architecture' && entry.view === view)]));
if (Object.values(entries).some((entry) => !entry)) throw new Error('Winter Garden A103/A121/A151 source index is incomplete.');

async function loadSource(entry) {
  const pdfPath = path.join(ROOT, entry.path);
  const bytes = fs.readFileSync(pdfPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== entry.sha256) throw new Error(`${entry.sheet} source digest drift: ${sha256}`);
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const document = await task.promise;
  const page = await document.getPage(1);
  const textContent = await page.getTextContent();
  const textItems = textContent.items.map((item) => ({ s: item.str, xPt: item.transform[4], yPt: item.transform[5], transform: item.transform }));
  return { entry, pdfPath, bytes, sha256, task, page, textItems, frame: extractLabeledGridFrame(textItems) };
}

const a103 = await loadSource(entries.dimension_plan);
const a121 = await loadSource(entries.roof_plan);
const a151 = await loadSource(entries.reflected_ceiling_plan);
const scale = deriveScaleFromText(a103.textItems.map((item) => item.s).join(' '));
if (!scale) throw new Error('A103 drawing scale is unreadable.');
const dimensionViewport = deriveOverallDimensionViewport(a103.textItems, { scaleFtPerUnit: scale.feetPerUnit, minOverallFt: 80 });
const extracted = extractSegmentsFromOpList(await a103.page.getOperatorList(), { scale: scale.feetPerUnit });
const clipped = clipSegmentsToBounds(extracted.segments, dimensionViewport.boundsFt);
const cut = selectWallLayer(clipped);
const inclusive = selectWallLayer(clipped, { partitionInclusive: true });
const outline = buildingOutlinePolygon(inclusive.wallSegments, { networkMode: 'all-wall-like', minWallFt: 1, bridgeGapsFt: 12 });
const wallSupport = verifyDimensionViewportWallSupport(inclusive.wallSegments, dimensionViewport, { minCoverage: 0.35, sideToleranceFt: 4 });
if (wallSupport.status !== 'passed' || outline.polygon.length < 20) throw new Error('A103 dimension-bounded exterior did not pass vector support.');
const levelPlan = buildLevelPlan({
  segments: clipped,
  textItemsFt: a103.textItems.map((item) => ({ s: item.s, xFt: item.xPt * scale.feetPerUnit, yFt: item.yPt * scale.feetPerUnit })),
  scaleFtPerUnit: scale.feetPerUnit,
  scaleText: scale.scaleText,
}, { preselectedWallSegmentsFt: inclusive.wallSegments, parkingOpts: { enabled: false } });

const registrations = {
  a121ToA103: verifyLabeledGridRegistration(a121.frame, a103.frame),
  a151ToA103: verifyLabeledGridRegistration(a151.frame, a103.frame),
};
if (Object.values(registrations).some((result) => result.status !== 'passed')) throw new Error('Shared-grid registration did not replay all controls.');

async function renderPanel(source, label, overlayColor) {
  const rendered = await renderSheetToCanvas(pdfjsLib, { url: source.pdfPath, page: 1, targetPx: 2500 });
  const viewport = source.page.getViewport({ scale: rendered.widthPx / source.page.getViewport({ scale: 1 }).width });
  const context = rendered.canvas.getContext('2d');
  const a103PointToPixel = (pointFt) => {
    const point103 = pointFt.map((value) => value / scale.feetPerUnit);
    const sourcePoint = source === a103 ? point103 : registerPointViaLabeledGrid(point103, a103.frame, source.frame);
    return viewport.convertToViewportPoint(sourcePoint[0], sourcePoint[1]);
  };
  context.strokeStyle = overlayColor;
  context.lineWidth = 1.4;
  for (const wall of cut.wallSegments) {
    const [x1, y1] = a103PointToPixel([wall.x1, wall.y1]);
    const [x2, y2] = a103PointToPixel([wall.x2, wall.y2]);
    context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
  }
  context.strokeStyle = '#aa00ff';
  context.lineWidth = 5;
  context.beginPath();
  outline.polygon.forEach((point, index) => {
    const [x, y] = a103PointToPixel(point);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.closePath(); context.stroke();
  context.fillStyle = 'rgba(5, 10, 18, 0.88)';
  context.fillRect(24, 24, 1160, 128);
  context.fillStyle = '#ffffff'; context.font = 'bold 30px sans-serif'; context.fillText(label, 48, 68);
  context.font = '22px sans-serif'; context.fillStyle = overlayColor; context.fillText('registered A103 cut walls', 48, 106);
  context.fillStyle = '#aa00ff'; context.fillText('promoted dimension-bounded exterior candidate', 360, 106);
  context.fillStyle = '#ffffff'; context.fillText('answer key: NOT LOADED', 48, 140);
  return rendered;
}

const panels = [
  await renderPanel(a103, 'A103 · DIMENSION PLAN / SOURCE FLOOR GEOMETRY', '#ff2d9b'),
  await renderPanel(a121, 'A121 · ROOF PLAN / SHARED-GRID REGISTRATION', '#00bcd4'),
  await renderPanel(a151, 'A151 · RCP / SHARED-GRID REGISTRATION', '#00c853'),
];
const headerHeight = 170;
const composite = createCanvas(panels.reduce((sum, panel) => sum + panel.widthPx, 0), headerHeight + Math.max(...panels.map((panel) => panel.heightPx)));
const context = composite.getContext('2d');
context.fillStyle = '#07111f'; context.fillRect(0, 0, composite.width, composite.height);
context.fillStyle = '#ffffff'; context.font = 'bold 48px sans-serif'; context.fillText('WINTER GARDEN · SOURCE-ONLY FLOOR / ROOF / CEILING REGISTRATION GATE', 55, 68);
context.font = '27px sans-serif'; context.fillStyle = '#a7f3d0';
context.fillText(`A103 ${dimensionViewport.widthFt.toFixed(3)} ft × ${dimensionViewport.heightFt.toFixed(3)} ft · ${levelPlan.wallRuns.length} merged wall runs · piecewise grids replay at 0 pt`, 55, 112);
context.fillStyle = '#fbbf24'; context.fillText('Generated from architecture only · completed sprinkler sheets remain held out', 55, 150);
let x = 0;
for (const panel of panels) { context.drawImage(panel.canvas, x, headerHeight); x += panel.widthPx; }

fs.mkdirSync(OUT_DIR, { recursive: true });
const imagePath = path.join(OUT_DIR, 'winter-garden-grid-registration-gate.png');
const jsonPath = path.join(OUT_DIR, 'winter-garden-grid-registration-gate.json');
fs.writeFileSync(imagePath, composite.encodeSync('png'));
fs.writeFileSync(jsonPath, JSON.stringify({
  artifactType: 'halofire.winter-garden-source-grid-registration-gate.v1',
  projectId: sourceSet.projectId,
  sources: [a103, a121, a151].map((source) => ({ sheet: source.entry.sheet, path: source.entry.path, sha256: source.sha256 })),
  dimensionViewport,
  exterior: { method: outline.method, areaSqft: outline.areaSqft, vertexCount: outline.polygon.length, polygonFt: outline.polygon, wallSupport },
  levelPlan: { scale, wallSegmentCount: cut.wallSegments.length, wallRunCount: levelPlan.wallRuns.length, roomCount: levelPlan.rooms.length, roomKinds: levelPlan.roomKinds },
  registrations,
  answerKeyUsed: false,
  visualGateStatus: 'eye-gate-required',
}, null, 2));
await Promise.all([a103.task.destroy(), a121.task.destroy(), a151.task.destroy()]);
console.log(JSON.stringify({ imagePath, jsonPath, registrations, outline: { areaSqft: outline.areaSqft, vertices: outline.polygon.length }, wallRuns: levelPlan.wallRuns.length, rooms: levelPlan.rooms.length, roomKinds: levelPlan.roomKinds, answerKeyUsed: false }, null, 2));
