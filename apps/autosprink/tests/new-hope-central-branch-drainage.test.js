import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js';
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js';
import { evaluateNewHopeCentralBranchDrainage } from '../src/engine/new-hope-central-branch-drainage.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json');
const planGraph = read('new-hope-approved-fp20-plan-graph.json');
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json');
const canonicalTopology = canonicalizeApprovedFp20Topology(planGraph);
const governedSkeleton = evaluateApprovedFp20GovernedSkeleton(pipeVectors, planGraph, operationalAnnotations);
const inputs = { pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations };
const mutate = (key, callback) => ({ ...inputs, [key]: callback(structuredClone(inputs[key])) });

describe('New Hope BL48/BL49 generated central drainage schedule', () => {
  it('corrects CMK and the false CMI crossing before orienting all 23 branch edges', () => {
    const result = evaluateNewHopeCentralBranchDrainage(inputs);
    expect(result.status).toBe('passed');
    expect(result.metrics).toEqual({
      canonicalNodeCount: 23,
      canonicalEdgeCount: 23,
      directedEdgeCount: 23,
      sourceSegmentCount: 11,
      cycleRank: 1,
      loopCoreEdgeCount: 8,
      pathProfileCount: 4,
      unresolvedArmOverEdgeCount: 4,
    });
    expect(result.terminalNodeIds).toEqual(['canonical-node-029', 'canonical-node-032', 'canonical-node-047']);
    expect(result.feedNodeId).toBe('canonical-node-010');
    expect(result.selectedLoopHighNodeId).toBe('canonical-node-030');
    expect(result.centralBranchGeneratedGradeDirectionReady).toBe(true);
    expect(result.centralLoopDirectionReady).toBe(true);
  });

  it('grades both BL49 loop arms and both BL48 terminals toward the sole CMK feed', () => {
    const result = evaluateNewHopeCentralBranchDrainage(inputs);
    const edge = (id) => result.directedEdges.find((entry) => entry.edgeId === id);
    expect(edge('source-edge-043')).toMatchObject({ lineName: 'BL49', highNodeId: 'canonical-node-030', lowNodeId: 'canonical-node-046' });
    expect(edge('source-edge-015')).toMatchObject({ lineName: 'BL49', highNodeId: 'canonical-node-019', lowNodeId: 'canonical-node-011' });
    expect(edge('source-edge-025')).toMatchObject({ lineName: 'BL49', highNodeId: 'canonical-node-030', lowNodeId: 'canonical-node-031' });
    expect(edge('source-edge-016')).toMatchObject({ lineName: 'BL49', highNodeId: 'canonical-node-020', lowNodeId: 'canonical-node-011' });
    expect(edge('source-edge-009')).toMatchObject({ highNodeId: 'canonical-node-011', lowNodeId: 'canonical-node-010', drainageOutletId: 'cmk-riser-return' });
    expect(edge('source-edge-027')).toMatchObject({ lineName: 'BL48', highNodeId: 'canonical-node-032', lowNodeId: 'canonical-node-026' });
    expect(edge('source-edge-014')).toMatchObject({ lineName: 'BL48', highNodeId: 'canonical-node-018', lowNodeId: 'canonical-node-010' });
    expect(result.pathProfiles).toEqual([
      { id: 'bl49-high-via-lower-arm-to-feed', lineName: 'BL49', highNodeId: 'canonical-node-029', sinkNodeId: 'canonical-node-010', sinkId: 'cmk-riser-return', planRunLengthFt: 24.673859, minimumRequiredDropIn: 1.233693, absoluteEndpointElevationsReady: false },
      { id: 'bl49-high-via-upper-arm-to-feed', lineName: 'BL49', highNodeId: 'canonical-node-029', sinkNodeId: 'canonical-node-010', sinkId: 'cmk-riser-return', planRunLengthFt: 24.942969, minimumRequiredDropIn: 1.247148, absoluteEndpointElevationsReady: false },
      { id: 'bl48-south-terminal-to-feed', lineName: 'BL48', highNodeId: 'canonical-node-032', sinkNodeId: 'canonical-node-010', sinkId: 'cmk-riser-return', planRunLengthFt: 50.781838, minimumRequiredDropIn: 2.539092, absoluteEndpointElevationsReady: false },
      { id: 'bl48-west-terminal-to-feed', lineName: 'BL48', highNodeId: 'canonical-node-047', sinkNodeId: 'canonical-node-010', sinkId: 'cmk-riser-return', planRunLengthFt: 45.605665, minimumRequiredDropIn: 2.280283, absoluteEndpointElevationsReady: false },
    ]);
    expect(result.unresolvedArmOverEdges.map((entry) => entry.edgeId).sort()).toEqual(['source-edge-021', 'source-edge-022', 'source-edge-030', 'source-edge-031']);
    expect(result.selectedLoopHighPointAbsoluteZReady).toBe(false);
    expect(result.centralBranchArmOverDrainageReady).toBe(false);
    expect(result.properPipeLayoutReady).toBe(false);
  });

  it('fails closed on source, role, crossing, high-junction, topology, grade, and arm-over drift', () => {
    expect(() => evaluateNewHopeCentralBranchDrainage({})).not.toThrow();
    expect(evaluateNewHopeCentralBranchDrainage({}).status).toBe('blocked');
    expect(evaluateNewHopeCentralBranchDrainage(mutate('pipeVectors', (copy) => { copy.source.sha256 = 'drift'; return copy; })).blockerCodes).toContain('NH_CENTRAL_BRANCH_PLAN_SOURCE_INVALID');
    expect(evaluateNewHopeCentralBranchDrainage(mutate('governedSkeleton', (copy) => { copy.fabricationLineRoleBindingReady = false; return copy; })).blockerCodes).toContain('NH_CENTRAL_BRANCH_FABRICATION_SOURCE_INVALID');
    expect(evaluateNewHopeCentralBranchDrainage(mutate('operationalAnnotations', (copy) => { copy.fabricationLineEvidence.separatedCrossings[0].branchPieceOutletCount = 1; return copy; })).blockerCodes).toContain('NH_CENTRAL_BRANCH_FALSE_CROSSING_INVALID');
    expect(evaluateNewHopeCentralBranchDrainage(mutate('operationalAnnotations', (copy) => { copy.fabricationLineEvidence.centralBranchLines.find((entry) => entry.lineName === 'BL49').selectedHighJunctionCanonicalNodeId = 'drift'; return copy; })).blockerCodes).toContain('NH_CENTRAL_BRANCH_FEED_HIGH_BINDING_INVALID');
    expect(evaluateNewHopeCentralBranchDrainage(mutate('canonicalTopology', (copy) => { copy.edges = copy.edges.filter((entry) => entry.id !== 'source-edge-043'); return copy; })).blockerCodes).toContain('NH_CENTRAL_BRANCH_COMPONENT_TOPOLOGY_INVALID');
    expect(evaluateNewHopeCentralBranchDrainage(mutate('operationalAnnotations', (copy) => { copy.gradeRequirements.find((entry) => entry.id === 'grade-branch-lines').riseInPer10Ft = 0.25; return copy; })).blockerCodes).toContain('NH_CENTRAL_BRANCH_GRADE_MAGNITUDE_INVALID');
    expect(evaluateNewHopeCentralBranchDrainage(mutate('governedSkeleton', (copy) => { copy.primaryAssignments.find((entry) => entry.sourceSegmentId === 'pipe-016').systemRole = 'branch-line'; return copy; })).blockerCodes).toContain('NH_CENTRAL_BRANCH_ARM_OVER_SET_INVALID');
  });
});
