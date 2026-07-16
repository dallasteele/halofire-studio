import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildDillonVerticalModel, renderDillonVerticalElevationView, validateDillonVerticalRegistration } from '../src/engine/dillon-vertical-registration.js';
const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const packet = read('dillon-vertical-registration.json'); const sourceGeometry = read('dillon-dwg-source-geometry.json'); const bidGeometry = read('dillon-completed-bid-geometry.json'); const floorModel = read('dillon-floor-by-floor-model.json'); const slopedCalibration = read('submitted-sloped-ceiling-calibration.dillon.json');
const dependencies = { sourceGeometry, bidGeometry, floorModel, slopedCalibration };
let result; beforeAll(async () => { result = await validateDillonVerticalRegistration(packet, dependencies); });

describe('Dillon partial source-bound vertical registration', () => {
  it('assigns only source-supported Z and leaves the rest unresolved', () => {
    expect(result.status).toBe('passed'); expect(result.counts).toEqual({ totalHeads: 76, sourceAssignedHeads: 5, unresolvedHeads: 71, totalPipeSegments: 67, sourceAssignedPipeSegments: 3, unresolvedPipeSegments: 64 });
    expect(packet.complete).toBe(false); expect(packet.complianceReady).toBe(false);
    expect(packet.sheets.map((sheet) => sheet.annotations.length)).toEqual([54, 22]);
    expect(packet.sheets.map((sheet) => sheet.roomRegistry.counts.surfaceResolvedCells)).toEqual([3, 1]);
    expect(packet.limitations.join(' ')).toContain('annotation proximity alone is rejected');
  });
  it('builds 3D coordinates only for assigned elements', () => {
    const model = buildDillonVerticalModel(result); expect(model.status).toBe('passed'); expect(model.heads).toHaveLength(5); expect(model.pipes).toHaveLength(3); expect(model.heads.some((head) => head.surfaceKind === 'sloped-ceiling')).toBe(true); expect(model.heads.some((head) => head.roomCellId)).toBe(true); expect(model.complete).toBe(false);
    const view = renderDillonVerticalElevationView(model); expect(view.svg).toContain('5/76 heads + 3/67 pipes have source-bound Z'); expect(view.svg).toContain('unresolved elements are omitted');
  });
  it.each([
    ['receipt content', (value) => { const row = value.sheets.flatMap((sheet) => sheet.headAssignments).find((entry) => entry.status === 'source-assigned'); row.status = 'unresolved'; delete row.method; delete row.annotationId; delete row.surfaceKind; delete row.heightAboveFloorFt; delete row.sourceDistanceFt; delete row.modelElevationFt; delete row.siteProjectElevationFt; }],
    ['head datum', (value) => { const row = value.sheets.flatMap((sheet) => sheet.headAssignments).find((entry) => entry.status === 'source-assigned'); row.modelElevationFt += 1; }],
    ['pipe datum', (value) => { const row = value.sheets.flatMap((sheet) => sheet.pipeAssignments).find((entry) => entry.status === 'source-assigned'); row.modelElevationsFt[0] += 1; }],
    ['annotation height', (value) => { value.sheets[0].annotations[0].heightAboveFloorFt += 1; }],
    ['room registry', (value) => { value.sheets[0].roomRegistry.rooms[0].areaFt2 += 1; }],
    ['room reassignment', (value) => { const row = value.sheets.flatMap((sheet) => sheet.headAssignments).find((entry) => entry.roomCellId); row.roomCellId = 'fabricated-room'; }],
  ])('blocks adversarial %s mutation', async (_label, mutate) => { const changed = structuredClone(packet); mutate(changed); expect((await validateDillonVerticalRegistration(changed, dependencies)).status).toBe('blocked'); });
  it('blocks dependency substitution', async () => { const changed = structuredClone(floorModel); changed.receiptSha256 = '0'.repeat(64); const blocked = await validateDillonVerticalRegistration(packet, { ...dependencies, floorModel: changed }); expect(blocked.issues.map((entry) => entry.code)).toContain('DILLON_VERTICAL_FLOOR_SOURCE_MISMATCH'); });
  it('blocks neutral DWG room-boundary substitution', async () => { const changed = structuredClone(sourceGeometry); changed.levels[0].wallPolygonsFt[0][0][0] += 1; const blocked = await validateDillonVerticalRegistration(packet, { ...dependencies, sourceGeometry: changed }); expect(blocked.issues.map((entry) => entry.code)).toContain('DILLON_VERTICAL_ROOM_SOURCE_MISMATCH'); });
});
