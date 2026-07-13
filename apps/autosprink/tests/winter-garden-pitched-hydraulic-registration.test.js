import { describe, expect, it } from 'vitest';
import packet from '../src/data/winter-garden-pitched-hydraulic-registration.json';
import mapping from '../src/data/winter-garden-fabrication-plan-mapping.json';
import ceiling from '../src/data/winter-garden-ceiling-elevation-evidence.json';
import registration from '../src/data/winter-garden-grid-registration.json';
import heads from '../src/data/winter-garden-fp3-head-evidence.json';
import { buildWinterGardenPitchedHydraulicModel, sealWinterGardenPitchedHydraulicRegistration, validateWinterGardenPitchedHydraulicRegistration, verifyWinterGardenPitchedHydraulicAdversarialLoop } from '../src/engine/winter-garden-pitched-hydraulic-registration.js';

const dependencies = { fabricationMapping: mapping, ceilingEvidence: ceiling, gridRegistration: registration, headEvidence: heads };

describe('Winter Garden completed pitched hydraulic registration', () => {
  it('registers three completed pitched rows to the stamped hydraulic elevations', async () => {
    const result = await validateWinterGardenPitchedHydraulicRegistration(packet);
    expect(result.status).toBe('passed');
    expect(result.metrics).toEqual({ pitchedRowCount: 3, operatingSprinklerCount: 17, hydraulicInsideDiameterClassCount: 6, maximumRowElevationResidualIn: expect.closeTo(0.04, 8) });
    expect(result.pitchedRowJoins.map((row) => row.rowId)).toEqual(['chapel-north', 'chapel-ridge', 'chapel-south']);
    expect(result.rowResiduals.every((row) => row.residualIn <= 0.04 + 1e-8)).toBe(true);
    expect(result.pitchedRowHydraulicDatumRegistrationReady).toBe(true);
    expect(result.operatingSprinklerHydraulicEvidenceReady).toBe(true);
    expect(result.hydraulicInsideDiameterReportEvidenceReady).toBe(true);
    expect(result.perHeadHydraulicIdentityReady).toBe(false);
    expect(result.nominalPipeSizeReady).toBe(false);
    expect(result.complianceReady).toBe(false);
  });

  it('builds a 15-head pitched 3D model with row-level HASS datums and truthful views', async () => {
    const model = await buildWinterGardenPitchedHydraulicModel(packet, dependencies);
    expect(model.status).toBe('passed');
    expect(model.counts).toEqual({ ceilingSurfaces: 2, headEnvelopes: 15, fabricationMappedHeads: 15, exactBranchRowPipes: 3 });
    expect(model.branchPipes3d.map((pipe) => pipe.hydraulicElevationAboveFloorFt)).toEqual([19.42, 24.08, 19.33]);
    expect(model.branchPipes3d.every((pipe) => Math.abs(pipe.hydraulicElevationResidualIn) <= 0.04 + 1e-8)).toBe(true);
    expect(model.branchPipes3d.every((pipe) => pipe.hydraulicInsideDiameterIn === null && pipe.perHeadHydraulicIdentityReady === false)).toBe(true);
    expect(model.operatingSprinklers).toHaveLength(17);
    expect(model.views.topSvg).toContain('15 completed FP3 heads');
    expect(model.views.elevationSvg).toContain('FP2 branch Z');
    expect(model.views.hydraulicDatumSvg).toContain('no per-head node identity');
    expect(model.complianceReady).toBe(false);
  });

  it('runs a built-in adversarial loop that rejects evidence and claim tampering', async () => {
    const loop = await verifyWinterGardenPitchedHydraulicAdversarialLoop(packet);
    expect(loop.status).toBe('passed');
    expect(Object.entries(loop).filter(([name]) => name !== 'status').every(([, rejected]) => rejected)).toBe(true);
  });

  it('rejects row residual drift even when the mutated packet is resealed', async () => {
    const draft = structuredClone(packet); delete draft.receiptSha256; draft.pitchedRowJoins[2].fabricationElevationAboveFloorFt += 0.5;
    const result = await validateWinterGardenPitchedHydraulicRegistration(await sealWinterGardenPitchedHydraulicRegistration(draft));
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('WG_PITCHED_HYDRAULIC_ROW_IDENTITY_DRIFT');
    expect(result.issues.map((entry) => entry.code)).toContain('WG_PITCHED_HYDRAULIC_ROW_RESIDUAL_HIGH');
  });
});
