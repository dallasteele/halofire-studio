import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildMitRiversideBuildingJSourceSpatialBoundaries, pointInMitRiversideBuildingJPolygon, renderMitRiversideBuildingJSourceSpatialBoundaries, validateMitRiversideBuildingJSourceSpatialBoundaries, verifyMitRiversideBuildingJSourceSpatialBoundariesAdversarialLoop } from '../src/engine/mit-riverside-building-j-source-spatial-boundaries.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const structural = read('mit-riverside-building-j-structural-grid-correction.json');
const evidence = read('mit-riverside-building-j-source-spatial-boundary-evidence.json');
const dependencies = { structural, evidence };
let packet;
beforeAll(async () => { packet = await buildMitRiversideBuildingJSourceSpatialBoundaries(structural, evidence); });

describe('MIT Riverside Building J exact source spatial boundaries', () => {
  it('seals three architectural slabs and three structural base roof regions', async () => {
    expect(await validateMitRiversideBuildingJSourceSpatialBoundaries(packet, dependencies)).toMatchObject({ status: 'passed', exactFloorSlabPolygonsReady: true, baseRoofRegionBoundariesReady: true, sourceProtectionPlaneReady: false, headElevationsReady: false });
    expect(packet.floorSlabs.map(({ id, areaSqFt }) => ({ id, areaSqFt }))).toEqual([
      { id: 'Slab_106', areaSqFt: 4389.673855 }, { id: 'Slab_107', areaSqFt: 2011.705637 }, { id: 'Slab_108', areaSqFt: 313.865256 },
    ]);
    expect(packet.roofBaseRegions.map(({ id, areaSqFt }) => ({ id, areaSqFt }))).toEqual([
      { id: 'main-standing-seam', areaSqFt: 4362.17248 }, { id: 'west-lower-standing-seam', areaSqFt: 653.747313 }, { id: 'membrane-base', areaSqFt: 1972 },
    ]);
  });
  it('binds every corrected head to exactly one floor slab and one base roof region', () => {
    expect(packet.counts).toEqual({
      totalHeads: 68,
      floorRegionCounts: { Slab_106: 50, Slab_107: 18, Slab_108: 0 },
      roofRegionCounts: { 'main-standing-seam': 36, 'west-lower-standing-seam': 4, 'membrane-base': 28 },
      unmatchedFloorHeads: 0, multiplyMatchedFloorHeads: 0, unmatchedRoofHeads: 0, multiplyMatchedRoofHeads: 0,
    });
    expect(packet.headAssignments.every((head) => head.floorMatchCount === 1 && head.roofMatchCount === 1)).toBe(true);
  });
  it('independently closes the membrane area while keeping crickets and planes blocked', () => {
    expect(packet.independentClosure).toEqual({ membraneDrawingNoteSqFt: 1972, membraneExtractedSqFt: 1972, membraneWidthFt: 58, membraneDepthFt: 34 });
    expect(packet).toMatchObject({ cricketFaceTopologyReady: false, wholeRoofFaceTopologyReady: false, sourceProtectionPlaneReady: false, headElevationsReady: false, sourceGeneratedPitchedPlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
    expect(packet.headAssignments.every((head) => head.sourceProtectionRegime === null && head.sourceProtectionPlaneId === null && head.zFt === null)).toBe(true);
  });
  it('uses boundary-inclusive deterministic polygon membership and renders visual proof', () => {
    const slab = packet.floorSlabs[0];
    expect(pointInMitRiversideBuildingJPolygon(slab.structuralLocalVerticesFt[0], slab.structuralLocalVerticesFt)).toBe(true);
    const svg = renderMitRiversideBuildingJSourceSpatialBoundaries(packet);
    expect((svg.match(/<circle /g) || [])).toHaveLength(136);
    expect(svg).toContain('1,972 ft²');
    expect(svg).toContain('NO CRICKET TOPOLOGY');
  });
  it('rejects all dependency, geometry, membership, plane, Z, topology, and release attacks', async () => {
    expect(await verifyMitRiversideBuildingJSourceSpatialBoundariesAdversarialLoop(packet, dependencies)).toMatchObject({ status: 'passed', attemptedCases: 18, exactFloorSlabPolygonsReady: true, baseRoofRegionBoundariesReady: true, sourceProtectionPlaneReady: false, headElevationsReady: false });
  });
});
