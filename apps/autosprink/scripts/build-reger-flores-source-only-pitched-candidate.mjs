import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegerFloresSourceOnlyCandidate, renderRegerFloresSourceCandidateViews, validateRegerFloresSourceOnlyCandidate, verifyRegerFloresSourceCandidateAdversarialLoop } from '../src/engine/reger-flores-unseen-pitched-holdout.js';

const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, '..'); const read = (name) => JSON.parse(fs.readFileSync(path.join(root, 'src/data', name), 'utf8'));
const sourceSeal = read('reger-flores-unseen-pitched-holdout.json'); const dillonPrior = read('dillon-pitched-placement-prior.json'); const dependencies = { sourceSeal, dillonPrior };
const packet = await buildRegerFloresSourceOnlyCandidate(sourceSeal, dillonPrior); const validation = await validateRegerFloresSourceOnlyCandidate(packet, dependencies); const adversarial = await verifyRegerFloresSourceCandidateAdversarialLoop(packet, dependencies);
if (validation.status !== 'passed' || adversarial.status !== 'passed') throw new Error(JSON.stringify({ validation, adversarial }, null, 2));
fs.writeFileSync(path.join(root, 'src/data/reger-flores-source-only-pitched-candidate.json'), `${JSON.stringify(packet, null, 2)}\n`);
const out = path.join(root, 'out/visual-proof'); fs.mkdirSync(out, { recursive: true }); const views = renderRegerFloresSourceCandidateViews(packet);
for (const [name, svg] of Object.entries({ top: views.topSvg, elevation: views.elevationSvg, model3d: views.model3dSvg })) fs.writeFileSync(path.join(out, `reger-flores-source-only-${name}.svg`), svg);
console.log(JSON.stringify({ status: 'passed', receiptSha256: packet.receiptSha256, adversarialRejected: adversarial.rejectedCases.length, headCount: packet.heads3d.length }, null, 2));
