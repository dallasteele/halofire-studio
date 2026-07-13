import { describe, expect, it } from 'vitest';
import mapping from '../src/data/winter-garden-fabrication-plan-mapping.json';
import ceiling from '../src/data/winter-garden-ceiling-elevation-evidence.json';
import registration from '../src/data/winter-garden-grid-registration.json';
import heads from '../src/data/winter-garden-fp3-head-evidence.json';
import { buildWinterGardenFabricationRegisteredModel, sealWinterGardenFabricationPlanMapping, validateWinterGardenFabricationPlanMapping } from '../src/engine/winter-garden-fabrication-plan-mapping.js';

describe('Winter Garden SprinkCad fabrication-to-plan mapping', () => {
  it('bijectively maps 15 one-inch pendent takeoffs to the 15 completed chapel heads', async () => {
    const result = await validateWinterGardenFabricationPlanMapping(mapping, registration, heads);
    expect(result.status).toBe('passed');
    expect(result.metrics).toMatchObject({ mappedHeadCount: 15, mappedOutletCount: 15, branchRowCount: 3, manufacturerDeflectorEnvelopeIn: [3 / 16, 11 / 16] });
    expect(result.metrics.maximumOutletToHeadXResidualPx).toBeLessThanOrEqual(1.01);
    expect(new Set(result.mappings.map((entry) => entry.headId)).size).toBe(15);
    expect(new Set(result.mappings.map((entry) => entry.outletNo)).size).toBe(15);
    expect(result.mappings.every((entry) => entry.sizeIn === 1)).toBe(true);
    expect(result.mappings.every((entry) => entry.takeoffPlanPointPx[1] !== entry.registeredPlanHeadPointPx[1])).toBe(true);
  });

  it('builds source-bound branch Z and the submitted TY3531 installation envelope', async () => {
    const model = await buildWinterGardenFabricationRegisteredModel(mapping, ceiling, registration, heads);
    expect(model.status).toBe('passed');
    expect(model.counts).toEqual({ ceilingSurfaces: 2, headEnvelopes: 15, fabricationMappedHeads: 15, exactBranchRowPipes: 3 });
    expect(model.branchPipes3d.map((pipe) => pipe.elevationFt)).toEqual([119.4166666667, 124.0833333333, 119.3333333333]);
    expect(model.headEnvelopes.every((head) => head.sprinkler.sin === 'TY3531' && head.fabricationOutlet.sizeIn === 1 && head.manufacturerInstallationEnvelopeReady)).toBe(true);
    expect(model.headEnvelopes.every((head) => Math.abs((head.deflectorElevationRangeFt[1] - head.deflectorElevationRangeFt[0]) * 12 - 0.5) < 1e-9)).toBe(true);
    expect(model.fabricationPlanMappingReady).toBe(true);
    expect(model.branchRowPipeElevationReady).toBe(true);
    expect(model.exactAsBuiltDeflectorElevationReady).toBe(false);
    expect(model.fullNetworkPipeElevationReady).toBe(false);
    expect(model.complianceReady).toBe(false);
  });

  it('adversarially rejects a wrong outlet family, sequence substitution, and cut-sheet drift', async () => {
    const wrongOutlet = structuredClone(mapping); delete wrongOutlet.receiptSha256; wrongOutlet.rows[0].chains[0].pieces[0].selectedOutlets[0].sizeIn = 0.5;
    expect((await validateWinterGardenFabricationPlanMapping(await sealWinterGardenFabricationPlanMapping(wrongOutlet), registration, heads)).issues.map((entry) => entry.code)).toContain('WG_FAB_PLAN_OUTLET_TYPE_DRIFT');
    const wrongSequence = structuredClone(mapping); delete wrongSequence.receiptSha256; wrongSequence.rows[1].chains[0].pieces[0].selectedOutlets[0].runDimFt = 4.25000034;
    expect((await validateWinterGardenFabricationPlanMapping(await sealWinterGardenFabricationPlanMapping(wrongSequence), registration, heads)).issues.map((entry) => entry.code)).toContain('WG_FAB_PLAN_OUTLET_HEAD_RESIDUAL_EXCEEDED');
    const wrongCutSheet = structuredClone(mapping); delete wrongCutSheet.receiptSha256; wrongCutSheet.sources.submittedSprinklerCutSheets.sha256 = '0'.repeat(64);
    expect((await validateWinterGardenFabricationPlanMapping(await sealWinterGardenFabricationPlanMapping(wrongCutSheet), registration, heads)).issues.map((entry) => entry.code)).toContain('WG_FAB_PLAN_SOURCE_DRIFT');
  });
});
