import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  convexHull,
  clipPolygonToRect,
  deriveExteriorConsensus,
  isSimplePolygon,
  polygonArea,
  rasterUnionPolygons,
  validateLevelFootprintPacket,
} from '../src/engine/source-bound-footprint.js';

function rectangleSegments(x0, y0, x1, y1, lineWidth, strokeColor, repeats = 30) {
  const sides = [
    { x1: x0, y1: y0, x2: x1, y2: y0 }, { x1, y1: y0, x2: x1, y2: y1 },
    { x1, y1, x2: x0, y2: y1 }, { x1: x0, y1, x2: x0, y2: y0 },
  ];
  return Array.from({ length: repeats }, () => sides).flat().map((segment) => ({ ...segment, lineWidth, strokeColor }));
}

describe('source-bound per-level footprint derivation', () => {
  it('selects a simple closed shell only after independent heavy graphics states agree', () => {
    const segments = [
      ...rectangleSegments(0, 0, 320, 70, 0.18, '#4a4a4a'),
      ...rectangleSegments(0.2, 0.1, 320.1, 70.1, 0.18, '#506e96'),
      ...rectangleSegments(-20, -20, 380, 240, 0.09, '#8080ff'),
    ];
    const result = deriveExteriorConsensus(segments, { gridN: 280, bridgeGapsFt: 4 });
    expect(result.status).toBe('passed');
    expect(result.consensus).toHaveLength(2);
    expect(result.graphicsState).toBe('0.18|#4a4a4a');
    expect(isSimplePolygon(result.polygon)).toBe(true);
    expect(result.areaSqft).toBeCloseTo(22400, -1);
  });

  it('blocks one-layer evidence, divergent layers, and a post-selection printed-area mismatch', () => {
    const one = rectangleSegments(0, 0, 320, 70, 0.18, '#4a4a4a');
    expect(deriveExteriorConsensus(one).issues[0].code).toBe('FOOTPRINT_GRAPHICS_CONSENSUS_MISSING');
    const divergent = one.concat(rectangleSegments(0, 0, 260, 40, 0.18, '#506e96'));
    expect(deriveExteriorConsensus(divergent).status).toBe('blocked');
    const agreeing = one.concat(rectangleSegments(0.2, 0.1, 320.1, 70.1, 0.18, '#506e96'));
    expect(deriveExteriorConsensus(agreeing, { expectedAreaSqft: 10000 }).issues[0].code).toBe('FOOTPRINT_PRINTED_AREA_CONTROL_FAILED');
  });

  it('unions registered split-wing polygons without replacing them with their bounding box', () => {
    const left = [[0, 0], [200, 0], [200, 60], [0, 60]];
    const right = [[150, 0], [320, 0], [320, 50], [150, 50]];
    const result = rasterUnionPolygons([left, right], { cellSizeFt: 0.25 });
    expect(result.status).toBe('passed');
    expect(isSimplePolygon(result.polygon)).toBe(true);
    expect(result.areaSqft).toBeCloseTo(18000, 0);
    expect(result.areaSqft).toBeLessThan(320 * 60);
  });

  it('convex hull and polygon checks reject fragmentary self-crossing data', () => {
    expect(polygonArea(convexHull([[0, 0], [10, 0], [10, 5], [0, 5], [5, 2]]))).toBe(50);
    expect(isSimplePolygon([[0, 0], [10, 10], [0, 10], [10, 0]])).toBe(false);
  });

  it('clips a source shell to an independently dimensioned control band', () => {
    const clipped = clipPolygonToRect([[-5, -5], [15, -5], [15, 15], [-5, 15]], { minX: 0, minY: 0, maxX: 10, maxY: 8 });
    expect(isSimplePolygon(clipped)).toBe(true);
    expect(polygonArea(clipped)).toBe(80);
  });

  it('validates the current sealed Cooperative packet with eight distinct source-bound floor polygons', async () => {
    const packet = JSON.parse(fs.readFileSync(new URL('../src/data/source-bound-footprints.cooperative-1881.json', import.meta.url), 'utf8'));
    const result = await validateLevelFootprintPacket(packet);
    expect(result.status).toBe('passed');
    expect(result.coverage.passedLevels).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.coverage.blockedLevels).toEqual([]);
    expect(result.geometryComplete).toBe(true);
    expect(result.levels.find((level) => level.level === 3).derivation.controlResidualPct).toBeLessThan(0.5);
    expect(result.levels.map((level) => level.elevationFt)).toEqual([0, 10, 20, 31, 41, 51, 61, 71]);
    const totalAreaSqft = result.levels.reduce((sum, level) => sum + level.areaSqft, 0);
    expect(Math.abs(totalAreaSqft - 170654) / 170654).toBeLessThan(0.05);
    expect(result.complianceReady).toBe(false);
  });

  it('rejects a sealed packet after geometry or coverage tampering', async () => {
    const packet = JSON.parse(fs.readFileSync(new URL('../src/data/source-bound-footprints.cooperative-1881.json', import.meta.url), 'utf8'));
    packet.levels[2].polygonPlanFt[0][0] += 5;
    expect((await validateLevelFootprintPacket(packet)).issues[0].code).toBe('LEVEL_FOOTPRINT_RECEIPT_MISMATCH');
  });
});
