import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { associateSlopeTargets, canonicalPolygonKey, canonicalRegions, strictlyContainsPoint } from '../scripts/extract-cooperative-1881-a121-slope-boundary-association.mjs';

const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const callout = (point) => ({ label: { handle: 'T1', text: 'SLOPE 1/2" PER FOOT' }, leader: { handle: 'L1', target: point }, inchesPerFoot: 0.5 });

describe('Cooperative 1881 A-121 slope-to-boundary association', () => {
  it('collapses reversed exact geometry into a source alias region', () => {
    expect(canonicalPolygonKey(square)).toBe(canonicalPolygonKey([...square].reverse()));
    const regions = canonicalRegions([{ id: 'A', vertices: square, areaNativeSq: 100 }, { id: 'B', vertices: [...square].reverse(), areaNativeSq: 100 }]);
    expect(regions).toHaveLength(1);
    expect(regions[0].aliases.map((alias) => alias.id)).toEqual(['A', 'B']);
  });

  it('uses strict interior containment and rejects a boundary point', () => {
    expect(strictlyContainsPoint(square, { x: 5, y: 5 })).toBe(true);
    expect(strictlyContainsPoint(square, { x: 0, y: 5 })).toBe(false);
  });

  it('blocks a target in non-identical overlapping source polygons', () => {
    const regions = canonicalRegions([{ id: 'A', vertices: square, areaNativeSq: 100 }, { id: 'B', vertices: [{ x: 5, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 10 }, { x: 5, y: 10 }], areaNativeSq: 100 }]);
    const association = associateSlopeTargets([callout({ x: 7, y: 5 })], regions)[0];
    expect(association.status).toBe('blocked');
    expect(association.issues[0].code).toBe('A121_SLOPE_TARGET_NONIDENTICAL_BOUNDARY_OVERLAP');
  });

  it('keeps the committed receipt fail-closed while preserving classified source evidence', () => {
    const receipt = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../src/data/cooperative-1881-a121-slope-boundary-association.json'), 'utf8'));
    expect(receipt).toMatchObject({ status: 'passed', canonicalRegionCount: 28 });
    expect(receipt.associations).toHaveLength(19);
    expect(receipt.claims).toMatchObject({ allSlopeTargetsClassified: true, partialSourceSlopeMagnitudeRegionAssociationReady: true, sourceSlopeMagnitudeRegionAssociationReady: false, slopeDirectionReady: false, roofSurfaceReconstructionReady: false, automaticPipeRoutingAllowed: false, codeComplianceReady: false, employeeUseReady: false, vpsReleaseReady: false });
  });
});
