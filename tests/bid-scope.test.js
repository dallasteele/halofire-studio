import { describe, expect, it } from 'vitest';
import {
  buildSystemComponents,
  buildSoftCosts,
  buildFullScopeBid,
  SOFT_COST_ASSUMPTIONS,
  SYSTEM_COMPONENT_FALLBACK_COSTS,
} from '../src/engine/bid-scope.js';

describe('buildSystemComponents', () => {
  it('returns the six core system components (qty 1 each) without a fire pump by default', () => {
    const items = buildSystemComponents({ totalHeadCount: 200, hazard: 'ordinary' });
    const keys = items.map((i) => i.key);
    expect(keys).toEqual([
      'alarm_check_valve',
      'fdc',
      'backflow_preventer',
      'riser_trim',
      'inspectors_test_and_drain',
      'main_drain',
    ]);
    expect(items).toHaveLength(6);
    for (const item of items) {
      expect(item.unit).toBe('EA');
      expect(item.quantity).toBe(1);
      expect(typeof item.description).toBe('string');
      expect(item.description.length).toBeGreaterThan(0);
    }
  });

  it('adds a fire pump when an explicit boolean requires it', () => {
    const items = buildSystemComponents({ totalHeadCount: 200, hazard: 'ordinary', firePumpRequired: true });
    expect(items).toHaveLength(7);
    const pump = items.find((i) => i.key === 'fire_pump');
    expect(pump).toMatchObject({ key: 'fire_pump', unit: 'EA', quantity: 1 });
  });

  it('adds a fire pump when required pressure/flow exceeds threshold', () => {
    // requiredPressure above the supply threshold warrants a pump.
    const items = buildSystemComponents({
      totalHeadCount: 200,
      hazard: 'extra',
      requiredPressure: 130,
      availablePressure: 90,
    });
    expect(items.some((i) => i.key === 'fire_pump')).toBe(true);
  });

  it('does NOT add a fire pump when available pressure covers the required pressure', () => {
    const items = buildSystemComponents({
      totalHeadCount: 200,
      hazard: 'ordinary',
      requiredPressure: 60,
      availablePressure: 90,
    });
    expect(items.some((i) => i.key === 'fire_pump')).toBe(false);
  });
});

describe('buildSoftCosts', () => {
  it('returns permit/design/freight as labelled percentage assumptions', () => {
    const subtotal = 100000;
    const lines = buildSoftCosts(subtotal);
    const keys = lines.map((l) => l.key);
    expect(keys).toEqual(['permit', 'engineering_design', 'freight']);
    for (const line of lines) {
      expect(line.priceSource).toBe('soft_cost_assumption');
      expect(line.unit).toBe('PCT');
      expect(line.quantity).toBe(1);
    }
  });

  it('computes each soft cost from the documented percentage of the subtotal', () => {
    const subtotal = 100000;
    const lines = buildSoftCosts(subtotal);
    const permit = lines.find((l) => l.key === 'permit');
    const design = lines.find((l) => l.key === 'engineering_design');
    const freight = lines.find((l) => l.key === 'freight');
    expect(permit.pct).toBe(SOFT_COST_ASSUMPTIONS.permit);
    expect(permit.lineTotal).toBeCloseTo(subtotal * SOFT_COST_ASSUMPTIONS.permit, 2);
    expect(design.lineTotal).toBeCloseTo(subtotal * SOFT_COST_ASSUMPTIONS.engineering_design, 2);
    expect(freight.lineTotal).toBeCloseTo(subtotal * SOFT_COST_ASSUMPTIONS.freight, 2);
    // Default assumptions: 2% permit, 6% design, 3% freight = 11% of subtotal.
    const total = lines.reduce((s, l) => s + l.lineTotal, 0);
    expect(total).toBeCloseTo(11000, 2);
  });

  it('returns zeroed soft costs for a zero subtotal without throwing', () => {
    const lines = buildSoftCosts(0);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line.lineTotal).toBe(0);
  });
});

describe('buildFullScopeBid', () => {
  // A minimal bare-materials priced bid as produced by priceBid().
  const baseBid = {
    lines: [
      { key: 'sprinkler_head', quantity: 200, unitCost: 12, lineTotal: 2400, priceSource: 'pricebook' },
    ],
    materialCost: 2400,
    laborCost: 17000,
    subtotal: 19400,
    markupPct: 25,
    markup: 4850,
    total: 24250,
    anyEstimated: false,
  };

  it('prices system components via the resolver and flags fallbacks', () => {
    // resolver only knows the FDC price; everything else must fall back + flag.
    const priceResolver = (key) => (key === 'fdc' ? 500 : null);
    const full = buildFullScopeBid(baseBid, {
      totalHeadCount: 200,
      hazard: 'ordinary',
      priceResolver,
    });

    const fdc = full.systemComponentLines.find((l) => l.key === 'fdc');
    const valve = full.systemComponentLines.find((l) => l.key === 'alarm_check_valve');
    expect(fdc.unitCost).toBe(500);
    expect(fdc.priceSource).toBe('pricebook');
    expect(valve.priceSource).toBe('fallback_estimate');
    expect(valve.unitCost).toBe(SYSTEM_COMPONENT_FALLBACK_COSTS.alarm_check_valve);
    // At least one component fell back, so the scope flags estimated pricing.
    expect(full.anyEstimated).toBe(true);
  });

  it('computes a full-scope total alongside the bare materials total', () => {
    const full = buildFullScopeBid(baseBid, { totalHeadCount: 200, hazard: 'ordinary' });

    // Bare materials total is preserved untouched.
    expect(full.bareMaterialsTotal).toBe(baseBid.total);

    // System components cost = sum of fallback line totals (no resolver supplied).
    const expectedComponentCost = full.systemComponentLines.reduce((s, l) => s + l.lineTotal, 0);
    expect(full.systemComponentCost).toBeCloseTo(expectedComponentCost, 2);

    // Soft costs are computed on (bareMaterialsTotal + systemComponentCost).
    const softBase = full.bareMaterialsTotal + full.systemComponentCost;
    const expectedSoft = softBase * (
      SOFT_COST_ASSUMPTIONS.permit
      + SOFT_COST_ASSUMPTIONS.engineering_design
      + SOFT_COST_ASSUMPTIONS.freight
    );
    expect(full.softCostTotal).toBeCloseTo(expectedSoft, 2);

    // Full-scope total = bare + components + soft.
    expect(full.fullScopeTotal).toBeCloseTo(
      full.bareMaterialsTotal + full.systemComponentCost + full.softCostTotal,
      2,
    );
    expect(full.fullScopeTotal).toBeGreaterThan(full.bareMaterialsTotal);
  });

  it('stays fail-closed: always labelled estimate, never claims parity', () => {
    const full = buildFullScopeBid(baseBid, { totalHeadCount: 200, hazard: 'ordinary' });
    expect(full.estimate).toBe(true);
    expect(full.disclaimer).toMatch(/estimate/i);
    expect(full.disclaimer).not.toMatch(/AHJ-approved|PE-reviewed|AutoSprink-parity/i);
  });

  it('includes a fire pump in the full scope when required', () => {
    const full = buildFullScopeBid(baseBid, {
      totalHeadCount: 200,
      hazard: 'extra',
      firePumpRequired: true,
    });
    expect(full.systemComponentLines.some((l) => l.key === 'fire_pump')).toBe(true);
  });
});
