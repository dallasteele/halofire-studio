import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js';
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js';
import { evaluateNewHopeLongBranchDrainage } from '../src/engine/new-hope-long-branch-drainage.js';
import { evaluateNewHopeSideBranchDrainage } from '../src/engine/new-hope-side-branch-drainage.js';
import { evaluateNewHopeCrossMainDrainage } from '../src/engine/new-hope-cross-main-drainage.js';
import { evaluateNewHopeCentralBranchDrainage } from '../src/engine/new-hope-central-branch-drainage.js';
import { evaluateNewHopeArmOverDrainage } from '../src/engine/new-hope-arm-over-drainage.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json');
const planGraph = read('new-hope-approved-fp20-plan-graph.json');
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json');
const canonicalTopology = canonicalizeApprovedFp20Topology(planGraph);
const governedSkeleton = evaluateApprovedFp20GovernedSkeleton(pipeVectors, planGraph, operationalAnnotations);
const hydraulicRoutes = ['2-1', '2-2', '2-3'].map((id) => read(`new-hope-approved-fp20-hydraulic-route-${id}.json`));
const longBranchDrainage = evaluateNewHopeLongBranchDrainage({ pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations });
const sideBranchDrainage = evaluateNewHopeSideBranchDrainage({ pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations });
const crossMainDrainage = evaluateNewHopeCrossMainDrainage({ pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations, hydraulicRoutes, sideBranchDrainage });
const centralBranchDrainage = evaluateNewHopeCentralBranchDrainage({ pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations });
const inputs = { pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations, longBranchDrainage, sideBranchDrainage, crossMainDrainage, centralBranchDrainage };
const mutate = (key, callback) => ({ ...inputs, [key]: callback(structuredClone(inputs[key])) });

describe('New Hope source-bound arm-over drainage', () => {
  it('binds all twelve terminal runs to source sprinklers, fabrication groups, carriers, and catchments', () => {
    const result = evaluateNewHopeArmOverDrainage(inputs);
    expect(result.status).toBe('passed');
    expect(result.metrics).toEqual({
      fabricationGroupCount: 6,
      sourceEdgeCount: 12,
      terminalSprinklerCount: 12,
      directedEdgeCount: 12,
      relativeProfileCount: 12,
    });
    expect(result.catchmentCounts).toEqual({
      'cmk-riser-return': 4,
      'riser-return': 4,
      'low-point-02': 2,
      'low-point-03': 2,
    });
    expect(result.directedEdges.map((entry) => entry.sprinklerId).sort()).toEqual([
      'head-001', 'head-002', 'head-005', 'head-006', 'head-035', 'head-036',
      'head-037', 'head-038', 'head-053', 'head-054', 'head-055', 'head-056',
    ]);
  });

  it('grades every terminal sprinkler high toward its explicit carrier catchment', () => {
    const result = evaluateNewHopeArmOverDrainage(inputs);
    const edge = (id) => result.directedEdges.find((entry) => entry.edgeId === id);
    expect(edge('source-edge-021')).toMatchObject({ highNodeId: 'canonical-node-025', lowNodeId: 'canonical-node-026', sprinklerId: 'head-001', carrierRole: 'branch-line', drainageCatchmentId: 'cmk-riser-return', requiredDropIn: 0.169535 });
    expect(edge('source-edge-084')).toMatchObject({ highNodeId: 'canonical-node-090', lowNodeId: 'canonical-node-089', sprinklerId: 'head-035', carrierRole: 'cross-main', drainageCatchmentId: 'riser-return', requiredDropIn: 0.32951 });
    expect(edge('source-edge-086')).toMatchObject({ highNodeId: 'canonical-node-094', lowNodeId: 'canonical-node-093', sprinklerId: 'head-037', carrierRole: 'branch-line', drainageCatchmentId: 'low-point-02', requiredDropIn: 0.344899 });
    expect(edge('source-edge-111')).toMatchObject({ highNodeId: 'canonical-node-124', lowNodeId: 'canonical-node-123', sprinklerId: 'head-055', carrierRole: 'branch-line', drainageCatchmentId: 'low-point-03', requiredDropIn: 0.09449 });
    expect(result.allTwelveArmOverDrainageReady).toBe(true);
    expect(result.wholeFp20GradeDirectionReady).toBe(true);
    expect(result.exactPipeCenterlineZReady).toBe(false);
    expect(result.properPipeLayoutReady).toBe(false);
    expect(result.fabricationReady).toBe(false);
    expect(result.fieldReleaseReady).toBe(false);
  });

  it('fails closed on source, inventory, fabrication, sprinkler, carrier, catchment, grade, and upstream drift', () => {
    expect(() => evaluateNewHopeArmOverDrainage({})).not.toThrow();
    expect(evaluateNewHopeArmOverDrainage({}).status).toBe('blocked');
    expect(evaluateNewHopeArmOverDrainage(mutate('pipeVectors', (copy) => { copy.source.sha256 = 'drift'; return copy; })).blockerCodes).toContain('NH_ARM_OVER_PLAN_SOURCE_INVALID');
    expect(evaluateNewHopeArmOverDrainage(mutate('operationalAnnotations', (copy) => { copy.armOverFabricationEvidence.fabricationListing.sha256 = 'drift'; return copy; })).blockerCodes).toContain('NH_ARM_OVER_FABRICATION_SOURCE_INVALID');
    expect(evaluateNewHopeArmOverDrainage(mutate('operationalAnnotations', (copy) => { copy.armOverFabricationEvidence.groups[0].sourceEdgeIds.pop(); return copy; })).blockerCodes).toContain('NH_ARM_OVER_INVENTORY_INVALID');
    expect(evaluateNewHopeArmOverDrainage(mutate('operationalAnnotations', (copy) => { copy.armOverFabricationEvidence.groups[0].listedCutLengthsIn = [20, 20]; return copy; })).blockerCodes).toContain('NH_ARM_OVER_FABRICATION_BINDING_INVALID');
    expect(evaluateNewHopeArmOverDrainage(mutate('operationalAnnotations', (copy) => { copy.armOverFabricationEvidence.groups[0].drainageCatchmentId = 'nearest-low-point'; return copy; })).blockerCodes).toContain('NH_ARM_OVER_FABRICATION_BINDING_INVALID');
    expect(evaluateNewHopeArmOverDrainage(mutate('pipeVectors', (copy) => { copy.sprinklers.find((entry) => entry.id === 'head-001').pipeDistancePdfPt = 3; return copy; })).blockerCodes).toContain('NH_ARM_OVER_TERMINAL_SPRINKLER_INVALID');
    expect(evaluateNewHopeArmOverDrainage(mutate('governedSkeleton', (copy) => { copy.primaryAssignments.find((entry) => entry.sourceSegmentId === 'pipe-019').systemRole = 'cross-main'; return copy; })).blockerCodes).toContain('NH_ARM_OVER_TERMINAL_TOPOLOGY_INVALID');
    expect(evaluateNewHopeArmOverDrainage(mutate('operationalAnnotations', (copy) => { copy.gradeRequirements.find((entry) => entry.id === 'grade-branch-lines').riseInPer10Ft = 0.25; return copy; })).blockerCodes).toContain('NH_ARM_OVER_GRADE_RULE_INVALID');
    expect(evaluateNewHopeArmOverDrainage(mutate('longBranchDrainage', (copy) => { copy.longBranchGradeDirectionReady = false; return copy; })).blockerCodes).toContain('NH_ARM_OVER_UPSTREAM_DRAINAGE_NOT_READY');
  });
});
