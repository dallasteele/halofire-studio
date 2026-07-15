import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const proof = new URL('../src/data/proofs/new-hope-truss-clearance/', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, proof), 'utf8');

describe('New Hope PDF-bound visual proof', () => {
  it('keeps the actual structural and approved PDF renders beneath the overlays', () => {
    const html = read('index.html');
    expect(html).toContain('s102-roof-framing-underlay.png');
    expect(html).toContain('approved-ridge-branch-underlay.png');
    expect(html).toContain('approved-dry-pipe-note.png');
    expect(html).toContain('approved-fp20-full-underlay.png');
    for (const image of ['s102-roof-framing-underlay.png', 'approved-ridge-branch-underlay.png', 'approved-dry-pipe-note.png', 'approved-fp20-full-underlay.png', 'approved-fp20-pipe-size-overlay.png']) expect(fs.statSync(new URL(image, proof)).size).toBeGreaterThan(30_000);
  });

  it('states the missing pipe-layout facts instead of presenting a connector as a design', () => {
    const html = read('index.html');
    expect(html).toContain('WHOLE-SYSTEM GRADE DIRECTION AND Z STILL BLOCKED');
    expect(html).toContain('primaryPipeVectorExtractionReady=false');
    expect(html).toContain('wholeSystemVectorExtractionReady=false');
    expect(html).toContain('primaryPipeSizeAssignmentReady=false');
    expect(html).toContain('fieldDrainRouteResolved=false');
    expect(html).toContain('properPipeLayoutReady=false');
    expect(html).toContain('branchGradeDirectionReady=false');
    expect(html).toContain('endpointElevationsReady=false');
    expect(html).toContain('route21HydraulicNodeBindingReady=false');
    expect(html).toContain('route21HydraulicFlowDirectionReady=false');
    expect(html).toContain('route21ExplicitPlanPathReady=false');
    expect(html).toContain('no shortest-path fallback is allowed');
  });

  it('loads the sealed calibration and generates the S102 overlay from data', () => {
    const script = read('proof.js');
    expect(script).toContain('../../new-hope-truss-clearance-calibration.json');
    expect(script).toContain('../../new-hope-approved-fp20-pipe-vectors.json');
    expect(script).toContain('../../new-hope-approved-fp20-plan-graph.json');
    expect(script).toContain('../../new-hope-approved-fp20-operational-annotations.json');
    expect(script).toContain('../../new-hope-approved-fp20-hydraulic-route-2-1.json');
    expect(script).toContain('calibration.trussLattice.centerlines');
    expect(script).toContain('calibration.branch.nodes');
    expect(script).toContain('pipeVectors.pipeSegments');
    expect(script).toContain('pipeVectors.sprinklers');
    expect(script).toContain('pipeVectors.pipeSizeAnnotations');
    expect(script).toContain('buildApprovedFp20PlanGraph');
    expect(script).toContain('evaluateApprovedFp20PipeVectors');
    expect(script).toContain('evaluateApprovedFp20GovernedSkeleton');
    expect(script).toContain('canonicalizeApprovedFp20Topology');
    expect(script).toContain('bindApprovedFp20HydraulicRoute');
    expect(script).toContain("dataset.proofReady = 'true'");
    expect(script).toContain('dataset.pipeVectorStatus = vectorAcceptance.status');
    expect(script).toContain('dataset.primaryPipeSizeAssignmentReady = String(governedSkeleton.primaryPipeSizeAssignmentReady)');
    expect(script).toContain('dataset.primaryPipeRoleAssignmentReady = String(governedSkeleton.primaryPipeRoleAssignmentReady)');
    expect(script).toContain('dataset.wholeSystemVectorExtractionReady = String(governedSkeleton.wholeSystemVectorExtractionReady)');
    expect(script).toContain('dataset.properPipeLayoutReady = String(governedSkeleton.properPipeLayoutReady)');
    expect(script).toContain('dataset.branchGradeDirectionReady = String(governedSkeleton.gradeDirectionReady)');
    expect(script).toContain('dataset.endpointElevationsReady = String(governedSkeleton.endpointElevationsReady)');
    expect(script).toContain('dataset.route21HydraulicNodeBindingReady = String(hydraulicRoute21.route21HydraulicNodeBindingReady)');
    expect(script).toContain('dataset.route21ExplicitPlanPathReady = String(hydraulicRoute21.route21ExplicitPlanPathReady)');
    expect(script).toContain("dataset.drainDestinationReady = 'false'");
    expect(script).toContain('evaluateProperPitchedPipeGraph');
    expect(script).toContain("dataset.pipeGraphStatus = governedSkeleton.properPipeLayoutReady ? 'passed' : 'blocked'");
    expect(script).toContain('canonicalTopology.remainingTopologyBlockers');
  });
});
