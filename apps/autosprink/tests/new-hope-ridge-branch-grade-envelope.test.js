import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js';
import { evaluateNewHopeRidgeBranchGradeEnvelope } from '../src/engine/new-hope-ridge-branch-grade-envelope.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json');
const planGraph = read('new-hope-approved-fp20-plan-graph.json');
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json');
const atticSource = read('new-hope-attic-specific-application-source.json');
const atticCalibration = read('new-hope-attic-specific-application-calibration.json');
const answerEvidence = read('new-hope-pitched-holdout-answer-evidence.json');
const canonicalTopology = canonicalizeApprovedFp20Topology(planGraph);
const inputs = { pipeVectors, canonicalTopology, operationalAnnotations, atticSource, atticCalibration, answerEvidence };
const mutate = (key, callback) => ({ ...inputs, [key]: callback(structuredClone(inputs[key])) });

describe('New Hope source-bound ridge branch grade envelope', () => {
  it('binds the seven-head ridge path and derives east-high to west-low drainage independently from hydraulic flow', () => {
    const result = evaluateNewHopeRidgeBranchGradeEnvelope(inputs);
    expect(result.status).toBe('passed');
    expect(result.canonicalEdgeIdsHighToLow).toEqual(['source-edge-104', 'source-edge-105', 'source-edge-106', 'source-edge-107', 'source-edge-094', 'source-edge-095', 'source-edge-096']);
    expect(result.gradeDirection).toBe('east-high-to-west-low');
    expect(result.drainCatchmentAnchorId).toBe('low-point-04');
    expect(result.drainageAudit).toHaveLength(7);
    expect(result.drainageAudit.every((entry) => entry.nearestLowPointId === 'low-point-04' && entry.alternateLowPointMarginFt > 74)).toBe(true);
    expect(result.boundedBranchGradeDirectionReady).toBe(true);
  });

  it('emits a feasible graded deflector envelope without inventing exact head or pipe elevations', () => {
    const result = evaluateNewHopeRidgeBranchGradeEnvelope(inputs);
    expect(result.gradeRiseInPer10Ft).toBe(0.5);
    expect(result.gradeRiseFtPerHeadSpacing).toBe(0.025);
    expect(result.totalHeadRowRiseFt).toBe(0.15);
    expect(result.totalHeadRowRiseIn).toBe(1.8);
    expect(result.lowEndpointSelectionRangeFt).toEqual({ min: 19.375, max: 19.725 });
    expect(result.headElevationEnvelopes[0]).toMatchObject({ stationFtFromWestLowEnd: 0, minimumDeflectorZFt: 19.375, maximumDeflectorZFt: 19.725 });
    expect(result.headElevationEnvelopes[6]).toMatchObject({ stationFtFromWestLowEnd: 36, minimumDeflectorZFt: 19.525, maximumDeflectorZFt: 19.875 });
    expect(result.boundedDeflectorGradeEnvelopeReady).toBe(true);
    expect(result.exactDeflectorElevationsReady).toBe(false);
    expect(result.exactPipeCenterlineZReady).toBe(false);
    expect(result.exactDrainRouteReady).toBe(false);
    expect(result.properPipeLayoutReady).toBe(false);
  });

  it('rejects plan registration, low-point catchment, grade, and manufacturer-range drift', () => {
    expect(() => evaluateNewHopeRidgeBranchGradeEnvelope({})).not.toThrow();
    expect(evaluateNewHopeRidgeBranchGradeEnvelope({}).status).toBe('blocked');
    expect(evaluateNewHopeRidgeBranchGradeEnvelope({}).blockerCodes).toContain('NH_RIDGE_GRADE_DEFLECTOR_RANGE_INVALID');
    expect(evaluateNewHopeRidgeBranchGradeEnvelope(mutate('answerEvidence', (copy) => { copy.answerRegistration.approvedPdfRender.featureBoundsPx.x += 1; return copy; })).blockerCodes).toContain('NH_RIDGE_GRADE_ANSWER_REGISTRATION_INVALID');
    expect(evaluateNewHopeRidgeBranchGradeEnvelope(mutate('pipeVectors', (copy) => { copy.sprinklers.find((head) => head.id === 'head-040').centerPdfPt.x += 1; return copy; })).blockerCodes).toContain('NH_RIDGE_GRADE_HEAD_REGISTRATION_INVALID');
    expect(evaluateNewHopeRidgeBranchGradeEnvelope(mutate('operationalAnnotations', (copy) => { copy.lowPointAnchors.find((anchor) => anchor.id === 'low-point-04').boundPrimaryNodeIds = ['pipe-008-node-03']; return copy; })).blockerCodes).toContain('NH_RIDGE_GRADE_LOW_POINT_BINDING_INVALID');
    expect(evaluateNewHopeRidgeBranchGradeEnvelope(mutate('operationalAnnotations', (copy) => { copy.gradeRequirements.find((entry) => entry.pipeRole === 'branch-line').riseInPer10Ft = 0.25; return copy; })).blockerCodes).toContain('NH_RIDGE_GRADE_MAGNITUDE_INVALID');
    expect(evaluateNewHopeRidgeBranchGradeEnvelope(mutate('atticCalibration', (copy) => { copy.heads[0].permittedDeflectorZRangeFt.max = 20; return copy; })).blockerCodes).toContain('NH_RIDGE_GRADE_DEFLECTOR_RANGE_INCONSISTENT');
  });
});
