import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { titleViewportCandidates, viewportModelBounds } from '../scripts/extract-cooperative-1881-a307-c1-view-binding.mjs';

describe('Cooperative 1881 A-307 C1 source view binding', () => {
  it('derives a model-space rectangle from native viewport geometry', () => {
    expect(viewportModelBounds({ targetPoint: { x: 100, y: 50 }, width: 20, height: 10, viewHeight: 40 })).toEqual({ minX: 60, maxX: 140, minY: 30, maxY: 70, width: 80, height: 40 });
  });

  it('binds titles only to the uniquely valid view-above paper-layout relationship', () => {
    const title = { insertionPoint: { x: 1, y: 12 } };
    const valid = { viewportCenter: { x: 14, y: 17.8 }, width: 25, height: 9.75 };
    const wrongGap = { viewportCenter: { x: 14, y: 30 }, width: 25, height: 9.75 };
    expect(titleViewportCandidates(title, [valid, wrongGap])).toEqual([valid]);
  });

  it('keeps the committed C1 receipt fail-closed for a physical roof model', () => {
    const receipt = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../src/data/cooperative-1881-a307-c1-view-binding.json'), 'utf8'));
    expect(receipt).toMatchObject({ status: 'passed', drawingTitle: { detailReference: 'C1', sheetReference: 'A-307', drawingName: 'LONGITUDINAL SECTION B' } });
    expect(receipt.roofProfileSegments.length).toBeGreaterThan(0);
    expect(receipt.verticalDatumAnnotations.map((entry) => entry.kind).sort()).toEqual(['roof-eave', 'roof-ridge']);
    expect(receipt.claims).toMatchObject({ planReferenceToNativeViewBound: true, viewportLocalRoofProfileRegistered: true, viewportLocalRoofDatumAnnotationsRegistered: true, profileEdgeToDatumBound: false, slopeDirectionReady: false, roofSurfaceReconstructionReady: false, automaticSprinklerPlacementAllowed: false, automaticPipeRoutingAllowed: false, codeComplianceReady: false, employeeUseReady: false, vpsReleaseReady: false });
  });
});
