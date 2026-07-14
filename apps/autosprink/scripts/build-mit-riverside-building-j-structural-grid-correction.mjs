import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMitRiversideBuildingJStructuralGridCorrection, renderMitRiversideBuildingJStructuralGridCorrection, validateMitRiversideBuildingJStructuralGridCorrection, verifyMitRiversideBuildingJStructuralGridCorrectionAdversarialLoop } from '../src/engine/mit-riverside-building-j-structural-grid-correction.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', name), 'utf8'));
const rcp = read('mit-riverside-building-j-source-rcp-registration.json');
const audit = read('mit-riverside-building-j-cross-drawing-grid-audit.json');
const packet = await buildMitRiversideBuildingJStructuralGridCorrection(rcp, audit);
const dependencies = { rcp, audit };
const validation = await validateMitRiversideBuildingJStructuralGridCorrection(packet, dependencies);
const adversarial = await verifyMitRiversideBuildingJStructuralGridCorrectionAdversarialLoop(packet, dependencies);
if ([validation.status, adversarial.status].some((status) => status !== 'passed')) throw new Error(JSON.stringify({ validation, adversarial }, null, 2));
fs.writeFileSync(path.join(root, 'src', 'data', 'mit-riverside-building-j-structural-grid-correction.json'), `${JSON.stringify(packet, null, 2)}\n`);
const out = path.join(root, 'out', 'visual-proof', 'mit-riverside-building-j-structural-grid-correction.svg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, renderMitRiversideBuildingJStructuralGridCorrection(packet));
console.log(JSON.stringify({ validation, adversarial, receiptSha256: packet.receiptSha256, maximumAbsoluteCorrectionFt: packet.maximumAbsoluteCorrectionFt, out }, null, 2));
