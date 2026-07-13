import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { generateSlopedCeilingLayout } from '../src/engine/sloped-ceiling-layout.js';
import { buildSlopedCeilingModel3d, verifySlopedCeilingModel3d } from '../src/engine/sloped-ceiling-model3d.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/submitted-sloped-ceiling-calibration.dillon.json', import.meta.url), 'utf8'));
const layoutRegions = packet.slopeRegions.map((region) => ({ id: region.id, polygonSubmittedPt: region.polygonSubmittedPt, slopeAxis: region.slopeAxis, downhillDirection: region.downhillDirection, riseIn: 3, runIn: 12, shouldProtect: region.protectionBasis === 'completed-bid-protected', obstructions: region.obstructions.map(({ id, kind, centerSubmittedPt, clearanceFt, preferredSide }) => ({ id, kind, centerSubmittedPt, clearanceFt, preferredSide })) }));
const modelRegions = packet.slopeRegions.map((region) => ({ id: region.id, polygonSubmittedPt: region.polygonSubmittedPt, slopeAxis: region.slopeAxis, downhillDirection: region.downhillDirection, riseIn: 3, runIn: 12, shouldProtect: region.protectionBasis === 'completed-bid-protected', elevationDatum: region.elevationDatum ? { datumPointSubmittedPt: region.elevationDatum.datumPointSubmittedPt, projectElevationFt: region.elevationDatum.projectElevationFt, slopeDirection: region.elevationDatum.slopeDirection, sourceText: region.elevationDatum.sourceText } : null }));
const layoutInput = { artifactType: 'halofire.sloped-ceiling-layout-input.v1', printedScalePtPerFt: 13.5, regions: layoutRegions, maxAcrossSlopeSpanFt: 20, maxAlongSlopeSpanFt: 12 };
const modelInput = { artifactType: 'halofire.sloped-ceiling-model3d-input.v1', printedScalePtPerFt: 13.5, regions: modelRegions, hydraulicDatumJoin: { projectDatumOffsetFt: packet.hydraulicDatumJoin.projectDatumOffsetFt, activeNodes: packet.hydraulicDatumJoin.activeNodes, protectedRegionHeadNodeMappingReady: packet.hydraulicDatumJoin.protectedRegionHeadNodeMappingReady } };

describe('source-grounded Dillon 3D slope model', () => {
  it('builds four 3:12 surfaces with two non-flat heads and a slope-following pipe', () => {
    const layout = generateSlopedCeilingLayout(layoutInput);
    const model = buildSlopedCeilingModel3d(layout, modelInput);
    const proof = verifySlopedCeilingModel3d(model, layout, modelInput);
    expect(proof.status).toBe('passed');
    expect(proof.counts).toEqual({ surfaces: 4, heads: 2, pipes: 1, nonFlatHeadElevations: 2, hydraulicNodesJoined: 5 });
    expect(proof.maxPlaneResidualFt).toBe(0);
    expect(model.absoluteElevationReady).toBe(true);
    expect(model.datumMode).toBe('source-bound-project-elevation');
    expect(model.hydraulicDatumJoined).toBe(true);
    expect(model.protectedRegionHeadNodeMappingReady).toBe(false);
    expect(model.heads.every((head) => head.pointFt[2] > 100)).toBe(true);
    expect(model.complianceReady).toBe(false);
    expect(model.elevationProfiles).toHaveLength(4);
    expect(proof.elevationProfileCount).toBe(4);
    expect(proof.maxNormalResidual).toBe(0);
    expect(proof.maxProfileResidualFt).toBe(0);
    expect(model.surfaces.every((surface) => surface.triangles.length === surface.vertices.length - 2)).toBe(true);
    expect(model.surfaces.every((surface) => Math.abs(Math.hypot(...surface.normalUnit) - 1) < 1e-9)).toBe(true);
    expect(model.heads.every((head) => Math.abs(Math.hypot(...head.normalUnit) - 1) < 1e-9)).toBe(true);
    const protectedProfile = model.elevationProfiles.find((profile) => profile.regionId === 'slope-region-east-covered');
    expect(protectedProfile).toMatchObject({ sourceDatumStatus: 'source-bound-project-elevation', sourceText: 'SOFFIT @ 9\'-0" (109\'-0")', pitch: { riseIn: 3, runIn: 12 } });
    expect(protectedProfile.riseFt).toBeCloseTo(protectedProfile.spanFt * 3 / 12, 9);
  });

  it('adversarially rejects a head lifted off its source 3:12 plane', () => {
    const layout = generateSlopedCeilingLayout(layoutInput);
    const model = buildSlopedCeilingModel3d(layout, modelInput);
    model.heads[0].pointFt[2] += 1;
    const proof = verifySlopedCeilingModel3d(model, layout, modelInput);
    expect(proof.status).toBe('blocked');
    expect(proof.issues.map((entry) => entry.code)).toContain('SLOPED_MODEL3D_HEAD_PLANE_RESIDUAL');
  });

  it('adversarially rejects drift between hydraulic-local and project elevations', () => {
    const badInput = structuredClone(modelInput);
    badInput.hydraulicDatumJoin.activeNodes[0].projectElevationFt += 1;
    const layout = generateSlopedCeilingLayout(layoutInput);
    const model = buildSlopedCeilingModel3d(layout, badInput);
    const proof = verifySlopedCeilingModel3d(model, layout, badInput);
    expect(proof.status).toBe('blocked');
    expect(proof.issues.map((entry) => entry.code)).toContain('SLOPED_MODEL3D_HYDRAULIC_DATUM_DRIFT');
  });

  it('adversarially rejects incomplete triangles and a lifted surface vertex', () => {
    const layout = generateSlopedCeilingLayout(layoutInput);
    const model = buildSlopedCeilingModel3d(layout, modelInput);
    model.surfaces[0].triangles.pop();
    model.surfaces[1].vertices[0].pointFt[2] += .5;
    const proof = verifySlopedCeilingModel3d(model, layout, modelInput);
    expect(proof.status).toBe('blocked');
    expect(proof.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(['SLOPED_MODEL3D_TRIANGULATION_INCOMPLETE', 'SLOPED_MODEL3D_SURFACE_PLANE_RESIDUAL']));
  });

  it('adversarially rejects forged plane normals and side-elevation profiles', () => {
    const layout = generateSlopedCeilingLayout(layoutInput);
    const model = buildSlopedCeilingModel3d(layout, modelInput);
    model.surfaces[0].normalUnit = [0, 0, 1];
    model.heads[0].normalUnit = [0, 0, 1];
    model.surfaces[1].elevationProfile.downhill.elevationFt += 1;
    const proof = verifySlopedCeilingModel3d(model, layout, modelInput);
    expect(proof.status).toBe('blocked');
    expect(proof.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(['SLOPED_MODEL3D_NORMAL_DRIFT', 'SLOPED_MODEL3D_HEAD_NORMAL_DRIFT', 'SLOPED_MODEL3D_ELEVATION_PROFILE_DRIFT']));
  });
});
