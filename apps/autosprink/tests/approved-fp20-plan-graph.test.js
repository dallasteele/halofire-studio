import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildApprovedFp20PlanGraph } from '../src/engine/approved-fp20-plan-graph.js';

const evidence = JSON.parse(fs.readFileSync(new URL('../src/data/new-hope-approved-fp20-pipe-vectors.json', import.meta.url), 'utf8'));
const persistedGraph = JSON.parse(fs.readFileSync(new URL('../src/data/new-hope-approved-fp20-plan-graph.json', import.meta.url), 'utf8'));
const mutate = (callback) => {
  const copy = structuredClone(evidence);
  callback(copy);
  return copy;
};

describe('approved FP2.0 top-down source plan graph', () => {
  it('splits every source stroke at heads and pipe contacts without moving source geometry', () => {
    const graph = buildApprovedFp20PlanGraph(evidence);
    expect(graph.sourcePlanGraphReady).toBe(true);
    expect(graph.blockerCodes).toEqual([]);
    expect(graph.metrics).toEqual({
      sourceSegmentCount: 67,
      sourceContactCount: 68,
      explicitMaskedTurnCount: 2,
      nodeCount: 210,
      edgeCount: 213,
      visibleSourceEdgeCount: 143,
      connectorEdgeCount: 70,
      sprinklerNodeCount: 68,
      boundSprinklerCount: 68,
      connectedComponentCount: 1,
      connectedNodeCount: 210,
    });
    expect(graph.pipeSizeAssignmentReady).toBe(false);
    expect(graph.hydraulicFlowReady).toBe(false);
    expect(graph.gradeDirectionReady).toBe(false);
    expect(graph.elevationReady).toBe(false);
  });

  it('replays byte-compatible structured data from the persisted graph stage', () => {
    expect(buildApprovedFp20PlanGraph(evidence)).toEqual(persistedGraph);
  });

  it('preserves every source vector in at least one visible split edge', () => {
    const graph = buildApprovedFp20PlanGraph(evidence);
    const sourceIds = new Set(graph.edges.filter((edge) => edge.kind === 'visible-source-pipe').map((edge) => edge.sourceSegmentId));
    expect(sourceIds).toEqual(new Set(evidence.pipeSegments.map((segment) => segment.id)));
  });

  it('binds each approved sprinkler once to its nearest source route', () => {
    const graph = buildApprovedFp20PlanGraph(evidence);
    const sprinklerIds = graph.nodes.flatMap((node) => node.sprinklerIds);
    expect(sprinklerIds).toHaveLength(68);
    expect(new Set(sprinklerIds).size).toBe(68);
    expect(new Set(sprinklerIds)).toEqual(new Set(evidence.sprinklers.map((head) => head.id)));
  });

  it('keeps scaled plan coordinates and visible edge lengths closed', () => {
    const graph = buildApprovedFp20PlanGraph(evidence);
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const node of graph.nodes) {
      expect(Number.isFinite(node.plan.xFt)).toBe(true);
      expect(Number.isFinite(node.plan.yFt)).toBe(true);
    }
    for (const edge of graph.edges.filter((candidate) => candidate.kind === 'visible-source-pipe')) {
      const from = nodeById.get(edge.fromNodeId).plan;
      const to = nodeById.get(edge.toNodeId).plan;
      expect(Math.abs(Math.hypot(to.xFt - from.xFt, to.yFt - from.yFt) - edge.planLengthFt)).toBeLessThan(0.00001);
    }
  });

  it('rejects broad automatic snapping even when it would make the graph connected', () => {
    const graph = buildApprovedFp20PlanGraph(mutate((copy) => {
      copy.topologyClosure.automaticJoinTolerancePdfPt = 10;
    }));
    expect(graph.blockerCodes).toContain('FP20_PLAN_GRAPH_TOLERANCE_INVALID');
    expect(graph.sourcePlanGraphReady).toBe(false);
  });

  it('rejects omission of either project-specific masked turn', () => {
    const graph = buildApprovedFp20PlanGraph(mutate((copy) => {
      copy.topologyClosure.explicitMaskedTurnLinks.pop();
    }));
    expect(graph.blockerCodes).toContain('FP20_PLAN_GRAPH_MASKED_TURNS_INVALID');
    expect(graph.metrics.connectedComponentCount).toBeGreaterThan(1);
    expect(graph.sourcePlanGraphReady).toBe(false);
  });
});
