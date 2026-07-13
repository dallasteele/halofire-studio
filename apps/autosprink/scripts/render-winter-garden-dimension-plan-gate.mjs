import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';
import {
  deriveOverallDimensionViewport,
  clipSegmentsToBounds,
  verifyDimensionViewportWallSupport,
} from '../src/engine/dimension-plan.js';
import {
  buildingOutlinePolygon,
  extractSegmentsFromOpList,
  selectWallLayer,
} from '../src/engine/pdf-floorplan.js';
import { deriveScaleFromText } from '../src/engine/plan-extract.js';

const ROOT = 'Y:\\Shared\\HaloOps';
const SOURCE_SET = new URL('../src/data/winter-garden-cross-project-source-set.json', import.meta.url);
const OUT_DIR = path.resolve(process.cwd(), 'out/visual-proof');
const sourceSet = JSON.parse(fs.readFileSync(SOURCE_SET, 'utf8'));
const source = sourceSet.files.find((entry) => entry.phase === 'source_architecture' && entry.view === 'dimension_plan');
if (!source) throw new Error('Winter Garden A103 dimension plan is not indexed.');

const pdfPath = path.join(ROOT, source.path);
const bytes = fs.readFileSync(pdfPath);
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
if (digest !== source.sha256) throw new Error(`Winter Garden A103 digest drift: ${digest}`);

const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
const document = await task.promise;
const page = await document.getPage(1);
const textContent = await page.getTextContent();
const rawItems = textContent.items.map((item) => ({
  s: item.str,
  xPt: item.transform[4],
  yPt: item.transform[5],
  transform: item.transform,
}));
const scale = deriveScaleFromText(rawItems.map((item) => item.s).join(' '));
if (!scale) throw new Error('A103 printed drawing scale is unreadable.');
const viewport = deriveOverallDimensionViewport(rawItems, {
  scaleFtPerUnit: scale.feetPerUnit,
  minOverallFt: 80,
});
const extracted = extractSegmentsFromOpList(await page.getOperatorList(), { scale: scale.feetPerUnit });
const clipped = clipSegmentsToBounds(extracted.segments, viewport.boundsFt);
const selected = selectWallLayer(clipped);
const inclusive = selectWallLayer(clipped, { partitionInclusive: true });
const wallSupport = verifyDimensionViewportWallSupport(inclusive.wallSegments, viewport, { minCoverage: 0.35, sideToleranceFt: 4 });
const cutOutline = buildingOutlinePolygon(selected.wallSegments, { networkMode: 'all-wall-like', minWallFt: 1, bridgeGapsFt: 2 });
const inclusiveOutline = buildingOutlinePolygon(inclusive.wallSegments, { networkMode: 'all-wall-like', minWallFt: 1, bridgeGapsFt: 6 });
const inclusiveOutline12 = buildingOutlinePolygon(inclusive.wallSegments, { networkMode: 'all-wall-like', minWallFt: 1, bridgeGapsFt: 12 });
if (clipped.length < 100 || selected.wallSegments.length < 100) {
  throw new Error(`A103 dimension viewport produced insufficient geometry: clipped=${clipped.length} walls=${selected.wallSegments.length}`);
}

const rendered = await renderSheetToCanvas(pdfjsLib, { url: pdfPath, page: 1, targetPx: 4200 });
const canvas = rendered.canvas;
const context = canvas.getContext('2d');
const pixelsPerPoint = rendered.widthPx / rendered.widthPt;
const toPixel = ([xFt, yFt]) => [
  xFt / scale.feetPerUnit * pixelsPerPoint,
  canvas.height - yFt / scale.feetPerUnit * pixelsPerPoint,
];
const drawSegments = (segments, color, width) => {
  context.strokeStyle = color;
  context.lineWidth = width;
  for (const segment of segments) {
    const [x1, y1] = toPixel([segment.x1, segment.y1]);
    const [x2, y2] = toPixel([segment.x2, segment.y2]);
    context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
  }
};
const drawPolygon = (polygon, color, width) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return;
  context.beginPath();
  polygon.forEach((point, index) => {
    const [x, y] = toPixel(point);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.closePath(); context.strokeStyle = color; context.lineWidth = width; context.stroke();
};

// Inclusive first (partition recall), then the single dominant cut-wall band.
drawSegments(inclusive.wallSegments, 'rgba(0, 200, 83, 0.28)', 2);
drawSegments(selected.wallSegments, 'rgba(255, 45, 155, 0.72)', 3);
drawPolygon(cutOutline.polygon, '#00bcd4', 7);
drawPolygon(inclusiveOutline.polygon, '#ff6d00', 7);
drawPolygon(inclusiveOutline12.polygon, '#aa00ff', 7);
const bounds = viewport.boundsFt;
const [left, top] = toPixel([bounds.minX, bounds.maxY]);
const [right, bottom] = toPixel([bounds.maxX, bounds.minY]);
context.strokeStyle = '#ffcc00';
context.lineWidth = 8;
context.strokeRect(left, top, right - left, bottom - top);

context.fillStyle = 'rgba(5, 10, 18, 0.90)';
context.fillRect(40, 40, 1780, 415);
context.fillStyle = '#ffffff';
context.font = 'bold 36px sans-serif';
context.fillText('WINTER GARDEN A103 - DIMENSION-SEALED SOURCE EYE GATE', 70, 92);
context.font = '27px sans-serif';
context.fillStyle = '#ffcc00';
context.fillText(`yellow: authored overall bounds ${viewport.widthFt.toFixed(3)} ft x ${viewport.heightFt.toFixed(3)} ft`, 70, 143);
context.fillStyle = '#ff2d9b';
context.fillText(`magenta: selected cut-wall band (${selected.wallSegments.length.toLocaleString()} segments)`, 70, 190);
context.fillStyle = '#00c853';
context.fillText(`green: partition-inclusive recall (${inclusive.wallSegments.length.toLocaleString()} segments)`, 70, 237);
context.fillStyle = '#ffffff';
context.fillText('answer key used: NO | promotion: EYE GATE REQUIRED', 70, 284);
context.fillStyle = '#00bcd4';
context.fillText(`cyan: cut-wall exterior trace ${Math.round(cutOutline.areaSqft).toLocaleString()} sqft / ${cutOutline.polygon.length} vertices`, 70, 331);
context.fillStyle = '#ff6d00';
context.fillText(`orange: inclusive 6-ft gap trace ${Math.round(inclusiveOutline.areaSqft).toLocaleString()} sqft / ${inclusiveOutline.polygon.length} vertices`, 70, 378);
context.fillStyle = '#aa00ff';
context.fillText(`purple: inclusive 12-ft gap trace ${Math.round(inclusiveOutline12.areaSqft).toLocaleString()} sqft / ${inclusiveOutline12.polygon.length} vertices`, 70, 425);

fs.mkdirSync(OUT_DIR, { recursive: true });
const imagePath = path.join(OUT_DIR, 'winter-garden-a103-dimension-plan-gate.png');
const jsonPath = path.join(OUT_DIR, 'winter-garden-a103-dimension-plan-gate.json');
fs.writeFileSync(imagePath, canvas.encodeSync ? canvas.encodeSync('png') : canvas.toBuffer('image/png'));
fs.writeFileSync(jsonPath, JSON.stringify({
  artifactType: 'halofire.dimension-plan-eye-gate.v1',
  projectId: sourceSet.projectId,
  source: { path: source.path, sha256: digest, sheet: source.sheet, physicalPage: 1 },
  scale,
  viewport,
  counts: {
    sourceSegments: extracted.segments.length,
    clippedSegments: clipped.length,
    cutWallSegments: selected.wallSegments.length,
    inclusiveWallSegments: inclusive.wallSegments.length,
  },
  wallSelection: { cut: selected, inclusive },
  outlines: {
    cut: { method: cutOutline.method, areaSqft: cutOutline.areaSqft, bbox: cutOutline.bbox, polygon: cutOutline.polygon },
    inclusive6: { method: inclusiveOutline.method, areaSqft: inclusiveOutline.areaSqft, bbox: inclusiveOutline.bbox, polygon: inclusiveOutline.polygon },
    inclusive12: { method: inclusiveOutline12.method, areaSqft: inclusiveOutline12.areaSqft, bbox: inclusiveOutline12.bbox, polygon: inclusiveOutline12.polygon },
  },
  wallSupport,
  answerKeyUsed: false,
  promoted: false,
  status: 'eye-gate-required',
}, null, 2));
await task.destroy();
console.log(JSON.stringify({ imagePath, jsonPath, viewport, wallSupport, counts: { clipped: clipped.length, selected: selected.wallSegments.length, inclusive: inclusive.wallSegments.length } }, null, 2));
