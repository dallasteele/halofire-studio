import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sealJomoPitchedHeldoutComparison, validateJomoPitchedHeldoutComparison, verifyJomoPitchedHeldoutAdversarialLoop } from '../src/engine/jomo-pitched-heldout-comparison.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/jomo-pitched-heldout-comparison.json', import.meta.url), 'utf8'));

describe('JOMO pitched held-out comparison', () => {
  it('records the plan-topology pass and elevation failure without promoting the project', async () => {
    const result = await validateJomoPitchedHeldoutComparison(packet);
    expect(result.status).toBe('passed');
    expect(packet.preAnswerResults).toMatchObject({ generatedHeadCount: 6, generatedRowCount: 2, generatedHeadsPerRow: 3, headCountParityPassed: true, rowTopologyParityPassed: true, ceilingPitchParityPassed: false });
    expect(packet.answerEvidence.greatRoom).toMatchObject({ headCount: 6, rowCount: 2, headsPerRow: 3, printedCeilingSlopeRiseIn: 8, printedCeilingSlopeRunIn: 12, printedTopOfVaultFt: 16 });
    expect(result).toMatchObject({ heldOutAcceptanceStatus: 'failed', unseenPlanTopologyVerified: true, unseenProjectPlacementVerified: false, freshHoldoutRequired: true, complianceReady: false });
  });

  it('discloses that the corrected algorithm is answer-exposed', () => {
    expect(packet.sequence).toMatchObject({ sourceCandidateSealedBeforeAnswerOpen: true, answerExposedBeforeCorrectedImplementation: true, correctedImplementationEligibleAsFreshHoldout: false });
    expect(packet.requiredNextLoop).toBe('run-the-corrected-dimension-authority-algorithm-on-a-fresh-unopened-pitched-project');
  });

  it('rejects six adversarial attempts to erase the failure boundary', async () => {
    const result = await verifyJomoPitchedHeldoutAdversarialLoop(packet);
    expect(result).toEqual({ status: 'passed', rejectedCases: ['sequence', 'answer-count', 'answer-pitch', 'hide-failed-pitch', 'whole-project-pass', 'compliance-pass'], totalCases: 6 });
  });

  it('rejects an unsealed acceptance mutation', async () => {
    const changed = structuredClone(packet);
    changed.heldOutAcceptanceStatus = 'passed';
    expect((await validateJomoPitchedHeldoutComparison(changed)).status).toBe('blocked');
    expect((await validateJomoPitchedHeldoutComparison(await sealJomoPitchedHeldoutComparison(changed))).issues.map((entry) => entry.code)).toContain('JOMO_HELDOUT_FALSE_ACCEPTANCE');
  });
});
