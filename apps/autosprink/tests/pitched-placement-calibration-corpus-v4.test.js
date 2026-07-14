import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPitchedPlacementCalibrationCorpusV4,
  selectPitchedPlacementStrategyV4,
  validatePitchedPlacementCalibrationCorpusV4,
  verifyPitchedPlacementCalibrationV4AdversarialLoop,
} from '../src/engine/pitched-placement-calibration-corpus-v4.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const dependencies = { v3Corpus: read('pitched-placement-calibration-corpus-v3.json'), winterSourceCandidate: read('winter-garden-source-only-pitched-candidate.json'), winterComparison: read('winter-garden-meetinghouse-pitched-heldout-comparison.json') };
const packet = read('pitched-placement-calibration-corpus-v4.json');

describe('pitched placement calibration corpus v4', () => {
  it('replays five projects and preserves Winter Garden count, topology, and source-span failure', async () => {
    expect(await buildPitchedPlacementCalibrationCorpusV4(dependencies)).toEqual(packet);
    expect(await validatePitchedPlacementCalibrationCorpusV4(packet, dependencies)).toMatchObject({ status: 'passed', strategySelectorReadyForFreshHoldout: true, unseenProjectPlacementVerified: false, complianceReady: false });
    const winter = packet.trainingProjects.at(-1);
    expect(winter.sourceObservableFeatures).toMatchObject({ envelopeLengthFt: 25.895833, clearSpanDisambiguated: true, movablePartitionPocketPresent: true, sourceSpanCandidateCount: 2 });
    expect(winter.answerExposedFeatures).toMatchObject({ completedHeadCount: 9, topology: { alongRidgeStations: 3, acrossSlopeStations: 3 } });
    expect(packet.failedHoldoutControls.at(-1)).toMatchObject({ failurePreserved: true, countFailure: true, topologyFailure: true, sourceSpanFailure: true });
  });

  it('fails closed on ambiguous spans and forbidden answer leakage', () => {
    expect(() => selectPitchedPlacementStrategyV4({ clearSpanDisambiguated: false }, packet)).toThrow('PITCHED_SELECTOR_V4_CLEAR_SPAN_UNRESOLVED');
    expect(() => selectPitchedPlacementStrategyV4({ clearSpanDisambiguated: true, approvedHeadCount: 9 }, packet)).toThrow('PITCHED_SELECTOR_V4_FORBIDDEN_INPUT');
  });

  it('selects Winter Garden only from disambiguated source-visible features', () => {
    const selected = selectPitchedPlacementStrategyV4({
      clearSpanDisambiguated: true, occupiedProtectionPlaneCount: 2, symmetricTwoPlaneVault: true,
      ceilingPitchRiseInPer12: 4.5, envelopeLengthFt: 25.895833, envelopeWidthFt: 38.083333,
      aspectRatio: 0.679978, envelopeAreaSqFt: 986.199631, sourceObstructionPresent: true,
      movablePartitionPocketPresent: true, sourceSpanCandidateCount: 2,
    }, packet);
    expect(selected).toMatchObject({ selectedProjectId: 'lds-meetinghouse-winter-garden-fl', selectedFamily: 'large-symmetric-two-plane-vault-three-along-three-across-partition-pocket', distance: 0, answerExposedPriorOnly: true, codeLimit: false });
    expect(selected.sourceOnlyInputsUsed).toContain('clearSpanDisambiguated');
  });

  it('rejects all twenty-three corpus mutations plus both selector attacks', async () => {
    const result = await verifyPitchedPlacementCalibrationV4AdversarialLoop(packet, dependencies);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 23, selectorAttemptedCases: 2, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(23);
    expect(result.selectorRejectedCases).toEqual(['ambiguous-span', 'answer-leakage']);
  });
});
