import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';
import { deriveScaleFromText } from '../src/engine/plan-extract.js';
import { validateWinterGardenSourceSpaceTopology } from '../src/engine/winter-garden-source-space-topology.js';

const ROOT = 'Y:\\Shared\\HaloOps';
const OUT_DIR = path.resolve(process.cwd(), 'out/visual-proof');
const sourceSet = JSON.parse(fs.readFileSync(new URL('../src/data/winter-garden-cross-project-source-set.json', import.meta.url), 'utf8'));
const topology = JSON.parse(fs.readFileSync(new URL('../src/data/winter-garden-source-space-topology.json', import.meta.url), 'utf8'));
const registry = JSON.parse(fs.readFileSync(new URL('../src/data/winter-garden-source-space-registry.json', import.meta.url), 'utf8'));
const validation = await validateWinterGardenSourceSpaceTopology(topology);
if (validation.status !== 'passed') throw new Error(`Source-space topology is blocked: ${JSON.stringify(validation.issues)}`);
const entryFor = (sheet) => sourceSet.files.find((entry) => entry.phase === 'source_architecture' && entry.sheet === sheet);

async function load(sheet, targetPx) {
  const entry = entryFor(sheet);
  const pdfPath = path.join(ROOT, entry.path);
  const bytes = fs.readFileSync(pdfPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== entry.sha256) throw new Error(`${sheet} source digest drift: ${sha256}`);
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const document = await task.promise;
  const page = await document.getPage(1);
  const text = await page.getTextContent();
  const textItems = text.items.map((item) => ({ s: String(item.str || '').trim(), xPt: item.transform[4], yPt: item.transform[5], widthPt: item.width, heightPt: item.height })).filter((item) => item.s);
  const rendered = await renderSheetToCanvas(pdfjsLib, { url: pdfPath, page: 1, targetPx });
  return { entry, pdfPath, task, page, textItems, rendered };
}

const [a103, a303] = await Promise.all([load('A103', 3000), load('A303', 2100)]);
const scale = deriveScaleFromText(a103.textItems.map((item) => item.s).join(' '));
if (!scale) throw new Error('A103 source scale is unreadable.');

const canvas = createCanvas(3600, 1900);
const context = canvas.getContext('2d');
context.fillStyle = '#07111f'; context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = '#ffffff'; context.font = 'bold 52px sans-serif'; context.fillText('WINTER GARDEN · SOURCE-BOUND SPACE TOPOLOGY', 52, 68);
context.fillStyle = '#a7f3d0'; context.font = '27px sans-serif'; context.fillText('A103 primary topology · A101 + A151 independent wall replay · A303 coordinated section fallback · no completed sprinkler drawing used', 52, 118);
context.fillStyle = '#67e8f9'; context.fillText('45 physical protection envelopes · 54 identities assigned once · 53 topology-ready · 1 plan-boundary residual · 0 sprinkler-ready', 52, 161);
context.fillStyle = '#fda4af'; context.fillText('FAIL-CLOSED: room 146 remains section-confirmed / plan-boundary-limited · no head layout, compliance, fabrication, or field-release claim', 52, 204);

function drawSheet(source, bounds, label) {
  const image = source.rendered.canvas;
  const fit = Math.min(bounds.width / image.width, bounds.height / image.height);
  const width = image.width * fit;
  const height = image.height * fit;
  const x = bounds.x + (bounds.width - width) / 2;
  const y = bounds.y + (bounds.height - height) / 2;
  context.fillStyle = '#ffffff'; context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.drawImage(image, x, y, width, height);
  context.fillStyle = 'rgba(7,17,31,.92)'; context.fillRect(bounds.x, bounds.y, bounds.width, 58);
  context.fillStyle = '#ffffff'; context.font = 'bold 26px sans-serif'; context.fillText(label, bounds.x + 22, bounds.y + 39);
  const viewport = source.page.getViewport({ scale: source.rendered.widthPx / source.page.getViewport({ scale: 1 }).width });
  return (pointPt) => {
    const [px, py] = viewport.convertToViewportPoint(pointPt[0], pointPt[1]);
    return [x + px * fit, y + py * fit];
  };
}

const a103Bounds = { x: 38, y: 245, width: 2390, height: 1580 };
const a303Bounds = { x: 2462, y: 245, width: 1100, height: 1580 };
const a103ToCanvas = drawSheet(a103, a103Bounds, 'A103 DIMENSION PLAN · source envelopes and room anchors');
const a303ToCanvas = drawSheet(a303, a303Bounds, 'A303 BUILDING SECTIONS · explicit room 146 evidence');
const registeredFtToA103 = (point) => point.map((value) => value / scale.feetPerUnit);
const identityByNumber = new Map(registry.spaces.map((space) => [space.roomNumber, space]));

for (const zone of topology.zones) {
  const limited = !zone.topologyReady;
  context.beginPath();
  zone.geometry.polygon.forEach((point, index) => {
    const target = a103ToCanvas(registeredFtToA103(point));
    if (index === 0) context.moveTo(...target); else context.lineTo(...target);
  });
  context.closePath();
  context.fillStyle = limited ? 'rgba(244,63,94,.28)' : 'rgba(6,182,212,.14)';
  context.strokeStyle = limited ? '#fb7185' : '#06b6d4';
  context.lineWidth = limited ? 6 : 2.25;
  context.fill(); context.stroke();
  for (const roomNumber of zone.roomNumbers) {
    const identity = identityByNumber.get(roomNumber);
    if (!identity) continue;
    const anchor = a103ToCanvas(registeredFtToA103(identity.sourceAnchorFt));
    context.beginPath(); context.arc(anchor[0], anchor[1], limited ? 10 : 6.5, 0, Math.PI * 2);
    context.fillStyle = limited ? '#fb7185' : '#22d3ee'; context.fill();
    context.strokeStyle = '#07111f'; context.lineWidth = 2; context.stroke();
    context.font = limited ? 'bold 18px sans-serif' : 'bold 12px sans-serif';
    context.fillStyle = '#07111f'; context.fillText(roomNumber, anchor[0] + 8, anchor[1] - 7);
  }
}

const sectionWords = new Set(['ORGAN', 'SPEAKER', 'CHAMBER', '146']);
for (const item of a303.textItems.filter((entry) => sectionWords.has(entry.s.toUpperCase()))) {
  const topLeft = a303ToCanvas([item.xPt - 3, item.yPt + Math.max(10, item.heightPt || 10) + 3]);
  const bottomRight = a303ToCanvas([item.xPt + Math.max(20, item.widthPt || 20) + 3, item.yPt - 3]);
  const x = Math.min(topLeft[0], bottomRight[0]); const y = Math.min(topLeft[1], bottomRight[1]);
  const width = Math.abs(bottomRight[0] - topLeft[0]); const height = Math.abs(bottomRight[1] - topLeft[1]);
  context.fillStyle = 'rgba(244,63,94,.22)'; context.fillRect(x, y, width, height);
  context.strokeStyle = '#fb7185'; context.lineWidth = 3; context.strokeRect(x, y, width, height);
}

context.fillStyle = 'rgba(7,17,31,.94)'; context.fillRect(58, 1740, 2328, 66);
context.font = '22px sans-serif'; context.fillStyle = '#67e8f9'; context.fillText('CYAN = independently supported source envelope / anchor', 82, 1779);
context.fillStyle = '#fb7185'; context.fillText('RED = room 146 residual (A303 confirms enclosure, not plan boundary)', 910, 1779);
context.fillStyle = 'rgba(127,29,29,.92)'; context.fillRect(2490, 1688, 1044, 112);
context.fillStyle = '#fecaca'; context.font = 'bold 23px sans-serif'; context.fillText('ROOM 146 IS NOT PROMOTED', 2520, 1730);
context.font = '19px sans-serif'; context.fillText('Section evidence proves vertical enclosure only.', 2520, 1765);

fs.mkdirSync(OUT_DIR, { recursive: true });
const imagePath = path.join(OUT_DIR, 'winter-garden-source-space-topology-proof.png');
const jsonPath = path.join(OUT_DIR, 'winter-garden-source-space-topology-proof.json');
fs.writeFileSync(imagePath, canvas.encodeSync('png'));
const proof = {
  artifactType: 'halofire.winter-garden-source-space-topology-proof.v1',
  topologyReceiptSha256: topology.receiptSha256,
  sourceBindings: topology.sourceBindings,
  counts: topology.counts,
  unresolvedRoomNumbers: topology.unresolvedRoomNumbers,
  internalVerification: topology.internalVerification,
  answerKeyUsed: false,
  wholeBuildingTopologyComplete: false,
  wholeBuildingHeadLayoutReady: false,
  complianceReady: false,
  fabricationReady: false,
  imageSha256: crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex'),
};
fs.writeFileSync(jsonPath, `${JSON.stringify(proof, null, 2)}\n`);
await Promise.all([a103.task.destroy(), a303.task.destroy()]);
console.log(JSON.stringify({ imagePath, jsonPath, proof }, null, 2));
