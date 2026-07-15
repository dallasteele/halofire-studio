import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildNewHopeProperPipeGraphCandidate,
  buildProperPipeCorpusCoverage,
  evaluateProperPitchedPipeGraph,
} from '../src/engine/proper-pitched-pipe-graph.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const newHopeSource = read('new-hope-truss-clearance-source.json');
const newHopeCalibration = read('new-hope-truss-clearance-calibration.json');
const winterGarden = read('winter-garden-pitched-hydraulic-registration.json');

describe('proper pitched-roof pipe graph acceptance contract', () => {
  it('rejects the current New Hope head-row candidate as incomplete pipe layout', () => {
    const candidate = buildNewHopeProperPipeGraphCandidate(newHopeCalibration, newHopeSource);
    const result = evaluateProperPitchedPipeGraph(candidate);
    expect(candidate.nodes).toHaveLength(7);
    expect(candidate.edges).toHaveLength(6);
    expect(result.status).toBe('blocked');
    expect(result.properPipeLayoutReady).toBe(false);
    expect(result.blockerCodes).toEqual(expect.arrayContaining([
      'PIPE_NODE_ELEVATION_MISSING',
      'PIPE_HYDRAULIC_NODE_ID_MISSING',
      'PIPE_EDGE_GRADE_DIRECTION_MISSING',
      'PIPE_RISER_SOURCE_MISSING',
      'PIPE_FLOW_PATH_INCOMPLETE',
      'PIPE_FITTING_IDENTITY_MISSING',
      'PIPE_LOW_POINT_MISSING',
    ]));
  });

  it('keeps plan direction, flow direction, and grade direction as distinct fields', () => {
    const candidate = buildNewHopeProperPipeGraphCandidate(newHopeCalibration, newHopeSource);
    const edge = candidate.edges[0];
    expect(edge).toMatchObject({
      planDirectionBearingDeg: 0,
      flow: { fromNodeId: 'NH-BB1-001', toNodeId: 'NH-BB1-002' },
      grade: { riseInPer10Ft: 0.5, highNodeId: null, lowNodeId: null },
    });
  });

  it('uses other completed projects as coverage evidence but never transfers project facts', () => {
    const coverage = buildProperPipeCorpusCoverage(newHopeCalibration, winterGarden);
    expect(coverage.transferProjectSpecificValuesAllowed).toBe(false);
    expect(coverage.dimensions).toMatchObject({
      scaledPlanXy: true,
      nominalFabricationSize: true,
      planDirection: true,
      hydraulicFlowDirection: true,
      dryBranchGradeMagnitude: true,
      dryCrossMainGradeMagnitude: true,
      projectGradeDirection: false,
      pitchedRowElevationDatum: true,
      operatingHydraulicEvidence: true,
      fullNetworkPipeElevation: false,
      perHeadHydraulicIdentity: false,
      lowPointDrainDestination: false,
      fittings: false,
      riserClosure: false,
    });
    expect(coverage.properPipeLayoutReady).toBe(false);
  });

  it('adversarially rejects a colored line with no source topology', () => {
    const result = evaluateProperPitchedPipeGraph({
      artifactType: 'halofire.source-bound-pitched-pipe-graph.v1',
      projectId: 'attack-colored-line',
      systemType: 'dry',
      sourceBindings: [{ sha256: 'a'.repeat(64), sheet: 'FP2.0' }],
      nodes: [],
      edges: [],
    });
    expect(result.blockerCodes).toContain('PIPE_GRAPH_EMPTY');
    expect(result.properPipeLayoutReady).toBe(false);
  });
});
