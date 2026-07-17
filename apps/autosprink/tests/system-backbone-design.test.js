import { describe, expect, it } from 'vitest';
import { buildSystemBackbone } from '../src/engine/system-backbone-design.js';
import { buildFullScopeBid } from '../src/engine/bid-scope.js';

const component = (id, pointFt, sizeIn = 4) => ({
  id,
  pointFt,
  sizeIn,
  catalogIdentityReady: true,
  sourceRef: `manufacturer:${id}`,
});

const validInput = () => ({
  projectId: 'fixture-backbone',
  waterSupply: {
    flowTest: { status: 'current', staticPsi: 75, residualPsi: 65, testFlowGpm: 1200 },
  },
  service: {
    entry: component('service-entry', { x: 0, y: 0, z: 0 }, 8),
    backflow: component('backflow-1', { x: 2, y: 0, z: 0 }, 8),
    fdc: component('fdc-1', { x: 2, y: 2, z: 3 }, null),
    manifold: component('manifold-1', { x: 5, y: 0, z: 0 }, 8),
  },
  pump: {
    ...component('pump-1', { x: 1, y: 0, z: 0 }, null),
    decision: 'required',
    ratedFlowGpm: 1000,
    ratedPressurePsi: 80,
    curveSourceRef: 'manufacturer:pump-curve-1',
  },
  systems: [
    {
      id: 'wet-1',
      type: 'wet',
      areaSqft: 42000,
      riser: component('riser-wet-1', { x: 10, y: 0, z: 0 }, 6),
      controlValve: component('valve-wet-1', { x: 10, y: 0, z: 3 }, 6),
      mainDrain: component('main-drain-wet-1', { x: 10, y: 1, z: 1 }, 2),
      inspectorsTestAndDrain: component('itd-wet-1', { x: 20, y: 10, z: 12 }, 1),
      feedPathFt: [{ x: 5, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
      auxiliaryDrains: [],
      drainage: {
        mainDrainPathFt: [{ x: 10, y: 1, z: 1 }, { x: 0, y: 1, z: 0 }],
        allPipeDrainsToRiser: true,
        trappedBasins: [{ id: 'basin-wet-1', volumeGallons: 2, lowPointFt: { x: 20, y: 10, z: 12 }, disposition: 'main-drain' }],
      },
    },
    {
      id: 'dry-1',
      type: 'dry',
      areaSqft: 18000,
      riser: component('riser-dry-1', { x: 10, y: 10, z: 0 }, 4),
      controlValve: component('valve-dry-1', { x: 10, y: 10, z: 3 }, 4),
      mainDrain: component('main-drain-dry-1', { x: 10, y: 11, z: 1 }, 2),
      inspectorsTestAndDrain: component('itd-dry-1', { x: 30, y: 10, z: 12 }, 1),
      feedPathFt: [{ x: 5, y: 0, z: 0 }, { x: 5, y: 10, z: 0 }, { x: 10, y: 10, z: 0 }],
      auxiliaryDrains: [{
        ...component('aux-dry-1', { x: 30, y: 10, z: 12 }, 1),
        outletPointFt: { x: 40, y: 10, z: 0 },
      }],
      drainage: {
        mainDrainPathFt: [{ x: 10, y: 11, z: 1 }, { x: 0, y: 11, z: 0 }],
        allPipeDrainsToRiser: true,
        trappedBasins: [{ id: 'basin-dry-1', volumeGallons: 8, lowPointFt: { x: 30, y: 10, z: 12 }, disposition: 'auxiliary-drain', drainId: 'aux-dry-1' }],
      },
    },
  ],
});

describe('shared riser pump and drain backbone', () => {
  it('emits matching 2D and 3D identities plus a quantity-correct quote takeoff', () => {
    const result = buildSystemBackbone(validInput());
    expect(result.status).toBe('passed');
    expect(result.plan2dReady).toBe(true);
    expect(result.model3dReady).toBe(true);
    expect(result.identityParityReady).toBe(true);
    expect(result.quoteReady).toBe(true);
    expect(result.counts).toMatchObject({ systems: 2, risers: 2, mainDrains: 2, auxiliaryDrains: 1, pumps: 1 });

    const planIds = [...result.plan2d.components, ...result.plan2d.routes].map((item) => item.id).sort();
    const modelIds = [...result.model3d.components, ...result.model3d.routes].map((item) => item.id).sort();
    expect(planIds).toEqual(modelIds);

    const quantities = Object.fromEntries(result.takeoff.systemComponents.map((row) => [row.key, row.quantity]));
    expect(quantities).toMatchObject({
      alarm_check_valve: 1,
      dry_pipe_valve: 1,
      riser_trim: 2,
      inspectors_test_and_drain: 2,
      main_drain: 2,
      auxiliary_drain: 1,
      fire_pump: 1,
    });
  });

  it('blocks stale supply data unresolved pump decisions bad dry drainage and missing auxiliary drains', () => {
    const input = validInput();
    input.waterSupply.flowTest.status = 'stale';
    input.pump.decision = 'unresolved';
    input.systems[1].drainage.allPipeDrainsToRiser = false;
    input.systems[1].drainage.trappedBasins[0].drainId = 'missing-drain';
    input.systems[1].feedPathFt[0] = { x: 8, y: 8, z: 0 };
    input.systems[0].riser.catalogIdentityReady = false;
    const result = buildSystemBackbone(input);
    const codes = result.issues.map((entry) => entry.code);
    expect(result.status).toBe('blocked');
    expect(result.quoteReady).toBe(false);
    expect(codes).toContain('BACKBONE_CURRENT_FLOW_TEST_REQUIRED');
    expect(codes).toContain('BACKBONE_PUMP_DECISION_REQUIRED');
    expect(codes).toContain('BACKBONE_DRY_DRAIN_TO_RISER_REQUIRED');
    expect(codes).toContain('BACKBONE_AUX_DRAIN_ID_MISSING');
    expect(codes).toContain('BACKBONE_FEED_MANIFOLD_MISMATCH');
    expect(codes).toContain('BACKBONE_COMPONENT_IDENTITY_REQUIRED');
  });

  it('blocks a trapped volume over five gallons unless it has an auxiliary-drain disposition', () => {
    const input = validInput();
    input.systems[0].drainage.trappedBasins[0].volumeGallons = 6;
    const result = buildSystemBackbone(input);
    expect(result.issues.map((entry) => entry.code)).toContain('BACKBONE_AUX_DRAIN_REQUIRED');
    expect(result.quoteReady).toBe(false);
  });

  it('drives full-scope component quantities and quote gating instead of the legacy one-riser assumption', () => {
    const backbone = buildSystemBackbone(validInput());
    const full = buildFullScopeBid({ materialCost: 10000, total: 12500 }, {
      systemBackbone: backbone,
      pricingVerified: true,
      priceResolver: () => 100,
      totalHeadCount: 400,
    });
    const byKey = Object.fromEntries(full.systemComponentLines.map((line) => [line.key, line]));
    expect(byKey.riser_trim.quantity).toBe(2);
    expect(byKey.main_drain.quantity).toBe(2);
    expect(byKey.inspectors_test_and_drain.quantity).toBe(2);
    expect(byKey.auxiliary_drain.quantity).toBe(1);
    expect(byKey.fire_pump.quantity).toBe(1);
    expect(full.systemDesignReady).toBe(true);
    expect(full.quoteReady).toBe(true);
  });
});
