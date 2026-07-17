import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSheetToCanvas } from '../src/engine/pdf-underlay.js';
import { sha256Hex } from '../src/engine/elevation-datums.js';

const APP = path.resolve(import.meta.dirname, '..');
const ARCH = path.resolve(process.env.COOPERATIVE_1881_ARCH_PDF
  || 'E:/ClaudeBot/data/halofire/golden/1881/input/GC - Bid Plans/1881 - Architecturals.pdf');
const MECHANICAL = path.resolve(process.env.COOPERATIVE_1881_MECHANICAL_PDF
  || 'E:/ClaudeBot/HaloFireBidDocs/1-Bid Documents/GC - Bid Plans/1881 - Mechanical.pdf');
const PLUMBING = path.resolve(process.env.COOPERATIVE_1881_PLUMBING_PDF
  || 'E:/ClaudeBot/HaloFireBidDocs/1-Bid Documents/GC - Bid Plans/1881 - Plumbing.pdf');
const ROOF_PATH = path.join(APP, 'src/data/roof-reconstruction.cooperative-1881.json');
const COORDINATION_PATH = path.join(APP, 'src/data/roof-coordination.cooperative-1881.json');
const CALIBRATION_PATH = path.join(APP, 'src/data/submitted-fp8-calibration.cooperative-1881.json');
const EXPECTED_ARCH_SHA256 = 'bb3c85c8ae6a7709cb45d200b2aa38b26a75ec82870c01ba70346b2c1814008f';
const EXPECTED_MECHANICAL_SHA256 = 'f2aa3329951b29ea7829fa56ff30866c0f3fa7e46ecd7f8c0377556da1e4a3d7';
const EXPECTED_PLUMBING_SHA256 = 'eb9cfb0410f1b022b7b445c24e241c54ca9ffa858c914e5a471cd46323ee89c2';
const RENDER_PROFILE = { renderer: 'pdfjs-dist', rendererVersion: '6.1.200', matrixScale: 2.5, colorspace: 'rgb', alpha: false };

const read = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
const canonicalize = (value) => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])) : value;
const receipt = (value) => crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
const fileSha = (filename) => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

function replaceBindingBlock(raw, id, binding) {
  const idAt = raw.indexOf(`"id": "${id}"`);
  const bindingAt = raw.indexOf('"binding": {', idAt);
  const openAt = raw.indexOf('{', bindingAt);
  if (idAt < 0 || bindingAt < 0 || openAt < 0) throw new Error(`calibration binding not found: ${id}`);
  let depth = 0; let inString = false; let escaped = false; let closeAt = -1;
  for (let index = openAt; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) { closeAt = index; break; }
  }
  if (closeAt < 0) throw new Error(`calibration binding is unterminated: ${id}`);
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const replacement = JSON.stringify(binding, null, 2).split('\n')
    .map((line, index) => index === 0 ? line : `      ${line}`).join(newline);
  return `${raw.slice(0, openAt)}${replacement}${raw.slice(closeAt + 1)}`;
}

async function currentBinding(sheetId, physicalPageNumber, expectedRenderSha256, sourcePdf, sourcePdfSha256) {
  const rendered = await renderSheetToCanvas(pdfjs, { url: sourcePdf, page: physicalPageNumber, targetPx: 6480 });
  if (rendered.widthPt !== 2592 || rendered.heightPt !== 1728) throw new Error(`${sheetId} page frame drift`);
  const renderedPageSha256 = crypto.createHash('sha256').update(rendered.canvas.encodeSync('png')).digest('hex');
  if (renderedPageSha256 !== expectedRenderSha256) throw new Error(`${sheetId} rendered page drift: ${renderedPageSha256}`);
  return { sourcePdfSha256, physicalPageNumber, pageIndex: physicalPageNumber - 1,
    renderedPageSha256, sheetId, coordinateSpace: 'pdf-points', renderProfile: RENDER_PROFILE };
}

if (fileSha(ARCH) !== EXPECTED_ARCH_SHA256) throw new Error('current Cooperative 1881 architectural PDF drift');
if (fileSha(MECHANICAL) !== EXPECTED_MECHANICAL_SHA256) throw new Error('current Cooperative 1881 mechanical PDF drift');
if (fileSha(PLUMBING) !== EXPECTED_PLUMBING_SHA256) throw new Error('current Cooperative 1881 plumbing PDF drift');
const [a108, a121, a201, a301, m109, p109] = await Promise.all([
  currentBinding('A-108', 29, '689f5eebd371c1e3770f36d17f7c3d8966f30961d45bce3ae4ca7b91a9993146', ARCH, EXPECTED_ARCH_SHA256),
  currentBinding('A-121', 32, '4c95d21463f7f8acd801f74f06b42ed88a296ff430ee694c14a8ff6279714aab', ARCH, EXPECTED_ARCH_SHA256),
  currentBinding('A-201', 58, 'd78e0636b69f65505f1b58b5cc251ca905fe20773532e4fc9bad2c6a4066b076', ARCH, EXPECTED_ARCH_SHA256),
  currentBinding('A-301', 62, 'cc7e86038187a2d4330764fc04ef22982579df8095d53b7e5ae0f8acdfdaacd1', ARCH, EXPECTED_ARCH_SHA256),
  currentBinding('M109', 13, '17dcc6157b019b12807b9b2413ffd222bc306f317b072c72037440debc96de12', MECHANICAL, EXPECTED_MECHANICAL_SHA256),
  currentBinding('P109', 10, '01535ccb60d74338a0e694bf2651bbf58a1f8248807baed042b5ec2c19987b9c', PLUMBING, EXPECTED_PLUMBING_SHA256),
]);

const roof = read(ROOF_PATH);
const byId = new Map(roof.sourceBindings.map((entry) => [entry.id, entry]));
const expectedRoofBindings = new Map([
  ['roof-plan-A121', a121], ['elevation-A201', a201], ['section-A301', a301],
  ['mechanical-M109', m109], ['plumbing-P109', p109],
]);
for (const [id, binding] of expectedRoofBindings) {
  if (JSON.stringify(byId.get(id)?.binding) !== JSON.stringify(binding)) throw new Error(`sealed roof binding drift: ${id}`);
}
const coordination = read(COORDINATION_PATH);
delete coordination.evidenceReceiptSha256;
coordination.sourceBindings = ['roof-plan-A121', 'mechanical-M109', 'plumbing-P109'].map((id) => byId.get(id));
if (coordination.sourceBindings.some((entry) => !entry)) throw new Error('roof coordination source binding missing');
coordination.evidenceReceiptSha256 = receipt(coordination);
fs.writeFileSync(COORDINATION_PATH, `${JSON.stringify(coordination, null, 2)}\n`);

let calibrationRaw = fs.readFileSync(CALIBRATION_PATH, 'utf8');
const calibrationDraft = JSON.parse(calibrationRaw.replace(/^\uFEFF/, ''));
delete calibrationDraft.evidenceReceiptSha256;
for (const source of calibrationDraft.sourceBindings) {
  if (source.id === 'target-architectural-A108') source.binding = a108;
  if (source.id === 'target-roof-A121') source.binding = a121;
}
const calibrationReceiptSha256 = await sha256Hex(calibrationDraft);
calibrationRaw = replaceBindingBlock(calibrationRaw, 'target-architectural-A108', a108);
calibrationRaw = replaceBindingBlock(calibrationRaw, 'target-roof-A121', a121);
calibrationRaw = calibrationRaw.replace(
  /"evidenceReceiptSha256": "[0-9a-f]{64}"/,
  `"evidenceReceiptSha256": "${calibrationReceiptSha256}"`,
);
fs.writeFileSync(CALIBRATION_PATH, calibrationRaw);

console.log(JSON.stringify({
  architecturalPdfSha256: EXPECTED_ARCH_SHA256,
  coordinationReceiptSha256: coordination.evidenceReceiptSha256,
  calibrationReceiptSha256,
  targetBindings: { a108, a121 },
}, null, 2));
