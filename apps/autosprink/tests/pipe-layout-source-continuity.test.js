import { describe, expect, it } from 'vitest';

import evidence from '../src/data/polaris-pipe-layout-source-continuity.json';
import { evaluatePipeLayoutSourceContinuity } from '../src/engine/pipe-layout-source-continuity.js';

describe('same-project pipe-layout source continuity', () => {
  it('accepts the completed Polaris semantic chain while keeping exact endpoint geometry false', () => {
    expect(evaluatePipeLayoutSourceContinuity(evidence)).toMatchObject({
      status: 'passed',
      sourceBindingCount: 5,
      chainNodeCount: 5,
      chainEdgeCount: 4,
      reachableNodeCount: 5,
      sameProjectSemanticSourceContinuityReady: true,
      exactCrossDrawingEndpointGeometryReady: false,
      riserDeviceSemanticsReady: true,
    });
  });

  it('rejects a missing same-project sheet transition', () => {
    const attacked = structuredClone(evidence);
    attacked.edges = attacked.edges.filter((edge) => edge.id !== 'fl3-to-underground-inlet');
    const result = evaluatePipeLayoutSourceContinuity(attacked);
    expect(result.status).toBe('blocked');
    expect(result.blockerCodes).toContain('SOURCE_CONTINUITY_CHAIN_OPEN');
    expect(result.sameProjectSemanticSourceContinuityReady).toBe(false);
  });

  it('rejects a source hash mutation', () => {
    const attacked = structuredClone(evidence);
    attacked.sourceBindings[0].sha256 = 'not-a-source-hash';
    const result = evaluatePipeLayoutSourceContinuity(attacked);
    expect(result.blockerCodes).toContain('SOURCE_CONTINUITY_SOURCE_BINDING_INVALID');
    expect(result.sameProjectSemanticSourceContinuityReady).toBe(false);
  });

  it('rejects missing drain-device semantics without erasing the exact-endpoint hold', () => {
    const attacked = structuredClone(evidence);
    delete attacked.deviceBindings.mainDrain;
    const result = evaluatePipeLayoutSourceContinuity(attacked);
    expect(result.blockerCodes).toContain('SOURCE_CONTINUITY_RISER_DEVICE_BINDING_MISSING');
    expect(result.sameProjectSemanticSourceContinuityReady).toBe(false);
    expect(result.exactCrossDrawingEndpointGeometryReady).toBe(false);
  });
});
