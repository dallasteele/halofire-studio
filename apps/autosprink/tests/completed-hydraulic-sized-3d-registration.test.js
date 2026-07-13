import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCompletedHydraulicSized3dModel,
  validateCompletedHydraulicSized3dPortfolio,
  validateCompletedHydraulicSized3dRegistration,
  verifyHydraulicSized3dAdversarialLoop,
} from '../src/engine/completed-hydraulic-sized-3d-registration.js';

const readJson = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const mit = readJson('mit-riverside-hydraulic-sized-3d-registration.json');
const gmr = readJson('gmr-payson-hydraulic-sized-3d-registration.json');
const clone = (value) => structuredClone(value);

describe('completed hydraulic sized 3D edge registration', () => {
  it('promotes only HASS inside-diameter XYZ edge registration across independent completed jobs', () => {
    const result = validateCompletedHydraulicSized3dPortfolio([mit, gmr]);
    expect(result).toMatchObject({
      status: 'passed', projectCount: 2,
      counts: { registeredNodes: 26, registeredEdges: 23, verticalEdges: 3, diameterObservations: 23 },
      nominalPipeSizeReady: false, fullHydraulicPlanRegistrationReady: false, fabricationCutLengthReady: false,
      wholeBuildingNetworkElevationReady: false, exactAsBuiltDeflectorElevationReady: false, complianceReady: false,
    });
    expect(result.featurePromotion.hydraulic_inside_diameter_3d_edge_registration).toEqual({
      ready: true, projectCount: 2, requiredProjectCount: 2,
      projects: ['mit-riverside-dugout-h', 'gmr-ambulance-center-payson'],
    });
    expect(result.adversarialLoops.every((loop) => loop.status === 'passed')).toBe(true);
  });

  it('binds plan X/Y, HASS Z, and HASS diameter without relabeling diameter as nominal size', () => {
    const model = buildCompletedHydraulicSized3dModel(mit);
    expect(model).toMatchObject({ status: 'passed', artifactType: 'halofire.completed-hydraulic-sized-3d-edge-model.v1' });
    expect(model.nodes).toHaveLength(21);
    expect(model.edges).toHaveLength(20);
    expect(model.edges.find((edge) => edge.pipeId === 6)).toMatchObject({
      fromId: '6', toId: '7', reportLengthFt: 11, hydraulicInsideDiameterIn: 2.729,
      diameterSemantics: 'hydraulic-inside-diameter-not-nominal-size', hassPhysicalPage: 3,
    });
    expect(model.edges.find((edge) => edge.pipeId === 5).routePoints3dFt).toEqual([
      [241.75333333333336, 82.52666666666667, 12],
      [241.75333333333336, 82.52666666666667, 11.5],
    ]);
    expect(model.views.planSvg).toContain('data-hydraulic-inside-diameter-in="2.729"');
    expect(model.views.sideSvg).toContain('HASS inside diameter, not nominal size');
    expect(model.views.endSvg).toContain('data-pipe-id="20"');
  });

  it('registers only the GMR edges whose completed-plan vectors reproduce HASS lengths', () => {
    const result = validateCompletedHydraulicSized3dRegistration(gmr);
    expect(result).toMatchObject({
      status: 'passed', diameterClasses: [1.101, 1.598],
      metrics: { registeredNodeCount: 5, registeredEdgeCount: 3, diameterClassCount: 2, verticalEdgeCount: 0 },
    });
    expect(result.edgeChecks.map((edge) => edge.pipeId)).toEqual([1, 5, 8]);
    expect(result.edgeChecks.every((edge) => edge.residualFt <= 0.06 && edge.endpointMismatch === false)).toBe(true);
    expect(gmr.limitations.join(' ')).toContain('Other calculated loop edges remain excluded');
  });

  it('runs built-in adversarial rejection loops with no independent-review gate', () => {
    expect(verifyHydraulicSized3dAdversarialLoop(gmr)).toEqual({
      status: 'passed', receiptDriftRejected: true, sourceDriftRejected: true, duplicateEdgeRejected: true,
      routeEndpointDriftRejected: true, endpointZDriftRejected: true, hydraulicDiameterDriftRejected: true,
      nominalSizeSubstitutionRejected: true, reportedLengthDriftRejected: true,
      fullPlanPromotionRejected: true, fabricationPromotionRejected: true,
    });
  });

  it('rejects source, XYZ, diameter, route, metric, and false-promotion tampering', () => {
    for (const mutate of [
      (packet) => { packet.sourceBindings[0].sha256 = '0'.repeat(64); },
      (packet) => { packet.registration.nodes[0][1] += 13.5; },
      (packet) => { packet.registration.nodes[0][3] += 1; },
      (packet) => { packet.registration.edges[0][4] = 1.25; },
      (packet) => { packet.registration.edges[0][6][0][0] += 13.5; },
      (packet) => { packet.metrics.registeredEdgeCount += 1; },
      (packet) => { packet.nominalPipeSizeReady = true; },
      (packet) => { packet.fabricationCutLengthReady = true; },
    ]) {
      const packet = clone(gmr); mutate(packet);
      expect(validateCompletedHydraulicSized3dRegistration(packet).status).toBe('blocked');
    }
  });

  it('rejects duplicate projects and one-project promotion attempts', () => {
    expect(validateCompletedHydraulicSized3dPortfolio([mit]).featurePromotion.hydraulic_inside_diameter_3d_edge_registration.ready).toBe(false);
    const duplicate = validateCompletedHydraulicSized3dPortfolio([mit, clone(mit)]);
    expect(duplicate.status).toBe('blocked');
    expect(duplicate.issues.some((entry) => entry.code === 'HYDRAULIC_SIZED_3D_PROJECT_DUPLICATED')).toBe(true);
  });

  it('replays the sealed portfolio 100 times without state bleed', () => {
    const expected = validateCompletedHydraulicSized3dPortfolio([mit, gmr]);
    for (let replay = 0; replay < 100; replay += 1) expect(validateCompletedHydraulicSized3dPortfolio([clone(mit), clone(gmr)])).toEqual(expected);
  });
});
