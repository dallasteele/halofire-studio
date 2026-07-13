import { describe, expect, it } from 'vitest';
import dallasPacket from '../src/data/dallas-pitched-attic-hydraulic-registration.json';
import winterGardenPacket from '../src/data/winter-garden-pitched-hydraulic-registration.json';
import { validateWinterGardenPitchedHydraulicRegistration } from '../src/engine/winter-garden-pitched-hydraulic-registration.js';
import { buildDallasPitchedAtticHydraulicModel, sealDallasPitchedAtticHydraulicRegistration, validateCompletedPitchedHydraulicPortfolio, validateDallasPitchedAtticHydraulicRegistration, verifyDallasPitchedAtticHydraulicAdversarialLoop } from '../src/engine/dallas-pitched-attic-hydraulic-registration.js';

describe('Dallas completed pitched-attic hydraulic registration', () => {
  it('binds the reviewed calculation to nine completed FP-1.4 active heads and two attic families', async () => {
    const result = await validateDallasPitchedAtticHydraulicRegistration(dallasPacket);
    expect(result.status).toBe('passed');
    expect(result.metrics).toMatchObject({ mappedActiveHeadCount: 9, mappedBranchPipeCount: 8, elevationClassCount: 2, elevationRangeFt: 13, maximumPlanToReportLengthResidualFt: 0 });
    expect(new Set(result.heads.map((head) => head.headFamily))).toEqual(new Set(['TYCO-TY3180-ATTIC-BB1', 'TYCO-TY3183-ATTIC-SD1']));
    expect(result.perHeadPitchedHydraulicIdentityReady).toBe(true);
    expect(result.mappedPitchedBranchNominalSizeReady).toBe(true);
  });

  it('proves the reviewed and as-built remote-area geometry is identical and cross-checks printed hydraulic summaries', async () => {
    const result = await validateDallasPitchedAtticHydraulicRegistration(dallasPacket);
    expect(result.plan.remoteAreaCrop.reviewedSampleSha256).toBe(result.plan.remoteAreaCrop.asBuiltSampleSha256);
    expect(result.plan.remoteAreaCrop.pixelDifferenceCount).toBe(0);
    expect(result.independentPlanSummary.totalDemandGpm).toBeCloseTo(result.hydraulicSystem.totalDemandGpm, 2);
    expect(result.independentPlanSummary.requiredPressurePsi).toBeCloseTo(result.hydraulicSystem.requiredPressurePsi, 2);
  });

  it('builds top and elevation evidence with exact head IDs, z values, and mapped 2-inch branch segments', async () => {
    const model = await buildDallasPitchedAtticHydraulicModel(dallasPacket);
    expect(model.status).toBe('passed');
    expect(model.heads3d.filter((head) => head.zFt === 42)).toHaveLength(7);
    expect(model.heads3d.filter((head) => head.zFt === 29)).toHaveLength(2);
    expect(model.branchPipes3d.every((pipe) => pipe.nominalDiameterIn === 2 && pipe.actualInsideDiameterIn === 2.157)).toBe(true);
    expect(model.views.topSvg).toContain('A1');
    expect(model.views.elevationSvg).toContain('42.00 ft');
    expect(model.complianceReady).toBe(false);
  });

  it('promotes only the common two-project pitched hydraulic geometry capability', async () => {
    const [dallas, winterGarden] = await Promise.all([validateDallasPitchedAtticHydraulicRegistration(dallasPacket), validateWinterGardenPitchedHydraulicRegistration(winterGardenPacket)]);
    const portfolio = validateCompletedPitchedHydraulicPortfolio(dallas, winterGarden);
    expect(portfolio.status).toBe('passed');
    expect(portfolio.featurePromotion.pitched_hydraulic_geometry_registration).toMatchObject({ ready: true, projectCount: 2 });
    expect(portfolio.featurePromotion.completed_pitched_hydraulic_reference).toMatchObject({ ready: true, projectCount: 2 });
    expect(portfolio.featurePromotion.per_head_pitched_hydraulic_identity).toMatchObject({ ready: false, projectCount: 1 });
    expect(portfolio.featurePromotion.mapped_pitched_branch_nominal_size).toMatchObject({ ready: false, projectCount: 1 });
    expect(portfolio.featurePromotion.generated_pitched_design_compliance.ready).toBe(false);
  });

  it('keeps historical completed-reference review separate from generated-design compliance', async () => {
    const result = await validateDallasPitchedAtticHydraulicRegistration(dallasPacket);
    expect(result.historicalReview.reviewedForApplicableCodesAndStandards).toBe(true);
    expect(result.historicalCompletedReferenceReviewReady).toBe(true);
    expect(result.generatedDesignComplianceReady).toBe(false);
    expect(result.obstructionClearanceReady).toBe(false);
    expect(result.fabricationReady).toBe(false);
    expect(result.complianceReady).toBe(false);
  });

  it('rejects source, lifecycle, identity, scale, diameter, duplicate-project, and compliance mutations', async () => {
    const winterGarden = await validateWinterGardenPitchedHydraulicRegistration(winterGardenPacket);
    const loop = await verifyDallasPitchedAtticHydraulicAdversarialLoop(dallasPacket, winterGarden);
    expect(loop.status).toBe('passed');
    expect(Object.values(loop).filter((value) => typeof value === 'boolean').every(Boolean)).toBe(true);
    const draft = structuredClone(dallasPacket); delete draft.receiptSha256; draft.heads[0].pressurePsi += 1;
    const resealed = await sealDallasPitchedAtticHydraulicRegistration(draft);
    expect((await validateDallasPitchedAtticHydraulicRegistration(resealed)).status).toBe('blocked');
  });
});
