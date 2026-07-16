import { describe, expect, it } from 'vitest';

import calibration from '../src/data/polaris-pitched-pipe-xyz-calibration.json';
import {
  buildSourceFittingJunctionGraph,
  evaluateBoundedSourceFittingJunction,
} from '../src/engine/source-fitting-junction-graph.js';

const SUPPLY_FITTING_IDS = [
  'fitting-69835',
  'fitting-69852',
  'fitting-71128',
  'fitting-71338',
];
const SUPPLY_PIPE_ENDPOINT_IDS = [
  'pipe-22275:end',
  'pipe-3279:start',
  'pipe-17499:start',
];

const buildPolaris = (overrides = {}) => buildSourceFittingJunctionGraph({
  pipes: overrides.pipes ?? calibration.pipes,
  fittings: overrides.fittings ?? calibration.fittings,
});

describe('source fitting junction graph', () => {
  it('resolves the completed Polaris supply tee through three couplings and exact pipe endpoints', () => {
    const graph = buildPolaris();
    const bounded = evaluateBoundedSourceFittingJunction(graph, {
      fittingIds: SUPPLY_FITTING_IDS,
      pipeEndpointIds: SUPPLY_PIPE_ENDPOINT_IDS,
    });

    expect(bounded.status).toBe('passed');
    expect(bounded.sourceCenterlineAdjacencyReady).toBe(true);
    expect(bounded.fittingLinks).toEqual([
      {
        edgeId: 'fitting-69835|fitting-69852',
        fittingIds: ['fitting-69835', 'fitting-69852'],
        sourceCenterDistanceFt: 0.281666667,
      },
      {
        edgeId: 'fitting-69852|fitting-71128',
        fittingIds: ['fitting-69852', 'fitting-71128'],
        sourceCenterDistanceFt: 0.281666667,
      },
      {
        edgeId: 'fitting-69852|fitting-71338',
        fittingIds: ['fitting-69852', 'fitting-71338'],
        sourceCenterDistanceFt: 0.281666667,
      },
    ]);
    expect(bounded.pipeEndpointLinks).toEqual([
      { endpointId: 'pipe-17499:start', fittingId: 'fitting-71128', residualFt: 0.083333333 },
      { endpointId: 'pipe-22275:end', fittingId: 'fitting-69835', residualFt: 0.078333333 },
      { endpointId: 'pipe-3279:start', fittingId: 'fitting-71338', residualFt: 0.083333333 },
    ]);
    expect(bounded.manufacturerExactTakeoutReady).toBe(false);
    expect(bounded.properPipeLayoutReady).toBe(false);
  });

  it('resolves the completed inspector test-and-drain only to its two exact pipe endpoints', () => {
    const graph = buildPolaris();
    const bounded = evaluateBoundedSourceFittingJunction(graph, {
      fittingIds: ['fitting-72473'],
      pipeEndpointIds: ['pipe-22402:end', 'pipe-22468:end'],
    });

    expect(bounded.status).toBe('passed');
    expect(bounded.pipeEndpointLinks).toEqual([
      { endpointId: 'pipe-22402:end', fittingId: 'fitting-72473', residualFt: 0.21875 },
      { endpointId: 'pipe-22468:end', fittingId: 'fitting-72473', residualFt: 0.322916667 },
    ]);
  });

  it('resolves every rigid source junction while keeping hose centerlines and takeout fail-closed', () => {
    const graph = buildPolaris();
    expect(graph.metrics).toEqual({
      fittingCount: 98,
      rigidFittingCount: 28,
      flexibleDropCount: 70,
      resolvedRigidFittingCount: 28,
      unresolvedRigidFittingCount: 0,
      fittingToFittingEdgeCount: 18,
      fittingToPipeEndpointEdgeCount: 18,
      inlineDeviceAttachmentCount: 1,
      sourceOrientedOpenTerminalCount: 1,
    });
    expect(graph.issues).toHaveLength(0);
    expect(graph.pipeSpanAttachments).toEqual([{
      fittingId: 'fitting-75663',
      kind: 'pipe-span',
      pipeId: 'pipe-22275',
      stationFt: 0.489166666,
      spanFraction: 0.079950967,
      residualFt: 0,
    }]);
    expect(graph.openTerminals).toEqual([{
      fittingId: 'fitting-73733',
      kind: 'open-terminal',
      semantic: 'inspectors-test-drain-discharge',
      sourcePortIndex: 1,
      direction: { x: 0.707106781, y: 0, z: -0.707106781 },
    }]);
    expect(graph.claims).toEqual({
      sourceCenterlineAdjacencyCompleteReady: true,
      manufacturerExactTakeoutReady: false,
      flexibleHoseCenterlineReady: false,
      properPipeLayoutReady: false,
    });
  });

  it('rejects an extra tee ray instead of choosing a plausible-looking fourth branch', () => {
    const fittings = structuredClone(calibration.fittings);
    fittings.push({
      id: 'adversarial-fourth-tee-arm',
      pointFt: { x: 174.49, y: 39.666666667, z: 11 },
      sourceAttributes: {
        'Sub Category': 'Rigid Coupling',
        Description: 'adversarial extra coupling',
      },
    });
    const graph = buildPolaris({ fittings });
    const bounded = evaluateBoundedSourceFittingJunction(graph, {
      fittingIds: [...SUPPLY_FITTING_IDS, 'adversarial-fourth-tee-arm'],
      pipeEndpointIds: SUPPLY_PIPE_ENDPOINT_IDS,
    });

    expect(bounded.status).toBe('blocked');
    expect(bounded.issues.map((entry) => entry.code)).toContain('SOURCE_FITTING_BOUNDED_JUNCTION_UNRESOLVED');
    expect(bounded.sourceCenterlineAdjacencyReady).toBe(false);
  });

  it('rejects duplicate identities, over-wide tolerance, and false readiness promotion', () => {
    expect(() => buildSourceFittingJunctionGraph({
      pipes: [calibration.pipes[0], calibration.pipes[0]],
      fittings: [],
    })).toThrow('SOURCE_FITTING_JUNCTION_PIPE_ID_DUPLICATE');
    expect(() => buildSourceFittingJunctionGraph({
      pipes: [],
      fittings: [],
      maxGapFt: 0.500001,
    })).toThrow('SOURCE_FITTING_JUNCTION_GAP_INVALID');

    const graph = buildPolaris();
    graph.claims.manufacturerExactTakeoutReady = true;
    const bounded = evaluateBoundedSourceFittingJunction(graph, {
      fittingIds: SUPPLY_FITTING_IDS,
      pipeEndpointIds: SUPPLY_PIPE_ENDPOINT_IDS,
    });
    expect(bounded.status).toBe('blocked');
    expect(bounded.issues.map((entry) => entry.code)).toContain('SOURCE_FITTING_BOUNDED_FALSE_PROMOTION');
  });
});
