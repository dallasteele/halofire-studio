import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { generateSlopedCeilingLayout } from '../src/engine/sloped-ceiling-layout.js';
import { buildSlopedCeilingModel3d, verifySlopedCeilingModel3d } from '../src/engine/sloped-ceiling-model3d.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/submitted-sloped-ceiling-calibration.dillon.json', import.meta.url), 'utf8'));
const layoutRegions = packet.slopeRegions.map((region) => ({ id: region.id, polygonSubmittedPt: region.polygonSubmittedPt, slopeAxis: region.slopeAxis, downhillDirection: region.downhillDirection, riseIn: 3, runIn: 12, shouldProtect: region.protectionBasis === 'completed-bid-protected', obstructions: region.obstructions.map(({ id, kind, centerSubmittedPt, clearanceFt, preferredSide }) => ({ id, kind, centerSubmittedPt, clearanceFt, preferredSide })) }));
const modelRegions = packet.slopeRegions.map((region) => ({ id: region.id, polygonSubmittedPt: region.polygonSubmittedPt, slopeAxis: region.slopeAxis, downhillDirection: region.downhillDirection, riseIn: 3, runIn: 12, shouldProtect: region.protectionBasis === 'completed-bid-protected', elevationDatum: region.elevationDatum ? { datumPointSubmittedPt: region.elevationDatum.datumPointSubmittedPt, projectElevationFt: region.elevationDatum.projectElevationFt, slopeDirection: region.elevationDatum.slopeDirection, sourceText: region.elevationDatum.sourceText } : null }));
const layoutInput = { artifactType: 'halofire.sloped-ceiling-layout-input.v1', printedScalePtPerFt: 13.5, regions: layoutRegions, maxAcrossSlopeSpanFt: 20, maxAlongSlopeSpanFt: 12 };
const modelInput = { artifactType: 'halofire.sloped-ceiling-model3d-input.v1', printedScalePtPerFt: 13.5, regions: modelRegions };

describe('source-grounded Dillon 3D slope model', () => {
  it('builds four 3:12 surfaces with two non-flat heads and a slope-following pipe', () => {
    const layout = generateSlopedCeilingLayout(layoutInput);
    const model = buildSlopedCeilingModel3d(layout, modelInput);
    const proof = verifySlopedCeilingModel3d(model, layout, modelInput);
    expect(proof.status).toBe('passed');
    expect(proof.counts).toEqual({ surfaces: 4, heads: 2, pipes: 1, nonFlatHeadElevations: 2 });
    expect(proof.maxPlaneResidualFt).toBe(0);
    expect(model.absoluteElevationReady).toBe(true);
    expect(model.datumMode).toBe('source-bound-project-elevation');
    expect(model.heads.every((head) => head.pointFt[2] > 100)).toBe(true);
    expect(model.complianceReady).toBe(false);
  });

  it('adversarially rejects a head lifted off its source 3:12 plane', () => {
    const layout = generateSlopedCeilingLayout(layoutInput);
    const model = buildSlopedCeilingModel3d(layout, modelInput);
    model.heads[0].pointFt[2] += 1;
    const proof = verifySlopedCeilingModel3d(model, layout, modelInput);
    expect(proof.status).toBe('blocked');
    expect(proof.issues.map((entry) => entry.code)).toContain('SLOPED_MODEL3D_HEAD_PLANE_RESIDUAL');
  });
});
