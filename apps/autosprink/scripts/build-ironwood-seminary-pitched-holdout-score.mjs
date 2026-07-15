/** Score the sealed candidate after the completed answer is opened. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIronwoodPitchedHoldoutScore,
  validateIronwoodPitchedHoldoutScore,
  verifyIronwoodPitchedHoldoutScoreAdversarialLoop,
} from '../src/engine/ironwood-seminary-pitched-holdout-score.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = (name) => path.join(root, 'src', 'data', name);
const read = (name) => JSON.parse(fs.readFileSync(data(name), 'utf8'));
const candidate = read('ironwood-seminary-pitched-holdout-candidate.json');
const answer = read('ironwood-seminary-pitched-holdout-answer-evidence.json');
const score = await buildIronwoodPitchedHoldoutScore(candidate, answer);
const validation = await validateIronwoodPitchedHoldoutScore(score, candidate, answer);
const adversarial = await verifyIronwoodPitchedHoldoutScoreAdversarialLoop(score, candidate, answer);
if (validation.status !== 'passed' || adversarial.status !== 'passed') throw new Error(JSON.stringify({ validation, adversarial }, null, 2));
fs.writeFileSync(data('ironwood-seminary-pitched-holdout-score.json'), `${JSON.stringify(score, null, 2)}\n`);
console.log(JSON.stringify({ status: 'passed', scoreReceiptSha256: score.receiptSha256, delta: score.delta, accepted: score.acceptance.accepted, adversarialRejected: adversarial.rejectedCases.length, complianceReady: false }, null, 2));
