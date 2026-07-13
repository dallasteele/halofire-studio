import { describe, expect, it } from 'vitest';
import evidence from '../src/data/winter-garden-fp3-head-evidence.json';
import { sealRasterBullseyeHeadEvidence, validateRasterBullseyeHeadEvidence } from '../src/engine/raster-bullseye-head-evidence.js';

const mutate = async (change) => {
  const draft = structuredClone(evidence);
  delete draft.receiptSha256;
  change(draft);
  return sealRasterBullseyeHeadEvidence(draft);
};

describe('Winter Garden raster bullseye head evidence', () => {
  it('binds 159 FP3 pendent heads through primary, independent, and adversarial image paths', async () => {
    const result = await validateRasterBullseyeHeadEvidence(evidence);
    expect(result.status).toBe('passed');
    expect(result.metrics).toMatchObject({ expectedCount: 159, primaryCount: 159, independentCount: 158, reconciliationDelta: 1 });
    expect(result.points).toHaveLength(159);
    expect(result.projectionReady).toBe(false);
    expect(result.complianceReady).toBe(false);
  });

  it('rejects source substitution, missing points, and a survived center-removal mutation', async () => {
    const sourceSwap = await mutate((draft) => { draft.sourcePdfSha256 = 'f'.repeat(64); });
    expect((await validateRasterBullseyeHeadEvidence(sourceSwap)).issues.map((entry) => entry.code)).toContain('RASTER_HEAD_SOURCE_DRIFT');
    const missingPoint = await mutate((draft) => { draft.points.pop(); });
    expect((await validateRasterBullseyeHeadEvidence(missingPoint)).issues.map((entry) => entry.code)).toContain('RASTER_HEAD_PRIMARY_COUNT_MISMATCH');
    const survivedMutation = await mutate((draft) => { draft.adversarial.centerRemovedTemplateCount = 159; draft.adversarial.centerRemovedTemplateRejected = false; });
    expect((await validateRasterBullseyeHeadEvidence(survivedMutation)).issues.map((entry) => entry.code)).toContain('RASTER_HEAD_ADVERSARIAL_CHECK_FAILED');
  });
});
