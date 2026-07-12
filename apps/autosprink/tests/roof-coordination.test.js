import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { reconstructRoofPlanes } from '../src/engine/roof-geometry.js';
import {
  checkRoofRouteAgainstCoordination,
  mergeRoofCoordination,
  validateRoofCoordination,
} from '../src/engine/roof-coordination.js';

const readJson = (url) => JSON.parse(fs.readFileSync(url, 'utf8'));
const packetUrl = new URL('../src/data/roof-coordination.cooperative-1881.json', import.meta.url);
const roofUrl = new URL('../src/data/roof-reconstruction.cooperative-1881.json', import.meta.url);

describe('Cooperative 1881 issued MEP roof registration', () => {
  it('validates the sealed source inventory, grid controls, and honest residual counts', async () => {
    const model = await validateRoofCoordination(readJson(packetUrl));
    expect(model.status).toBe('passed');
    expect(model.equipment.filter((item) => item.kind === 'heat-pump')).toHaveLength(135);
    expect(model.equipment.filter((item) => item.kind === 'outdoor-unit')).toHaveLength(4);
    expect(model.vents).toHaveLength(83);
    expect(model.counts.unmatchedMechanicalLabels).toBe(5);
    expect(model.counts.unmatchedVentLabels).toBe(6);
    expect(Math.max(...model.transforms.map((item) => item.maxResidualFt))).toBeLessThan(1 / 6);
    expect(model.coverage.complete).toBe(false);
    expect(model.complianceReady).toBe(false);
    expect(model.approvalReady).toBe(false);
  });

  it('keeps unknown equipment heights and clearances fail closed', async () => {
    const model = await validateRoofCoordination(readJson(packetUrl));
    expect(model.equipment.every((item) => item.heightFt == null)).toBe(true);
    expect(model.equipment.every((item) => item.heightStatus === 'unresolved-model-specific-dimension')).toBe(true);
    expect(model.equipment.every((item) => item.clearanceStatus === 'unresolved')).toBe(true);
    expect(model.vents.every((item) => item.clearanceStatus === 'unresolved')).toBe(true);
    expect(model.counts.scheduleCounts).toEqual({ 'HP-1': 84, 'HP-2': 84, 'HP-3': 24 });
    expect(model.counts.acceptedHeatPumpFootprints).not.toBe(192);
  });

  it('rejects receipt tampering, misstated counts, and convenient transform residuals', async () => {
    const tampered = readJson(packetUrl); tampered.equipment[0].boundaryPlanFt[0][0] += 10;
    expect((await validateRoofCoordination(tampered)).issues[0].code).toBe('ROOF_COORDINATION_RECEIPT_MISMATCH');

    const packet = readJson(packetUrl); const receipt = packet.evidenceReceiptSha256;
    packet.counts.acceptedHeatPumpFootprints = 192; packet.evidenceReceiptSha256 = receipt;
    expect((await validateRoofCoordination(packet)).issues[0].code).toBe('ROOF_COORDINATION_RECEIPT_MISMATCH');

    const strict = await validateRoofCoordination(readJson(packetUrl), { registrationToleranceFt: 0.05 });
    expect(strict.issues.map((entry) => entry.code)).toContain('ROOF_COORDINATION_REGISTRATION_RESIDUAL_EXCEEDED');
  });

  it('merges registered visible features into the pitched roof without creating a compliance claim', async () => {
    const roof = await reconstructRoofPlanes(readJson(roofUrl));
    const coordination = await validateRoofCoordination(readJson(packetUrl));
    const merged = mergeRoofCoordination(roof, coordination);
    expect(merged.status).toBe('passed');
    expect(merged.features).toHaveLength(11 + 135 + 4 + 83);
    expect(merged.features.filter((item) => item.type === 'rooftop-heat-pump')).toHaveLength(135);
    expect(merged.coordination.complianceReady).toBe(false);
    expect(merged.coverage.complete).toBe(false);
  });

  it('blocks equipment and vent crossings while allowing a geometrically clear route', async () => {
    const model = await validateRoofCoordination(readJson(packetUrl));
    const equipment = model.equipment[0]; const vent = model.vents[0];
    const xs = equipment.boundaryPlanFt.map((point) => point[0]); const ys = equipment.boundaryPlanFt.map((point) => point[1]);
    const equipmentCrossing = [{ from: [Math.min(...xs) - 1, (Math.min(...ys) + Math.max(...ys)) / 2], to: [Math.max(...xs) + 1, (Math.min(...ys) + Math.max(...ys)) / 2] }];
    const ventCrossing = [{ from: [vent.planPointFt[0] - 1, vent.planPointFt[1]], to: [vent.planPointFt[0] + 1, vent.planPointFt[1]] }];
    expect(checkRoofRouteAgainstCoordination(equipmentCrossing, model).status).toBe('blocked');
    expect(checkRoofRouteAgainstCoordination(ventCrossing, model).status).toBe('blocked');
    expect(checkRoofRouteAgainstCoordination([{ from: [-1000, -1000], to: [-900, -900] }], model).status).toBe('passed');
    expect(checkRoofRouteAgainstCoordination([], model).complianceReady).toBe(false);
  });
});
