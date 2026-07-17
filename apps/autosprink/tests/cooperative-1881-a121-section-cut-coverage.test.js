import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { classifySegmentPolygonContact, edgeContactParameters } from '../scripts/extract-cooperative-1881-a121-section-cut-coverage.mjs';

const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

describe('Cooperative 1881 A-121 section-cut coverage', () => {
  it('requires a non-zero interior segment interval and rejects a boundary-only touch', () => {
    expect(classifySegmentPolygonContact({ x: -5, y: 5 }, { x: 15, y: 5 }, square).kind).toBe('interior');
    expect(classifySegmentPolygonContact({ x: -5, y: 0 }, { x: 15, y: 0 }, square).kind).toBe('boundary-only');
    expect(classifySegmentPolygonContact({ x: -5, y: -5 }, { x: -1, y: -1 }, square).kind).toBe('none');
  });

  it('returns finite source parameters for a collinear roof-edge contact', () => {
    expect(edgeContactParameters({ x: -5, y: 0 }, { x: 15, y: 0 }, square[0], square[1])).toEqual([0.25, 0.75]);
  });

  it('keeps the committed source coverage receipt fail-closed for roof-plane promotion', () => {
    const receipt = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../src/data/cooperative-1881-a121-section-cut-coverage.json'), 'utf8'));
    expect(receipt).toMatchObject({ status: 'passed' });
    expect(receipt.cuttingPlanes).toHaveLength(10);
    expect(receipt.slopeTargetSectionCoverage).toHaveLength(19);
    expect(receipt.slopeTargetSectionCoverage.filter((entry) => entry.associationStatus === 'resolved')).toHaveLength(13);
    expect(receipt.slopeTargetSectionCoverage.filter((entry) => entry.status === 'blocked-non-unique')).toHaveLength(13);
    expect(receipt.claims).toMatchObject({ sourceCuttingPlanesRegistered: true, sourceSlopeRegionSectionCoverageReady: true, uniqueSectionReferenceReady: false, slopeDirectionReady: false, roofSurfaceReconstructionReady: false, automaticSprinklerPlacementAllowed: false, automaticPipeRoutingAllowed: false, codeComplianceReady: false, employeeUseReady: false, vpsReleaseReady: false });
  });
});
