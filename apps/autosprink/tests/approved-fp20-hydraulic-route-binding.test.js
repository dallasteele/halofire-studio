import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js';
import { bindApprovedFp20HydraulicRoute } from '../src/engine/approved-fp20-hydraulic-route-binding.js';

const readJson = (relative) => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
const graph = readJson('../src/data/new-hope-approved-fp20-plan-graph.json');
const evidence = readJson('../src/data/new-hope-approved-fp20-hydraulic-route-2-1.json');
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
      externalRiserNodeCount: 5,
      pipeTableLegCount: 13,
    });
    expect(result.physicalFlowNodeIds).toEqual(['1', '25', '554', '560', '414', '118', '67', '1046', '1047', '1048', '1049', '1050', '1051', '1052']);
    expect(result.physicalFlowLegs[0]).toMatchObject({ fromCalculationNodeId: '1', toCalculationNodeId: '25', calculationTableOrderReversed: true });
    expect(result.planRouteLegs).toHaveLength(8);
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
});
