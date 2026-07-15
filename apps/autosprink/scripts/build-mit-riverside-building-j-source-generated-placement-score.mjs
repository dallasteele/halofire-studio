/** Open the completed answer only after the source candidate is sealed. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMitRiversideBuildingJSourceGeneratedPlacementScore,
  validateMitRiversideBuildingJSourceGeneratedPlacementScore,
  verifyMitRiversideBuildingJSourceGeneratedPlacementScoreAdversarialLoop,
} from '../src/engine/mit-riverside-building-j-source-generated-placement-score.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = (name) => path.join(root, 'src', 'data', name);
const read = (name) => JSON.parse(fs.readFileSync(data(name), 'utf8'));

const candidate = read('mit-riverside-building-j-source-generated-placement.json');
const candidateSnapshot = JSON.stringify(candidate);
const answer = read('mit-riverside-building-j-head-coordinate-registration.json');
const targets = read('mit-riverside-building-j-ceiling-installation-envelope.json');
const score = await buildMitRiversideBuildingJSourceGeneratedPlacementScore(candidate, answer, targets);
const validation = await validateMitRiversideBuildingJSourceGeneratedPlacementScore(score, candidate, answer, targets);
const adversarial = await verifyMitRiversideBuildingJSourceGeneratedPlacementScoreAdversarialLoop(score, candidate, answer, targets);
if (candidateSnapshot !== JSON.stringify(candidate)) throw new Error('MIT_J_SOURCE_CANDIDATE_MUTATED_BY_SCORER');
if (validation.status !== 'passed' || adversarial.status !== 'passed') throw new Error(JSON.stringify({ validation, adversarial }, null, 2));

fs.writeFileSync(data('mit-riverside-building-j-source-generated-placement-score.json'), `${JSON.stringify(score, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'passed',
  scoreReceiptSha256: score.receiptSha256,
  counts: score.counts,
  xyScore: score.xyScore,
  sourceTargetZScore: score.sourceTargetZScore,
  acceptance: score.acceptance,
  adversarialRejected: adversarial.rejectedCases.length,
}, null, 2));
