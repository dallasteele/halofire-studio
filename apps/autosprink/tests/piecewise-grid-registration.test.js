import { describe, expect, it } from 'vitest';
import registration from '../src/data/winter-garden-grid-registration.json';
import heads from '../src/data/winter-garden-fp3-head-evidence.json';
import { buildWinterGardenChapelPlaneAssignments, piecewiseMap, sealPiecewiseGridRegistration, validatePiecewiseGridRegistration } from '../src/engine/piecewise-grid-registration.js';

describe('Winter Garden piecewise roof-to-RCP registration', () => {
  it('rejects a global transform and maps every labeled grid control exactly', async () => {
    const result = await validatePiecewiseGridRegistration(registration);
    expect(result.status).toBe('passed');
    expect(result.metrics.xGlobalAffineMaxResidualPx).toBeGreaterThan(20);
    expect(result.metrics.yGlobalAffineMaxResidualPx).toBeGreaterThan(20);
    registration.gridX.sourcePx.forEach((value, index) => expect(piecewiseMap(value, registration.gridX.sourcePx, registration.gridX.targetPx)).toBeCloseTo(registration.gridX.targetPx[index], 8));
    registration.gridY.sourcePx.forEach((value, index) => expect(piecewiseMap(value, registration.gridY.sourcePx, registration.gridY.targetPx)).toBeCloseTo(registration.gridY.targetPx[index], 8));
  });

  it('assigns the 15 chapel heads five-per-plane-row while absolute projection stays closed', async () => {
    const result = await buildWinterGardenChapelPlaneAssignments(registration, heads);
    expect(result.status).toBe('passed');
    expect(result.assignments).toHaveLength(15);
    expect(result.counts).toEqual({ 'chapel-north-slope': 5, 'chapel-ridge': 5, 'chapel-south-slope': 5 });
    expect(result.roofPlanes).toHaveLength(2);
    expect(result.projectionReady).toBe(false);
    expect(result.residual).toBe('absolute_deflector_datum_unresolved');
  });

  it('adversarially rejects grid drift even when the receipt is resealed', async () => {
    const shifted = structuredClone(registration); delete shifted.receiptSha256; shifted.gridY.targetPx[3] += 30;
    const resealed = await sealPiecewiseGridRegistration(shifted);
    expect((await validatePiecewiseGridRegistration(resealed)).issues.map((entry) => entry.code)).toContain('GRID_REGISTRATION_RIDGE_DRIFT');
  });
});
