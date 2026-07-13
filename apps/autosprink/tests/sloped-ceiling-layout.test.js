import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { generateSlopedCeilingLayout, renderSlopedCeilingLayoutViews, verifySlopedCeilingLayoutParity } from '../src/engine/sloped-ceiling-layout.js';
import { buildSlopedCeilingModel3d } from '../src/engine/sloped-ceiling-model3d.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/submitted-sloped-ceiling-calibration.dillon.json', import.meta.url), 'utf8'));
const input = {
  artifactType: 'halofire.sloped-ceiling-layout-input.v1', printedScalePtPerFt: packet.printedScalePtPerFt,
  regions: packet.slopeRegions.map((region) => ({ id: region.id, polygonSubmittedPt: region.polygonSubmittedPt, slopeAxis: region.slopeAxis, downhillDirection: region.downhillDirection, riseIn: 3, runIn: 12, shouldProtect: region.protectionBasis === 'completed-bid-protected', obstructions: region.obstructions.map(({ id, kind, centerSubmittedPt, clearanceFt, preferredSide }) => ({ id, kind, centerSubmittedPt, clearanceFt, preferredSide })) })),
  maxAcrossSlopeSpanFt: 20, maxAlongSlopeSpanFt: 12,
};

describe('slope-aware calibration layout', () => {
  it('generates two heads along the 3:12 protected region and none in completed empty regions', () => {
    const layout = generateSlopedCeilingLayout(input);
    expect(layout.status).toBe('passed');
    expect(layout.heads).toHaveLength(2);
    expect(new Set(layout.heads.map((head) => head.regionId))).toEqual(new Set(['slope-region-east-covered']));
    expect(new Set(layout.heads.map((head) => head.relativeElevationFt)).size).toBe(2);
  });

  it('matches both completed submitted heads within five feet and renders top/elevation views', () => {
    const layout = generateSlopedCeilingLayout(input);
    const parity = verifySlopedCeilingLayoutParity(layout, packet, 5);
    expect(parity.status).toBe('passed');
    expect(parity.matches).toHaveLength(2);
    expect(parity.metrics.precision).toBe(1);
    expect(parity.metrics.recall).toBe(1);
    expect(parity.metrics.maxPlanErrorFt).toBeLessThanOrEqual(3);
    expect(layout.regions.find((region) => region.regionId === 'slope-region-east-covered').obstructionAdjustments).toHaveLength(1);
    const model = buildSlopedCeilingModel3d(layout, {
      artifactType: 'halofire.sloped-ceiling-model3d-input.v1', printedScalePtPerFt: packet.printedScalePtPerFt,
      regions: packet.slopeRegions.map((region) => ({ id: region.id, polygonSubmittedPt: region.polygonSubmittedPt, slopeAxis: region.slopeAxis, downhillDirection: region.downhillDirection, riseIn: 3, runIn: 12, shouldProtect: region.protectionBasis === 'completed-bid-protected', elevationDatum: region.elevationDatum ? { datumPointSubmittedPt: region.elevationDatum.datumPointSubmittedPt, projectElevationFt: region.elevationDatum.projectElevationFt, slopeDirection: region.elevationDatum.slopeDirection, sourceText: region.elevationDatum.sourceText } : null })),
      hydraulicDatumJoin: { projectDatumOffsetFt: packet.hydraulicDatumJoin.projectDatumOffsetFt, activeNodes: packet.hydraulicDatumJoin.activeNodes, protectedRegionHeadNodeMappingReady: packet.hydraulicDatumJoin.protectedRegionHeadNodeMappingReady },
    });
    const views = renderSlopedCeilingLayoutViews(layout, parity, model);
    expect(views.status).toBe('passed');
    expect((views.topSvg.match(/data-generated-head-id=/g) || [])).toHaveLength(2);
    expect((views.elevationSvg.match(/data-elevation-head-id=/g) || [])).toHaveLength(2);
    expect((views.elevationSvg.match(/data-elevation-surface-id=/g) || [])).toHaveLength(1);
    expect(views.elevationSvg).toContain('source-bound-project-elevation');
  });

  it('adversarially rejects a false-positive head in a completed empty 3:12 region', () => {
    const malicious = structuredClone(input);
    malicious.regions.find((region) => region.id === 'slope-region-west-covered').shouldProtect = true;
    const parity = verifySlopedCeilingLayoutParity(generateSlopedCeilingLayout(malicious), packet, 5);
    expect(parity.status).toBe('blocked');
    expect(parity.falsePositiveEmptyRegions).toContain('slope-region-west-covered');
  });
});
