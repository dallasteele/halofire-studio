/** Seal and publish the topology-aware Building J v2 candidate before scoring. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMitRiversideBuildingJTopologyPlacementV2,
  validateMitRiversideBuildingJTopologyPlacementV2,
  verifyMitRiversideBuildingJTopologyPlacementV2AdversarialLoop,
} from '../src/engine/mit-riverside-building-j-topology-placement-v2.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = (name) => path.join(root, 'src', 'data', name);
const read = (name) => JSON.parse(fs.readFileSync(data(name), 'utf8'));

const inputs = read('mit-riverside-building-j-source-placement-inputs.json');
const topology = read('mit-riverside-building-j-source-topology-inputs.json');
const candidate = await buildMitRiversideBuildingJTopologyPlacementV2(inputs, topology);
const validation = await validateMitRiversideBuildingJTopologyPlacementV2(candidate, inputs, topology);
const adversarial = await verifyMitRiversideBuildingJTopologyPlacementV2AdversarialLoop(candidate, inputs, topology);
if (validation.status !== 'passed' || adversarial.status !== 'passed') throw new Error(JSON.stringify({ validation, adversarial }, null, 2));

fs.writeFileSync(data('mit-riverside-building-j-topology-placement-v2.json'), `${JSON.stringify(candidate, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'passed',
  sourceInputsReceiptSha256: candidate.sourceInputsReceiptSha256,
  sourceTopologyReceiptSha256: candidate.sourceTopologyReceiptSha256,
  candidateReceiptSha256: candidate.receiptSha256,
  counts: candidate.counts,
  adversarialRejected: adversarial.rejectedCases.length,
  answerArtifactRead: false,
}, null, 2));
