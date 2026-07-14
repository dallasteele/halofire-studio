import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPitchedPlacementCalibrationCorpusV5,
  selectPitchedPlacementStrategyV5,
  validatePitchedPlacementCalibrationCorpusV5,
  verifyPitchedPlacementCalibrationV5AdversarialLoop,
} from '../src/engine/pitched-placement-calibration-corpus-v5.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const dependencies = { v4Corpus: read('pitched-placement-calibration-corpus-v4.json'), bgcComparison: read('boys-girls-club-pitched-heldout-comparison.json') };
const sourceSeal = read('boys-girls-club-unseen-pitched-holdout.json');
const packet = read('pitched-placement-calibration-corpus-v5.json');

describe('pitched placement calibration corpus v5', () => {
  it('adds the BGC 8-by-8 regime and explicit calibrated-domain gate', async () => {
    const { buildBoysGirlsClubSourceOnlyCandidate } = await import('../src/engine/boys-girls-club-unseen-pitched-holdout.js');
    dependencies.bgcCandidate = await buildBoysGirlsClubSourceOnlyCandidate(sourceSeal, dependencies.v4Corpus);
    expect(await buildPitchedPlacementCalibrationCorpusV5(dependencies)).toEqual(packet);
    expect(await validatePitchedPlacementCalibrationCorpusV5(packet, dependencies)).toMatchObject({ status: 'passed', strategySelectorReadyForFreshHoldout: true, calibratedDomainRequired: true, unseenProjectPlacementVerified: false, complianceReady: false });
    expect(packet.newTrainingProject.answerExposedFeatures).toMatchObject({ completedHeadCount: 64, topology: { alongRidgeStations: 8, acrossSlopeStations: 8 }, exactStationCoordinatesReady: false });
    expect(packet.failedHoldoutControl).toMatchObject({ failurePreserved: true, countFailure: true, topologyFailure: true, v4OutOfEnvelopePromotionGuardWorked: true });
    expect(packet.transferPolicy).toMatchObject({ calibratedDomainRequired: true, empiricalPriorOnly: true, causalRuleClaimed: false, codeLimit: false, exactCoordinateTransferAllowed: false });
  });

  it('selects the BGC regime for the exact source-visible envelope without answer input', () => {
    const selected = selectPitchedPlacementStrategyV5({ clearSpanDisambiguated: true, occupiedProtectionPlaneCount: 2, symmetricTwoPlaneVault: true, ceilingPitchRiseInPer12: 2, envelopeLengthFt: 104, envelopeWidthFt: 89.5, aspectRatio: 1.162011, envelopeAreaSqFt: 9308, sourceObstructionPresent: true, movablePartitionPocketPresent: false, sourceSpanCandidateCount: 1 }, dependencies.v4Corpus, packet);
    expect(selected).toMatchObject({ selectedProjectId: 'boys-girls-club-community-center-brigham-city-ut', selectedFamily: 'large-high-bay-exposed-two-plane-eight-along-eight-across-guarded-uprights', distance: 0, calibratedDomainPassed: true, answerExposedPriorOnly: true, codeLimit: false });
  });

  it('fails closed outside observed bounds and on answer leakage', () => {
    const base = { clearSpanDisambiguated: true, occupiedProtectionPlaneCount: 2, symmetricTwoPlaneVault: true, ceilingPitchRiseInPer12: 2, envelopeLengthFt: 104, envelopeWidthFt: 89.5, aspectRatio: 1.162011, envelopeAreaSqFt: 9308, sourceObstructionPresent: true, movablePartitionPocketPresent: false, sourceSpanCandidateCount: 1 };
    expect(() => selectPitchedPlacementStrategyV5({ ...base, envelopeLengthFt: 105 }, dependencies.v4Corpus, packet)).toThrow('PITCHED_SELECTOR_V5_OUTSIDE_CALIBRATED_BOUNDS:envelopeLengthFt');
    expect(() => selectPitchedPlacementStrategyV5({ ...base, approvedHeadCount: 64 }, dependencies.v4Corpus, packet)).toThrow('PITCHED_SELECTOR_V5_FORBIDDEN_INPUT');
  });

  it('rejects all fifteen corpus mutations plus four selector attacks', async () => {
    const result = await verifyPitchedPlacementCalibrationV5AdversarialLoop(packet, dependencies);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 15, selectorAttemptedCases: 4, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(15);
    expect(result.selectorRejectedCases).toEqual(['length-outside', 'pitch-outside', 'span-ambiguous', 'answer-leakage']);
  });
});
