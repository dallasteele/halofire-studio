import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPolarisAtticFaceCalibration, renderPolarisAtticFaceCalibrationViews, validatePolarisAtticFaceCalibration, verifyPolarisAtticFaceCalibrationAdversarialLoop } from '../src/engine/polaris-academy-attic-face-calibration.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', name), 'utf8'));
const sourceTopology = read('polaris-academy-source-roof-attic-topology.json');
const answerEvidence = read('polaris-answer-extracted-evidence.json');
const blindCandidate = read('polaris-academy-source-only-pitched-attic-candidate.json');
const sourceDependencies = { blindCandidate, sourceDependencies: { sourceSeal: read('polaris-academy-unseen-pitched-attic-holdout.json'), v5Corpus: read('pitched-placement-calibration-corpus-v5.json'), v4Corpus: read('pitched-placement-calibration-corpus-v4.json') } };
const dependencies = { sourceTopology, answerEvidence, sourceDependencies };

describe('Polaris attic upright registration rejects the isolated roof candidate', () => {
  it('registers all sealed uprights and preserves the exact failure tallies', async () => {
    const calibration = await buildPolarisAtticFaceCalibration(sourceTopology, answerEvidence, sourceDependencies);
    expect(calibration.sequence.sourceGeometryCommittedAndPushedBeforeRegistration).toBe(true);
    expect(calibration.sequence.sourceGeometryCommit).toBe('4ad324b1');
    expect(calibration.sequence.sourceClaimDemotionRecordedWithCalibration).toBe(true);
    expect(calibration.assignments).toHaveLength(77);
    expect(calibration.summary.faceMappedCount).toBe(74);
    expect(calibration.summary.compartmentMappedCount).toBe(70);
    expect(calibration.summary.combinedFaceAndCompartmentCount).toBe(70);
    expect(calibration.summary.aboveCandidateRoofCount).toBe(44);
    expect(calibration.rejection.status).toBe('rejected-source-topology-not-calibration-ready');
  });

  it('keeps geometry rewrite, coordinate transfer, fresh placement, and downstream claims false', async () => {
    const calibration = await buildPolarisAtticFaceCalibration(sourceTopology, answerEvidence, sourceDependencies);
    expect(calibration.sequence.answerCoordinatesUsedToRewriteSourceGeometry).toBe(false);
    expect(calibration.sequence.exactCoordinateTransferAllowed).toBe(false);
    expect(calibration.sequence.normalizedCoordinateTransferAllowed).toBe(false);
    expect(calibration.sourceTopologyCalibrationReady).toBe(false);
    expect(calibration.pitchedAtticSelectorReadyForFreshHoldout).toBe(false);
    expect(calibration.freshProjectPlacementVerified).toBe(false);
    expect(calibration.wholeRoofModelReady).toBe(false);
    expect(calibration.absoluteRoofElevationReady).toBe(false);
    expect(calibration.complianceReady).toBe(false);
    expect(calibration.fabricationReady).toBe(false);
  });

  it('replays the generated artifact and renders top, elevation, and 3D rejection proof', async () => {
    const calibration = await buildPolarisAtticFaceCalibration(sourceTopology, answerEvidence, sourceDependencies);
    expect(read('polaris-academy-attic-face-calibration.json')).toEqual(calibration);
    expect((await validatePolarisAtticFaceCalibration(calibration, dependencies)).status).toBe('passed');
    const views = renderPolarisAtticFaceCalibrationViews(calibration, sourceTopology);
    expect(views.topSvg).toContain('44 uprights above candidate roof');
    expect(views.elevationSvg).toContain('model defect');
    expect(views.model3dSvg).toContain('Connected gable');
  });

  it('rejects every provenance, tally, failure-erasure, transfer, and promotion attack', async () => {
    const calibration = await buildPolarisAtticFaceCalibration(sourceTopology, answerEvidence, sourceDependencies);
    const adversarial = await verifyPolarisAtticFaceCalibrationAdversarialLoop(calibration, dependencies);
    expect(adversarial.status).toBe('passed');
    expect(adversarial.rejectedCases).toHaveLength(adversarial.attemptedCases);
    expect(adversarial.attemptedCases).toBe(14);
  }, 30_000);
});
