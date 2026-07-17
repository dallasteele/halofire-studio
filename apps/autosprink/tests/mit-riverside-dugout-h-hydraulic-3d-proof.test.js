import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCompletedHydraulicRoutedPlanModel, verifyHydraulicRoutedPlanAdversarialLoop } from '../src/engine/completed-hydraulic-routed-plan-registration.js';
import { buildCompletedHydraulicSized3dModel, verifyHydraulicSized3dAdversarialLoop } from '../src/engine/completed-hydraulic-sized-3d-registration.js';

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const routed = readJson(new URL('../src/data/mit-riverside-hydraulic-routed-plan-registration.json', import.meta.url));
const sized = readJson(new URL('../src/data/mit-riverside-hydraulic-sized-3d-registration.json', import.meta.url));
const proofDirectory = new URL('../src/data/proofs/mit-riverside-dugout-h-hydraulic-3d-proof/', import.meta.url);
const proof = readJson(new URL('proof.json', proofDirectory));
const hash = (url) => createHash('sha256').update(readFileSync(url)).digest('hex');

describe('Dugout H hydraulic 3D source proof', () => {
  it('exposes only the sealed plan/XYZ edge replay under the completed FP-3 source', () => {
    const plan = buildCompletedHydraulicRoutedPlanModel(routed);
    const model3d = buildCompletedHydraulicSized3dModel(sized);

    expect(plan.status).toBe('passed');
    expect(model3d.status).toBe('passed');
    expect(plan.pipes).toHaveLength(20);
    expect(model3d.edges).toHaveLength(20);
    expect(proof).toMatchObject({
      artifactType: 'halofire.mit-riverside-dugout-h-hydraulic-3d-proof.v1',
      status: 'passed-source-bound-hydraulic-edge-replay-only',
      metrics: { registeredNodeCount: 21, registeredOnPlanEdgeCount: 20, samePlanAnchorVerticalEdgeCount: 3, hydraulicInsideDiameterClassesIn: [1.515, 2.729] },
      claims: { completedPlanHydraulicRouteReplayReady: true, hydraulicElevationReplayReady: true, installedRiserGeometryReady: false, fieldDrainRouteReady: false, fabricationReady: false, complianceReady: false }
    });
  });

  it('keeps every rendered evidence asset immutable and source claims fail-closed', () => {
    for (const [name, receipt] of Object.entries(proof.assets)) {
      const url = new URL(name, proofDirectory);
      expect(existsSync(url)).toBe(true);
      expect(statSync(url).size).toBe(receipt.bytes);
      expect(hash(url)).toBe(receipt.sha256);
    }
    expect(proof.riserReference.rawText).toContain('2.5 in FIRE RISER');
    expect(proof.limitations.join(' ')).toMatch(/No drain is shown or inferred/i);
  });

  it('uses the built-in adversarial loops instead of trusting a review flag', () => {
    expect(verifyHydraulicRoutedPlanAdversarialLoop(routed).status).toBe('passed');
    expect(verifyHydraulicSized3dAdversarialLoop(sized).status).toBe('passed');
  });
});
