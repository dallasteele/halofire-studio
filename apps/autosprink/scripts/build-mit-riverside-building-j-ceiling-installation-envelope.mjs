import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMitRiversideBuildingJCeilingInstallationEnvelope, validateMitRiversideBuildingJCeilingInstallationEnvelope, verifyMitRiversideBuildingJCeilingInstallationEnvelopeAdversarialLoop } from '../src/engine/mit-riverside-building-j-ceiling-installation-envelope.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = (name) => path.join(root, 'src', 'data', name);
const read = (name) => JSON.parse(fs.readFileSync(data(name), 'utf8'));
const roofPacket = read('mit-riverside-building-j-roof-plane-elevation.json');
const evidence = read('mit-riverside-building-j-ceiling-installation-envelope-evidence.json');
const dependencies = { roofPacket, evidence };
const packet = await buildMitRiversideBuildingJCeilingInstallationEnvelope(roofPacket, evidence);
const validation = await validateMitRiversideBuildingJCeilingInstallationEnvelope(packet, dependencies);
const adversarial = await verifyMitRiversideBuildingJCeilingInstallationEnvelopeAdversarialLoop(packet, dependencies);
if (validation.status !== 'passed' || adversarial.status !== 'passed') throw new Error(JSON.stringify({ validation, adversarial }));
fs.writeFileSync(data('mit-riverside-building-j-ceiling-installation-envelope.json'), `${JSON.stringify(packet, null, 2)}\n`);
console.log(JSON.stringify({ status: 'passed', validation, adversarial, receiptSha256: packet.receiptSha256, counts: packet.counts }, null, 2));
