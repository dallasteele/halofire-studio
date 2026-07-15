import { describe, expect, it } from 'vitest';

import { buildPhysicalPipeGraph } from '../src/engine/polaris-pitched-hydraulic-network.js';
import { evaluateWetPipeDrainageBasins } from '../src/engine/wet-pipe-drainage-basins.js';

const pipe = (id, startFt, endFt) => ({
  id,
  nominalSizeInches: 1,
  startFt,
  endFt,
  length3dFt: Math.hypot(endFt.x - startFt.x, endFt.y - startFt.y, endFt.z - startFt.z),
  sourceAttributes: { 'Sub Category': 'Schedule 40' },
});

const codeBasis = {
  systemType: 'wet',
  lessThan5Gallons: { section: 'test-section', primarySourceReady: true },
  flexibleOrEasilySeparatedFittingCategories: ['Flex Drop'],
};

function evaluate(overrides = {}) {
  const pipes = overrides.pipes ?? [
    pipe('left', { x: 0, y: 0, z: 1 }, { x: 5, y: 0, z: 0 }),
    pipe('right', { x: 5, y: 0, z: 0 }, { x: 10, y: 0, z: 2 }),
    pipe('drain', { x: 10, y: 0, z: 2 }, { x: 15, y: 0, z: 0 }),
  ];
  const graph = buildPhysicalPipeGraph(pipes, 0.001);
  return evaluateWetPipeDrainageBasins({
    pipes,
    graph,
    physicalSpanRoutes: [{ physicalClass: { nominalSizeInches: 1, subCategory: 'Schedule 40' }, diameterInternalInches: 1.049 }],
    lowPointCandidates: [{ id: 'low', pointFt: { x: 5, y: 0, z: 0 } }],
    mainDrainEntryNodeIds: [graph.nodes.reduce((best, node) => Math.abs(node.pointFt.x - 15) < Math.abs(best.pointFt.x - 15) ? node : best).id],
    sprinklers: overrides.sprinklers ?? [],
    fittings: overrides.fittings ?? [],
    codeBasis,
    endpointToleranceFt: 0.001,
  });
}

describe('wet pipe trapped basin solver', () => {
  it('finds the minimax spill elevation and only counts pipe below the spill', () => {
    const result = evaluate();
    expect(result).toMatchObject({
      lowPointCandidateCount: 1,
      uniqueBasinCount: 1,
      exactBasinGeometryReady: true,
      correctionPlanReady: true,
      drainageGradeSemanticsReady: false,
    });
    expect(result.basins[0]).toMatchObject({
      spillElevationFt: 2,
      trappedLengthFt: 10.484184,
      arrangement: {
        tier: 'less-than-5-gallons',
        correctionCandidate: 'add-one-half-inch-nipple-and-cap-or-plug-at-low-point',
      },
    });
  });

  it('accepts only a pendent at a small trapped endpoint, not an upright', () => {
    const upright = evaluate({ sprinklers: [{ id: 'u', pointFt: { x: 5, y: 0, z: 0 }, sourceAttributes: { 'Sub Category': 'Upright' } }] });
    const pendent = evaluate({ sprinklers: [{ id: 'p', pointFt: { x: 5, y: 0, z: 0 }, sourceAttributes: { 'Sub Category': 'Pendent' } }] });
    expect(upright.basins[0].termination.singlePendentRemovalReady).toBe(false);
    expect(upright.basins[0].sourceDispositionReady).toBe(false);
    expect(pendent.basins[0].termination.singlePendentRemovalReady).toBe(true);
    expect(pendent.basins[0].sourceDispositionReady).toBe(true);
  });

  it('fails closed on conflicting or absent internal diameter evidence', () => {
    const pipes = [pipe('only', { x: 0, y: 0, z: 1 }, { x: 5, y: 0, z: 0 })];
    const graph = buildPhysicalPipeGraph(pipes, 0.001);
    const base = {
      pipes,
      graph,
      lowPointCandidates: [{ id: 'low', pointFt: { x: 5, y: 0, z: 0 } }],
      mainDrainEntryNodeIds: [graph.nodes[0].id],
      codeBasis,
    };
    expect(() => evaluateWetPipeDrainageBasins({ ...base, physicalSpanRoutes: [] }))
      .toThrow('WET_DRAINAGE_INTERNAL_DIAMETER_MISSING');
    expect(() => evaluateWetPipeDrainageBasins({ ...base, physicalSpanRoutes: [
      { physicalClass: { nominalSizeInches: 1, subCategory: 'Schedule 40' }, diameterInternalInches: 1.049 },
      { physicalClass: { nominalSizeInches: 1, subCategory: 'Schedule 40' }, diameterInternalInches: 1.1 },
    ] })).toThrow('WET_DRAINAGE_INTERNAL_DIAMETER_CONFLICT');
  });
});
