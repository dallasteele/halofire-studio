import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { closedPolylineLoops, signedArea } from '../scripts/extract-cooperative-1881-a121-roof-face-boundaries.mjs';

describe('Cooperative 1881 A-121 roof-face boundary extraction', () => {
  it('reconstructs a closed native roof-edge loop without inventing vertices', () => {
    const entities = [
      { type: 'LWPOLYLINE', handle: 'A', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      { type: 'LWPOLYLINE', handle: 'B', vertices: [{ x: 10, y: 0 }, { x: 10, y: 5 }] },
      { type: 'LWPOLYLINE', handle: 'C', vertices: [{ x: 10, y: 5 }, { x: 0, y: 5 }] },
      { type: 'LWPOLYLINE', handle: 'D', vertices: [{ x: 0, y: 5 }, { x: 0, y: 0 }] },
    ];
    const extracted = closedPolylineLoops(entities);
    expect(extracted.issues).toEqual([]);
    expect(extracted.loops).toHaveLength(1);
    expect(extracted.loops[0]).toMatchObject({ handles: ['A', 'B', 'C', 'D'], areaNativeSq: 50 });
    expect(Math.abs(signedArea(extracted.loops[0].vertices))).toBe(50);
  });

  it('rejects dangling source edgework instead of closing a roof face by inference', () => {
    const extracted = closedPolylineLoops([
      { type: 'LWPOLYLINE', handle: 'A', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      { type: 'LWPOLYLINE', handle: 'B', vertices: [{ x: 10, y: 0 }, { x: 10, y: 5 }] },
    ]);
    expect(extracted.loops).toEqual([]);
    expect(extracted.issues[0].code).toBe('A121_ROOF_POLYLINE_LOOP_OPEN_OR_BRANCHING');
  });

  it('rejects zero-area loops', () => {
    const extracted = closedPolylineLoops([
      { type: 'LWPOLYLINE', handle: 'A', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      { type: 'LWPOLYLINE', handle: 'B', vertices: [{ x: 10, y: 0 }, { x: 0, y: 0 }] },
    ]);
    expect(extracted.loops).toEqual([]);
    expect(extracted.issues[0].code).toBe('A121_ROOF_POLYLINE_LOOP_DEGENERATE');
  });

  it('keeps all physical and downstream claims closed in the issued source receipt', () => {
    const receipt = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../src/data/cooperative-1881-a121-roof-face-boundaries.json'), 'utf8'));
    expect(receipt).toMatchObject({ status: 'passed', roofBlockRecordCount: 30, roofBlockInsertCount: 30 });
    expect(receipt.boundaries).toHaveLength(31);
    expect(new Set(receipt.boundaries.map((boundary) => boundary.roofBlockName)).size).toBe(30);
    expect(receipt.claims).toMatchObject({
      sourceRoofFaceBoundariesRegistered: true,
      roofSurfaceReconstructionReady: false,
      slopeDirectionReady: false,
      perMemberVerticalDatumReady: false,
      automaticSprinklerPlacementAllowed: false,
      automaticPipeRoutingAllowed: false,
      perHeadObstructionClearanceVerified: false,
      fabricationReady: false,
      codeComplianceReady: false,
      employeeUseReady: false,
      vpsReleaseReady: false,
    });
  });
});
