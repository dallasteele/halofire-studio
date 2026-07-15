/** Seal and publish the Building J protected-source candidate before scoring. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMitRiversideBuildingJSourceGeneratedPlacement,
  sealMitRiversideBuildingJSourcePlacementInputs,
  validateMitRiversideBuildingJSourceGeneratedPlacement,
  validateMitRiversideBuildingJSourcePlacementInputs,
  verifyMitRiversideBuildingJSourceGeneratedPlacementAdversarialLoop,
} from '../src/engine/mit-riverside-building-j-source-generated-placement.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = (name) => path.join(root, 'src', 'data', name);
const read = (name) => JSON.parse(fs.readFileSync(data(name), 'utf8'));

const inputs = await sealMitRiversideBuildingJSourcePlacementInputs(read('mit-riverside-building-j-source-placement-inputs.json'));
const inputValidation = await validateMitRiversideBuildingJSourcePlacementInputs(inputs);
if (inputValidation.status !== 'passed') throw new Error(JSON.stringify(inputValidation, null, 2));

const candidate = await buildMitRiversideBuildingJSourceGeneratedPlacement(inputs);
const candidateValidation = await validateMitRiversideBuildingJSourceGeneratedPlacement(candidate, inputs);
const adversarial = await verifyMitRiversideBuildingJSourceGeneratedPlacementAdversarialLoop(candidate, inputs);
if (candidateValidation.status !== 'passed' || adversarial.status !== 'passed') throw new Error(JSON.stringify({ candidateValidation, adversarial }, null, 2));

fs.writeFileSync(data('mit-riverside-building-j-source-placement-inputs.json'), `${JSON.stringify(inputs, null, 2)}\n`);
fs.writeFileSync(data('mit-riverside-building-j-source-generated-placement.json'), `${JSON.stringify(candidate, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'passed',
  inputReceiptSha256: inputs.receiptSha256,
  candidateReceiptSha256: candidate.receiptSha256,
  counts: candidate.counts,
  adversarialRejected: adversarial.rejectedCases.length,
  answerArtifactRead: false,
}, null, 2));
