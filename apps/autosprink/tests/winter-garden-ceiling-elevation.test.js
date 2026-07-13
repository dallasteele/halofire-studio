import { describe, expect, it } from 'vitest';
import evidence from '../src/data/winter-garden-ceiling-elevation-evidence.json';
import registration from '../src/data/winter-garden-grid-registration.json';
import heads from '../src/data/winter-garden-fp3-head-evidence.json';
import { buildWinterGardenCeilingModel3d, renderWinterGardenCeilingViews, sealWinterGardenCeilingElevationEvidence, validateWinterGardenCeilingElevationEvidence } from '../src/engine/winter-garden-ceiling-elevation.js';

describe('Winter Garden coordinated side-view ceiling elevation', () => {
  it('joins A151 spot heights, A301/A303 sections, FP3, and the fabrication listing', async () => {
    const result = await validateWinterGardenCeilingElevationEvidence(evidence);
    expect(result.status).toBe('passed');
    expect(result.metrics.halfRunFt).toBeCloseTo(14.7083333333, 8);
    expect(result.metrics.sectionPitchMeanInPer12).toBeCloseTo(4.492, 8);
    expect(result.ceilingSurfaceElevationReady).toBe(true);
    expect(result.absoluteDeflectorDatumReady).toBe(false);
  });

  it('builds two absolute 3D ceiling planes and 15 fail-closed head elevation envelopes', async () => {
    const model = await buildWinterGardenCeilingModel3d(evidence, registration, heads);
    expect(model.status).toBe('passed');
    expect(model.counts).toEqual({ ceilingSurfaces: 2, headEnvelopes: 15 });
    expect(model.ceilingSurfaces.flatMap((surface) => surface.verticesFt.map((point) => point[2]))).toEqual(expect.arrayContaining([115.046875, 120.5625]));
    expect(model.headEnvelopes.every((head) => head.ceilingSurfaceElevationFt > 115 && head.ceilingSurfaceElevationFt <= 120.5625 && head.exactDeflectorElevationReady === false)).toBe(true);
    expect(model.pipeElevationReady).toBe(false);
    expect(model.residuals).toContain('fabricated_drop_to_plan_head_mapping_unresolved');
    const views = renderWinterGardenCeilingViews(model);
    expect(views.topSvg).toContain('15 completed FP3 heads');
    expect(views.elevationSvg).toContain('unresolved deflector interval');
  });

  it('adversarially rejects a changed C8 datum, source substitution, and fabricated mapping claim', async () => {
    const datum = structuredClone(evidence); delete datum.receiptSha256; datum.ceiling.highHeightAboveFloorFt += 1;
    expect((await validateWinterGardenCeilingElevationEvidence(await sealWinterGardenCeilingElevationEvidence(datum))).issues.map((entry) => entry.code)).toContain('WG_CEILING_COORDINATED_DATUM_DRIFT');
    const source = structuredClone(evidence); delete source.receiptSha256; source.sources.coordinatedSection.sha256 = '0'.repeat(64);
    expect((await validateWinterGardenCeilingElevationEvidence(await sealWinterGardenCeilingElevationEvidence(source))).issues.map((entry) => entry.code)).toContain('WG_CEILING_SOURCE_DRIFT');
    const fabricated = structuredClone(evidence); delete fabricated.receiptSha256; fabricated.fabricationReceipt.spatialHeadMappingReady = true;
    expect((await validateWinterGardenCeilingElevationEvidence(await sealWinterGardenCeilingElevationEvidence(fabricated))).issues.map((entry) => entry.code)).toContain('WG_CEILING_FABRICATION_RECEIPT_DRIFT');
  });
});
