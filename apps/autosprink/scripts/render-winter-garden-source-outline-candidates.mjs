import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';
import { extractLevelPlanFromPdf } from '../src/engine/plan-extract.js';

const ROOT = 'Y:\\Shared\\HaloOps';
const SOURCE_SET = new URL('../src/data/winter-garden-cross-project-source-set.json', import.meta.url);
const OUT_DIR = path.resolve(process.cwd(), 'out/visual-proof');

const sourceSet = JSON.parse(fs.readFileSync(SOURCE_SET, 'utf8'));
const floor = sourceSet.files.find((entry) => entry.phase === 'source_architecture' && entry.view === 'floor_plan');
const dimensionPlan = sourceSet.files.find((entry) => entry.phase === 'source_architecture' && entry.view === 'dimension_plan');
if (!floor || !dimensionPlan) throw new Error('Winter Garden source floor/dimension plans are not indexed.');
const pdfPath = path.join(ROOT, floor.path);
const bytes = fs.readFileSync(pdfPath);
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
if (digest !== floor.sha256) throw new Error(`Winter Garden A101 digest drift: ${digest}`);
const dimensionPath = path.join(ROOT, dimensionPlan.path);
const dimensionBytes = fs.readFileSync(dimensionPath);
const dimensionDigest = crypto.createHash('sha256').update(dimensionBytes).digest('hex');
if (dimensionDigest !== dimensionPlan.sha256) throw new Error(`Winter Garden A103 digest drift: ${dimensionDigest}`);

const variants = [
  { id: 'default', color: '#ff2d9b', options: {} },
  { id: 'all-wall-like-bridge-6ft', color: '#00c853', options: { outlineOpts: { networkMode: 'all-wall-like', minWallFt: 1, bridgeGapsFt: 6 } } },
  { id: 'all-wall-like-bridge-12ft', color: '#007aff', options: { outlineOpts: { networkMode: 'all-wall-like', minWallFt: 1, bridgeGapsFt: 12 } } },
];

const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
const document = await task.promise;
const page = await document.getPage(1);
const plans = [];
for (const variant of variants) {
  const plan = await extractLevelPlanFromPdf(page, variant.options);
  plans.push({ ...variant, plan });
}

const dimensionTask = pdfjsLib.getDocument({ data: new Uint8Array(dimensionBytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
const dimensionDocument = await dimensionTask.promise;
const dimensionPage = await dimensionDocument.getPage(1);
const dimensionText = (await dimensionPage.getTextContent()).items.map((entry) => entry.str).join(' ');
const parseFraction = (value) => {
  const match = String(value || '').trim().match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/);
  if (!match) return Number(value || 0);
  return Number(match[1] || 0) + Number(match[2]) / Number(match[3]);
};
const dimensionsFt = [...dimensionText.matchAll(/(\d+)'\s*-\s*(\d+)(?:\s+([0-9]+\s*\/\s*[0-9]+))?"/g)]
  .map((match) => Number(match[1]) + (Number(match[2]) + parseFraction(match[3])) / 12)
  .filter((value) => value >= 80);
const distinctDimensions = [...new Set(dimensionsFt.map((value) => Number(value.toFixed(4))))].sort((left, right) => right - left);
const [overallWidthFt, overallHeightFt] = distinctDimensions;
if (Math.abs(overallWidthFt - (201 + 8 / 12)) > 0.01 || Math.abs(overallHeightFt - (90 + 8 / 12)) > 0.01) {
  throw new Error(`A103 overall dimensions did not resolve as 201'-8" x 90'-8": ${distinctDimensions.join(', ')}`);
}

const baseCandidate = plans.find((entry) => entry.id === 'all-wall-like-bridge-12ft').plan;
const candidateBox = baseCandidate.footprintBboxFt;
const segmentLength = (wall) => Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
let bestY = candidateBox.minY;
let bestScore = -Infinity;
for (let y = candidateBox.minY; y <= candidateBox.maxY - overallHeightFt; y += 0.1) {
  const top = y + overallHeightFt;
  const score = baseCandidate.walls.reduce((sum, wall) => {
    const midpoint = (wall.a[1] + wall.b[1]) / 2;
    return sum + (midpoint >= y && midpoint <= top ? segmentLength(wall) : 0);
  }, 0);
  if (score > bestScore) { bestScore = score; bestY = y; }
}
const centerX = (candidateBox.minX + candidateBox.maxX) / 2;
const dimensionBounds = {
  minX: centerX - overallWidthFt / 2,
  maxX: centerX + overallWidthFt / 2,
  minY: bestY,
  maxY: bestY + overallHeightFt,
};
const clipHalfPlane = (polygon, inside, intersect) => {
  const output = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentInside = inside(current);
    const previousInside = inside(previous);
    if (currentInside) {
      if (!previousInside) output.push(intersect(previous, current));
      output.push(current);
    } else if (previousInside) output.push(intersect(previous, current));
  }
  return output;
};
let dimensionPolygon = baseCandidate.footprintFt.map((point) => [...point]);
dimensionPolygon = clipHalfPlane(dimensionPolygon, ([x]) => x >= dimensionBounds.minX, (a, b) => [dimensionBounds.minX, a[1] + (b[1] - a[1]) * (dimensionBounds.minX - a[0]) / (b[0] - a[0])]);
dimensionPolygon = clipHalfPlane(dimensionPolygon, ([x]) => x <= dimensionBounds.maxX, (a, b) => [dimensionBounds.maxX, a[1] + (b[1] - a[1]) * (dimensionBounds.maxX - a[0]) / (b[0] - a[0])]);
dimensionPolygon = clipHalfPlane(dimensionPolygon, ([, y]) => y >= dimensionBounds.minY, (a, b) => [a[0] + (b[0] - a[0]) * (dimensionBounds.minY - a[1]) / (b[1] - a[1]), dimensionBounds.minY]);
dimensionPolygon = clipHalfPlane(dimensionPolygon, ([, y]) => y <= dimensionBounds.maxY, (a, b) => [a[0] + (b[0] - a[0]) * (dimensionBounds.maxY - a[1]) / (b[1] - a[1]), dimensionBounds.maxY]);
const polygonArea = (polygon) => Math.abs(polygon.reduce((sum, point, index) => {
  const next = polygon[(index + 1) % polygon.length];
  return sum + point[0] * next[1] - next[0] * point[1];
}, 0)) / 2;
plans.push({
  id: 'a101-walls-bounded-by-a103-overall-dimensions',
  color: '#ffcc00',
  plan: {
    ...baseCandidate,
    footprintFt: dimensionPolygon,
    footprintAreaSqft: Number(polygonArea(dimensionPolygon).toFixed(4)),
    footprintMethod: 'a101-wall-network-clipped-by-independent-a103-overall-dimensions',
    footprintBboxFt: { ...dimensionBounds, widthFt: overallWidthFt, heightFt: overallHeightFt },
  },
});

const rendered = await renderSheetToCanvas(pdfjsLib, { url: pdfPath, page: 1, targetPx: 4200 });
const canvas = rendered.canvas;
const context = canvas.getContext('2d');
const pixelsPerPoint = rendered.widthPx / rendered.widthPt;
const feetPerPoint = plans[0].plan.scaleFtPerUnit;
const toPixel = ([xFt, yFt]) => [xFt / feetPerPoint * pixelsPerPoint, canvas.height - yFt / feetPerPoint * pixelsPerPoint];

const drawPolygon = (polygon, color, width) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return;
  context.beginPath();
  polygon.forEach((point, index) => {
    const [x, y] = toPixel(point);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.closePath();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
};

for (const wall of plans[0].plan.walls) {
  const [ax, ay] = toPixel(wall.a);
  const [bx, by] = toPixel(wall.b);
  context.beginPath();
  context.moveTo(ax, ay);
  context.lineTo(bx, by);
  context.strokeStyle = 'rgba(0, 188, 212, 0.20)';
  context.lineWidth = 1;
  context.stroke();
}
for (const variant of plans) drawPolygon(variant.plan.footprintFt, variant.color, 7);

context.fillStyle = 'rgba(5, 10, 18, 0.88)';
context.fillRect(40, 40, 1350, 225);
context.font = 'bold 36px sans-serif';
context.fillStyle = '#ffffff';
context.fillText('WINTER GARDEN A101 - SOURCE-ONLY ENVELOPE EYE GATE', 70, 90);
context.font = '28px sans-serif';
plans.forEach((variant, index) => {
  context.fillStyle = variant.color;
  const p = variant.plan;
  context.fillText(`${variant.id}: ${p.footprintMethod}; ${Math.round(p.footprintAreaSqft).toLocaleString()} sqft; ${p.footprintFt.length} vertices`, 70, 140 + index * 48);
});

fs.mkdirSync(OUT_DIR, { recursive: true });
const imagePath = path.join(OUT_DIR, 'winter-garden-source-outline-candidates.png');
const jsonPath = path.join(OUT_DIR, 'winter-garden-source-outline-candidates.json');
fs.writeFileSync(imagePath, canvas.encodeSync ? canvas.encodeSync('png') : canvas.toBuffer('image/png'));
fs.writeFileSync(jsonPath, JSON.stringify({
  artifactType: 'halofire.source-outline-eye-gate.v1',
  projectId: sourceSet.projectId,
  source: { path: floor.path, sha256: digest, sheet: floor.sheet, physicalPage: 1 },
  independentDimensionSource: { path: dimensionPlan.path, sha256: dimensionDigest, sheet: dimensionPlan.sheet, physicalPage: 1, overallWidthFt, overallHeightFt },
  candidates: plans.map(({ id, color, plan }) => ({
    id, color, scaleText: plan.scaleText, scaleFtPerUnit: plan.scaleFtPerUnit,
    method: plan.footprintMethod, areaSqft: plan.footprintAreaSqft,
    bbox: plan.footprintBboxFt, vertexCount: plan.footprintFt.length,
  })),
  answerKeyUsed: false,
  promotedCandidate: null,
  status: 'eye-gate-required',
}, null, 2));
await task.destroy();
await dimensionTask.destroy();
console.log(JSON.stringify({ imagePath, jsonPath, sourceSha256: digest, answerKeyUsed: false }, null, 2));
