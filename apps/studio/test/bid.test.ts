import { describe, expect, it } from 'vitest';
import {
  BID_DISCLAIMER,
  buildBidEstimate,
  deriveDriversFromLayout,
  estimateFromLayout,
  LABOR_ASSUMPTIONS,
  OHP_ASSUMPTIONS,
  REPRESENTATIVE_UNIT_PRICES,
  type BidDrivers,
} from '../src/lib/bid';
import { layoutHeads } from '../src/lib/layout';

/* ------------------------------------------------ buildBidEstimate math */

describe('buildBidEstimate — hand-computed math', () => {
  // A clean 24-head case with explicit drivers, hand-computed below.
  const drivers: BidDrivers = {
    headCount: 24,
    branchPipeFt: 120,
    fittingCount: 20,
    hangerCount: 12,
    escutcheonCount: 24,
    riserValveCount: 1,
  };

  it('prices each material line from representative unit prices', () => {
    const bid = buildBidEstimate(drivers);
    const byKey = Object.fromEntries(bid.lineItems.map((l) => [l.key, l]));

    // 24 heads * $18 = $432
    expect(byKey.sprinkler_head.qty).toBe(24);
    expect(byKey.sprinkler_head.unitPrice).toBe(18);
    expect(byKey.sprinkler_head.extended).toBe(432);
    // 120 ft * $4.50 = $540
    expect(byKey.branch_pipe.extended).toBe(540);
    // 20 fittings * $6 = $120
    expect(byKey.fitting.extended).toBe(120);
    // 12 hangers * $3.50 = $42
    expect(byKey.hanger.extended).toBe(42);
    // 24 escutcheons * $1.25 = $30
    expect(byKey.escutcheon.extended).toBe(30);
    // 1 riser/valve assy * $1850 = $1850
    expect(byKey.riser_valve_assy.extended).toBe(1850);
  });

  it('line items sum exactly to materialTotal', () => {
    const bid = buildBidEstimate(drivers);
    const sum = bid.lineItems.reduce((a, l) => a + l.extended, 0);
    expect(Math.round(sum * 100) / 100).toBe(bid.materialTotal);
    // 432 + 540 + 120 + 42 + 30 + 1850 = 3014
    expect(bid.materialTotal).toBe(3014);
  });

  it('labor uses 0.8/0.05/0.3 hr assumptions at $90/hr', () => {
    const bid = buildBidEstimate(drivers);
    // 24*0.8 + 120*0.05 + 20*0.3 = 19.2 + 6 + 6 = 31.2 hrs
    expect(bid.laborHours).toBe(31.2);
    // 31.2 * 90 = 2808
    expect(bid.laborCost).toBe(2808);
  });

  it('subtotal = materialTotal + laborCost', () => {
    const bid = buildBidEstimate(drivers);
    // 3014 + 2808 = 5822
    expect(bid.subtotal).toBe(5822);
  });

  it('OH&P is exactly 10% overhead then 10% profit on (subtotal + overhead)', () => {
    const bid = buildBidEstimate(drivers);
    // overhead = 5822 * 0.10 = 582.2
    expect(bid.overhead).toBe(582.2);
    // profit = (5822 + 582.2) * 0.10 = 640.42
    expect(bid.profit).toBe(640.42);
    // total = 5822 + 582.2 + 640.42 = 7044.62
    expect(bid.total).toBe(7044.62);
  });

  it('total = subtotal + overhead + profit (self-consistent)', () => {
    const bid = buildBidEstimate(drivers);
    expect(Math.round((bid.subtotal + bid.overhead + bid.profit) * 100) / 100).toBe(
      bid.total,
    );
  });

  it('is deterministic — identical inputs yield identical output', () => {
    const a = buildBidEstimate(drivers);
    const b = buildBidEstimate(drivers);
    expect(a).toStrictEqual(b);
  });

  it('carries the honest estimate flag + disclaimer', () => {
    const bid = buildBidEstimate(drivers);
    expect(bid.estimate).toBe(true);
    expect(bid.disclaimer).toBe(BID_DISCLAIMER);
    expect(bid.disclaimer).toMatch(/NOT a quote/i);
    expect(bid.disclaimer).toMatch(/NOT a committed bid/i);
    expect(bid.disclaimer).toMatch(/AHJ/);
    expect(bid.disclaimer).toMatch(/licensed estimator/i);
  });
});

/* ----------------------------------------------- assumption constants pinned */

describe('bid assumptions match the proven autosprink values', () => {
  it('LABOR_ASSUMPTIONS port the autosprink figures', () => {
    expect(LABOR_ASSUMPTIONS.hoursPerHead).toBe(0.8);
    expect(LABOR_ASSUMPTIONS.hoursPerPipeFt).toBe(0.05);
    expect(LABOR_ASSUMPTIONS.hoursPerFitting).toBe(0.3);
    expect(LABOR_ASSUMPTIONS.laborRatePerHour).toBe(90);
  });

  it('OHP_ASSUMPTIONS are 10% + 10%', () => {
    expect(OHP_ASSUMPTIONS.overhead).toBe(0.1);
    expect(OHP_ASSUMPTIONS.profit).toBe(0.1);
  });

  it('representative prices sit inside the autosprink PRICE_BANDS', () => {
    // Sanity: each representative price is a positive number within its band.
    expect(REPRESENTATIVE_UNIT_PRICES.sprinkler_head).toBeGreaterThanOrEqual(5);
    expect(REPRESENTATIVE_UNIT_PRICES.sprinkler_head).toBeLessThanOrEqual(80);
    expect(REPRESENTATIVE_UNIT_PRICES.branch_pipe).toBeGreaterThanOrEqual(0.5);
    expect(REPRESENTATIVE_UNIT_PRICES.branch_pipe).toBeLessThanOrEqual(20);
    expect(REPRESENTATIVE_UNIT_PRICES.fitting).toBeGreaterThanOrEqual(0.5);
    expect(REPRESENTATIVE_UNIT_PRICES.fitting).toBeLessThanOrEqual(30);
    expect(REPRESENTATIVE_UNIT_PRICES.hanger).toBeGreaterThanOrEqual(0.3);
    expect(REPRESENTATIVE_UNIT_PRICES.hanger).toBeLessThanOrEqual(15);
    expect(REPRESENTATIVE_UNIT_PRICES.escutcheon).toBeGreaterThanOrEqual(0.2);
    expect(REPRESENTATIVE_UNIT_PRICES.escutcheon).toBeLessThanOrEqual(12);
  });
});

/* --------------------------------------------- estimateFromLayout (40x60) */

describe('estimateFromLayout — 40x60 ordinary room', () => {
  const input = { widthFt: 40, lengthFt: 60, hazard: 'ordinary' as const };

  it('derives a 24-head 4x6 grid with the documented drivers', () => {
    const layout = layoutHeads(input);
    // ordinary coverage cap (130) => sqrt ~= 11.40 binds tighter than 15ft.
    // 40/11.40 -> ceil 4 cols; 60/11.40 -> ceil 6 rows; spacing 10ft.
    expect(layout.cols).toBe(4);
    expect(layout.rows).toBe(6);
    expect(layout.spacingFt).toBe(10);
    expect(layout.count).toBe(24);

    const drivers = deriveDriversFromLayout(layout);
    expect(drivers.headCount).toBe(24);
    // branch run/row = (4-1)*10 = 30; *6 rows = 180; cross-main = (6-1)*10 = 50.
    // branchPipeFt = 180 + 50 = 230
    expect(drivers.branchPipeFt).toBe(230);
    // fittings = 24 heads + 6 branch taps + 4 riser allowance = 34
    expect(drivers.fittingCount).toBe(34);
    // hangers = ceil(230/10) = 23
    expect(drivers.hangerCount).toBe(23);
    expect(drivers.escutcheonCount).toBe(24);
    expect(drivers.riserValveCount).toBe(1);
  });

  it('yields a stable, hand-checked total', () => {
    const bid = estimateFromLayout(input);

    // Materials:
    //   head    24 * 18    = 432
    //   pipe    230 * 4.5  = 1035
    //   fitting 34 * 6     = 204
    //   hanger  23 * 3.5   = 80.5
    //   escutch 24 * 1.25  = 30
    //   riser   1 * 1850   = 1850
    //   materialTotal      = 3631.5
    expect(bid.materialTotal).toBe(3631.5);

    // Labor: 24*0.8 + 230*0.05 + 34*0.3 = 19.2 + 11.5 + 10.2 = 40.9 hrs
    expect(bid.laborHours).toBe(40.9);
    // 40.9 * 90 = 3681
    expect(bid.laborCost).toBe(3681);

    // subtotal = 3631.5 + 3681 = 7312.5
    expect(bid.subtotal).toBe(7312.5);
    // overhead = 7312.5 * 0.10 = 731.25
    expect(bid.overhead).toBe(731.25);
    // profit = (7312.5 + 731.25) * 0.10 = 804.375 -> 804.38 (rounded to cents)
    expect(bid.profit).toBe(804.38);
    // total = 7312.5 + 731.25 + 804.38 = 8848.13
    expect(bid.total).toBe(8848.13);
  });

  it('line items sum to materialTotal for the layout-derived estimate', () => {
    const bid = estimateFromLayout(input);
    const sum = bid.lineItems.reduce((a, l) => a + l.extended, 0);
    expect(Math.round(sum * 100) / 100).toBe(bid.materialTotal);
  });

  it('is deterministic across calls', () => {
    expect(estimateFromLayout(input)).toStrictEqual(estimateFromLayout(input));
  });
});

/* ------------------------------------------------------------ option overrides */

describe('buildBidEstimate — overridable knobs', () => {
  it('honours unit-price + assumption overrides deterministically', () => {
    const drivers: BidDrivers = {
      headCount: 10,
      branchPipeFt: 0,
      fittingCount: 0,
      hangerCount: 0,
      escutcheonCount: 0,
      riserValveCount: 0,
    };
    const bid = buildBidEstimate(drivers, {
      unitPrices: { sprinkler_head: 20 },
      hoursPerHead: 1,
      laborRatePerHour: 100,
      overhead: 0,
      profit: 0,
    });
    // material: 10 * 20 = 200
    expect(bid.materialTotal).toBe(200);
    // labor: 10 * 1 * 100 = 1000
    expect(bid.laborCost).toBe(1000);
    // no OH&P
    expect(bid.overhead).toBe(0);
    expect(bid.profit).toBe(0);
    expect(bid.total).toBe(1200);
  });
});
