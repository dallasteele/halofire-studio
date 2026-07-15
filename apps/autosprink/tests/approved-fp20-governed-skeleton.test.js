import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildApprovedFp20PlanGraph } from '../src/engine/approved-fp20-plan-graph.js';
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js';

const readJson = (relative) => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
const pipeEvidence = readJson('../src/data/new-hope-approved-fp20-pipe-vectors.json');
const annotations = readJson('../src/data/new-hope-approved-fp20-operational-annotations.json');
const planGraph = buildApprovedFp20PlanGraph(pipeEvidence);
const mutate = (callback) => { const copy = structuredClone(annotations); callback(copy); return copy; };

describe('approved FP2.0 governed pipe skeleton', () => {
  it('assigns every primary segment a source-backed size and role', () => {
    const result = evaluateApprovedFp20GovernedSkeleton(pipeEvidence, planGraph, annotations);
    expect(result.status).toBe('passed');
    expect(result.metrics.primarySegmentCount).toBe(67);
    expect(result.metrics.assignedPrimarySegmentCount).toBe(67);
    expect(result.primaryPipeSizeAssignmentReady).toBe(true);
    expect(result.primaryPipeRoleAssignmentReady).toBe(true);
    expect(result.primaryAssignments.find((entry) => entry.sourceSegmentId === 'pipe-001')).toMatchObject({ nominalDiameterIn: 4, systemRole: 'source-feed' });
    expect(result.primaryAssignments.find((entry) => entry.sourceSegmentId === 'pipe-059')).toMatchObject({ nominalDiameterIn: 3, systemRole: 'cross-main' });
    expect(result.primaryAssignments.filter((entry) => entry.systemRole === 'arm-over')).toHaveLength(12);
  });

  it('separates drains and inspector test from primary pipe and excludes dimension baselines', () => {
    const result = evaluateApprovedFp20GovernedSkeleton(pipeEvidence, planGraph, annotations);
    expect(result.operationalReferenceExtractionReady).toBe(true);
    expect(result.metrics.operationalReferenceVectorCount).toBe(17);
    expect(result.operationalReferenceVectors.map((entry) => entry.drawingIndex)).not.toContain(4961);
    expect(result.operationalReferenceVectors.map((entry) => entry.drawingIndex)).not.toContain(4963);
  });

  it('closes source, low-point, drain-intent, and grade-magnitude evidence without fabricating direction or elevation', () => {
    const result = evaluateApprovedFp20GovernedSkeleton(pipeEvidence, planGraph, annotations);
    expect(result.supplySourceAnchorReady).toBe(true);
    expect(result.lowPointIntentReady).toBe(true);
    expect(result.drainIntentReady).toBe(true);
    expect(result.gradeMagnitudeReady).toBe(true);
    expect(result.hydraulicCalculationCorpusReady).toBe(true);
    expect(result.hydraulicNodeBindingReady).toBe(false);
    expect(result.metrics.fp20HydraulicRemoteAreaCount).toBe(3);
    expect(result.fieldDrainRouteResolved).toBe(false);
    expect(result.gradeDirectionReady).toBe(false);
    expect(result.endpointElevationsReady).toBe(false);
    expect(result.wholeSystemVectorExtractionReady).toBe(false);
    expect(result.properPipeLayoutReady).toBe(false);
    expect(result.fabricationReady).toBe(false);
    expect(result.fieldReleaseReady).toBe(false);
    expect(result.remainingLayoutBlockers.map((entry) => entry.code)).toEqual([
      'FP20_CONNECTOR_CLUSTER_CANONICALIZATION_REQUIRED',
      'FP20_HYDRAULIC_FLOW_DIRECTION_UNRESOLVED',
      'FP20_GRADE_DIRECTION_UNRESOLVED',
      'FP20_ENDPOINT_ELEVATION_UNRESOLVED',
      'FP20_FIELD_DRAIN_ROUTE_UNRESOLVED',
      'FP20_FITTING_IDENTITY_UNRESOLVED',
    ]);
  });

  it('rejects drift in any approved, field-set, or as-built identity', () => {
    const result = evaluateApprovedFp20GovernedSkeleton(pipeEvidence, planGraph, mutate((copy) => { copy.sources[1].sha256 = 'DRIFT'; }));
    expect(result.blockerCodes).toContain('FP20_OPERATIONAL_SOURCE_BINDING_INVALID');
    expect(result.primaryPipeSizeAssignmentReady).toBe(false);
  });

  it('rejects hydraulic calculation corpus drift', () => {
    const result = evaluateApprovedFp20GovernedSkeleton(pipeEvidence, planGraph, mutate((copy) => {
      copy.hydraulicCalculationSources.calculationReport.sha256 = 'DRIFT';
    }));
    expect(result.blockerCodes).toContain('FP20_HYDRAULIC_CALCULATION_SOURCE_INVALID');
    expect(result.hydraulicCalculationCorpusReady).toBe(false);
  });

  it('rejects omission of a governed low-point callout', () => {
    const result = evaluateApprovedFp20GovernedSkeleton(pipeEvidence, planGraph, mutate((copy) => { copy.lowPointAnchors.pop(); }));
    expect(result.blockerCodes).toContain('FP20_LOW_POINT_ANCHOR_SET_INVALID');
  });

  it('rejects promotion of a dimension baseline into operational piping', () => {
    const result = evaluateApprovedFp20GovernedSkeleton(pipeEvidence, planGraph, mutate((copy) => {
      copy.operationalReferenceVectors[0].drawingIndex = 4961;
    }));
    expect(result.blockerCodes).toContain('FP20_OPERATIONAL_VECTOR_SET_INVALID');
    expect(result.blockerCodes).toContain('FP20_DIMENSION_BASELINE_PROMOTED_TO_PIPE');
  });

  it('rejects fabricated exact routes for source-marked field routing', () => {
    const result = evaluateApprovedFp20GovernedSkeleton(pipeEvidence, planGraph, mutate((copy) => {
      copy.fieldRouteDrainIntents[0].routeStatus = 'exact-fabrication-route';
    }));
    expect(result.blockerCodes).toContain('FP20_FIELD_DRAIN_INTENT_INVALID');
    expect(result.fieldReleaseReady).toBe(false);
  });
});
