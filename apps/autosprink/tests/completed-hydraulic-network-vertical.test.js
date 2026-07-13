import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCompletedHydraulicNetworkVerticalModel,
  validateCompletedHydraulicNetworkVerticalEvidence,
  validateCompletedHydraulicNetworkVerticalPortfolio,
} from '../src/engine/completed-hydraulic-network-vertical.js';

const readJson = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const mit = readJson('mit-riverside-hydraulic-network-vertical.json');
const nashville = readJson('nashville-hydraulic-network-vertical.json');
const clone = (value) => structuredClone(value);
const reseal = (value) => {
  const { receiptSha256: _old, ...draft } = value;
  return { ...draft, receiptSha256: createHash('sha256').update(JSON.stringify(draft)).digest('hex') };
};

describe('completed hydraulic-network vertical evidence', () => {
  it('validates exact connected report elevations and pipe topology for MIT and Nashville', () => {
    expect(validateCompletedHydraulicNetworkVerticalEvidence(mit)).toMatchObject({
      status: 'passed', projectId: 'mit-riverside-dugout-h',
      metrics: { nodeCount: 31, pipeCount: 30, activeSprinklerNodeCount: 15, planMappedNodeCount: 24, minimumElevationFt: -3, maximumElevationFt: 12, distinctElevationCount: 10 },
      hydraulicNetworkVerticalGeometryReady: true,
      planNodeCoordinateMappingReady: false,
      wholeBuildingNetworkElevationReady: false,
      exactAsBuiltDeflectorElevationReady: false,
    });
    expect(validateCompletedHydraulicNetworkVerticalEvidence(nashville)).toMatchObject({
      status: 'passed', projectId: 'nashville-tn-temple',
      metrics: { nodeCount: 68, pipeCount: 68, activeSprinklerNodeCount: 19, minimumElevationFt: -3, maximumElevationFt: 14.5, distinctElevationCount: 5 },
      hydraulicNetworkVerticalGeometryReady: true,
      planNodeCoordinateMappingReady: false,
      wholeBuildingNetworkElevationReady: false,
      exactAsBuiltDeflectorElevationReady: false,
    });
  });

  it('builds deterministic topology/elevation models without relabeling abstract X/Y as plan coordinates', () => {
    const model = buildCompletedHydraulicNetworkVerticalModel(mit);
    expect(model).toMatchObject({ status: 'passed', artifactType: 'halofire.completed-hydraulic-network-vertical-model.v1' });
    expect(model.nodes).toHaveLength(31);
    expect(model.pipes).toHaveLength(30);
    expect(model.nodes.every((node) => node.exactReportElevationReady && !node.planCoordinateReady)).toBe(true);
    expect(model.pipes.every((pipe) => pipe.exactEndpointElevationReady && !pipe.planCoordinateReady)).toBe(true);
    expect(model.elevationViewSvg).toContain('report Z exact; X topological');
    expect((model.elevationViewSvg.match(/data-node-id=/g) || [])).toHaveLength(31);
  });

  it('promotes the vertical-geometry feature only after two independent completed projects pass', () => {
    const portfolio = validateCompletedHydraulicNetworkVerticalPortfolio([mit, nashville]);
    expect(portfolio).toMatchObject({
      status: 'passed', projectCount: 2,
      counts: { nodes: 99, pipes: 98, activeSprinklerNodes: 34, planMappedNodes: 24 },
      featurePromotion: { hydraulic_network_vertical_geometry: { ready: true, projectCount: 2, requiredProjectCount: 2, projects: ['mit-riverside-dugout-h', 'nashville-tn-temple'] } },
      planNodeCoordinateMappingReady: false,
      wholeBuildingNetworkElevationReady: false,
      exactAsBuiltDeflectorElevationReady: false,
      fabricationReady: false,
      complianceReady: false,
    });
    expect(validateCompletedHydraulicNetworkVerticalPortfolio([mit]).featurePromotion.hydraulic_network_vertical_geometry).toMatchObject({ ready: false, projectCount: 1 });
    expect(validateCompletedHydraulicNetworkVerticalPortfolio([mit, mit])).toMatchObject({ status: 'blocked' });
  });

  it('rejects adversarial source, elevation, topology, and fail-closed status substitutions even when re-sealed', () => {
    const sourceSubstitution = clone(mit);
    sourceSubstitution.sourceBindings[0].sha256 = 'a'.repeat(64);
    expect(validateCompletedHydraulicNetworkVerticalEvidence(reseal(sourceSubstitution)).issues.map((entry) => entry.code)).toContain('HYDRAULIC_VERTICAL_SOURCE_DRIFT');

    const elevationSubstitution = clone(mit);
    elevationSubstitution.network.nodes[0][1] = 120;
    elevationSubstitution.network.metrics.maximumElevationFt = 120;
    elevationSubstitution.network.metrics.distinctElevationCount = 11;
    expect(validateCompletedHydraulicNetworkVerticalEvidence(reseal(elevationSubstitution)).issues.map((entry) => entry.code)).toContain('HYDRAULIC_VERTICAL_GEOMETRY_DRIFT');

    const disconnected = clone(nashville);
    disconnected.network.pipes[67] = [68, 'M2', 'M1', 5];
    expect(validateCompletedHydraulicNetworkVerticalEvidence(reseal(disconnected)).issues.map((entry) => entry.code)).toContain('HYDRAULIC_VERTICAL_TOPOLOGY_DISCONNECTED');

    const statusDrift = clone(nashville);
    statusDrift.wholeBuildingNetworkElevationReady = true;
    expect(validateCompletedHydraulicNetworkVerticalEvidence(reseal(statusDrift)).issues.map((entry) => entry.code)).toContain('HYDRAULIC_VERTICAL_FAIL_CLOSED_STATUS_DRIFT');
  });
});
