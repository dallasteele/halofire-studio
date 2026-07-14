import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sealWinterGardenSourcePitchedHeldout, validateWinterGardenSourcePitchedHeldout } from '../src/engine/winter-garden-source-pitched-heldout.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const packet = read('winter-garden-source-pitched-heldout.json'); const dependencies = { candidates: read('winter-garden-source-pitched-candidates.json'), ceiling: read('winter-garden-source-sloped-ceiling.json'), headEvidence: read('winter-garden-fp3-head-evidence.json'), registration: read('winter-garden-grid-registration.json') };
const codes = (result) => result.issues.map((entry) => entry.code);

describe('Winter Garden source-pitched held-out comparison', () => {
  it('opens the completed answer key only after sealing source generation', async () => {
    const result = await validateWinterGardenSourcePitchedHeldout(packet, dependencies); expect(result.status).toBe('passed');
    expect(packet.sequence).toMatchObject({ sourcePacketSealedBeforeAnswerKeyOpen: true, sourceGenerationModifiedAfterComparison: false });
    expect(packet.generation).toMatchObject({ answerKeyUsedForSourceGeneration: false, answerKeyRole: 'held-out-comparison-only' });
  });

  it('fails acceptance on the observed one-vs-nine count and 4.4303-foot nearest residual', () => {
    expect(packet.metrics).toEqual({ generatedCandidateHeads: 1, completedHeadsInsideGeneratedComponent: 0, completedHeadsInsideTopologyZone: 9 });
    expect(packet.comparisons[0]).toMatchObject({ nearestCompletedHeadId: 'wg-fp3-pendent-086', nearestCompletedDistanceFt: 4.4303, exactPlanParityPassed: false });
    expect(packet.heldOutAcceptanceStatus).toBe('failed'); expect(packet.candidatePlacementVerified).toBe(false);
    expect(packet.pitchedRoofHeadLayoutReady).toBe(false); expect(packet.complianceReady).toBe(false);
  });

  it('rejects receipt, sequence, metric, false-acceptance, and readiness tampering', async () => {
    const cases = [
      ['WG_PITCHED_HELDOUT_RECEIPT_MISMATCH', (value) => { value.metrics.generatedCandidateHeads = 9; }, false],
      ['WG_PITCHED_HELDOUT_SEQUENCE_VIOLATION', (value) => { value.sequence.sourceGenerationModifiedAfterComparison = true; }, true],
      ['WG_PITCHED_HELDOUT_METRIC_DRIFT', (value) => { value.comparisons[0].nearestCompletedDistanceFt = 0; }, true],
      ['WG_PITCHED_HELDOUT_FALSE_ACCEPTANCE', (value) => { value.heldOutAcceptanceStatus = 'passed'; }, true],
      ['WG_PITCHED_HELDOUT_FAIL_CLOSED_STATUS_DRIFT', (value) => { value.complianceReady = true; }, true],
    ];
    for (const [expected, mutate, reseal] of cases) { const value = structuredClone(packet); mutate(value); const candidate = reseal ? await sealWinterGardenSourcePitchedHeldout(value) : value; expect(codes(await validateWinterGardenSourcePitchedHeldout(candidate, dependencies))).toContain(expected); }
  });
});
