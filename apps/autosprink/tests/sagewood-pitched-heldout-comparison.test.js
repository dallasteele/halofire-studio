import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sealSagewoodPitchedHeldoutComparison, validateSagewoodPitchedHeldoutComparison, verifySagewoodPitchedHeldoutAdversarialLoop } from '../src/engine/sagewood-pitched-heldout-comparison.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/sagewood-pitched-heldout-comparison.json', import.meta.url), 'utf8'));

describe('Sagewood pitched held-out comparison', () => {
  it('records the protected-volume and 24-versus-30 topology failure', async () => {
    const result = await validateSagewoodPitchedHeldoutComparison(packet);
    expect(result.status).toBe('passed');
    expect(packet.preAnswerResults).toMatchObject({ assumedProtectedVolume: 'occupied-sloped-ceiling', protectionVolumeClassifierPresent: false, generatedHeadCount: 24, generatedColumnCount: 6, generatedRowsPerColumn: 4, protectedVolumeParityPassed: false, exactPlanPlacementPassed: false });
    expect(packet.answerEvidence.completedProtection).toMatchObject({ protectedVolume: 'pitched-attic', headType: 'upright', observedHeadCount: 30, observedColumnCount: 5, observedRowsPerColumn: 6 });
    expect(result).toMatchObject({ heldOutAcceptanceStatus: 'failed', unseenProtectionVolumeVerified: false, unseenProjectPlacementVerified: false, freshHoldoutRequired: true, complianceReady: false });
  });

  it('binds the completed page and crop while keeping every downstream claim closed', () => {
    expect(packet.answerEvidence).toMatchObject({ physicalPage: 4, sheetId: 'F1.2' });
    expect(packet.sequence).toMatchObject({ sourceCandidateSealedBeforeAnswerOpen: true, answerOpenedAfterPreAnswerCommit: true, correctedImplementationEligibleAsFreshHoldout: false });
    expect(packet).toMatchObject({ pitchedRoofHeadLayoutReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
  });

  it('rejects nine adversarial attempts to erase or promote the failure', async () => {
    const result = await verifySagewoodPitchedHeldoutAdversarialLoop(packet);
    expect(result).toEqual({ status: 'passed', rejectedCases: packet.internalVerification.adversarial.rejectedCases, totalCases: 9 });
  });

  it('rejects even a resealed false acceptance', async () => {
    const changed = structuredClone(packet); changed.heldOutAcceptanceStatus = 'passed';
    expect((await validateSagewoodPitchedHeldoutComparison(changed)).status).toBe('blocked');
    expect((await validateSagewoodPitchedHeldoutComparison(await sealSagewoodPitchedHeldoutComparison(changed))).issues.map((entry) => entry.code)).toContain('SAGEWOOD_HELDOUT_FALSE_ACCEPTANCE');
  });
});
