/** Seal the protected source packet and publish the untouched fresh candidate. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIronwoodPitchedHoldoutCandidate,
  sealIronwoodSourceTopology,
  validateIronwoodPitchedHoldoutCandidate,
  validateIronwoodSourceTopology,
  verifyIronwoodPitchedHoldoutAdversarialLoop,
} from '../src/engine/ironwood-seminary-pitched-holdout.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = (name) => path.join(root, 'src', 'data', name);
const sourcePath = data('ironwood-seminary-pitched-holdout-source-topology.json');
const rawSource = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const source = await sealIronwoodSourceTopology(rawSource);
const sourceValidation = await validateIronwoodSourceTopology(source);
if (sourceValidation.status !== 'passed') throw new Error(JSON.stringify(sourceValidation, null, 2));
const candidate = await buildIronwoodPitchedHoldoutCandidate(source);
const validation = await validateIronwoodPitchedHoldoutCandidate(candidate, source);
const adversarial = await verifyIronwoodPitchedHoldoutAdversarialLoop(candidate, source);
if (validation.status !== 'passed' || adversarial.status !== 'passed') throw new Error(JSON.stringify({ validation, adversarial }, null, 2));
fs.writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
fs.writeFileSync(data('ironwood-seminary-pitched-holdout-candidate.json'), `${JSON.stringify(candidate, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'passed',
  sourceReceiptSha256: source.sourceReceiptSha256,
  candidateReceiptSha256: candidate.receiptSha256,
  counts: candidate.counts,
  adversarialRejected: adversarial.rejectedCases.length,
  answerArtifactRead: false,
  complianceReady: false,
}, null, 2));
