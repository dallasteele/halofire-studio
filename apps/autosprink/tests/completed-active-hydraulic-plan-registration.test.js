import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCompletedActiveHydraulicPlanModel,
  validateCompletedActiveHydraulicPlanPortfolio,
  validateCompletedActiveHydraulicPlanRegistration,
} from '../src/engine/completed-active-hydraulic-plan-registration.js';

const readJson = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const mit = readJson('mit-riverside-active-hydraulic-plan-registration.json');
const sierra = readJson('sierra-marana-active-hydraulic-plan-registration.json');
const clone = (value) => structuredClone(value);

describe('completed active hydraulic sprinkler plan registration', () => {
  it('passes two independently completed, source-bound projects', () => {
    const result = validateCompletedActiveHydraulicPlanPortfolio([mit, sierra]);
    expect(result).toMatchObject({
      status: 'passed', projectCount: 2,
      counts: { activeSprinklerNodes: 26, runChecks: 19 },
      fullHydraulicPlanRegistrationReady: false,
      wholeBuildingNetworkElevationReady: false,
      exactAsBuiltDeflectorElevationReady: false,
      fabricationReady: false,
      complianceReady: false,
    });
    expect(result.featurePromotion.active_hydraulic_sprinkler_plan_registration).toEqual({
      ready: true, projectCount: 2, requiredProjectCount: 2,
      projects: ['mit-riverside-dugout-h', 'sierra-marana-di-mezzanine'],
    });
    expect(result.projects.every((project) => project.maxResidualFt <= 0.75)).toBe(true);
  });

  it('builds true sheet-scale XYZ nodes without claiming the inactive network', () => {
    const model = buildCompletedActiveHydraulicPlanModel(mit);
    expect(model).toMatchObject({ status: 'passed', artifactType: 'halofire.completed-active-hydraulic-plan-model.v1' });
    expect(model.nodes).toHaveLength(15);
    expect(model.nodes[0]).toMatchObject({ id: '1', sourcePointPt: [1719.06, 985.26], kFactor: 5.6, exactPlanAnchorReady: true, exactReportElevationReady: true });
    expect(model.nodes[0].sheetPointFt).toEqual([191.00666666666666, 82.52666666666667, 12]);
    expect(model.views.planSvg).toContain('data-node-id="21"');
    expect(model.views.elevationSvg).toContain('exact HASS Z');
  });

  it('rejects receipt, coordinate, source, scale, elevation, and run tampering', () => {
    for (const mutate of [
      (packet) => { packet.receiptSha256 = '0'.repeat(64); },
      (packet) => { packet.registration.activeNodes[0][1] += 9; },
      (packet) => { packet.sourceBindings[1].sha256 = '0'.repeat(64); },
      (packet) => { packet.registration.printedScalePtPerFt = 8; },
      (packet) => { packet.registration.activeNodes[0][3] = 0; },
      (packet) => { packet.registration.activeRunChecks[0][2] = 2; },
    ]) {
      const packet = clone(mit); mutate(packet);
      expect(validateCompletedActiveHydraulicPlanRegistration(packet).status).toBe('blocked');
    }
  });

  it('rejects duplicate projects and a one-project promotion attempt', () => {
    expect(validateCompletedActiveHydraulicPlanPortfolio([mit]).featurePromotion.active_hydraulic_sprinkler_plan_registration.ready).toBe(false);
    const duplicate = validateCompletedActiveHydraulicPlanPortfolio([mit, clone(mit)]);
    expect(duplicate.status).toBe('blocked');
    expect(duplicate.issues.some((entry) => entry.code === 'ACTIVE_HYDRAULIC_PLAN_PROJECT_DUPLICATED')).toBe(true);
  });

  it('keeps all downstream professional and whole-network gates fail-closed', () => {
    const packet = clone(sierra);
    packet.fullHydraulicPlanRegistrationReady = true;
    const result = validateCompletedActiveHydraulicPlanRegistration(packet);
    expect(result.status).toBe('blocked');
    expect(result.issues.some((entry) => entry.code === 'ACTIVE_HYDRAULIC_PLAN_FAIL_CLOSED_STATUS_DRIFT')).toBe(true);
  });
});
