import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCompletedHydraulicRoutedPlanModel,
  validateCompletedHydraulicRoutedPlanPortfolio,
  validateCompletedHydraulicRoutedPlanRegistration,
  verifyHydraulicRoutedPlanAdversarialLoop,
} from '../src/engine/completed-hydraulic-routed-plan-registration.js';

const readJson = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const mit = readJson('mit-riverside-hydraulic-routed-plan-registration.json');
const sierra = readJson('sierra-marana-hydraulic-routed-plan-registration.json');
const clone = (value) => structuredClone(value);

describe('completed hydraulic routed-plan registration', () => {
  it('promotes only the verified on-plan branch graph across two completed projects', () => {
    const result = validateCompletedHydraulicRoutedPlanPortfolio([mit, sierra]);
    expect(result).toMatchObject({
      status: 'passed', projectCount: 2,
      counts: { registeredNodes: 40, inactiveJunctions: 14, registeredPipes: 38, scaledLengthChecks: 31, topologyOnlyPipes: 4, samePlanAnchorVerticalPipes: 3 },
      fullHydraulicPlanRegistrationReady: false, wholeBuildingNetworkElevationReady: false,
      exactAsBuiltDeflectorElevationReady: false, fabricationReady: false, complianceReady: false,
    });
    expect(result.featurePromotion.on_plan_hydraulic_routed_registration).toEqual({
      ready: true, projectCount: 2, requiredProjectCount: 2,
      projects: ['mit-riverside-dugout-h', 'sierra-marana-di-mezzanine'],
    });
    expect(result.adversarialLoops.every((loop) => loop.status === 'passed')).toBe(true);
  });

  it('builds exact inactive junction anchors and routed plan polylines at sheet scale', () => {
    const model = buildCompletedHydraulicRoutedPlanModel(mit);
    expect(model).toMatchObject({ status: 'passed', artifactType: 'halofire.completed-hydraulic-routed-plan-model.v1' });
    expect(model.nodes).toHaveLength(21);
    expect(model.pipes).toHaveLength(20);
    expect(model.nodes.find((node) => node.id === '5')).toMatchObject({
      sourcePointPt: [2175.78, 985.26], sheetPointFt: [241.75333333333336, 82.52666666666667, 12],
      kFactor: null, anchorClass: 'vector-hydraulic-junction-center',
    });
    expect(model.pipes.find((pipe) => pipe.pipeId === 5)).toMatchObject({
      fromId: '5', toId: '6', reportLengthFt: 0.5, evidenceClass: 'same-plan-anchor-report-vertical',
      routePointsPt: [[2175.78, 985.26], [2175.78, 985.26]],
    });
    expect(model.views.planSvg).toContain('data-node-id="16"');
    expect(model.views.planSvg).toContain('data-pipe-id="20"');
  });

  it('separates vector topology from HASS length checks instead of manufacturing agreement', () => {
    const result = validateCompletedHydraulicRoutedPlanRegistration(sierra);
    expect(result.status).toBe('passed');
    expect(result.metrics).toMatchObject({ scaledLengthCheckCount: 14, topologyOnlyPipeCount: 4, maximumScaledPlanLengthResidualFt: 0.5718545355036415 });
    expect(result.residuals).toHaveLength(14);
    expect(result.residuals.every((entry) => entry.residualFt <= 0.75)).toBe(true);
    const model = buildCompletedHydraulicRoutedPlanModel(sierra);
    expect(model.pipes.filter((pipe) => pipe.evidenceClass === 'vector-topology-only').map((pipe) => pipe.pipeId)).toEqual([4, 9, 14, 18]);
  });

  it('runs the built-in adversarial loop without an external review gate', () => {
    expect(verifyHydraulicRoutedPlanAdversarialLoop(mit)).toEqual({
      status: 'passed', receiptDriftRejected: true, sourceDriftRejected: true, duplicateNodeRejected: true,
      disconnectedPipeRejected: true, routeEndpointDriftRejected: true, topologyAsLengthSubstitutionRejected: true, fullPlanPromotionRejected: true,
    });
  });

  it('rejects source, geometry, topology, route, metric, and promotion tampering', () => {
    for (const mutate of [
      (packet) => { packet.sourceBindings[1].sha256 = '0'.repeat(64); },
      (packet) => { packet.registration.nodes[4][1] += 9; },
      (packet) => { packet.registration.nodes[4][0] = packet.registration.nodes[3][0]; },
      (packet) => { packet.registration.pipes[0][1] = 'missing'; },
      (packet) => { packet.registration.pipes[0][5][0][0] += 1; },
      (packet) => { packet.metrics.registeredPipeCount += 1; },
      (packet) => { packet.fullHydraulicPlanRegistrationReady = true; },
    ]) {
      const packet = clone(mit); mutate(packet);
      expect(validateCompletedHydraulicRoutedPlanRegistration(packet).status).toBe('blocked');
    }
  });

  it('rejects duplicate projects and one-project promotion attempts', () => {
    expect(validateCompletedHydraulicRoutedPlanPortfolio([mit]).featurePromotion.on_plan_hydraulic_routed_registration.ready).toBe(false);
    const duplicate = validateCompletedHydraulicRoutedPlanPortfolio([mit, clone(mit)]);
    expect(duplicate.status).toBe('blocked');
    expect(duplicate.issues.some((entry) => entry.code === 'HYDRAULIC_ROUTED_PLAN_PROJECT_DUPLICATED')).toBe(true);
  });

  it('replays the sealed multi-project portfolio without state bleed under bounded stress', () => {
    const expected = validateCompletedHydraulicRoutedPlanPortfolio([mit, sierra]);
    for (let replay = 0; replay < 100; replay += 1) {
      const actual = validateCompletedHydraulicRoutedPlanPortfolio([clone(mit), clone(sierra)]);
      expect(actual).toEqual(expected);
    }
    expect(validateCompletedHydraulicRoutedPlanPortfolio([mit, sierra])).toEqual(expected);
  });
});
