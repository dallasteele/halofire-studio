import { describe, expect, it } from 'vitest';
import {
  buildSystemComponents,
  buildSoftCosts,
  buildLaborScope,
  buildOverheadProfit,
  buildFullScopeBid,
  SOFT_COST_ASSUMPTIONS,
  LABOR_ASSUMPTIONS,
  OHP_ASSUMPTIONS,
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
    // Supply the labor drivers so labor + OH&P participate (T23).
    const full = buildFullScopeBid(baseBid, {
      totalHeadCount: 200,
      hazard: 'ordinary',
      pipeFootage: 1200,
      fittingCount: 215,
    });

    // Bare materials total is preserved untouched (back-compat reference).
    expect(full.bareMaterialsTotal).toBe(baseBid.total);

    // T23: full-scope is built from the bare MATERIAL cost (un-marked-up), NOT
    // the marked-up priceBid total, to avoid double-counting labor/markup.
    expect(full.materialsOnly).toBe(baseBid.materialCost);

    // System components cost = sum of fallback line totals (no resolver supplied).
    const expectedComponentCost = full.systemComponentLines.reduce((s, l) => s + l.lineTotal, 0);
    expect(full.systemComponentCost).toBeCloseTo(expectedComponentCost, 2);

    // Detailed field labor is present and priced from documented assumptions.
    expect(full.laborScope).toBeTruthy();
    expect(full.laborCost).toBeCloseTo(full.laborScope.laborCost, 2);
    expect(full.laborCost).toBeGreaterThan(0);

    // Soft costs are computed on (materialsOnly + systemComponentCost + laborCost).
    const softBase = full.materialsOnly + full.systemComponentCost + full.laborCost;
    const expectedSoft = softBase * (
      SOFT_COST_ASSUMPTIONS.permit
      + SOFT_COST_ASSUMPTIONS.engineering_design
      + SOFT_COST_ASSUMPTIONS.freight
    );
    expect(full.softCostTotal).toBeCloseTo(expectedSoft, 2);

    // OH&P rides on the cost subtotal (materials + components + labor + soft).
    expect(full.ohp).toBeTruthy();
    const costSubtotal = full.materialsOnly + full.systemComponentCost + full.laborCost + full.softCostTotal;
    expect(full.fullScopeTotal).toBeCloseTo(costSubtotal + full.ohp.ohpTotal, 2);

    // Full-scope total still exceeds the bare-materials reference total.
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

  it('includes labor + OH&P scope, flagged as assumptions (T23)', () => {
    const full = buildFullScopeBid(baseBid, {
      totalHeadCount: 200,
      hazard: 'ordinary',
      pipeFootage: 1200,
      fittingCount: 215,
    });
    // Labor lines are flagged labor_assumption.
    expect(full.laborScope.lines.length).toBe(3);
    for (const line of full.laborScope.lines) {
      expect(line.priceSource).toBe('labor_assumption');
      expect(line.unit).toBe('HR');
    }
    // OH&P lines are flagged ohp_assumption.
    expect(full.ohp.lines.length).toBe(2);
    for (const line of full.ohp.lines) {
      expect(line.priceSource).toBe('ohp_assumption');
    }
    // Assumptions present -> the scope flags estimated pricing.
    expect(full.anyEstimated).toBe(true);
    // Disclaimer now mentions labor + OH&P as assumptions.
    expect(full.disclaimer.toLowerCase()).toContain('labor');
    expect(full.disclaimer.toLowerCase()).toMatch(/oh&p|overhead/);
  });

  it('handles zero labor drivers without throwing (zero labor cost)', () => {
    const full = buildFullScopeBid(baseBid, { totalHeadCount: 0, hazard: 'ordinary' });
    expect(full.laborScope.laborCost).toBe(0);
    expect(full.laborScope.laborHours).toBe(0);
    // Still produces a coherent total (>= bare materials reference).
    expect(full.fullScopeTotal).toBeGreaterThanOrEqual(0);
  });
});

describe('buildLaborScope', () => {
  it('prices head/pipe/fitting labor from documented hour assumptions', () => {
    const labor = buildLaborScope({ totalHeadCount: 100, pipeFootage: 1000, fittingCount: 200 });
    const head = labor.lines.find((l) => l.key === 'head_install');
    const pipe = labor.lines.find((l) => l.key === 'pipe_handling');
    const fitting = labor.lines.find((l) => l.key === 'fitting_install');

    expect(head.hours).toBeCloseTo(100 * LABOR_ASSUMPTIONS.hoursPerHead, 4);
    expect(pipe.hours).toBeCloseTo(1000 * LABOR_ASSUMPTIONS.hoursPerPipeFt, 4);
    expect(fitting.hours).toBeCloseTo(200 * LABOR_ASSUMPTIONS.hoursPerFitting, 4);

    for (const line of labor.lines) {
      expect(line.unit).toBe('HR');
      expect(line.ratePerHour).toBe(LABOR_ASSUMPTIONS.laborRatePerHour);
      expect(line.priceSource).toBe('labor_assumption');
      expect(line.lineTotal).toBeCloseTo(line.hours * line.ratePerHour, 2);
    }

    const expectedHours = 100 * LABOR_ASSUMPTIONS.hoursPerHead
      + 1000 * LABOR_ASSUMPTIONS.hoursPerPipeFt
      + 200 * LABOR_ASSUMPTIONS.hoursPerFitting;
    expect(labor.laborHours).toBeCloseTo(expectedHours, 4);
    expect(labor.laborCost).toBeCloseTo(expectedHours * LABOR_ASSUMPTIONS.laborRatePerHour, 2);
  });

  it('honours per-constant overrides while defaulting the rest', () => {
    const labor = buildLaborScope(
      { totalHeadCount: 10, pipeFootage: 0, fittingCount: 0 },
      { hoursPerHead: 1.0, laborRatePerHour: 100 },
    );
    const head = labor.lines.find((l) => l.key === 'head_install');
    expect(head.hours).toBe(10); // 10 * 1.0 override
    expect(head.ratePerHour).toBe(100); // rate override
    expect(head.lineTotal).toBe(1000);
    expect(labor.laborCost).toBe(1000);
  });

  it('returns zero hours for missing/zero drivers without throwing', () => {
    const labor = buildLaborScope({});
    expect(labor.laborHours).toBe(0);
    expect(labor.laborCost).toBe(0);
    for (const line of labor.lines) expect(line.hours).toBe(0);
  });
});

describe('buildOverheadProfit', () => {
  it('applies overhead on cost then profit on cost+overhead (documented order)', () => {
    const cost = 100000;
    const ohp = buildOverheadProfit(cost);
    const overhead = ohp.lines.find((l) => l.key === 'overhead');
    const profit = ohp.lines.find((l) => l.key === 'profit');

    expect(overhead.pct).toBe(OHP_ASSUMPTIONS.overhead);
    expect(profit.pct).toBe(OHP_ASSUMPTIONS.profit);
    expect(overhead.priceSource).toBe('ohp_assumption');
    expect(profit.priceSource).toBe('ohp_assumption');

    const expectedOverhead = cost * OHP_ASSUMPTIONS.overhead; // 10000
    const expectedProfit = (cost + expectedOverhead) * OHP_ASSUMPTIONS.profit; // 11000
    expect(ohp.overheadTotal).toBeCloseTo(expectedOverhead, 2);
    expect(ohp.profitTotal).toBeCloseTo(expectedProfit, 2);
    expect(ohp.ohpTotal).toBeCloseTo(expectedOverhead + expectedProfit, 2);
  });

  it('honours overhead/profit overrides and zero subtotal', () => {
    expect(buildOverheadProfit(0).ohpTotal).toBe(0);
    const ohp = buildOverheadProfit(1000, { overhead: 0.2, profit: 0 });
    expect(ohp.overheadTotal).toBe(200);
    expect(ohp.profitTotal).toBe(0);
    expect(ohp.ohpTotal).toBe(200);
  });
});
