import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';
import { deriveScaleFromText } from '../src/engine/plan-extract.js';
import { extractLabeledGridFrame, registerPointViaLabeledGrid } from '../src/engine/labeled-grid-registration.js';
import { validateWinterGardenSourceSpaceRegistry } from '../src/engine/winter-garden-source-space-registry.js';

const ROOT = 'Y:\\Shared\\HaloOps';
const OUT_DIR = path.resolve(process.cwd(), 'out/visual-proof');
const sourceSet = JSON.parse(fs.readFileSync(new URL('../src/data/winter-garden-cross-project-source-set.json', import.meta.url), 'utf8'));
const registry = JSON.parse(fs.readFileSync(new URL('../src/data/winter-garden-source-space-registry.json', import.meta.url), 'utf8'));
const validation = await validateWinterGardenSourceSpaceRegistry(registry);
if (validation.status !== 'passed') throw new Error(`Source-space registry is blocked: ${JSON.stringify(validation.issues)}`);
const entryFor = (sheet) => sourceSet.files.find((entry) => entry.phase === 'source_architecture' && entry.sheet === sheet);

async function load(sheet) {
  const entry = entryFor(sheet);
  const pdfPath = path.join(ROOT, entry.path);
  const bytes = fs.readFileSync(pdfPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== entry.sha256) throw new Error(`${sheet} source digest drift: ${sha256}`);
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const document = await task.promise;
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  const textItems = content.items.map((item) => ({ s: String(item.str || '').trim(), xPt: item.transform[4], yPt: item.transform[5], transform: item.transform })).filter((item) => item.s);
  const rendered = await renderSheetToCanvas(pdfjsLib, { url: pdfPath, page: 1, targetPx: 2500 });
  return { entry, pdfPath, task, page, textItems, frame: extractLabeledGridFrame(textItems), rendered };
}

const [a101, a103, a151] = await Promise.all(['A101', 'A103', 'A151'].map(load));
const scale = deriveScaleFromText(a103.textItems.map((item) => item.s).join(' '));
if (!scale) throw new Error('A103 scale is unreadable.');
const panelWidth = 1500;
const panelHeight = 1170;
const headerHeight = 230;
const canvas = createCanvas(panelWidth * 2, headerHeight + panelHeight);
const context = canvas.getContext('2d');
context.fillStyle = '#07111f'; context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = '#ffffff'; context.font = 'bold 45px sans-serif'; context.fillText('WINTER GARDEN · SOURCE ROOM + CEILING REGISTRY', 48, 60);
context.fillStyle = '#a7f3d0'; context.font = '26px sans-serif'; context.fillText('Current Halo Fire operations brain v3 · 11 sources · 13 applied decisions · internal primary / independent / adversarial loops', 48, 106);
context.fillStyle = '#fbbf24'; context.fillText('54 A101 room identities · 50 single-anchor components · 61 A151 ceiling controls / 57 height-resolved · 0 layout-ready rooms', 48, 151);
context.fillStyle = '#fb7185'; context.fillText('Amber boundaries are SOURCE COMPONENTS, not verified whole rooms · no heads · no hydraulics · no compliance or fabrication claim', 48, 196);

function drawPanel(source, panelX, label) {
  const image = source.rendered.canvas;
  const fit = Math.min(panelWidth / image.width, panelHeight / image.height);
  const width = image.width * fit;
  const height = image.height * fit;
  const x = panelX + (panelWidth - width) / 2;
  const y = headerHeight + (panelHeight - height) / 2;
  context.drawImage(image, x, y, width, height);
  context.fillStyle = 'rgba(7,17,31,.9)'; context.fillRect(panelX, headerHeight, panelWidth, 54);
  context.fillStyle = '#ffffff'; context.font = 'bold 25px sans-serif'; context.fillText(label, panelX + 24, headerHeight + 36);
  const viewport = source.page.getViewport({ scale: source.rendered.widthPx / source.page.getViewport({ scale: 1 }).width });
  const sourcePointToCanvas = (pointPt) => {
    const [px, py] = viewport.convertToViewportPoint(pointPt[0], pointPt[1]);
    return [x + px * fit, y + py * fit];
  };
  return sourcePointToCanvas;
}

const a101ToCanvas = drawPanel(a101, 0, 'A101 MAIN FLOOR · authoritative numbered room identities + source-wall components');
const a151ToCanvas = drawPanel(a151, panelWidth, 'A151 RCP · ceiling types, heights, and sloped controls registered through structural grids');
const registeredFtToSource = (pointFt, target) => registerPointViaLabeledGrid(pointFt.map((value) => value / scale.feetPerUnit), a103.frame, target.frame);

for (const space of registry.spaces) {
  const polygon = space.geometry?.polygon;
  if (Array.isArray(polygon)) {
    context.beginPath();
    polygon.forEach((point, index) => {
      const canvasPoint = a101ToCanvas(registeredFtToSource(point, a101));
      if (index === 0) context.moveTo(...canvasPoint); else context.lineTo(...canvasPoint);
    });
    context.closePath();
    context.fillStyle = 'rgba(251,191,36,.12)'; context.strokeStyle = '#fbbf24'; context.lineWidth = 2;
    context.fill(); context.stroke();
  }
  const anchor = a101ToCanvas(registeredFtToSource(space.sourceAnchorFt, a101));
  context.beginPath(); context.arc(anchor[0], anchor[1], 5.5, 0, Math.PI * 2);
  context.fillStyle = polygon ? '#22d3ee' : '#fb7185'; context.fill();
  context.font = 'bold 11px sans-serif'; context.fillStyle = '#07111f'; context.fillText(space.roomNumber, anchor[0] - 8, anchor[1] + 4);
}

for (const control of registry.ceilingEvidence.controlsData) {
  const point = a151ToCanvas(registeredFtToSource(control.registeredPointFt, a151));
  context.beginPath(); context.arc(point[0], point[1], control.sloped ? 7 : 5, 0, Math.PI * 2);
  context.fillStyle = control.sloped ? '#f472b6' : control.heightFt != null ? '#22d3ee' : '#fbbf24';
  context.fill(); context.strokeStyle = '#07111f'; context.lineWidth = 1; context.stroke();
}

context.fillStyle = 'rgba(7,17,31,.92)'; context.fillRect(28, canvas.height - 58, canvas.width - 56, 38);
context.font = '20px sans-serif'; context.fillStyle = '#fbbf24'; context.fillText('A101: amber = unverified full-room boundary; cyan anchor = one source room tag; red anchor = no unique component', 48, canvas.height - 31);
context.fillStyle = '#22d3ee'; context.fillText('A151: cyan = height resolved', 1700, canvas.height - 31);
context.fillStyle = '#f472b6'; context.fillText('magenta = sloped', 2125, canvas.height - 31);
context.fillStyle = '#fbbf24'; context.fillText('yellow = unresolved height', 2425, canvas.height - 31);

fs.mkdirSync(OUT_DIR, { recursive: true });
const imagePath = path.join(OUT_DIR, 'winter-garden-source-space-registry-proof.png');
const jsonPath = path.join(OUT_DIR, 'winter-garden-source-space-registry-proof.json');
fs.writeFileSync(imagePath, canvas.encodeSync('png'));
const proof = {
  artifactType: 'halofire.winter-garden-source-space-registry-proof.v1',
  sourceBindings: registry.sourceBindings,
  registryReceiptSha256: registry.receiptSha256,
  operationalKnowledge: { artifactType: registry.operationalKnowledge.artifactType, sourceCount: registry.operationalKnowledge.coverage.sourceCount, appliedDecisionCount: registry.operationalKnowledge.coverage.appliedDecisionCount },
  counts: registry.counts,
  ceilingEvidence: { controls: registry.ceilingEvidence.controls, heightResolved: registry.ceilingEvidence.heightResolved, slopedControls: registry.ceilingEvidence.slopedControls },
  answerKeyUsed: false,
  wholeRoomBoundaryComplete: false,
  sprinklerCandidateReadyRooms: 0,
  complianceReady: false,
  fabricationReady: false,
  imageSha256: crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex'),
};
fs.writeFileSync(jsonPath, `${JSON.stringify(proof, null, 2)}\n`);
await Promise.all([a101.task.destroy(), a103.task.destroy(), a151.task.destroy()]);
console.log(JSON.stringify({ imagePath, jsonPath, proof }, null, 2));
