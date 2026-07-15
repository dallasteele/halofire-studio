import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js';
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js';
import { evaluateNewHopeLongBranchDrainage } from '../src/engine/new-hope-long-branch-drainage.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json');
const planGraph = read('new-hope-approved-fp20-plan-graph.json');
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json');
const canonicalTopology = canonicalizeApprovedFp20Topology(planGraph);
const governedSkeleton = evaluateApprovedFp20GovernedSkeleton(pipeVectors, planGraph, operationalAnnotations);
const inputs = { pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations };
const mutate = (key, callback) => ({ ...inputs, [key]: callback(structuredClone(inputs[key])) });

describe('New Hope complete long-branch drainage direction', () => {
  it('binds two complete acyclic 14-head branch systems to their source-proved low points', () => {
    const result = evaluateNewHopeLongBranchDrainage(inputs);
    expect(result.status).toBe('passed');
    expect(result.metrics).toEqual({
      branchSystemCount: 2,
      sourceSegmentCount: 14,
      canonicalEdgeCount: 44,
      directedEdgeCount: 43,
      lowPointZoneEdgeCount: 1,
      sprinklerCount: 28,
      terminalProfileCount: 4,
    });
    expect(result.branchSystems.map((entry) => [entry.lowPointId, entry.edgeCount, entry.sprinklerCount, entry.cycleRank])).toEqual([
      ['low-point-01', 22, 14, 0],
      ['low-point-04', 22, 14, 0],
    ]);
    expect(result.longBranchGradeDirectionReady).toBe(true);
  });

  it('orients every non-low-point-zone edge toward the root and emits four relative elevation profiles', () => {
    const result = evaluateNewHopeLongBranchDrainage(inputs);
    const lower = result.branchSystems[0];
    const upper = result.branchSystems[1];
    expect(lower.lowPointZoneEdgeIds).toEqual(['source-edge-054']);
    expect(lower.directedEdges.find((entry) => entry.edgeId === 'source-edge-098')).toMatchObject({ highNodeId: 'canonical-node-107', lowNodeId: 'canonical-node-108' });
    expect(upper.directedEdges.find((entry) => entry.edgeId === 'source-edge-057')).toMatchObject({ highNodeId: 'canonical-node-062', lowNodeId: 'canonical-node-056' });
    expect(upper.directedEdges.find((entry) => entry.edgeId === 'source-edge-103')).toMatchObject({ highNodeId: 'canonical-node-112', lowNodeId: 'canonical-node-113' });
    expect(lower.terminalProfiles).toEqual([
      { terminalNodeId: 'canonical-node-079', lowPointId: 'low-point-01', planRunLengthFt: 16.219753, requiredRiseFromLowPointIn: 0.810988 },
      { terminalNodeId: 'canonical-node-107', lowPointId: 'low-point-01', planRunLengthFt: 65.320793, requiredRiseFromLowPointIn: 3.26604 },
    ]);
    expect(upper.terminalProfiles).toEqual([
      { terminalNodeId: 'canonical-node-083', lowPointId: 'low-point-04', planRunLengthFt: 16.698203, requiredRiseFromLowPointIn: 0.83491 },
      { terminalNodeId: 'canonical-node-112', lowPointId: 'low-point-04', planRunLengthFt: 65.808466, requiredRiseFromLowPointIn: 3.290423 },
    ]);
    expect(result.longBranchRelativeGradeProfilesReady).toBe(true);
    expect(result.exactPipeCenterlineZReady).toBe(false);
    expect(result.wholeFp20GradeDirectionReady).toBe(false);
    expect(result.properPipeLayoutReady).toBe(false);
  });

  it('fails closed on missing inputs and rejects plan, role, topology, low-point, and grade drift', () => {
    expect(() => evaluateNewHopeLongBranchDrainage({})).not.toThrow();
    expect(evaluateNewHopeLongBranchDrainage({}).status).toBe('blocked');
    expect(evaluateNewHopeLongBranchDrainage(mutate('pipeVectors', (copy) => { copy.source.sha256 = 'drift'; return copy; })).blockerCodes).toContain('NH_LONG_BRANCH_PLAN_SOURCE_INVALID');
    expect(evaluateNewHopeLongBranchDrainage(mutate('governedSkeleton', (copy) => { copy.primaryPipeRoleAssignmentReady = false; return copy; })).blockerCodes).toContain('NH_LONG_BRANCH_ROLE_ASSIGNMENT_NOT_READY');
    expect(evaluateNewHopeLongBranchDrainage(mutate('canonicalTopology', (copy) => { copy.edges = copy.edges.filter((edge) => edge.id !== 'source-edge-103'); return copy; })).blockerCodes).toContain('NH_LONG_BRANCH_COMPONENT_TOPOLOGY_INVALID');
    expect(evaluateNewHopeLongBranchDrainage(mutate('operationalAnnotations', (copy) => { copy.lowPointAnchors.find((entry) => entry.id === 'low-point-04').boundPrimaryNodeIds = ['pipe-008-node-03']; return copy; })).blockerCodes).toContain('NH_LONG_BRANCH_LOW_POINT_BINDING_INVALID');
    expect(evaluateNewHopeLongBranchDrainage(mutate('operationalAnnotations', (copy) => { copy.gradeRequirements.find((entry) => entry.id === 'grade-branch-lines').riseInPer10Ft = 0.25; return copy; })).blockerCodes).toContain('NH_LONG_BRANCH_GRADE_MAGNITUDE_INVALID');
  });
});
