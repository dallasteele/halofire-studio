import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderBoysGirlsClubHeldoutComparison, validateBoysGirlsClubHeldoutComparison, verifyBoysGirlsClubComparisonAdversarialLoop } from '../src/engine/boys-girls-club-pitched-heldout-comparison.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/boys-girls-club-pitched-heldout-comparison.json', import.meta.url), 'utf8'));

describe('Boys and Girls Club pitched heldout comparison', () => {
  it('preserves the failed 3-by-4 versus 8-by-8 result and working OOD guard', async () => {
    expect(await validateBoysGirlsClubHeldoutComparison(packet)).toMatchObject({ status: 'passed', heldoutAcceptanceStatus: 'failed', candidatePlacementVerified: false, v4OutOfEnvelopePromotionGuardWorked: true, complianceReady: false });
    expect(packet.blindPrediction).toMatchObject({ headCount: 12, alongRidgeStations: 3, acrossSlopeStations: 4, outOfEnvelope: true, candidatePlacementReady: false });
    expect(packet.approved).toMatchObject({ headCount: 64, topology: { alongRidgeStations: 8, acrossSlopeStations: 8, headsPerBranch: 8, branchCount: 8 } });
    expect(packet.asBuilt).toMatchObject({ headCount: 64, topology: { alongRidgeStations: 8, acrossSlopeStations: 8 }, approvedGymTopologyPreserved: true });
    expect(packet.result).toMatchObject({ status: 'failed', headCountDelta: -52, predictedToAsBuiltRatio: 0.1875, topologyMatched: false, countMatched: false, v4TopologyGeneralizationVerified: false });
  });

  it('retires the synthetic dot graphic and routes to actual-PDF source proof', () => {
    const view = renderBoysGirlsClubHeldoutComparison(packet);
    expect(view.status).toBe('passed');
    expect(view.svg).toContain('HISTORICAL FAILED BLIND V4 — NOT A SPRINKLER LAYOUT');
    expect(view.svg).toContain('synthetic 8 × 8 dot graphic has been retired');
    expect(view.svg).toContain('bgc-source-plan-section-3d-registration/index.html');
    expect(view.svg).not.toContain('<circle');
    expect(view.syntheticTopologyGraphicRetired).toBe(true);
    expect(view.topologyMatched).toBe(false);
    expect(view.complianceReady).toBe(false);
  });

  it('rejects all answer, registration, count, topology, guard, receipt, and promotion mutations', async () => {
    const result = await verifyBoysGirlsClubComparisonAdversarialLoop(packet);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 12, candidatePlacementVerified: false, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(12);
  });
});
