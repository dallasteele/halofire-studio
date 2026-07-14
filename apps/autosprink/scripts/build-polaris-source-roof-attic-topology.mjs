import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPolarisSourceRoofAtticTopology, renderPolarisSourceRoofTopologyViews, validatePolarisSourceRoofAtticTopology, verifyPolarisSourceRoofTopologyAdversarialLoop } from '../src/engine/polaris-academy-source-roof-attic-topology.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = (name) => path.join(root, 'src', 'data', name);
const read = (name) => JSON.parse(fs.readFileSync(data(name), 'utf8'));
const blindCandidate = read('polaris-academy-source-only-pitched-attic-candidate.json');
const sourceDependencies = {
  sourceSeal: read('polaris-academy-unseen-pitched-attic-holdout.json'),
  v5Corpus: read('pitched-placement-calibration-corpus-v5.json'),
  v4Corpus: read('pitched-placement-calibration-corpus-v4.json'),
};
const dependencies = { blindCandidate, sourceDependencies };
const topology = await buildPolarisSourceRoofAtticTopology(blindCandidate, sourceDependencies);
const validation = await validatePolarisSourceRoofAtticTopology(topology, dependencies);
const adversarial = await verifyPolarisSourceRoofTopologyAdversarialLoop(topology, dependencies);
if (validation.status !== 'passed' || adversarial.status !== 'passed') throw new Error(JSON.stringify({ validation, adversarial }, null, 2));
fs.writeFileSync(data('polaris-academy-source-roof-attic-topology.json'), `${JSON.stringify(topology, null, 2)}\n`);
const out = path.join(root, 'out', 'visual-proof', 'polaris-source-roof-topology');
fs.mkdirSync(out, { recursive: true });
const views = renderPolarisSourceRoofTopologyViews(topology);
for (const [name, svg] of Object.entries({ top: views.topSvg, elevation: views.elevationSvg, model3d: views.model3dSvg })) fs.writeFileSync(path.join(out, `polaris-source-roof-${name}.svg`), svg);
fs.writeFileSync(path.join(out, 'polaris-source-roof-proof.json'), `${JSON.stringify({ validation, adversarial, topologyReceiptSha256: topology.receiptSha256, renderedFaceCount: views.renderedFaceCount, renderedCompartmentCount: views.renderedCompartmentCount }, null, 2)}\n`);
console.log(JSON.stringify({ validation, adversarial, topologyReceiptSha256: topology.receiptSha256, coverage: topology.roofModel.coverage, compartmentClosure: topology.atticModel.areaClosureResidualSqFt, out }, null, 2));
