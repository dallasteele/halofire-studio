import fs from 'node:fs';
import path from 'node:path';
import { buildPolarisAtticFaceCalibration, renderPolarisAtticFaceCalibrationViews, validatePolarisAtticFaceCalibration, verifyPolarisAtticFaceCalibrationAdversarialLoop } from '../src/engine/polaris-academy-attic-face-calibration.js';

const root = path.resolve(import.meta.dirname, '..');
const data = (name) => path.join(root, 'src', 'data', name);
const read = (name) => JSON.parse(fs.readFileSync(data(name), 'utf8'));
const sourceTopology = read('polaris-academy-source-roof-attic-topology.json');
const answerEvidence = read('polaris-answer-extracted-evidence.json');
const blindCandidate = read('polaris-academy-source-only-pitched-attic-candidate.json');
const sourceDependencies = {
  blindCandidate,
  sourceDependencies: {
    sourceSeal: read('polaris-academy-unseen-pitched-attic-holdout.json'),
    v5Corpus: read('pitched-placement-calibration-corpus-v5.json'),
    v4Corpus: read('pitched-placement-calibration-corpus-v4.json'),
  },
};
const dependencies = { sourceTopology, answerEvidence, sourceDependencies };
const calibration = await buildPolarisAtticFaceCalibration(sourceTopology, answerEvidence, sourceDependencies);
const validation = await validatePolarisAtticFaceCalibration(calibration, dependencies);
const adversarial = await verifyPolarisAtticFaceCalibrationAdversarialLoop(calibration, dependencies);
if (validation.status !== 'passed' || adversarial.status !== 'passed') throw new Error(JSON.stringify({ validation, adversarial }, null, 2));
fs.writeFileSync(data('polaris-academy-attic-face-calibration.json'), `${JSON.stringify(calibration, null, 2)}\n`);
const out = path.join(root, 'out', 'visual-proof', 'polaris-attic-face-calibration');
fs.mkdirSync(out, { recursive: true });
const views = renderPolarisAtticFaceCalibrationViews(calibration, sourceTopology);
for (const [name, svg] of Object.entries({ top: views.topSvg, elevation: views.elevationSvg, model3d: views.model3dSvg })) fs.writeFileSync(path.join(out, `polaris-attic-face-calibration-${name}.svg`), svg);
fs.writeFileSync(path.join(out, 'polaris-attic-face-calibration-proof.json'), `${JSON.stringify({ validation, adversarial, calibrationReceiptSha256: calibration.receiptSha256, summary: calibration.summary }, null, 2)}\n`);
console.log(JSON.stringify({ validation, adversarial, calibrationReceiptSha256: calibration.receiptSha256, summary: calibration.summary, out }, null, 2));
