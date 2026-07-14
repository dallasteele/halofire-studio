import fs from 'node:fs';
import { buildSagewoodPitchedAtticCalibration, verifySagewoodPitchedAtticCalibrationAdversarialLoop } from '../src/engine/sagewood-pitched-attic-calibration.js';

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const sourceCandidate = read('../src/data/sagewood-source-only-pitched-candidate.json');
const classificationEvidence = read('../src/data/sagewood-pitched-protection-volume-calibration.json');
const heldoutComparison = read('../src/data/sagewood-pitched-heldout-comparison.json');
let packet = await buildSagewoodPitchedAtticCalibration({ sourceCandidate, classificationEvidence, heldoutComparison });
if (packet.status === 'blocked') throw new Error(JSON.stringify(packet));
const adversarial = await verifySagewoodPitchedAtticCalibrationAdversarialLoop(packet);
if (adversarial.status !== 'passed') throw new Error(JSON.stringify(adversarial));
const { sealSagewoodPitchedAtticCalibration } = await import('../src/engine/sagewood-pitched-attic-calibration.js');
packet.internalVerification.adversarial = { status: 'passed', method: 'dependency-topology-elevation-and-false-promotion-mutations', rejectedCases: adversarial.rejectedCases };
packet = await sealSagewoodPitchedAtticCalibration(packet);
const output = new URL('../src/data/sagewood-pitched-attic-calibration.json', import.meta.url);
fs.writeFileSync(output, `${JSON.stringify(packet, null, 2)}\n`);
console.log(JSON.stringify({ outputPath: output.pathname, receiptSha256: packet.receiptSha256, headCount: packet.heads3d.length, adversarial }, null, 2));
