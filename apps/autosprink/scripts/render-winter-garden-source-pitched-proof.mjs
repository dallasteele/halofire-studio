import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';
import { deriveScaleFromText } from '../src/engine/plan-extract.js';
import { extractLabeledGridFrame, registerPointViaLabeledGrid } from '../src/engine/labeled-grid-registration.js';
import { validateWinterGardenSourcePitchedCandidates } from '../src/engine/winter-garden-source-pitched-candidates.js';

const ROOT = 'Y:\\Shared\\HaloOps'; const OUT_DIR = path.resolve(import.meta.dirname, '../src/data/proofs');
const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceSet = read('winter-garden-cross-project-source-set.json'); const packet = read('winter-garden-source-pitched-candidates.json');
const heldOut = read('winter-garden-source-pitched-heldout.json');
const ceiling = read('winter-garden-source-sloped-ceiling.json'); const topology = read('winter-garden-source-space-topology.json');
const registry = read('winter-garden-source-space-registry.json'); const hazard = read('winter-garden-source-spec-hazard.json');
const building = read('winter-garden-source-building-model.json');
const validation = await validateWinterGardenSourcePitchedCandidates(packet, { topology, registry, hazard, ceiling, building });
if (validation.status !== 'passed') throw new Error(`Source pitched candidates blocked: ${JSON.stringify(validation.issues)}`);
const entryFor = (sheet) => sourceSet.files.find((entry) => entry.phase === 'source_architecture' && entry.sheet === sheet);

async function load(sheet, targetPx) {
  const entry = entryFor(sheet); const pdfPath = path.join(ROOT, entry.path); const bytes = fs.readFileSync(pdfPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex'); if (sha256 !== entry.sha256) throw new Error(`${sheet} digest drift`);
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const document = await task.promise; const page = await document.getPage(1); const text = await page.getTextContent();
  const textItems = text.items.map((item) => ({ s: String(item.str || '').trim(), xPt: item.transform[4], yPt: item.transform[5], transform: item.transform })).filter((item) => item.s);
  const rendered = await renderSheetToCanvas(pdfjsLib, { url: pdfPath, page: 1, targetPx });
  return { entry, task, page, textItems, frame: ['A103', 'A151'].includes(sheet) ? extractLabeledGridFrame(textItems) : null, rendered };
}

const [a103, a151, a301, a303] = await Promise.all([load('A103', 2600), load('A151', 3000), load('A301', 2400), load('A303', 2200)]);
const scale = deriveScaleFromText(a103.textItems.map((item) => item.s).join(' ')); if (!scale) throw new Error('A103 scale missing.');
const canvas = createCanvas(3600, 2400); const context = canvas.getContext('2d');
context.fillStyle = '#06101d'; context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = '#ffffff'; context.font = 'bold 50px sans-serif'; context.fillText('WINTER GARDEN - SOURCE-ONLY 3:12 CEILING + PITCHED CANDIDATE', 42, 60);
context.fillStyle = '#67e8f9'; context.font = '24px sans-serif'; context.fillText('A151 plan / A301 transverse vectors / A303 longitudinal datum / source-extruded 3D - no completed sprinkler answer key', 42, 104);
context.fillStyle = '#fde68a'; context.fillText(`HELD-OUT FAILED: 1 generated vs ${heldOut.metrics.completedHeadsInsideTopologyZone} completed in the topology zone; nearest center ${heldOut.comparisons[0].nearestCompletedDistanceFt.toFixed(4)} ft - placement is not verified`, 42, 145);

function drawSheet(source, panel, label) {
  const image = source.rendered.canvas; const fit = Math.min(panel.width / image.width, panel.height / image.height);
  const width = image.width * fit; const height = image.height * fit; const x = panel.x + (panel.width - width) / 2; const y = panel.y + (panel.height - height) / 2;
  context.fillStyle = '#ffffff'; context.fillRect(panel.x, panel.y, panel.width, panel.height); context.drawImage(image, x, y, width, height);
  context.fillStyle = 'rgba(6,16,29,.92)'; context.fillRect(panel.x, panel.y, panel.width, 54); context.fillStyle = '#ffffff'; context.font = 'bold 22px sans-serif'; context.fillText(label, panel.x + 16, panel.y + 35);
  const viewport = source.page.getViewport({ scale: source.rendered.widthPx / source.page.getViewport({ scale: 1 }).width });
  const viewScale = source.rendered.widthPx / source.page.getViewport({ scale: 1 }).width;
  return {
    pdf: (point) => { const [px, py] = viewport.convertToViewportPoint(point[0], point[1]); return [x + px * fit, y + py * fit]; },
    view: (point) => [x + point[0] * viewScale * fit, y + point[1] * viewScale * fit],
  };
}

const planPanel = { x: 34, y: 180, width: 2250, height: 1570 }; const sectionPanel = { x: 2315, y: 180, width: 1250, height: 760 };
const datumPanel = { x: 2315, y: 970, width: 1250, height: 780 }; const modelPanel = { x: 34, y: 1780, width: 3531, height: 580 };
const planMap = drawSheet(a151, planPanel, 'A151 REFLECTED CEILING PLAN - source room surfaces and candidate');
const sectionMap = drawSheet(a301, sectionPanel, 'A301 SECTION B - cyan = extracted interior ceiling vectors');
drawSheet(a303, datumPanel, 'A303 SECTION A - longitudinal 119\' - 6" bottom-of-truss datum');

const toA151 = (pointFt) => registerPointViaLabeledGrid(pointFt.map((value) => value / scale.feetPerUnit), a103.frame, a151.frame);
for (const surface of ceiling.surfaces) {
  const polygon = surface.planPolygonFt.map((point) => planMap.pdf(toA151(point)));
  context.beginPath(); polygon.forEach((point, index) => index ? context.lineTo(...point) : context.moveTo(...point)); context.closePath();
  context.fillStyle = surface.profileBand === 'ridge-flat' ? 'rgba(34,211,238,.32)' : 'rgba(244,114,182,.30)';
  context.strokeStyle = surface.profileBand === 'ridge-flat' ? '#06b6d4' : '#ec4899'; context.lineWidth = 4; context.fill(); context.stroke();
}
for (const candidate of packet.candidates) {
  const point = planMap.pdf(toA151(candidate.planPointFt)); context.beginPath(); context.arc(point[0], point[1], 19, 0, Math.PI * 2); context.fillStyle = '#facc15'; context.fill(); context.strokeStyle = '#111827'; context.lineWidth = 4; context.stroke();
  context.fillStyle = 'rgba(6,16,29,.94)'; context.fillRect(point[0] + 24, point[1] - 48, 360, 74); context.fillStyle = '#fef08a'; context.font = 'bold 18px sans-serif'; context.fillText('149 OVERFLOW - preliminary', point[0] + 34, point[1] - 23); context.fillStyle = '#ffffff'; context.font = '16px sans-serif'; context.fillText(`C3 EL ${candidate.modelPointFt[2].toFixed(3)} ft / 3:12 source profile`, point[0] + 34, point[1] + 3);
}
context.fillStyle = 'rgba(6,16,29,.94)'; context.fillRect(planPanel.x + 22, planPanel.y + planPanel.height - 85, 970, 62); context.font = '18px sans-serif'; context.fillStyle = '#67e8f9'; context.fillText('CYAN = flat ridge strip   PINK = 3:12 finish surface   YELLOW = source-only candidate', planPanel.x + 42, planPanel.y + planPanel.height - 47);

for (const vector of [ceiling.sectionEvidence.leftVector, ceiling.sectionEvidence.rightVector]) {
  const a = sectionMap.view(vector[0]); const b = sectionMap.view(vector[1]); context.strokeStyle = '#00e5ff'; context.lineWidth = 10; context.beginPath(); context.moveTo(...a); context.lineTo(...b); context.stroke();
  for (const point of [a, b]) { context.beginPath(); context.arc(point[0], point[1], 9, 0, Math.PI * 2); context.fillStyle = '#facc15'; context.fill(); }
}
const leftHigh = sectionMap.view(ceiling.sectionEvidence.leftVector.reduce((best, point) => point[1] < best[1] ? point : best)); const rightHigh = sectionMap.view(ceiling.sectionEvidence.rightVector.reduce((best, point) => point[1] < best[1] ? point : best));
context.strokeStyle = '#22d3ee'; context.lineWidth = 8; context.beginPath(); context.moveTo(...leftHigh); context.lineTo(...rightHigh); context.stroke();
context.fillStyle = 'rgba(6,16,29,.94)'; context.fillRect(sectionPanel.x + 20, sectionPanel.y + sectionPanel.height - 105, 1160, 82); context.fillStyle = '#67e8f9'; context.font = 'bold 19px sans-serif'; context.fillText(`VECTOR RESULT: ${ceiling.profile.pitchRiseIn.toFixed(4)}:12 ceiling / ${ceiling.profile.plateauWidthFt.toFixed(3)} ft flat strip`, sectionPanel.x + 38, sectionPanel.y + sectionPanel.height - 72); context.fillStyle = '#fde68a'; context.font = '17px sans-serif'; context.fillText('Roof note = 4.5:12; it is intentionally not used as the ceiling pitch.', sectionPanel.x + 38, sectionPanel.y + sectionPanel.height - 42);

context.fillStyle = 'rgba(6,16,29,.94)'; context.fillRect(datumPanel.x + 20, datumPanel.y + datumPanel.height - 126, 1170, 104); context.font = 'bold 18px sans-serif'; context.fillStyle = '#a7f3d0'; context.fillText('A151 C4 EL 119\' - 5 3/8" = 5/8" below A303 truss datum', datumPanel.x + 38, datumPanel.y + datumPanel.height - 88); context.fillStyle = '#bae6fd'; context.fillText('A151 C3 EL 119\' - 4 5/8" = 1 3/8" below A303 truss datum', datumPanel.x + 38, datumPanel.y + datumPanel.height - 58); context.fillStyle = '#fde68a'; context.font = '16px sans-serif'; context.fillText('A303 constrains the long axis; A301 supplies the transverse 3:12 profile.', datumPanel.x + 38, datumPanel.y + datumPanel.height - 30);

context.fillStyle = '#0b1728'; context.fillRect(modelPanel.x, modelPanel.y, modelPanel.width, modelPanel.height); context.strokeStyle = '#334155'; context.lineWidth = 2; context.strokeRect(modelPanel.x, modelPanel.y, modelPanel.width, modelPanel.height); context.fillStyle = '#ffffff'; context.font = 'bold 23px sans-serif'; context.fillText('SOURCE 3D - building roof in gray; C3/C4 interior ceiling envelopes in cyan/pink; candidate in yellow', modelPanel.x + 20, modelPanel.y + 35);
const buildingSurfaces = building.model.surfaces.filter((surface) => Array.isArray(surface.vertices) && surface.vertices.length >= 3);
const points = buildingSurfaces.flatMap((surface) => surface.vertices).concat(ceiling.surfaces.flatMap((surface) => surface.verticesFt), packet.candidates.map((candidate) => candidate.modelPointFt));
const rawProject = ([x, y, z]) => [(x - y) * 0.92, (x + y) * 0.34 - z * 1.7]; const projected = points.map(rawProject);
const minX = Math.min(...projected.map((point) => point[0])); const maxX = Math.max(...projected.map((point) => point[0])); const minY = Math.min(...projected.map((point) => point[1])); const maxY = Math.max(...projected.map((point) => point[1]));
const fit3d = Math.min((modelPanel.width - 80) / (maxX - minX), (modelPanel.height - 90) / (maxY - minY)); const project = (point) => { const raw = rawProject(point); return [modelPanel.x + 40 + (raw[0] - minX) * fit3d, modelPanel.y + 60 + (raw[1] - minY) * fit3d]; };
for (const surface of buildingSurfaces) { context.beginPath(); surface.vertices.forEach((vertex, index) => index ? context.lineTo(...project(vertex)) : context.moveTo(...project(vertex))); context.closePath(); context.fillStyle = 'rgba(100,116,139,.08)'; context.strokeStyle = '#475569'; context.lineWidth = 1; context.fill(); context.stroke(); }
for (const surface of ceiling.surfaces) { context.beginPath(); surface.verticesFt.forEach((vertex, index) => index ? context.lineTo(...project(vertex)) : context.moveTo(...project(vertex))); context.closePath(); context.fillStyle = surface.profileBand === 'ridge-flat' ? 'rgba(34,211,238,.62)' : 'rgba(244,114,182,.58)'; context.strokeStyle = surface.profileBand === 'ridge-flat' ? '#22d3ee' : '#f472b6'; context.lineWidth = 3; context.fill(); context.stroke(); }
for (const candidate of packet.candidates) { const point = project(candidate.modelPointFt); context.beginPath(); context.arc(point[0], point[1], 11, 0, Math.PI * 2); context.fillStyle = '#facc15'; context.fill(); context.strokeStyle = '#ffffff'; context.lineWidth = 3; context.stroke(); context.fillStyle = '#fef9c3'; context.font = 'bold 17px sans-serif'; context.fillText('149', point[0] + 15, point[1] - 8); }

fs.mkdirSync(OUT_DIR, { recursive: true }); const imagePath = path.join(OUT_DIR, 'winter-garden-source-pitched-candidate-proof.png'); const jsonPath = path.join(OUT_DIR, 'winter-garden-source-pitched-candidate-proof.json');
fs.writeFileSync(imagePath, canvas.encodeSync('png'));
const proof = { artifactType: 'halofire.winter-garden-source-pitched-candidate-proof.v1', candidateReceiptSha256: packet.receiptSha256, ceilingReceiptSha256: ceiling.receiptSha256, heldOutReceiptSha256: heldOut.receiptSha256, heldOutAcceptanceStatus: heldOut.heldOutAcceptanceStatus, sourceBindings: Object.fromEntries(['A103', 'A151', 'A301', 'A303'].map((sheet) => [sheet, entryFor(sheet).sha256])), counts: packet.counts, candidateIds: packet.candidates.map((candidate) => candidate.candidateId), ceilingPitchRiseInPer12: ceiling.profile.pitchRiseIn, roofPitchRiseInPer12: ceiling.sectionEvidence.roofPitchRiseIn, answerKeyUsed: false, pitchedRoofHeadLayoutReady: false, complianceReady: false, fabricationReady: false, imageSha256: crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex') };
fs.writeFileSync(jsonPath, `${JSON.stringify(proof, null, 2)}\n`); await Promise.all([a103.task.destroy(), a151.task.destroy(), a301.task.destroy(), a303.task.destroy()]);
console.log(JSON.stringify({ imagePath, jsonPath, proof }, null, 2));
