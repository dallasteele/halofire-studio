import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BID_DISCLAIMER,
  buildBidEstimate,
  deriveDriversFromLayout,
  deriveFullDriversFromLayout,
  estimateFromLayout,
  estimateFullFromLayout,
  LABOR_ASSUMPTIONS,
  loadPricebook,
  OHP_ASSUMPTIONS,
  parsePricebook,
  REPRESENTATIVE_UNIT_PRICES,
  resolvePriceTable,
  type BidDrivers,
  type PricebookMedians,
} from '../src/lib/bid';
import { layoutHeads } from '../src/lib/layout';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEDIANS_PATH = resolvePath(__dirname, '../public/parts/pricebook-medians.json');

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

/* ------------------------------------------------ price source on line items */

describe('priceSource — every line item is honest about its source', () => {
  const drivers: BidDrivers = {
    headCount: 10,
    branchPipeFt: 50,
    fittingCount: 5,
    hangerCount: 5,
  };

  it('defaults (no price table) -> representative-fallback / representative-only', () => {
    const bid = buildBidEstimate(drivers);
    const byKey = Object.fromEntries(bid.lineItems.map((l) => [l.key, l]));
    // pricebook-backed keys are representative-FALLBACK (no real medians supplied)
    expect(byKey.sprinkler_head.priceSource).toBe('representative-fallback');
    expect(byKey.branch_pipe.priceSource).toBe('representative-fallback');
    // riser/valve has no pricebook band -> always representative-only
    expect(byKey.riser_valve_assy.priceSource).toBe('representative-only');
    // overall provenance is representative-fallback
    expect(bid.priceSource).toBe('representative-fallback');
    expect(bid.pricebookRowCount).toBe(0);
    // every line carries a priceSource
    for (const li of bid.lineItems) {
      expect(typeof li.priceSource).toBe('string');
      expect(li.priceSource.length).toBeGreaterThan(0);
    }
  });

  it('with a real-median price table -> pricebook-median lines + matchedRows', () => {
    const book: PricebookMedians = {
      generatedAt: '2026-01-01T00:00:00.000Z',
      sourceRowCount: 7208,
      currency: 'USD',
      medians: {
        sprinkler_head: { unitPrice: 42, unit: 'EA', matchedRows: 24, band: [5, 80] },
        branch_pipe: { unitPrice: 2.44, unit: 'FT', matchedRows: 380, band: [0.5, 20] },
        fitting: { unitPrice: 6.66, unit: 'EA', matchedRows: 1134, band: [0.5, 30] },
        hanger: { unitPrice: 1.8, unit: 'EA', matchedRows: 77, band: [0.3, 15] },
        escutcheon: { unitPrice: 2.6, unit: 'EA', matchedRows: 164, band: [0.2, 12] },
      },
    };
    const table = resolvePriceTable(book);
    expect(table.kind).toBe('pricebook');

    const bid = buildBidEstimate(drivers, { priceTable: table });
    const byKey = Object.fromEntries(bid.lineItems.map((l) => [l.key, l]));

    // head: real median $42, 24 rows
    expect(byKey.sprinkler_head.unitPrice).toBe(42);
    expect(byKey.sprinkler_head.priceSource).toBe('pricebook-median');
    expect(byKey.sprinkler_head.matchedRows).toBe(24);
    // branch pipe: real median $2.44, 380 rows
    expect(byKey.branch_pipe.unitPrice).toBe(2.44);
    expect(byKey.branch_pipe.priceSource).toBe('pricebook-median');
    expect(byKey.branch_pipe.matchedRows).toBe(380);
    // 10 heads * 42 = 420 ; 50 ft * 2.44 = 122 ; 5 fit * 6.66 = 33.3 ;
    // 5 hangers * 1.8 = 9 ; 10 escutcheon * 2.6 = 26 ; 1 riser * 1850 = 1850
    // materialTotal = 420 + 122 + 33.3 + 9 + 26 + 1850 = 2460.3
    expect(byKey.fitting.extended).toBe(33.3);
    expect(bid.materialTotal).toBe(2460.3);

    // riser stays representative-only even under a pricebook table
    expect(byKey.riser_valve_assy.priceSource).toBe('representative-only');

    // overall provenance flips to pricebook-median with the real row count
    expect(bid.priceSource).toBe('pricebook-median');
    expect(bid.pricebookRowCount).toBe(7208);
  });

  it('a key missing from the book falls back per-line to representative', () => {
    const book: PricebookMedians = {
      generatedAt: '',
      sourceRowCount: 7208,
      currency: 'USD',
      // only sprinkler_head present; branch_pipe etc. absent
      medians: { sprinkler_head: { unitPrice: 42, unit: 'EA', matchedRows: 24, band: [5, 80] } },
    };
    const bid = buildBidEstimate(drivers, { priceTable: resolvePriceTable(book) });
    const byKey = Object.fromEntries(bid.lineItems.map((l) => [l.key, l]));
    expect(byKey.sprinkler_head.priceSource).toBe('pricebook-median');
    // branch_pipe had no median -> representative-fallback at the rep price
    expect(byKey.branch_pipe.priceSource).toBe('representative-fallback');
    expect(byKey.branch_pipe.unitPrice).toBe(REPRESENTATIVE_UNIT_PRICES.branch_pipe);
  });

  it('is deterministic with a supplied price table', () => {
    const table = resolvePriceTable({
      generatedAt: '',
      sourceRowCount: 100,
      currency: 'USD',
      medians: { sprinkler_head: { unitPrice: 40, unit: 'EA', matchedRows: 10, band: [5, 80] } },
    });
    const a = buildBidEstimate(drivers, { priceTable: table });
    const b = buildBidEstimate(drivers, { priceTable: table });
    expect(a).toStrictEqual(b);
  });
});

/* ------------------------------------------------ loadPricebook / parsePricebook */

describe('loadPricebook / parsePricebook — parse the medians JSON', () => {
  const validJson = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    sourceRowCount: 7208,
    currency: 'USD',
    medians: {
      sprinkler_head: { unitPrice: 42, unit: 'EA', matchedRows: 24, band: [5, 80] },
      branch_pipe: { unitPrice: 2.44, unit: 'FT', matchedRows: 380, band: [0.5, 20] },
    },
  };

  it('parsePricebook accepts a valid document', () => {
    const book = parsePricebook(validJson);
    expect(book).not.toBeNull();
    expect(book?.sourceRowCount).toBe(7208);
    expect(book?.medians.sprinkler_head?.unitPrice).toBe(42);
  });

  it('parsePricebook rejects malformed / empty docs', () => {
    expect(parsePricebook(null)).toBeNull();
    expect(parsePricebook({})).toBeNull();
    expect(parsePricebook({ medians: {} })).toBeNull();
    expect(parsePricebook({ medians: { x: { unitPrice: 0 } } })).toBeNull();
  });

  it('loadPricebook returns null with no fetch (honest fallback)', async () => {
    expect(await loadPricebook(undefined)).toBeNull();
  });

  it('loadPricebook parses a 200 response', async () => {
    const fakeFetch = (async () =>
      ({ ok: true, json: async () => validJson }) as unknown as Response) as typeof fetch;
    const book = await loadPricebook(fakeFetch);
    expect(book?.medians.branch_pipe?.unitPrice).toBe(2.44);
  });

  it('loadPricebook returns null on non-2xx / throw (fail-soft)', async () => {
    const notOk = (async () => ({ ok: false }) as unknown as Response) as typeof fetch;
    expect(await loadPricebook(notOk)).toBeNull();
    const throwing = (async () => {
      throw new Error('network');
    }) as typeof fetch;
    expect(await loadPricebook(throwing)).toBeNull();
  });

  it('resolvePriceTable(null) is the representative fallback table', () => {
    const table = resolvePriceTable(null);
    expect(table.kind).toBe('representative');
    expect(table.sourceRowCount).toBe(0);
    expect(table.prices.sprinkler_head).toBe(REPRESENTATIVE_UNIT_PRICES.sprinkler_head);
  });
});

/* ------------------------------------------ shipped REAL pricebook-medians.json */

describe('shipped pricebook-medians.json — proves REAL data shipped', () => {
  const raw = JSON.parse(readFileSync(MEDIANS_PATH, 'utf8')) as unknown;
  const book = parsePricebook(raw);

  it('parses + has sourceRowCount > 1000 (real imported pricebook)', () => {
    expect(book).not.toBeNull();
    expect(book!.sourceRowCount).toBeGreaterThan(1000);
  });

  it('has a positive unit price for sprinkler_head + branch_pipe (real medians)', () => {
    expect(book!.medians.sprinkler_head?.unitPrice).toBeGreaterThan(0);
    expect(book!.medians.branch_pipe?.unitPrice).toBeGreaterThan(0);
    // each backed by real matched rows
    expect(book!.medians.sprinkler_head?.matchedRows).toBeGreaterThan(0);
    expect(book!.medians.branch_pipe?.matchedRows).toBeGreaterThan(0);
  });

  it('prices a layout against the shipped real medians end-to-end', () => {
    const table = resolvePriceTable(book);
    expect(table.kind).toBe('pricebook');
    const bid = estimateFullFromLayout(
      { widthFt: 40, lengthFt: 60, hazard: 'ordinary' as const },
      { priceTable: table },
    );
    expect(bid.priceSource).toBe('pricebook-median');
    expect(bid.pricebookRowCount).toBeGreaterThan(1000);
    expect(bid.total).toBeGreaterThan(0);
    // deterministic
    expect(estimateFullFromLayout(
      { widthFt: 40, lengthFt: 60, hazard: 'ordinary' as const },
      { priceTable: table },
    )).toStrictEqual(bid);
  });
});

/* -------------------------------------------- deriveFullDriversFromLayout split */

describe('deriveFullDriversFromLayout — fuller split takeoff', () => {
  it('splits branch + cross-main and adds drops per head (40x60)', () => {
    const layout = layoutHeads({ widthFt: 40, lengthFt: 60, hazard: 'ordinary' as const });
    const full = deriveFullDriversFromLayout(layout);
    // branch run/row = (4-1)*10 = 30; *6 rows = 180
    expect(full.branchPipeFt).toBe(180);
    // cross-main = (6-1)*10 = 50
    expect(full.crossMainFt).toBe(50);
    // legacy combined = 230 (back-compat figure)
    const legacy = deriveDriversFromLayout(layout);
    expect(legacy.branchPipeFt).toBe(full.branchPipeFt! + full.crossMainFt!);
    // one drop per head
    expect(full.dropCount).toBe(24);
    // hangers over the combined pipe: ceil(230/10) = 23
    expect(full.hangerCount).toBe(23);
  });

  it('full takeoff emits a cross-main + drop line when priced', () => {
    const bid = estimateFullFromLayout({ widthFt: 40, lengthFt: 60, hazard: 'ordinary' as const });
    const keys = bid.lineItems.map((l) => l.key);
    expect(keys).toContain('cross_main_pipe');
    expect(keys).toContain('drop_armover');
  });
});
