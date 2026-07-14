import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sealRegerFloresPitchedHeldoutComparison, validateRegerFloresPitchedHeldoutComparison, verifyRegerFloresPitchedHeldoutAdversarialLoop } from '../src/engine/reger-flores-pitched-heldout-comparison.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/reger-flores-pitched-heldout-comparison.json', import.meta.url), 'utf8'));

describe('Reger-Flores pitched held-out comparison', () => {
  it('records the two-column topology pass and one-versus-three ridge-row failure', async () => {
    const result = await validateRegerFloresPitchedHeldoutComparison(packet);
    expect(result.status).toBe('passed');
    expect(packet.preAnswerResults).toMatchObject({ generatedHeadCount: 2, generatedSlopeColumnCount: 2, generatedRidgeDirectionRowsPerColumn: 1, headCountParityPassed: false, slopeColumnTopologyPassed: true, ridgeDirectionRepetitionPassed: false, exactPlanPlacementPassed: false });
    expect(packet.answerEvidence.completedLayout).toMatchObject({ headCount: 6, slopeColumnCount: 2, ridgeDirectionRowsPerColumn: 3 });
    expect(result).toMatchObject({ heldOutAcceptanceStatus: 'failed', unseenSlopeColumnTopologyVerified: true, unseenProjectPlacementVerified: false, freshHoldoutRequired: true, complianceReady: false });
  });

  it('binds the approved-page crop and discloses that any correction is answer-exposed', () => {
    expect(packet.answerEvidence).toMatchObject({ page: 1, roomLabel: 'LOUNGE VAULTED' });
    expect(packet.sequence).toMatchObject({ sourceCandidateSealedBeforeAnswerOpen: true, answerOpenedAfterPreAnswerCommit: true, correctedImplementationEligibleAsFreshHoldout: false });
  });

  it('rejects seven adversarial attempts to erase the failure boundary', async () => {
    const result = await verifyRegerFloresPitchedHeldoutAdversarialLoop(packet);
    expect(result.status).toBe('passed'); expect(result.rejectedCases).toEqual(packet.internalVerification.adversarial.rejectedCases); expect(result.totalCases).toBe(7);
  });

  it('rejects even a resealed false acceptance', async () => {
    const changed = structuredClone(packet); changed.heldOutAcceptanceStatus = 'passed';
    expect((await validateRegerFloresPitchedHeldoutComparison(changed)).status).toBe('blocked');
    expect((await validateRegerFloresPitchedHeldoutComparison(await sealRegerFloresPitchedHeldoutComparison(changed))).issues.map((entry) => entry.code)).toContain('REGER_HELDOUT_FALSE_ACCEPTANCE');
  });
});
