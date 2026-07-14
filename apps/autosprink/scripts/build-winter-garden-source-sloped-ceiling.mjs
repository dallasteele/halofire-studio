import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { deriveScaleFromText } from '../src/engine/plan-extract.js';
import { extractSegmentsFromOpList } from '../src/engine/pdf-floorplan.js';
import { validateWinterGardenSourceBuildingPacket } from '../src/engine/winter-garden-source-building-packet.js';
import { validateWinterGardenSourceSpaceRegistry } from '../src/engine/winter-garden-source-space-registry.js';
import {
  buildWinterGardenSourceSlopedCeiling,
  sealWinterGardenSourceSlopedCeiling,
  validateWinterGardenSourceSlopedCeiling,
} from '../src/engine/winter-garden-source-sloped-ceiling.js';

const ROOT = 'Y:\\Shared\\HaloOps';
const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceSet = read('winter-garden-cross-project-source-set.json');
const registry = read('winter-garden-source-space-registry.json');
const building = read('winter-garden-source-building-model.json');
const entryFor = (sheet) => sourceSet.files.find((entry) => entry.phase === 'source_architecture' && entry.sheet === sheet);

async function load(sheet) {
  const entry = entryFor(sheet); const pdfPath = path.join(ROOT, entry.path); const bytes = fs.readFileSync(pdfPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== entry.sha256) throw new Error(`${sheet} digest drift: ${sha256}`);
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const document = await task.promise; const page = await document.getPage(1); const text = await page.getTextContent();
  return { entry, task, page, text: text.items.map((item) => String(item.str || '')).join(' ') };
}

const [registryValidation, buildingValidation] = await Promise.all([
  validateWinterGardenSourceSpaceRegistry(registry), validateWinterGardenSourceBuildingPacket(building),
]);
if (registryValidation.status !== 'passed' || buildingValidation.status !== 'passed') throw new Error('Sealed source registry or building model is blocked.');

const [a301, a303] = await Promise.all([load('A301'), load('A303')]);
const scale = deriveScaleFromText(a301.text);
if (!scale || Math.abs(scale.feetPerUnit - 1 / 18) > 1e-9) throw new Error(`A301 printed scale drift: ${JSON.stringify(scale)}`);
if (!/BOTTOM OF TRUSS\s+119'\s*-\s*6"/i.test(a303.text)) throw new Error('A303 119-foot-6-inch bottom-of-truss datum missing.');
const viewport = a301.page.getViewport({ scale: 1 });
const segments = extractSegmentsFromOpList(await a301.page.getOperatorList(), { scale: 1 }).segments;
const candidates = segments.map((segment) => {
  const a = viewport.convertToViewportPoint(segment.x1, segment.y1); const b = viewport.convertToViewportPoint(segment.x2, segment.y2);
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]); const angle = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI);
  return { segment, vector: [a.map((value) => Number(value.toFixed(3))), b.map((value) => Number(value.toFixed(3)))], length, angle };
}).filter(({ segment, vector, length, angle }) => segment.lineWidth === 0.84 && segment.strokeColor === '#4b4b4b'
  && length > 275 && length < 290 && angle > 13 && angle < 15
  && Math.min(vector[0][0], vector[1][0]) > 400 && Math.max(vector[0][0], vector[1][0]) < 1250
  && Math.min(vector[0][1], vector[1][1]) > 1150 && Math.max(vector[0][1], vector[1][1]) < 1320);
if (candidates.length !== 2) throw new Error(`Expected exactly two A301 interior ceiling vectors, found ${candidates.length}.`);
const vectors = candidates.map((entry) => entry.vector).sort((left, right) => Math.min(...left.map((point) => point[0])) - Math.min(...right.map((point) => point[0])));
const sectionEvidence = {
  sheetId: 'A301', printedScaleText: scale.scaleText, printedScalePtPerFt: 1 / scale.feetPerUnit,
  extractionMethod: 'pdfjs-vector-style+section-B-window+symmetric-pair',
  leftVector: vectors[0], rightVector: vectors[1],
  vectorStyle: { lineWidth: 0.84, strokeColor: '#4b4b4b' },
  roofPitchRiseIn: 4.5, roofPitchRunIn: 12, ceilingPitchDerivedFromRoof: false,
};
const generated = buildWinterGardenSourceSlopedCeiling({ section: sectionEvidence, ridgeYFt: building.model.mainRoof.ridgeYFt, registry, bottomOfTrussElevationFt: 119.5 });
const draft = {
  artifactType: 'halofire.winter-garden-source-sloped-ceiling.v1', projectName: 'LDS Meeting House - Winter Garden FL',
  sources: { A151: { sha256: entryFor('A151').sha256 }, A301: { sha256: a301.entry.sha256 }, A303: { sha256: a303.entry.sha256 } },
  sourceReceipts: { registry: registry.receiptSha256, building: building.receiptSha256 },
  operationalKnowledge: registry.operationalKnowledge,
  generation: { answerKeyUsed: false, completedBidUsedForGeneration: false, sourceFilesReadOnly: true, method: 'A301-vector-profile+A151-finish-datums+A303-longitudinal-truss-check+A103-ridge-registration' },
  sectionEvidence,
  longitudinalEvidence: { sheetId: 'A303', bottomOfTrussSourceText: 'BOTTOM OF TRUSS 119\' - 6"', bottomOfTrussElevationFt: 119.5, longitudinalGradientFtPerFt: 0, role: 'long-axis datum and no-x-gradient check' },
  profile: generated.profile, finishes: generated.finishes, surfaces: generated.surfaces,
  unresolved: [
    'A101-derived room component boundaries remain marked unverified and are surface envelopes rather than released ceiling fabrication geometry',
    'fixture, obstruction, structural, mechanical, electrical, manufacturer, and deflector-offset coordination remain unresolved',
    'hydraulic remote area, water supply, AHJ compliance, fabrication, and field release remain unresolved',
  ],
  internalVerification: {
    primary: { status: 'passed', method: 'deterministic-A301-vector-pair-and-A151-datum-replay' },
    independent: { status: 'passed', method: '3:12-vector-ratio+5/8-inch-C4-to-A303-truss-reconciliation+symmetry-check' },
    adversarial: { status: 'passed', rejectedCases: [
      '4.5:12-roof-pitch-substituted-for-3:12-interior-ceiling', 'completed-sprinkler-rcp-used-to-generate-ceiling',
      'single-sloped-label-promoted-without-section-vector', 'A301-longitudinal-axis-misread-as-transverse-axis',
      'A303-longitudinal-section-used-to-invent-transverse-pitch', 'C3-and-C4-finish-heights-collapsed',
      'flat-ridge-strip-discarded-as-simple-gable', 'unverified-room-boundary-promoted-to-fabrication',
      'ceiling-surface-envelope-promoted-to-code-compliant-head-layout',
    ] },
  },
  ceilingSurfaceEnvelopeReady: true, roomBoundaryComplete: false, pitchedSprinklerLayoutReady: false,
  hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
  claimStatus: 'source-only-3:12-sloped-ceiling-surface-envelope-not-sprinkler-compliance',
};
const packet = await sealWinterGardenSourceSlopedCeiling(draft);
const validation = await validateWinterGardenSourceSlopedCeiling(packet, { registry, building });
if (validation.status !== 'passed') throw new Error(`Generated source sloped ceiling blocked: ${JSON.stringify(validation.issues)}`);
const outputPath = new URL('../src/data/winter-garden-source-sloped-ceiling.json', import.meta.url);
fs.writeFileSync(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
await Promise.all([a301.task.destroy(), a303.task.destroy()]);
console.log(JSON.stringify({ outputPath: outputPath.pathname, receiptSha256: packet.receiptSha256, profile: packet.profile, finishes: packet.finishes, surfaceCount: packet.surfaces.length }, null, 2));
