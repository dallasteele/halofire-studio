import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js';

const graph = JSON.parse(fs.readFileSync(new URL('../src/data/new-hope-approved-fp20-plan-graph.json', import.meta.url), 'utf8'));
const mutate = (callback) => { const copy = structuredClone(graph); callback(copy); return copy; };

describe('approved FP2.0 canonical hydraulic topology', () => {
  it('contracts masked source contacts without losing any visible primary edge', () => {
    const result = canonicalizeApprovedFp20Topology(graph);
    expect(result.canonicalTopologyReady).toBe(true);
    expect(result.blockerCodes).toEqual([]);
    expect(result.metrics).toEqual({
      inputNodeCount: 210,
      inputEdgeCount: 213,
      contractedConnectorEdgeCount: 70,
      canonicalNodeCount: 142,
      canonicalEdgeCount: 143,
      canonicalJunctionCount: 62,
      connectedComponentCount: 1,
      connectedNodeCount: 142,
      inputCycleRank: 4,
      canonicalCycleRank: 2,
      artificialConnectorCycleCount: 2,
    });
    expect(new Set(result.edges.map((edge) => edge.id))).toEqual(new Set(graph.edges.filter((edge) => edge.kind === 'visible-source-pipe').map((edge) => edge.id)));
  });

  it('collapses each three-way pairwise connector triangle into one junction', () => {
    const result = canonicalizeApprovedFp20Topology(graph);
    expect(result.nodes.find((node) => node.memberNodeIds.includes('pipe-011-node-02'))?.memberNodeIds).toEqual(expect.arrayContaining(['pipe-011-node-02', 'pipe-012-node-01', 'pipe-007-node-02']));
    expect(result.nodes.find((node) => node.memberNodeIds.includes('pipe-014-node-02'))?.memberNodeIds).toEqual(expect.arrayContaining(['pipe-014-node-02', 'pipe-015-node-02', 'pipe-013-node-01']));
  });

  it('creates no self-loop or duplicate primary edge', () => {
    const result = canonicalizeApprovedFp20Topology(graph);
    const pairs = result.edges.map((edge) => [edge.fromNodeId, edge.toNodeId].sort().join('|'));
    expect(result.edges.some((edge) => edge.fromNodeId === edge.toNodeId)).toBe(false);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('keeps the two real source loops calculation-gated', () => {
    const result = canonicalizeApprovedFp20Topology(graph);
    expect(result.metrics.canonicalCycleRank).toBe(2);
    expect(result.sourceLoopsRequireCalculationBinding).toBe(true);
    expect(result.hydraulicFlowReady).toBe(false);
    expect(result.remainingTopologyBlockers[0].code).toBe('FP20_SOURCE_LOOPS_REQUIRE_CALCULATION_BINDING');
  });

  it('rejects broad connector contraction that could invent a junction', () => {
    const result = canonicalizeApprovedFp20Topology(mutate((copy) => {
      copy.edges.find((edge) => edge.kind !== 'visible-source-pipe').lengthPdfPt = 10;
    }));
    expect(result.blockerCodes).toContain('FP20_CANONICAL_CONNECTOR_INVALID');
    expect(result.canonicalTopologyReady).toBe(false);
  });
});
