import { describe, expect, it } from 'vitest';
import pipeEvidence from '../src/data/winter-garden-fp2-pipe-evidence.json';
import gridRegistration from '../src/data/winter-garden-grid-registration.json';
import heads from '../src/data/winter-garden-fp3-head-evidence.json';
import { buildWinterGardenChapelPipeNetwork, sealFp2PipeEvidence, validateFp2PipeEvidence } from '../src/engine/fp2-pipe-registration.js';

describe('Winter Garden FP2-to-FP3 chapel pipe registration', () => {
  it('registers the completed-bid sheets from paired labeled grids', async () => {
    const result = await validateFp2PipeEvidence(pipeEvidence);
    expect(result.status).toBe('passed');
    expect(result.metrics.meanDeltaPx[0]).toBeCloseTo(89.25, 8);
    expect(result.metrics.meanDeltaPx[1]).toBe(10);
    expect(result.metrics.maxControlResidualPx[0]).toBeLessThan(2);
  });

  it('connects all 15 pitched-roof heads to three branches and one main network', async () => {
    const result = await buildWinterGardenChapelPipeNetwork(pipeEvidence, gridRegistration, heads);
    expect(result.status).toBe('passed');
    expect(result.headCount).toBe(15);
    expect(result.branchCount).toBe(3);
    expect(result.segments).toHaveLength(23);
    expect(result.projectionReady).toBe(false);
    expect(result.residuals).toEqual(['pipe_sizes_unresolved', 'absolute_deflector_datum_unresolved']);
  });

  it('adversarially rejects source substitution and registration drift after resealing', async () => {
    const substituted = structuredClone(pipeEvidence); delete substituted.receiptSha256; substituted.source.pdfSha256 = '0'.repeat(64);
    expect((await validateFp2PipeEvidence(await sealFp2PipeEvidence(substituted))).issues.map((entry) => entry.code)).toContain('FP2_PIPE_SOURCE_DRIFT');
    const drifted = structuredClone(pipeEvidence); delete drifted.receiptSha256; drifted.gridX.sourcePx[8] += 8;
    expect((await validateFp2PipeEvidence(await sealFp2PipeEvidence(drifted))).issues.map((entry) => entry.code)).toContain('FP2_PIPE_REGISTRATION_DRIFT');
  });

  it('adversarially rejects a missing branch and a disconnected main after resealing', async () => {
    const missing = structuredClone(pipeEvidence); delete missing.receiptSha256; missing.segments = missing.segments.filter((segment) => segment.id !== 'branch-ridge');
    expect((await validateFp2PipeEvidence(await sealFp2PipeEvidence(missing))).issues.map((entry) => entry.code)).toContain('FP2_PIPE_SEGMENT_MISSING');
    const disconnected = structuredClone(pipeEvidence); delete disconnected.receiptSha256; disconnected.segments.find((segment) => segment.id === 'main-jog-upper').fromPx[0] += 200; disconnected.segments.find((segment) => segment.id === 'main-jog-upper').toPx[0] += 200;
    expect((await validateFp2PipeEvidence(await sealFp2PipeEvidence(disconnected))).issues.map((entry) => entry.code)).toContain('FP2_PIPE_TOPOLOGY_DISCONNECTED');
  });
});
