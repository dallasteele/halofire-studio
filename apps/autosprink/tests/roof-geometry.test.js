import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  projectCadModelToRoof,
  reconstructRoofPlanes,
  roofElevationAt,
  sealRoofReconstructionInput,
} from '../src/engine/roof-geometry.js';

const roofPlanBinding = {
  id: 'roof-plan', binding: {
    sourcePdfSha256: 'b'.repeat(64), physicalPageNumber: 32, pageIndex: 31,
    renderedPageSha256: 'f'.repeat(64), sheetId: 'A-121', coordinateSpace: 'plan-feet',
  },
};
const elevationBinding = {
  id: 'elevation', binding: {
    sourcePdfSha256: 'b'.repeat(64), physicalPageNumber: 58, pageIndex: 57,
    renderedPageSha256: '4'.repeat(64), sheetId: 'A-201', coordinateSpace: 'pdf-points',
  },
};

function datum(id, kind, x, y, elevationFt, sourceBindingRefs = ['roof-plan']) {
  return {
    id, kind, label: id, planPointFt: [x, y], elevationFt, sourceBindingRefs,
    derivation: { method: sourceBindingRefs.length > 1 ? 'slope-from-anchor' : 'direct-elevation-datum' },
  };
}

async function sealAndReconstruct(datums, regions, sourceBindings = [roofPlanBinding]) {
  const sealed = await sealRoofReconstructionInput({
    artifactType: 'halofire.roof-reconstruction-input.v1', sourceBindings, datums, regions, exclusions: [], features: [],
    coverage: { complete: true, resolvedScope: 'test fixture', unresolvedRegions: [] },
  });
  return reconstructRoofPlanes(sealed);
}

describe('source-bound pitched roof reconstruction', () => {
  it('reconstructs the sealed Cooperative 1881 A-121 partial roof packet and preserves its fail-closed coverage boundary', async () => {
    const packet = JSON.parse(fs.readFileSync(new URL('../src/data/roof-reconstruction.cooperative-1881.json', import.meta.url), 'utf8'));
    const model = await reconstructRoofPlanes(packet);
    expect(model.status).toBe('passed');
    expect(model.projectName).toBe('The Cooperative 1881 - Salt Lake City UT');
    expect(model.planes).toHaveLength(15);
    expect(model.coverage.complete).toBe(false);
    expect(model.coverage.unresolvedRegions).toEqual([
      'mep-feature-specific-clearances-and-equipment-heights',
      'mep-unmatched-label-residuals',
      'level-8-ceiling-versus-attic-protection-basis',
      'completed-bid-source-files-not-materialized-from-egnyte',
    ]);
    expect(model.exclusions.map((entry) => entry.id)).toContain('central-south-open-core');
    expect(model.features).toHaveLength(11);
    expect(model.features.filter((entry) => entry.type === 'roof-hatch')).toHaveLength(1);
    expect(model.planes.every((plane) => plane.sourceBindingRefs.join(',') === 'elevation-A201,roof-plan-A121')).toBe(true);
    expect(model.coordinationEvidence).toHaveLength(3);
    expect(model.coordinationEvidence.find((entry) => entry.id === 'roof-mechanical-coordination').registration.status).toBe('registered');
    expect(model.coordinationEvidence.find((entry) => entry.id === 'roof-plumbing-coordination').registration.status).toBe('registered');
    expect(model.sourceBindings.find((entry) => entry.id === 'roof-plan-A121').binding).toMatchObject({
      sourcePdfSha256: 'bb3c85c8ae6a7709cb45d200b2aa38b26a75ec82870c01ba70346b2c1814008f',
      physicalPageNumber: 32,
      pageIndex: 31,
      sheetId: 'A-121',
    });
    const projection = projectCadModelToRoof({
      cadModel: { solids: [{ kind: 'head', name: 'partial-scope-head', position: [100, 100, 80] }] },
      roofModel: model,
      offsets: { headOffsetBelowRoofFt: 0.5, pipeOffsetBelowRoofFt: 1, hangerSpacingFt: 8 },
    });
    expect(projection.status).toBe('blocked');
    expect(projection.issues.map((entry) => entry.code)).toContain('ROOF_MODEL_COVERAGE_INCOMPLETE');
  });

  it('reconstructs a mono-slope plane and reports its true rise per foot', async () => {
    const model = await sealAndReconstruct([
      datum('eave-a', 'eave', 0, 0, 20), datum('eave-b', 'eave', 0, 30, 20), datum('ridge', 'ridge', 40, 15, 30),
    ], [{ id: 'mono', boundaryPlanFt: [[0, 0], [40, 0], [40, 30], [0, 30]], datumIds: ['eave-a', 'eave-b', 'ridge'] }]);
    expect(model.status).toBe('passed');
    expect(model.planes[0].slopeRisePerFoot).toBeCloseTo(0.25, 6);
    expect(roofElevationAt(model, [20, 10]).elevationFt).toBeCloseTo(25, 6);
    expect(model.complianceReady).toBe(false);
  });

  it('reconstructs both sides of a gable and agrees at the shared ridge', async () => {
    const model = await sealAndReconstruct([
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

  it('accepts derived datums bound jointly to roof-plan and elevation pages', async () => {
    const refs = ['roof-plan', 'elevation'];
    const model = await sealAndReconstruct([
      datum('valley-a', 'valley', 0, 0, 81, refs), datum('valley-b', 'valley', 20, 0, 81, refs),
      datum('outer-a', 'roof-point', 0, 24, 85, refs), datum('outer-b', 'roof-point', 20, 24, 85, refs),
    ], [{ id: 'south-plane', boundaryPlanFt: [[0, 0], [20, 0], [20, 24], [0, 24]], datumIds: ['valley-a', 'valley-b', 'outer-a', 'outer-b'] }], [roofPlanBinding, elevationBinding]);
    expect(model.status).toBe('passed');
    expect(model.planes[0].sourceBindingRefs).toEqual(['elevation', 'roof-plan']);
  });

  it('rejects packet tampering after the source bundle is sealed', async () => {
    const sealed = await sealRoofReconstructionInput({
      artifactType: 'halofire.roof-reconstruction-input.v1', sourceBindings: [roofPlanBinding],
      datums: [datum('a', 'eave', 0, 0, 20), datum('b', 'eave', 0, 20, 20), datum('c', 'ridge', 20, 0, 25)],
      regions: [{ id: 'roof', boundaryPlanFt: [[0, 0], [20, 0], [20, 20], [0, 20]], datumIds: ['a', 'b', 'c'] }],
      exclusions: [], features: [],
      coverage: { complete: true, resolvedScope: 'test fixture', unresolvedRegions: [] },
    });
    sealed.datums[2].elevationFt = 35;
    const result = await reconstructRoofPlanes(sealed);
    expect(result.status).toBe('blocked');
    expect(result.issues[0].code).toBe('ROOF_EVIDENCE_RECEIPT_MISMATCH');
  });

  it('rejects non-coplanar evidence, outside datums, and unknown source refs', async () => {
    const nonPlanar = await sealAndReconstruct([
      datum('a', 'eave', 0, 0, 20), datum('b', 'eave', 0, 20, 20), datum('c', 'ridge', 20, 0, 25), datum('d', 'ridge', 20, 20, 27),
    ], [{ id: 'bad', boundaryPlanFt: [[0, 0], [20, 0], [20, 20], [0, 20]], datumIds: ['a', 'b', 'c', 'd'] }]);
    expect(nonPlanar.status).toBe('blocked');
    expect(nonPlanar.issues.map((entry) => entry.code)).toContain('ROOF_PLANE_RESIDUAL_EXCEEDED');

    const outside = await sealAndReconstruct([
      datum('a', 'eave', 0, 0, 20), datum('b', 'eave', 0, 20, 20), datum('c', 'ridge', 30, 0, 25),
    ], [{ id: 'bad', boundaryPlanFt: [[0, 0], [20, 0], [20, 20], [0, 20]], datumIds: ['a', 'b', 'c'] }]);
    expect(outside.issues.map((entry) => entry.code)).toContain('ROOF_DATUM_OUTSIDE_REGION');

    const unknown = datum('c', 'ridge', 20, 0, 25, ['substituted-page']);
    const sourceMismatch = await sealAndReconstruct([datum('a', 'eave', 0, 0, 20), datum('b', 'eave', 0, 20, 20), unknown],
      [{ id: 'bad', boundaryPlanFt: [[0, 0], [20, 0], [20, 20], [0, 20]], datumIds: ['a', 'b', 'c'] }]);
    expect(sourceMismatch.issues.map((entry) => entry.code)).toContain('ROOF_DATUM_SOURCE_MISMATCH');
  });

  it('rejects source substitution and false completeness for roof features', async () => {
    const base = {
      artifactType: 'halofire.roof-reconstruction-input.v1', sourceBindings: [roofPlanBinding],
      datums: [datum('a', 'eave', 0, 0, 20), datum('b', 'eave', 0, 20, 20), datum('c', 'ridge', 20, 0, 25)],
      regions: [{ id: 'roof', boundaryPlanFt: [[0, 0], [20, 0], [20, 20], [0, 20]], datumIds: ['a', 'b', 'c'] }],
      exclusions: [],
      features: [{
        id: 'drain', type: 'internal-roof-drain', geometry: { kind: 'point', planPointFt: [5, 5] },
        sourceBindingRefs: ['substituted-sheet'], sourceCallout: '07.01', sourcePdfPoint: [100, 100],
        clearance: { status: 'unresolved', basis: 'A-121 locates the drain but does not dimension its sprinkler obstruction clearance.' },
      }],
      coverage: { complete: true, resolvedScope: 'adversarial fixture', unresolvedRegions: [] },
    };
    const model = await reconstructRoofPlanes(await sealRoofReconstructionInput(base));
    expect(model.status).toBe('blocked');
    expect(model.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'ROOF_FEATURE_SOURCE_MISMATCH', 'ROOF_COVERAGE_COMPLETENESS_CONTRADICTED',
    ]));
  });

  it('rejects the adversarial claim that available coordination sheets imply registered complete coverage', async () => {
    const sealed = await sealRoofReconstructionInput({
      artifactType: 'halofire.roof-reconstruction-input.v1', sourceBindings: [roofPlanBinding],
      datums: [datum('a', 'eave', 0, 0, 20), datum('b', 'eave', 0, 20, 20), datum('c', 'ridge', 20, 0, 25)],
      regions: [{ id: 'roof', boundaryPlanFt: [[0, 0], [20, 0], [20, 20], [0, 20]], datumIds: ['a', 'b', 'c'] }],
      exclusions: [], features: [],
      coordinationEvidence: [{
        id: 'mep-present', role: 'roof-mechanical', sourceBindingRefs: ['roof-plan'],
        evidenceStatus: 'issued-coordination-source', approvalStatus: 'not-an-approval-artifact',
        observations: ['A coordination sheet exists.'],
        registration: { status: 'unregistered', basis: 'No coordinate transform or feature inventory was supplied in this adversarial fixture.' },
      }],
      coverage: { complete: true, resolvedScope: 'false completeness fixture', unresolvedRegions: [] },
    });
    const model = await reconstructRoofPlanes(sealed);
    expect(model.status).toBe('blocked');
    expect(model.issues.map((entry) => entry.code)).toContain('ROOF_COVERAGE_COMPLETENESS_CONTRADICTED');
    expect(model.complianceReady).toBe(false);
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
  let roofModel;
  beforeAll(async () => {
    roofModel = await sealAndReconstruct([
      datum('eave-a', 'eave', 0, 0, 20), datum('eave-b', 'eave', 0, 20, 20), datum('ridge-a', 'ridge', 20, 0, 25), datum('ridge-b', 'ridge', 20, 20, 25),
    ], [{ id: 'west', boundaryPlanFt: [[0, 0], [20, 0], [20, 20], [0, 20]], datumIds: ['eave-a', 'eave-b', 'ridge-a', 'ridge-b'] }]);
  });

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

  it('fails closed at an opening boundary, a clearance boundary, and a point penetration', async () => {
    const sealed = await sealRoofReconstructionInput({
      artifactType: 'halofire.roof-reconstruction-input.v1', sourceBindings: [roofPlanBinding],
      datums: [datum('a', 'eave', 0, 0, 20), datum('b', 'eave', 0, 20, 20), datum('c', 'ridge', 20, 0, 25)],
      regions: [{ id: 'roof', boundaryPlanFt: [[0, 0], [20, 0], [20, 20], [0, 20]], datumIds: ['a', 'b', 'c'] }],
      exclusions: [],
      features: [
        { id: 'hatch', type: 'roof-hatch', geometry: { kind: 'polygon', boundaryPlanFt: [[2, 2], [5, 2], [5, 10], [2, 10]] }, sourceBindingRefs: ['roof-plan'], sourceCallout: '08.01', dimensionsFt: [3, 8], clearance: { status: 'resolved', boundaryPlanFt: [[1, 1], [6, 1], [6, 11], [1, 11]], basis: 'test fixture' } },
        { id: 'drain', type: 'internal-roof-drain', geometry: { kind: 'point', planPointFt: [15, 15] }, sourceBindingRefs: ['roof-plan'], sourceCallout: '07.01', clearance: { status: 'resolved', basis: 'test fixture' } },
      ],
      coverage: { complete: true, resolvedScope: 'test fixture', unresolvedRegions: [] },
    });
    const model = await reconstructRoofPlanes(sealed);
    expect(model.status).toBe('passed');
    expect(roofElevationAt(model, [3, 3]).issues[0].code).toBe('ROOF_POINT_IN_FEATURE_OR_CLEARANCE');
    expect(roofElevationAt(model, [1, 6]).issues[0].code).toBe('ROOF_POINT_IN_FEATURE_OR_CLEARANCE');
    expect(roofElevationAt(model, [15, 15]).issues[0].code).toBe('ROOF_POINT_IN_FEATURE_OR_CLEARANCE');
  });
});
