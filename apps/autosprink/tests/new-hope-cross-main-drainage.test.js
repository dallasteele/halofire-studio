import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js';
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js';
import { evaluateNewHopeSideBranchDrainage } from '../src/engine/new-hope-side-branch-drainage.js';
import { evaluateNewHopeCrossMainDrainage } from '../src/engine/new-hope-cross-main-drainage.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json');
const planGraph = read('new-hope-approved-fp20-plan-graph.json');
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json');
const canonicalTopology = canonicalizeApprovedFp20Topology(planGraph);
const governedSkeleton = evaluateApprovedFp20GovernedSkeleton(pipeVectors, planGraph, operationalAnnotations);
const hydraulicRoutes = ['2-1', '2-2', '2-3'].map((id) => read(`new-hope-approved-fp20-hydraulic-route-${id}.json`));
const sideBranchDrainage = evaluateNewHopeSideBranchDrainage({ pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations });
const inputs = { pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations, hydraulicRoutes, sideBranchDrainage };
const mutate = (key, callback) => ({ ...inputs, [key]: callback(structuredClone(inputs[key])) });

describe('New Hope complete cross-main drainage direction', () => {
  it('orients the corrected 35-node, 34-edge cross-main tree toward three source-bound outlets', () => {
    const result = evaluateNewHopeCrossMainDrainage(inputs);
    expect(result.status).toBe('passed');
    expect(result.metrics).toEqual({
      canonicalNodeCount: 35,
      canonicalEdgeCount: 34,
      directedEdgeCount: 34,
      sourceSegmentCount: 15,
      terminalCount: 4,
      highPointCount: 3,
      drainageOutletCount: 3,
      pathProfileCount: 5,
      calculationElevationAnchorCount: 4,
    });
    expect(result.terminalNodeIds).toEqual(['canonical-node-002', 'canonical-node-009', 'canonical-node-054', 'canonical-node-056']);
    expect(result.crossMainSourceTopologyReady).toBe(true);
    expect(result.crossMainGradeDirectionReady).toBe(true);
  });

  it('binds exact high-to-low paths and keeps unproved upper absolute Z fail-closed', () => {
    const result = evaluateNewHopeCrossMainDrainage(inputs);
    const edge = (id) => result.directedEdges.find((entry) => entry.edgeId === id);
    expect(edge('source-edge-127')).toMatchObject({ highNodeId: 'canonical-node-138', lowNodeId: 'canonical-node-117', drainageOutletId: 'low-point-01' });
    expect(edge('source-edge-143')).toMatchObject({ highNodeId: 'canonical-node-138', lowNodeId: 'canonical-node-142', drainageOutletId: 'riser-return' });
    expect(edge('source-edge-130')).toMatchObject({ highNodeId: 'canonical-node-131', lowNodeId: 'canonical-node-119', drainageOutletId: 'low-point-04' });
    expect(edge('source-edge-119')).toMatchObject({ highNodeId: 'canonical-node-131', lowNodeId: 'canonical-node-130', drainageOutletId: 'riser-return' });
    expect(edge('source-edge-112')).toMatchObject({ highNodeId: 'canonical-node-125', lowNodeId: 'canonical-node-007', drainageOutletId: 'riser-return' });
    expect(edge('source-edge-007')).toMatchObject({ sourceSegmentId: 'pipe-006', highNodeId: 'canonical-node-009', lowNodeId: 'canonical-node-010', drainageOutletId: 'riser-return' });
    expect(edge('source-edge-005')).toMatchObject({ sourceSegmentId: 'pipe-004', highNodeId: 'canonical-node-006', lowNodeId: 'canonical-node-007', drainageOutletId: 'riser-return' });
    expect(result.pathProfiles).toEqual([
      { id: 'lower-high-to-low-point-01', highNodeId: 'canonical-node-138', sinkNodeId: 'canonical-node-054', sinkId: 'low-point-01', planRunLengthFt: 17.684104, minimumRequiredDropIn: 0.442103, highCalculationElevationFt: 20.5, sinkCalculationElevationFt: 18.375, absoluteEndpointElevationsReady: true },
      { id: 'lower-high-to-riser-return', highNodeId: 'canonical-node-138', sinkNodeId: 'canonical-node-002', sinkId: 'riser-return', planRunLengthFt: 69.409733, minimumRequiredDropIn: 1.735243, highCalculationElevationFt: 20.5, sinkCalculationElevationFt: 11.5, absoluteEndpointElevationsReady: true },
      { id: 'upper-high-to-low-point-04', highNodeId: 'canonical-node-131', sinkNodeId: 'canonical-node-056', sinkId: 'low-point-04', planRunLengthFt: 17.684104, minimumRequiredDropIn: 0.442103, highCalculationElevationFt: null, sinkCalculationElevationFt: null, absoluteEndpointElevationsReady: false },
      { id: 'upper-high-to-riser-return', highNodeId: 'canonical-node-131', sinkNodeId: 'canonical-node-002', sinkId: 'riser-return', planRunLengthFt: 44.245871, minimumRequiredDropIn: 1.106147, highCalculationElevationFt: null, sinkCalculationElevationFt: 11.5, absoluteEndpointElevationsReady: false },
      { id: 'cmk-high-to-riser-return', highNodeId: 'canonical-node-009', sinkNodeId: 'canonical-node-002', sinkId: 'riser-return', planRunLengthFt: 18.395446, minimumRequiredDropIn: 0.459886, highCalculationElevationFt: null, sinkCalculationElevationFt: 11.5, absoluteEndpointElevationsReady: false },
    ]);
    expect(result.upperHighPointAbsoluteZReady).toBe(false);
    expect(result.cmkLineBindingReady).toBe(true);
    expect(result.cmkHighPointBindingReady).toBe(true);
    expect(result.cmkHighPointAbsoluteZReady).toBe(false);
    expect(result.centralLoopDirectionReady).toBe(false);
    expect(result.wholeFp20GradeDirectionReady).toBe(false);
    expect(result.properPipeLayoutReady).toBe(false);
  });

  it('fails closed on missing inputs and rejects source, topology, catchment, calculation, and grade drift', () => {
    expect(() => evaluateNewHopeCrossMainDrainage({})).not.toThrow();
    expect(evaluateNewHopeCrossMainDrainage({}).status).toBe('blocked');
    expect(evaluateNewHopeCrossMainDrainage(mutate('pipeVectors', (copy) => { copy.source.sha256 = 'drift'; return copy; })).blockerCodes).toContain('NH_CROSS_MAIN_PLAN_SOURCE_INVALID');
    expect(evaluateNewHopeCrossMainDrainage(mutate('hydraulicRoutes', (copy) => { copy[0].sourceBindings.hydraulicCalculation.sha256 = 'drift'; return copy; })).blockerCodes).toContain('NH_CROSS_MAIN_CALCULATION_SOURCE_INVALID');
    expect(evaluateNewHopeCrossMainDrainage(mutate('canonicalTopology', (copy) => { copy.edges = copy.edges.filter((entry) => entry.id !== 'source-edge-130'); return copy; })).blockerCodes).toContain('NH_CROSS_MAIN_COMPONENT_TOPOLOGY_INVALID');
    expect(evaluateNewHopeCrossMainDrainage(mutate('operationalAnnotations', (copy) => { copy.lowPointAnchors.find((entry) => entry.id === 'low-point-04').boundPrimaryNodeIds = ['pipe-008-node-03']; return copy; })).blockerCodes).toContain('NH_CROSS_MAIN_LOW_POINT_BINDING_INVALID');
    expect(evaluateNewHopeCrossMainDrainage(mutate('operationalAnnotations', (copy) => { copy.supplyAnchor.rawText = 'DRIFT'; return copy; })).blockerCodes).toContain('NH_CROSS_MAIN_RISER_SOURCE_BINDING_INVALID');
    expect(evaluateNewHopeCrossMainDrainage(mutate('sideBranchDrainage', (copy) => { copy.branchSystems.find((entry) => entry.id === 'upper-side-branch-system').trunkTerminalNodeId = 'drift'; return copy; })).blockerCodes).toContain('NH_CROSS_MAIN_HIGH_JUNCTION_BINDING_INVALID');
    expect(evaluateNewHopeCrossMainDrainage(mutate('operationalAnnotations', (copy) => { copy.gradeRequirements.find((entry) => entry.id === 'grade-cross-mains').riseInPer10Ft = 0.5; return copy; })).blockerCodes).toContain('NH_CROSS_MAIN_GRADE_MAGNITUDE_INVALID');
    expect(evaluateNewHopeCrossMainDrainage(mutate('governedSkeleton', (copy) => { copy.fabricationLineRoleBindingReady = false; return copy; })).blockerCodes).toContain('NH_CROSS_MAIN_FABRICATION_LINE_BINDING_INVALID');
    expect(evaluateNewHopeCrossMainDrainage(mutate('hydraulicRoutes', (copy) => { const leg = copy.flatMap((route) => route.pipeTableLegs).find((entry) => entry.node1 === '118'); leg.elevation1Ft = 99; return copy; })).blockerCodes).toContain('NH_CROSS_MAIN_CALCULATION_ELEVATION_INVALID');
    expect(evaluateNewHopeCrossMainDrainage(mutate('hydraulicRoutes', (copy) => { for (const leg of copy.flatMap((route) => route.pipeTableLegs).filter((entry) => entry.notes?.includes('DPV') && entry.notes?.includes('BOR'))) leg.notes = []; return copy; })).blockerCodes).toContain('NH_CROSS_MAIN_RISER_RETURN_INVALID');
  });
});
