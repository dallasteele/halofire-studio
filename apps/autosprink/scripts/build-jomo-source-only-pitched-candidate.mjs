import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildJomoSourceOnlyCandidate,
  renderJomoSourceCandidateViews,
  validateJomoSourceOnlyCandidate,
  verifyJomoSourceCandidateAdversarialLoop,
} from '../src/engine/jomo-unseen-pitched-holdout.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', name), 'utf8'));
const sourceSeal = read('jomo-unseen-pitched-holdout.json');
const dillonPrior = read('dillon-pitched-placement-prior.json');
const candidate = await buildJomoSourceOnlyCandidate(sourceSeal, dillonPrior);
const dependencies = { sourceSeal, dillonPrior };
const validation = await validateJomoSourceOnlyCandidate(candidate, dependencies);
const adversarial = await verifyJomoSourceCandidateAdversarialLoop(candidate, dependencies);
if (validation.status !== 'passed' || adversarial.status !== 'passed') throw new Error(JSON.stringify({ validation, adversarial }));

fs.writeFileSync(path.join(root, 'src', 'data', 'jomo-source-only-pitched-candidate.json'), `${JSON.stringify(candidate, null, 2)}\n`);
const views = renderJomoSourceCandidateViews(candidate);
const outDir = path.join(root, 'out', 'visual-proof');
fs.mkdirSync(outDir, { recursive: true });
for (const [name, svg] of Object.entries({ top: views.topSvg, elevation: views.elevationSvg, model3d: views.model3dSvg })) {
  fs.writeFileSync(path.join(outDir, `jomo-source-only-${name}.svg`), svg);
}
const proof = {
  artifactType: 'halofire.jomo-source-only-pitched-proof.v1',
  candidateReceiptSha256: candidate.receiptSha256,
  sourceSealReceiptSha256: sourceSeal.receiptSha256,
  dillonPriorReceiptSha256: dillonPrior.receiptSha256,
  answerKeySha256: sourceSeal.answerKeyDenylist[0].sha256,
  answerKeyUsed: false,
  completedBidUsedForGeneration: false,
  internalVerification: { validation: validation.status, adversarial: adversarial.status, rejectedCases: adversarial.rejectedCases },
  counts: { sourceCeilingPlanes: candidate.geometry.ceiling.surfaces.length, candidateHeads: candidate.heads3d.length, candidateBranches: candidate.branchPipes3d.length },
  viewSha256: Object.fromEntries(Object.entries({ top: views.topSvg, elevation: views.elevationSvg, model3d: views.model3dSvg }).map(([name, value]) => [name, crypto.createHash('sha256').update(value).digest('hex')])),
  unseenProjectPlacementVerified: false,
  wholeBuildingModelReady: false,
  complianceReady: false,
  fabricationReady: false,
  fieldReleaseReady: false,
};
fs.writeFileSync(path.join(outDir, 'jomo-source-only-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify({ status: 'passed', receiptSha256: candidate.receiptSha256, adversarialRejected: adversarial.rejectedCases.length, counts: proof.counts }, null, 2));

