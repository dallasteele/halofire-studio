import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildNewHopeSystemBackboneEvidence } from '../src/engine/new-hope-system-backbone-evidence.js';

const load = (relativePath) => JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'));
const sources = () => ({
  registration: load('../src/data/new-hope-asbuilt-source-feed-riser-registration.json'),
  operationalAnnotations: load('../src/data/new-hope-approved-fp20-operational-annotations.json'),
  planGraph: load('../src/data/new-hope-approved-fp20-plan-graph.json'),
  hydraulicRoutes: ['2-1', '2-2', '2-3'].map((id) => load(`../src/data/new-hope-approved-fp20-hydraulic-route-${id}.json`)),
  waterSupplyAndWetRiser: load('../src/data/new-hope-approved-water-supply-wet-riser-evidence.json'),
});

describe('New Hope source-bound system backbone evidence', () => {
  it('projects the real riser and drain evidence into plan elevation and bounded 3D without releasing a quote', () => {
    const result = buildNewHopeSystemBackboneEvidence(sources());
    expect(result.status).toBe('passed');
    expect(result.plan2dEvidenceReady).toBe(true);
    expect(result.elevation2dEvidenceReady).toBe(true);
    expect(result.model3dSourceIntersectionEvidenceReady).toBe(true);
    expect(result.model3dInstallationReady).toBe(false);
    expect(result.quoteReady).toBe(false);
    expect(result.systems).toHaveLength(2);
    expect(result.systems).toEqual(expect.arrayContaining([expect.objectContaining({
      id: 'new-hope-dry-attic',
      type: 'dry',
      riserNominalDiameterIn: 4,
      protectedAreaSqft: 13700,
      lowPointTieInCount: 4,
      fieldRouteDrumDripCount: 2,
    }), expect.objectContaining({
      id: 'new-hope-wet-level-1',
      type: 'wet',
      riserNominalDiameterIn: 3,
      protectedAreaSqft: 13700,
      testAndDrain: expect.objectContaining({ nominalDiameterIn: 1.25, pressureReducingValve: true }),
    })]));

    const planById = Object.fromEntries(result.plan2d.components.map((component) => [component.id, component]));
    expect(planById['nh-riser-plan-station'].pdfPt).toEqual({ x: 660.675, y: 1118.512 });
    expect(planById['nh-wet-riser-plan-station'].geometryStatus).toBe('exact-plan-riser-station-section-z-unresolved');
    expect(planById['nh-node-118'].geometryStatus).toBe('exact-plan-xy-and-calculation-z');
    expect(Object.keys(planById).filter((id) => id.startsWith('low-point-'))).toHaveLength(4);
    expect(Object.keys(planById).filter((id) => id.startsWith('field-route-drum-drip-'))).toHaveLength(2);
    expect(planById['remote-inspectors-test'].nominalDiameterIn).toBe(1);

    expect(result.elevation2d.components.map((component) => [component.calculationNodeId, component.localElevationFt])).toEqual([
      ['118', 11.5],
      ['414', 5.458333],
      ['560', 4.625],
      ['554', 1.166667],
    ]);
    expect(result.model3d.sourceIntersectionPoints.map((point) => point.id).sort()).toEqual(['nh-node-118', 'nh-node-414']);
    expect(result.model3d.releasedRoutes).toEqual([]);
  });

  it('proves the historical no-pump decision but keeps new quotes and unextracted installation geometry blocked', () => {
    const result = buildNewHopeSystemBackboneEvidence(sources());
    expect(result.systemDesignGate).toEqual({
      status: 'blocked',
      blockers: expect.arrayContaining([
        'BACKBONE_NEW_QUOTE_FLOW_TEST_REQUIRED',
        'NH_WET_SYSTEM_NETWORK_2D_EXTRACTION_REQUIRED',
        'NH_WET_SYSTEM_INSTALLATION_3D_PATH_REQUIRED',
        'NH_FIELD_ROUTE_DRUM_DRIP_GEOMETRY_REQUIRED',
        'NH_SOURCE_FEED_INSTALLATION_3D_PATH_REQUIRED',
      ]),
    });
    expect(result.currentFlowTestReady).toBe(false);
    expect(result.currentFlowTestContext).toBe('historical-approved-design-basis-not-current-for-new-quote');
    expect(result.rawFlowTestEvidenceReady).toBe(true);
    expect(result.approvedDesignWaterSupplyReady).toBe(true);
    expect(result.pumpDecisionReady).toBe(true);
    expect(result.pumpDecision).toEqual(expect.objectContaining({
      decision: 'not-required',
      minimumSafetyMarginPsi: 5.4,
    }));
    expect(result.wetRiserAndDrainEvidenceReady).toBe(true);
    expect(result.wetSystemBackboneReady).toBe(false);
    expect(result.takeoff.systemComponents).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'wet_test_and_drain_prv', quantity: 1 }),
      expect.objectContaining({ key: 'fire_pump', quantity: 0 }),
    ]));
    expect(result.fieldDrainRoutesResolved).toBe(false);
    expect(result.fabricationReady).toBe(false);
    expect(result.fieldReleaseReady).toBe(false);
  });

  it('rejects a mutated approved-plan hash', () => {
    const input = sources();
    input.planGraph.source.sha256 = 'WRONG';
    const result = buildNewHopeSystemBackboneEvidence(input);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_BACKBONE_SOURCE_BINDING_INVALID');
    expect(result.plan2dEvidenceReady).toBe(false);
  });

  it('rejects a mutated live flow-test hash', () => {
    const input = sources();
    input.waterSupplyAndWetRiser.sourceBindings.hydrantFlowTest.sha256 = 'WRONG';
    const result = buildNewHopeSystemBackboneEvidence(input);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_BACKBONE_SUPPLY_SOURCE_INVALID');
    expect(result.pumpDecisionReady).toBe(false);
  });

  it('rejects a no-pump claim when any approved calculation margin is mutated', () => {
    const input = sources();
    input.waterSupplyAndWetRiser.sourceBindings.hydraulicCalculation.calculationAreas[1].safetyMarginPsi = -0.1;
    const result = buildNewHopeSystemBackboneEvidence(input);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_BACKBONE_CALCULATION_AREA_SET_INVALID');
    expect(result.pumpDecisionReady).toBe(false);
  });

  it('rejects promotion of field-route drum-drip intent into a source-resolved route', () => {
    const input = sources();
    input.operationalAnnotations.fieldRouteDrainIntents[0].routeStatus = 'source-resolved';
    const result = buildNewHopeSystemBackboneEvidence(input);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_BACKBONE_FIELD_DRAIN_INTENT_INVALID');
    expect(result.fieldDrainRoutesResolved).toBe(false);
    expect(result.quoteReady).toBe(false);
  });

  it('rejects drift in any repeated hydraulic device leg', () => {
    const input = sources();
    const leg = input.hydraulicRoutes[1].pipeTableLegs.find((entry) => entry.node1 === '560' && entry.node2 === '554');
    leg.elevation2Ft = 2;
    const result = buildNewHopeSystemBackboneEvidence(input);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_BACKBONE_HYDRAULIC_LEG_INVALID');
    expect(result.model3dInstallationReady).toBe(false);
  });
});
