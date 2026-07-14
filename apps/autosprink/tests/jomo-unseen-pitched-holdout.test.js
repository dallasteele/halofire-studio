import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildJomoSourceOnlyCandidate,
  renderJomoSourceCandidateViews,
  validateJomoSourceOnlyCandidate,
  validateJomoSourceSeal,
  verifyJomoSourceCandidateAdversarialLoop,
} from '../src/engine/jomo-unseen-pitched-holdout.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceSeal = read('jomo-unseen-pitched-holdout.json');
const dillonPrior = read('dillon-pitched-placement-prior.json');

describe('JOMO unseen pitched holdout', () => {
  it('keeps the completed sprinkler answer sealed out of source generation', async () => {
    const validation = await validateJomoSourceSeal(sourceSeal);
    expect(validation.status).toBe('passed');
    expect(sourceSeal.answerKeyDenylist[0].openedBeforeSourceSeal).toBe(false);
    expect(sourceSeal.generation.answerKeyUsed).toBe(false);
    expect(sourceSeal.selection.rejectedBeforeAnswerOpen).toHaveLength(5);
  });

  it('builds a drawing-scaled two-plane Great Room correction from dimension authority', async () => {
    const packet = await buildJomoSourceOnlyCandidate(sourceSeal, dillonPrior);
    const validation = await validateJomoSourceOnlyCandidate(packet, { sourceSeal, dillonPrior });
    expect(validation.status).toBe('passed');
    expect(packet.geometry.room).toMatchObject({ areaSqFt: 788.5, widthFt: 44.125 });
    expect(packet.geometry.ceiling).toMatchObject({ springElevationFt: 10, ridgeElevationFt: 16, pitch: { normalizedDrawingRiseIn: 8, runIn: 12 } });
    expect(packet.geometry.ceiling.pitch.riseIn).toBeCloseTo(8.058339, 6);
    expect(packet.geometry.ceiling.pitchDerivation).toMatchObject({ method: 'dimension-authority-not-scaled-roof-graphic', rejectedRoofGraphicRiseInPer12: 10 });
    expect(packet.geometry.ceiling.surfaces).toHaveLength(2);
    expect(packet.heads3d).toHaveLength(6);
    expect(new Set(packet.heads3d.map((head) => head.surfaceId)).size).toBe(2);
    expect(packet.heads3d.every((head) => head.pointFt[2] > packet.geometry.ceiling.springElevationFt && head.pointFt[2] < 16)).toBe(true);
    expect(packet.buildingModel).toMatchObject({ levelCount: 1, floorByFloorExtrusionReady: true, twoPlaneVaultReady: true, wholeBuildingFootprintComplete: false });
    expect(packet.answerKeyUsedAsGeometryInput).toBe(false);
    expect(packet.correctionLoop).toMatchObject({ preAnswerElevationFailed: true, answerKeyExposedBeforeCurrentImplementation: true, freshHoldoutRequired: true });
    expect(packet.unseenProjectPlacementVerified).toBe(false);
    expect(packet.complianceReady).toBe(false);
  });

  it('renders top, elevation, and partial 3D views from the candidate geometry', async () => {
    const packet = await buildJomoSourceOnlyCandidate(sourceSeal, dillonPrior);
    const views = renderJomoSourceCandidateViews(packet);
    expect(views.status).toBe('passed');
    expect(views.topSvg).toContain('44\'-1 1/2&quot;');
    expect(views.elevationSvg).toContain("+10.00' spring · 16.00' ridge · 8.059:12");
    expect(views.model3dSvg).toContain('drawing-scaled floor + wall + two-plane vaulted ceiling');
  });

  it('rejects source, prior, answer leakage, geometry, tally, receipt, and false promotion mutations', async () => {
    const packet = await buildJomoSourceOnlyCandidate(sourceSeal, dillonPrior);
    const result = await verifyJomoSourceCandidateAdversarialLoop(packet, { sourceSeal, dillonPrior });
    expect(result.status).toBe('passed');
    expect(result.rejectedCases).toHaveLength(10);
  });
});
