/** Open the completed answer only after the topology-aware v2 candidate is sealed. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMitRiversideBuildingJTopologyPlacementV2Score,
  validateMitRiversideBuildingJTopologyPlacementV2Score,
  verifyMitRiversideBuildingJTopologyPlacementV2ScoreAdversarialLoop,
} from '../src/engine/mit-riverside-building-j-topology-placement-v2-score.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = (name) => path.join(root, 'src', 'data', name);
const read = (name) => JSON.parse(fs.readFileSync(data(name), 'utf8'));

const candidate = read('mit-riverside-building-j-topology-placement-v2.json');
const candidateSnapshot = JSON.stringify(candidate);
const answer = read('mit-riverside-building-j-head-coordinate-registration.json');
const targets = read('mit-riverside-building-j-ceiling-installation-envelope.json');
const score = await buildMitRiversideBuildingJTopologyPlacementV2Score(candidate, answer, targets);
const validation = await validateMitRiversideBuildingJTopologyPlacementV2Score(score, candidate, answer, targets);
const adversarial = await verifyMitRiversideBuildingJTopologyPlacementV2ScoreAdversarialLoop(score, candidate, answer, targets);
if (candidateSnapshot !== JSON.stringify(candidate)) throw new Error('MIT_J_TOPOLOGY_V2_CANDIDATE_MUTATED_BY_SCORER');
if (validation.status !== 'passed' || adversarial.status !== 'passed') throw new Error(JSON.stringify({ validation, adversarial }, null, 2));

fs.writeFileSync(data('mit-riverside-building-j-topology-placement-v2-score.json'), `${JSON.stringify(score, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'passed',
  scoreReceiptSha256: score.receiptSha256,
  counts: score.counts,
  xyScore: score.xyScore,
  sourceTargetZScore: score.sourceTargetZScore,
  acceptance: score.acceptance,
  adversarialRejected: adversarial.rejectedCases.length,
}, null, 2));
