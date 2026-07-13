import { describe, expect, it } from 'vitest';
import elevations from '../src/data/elevation-datums.nashville.json';
import footprints from '../src/data/source-bound-footprints.nashville.json';
import { extractElevationDatums, sha256Hex } from '../src/engine/elevation-datums.js';
import { validateLevelFootprintPacket } from '../src/engine/source-bound-footprint.js';
import {
  buildNashvilleExtrusionModel,
  buildNashvilleFloorByFloorModel,
  renderNashvilleFloorByFloorViews,
  validateNashvilleFloorByFloorModel,
} from '../src/engine/nashville-floor-by-floor-model.js';

describe('Nashville source-bound floor-by-floor model', () => {
  it('validates immutable A301 elevations and per-level A110/A131.1 footprints', async () => {
    const vertical = await extractElevationDatums(elevations, { expectedSourcePdfSha256: footprints.sourcePdfSha256 });
    const levels = await validateLevelFootprintPacket(footprints);
    expect(vertical.status).toBe('passed');
    expect(vertical.datums.map((datum) => [datum.id, datum.elevationFt])).toEqual([
      ['level-01', 100],
      ['mezzanine-a', 108.78125],
      ['parapet-1', 118.25],
      ['parapet-2', 123],
    ]);
    expect(levels.status).toBe('passed');
    expect(levels.geometryComplete).toBe(true);
    expect(levels.levels.map((level) => [level.sheetId, level.areaSqft])).toEqual([
      ['A110', 10839.678681],
      ['A131.1', 670.141141],
    ]);
    expect(levels.levels[0].derivation.selectionPolicy).toMatch(/selected by PDF paint semantics before printed-area control/);
    expect(levels.levels[1].derivation.areaSpreadPct).toBeLessThan(1);
    expect(levels.levels[1].derivation.registration.rmsXFt).toBeLessThan(0.003);
    expect(levels.levels[1].derivation.registration.rmsYFt).toBeLessThan(0.005);
  });

  it('builds two scaled extrusion solids in a common plan frame and the A301 vertical frame', async () => {
    const model = await buildNashvilleFloorByFloorModel({ footprints, elevations });
    const validation = await validateNashvilleFloorByFloorModel(model, { footprints, elevations });
    const extrusion = buildNashvilleExtrusionModel(validation);
    const views = renderNashvilleFloorByFloorViews(validation);
    expect(validation.status).toBe('passed');
    expect(validation.counts).toEqual({ levels: 2, extrusionSolids: 2, independentlyRegisteredPlanViews: 5 });
    expect(model.levels.map((level) => [level.id, level.modelElevationFt, level.extrusionHeightFt])).toEqual([
      ['level-01', 0, 8.78125],
      ['level-02-tower', 8.78125, 14.21875],
    ]);
    expect(extrusion.status).toBe('passed');
    expect(extrusion.solids).toHaveLength(2);
    expect(extrusion.solids[0].topElevationFt).toBe(extrusion.solids[1].baseElevationFt);
    expect(views.status).toBe('passed');
    expect(views.isometricSvg).toContain('2 sealed extrusion solids');
    expect(views.elevationSvg).toContain('parapets 118.25');
  });

  it('binds both levels back to sprinkler-design/completed-output grids', async () => {
    const model = await buildNashvilleFloorByFloorModel({ footprints, elevations });
    const byTarget = new Map(model.registrations.map((entry) => [entry.target, entry]));
    expect(byTarget.get('F102 Level 02 fire-protection plan')).toMatchObject({
      colControls: ['3', '4'], rowControls: ['B', 'B.5', 'C'],
    });
    expect(byTarget.get('F102 Level 02 fire-protection plan').rmsXFt).toBeLessThan(0.003);
    expect(byTarget.get('F102 Level 02 fire-protection plan').rmsYFt).toBeLessThan(0.005);
    expect(byTarget.get('as-built FP2 main-level grid').colControls).toHaveLength(7);
    expect(byTarget.get('as-built FP2 main-level grid').rowControls).toHaveLength(5);
  });

  it('adversarially rejects receipt drift, resealed polygon substitution, and registration drift', async () => {
    const model = await buildNashvilleFloorByFloorModel({ footprints, elevations });

    const receiptDrift = structuredClone(model);
    receiptDrift.levels[0].areaSqft += 1;
    expect((await validateNashvilleFloorByFloorModel(receiptDrift, { footprints, elevations })).issues.map((entry) => entry.code))
      .toContain('NASHVILLE_MODEL_RECEIPT_MISMATCH');

    const polygonSubstitution = structuredClone(model);
    polygonSubstitution.levels[1].polygonPlanFt[0][0] += 0.25;
    polygonSubstitution.levels[1].areaSqft = 670.2;
    const { receiptSha256: ignoredPolygonReceipt, ...polygonDraft } = polygonSubstitution;
    polygonSubstitution.receiptSha256 = await sha256Hex(polygonDraft);
    expect((await validateNashvilleFloorByFloorModel(polygonSubstitution, { footprints, elevations })).issues.map((entry) => entry.code))
      .toContain('NASHVILLE_MODEL_LEVEL_SOURCE_DRIFT');

    const registrationDrift = structuredClone(model);
    registrationDrift.registrations[1].rmsXFt = 0.75;
    const { receiptSha256: ignoredRegistrationReceipt, ...registrationDraft } = registrationDrift;
    registrationDrift.receiptSha256 = await sha256Hex(registrationDraft);
    expect((await validateNashvilleFloorByFloorModel(registrationDrift, { footprints, elevations })).issues.map((entry) => entry.code))
      .toContain('NASHVILLE_MODEL_REGISTRATION_RESIDUAL_EXCEEDED');
    expect(ignoredPolygonReceipt).toBeTruthy();
    expect(ignoredRegistrationReceipt).toBeTruthy();
  });
});
