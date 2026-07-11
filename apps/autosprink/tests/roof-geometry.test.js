import { describe, expect, it } from 'vitest';
import { projectCadModelToRoof, reconstructRoofPlanes, roofElevationAt } from '../src/engine/roof-geometry.js';

const binding = {
  sourcePdfSha256: 'b'.repeat(64), physicalPageNumber: 32, pageIndex: 31,
  renderedPageSha256: 'f'.repeat(64), sheetId: 'A-121', coordinateSpace: 'plan-feet',
};
const receipt = 'a'.repeat(64);

function datum(id, kind, x, y, elevationFt) {
  return { id, kind, label: id, planPointFt: [x, y], elevationFt, sourceBinding: binding, evidenceReceiptSha256: receipt };
}

function reconstruct(datums, regions) {
  return reconstructRoofPlanes({
    artifactType: 'halofire.roof-reconstruction-input.v1', sourceBinding: binding,
    evidenceReceiptSha256: receipt, datums, regions,
  });
}

describe('source-bound pitched roof reconstruction', () => {
  it('reconstructs a mono-slope plane and reports its true rise per foot', () => {
    const model = reconstruct([
      datum('eave-a', 'eave', 0, 0, 20), datum('eave-b', 'eave', 0, 30, 20), datum('ridge', 'ridge', 40, 15, 30),
    ], [{ id: 'mono', boundaryPlanFt: [[0, 0], [40, 0], [40, 30], [0, 30]], datumIds: ['eave-a', 'eave-b', 'ridge'] }]);
    expect(model.status).toBe('passed');
    expect(model.planes[0].slopeRisePerFoot).toBeCloseTo(0.25, 6);
    expect(roofElevationAt(model, [20, 10]).elevationFt).toBeCloseTo(25, 6);
    expect(model.complianceReady).toBe(false);
  });

  it('reconstructs both sides of a gable and agrees at the shared ridge', () => {
    const model = reconstruct([
      datum('west-1', 'eave', 0, 0, 20), datum('west-2', 'eave', 0, 30, 20),
      datum('ridge-1', 'ridge', 20, 0, 25), datum('ridge-2', 'ridge', 20, 30, 25),
      datum('east-1', 'eave', 40, 0, 20), datum('east-2', 'eave', 40, 30, 20),
    ], [
      { id: 'west', boundaryPlanFt: [[0, 0], [20, 0], [20, 30], [0, 30]], datumIds: ['west-1', 'west-2', 'ridge-1', 'ridge-2'] },
      { id: 'east', boundaryPlanFt: [[20, 0], [40, 0], [40, 30], [20, 30]], datumIds: ['ridge-1', 'ridge-2', 'east-1', 'east-2'] },
    ]);
    expect(model.status).toBe('passed');
    const ridge = roofElevationAt(model, [20, 15]);
    expect(ridge.status).toBe('passed');
    expect(ridge.elevationFt).toBe(25);
    expect(ridge.planeIds).toEqual(['east', 'west']);
  });

  it('rejects non-coplanar evidence, outside datums, and mismatched source bindings', () => {
    const nonPlanar = reconstruct([
      datum('a', 'eave', 0, 0, 20), datum('b', 'eave', 0, 20, 20), datum('c', 'ridge', 20, 0, 25), datum('d', 'ridge', 20, 20, 27),
    ], [{ id: 'bad', boundaryPlanFt: [[0, 0], [20, 0], [20, 20], [0, 20]], datumIds: ['a', 'b', 'c', 'd'] }]);
    expect(nonPlanar.status).toBe('blocked');
    expect(nonPlanar.issues.map((entry) => entry.code)).toContain('ROOF_PLANE_RESIDUAL_EXCEEDED');

    const outside = reconstruct([
      datum('a', 'eave', 0, 0, 20), datum('b', 'eave', 0, 20, 20), datum('c', 'ridge', 30, 0, 25),
    ], [{ id: 'bad', boundaryPlanFt: [[0, 0], [20, 0], [20, 20], [0, 20]], datumIds: ['a', 'b', 'c'] }]);
    expect(outside.issues.map((entry) => entry.code)).toContain('ROOF_DATUM_OUTSIDE_REGION');

    const tampered = datum('c', 'ridge', 20, 0, 25);
    tampered.sourceBinding = { ...binding, sheetId: 'A-999' };
    const sourceMismatch = reconstruct([datum('a', 'eave', 0, 0, 20), datum('b', 'eave', 0, 20, 20), tampered],
      [{ id: 'bad', boundaryPlanFt: [[0, 0], [20, 0], [20, 20], [0, 20]], datumIds: ['a', 'b', 'c'] }]);
    expect(sourceMismatch.issues.map((entry) => entry.code)).toContain('ROOF_DATUM_SOURCE_MISMATCH');
  });

  it('blocks conflicting overlap instead of choosing a convenient roof plane', () => {
    const model = {
      status: 'passed', planes: [
        { id: 'low', boundaryPlanFt: [[0, 0], [10, 0], [10, 10], [0, 10]], equation: { a: 0, b: 0, c: 20 }, normal: [0, 0, 1] },
        { id: 'high', boundaryPlanFt: [[0, 0], [10, 0], [10, 10], [0, 10]], equation: { a: 0, b: 0, c: 22 }, normal: [0, 0, 1] },
      ],
    };
    const result = roofElevationAt(model, [5, 5]);
    expect(result.status).toBe('blocked');
    expect(result.issues[0].code).toBe('ROOF_OVERLAP_CONFLICT');
  });
});
describe('sprinkler, pipe, and hanger roof projection', () => {
  const roofModel = reconstruct([
    datum('eave-a', 'eave', 0, 0, 20), datum('eave-b', 'eave', 0, 20, 20), datum('ridge-a', 'ridge', 20, 0, 25), datum('ridge-b', 'ridge', 20, 20, 25),
  ], [{ id: 'west', boundaryPlanFt: [[0, 0], [20, 0], [20, 20], [0, 20]], datumIds: ['eave-a', 'eave-b', 'ridge-a', 'ridge-b'] }]);

  it('projects connected carriers, drops, heads, and roof rods while preserving shared topology nodes', () => {
    const cadModel = { solids: [
      { kind: 'pipe', role: 'branch', name: 'branch-1', from: [2, 5, 10], to: [18, 5, 10], diameterIn: 1.5 },
      { kind: 'pipe', role: 'drop', name: 'drop-1', from: [10, 5, 10], to: [10, 5, 9], diameterIn: 1 },
      { kind: 'head', name: 'head-1', position: [10, 5, 9], orientation: 'pendent' },
    ] };
    const result = projectCadModelToRoof({ cadModel, roofModel, offsets: { headOffsetBelowRoofFt: 0.5, pipeOffsetBelowRoofFt: 1, hangerSpacingFt: 8 } });
    expect(result.status).toBe('passed');
    const branch = result.model.solids.find((solid) => solid.name === 'branch-1');
    const drop = result.model.solids.find((solid) => solid.name === 'drop-1');
    const head = result.model.solids.find((solid) => solid.name === 'head-1');
    expect(branch.from[2]).toBeCloseTo(19.5, 6);
    expect(branch.to[2]).toBeCloseTo(23.5, 6);
    expect(drop.to).toEqual(head.position);
    expect(result.hangers.length).toBe(3);
    expect(result.hangers.every((hanger) => hanger.rodLengthFt === 1)).toBe(true);
    expect(result.verification.topologyNodeMapUsed).toBe(true);
    expect(result.complianceReady).toBe(false);
    expect(result.claimStatus).toContain('not-code-compliant');
  });

  it('fails closed when any model point falls outside the accepted roof boundaries', () => {
    const result = projectCadModelToRoof({
      cadModel: { solids: [{ kind: 'head', name: 'outside', position: [30, 5, 9] }] },
      roofModel, offsets: { headOffsetBelowRoofFt: 0.5, pipeOffsetBelowRoofFt: 1, hangerSpacingFt: 8 },
    });
    expect(result.status).toBe('blocked');
    expect(result.model).toBeNull();
    expect(result.issues.map((entry) => entry.code)).toContain('ROOF_POINT_OUTSIDE_MODEL');
  });
});
