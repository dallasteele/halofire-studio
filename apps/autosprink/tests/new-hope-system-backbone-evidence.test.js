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
    expect(result.systems).toEqual([expect.objectContaining({
      id: 'new-hope-dry-attic',
      type: 'dry',
      riserNominalDiameterIn: 4,
      protectedAreaSqft: 13700,
      lowPointTieInCount: 4,
      fieldRouteDrumDripCount: 2,
    })]);

    const planById = Object.fromEntries(result.plan2d.components.map((component) => [component.id, component]));
    expect(planById['nh-riser-plan-station'].pdfPt).toEqual({ x: 660.675, y: 1118.512 });
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

  it('names every make-or-break release blocker instead of interpreting an as-built omission as a pump decision', () => {
    const result = buildNewHopeSystemBackboneEvidence(sources());
    expect(result.systemDesignGate).toEqual({
      status: 'blocked',
      blockers: expect.arrayContaining([
        'BACKBONE_CURRENT_FLOW_TEST_REQUIRED',
        'BACKBONE_PUMP_DECISION_REQUIRED',
        'NH_WET_SYSTEM_BACKBONE_REQUIRED',
        'NH_FIELD_ROUTE_DRUM_DRIP_GEOMETRY_REQUIRED',
        'NH_SOURCE_FEED_INSTALLATION_3D_PATH_REQUIRED',
      ]),
    });
    expect(result.currentFlowTestReady).toBe(false);
    expect(result.pumpDecisionReady).toBe(false);
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
