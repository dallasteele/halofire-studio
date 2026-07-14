import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPitchedPlacementCalibrationCorpusV2,
  selectPitchedPlacementStrategyV2,
  validatePitchedPlacementCalibrationCorpusV2,
  verifyPitchedPlacementCalibrationV2AdversarialLoop,
} from '../src/engine/pitched-placement-calibration-corpus-v2.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const dependencies = {
  v1Corpus: read('pitched-placement-calibration-corpus.json'),
  mosesSourceCandidate: read('moses-lake-stake-center-source-only-pitched-candidate.json'),
  mosesComparison: read('moses-lake-stake-center-pitched-heldout-comparison.json'),
};
const packet = read('pitched-placement-calibration-corpus-v2.json');

describe('answer-exposed pitched placement calibration corpus revision two', () => {
  it('adds Moses Lake without mutating the corpus used to generate its blind candidate', async () => {
    expect(await buildPitchedPlacementCalibrationCorpusV2(dependencies)).toEqual(packet);
    expect(await validatePitchedPlacementCalibrationCorpusV2(packet, dependencies)).toMatchObject({
      status: 'passed', strategySelectorReadyForFreshHoldout: true, unseenProjectPlacementVerified: false, complianceReady: false,
    });
    expect(packet.sourceBindings.v1CorpusReceiptSha256).toBe('06c6ed0d30d2aed8ad0031985fa7a0225931dd400c5b1ef90cad894794b6f902');
    expect(packet.trainingProjects).toHaveLength(3);
  });

  it('records source-visible span and aspect differences beside answer-exposed row counts', () => {
    const midvale = packet.trainingProjects.find((project) => project.projectId === 'midvale-townhome-clubhouse-midvale-ut');
    const moses = packet.trainingProjects.find((project) => project.projectId === 'moses-lake-stake-center');
    expect(midvale.sourceObservableFeatures).toMatchObject({ alongRidgeSpanFt: 30, aspectRatio: 1.034483, ceilingPitchRiseInPer12: 6 });
    expect(midvale.answerExposedFeatures.topology).toEqual({ columns: 3, rows: 4 });
    expect(moses.sourceObservableFeatures).toMatchObject({ alongRidgeSpanFt: 25.5, aspectRatio: 0.679245, ceilingPitchRiseInPer12: 4.5 });
    expect(moses.answerExposedFeatures).toMatchObject({ completedHeadCount: 6, topology: { alongRidgeStations: 2, acrossSlopeStations: 3 }, approvedAsBuiltParity: true });
    expect(packet.contrastiveLearning.causalRuleClaimed).toBe(false);
  });

  it('selects only from source geometry and rejects answer-derived selector inputs', () => {
    const midvale = selectPitchedPlacementStrategyV2({
      occupiedProtectionPlaneCount: 2, symmetricTwoPlaneVault: true, ceilingPitchRiseInPer12: 6,
      envelopeLengthFt: 30, envelopeWidthFt: 29, aspectRatio: 1.034483, envelopeAreaSqFt: 870,
    }, packet);
    const moses = selectPitchedPlacementStrategyV2({
      occupiedProtectionPlaneCount: 2, symmetricTwoPlaneVault: true, ceilingPitchRiseInPer12: 4.5,
      envelopeLengthFt: 25.5, envelopeWidthFt: 37.541667, aspectRatio: 0.679245, envelopeAreaSqFt: 957.312508,
    }, packet);
    expect(midvale).toMatchObject({ selectedFamily: 'large-symmetric-two-plane-vault-four-along', distance: 0, answerExposedPriorOnly: true, codeLimit: false });
    expect(moses).toMatchObject({ selectedFamily: 'large-symmetric-two-plane-vault-two-along', distance: 0, answerExposedPriorOnly: true, codeLimit: false });
    expect(() => selectPitchedPlacementStrategyV2({ approvedHeadCount: 6 }, packet)).toThrow('PITCHED_SELECTOR_FORBIDDEN_INPUT');
  });

  it('rejects eighteen provenance, leakage, failure-erasure, causal, and false-promotion mutations', async () => {
    const result = await verifyPitchedPlacementCalibrationV2AdversarialLoop(packet, dependencies);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 18, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(18);
  });
});
