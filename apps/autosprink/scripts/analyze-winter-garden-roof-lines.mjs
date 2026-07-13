import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';
import { clipSegmentsToBounds, deriveOverallDimensionViewport } from '../src/engine/dimension-plan.js';
import { deriveScaleFromText } from '../src/engine/plan-extract.js';
import { extractSegmentsFromOpList } from '../src/engine/pdf-floorplan.js';
import { extractLabeledGridFrame, registerPointViaLabeledGrid } from '../src/engine/labeled-grid-registration.js';
import { deriveOrthogonalGableRoofSkeleton } from '../src/engine/orthogonal-gable-roof-skeleton.js';

const ROOT = 'Y:\\Shared\\HaloOps';
const sourceSet = JSON.parse(fs.readFileSync(new URL('../src/data/winter-garden-cross-project-source-set.json', import.meta.url), 'utf8'));
const entryFor = (view) => sourceSet.files.find((entry) => entry.phase === 'source_architecture' && entry.view === view);
async function load(view) {
  const entry = entryFor(view); const pdfPath = path.join(ROOT, entry.path); const bytes = fs.readFileSync(pdfPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex'); if (sha256 !== entry.sha256) throw new Error(`${entry.sheet} digest drift`);
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const document = await task.promise; const page = await document.getPage(1); const text = await page.getTextContent();
  const textItems = text.items.map((item) => ({ s: item.str, xPt: item.transform[4], yPt: item.transform[5], transform: item.transform }));
  return { entry, task, page, textItems, frame: extractLabeledGridFrame(textItems) };
}

const a103 = await load('dimension_plan'); const a121 = await load('roof_plan');
const scale = deriveScaleFromText(a103.textItems.map((item) => item.s).join(' '));
const viewport = deriveOverallDimensionViewport(a103.textItems, { scaleFtPerUnit: scale.feetPerUnit, minOverallFt: 80 });
const raw = extractSegmentsFromOpList(await a121.page.getOperatorList(), { scale: 1 }).segments;
const mapped = raw.map((segment, rawIndex) => {
  const a = registerPointViaLabeledGrid([segment.x1, segment.y1], a121.frame, a103.frame);
  const b = registerPointViaLabeledGrid([segment.x2, segment.y2], a121.frame, a103.frame);
  return { ...segment, rawIndex, raw: { x1: segment.x1, y1: segment.y1, x2: segment.x2, y2: segment.y2 }, x1: a[0] * scale.feetPerUnit, y1: a[1] * scale.feetPerUnit, x2: b[0] * scale.feetPerUnit, y2: b[1] * scale.feetPerUnit };
});
const clipped = clipSegmentsToBounds(mapped, viewport.boundsFt);
const classify = (segment) => {
  const dx = segment.x2 - segment.x1; const dy = segment.y2 - segment.y1; const angle = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
  if (angle <= 2) return 'horizontal'; if (angle >= 88) return 'vertical'; if (Math.abs(angle - 45) <= 4) return 'diagonal45'; return 'other';
};
const key = (segment) => `${segment.strokeColor ?? 'null'}|${segment.lineWidth ?? 'null'}|${classify(segment)}`;
const groups = new Map();
for (const segment of clipped) {
  const lengthFt = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1); if (lengthFt < 4) continue;
  const k = key(segment); if (!groups.has(k)) groups.set(k, { key: k, count: 0, totalLengthFt: 0, maxLengthFt: 0, examples: [] });
  const group = groups.get(k); group.count += 1; group.totalLengthFt += lengthFt; group.maxLengthFt = Math.max(group.maxLengthFt, lengthFt);
  if (group.examples.length < 100) group.examples.push({ x1: segment.x1, y1: segment.y1, x2: segment.x2, y2: segment.y2, lengthFt });
}
const sorted = [...groups.values()].sort((left, right) => right.totalLengthFt - left.totalLengthFt);
const skeleton = deriveOrthogonalGableRoofSkeleton(clipped, {
  ridgeStyle: { strokeColor: '#4b4b4b', lineWidth: 0.36 },
  valleyStyle: { strokeColor: '#000000', lineWidth: 0.42 },
  featureStyle: { strokeColor: '#4b4b4b' },
  maxRidgeEndFeatures: 1,
  expectedGableCount: 4,
});
if (skeleton.status !== 'passed') throw new Error(`A121 roof skeleton blocked: ${JSON.stringify(skeleton.issues)}`);
const rendered = await renderSheetToCanvas(pdfjsLib, { url: path.join(ROOT, a121.entry.path), page: 1, targetPx: 3000 });
const pageViewport = a121.page.getViewport({ scale: rendered.widthPx / a121.page.getViewport({ scale: 1 }).width });
const board = createCanvas(rendered.widthPx, rendered.heightPx + 120); const context = board.getContext('2d');
context.fillStyle = '#07111f'; context.fillRect(0, 0, board.width, board.height); context.drawImage(rendered.canvas, 0, 120);
context.fillStyle = '#ffffff'; context.font = 'bold 34px sans-serif'; context.fillText('WINTER GARDEN A121 · SOURCE ROOF LINEWEIGHT / TOPOLOGY GATE', 35, 48);
context.font = '22px sans-serif'; context.fillStyle = '#fbbf24'; context.fillText('magenta: main roof outline/ridge · cyan: valley candidates · orange: heavier valley candidates · green: gable ridge candidates', 35, 88);
const styles = new Map([
  ['#4b4b4b|0.36|horizontal', '#ff2d9b'], ['#4b4b4b|0.36|vertical', '#00c853'],
  ['#000000|0.24|diagonal45', '#00e5ff'], ['#000000|0.42|diagonal45', '#ff9100'], ['#4b4b4b|0.36|diagonal45', '#d500f9'],
]);
for (const segment of clipped) {
  const lengthFt = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1); const color = styles.get(key(segment));
  if (!color || lengthFt < 5) continue;
  const [x1, y1] = pageViewport.convertToViewportPoint(segment.raw.x1, segment.raw.y1); const [x2, y2] = pageViewport.convertToViewportPoint(segment.raw.x2, segment.raw.y2);
  context.strokeStyle = color; context.lineWidth = 4; context.beginPath(); context.moveTo(x1, y1 + 120); context.lineTo(x2, y2 + 120); context.stroke();
}
const imagePath = path.resolve(process.cwd(), 'out/visual-proof/winter-garden-roof-line-topology-gate.png');
fs.writeFileSync(imagePath, board.encodeSync('png'));
const jsonPath = path.resolve(process.cwd(), 'out/visual-proof/winter-garden-roof-line-analysis.json');
const result = { scale, viewport, frames: { a103: a103.frame, a121: a121.frame }, rawCount: raw.length, clippedCount: clipped.length, skeleton, groups: sorted, imagePath };
fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ imagePath, jsonPath, skeleton, rawCount: raw.length, clippedCount: clipped.length }, null, 2));
await Promise.all([a103.task.destroy(), a121.task.destroy()]);
