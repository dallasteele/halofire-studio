import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';
import { deriveScaleFromText } from '../src/engine/plan-extract.js';
import { validateWinterGardenSourceSprinklerCandidates } from '../src/engine/winter-garden-source-sprinkler-candidates.js';

const ROOT = 'Y:\\Shared\\HaloOps';
const OUT_DIR = path.resolve(process.cwd(), 'apps/autosprink/src/data/proofs');
const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceSet = read('winter-garden-cross-project-source-set.json');
const packet = read('winter-garden-source-sprinkler-candidates.json');
const topology = read('winter-garden-source-space-topology.json');
const registry = read('winter-garden-source-space-registry.json');
const hazard = read('winter-garden-source-spec-hazard.json');
const building = read('winter-garden-source-building-model.json');
const validation = await validateWinterGardenSourceSprinklerCandidates(packet, { topology, registry, hazard, building });
if (validation.status !== 'passed') throw new Error(`Source sprinkler candidates are blocked: ${JSON.stringify(validation.issues)}`);

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
  const textItems = text.items.map((item) => ({ s: String(item.str || '').trim(), xPt: item.transform[4], yPt: item.transform[5] })).filter((item) => item.s);
  const rendered = await renderSheetToCanvas(pdfjsLib, { url: pdfPath, page: 1, targetPx });
  return { entry, pdfPath, task, page, textItems, rendered };
}

const [a103, a303] = await Promise.all([load('A103', 3000), load('A303', 2200)]);
const scale = deriveScaleFromText(a103.textItems.map((item) => item.s).join(' '));
if (!scale) throw new Error('A103 source scale is unreadable.');

const canvas = createCanvas(3600, 2000);
const context = canvas.getContext('2d');
context.fillStyle = '#07111f'; context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = '#ffffff'; context.font = 'bold 50px sans-serif'; context.fillText('WINTER GARDEN - SOURCE-ONLY SPRINKLER CANDIDATE PROOF', 48, 65);
context.fillStyle = '#67e8f9'; context.font = '25px sans-serif'; context.fillText('Actual A103 plan + actual A303 sections + source-extruded roof model - four sealed packets - no completed sprinkler answer key used', 48, 110);
context.fillStyle = '#fde68a'; context.fillText('2 preliminary flat candidates / 54 rooms - 3 sloped rooms blocked - coverage, obstructions, hydraulics, compliance, fabrication, and release NOT verified', 48, 151);

function drawSheet(source, panel, label) {
  const image = source.rendered.canvas;
  const fit = Math.min(panel.width / image.width, panel.height / image.height);
  const width = image.width * fit; const height = image.height * fit;
  const x = panel.x + (panel.width - width) / 2; const y = panel.y + (panel.height - height) / 2;
  context.fillStyle = '#ffffff'; context.fillRect(panel.x, panel.y, panel.width, panel.height);
  context.drawImage(image, x, y, width, height);
  context.fillStyle = 'rgba(7,17,31,.92)'; context.fillRect(panel.x, panel.y, panel.width, 58);
  context.fillStyle = '#ffffff'; context.font = 'bold 25px sans-serif'; context.fillText(label, panel.x + 20, panel.y + 38);
  const viewport = source.page.getViewport({ scale: source.rendered.widthPx / source.page.getViewport({ scale: 1 }).width });
  return (pointPt) => { const [px, py] = viewport.convertToViewportPoint(pointPt[0], pointPt[1]); return [x + px * fit, y + py * fit]; };
}

const planPanel = { x: 38, y: 190, width: 2310, height: 1740 };
const sectionPanel = { x: 2380, y: 190, width: 1180, height: 820 };
const modelPanel = { x: 2380, y: 1040, width: 1180, height: 890 };
const a103ToCanvas = drawSheet(a103, planPanel, 'A103 DIMENSION PLAN - source-plan candidate overlay');
drawSheet(a303, sectionPanel, 'A303 BUILDING SECTIONS - vertical source evidence');
const registeredFtToA103 = (point) => point.map((value) => value / scale.feetPerUnit);

for (const candidate of packet.candidates) {
  const point = a103ToCanvas(registeredFtToA103(candidate.planPointFt));
  context.beginPath(); context.arc(point[0], point[1], 16, 0, Math.PI * 2); context.fillStyle = '#06b6d4'; context.fill();
  context.strokeStyle = '#083344'; context.lineWidth = 4; context.stroke();
  context.strokeStyle = '#ffffff'; context.lineWidth = 3;
  context.beginPath(); context.moveTo(point[0] - 10, point[1]); context.lineTo(point[0] + 10, point[1]); context.moveTo(point[0], point[1] - 10); context.lineTo(point[0], point[1] + 10); context.stroke();
  context.fillStyle = 'rgba(7,17,31,.9)'; context.fillRect(point[0] + 18, point[1] - 34, 210, 50);
  context.fillStyle = '#67e8f9'; context.font = 'bold 18px sans-serif'; context.fillText(`${candidate.roomNumber} ${candidate.roomName}`, point[0] + 28, point[1] - 13);
  context.fillStyle = '#ffffff'; context.font = '15px sans-serif'; context.fillText(`Z ${candidate.modelPointFt[2].toFixed(2)} ft`, point[0] + 28, point[1] + 6);
}

const registryByRoom = new Map(registry.spaces.map((entry) => [entry.roomNumber, entry]));
for (const audit of packet.roomsAudit.filter((entry) => entry.slopedCeiling === true)) {
  const room = registryByRoom.get(audit.roomNumber); const point = a103ToCanvas(registeredFtToA103(room.sourceAnchorFt));
  context.strokeStyle = '#f472b6'; context.lineWidth = 7;
  context.beginPath(); context.moveTo(point[0] - 13, point[1] - 13); context.lineTo(point[0] + 13, point[1] + 13); context.moveTo(point[0] + 13, point[1] - 13); context.lineTo(point[0] - 13, point[1] + 13); context.stroke();
  context.fillStyle = '#831843'; context.fillRect(point[0] + 18, point[1] - 25, 205, 30);
  context.fillStyle = '#fbcfe8'; context.font = 'bold 16px sans-serif'; context.fillText(`${audit.roomNumber} SLOPED BLOCKED`, point[0] + 25, point[1] - 5);
}

context.fillStyle = 'rgba(7,17,31,.94)'; context.fillRect(60, 1840, 2265, 68);
context.fillStyle = '#67e8f9'; context.font = '21px sans-serif'; context.fillText('CYAN + = source-only preliminary flat candidate', 82, 1880);
context.fillStyle = '#f9a8d4'; context.fillText('MAGENTA X = sloped ceiling blocked until source ceiling plane is sealed', 720, 1880);

context.fillStyle = '#0b1728'; context.fillRect(modelPanel.x, modelPanel.y, modelPanel.width, modelPanel.height);
context.strokeStyle = '#334155'; context.lineWidth = 2; context.strokeRect(modelPanel.x, modelPanel.y, modelPanel.width, modelPanel.height);
context.fillStyle = '#ffffff'; context.font = 'bold 25px sans-serif'; context.fillText('SOURCE 3D MODEL - A103 footprint / A301-A201 elevations', modelPanel.x + 20, modelPanel.y + 38);

const surfaces = building.model.surfaces.filter((surface) => Array.isArray(surface.vertices) && surface.vertices.length >= 3);
const points3d = surfaces.flatMap((surface) => surface.vertices).concat(packet.candidates.map((entry) => entry.modelPointFt));
const rawProject = ([x, y, z]) => [(x - y) * 0.866, (x + y) * 0.45 - z * 1.65];
const projected = points3d.map(rawProject);
const minX = Math.min(...projected.map((point) => point[0])); const maxX = Math.max(...projected.map((point) => point[0]));
const minY = Math.min(...projected.map((point) => point[1])); const maxY = Math.max(...projected.map((point) => point[1]));
const fit3d = Math.min((modelPanel.width - 70) / (maxX - minX), (modelPanel.height - 120) / (maxY - minY));
const project = (point) => { const raw = rawProject(point); return [modelPanel.x + 35 + (raw[0] - minX) * fit3d, modelPanel.y + 80 + (raw[1] - minY) * fit3d]; };
const orderedSurfaces = [...surfaces].sort((left, right) => Math.min(...left.vertices.map((point) => point[2])) - Math.min(...right.vertices.map((point) => point[2])));
for (const surface of orderedSurfaces) {
  context.beginPath(); surface.vertices.forEach((vertex, index) => { const point = project(vertex); if (index === 0) context.moveTo(...point); else context.lineTo(...point); }); context.closePath();
  const pitched = surface.kind.includes('roof');
  context.fillStyle = pitched ? 'rgba(14,165,233,.24)' : 'rgba(148,163,184,.10)';
  context.strokeStyle = pitched ? '#38bdf8' : '#64748b'; context.lineWidth = pitched ? 2.5 : 1; context.fill(); context.stroke();
}
for (const candidate of packet.candidates) {
  const point = project(candidate.modelPointFt); context.beginPath(); context.arc(point[0], point[1], 9, 0, Math.PI * 2);
  context.fillStyle = '#22d3ee'; context.fill(); context.strokeStyle = '#ffffff'; context.lineWidth = 2; context.stroke();
  context.fillStyle = '#cffafe'; context.font = 'bold 15px sans-serif'; context.fillText(candidate.roomNumber, point[0] + 12, point[1] - 8);
}
context.fillStyle = '#bae6fd'; context.font = '18px sans-serif'; context.fillText('Roof shown from sealed 4.5:12 source model; head Z uses flat A151 ceiling only.', modelPanel.x + 22, modelPanel.y + modelPanel.height - 48);
context.fillStyle = '#f9a8d4'; context.fillText('Roof surface is never substituted for an unresolved sloped ceiling plane.', modelPanel.x + 22, modelPanel.y + modelPanel.height - 20);

fs.mkdirSync(OUT_DIR, { recursive: true });
const imagePath = path.join(OUT_DIR, 'winter-garden-source-sprinkler-candidate-proof.png');
const jsonPath = path.join(OUT_DIR, 'winter-garden-source-sprinkler-candidate-proof.json');
fs.writeFileSync(imagePath, canvas.encodeSync('png'));
const proof = {
  artifactType: 'halofire.winter-garden-source-sprinkler-candidate-proof.v1',
  candidateReceiptSha256: packet.receiptSha256,
  sourceReceipts: packet.sourceReceipts,
  sourceBindings: { A103: a103.entry.sha256, A303: a303.entry.sha256 },
  counts: packet.counts,
  candidateIds: packet.candidates.map((entry) => entry.candidateId),
  blockedSlopedRooms: packet.roomsAudit.filter((entry) => entry.slopedCeiling === true).map((entry) => entry.roomNumber),
  answerKeyUsed: false,
  pitchedRoofHeadLayoutReady: false,
  complianceReady: false,
  fabricationReady: false,
  imageSha256: crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex'),
};
fs.writeFileSync(jsonPath, `${JSON.stringify(proof, null, 2)}\n`);
await Promise.all([a103.task.destroy(), a303.task.destroy()]);
console.log(JSON.stringify({ imagePath, jsonPath, proof }, null, 2));
