import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js';
import { bindApprovedFp20HydraulicRoute, bindApprovedFp20HydraulicRouteSet } from '../src/engine/approved-fp20-hydraulic-route-binding.js';

const readJson = (relative) => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
const graph = readJson('../src/data/new-hope-approved-fp20-plan-graph.json');
const evidence = readJson('../src/data/new-hope-approved-fp20-hydraulic-route-2-1.json');
const evidence22 = readJson('../src/data/new-hope-approved-fp20-hydraulic-route-2-2.json');
const evidence23 = readJson('../src/data/new-hope-approved-fp20-hydraulic-route-2-3.json');
const topology = canonicalizeApprovedFp20Topology(graph);
const mutate = (callback) => { const copy = structuredClone(evidence); callback(copy); return copy; };

describe('approved FP2.0 hydraulic route 2-1 binding', () => {
  it('binds plan calculation nodes and reverses table order into physical hydraulic flow', () => {
    const result = bindApprovedFp20HydraulicRoute(topology, evidence);
    expect(result.status).toBe('passed');
    expect(result.route21HydraulicNodeBindingReady).toBe(true);
    expect(result.route21HydraulicFlowDirectionReady).toBe(true);
    expect(result.metrics).toMatchObject({
      calculationNodeCount: 14,
      planBoundCalculationNodeCount: 9,
      externalNodeCount: 5,
      pipeTableLegCount: 13,
      mappedCanonicalEdgeCount: 36,
    });
    expect(result.physicalFlowNodeIds).toEqual(['1', '25', '554', '560', '414', '118', '67', '1046', '1047', '1048', '1049', '1050', '1051', '1052']);
    expect(result.physicalFlowLegs[0]).toMatchObject({ fromCalculationNodeId: '1', toCalculationNodeId: '25', calculationTableOrderReversed: true });
    expect(result.planRouteLegs).toHaveLength(8);
    expect(result.planRouteLegs.every((leg) => leg.routeSelectionMethod === 'explicit-approved-plan-and-hydraulic-table-binding')).toBe(true);
    expect(result.planRouteLegs.at(-1)).toMatchObject({
      calculationFromNodeId: '67',
      calculationToNodeId: '118',
      edgeIds: ['source-edge-050', 'source-edge-129', 'source-edge-128', 'source-edge-127', 'source-edge-143', 'source-edge-142', 'source-edge-141', 'source-edge-140', 'source-edge-139', 'source-edge-126', 'source-edge-125', 'source-edge-124', 'source-edge-123', 'source-edge-122', 'source-edge-121', 'source-edge-120', 'source-edge-112', 'source-edge-113', 'source-edge-004', 'source-edge-003'],
    });
    expect(result.wholeFp20HydraulicFlowReady).toBe(false);
    expect(result.gradeDirectionReady).toBe(false);
    expect(result.properPipeLayoutReady).toBe(false);
  });

  it('rejects a label leader rebound to the wrong canonical node', () => {
    const result = bindApprovedFp20HydraulicRoute(topology, mutate((copy) => { copy.planNodeBindings[0].canonicalNodeId = 'canonical-node-001'; }));
    expect(result.blockerCodes).toContain('FP20_HYDRAULIC_NODE_BINDING_INVALID');
    expect(result.route21HydraulicNodeBindingReady).toBe(false);
  });

  it('rejects flow semantics that confuse calculation order with physical flow', () => {
    const result = bindApprovedFp20HydraulicRoute(topology, mutate((copy) => { copy.physicalFlowDirection = copy.calculationDirection; }));
    expect(result.blockerCodes).toContain('FP20_DIRECTION_SEMANTICS_INVALID');
    expect(result.route21HydraulicFlowDirectionReady).toBe(false);
  });

  it('does not infer drainage grade from hydraulic direction or endpoint elevations', () => {
    const result = bindApprovedFp20HydraulicRoute(topology, evidence);
    expect(result.gradeDirectionReady).toBe(false);
    expect(result.properPipeLayoutReady).toBe(false);
  });

  it('rejects omission of fitting and device evidence from a calculation leg', () => {
    const result = bindApprovedFp20HydraulicRoute(topology, mutate((copy) => { copy.pipeTableLegs[8].notes = ''; }));
    expect(result.blockerCodes).toContain('FP20_HYDRAULIC_PIPE_TABLE_FIELD_MISSING');
  });

  it('rejects a non-reviewed alternative through a loop even when the endpoints remain connected', () => {
    const result = bindApprovedFp20HydraulicRoute(topology, mutate((copy) => {
      copy.planLegBindings[6].canonicalEdgeIds = ['source-edge-093', 'source-edge-088'];
      copy.planLegBindings[6].canonicalNodeIds = ['canonical-node-102', 'canonical-node-097', 'canonical-node-071'];
    }));
    expect(result.blockerCodes).toContain('FP20_HYDRAULIC_PLAN_PATH_ENDPOINT_MISMATCH');
    expect(result.route21HydraulicNodeBindingReady).toBe(false);
  });

  it('rejects an out-of-order explicit edge sequence instead of finding a replacement path', () => {
    const result = bindApprovedFp20HydraulicRoute(topology, mutate((copy) => {
      copy.planLegBindings[7].canonicalEdgeIds[1] = 'source-edge-066';
    }));
    expect(result.blockerCodes).toContain('FP20_HYDRAULIC_PLAN_PATH_DISCONTINUOUS');
  });

  it('rejects a persisted node sequence that does not match the reviewed edge traversal', () => {
    const result = bindApprovedFp20HydraulicRoute(topology, mutate((copy) => {
      copy.planLegBindings[0].canonicalNodeIds = ['canonical-node-108', 'canonical-node-001'];
    }));
    expect(result.blockerCodes).toContain('FP20_HYDRAULIC_PLAN_NODE_SEQUENCE_MISMATCH');
  });
});

describe('approved FP2.0 whole remote-area calculation route set', () => {
  it('binds every approved 2-1, 2-2, and 2-3 route without promoting non-calculated edges or drainage grade', () => {
    const result = bindApprovedFp20HydraulicRouteSet(topology, [evidence, evidence22, evidence23]);
    expect(result.status).toBe('passed');
    expect(result.approvedRemoteAreaSetReady).toBe(true);
    expect(result.approvedRemoteAreaHydraulicFlowReady).toBe(true);
    expect(result.metrics).toEqual({
      remoteAreaCount: 3,
      calculationRouteCount: 12,
      uniqueCalculationNodeCount: 39,
      planBoundCalculationNodeCount: 35,
      pipeTableLegCount: 51,
      planVisibleLegCount: 32,
      mappedCalculatedCanonicalEdgeCount: 56,
    });
    expect(result.wholeFp20HydraulicNodeBindingReady).toBe(false);
    expect(result.wholeFp20HydraulicFlowReady).toBe(false);
    expect(result.gradeDirectionReady).toBe(false);
    expect(result.properPipeLayoutReady).toBe(false);
  });

  it('binds the RA2-2 same-XY leg as vertical calculation evidence instead of inventing a plan connector', () => {
    const result = bindApprovedFp20HydraulicRoute(topology, evidence22);
    expect(result.status).toBe('passed');
    expect(result.metrics).toMatchObject({ calculationRouteCount: 6, pipeTableLegCount: 21, planVisibleLegCount: 14, verticalPlanLegCount: 1 });
    expect(result.planRouteLegs.find((leg) => leg.calculationFromNodeId === '718')).toMatchObject({
      calculationToNodeId: '50',
      pathKind: 'vertical-at-canonical-node',
      nodeIds: ['canonical-node-142'],
      edgeIds: [],
      calculationPipeLengthFt: 1,
    });
  });

  it('binds all RA2-3 plan nodes and route legs to calculation pages 31-32', () => {
    const result = bindApprovedFp20HydraulicRoute(topology, evidence23);
    expect(result.status).toBe('passed');
    expect(result.metrics).toMatchObject({ calculationRouteCount: 5, calculationNodeCount: 18, planBoundCalculationNodeCount: 11, pipeTableLegCount: 17, planVisibleLegCount: 10 });
  });

  it('rejects a same-XY leg if its vertical-axis evidence or elevation delta is removed', () => {
    const copy = structuredClone(evidence22);
    copy.planLegBindings.find((leg) => leg.calculationFromNodeId === '718').axisEvidence = 'hydraulic-flow-derived';
    const result = bindApprovedFp20HydraulicRoute(topology, copy);
    expect(result.blockerCodes).toContain('FP20_HYDRAULIC_VERTICAL_PLAN_LEG_INVALID');
  });

  it('rejects page drift and an incomplete remote-area set', () => {
    const pageDrift = structuredClone(evidence23);
    pageDrift.sourceBindings.hydraulicCalculation.physicalPages = [30, 31];
    expect(bindApprovedFp20HydraulicRoute(topology, pageDrift).blockerCodes).toContain('FP20_HYDRAULIC_ROUTE_SOURCE_INVALID');
    expect(bindApprovedFp20HydraulicRouteSet(topology, [evidence, evidence22]).blockerCodes).toContain('FP20_REMOTE_AREA_SET_INVALID');
  });

  it('contains no generic shortest-path fallback in the acceptance engine', () => {
    const source = fs.readFileSync(new URL('../src/engine/approved-fp20-hydraulic-route-binding.js', import.meta.url), 'utf8');
    expect(source).not.toContain('shortestPath');
    expect(source).not.toContain('nearestNeighbor');
  });
});
