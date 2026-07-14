import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPitchedPlacementCalibrationCorpus,
  validatePitchedPlacementCalibrationCorpus,
  verifyPitchedPlacementCalibrationAdversarialLoop,
} from '../src/engine/pitched-placement-calibration-corpus.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const dependencies = {
  dillonPrior: read('dillon-pitched-placement-prior.json'),
  midvaleSourceCandidate: read('midvale-clubhouse-source-only-pitched-candidate.json'),
  midvaleComparison: read('midvale-clubhouse-pitched-heldout-comparison.json'),
};
const packet = read('pitched-placement-calibration-corpus.json');

describe('answer-exposed multi-project pitched placement calibration corpus', () => {
  it('extracts two distinct layout families without turning observations into code limits', async () => {
    expect(await buildPitchedPlacementCalibrationCorpus(dependencies)).toEqual(packet);
    expect(await validatePitchedPlacementCalibrationCorpus(packet, dependencies)).toMatchObject({
      status: 'passed', strategySelectorReadyForFreshHoldout: true, unseenProjectPlacementVerified: false, complianceReady: false,
    });
    expect(packet.trainingProjects.map(({ layoutFamily }) => layoutFamily)).toEqual([
      'small-obstructed-single-plane', 'large-symmetric-two-plane-vault',
    ]);
    expect(packet.transferPolicy).toMatchObject({ empiricalPriorOnly: true, codeLimit: false, answerExposed: true, unseenProjectHoldoutRequired: true });
  });

  it('records the Midvale ridge, edge, row, and scale features while preserving the failed heldout result', () => {
    const midvale = packet.trainingProjects[1];
    expect(midvale.sourceObservableFeatures).toMatchObject({ occupiedProtectionPlaneCount: 2, symmetricTwoPlaneVault: true, ceilingPitchRiseInPer12: 6, envelopeAreaSqFt: 870 });
    expect(midvale.answerExposedFeatures).toMatchObject({
      completedHeadCount: 12,
      completedAreaPerHeadSqFt: 72.5,
      topology: { columns: 3, rows: 4 },
      columnEdgeOffsetsFt: [3.999961, 3.999957],
      rowEdgeOffsetsFt: [3.825209, 3.580305],
      ridgeHeadColumnPresent: true,
      lowEdgeHeadColumnPerPlane: true,
    });
    expect(packet.failedHoldoutControls[1]).toMatchObject({
      sourceOnlyPrediction: { columns: 4, rows: 2, heads: 8 },
      approvedAnswerExposed: { columns: 3, rows: 4, heads: 12 },
      failurePreserved: true,
      nowUsedForCalibration: true,
    });
  });

  it('rejects fifteen adversarial attempts to erase provenance, answer exposure, or fail-closed status', async () => {
    const result = await verifyPitchedPlacementCalibrationAdversarialLoop(packet, dependencies);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 15, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(15);
  });
});
