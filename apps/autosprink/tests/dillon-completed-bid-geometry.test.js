import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { renderDillonCompletedBidViews, validateDillonCompletedBidGeometry } from '../src/engine/dillon-completed-bid-geometry.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/dillon-completed-bid-geometry.json', import.meta.url), 'utf8'));
const floorModel = JSON.parse(fs.readFileSync(new URL('../src/data/dillon-floor-by-floor-model.json', import.meta.url), 'utf8'));
let result;
beforeAll(async () => { result = await validateDillonCompletedBidGeometry(packet, floorModel); });

describe('Dillon completed-bid PDF to architectural DWG registration', () => {
  it('keeps sheet schedules independent and exposes the real FP-1 mismatch', () => {
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({ declaredHeads: 77, detectedHeads: 76, unresolvedHeads: 1, pipeSegments: 67 });
    expect(packet.sheets[0].schedule).toMatchObject({ declaredTotal: 52, detected: { round: 40, alternate: 11, total: 51 }, complete: false, unresolvedCount: 1 });
    expect(packet.sheets[1].schedule).toMatchObject({ declaredTotal: 25, detected: { round: 24, alternate: 1, total: 25 }, complete: true, unresolvedCount: 0 });
    expect(packet.verticalGeometryReady).toBe(false);
    expect(packet.complianceReady).toBe(false);
  });

  it('registers every head and connected pipe vector into its matching DWG level', () => {
    expect(packet.sheets[0]).toMatchObject({ levelId: 'main-house-main', vectorEvidence: { connectedPipeSegments: 43, allDetectedHeadsTouchPipeNetwork: true } });
    expect(packet.sheets[1]).toMatchObject({ levelId: 'main-house-upper', vectorEvidence: { connectedPipeSegments: 24, allDetectedHeadsTouchPipeNetwork: true } });
    expect(packet.sheets[0].registration).toMatchObject({ matchedCoordinates: 195, xWeightedRmsFt: 0.00721, yWeightedRmsFt: 0.01759 });
    expect(packet.sheets[1].registration).toMatchObject({ matchedCoordinates: 136, xWeightedRmsFt: 0.00926, yWeightedRmsFt: 0.01251 });
  });

  it('renders both completed bid networks over actual DWG wall geometry', () => {
    const views = renderDillonCompletedBidViews(result, floorModel);
    expect(views.status).toBe('passed');
    expect(views.planViews).toHaveLength(2);
    expect(views.planViews[0].svg).toContain('51/52 heads');
    expect(views.planViews[1].svg).toContain('25/25 heads');
    expect(views.verticalStatus).toBe('per-element-z-unresolved');
  });

  it.each([
    ['registration', (value) => { value.sheets[0].registration.xOffsetFt += 1; }],
    ['head', (value) => { value.sheets[0].heads[0].planPointDwgFt[0] += 1; }],
    ['pipe', (value) => { value.sheets[1].pipeSegments[0].planDwgFt[0][1] += 1; }],
    ['schedule', (value) => { value.sheets[1].schedule.detected.total -= 1; }],
    ['architectural source', (value) => { value.architecturalGeometrySha256 = '0'.repeat(64); }],
  ])('adversarially blocks %s tampering', async (_label, mutate) => {
    const changed = structuredClone(packet); mutate(changed);
    expect((await validateDillonCompletedBidGeometry(changed, floorModel)).status).toBe('blocked');
  });

  it('blocks architectural model substitution even with an intact bid receipt', async () => {
    const changedFloor = structuredClone(floorModel); changedFloor.sourceGeometrySha256 = 'f'.repeat(64);
    const blocked = await validateDillonCompletedBidGeometry(packet, changedFloor);
    expect(blocked.issues.map((entry) => entry.code)).toContain('DILLON_BID_ARCHITECTURAL_SOURCE_MISMATCH');
  });
});
