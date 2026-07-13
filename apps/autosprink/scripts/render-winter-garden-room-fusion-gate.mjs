import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';
import { clipSegmentsToBounds, deriveOverallDimensionViewport } from '../src/engine/dimension-plan.js';
import { deriveScaleFromText, segmentRooms } from '../src/engine/plan-extract.js';
import { extractSegmentsFromOpList, selectWallLayer } from '../src/engine/pdf-floorplan.js';
import { extractLabeledGridFrame, registerPointViaLabeledGrid } from '../src/engine/labeled-grid-registration.js';

const ROOT = 'Y:\\Shared\\HaloOps';
const SOURCE_SET = new URL('../src/data/winter-garden-cross-project-source-set.json', import.meta.url);
const OUT_DIR = path.resolve(process.cwd(), 'out/visual-proof');
const sourceSet = JSON.parse(fs.readFileSync(SOURCE_SET, 'utf8'));
const entryFor = (view) => sourceSet.files.find((entry) => entry.phase === 'source_architecture' && entry.view === view);

async function loadSource(entry) {
  if (!entry) throw new Error('Winter Garden source index is incomplete.');
  const pdfPath = path.join(ROOT, entry.path);
  const bytes = fs.readFileSync(pdfPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== entry.sha256) throw new Error(`${entry.sheet} source digest drift: ${sha256}`);
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const document = await task.promise;
  const page = await document.getPage(1);
  const textContent = await page.getTextContent();
  const textItems = textContent.items.map((item) => ({ s: item.str, xPt: item.transform[4], yPt: item.transform[5], transform: item.transform }));
  return { entry, pdfPath, sha256, task, page, textItems, frame: extractLabeledGridFrame(textItems) };
}

const a103 = await loadSource(entryFor('dimension_plan'));
const a151 = await loadSource(entryFor('reflected_ceiling_plan'));
const scale = deriveScaleFromText(a103.textItems.map((item) => item.s).join(' '));
if (!scale) throw new Error('A103 drawing scale is unreadable.');
const dimensionViewport = deriveOverallDimensionViewport(a103.textItems, { scaleFtPerUnit: scale.feetPerUnit, minOverallFt: 80 });

const extracted103 = extractSegmentsFromOpList(await a103.page.getOperatorList(), { scale: scale.feetPerUnit });
const clipped103 = clipSegmentsToBounds(extracted103.segments, dimensionViewport.boundsFt);
const cut103 = selectWallLayer(clipped103).wallSegments;
const inclusive103 = selectWallLayer(clipped103, { partitionInclusive: true }).wallSegments;

const extracted151 = extractSegmentsFromOpList(await a151.page.getOperatorList(), { scale: 1 });
const mapped151 = extracted151.segments.map((segment) => {
  const a = registerPointViaLabeledGrid([segment.x1, segment.y1], a151.frame, a103.frame);
  const b = registerPointViaLabeledGrid([segment.x2, segment.y2], a151.frame, a103.frame);
  return {
    ...segment,
    x1: a[0] * scale.feetPerUnit,
    y1: a[1] * scale.feetPerUnit,
    x2: b[0] * scale.feetPerUnit,
    y2: b[1] * scale.feetPerUnit,
  };
});
const clipped151 = clipSegmentsToBounds(mapped151, dimensionViewport.boundsFt);
const cut151 = selectWallLayer(clipped151).wallSegments;
const inclusive151 = selectWallLayer(clipped151, { partitionInclusive: true }).wallSegments;

const labels103 = a103.textItems.map((item) => ({ s: item.s, xFt: item.xPt * scale.feetPerUnit, yFt: item.yPt * scale.feetPerUnit }));
const labels151 = a151.textItems.map((item) => {
  const point = registerPointViaLabeledGrid([item.xPt, item.yPt], a151.frame, a103.frame);
  return { s: item.s, xFt: point[0] * scale.feetPerUnit, yFt: point[1] * scale.feetPerUnit };
});
const labels = [...labels103, ...labels151];

const wallSets = [
  { id: 'a103-inclusive', walls: inclusive103 },
  { id: 'a103-inclusive-plus-a151-cut', walls: [...inclusive103, ...cut151] },
  { id: 'a103-cut-plus-a151-inclusive', walls: [...cut103, ...inclusive151] },
  { id: 'a103-inclusive-plus-a151-inclusive', walls: [...inclusive103, ...inclusive151] },
];
const collinearBridgeValues = [2, 3, 4, 6];
const candidates = wallSets.flatMap((wallSet) => collinearBridgeValues.map((collinearBridgeFt) => {
  const bridgeFt = 0.5;
  const result = segmentRooms(wallSet.walls, labels, { gridN: 480, bridgeFt, collinearBridgeFt, minRoomSqft: 30 });
  const labeled = result.rooms.filter((room) => room.label).length;
  const known = result.rooms.filter((room) => room.kind !== 'unknown').length;
  const totalAreaSqft = result.rooms.reduce((sum, room) => sum + room.areaSqft, 0);
  return {
    id: `${wallSet.id}-collinear-bridge-${collinearBridgeFt}`,
    wallSet: wallSet.id,
    bridgeFt,
    collinearBridgeFt,
    wallCount: wallSet.walls.length,
    roomCount: result.rooms.length,
    labeledRoomCount: labeled,
    knownKindCount: known,
    totalAreaSqft: Number(totalAreaSqft.toFixed(3)),
    rooms: result.rooms,
  };
}));

// This is an evidence board, not an auto-promotion score. Hold the geometric closure constant
// and compare source-wall combinations so ceiling grid/light linework cannot silently masquerade
// as room boundaries.
const selected = candidates.filter((candidate) => candidate.wallSet === 'a103-inclusive-plus-a151-cut');
const rendered = await renderSheetToCanvas(pdfjsLib, { url: a103.pdfPath, page: 1, targetPx: 2500 });
const sourceViewport = a103.page.getViewport({ scale: rendered.widthPx / a103.page.getViewport({ scale: 1 }).width });
const panelWidth = 1500;
const panelHeight = Math.round(panelWidth * rendered.heightPx / rendered.widthPx);
const headerHeight = 150;
const composite = createCanvas(panelWidth * 2, (panelHeight + headerHeight) * 2);
const context = composite.getContext('2d');
context.fillStyle = '#07111f'; context.fillRect(0, 0, composite.width, composite.height);

selected.forEach((candidate, index) => {
  const col = index % 2; const row = Math.floor(index / 2);
  const ox = col * panelWidth; const oy = row * (panelHeight + headerHeight);
  context.fillStyle = '#07111f'; context.fillRect(ox, oy, panelWidth, headerHeight);
  context.fillStyle = '#ffffff'; context.font = 'bold 30px sans-serif';
  context.fillText(`${candidate.wallSet.toUpperCase()} · ${candidate.collinearBridgeFt} FT DOOR CLOSURE`, ox + 28, oy + 42);
  context.font = '21px sans-serif'; context.fillStyle = '#a7f3d0';
  context.fillText(`${candidate.roomCount} exact component boundaries · ${candidate.wallCount} source wall segments · ${candidate.totalAreaSqft.toFixed(0)} sqft interior`, ox + 28, oy + 82);
  context.fillStyle = '#fbbf24'; context.fillText('architecture only · completed sprinkler answer key NOT LOADED · eye gate required', ox + 28, oy + 118);
  context.drawImage(rendered.canvas, ox, oy + headerHeight, panelWidth, panelHeight);
  const scalePanel = panelWidth / rendered.widthPx;
  const pointToPanel = ([xFt, yFt]) => {
    const [px, py] = sourceViewport.convertToViewportPoint(xFt / scale.feetPerUnit, yFt / scale.feetPerUnit);
    return [ox + px * scalePanel, oy + headerHeight + py * scalePanel];
  };
  candidate.rooms.forEach((room, roomIndex) => {
    const color = room.kind === 'unknown' ? '#00e5ff' : '#ff2d9b';
    context.strokeStyle = color; context.lineWidth = 2.2;
    context.fillStyle = roomIndex % 2 ? 'rgba(0,229,255,0.10)' : 'rgba(255,45,155,0.10)';
    context.beginPath();
    room.poly.forEach((point, pointIndex) => {
      const [x, y] = pointToPanel(point);
      if (pointIndex === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.closePath(); context.fill(); context.stroke();
  });
});

fs.mkdirSync(OUT_DIR, { recursive: true });
const imagePath = path.join(OUT_DIR, 'winter-garden-room-fusion-gate.png');
const jsonPath = path.join(OUT_DIR, 'winter-garden-room-fusion-gate.json');
fs.writeFileSync(imagePath, composite.encodeSync('png'));
fs.writeFileSync(jsonPath, JSON.stringify({
  artifactType: 'halofire.winter-garden-room-fusion-gate.v1',
  projectId: sourceSet.projectId,
  sourceBindings: [a103, a151].map((source) => ({ sheet: source.entry.sheet, path: source.entry.path, sha256: source.sha256 })),
  scale,
  dimensionViewport,
  inputs: { a103Cut: cut103.length, a103Inclusive: inclusive103.length, a151Cut: cut151.length, a151Inclusive: inclusive151.length },
  candidates,
  answerKeyUsed: false,
  status: 'eye-gate-required',
}, null, 2));
await Promise.all([a103.task.destroy(), a151.task.destroy()]);
console.log(JSON.stringify({ imagePath, jsonPath, inputs: { a103Cut: cut103.length, a103Inclusive: inclusive103.length, a151Cut: cut151.length, a151Inclusive: inclusive151.length }, candidates: candidates.map(({ rooms, ...candidate }) => candidate), answerKeyUsed: false }, null, 2));
