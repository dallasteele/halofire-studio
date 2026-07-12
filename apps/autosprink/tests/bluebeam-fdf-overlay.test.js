import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildBluebeamFdfOverlay, submittedLandscapeToOriginalPdf } from '../src/engine/bluebeam-fdf-overlay.js';
import { generateSlopedCeilingLayout, verifySlopedCeilingLayoutParity } from '../src/engine/sloped-ceiling-layout.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/submitted-sloped-ceiling-calibration.dillon.json', import.meta.url), 'utf8'));
const regions = packet.slopeRegions.map((region) => ({ id: region.id, polygonSubmittedPt: region.polygonSubmittedPt, slopeAxis: region.slopeAxis, downhillDirection: region.downhillDirection, riseIn: 3, runIn: 12, shouldProtect: region.protectionBasis === 'completed-bid-protected', obstructions: region.obstructions.map(({ id, kind, centerSubmittedPt, clearanceFt, preferredSide }) => ({ id, kind, centerSubmittedPt, clearanceFt, preferredSide })) }));
const layout = generateSlopedCeilingLayout({ artifactType: 'halofire.sloped-ceiling-layout-input.v1', printedScalePtPerFt: 13.5, regions, maxAcrossSlopeSpanFt: 20, maxAlongSlopeSpanFt: 12 });
const parity = verifySlopedCeilingLayoutParity(layout, packet, 5);

describe('Bluebeam FDF full-sheet overlay', () => {
  it('maps landscape calibration coordinates back to the original portrait FP-1 page', () => {
    expect(submittedLandscapeToOriginalPdf([0, 0])).toEqual([2160, 3024]);
    expect(submittedLandscapeToOriginalPdf([3024, 2160])).toEqual([0, 0]);
    expect(submittedLandscapeToOriginalPdf([1859.07, 683.67])).toEqual([1476.33, 1164.93]);
  });

  it('emits deterministic importable markups for regions, fan, heads, branch, and evidence', () => {
    const input = { artifactType: 'halofire.bluebeam-fdf-overlay-input.v1', sourceFileName: 'FP-1 Dillon Main-Halo Layout1 (1).pdf', packet, layout, parity };
    const result = buildBluebeamFdfOverlay(input); const replay = buildBluebeamFdfOverlay(input);
    expect(result.status).toBe('passed');
    expect(result.buffer.subarray(0, 8).toString('ascii')).toBe('%FDF-1.2');
    expect(result.manifest).toMatchObject({ pageIndex: 0, regionCount: 4, generatedHeadCount: 2, generatedPipeCount: 1, annotationCount: 9, complianceReady: false });
    const raw = result.buffer.toString('ascii');
    expect((raw.match(/\/Subtype \/PolyLine/g) || [])).toHaveLength(4);
    expect((raw.match(/\/Subj \(Generated sprinkler head\)/g) || [])).toHaveLength(2);
    expect(raw).toContain('/Subj (Generated slope-following branch)');
    expect(raw).toContain('/Subj (Ceiling fan calibration clearance)');
    expect(raw).toContain('Not code compliance, approval, or fabrication release.');
    expect(replay.buffer.equals(result.buffer)).toBe(true);
    expect(replay.manifest.sha256).toBe(result.manifest.sha256);
  });
});
