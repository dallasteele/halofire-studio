import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js';
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js';
import { evaluateNewHopeSideBranchDrainage } from '../src/engine/new-hope-side-branch-drainage.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json');
const planGraph = read('new-hope-approved-fp20-plan-graph.json');
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json');
const canonicalTopology = canonicalizeApprovedFp20Topology(planGraph);
const governedSkeleton = evaluateApprovedFp20GovernedSkeleton(pipeVectors, planGraph, operationalAnnotations);
const inputs = { pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations };
const mutate = (key, callback) => ({ ...inputs, [key]: callback(structuredClone(inputs[key])) });

describe('New Hope mirrored side-branch drainage direction', () => {
  it('binds two complete acyclic seven-head components to low-point-02 and low-point-03', () => {
    const result = evaluateNewHopeSideBranchDrainage(inputs);
    expect(result.status).toBe('passed');
    expect(result.metrics).toEqual({
      branchSystemCount: 2,
      componentEdgeCount: 32,
      directedBranchLineEdgeCount: 28,
      unresolvedArmOverEdgeCount: 4,
      sprinklerCount: 14,
      trunkProfileCount: 2,
    });
    expect(result.branchSystems.map((entry) => [entry.lowPointId, entry.componentEdgeCount, entry.branchLineEdgeCount, entry.armOverEdgeCount, entry.sprinklerCount])).toEqual([
      ['low-point-02', 16, 14, 2, 7],
      ['low-point-03', 16, 14, 2, 7],
    ]);
    expect(result.sideBranchSourceTopologyReady).toBe(true);
    expect(result.sideBranchLineGradeDirectionReady).toBe(true);
  });

  it('directs only branch-line trunks and leaves four arm-over vertical offsets fail-closed', () => {
    const result = evaluateNewHopeSideBranchDrainage(inputs);
    const lower = result.branchSystems[0];
    const upper = result.branchSystems[1];
    expect(lower.directedBranchLineEdges.find((entry) => entry.edgeId === 'source-edge-011')).toMatchObject({ highNodeId: 'canonical-node-013', lowNodeId: 'canonical-node-014' });
    expect(lower.directedBranchLineEdges.find((entry) => entry.edgeId === 'source-edge-133')).toMatchObject({ highNodeId: 'canonical-node-138', lowNodeId: 'canonical-node-121' });
    expect(upper.directedBranchLineEdges.find((entry) => entry.edgeId === 'source-edge-013')).toMatchObject({ highNodeId: 'canonical-node-016', lowNodeId: 'canonical-node-017' });
    expect(upper.directedBranchLineEdges.find((entry) => entry.edgeId === 'source-edge-136')).toMatchObject({ highNodeId: 'canonical-node-131', lowNodeId: 'canonical-node-123' });
    expect(lower.trunkProfile).toEqual({ terminalNodeId: 'canonical-node-138', lowPointId: 'low-point-02', planRunLengthFt: 57.111139, requiredRiseFromLowPointIn: 2.855557 });
    expect(upper.trunkProfile).toEqual({ terminalNodeId: 'canonical-node-131', lowPointId: 'low-point-03', planRunLengthFt: 57.11125, requiredRiseFromLowPointIn: 2.855563 });
    expect(lower.unresolvedArmOverEdges.map((entry) => entry.edgeId).sort()).toEqual(['source-edge-086', 'source-edge-110']);
    expect(upper.unresolvedArmOverEdges.map((entry) => entry.edgeId).sort()).toEqual(['source-edge-087', 'source-edge-111']);
    expect(result.sideBranchRelativeGradeProfilesReady).toBe(true);
    expect(result.sideBranchArmOverDrainageReady).toBe(false);
    expect(result.exactPipeCenterlineZReady).toBe(false);
    expect(result.wholeFp20GradeDirectionReady).toBe(false);
    expect(result.properPipeLayoutReady).toBe(false);
  });

  it('fails closed on missing inputs and rejects source, role, topology, low-point, and grade drift', () => {
    expect(() => evaluateNewHopeSideBranchDrainage({})).not.toThrow();
    expect(evaluateNewHopeSideBranchDrainage({}).status).toBe('blocked');
    expect(evaluateNewHopeSideBranchDrainage(mutate('pipeVectors', (copy) => { copy.source.sha256 = 'drift'; return copy; })).blockerCodes).toContain('NH_SIDE_BRANCH_PLAN_SOURCE_INVALID');
    expect(evaluateNewHopeSideBranchDrainage(mutate('governedSkeleton', (copy) => { copy.primaryAssignments.find((entry) => entry.sourceSegmentId === 'pipe-046').systemRole = 'branch-line'; return copy; })).blockerCodes).toContain('NH_SIDE_BRANCH_COMPONENT_TOPOLOGY_INVALID');
    expect(evaluateNewHopeSideBranchDrainage(mutate('canonicalTopology', (copy) => { copy.edges = copy.edges.filter((edge) => edge.id !== 'source-edge-133'); return copy; })).blockerCodes).toContain('NH_SIDE_BRANCH_COMPONENT_TOPOLOGY_INVALID');
    expect(evaluateNewHopeSideBranchDrainage(mutate('operationalAnnotations', (copy) => { copy.lowPointAnchors.find((entry) => entry.id === 'low-point-03').boundPrimaryNodeIds = ['pipe-008-node-03']; return copy; })).blockerCodes).toContain('NH_SIDE_BRANCH_LOW_POINT_BINDING_INVALID');
    expect(evaluateNewHopeSideBranchDrainage(mutate('operationalAnnotations', (copy) => { copy.gradeRequirements.find((entry) => entry.id === 'grade-branch-lines').riseInPer10Ft = 0.25; return copy; })).blockerCodes).toContain('NH_SIDE_BRANCH_GRADE_MAGNITUDE_INVALID');
  });
});
