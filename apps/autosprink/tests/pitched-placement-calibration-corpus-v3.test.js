import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPitchedPlacementCalibrationCorpusV3,
  selectPitchedPlacementStrategyV3,
  validatePitchedPlacementCalibrationCorpusV3,
  verifyPitchedPlacementCalibrationV3AdversarialLoop,
} from '../src/engine/pitched-placement-calibration-corpus-v3.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const dependencies = {
  v2Corpus: read('pitched-placement-calibration-corpus-v2.json'),
  vivianoSourceCandidate: read('viviano-clubhouse-source-only-pitched-candidate.json'),
  vivianoComparison: read('viviano-clubhouse-pitched-heldout-comparison.json'),
};
const packet = read('pitched-placement-calibration-corpus-v3.json');

describe('answer-exposed pitched placement topology calibration revision three', () => {
  it('adds Viviano only after preserving its pushed equal-count topology failure', async () => {
    expect(await buildPitchedPlacementCalibrationCorpusV3(dependencies)).toEqual(packet);
    expect(await validatePitchedPlacementCalibrationCorpusV3(packet, dependencies)).toMatchObject({
      status: 'passed', strategySelectorReadyForFreshHoldout: true, unseenProjectPlacementVerified: false, complianceReady: false,
    });
    expect(packet.sourceBindings.v2CorpusReceiptSha256).toBe('1f2cee5fcd31e2966679dcbb54afd002e7e5bb0ce80bae170ac8131787c55a72');
    expect(packet.trainingProjects).toHaveLength(4);
    expect(packet.failedHoldoutControls[3]).toMatchObject({ failurePreserved: true, equalCountTopologyFailure: true, nowUsedForCalibration: true });
  });

  it('records three along, four across, two per plane, and no ridge head beside source-visible fans', () => {
    const viviano = packet.trainingProjects.find((project) => project.projectId === 'viviano-clubhouse-saratoga-springs-ut');
    expect(viviano.sourceObservableFeatures).toMatchObject({
      ceilingPitchRiseInPer12: 7.334, envelopeLengthFt: 42.25, envelopeWidthFt: 30.760417,
      aspectRatio: 1.373518, envelopeAreaSqFt: 1299.627618, sourceObstructionPresent: true,
    });
    expect(viviano.answerExposedFeatures).toMatchObject({
      completedHeadCount: 12, topology: { alongRidgeStations: 3, acrossSlopeStations: 4 },
      planeStationsPerPlane: 2, ridgeHeadStationPresent: false, approvedAsBuiltParity: true,
    });
    expect(packet.contrastiveLearning.causalRuleClaimed).toBe(false);
  });

  it('selects from source geometry and obstruction only while rejecting answer-derived topology inputs', () => {
    const viviano = selectPitchedPlacementStrategyV3({
      occupiedProtectionPlaneCount: 2, symmetricTwoPlaneVault: true, ceilingPitchRiseInPer12: 7.334,
      envelopeLengthFt: 42.25, envelopeWidthFt: 30.760417, aspectRatio: 1.373518,
      envelopeAreaSqFt: 1299.627618, sourceObstructionPresent: true,
    }, packet);
    expect(viviano).toMatchObject({
      selectedProjectId: 'viviano-clubhouse-saratoga-springs-ut',
      selectedFamily: 'large-symmetric-two-plane-vault-three-along-four-across-obstructed-ridge',
      distance: 0, answerExposedPriorOnly: true, codeLimit: false,
    });
    expect(() => selectPitchedPlacementStrategyV3({ approvedTopology: '3x4' }, packet)).toThrow('PITCHED_SELECTOR_V3_FORBIDDEN_INPUT');
  });

  it('rejects twenty-one provenance, topology, ridge-row, failure-erasure, causal, and false-promotion mutations', async () => {
    const result = await verifyPitchedPlacementCalibrationV3AdversarialLoop(packet, dependencies);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 21, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(21);
  });
});
