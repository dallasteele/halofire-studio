import { describe, expect, it } from 'vitest';
import { median, resolvePriceFromRows, PRICE_BANDS } from '../src/engine/pricebook-pricing.js';

describe('median', () => {
  it('returns the lower-middle element deterministically', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2);
    expect(median([])).toBeNull();
  });
});

describe('resolvePriceFromRows', () => {
  const rows = [
    { item: 'ARGCO Fire Sprinkler Head Guard One Piece', price: 0.99 }, // matches no head keyword, out of intent
    { item: 'Pendent Sprinkler 1/2" Brass', price: 12 },
    { item: 'Pendent Sprinkler 3/4" Chrome', price: 18 },
    { item: 'Upright Sprinkler QR', price: 22 },
    { item: 'Specialty Pendent Concealed Assembly', price: 266 }, // out of band -> ignored
    { item: 'Sch 40 Black Pipe 1"', price: 4.5 },
    { item: 'Mechanical Tee 2"', price: 14 },
    { item: 'Grooved Coupling Assembly Large', price: 8654 }, // out of band -> ignored
    { item: 'Pipe Hanger Adjustable', price: 1.9 },
    { item: 'Escutcheon Chrome', price: 3 },
  ];

  it('resolves a representative in-band sprinkler head price', () => {
    const p = resolvePriceFromRows(rows, 'sprinkler_head');
    // in-band matches: 12, 18, 22 -> median 18
    expect(p).toBe(18);
  });

  it('ignores out-of-band assemblies for fittings', () => {
    const p = resolvePriceFromRows(rows, 'fitting');
    // only the $14 mechanical tee is in band; the $8654 coupling is excluded
    expect(p).toBe(14);
  });

  it('resolves hanger and escutcheon to realistic small prices', () => {
    expect(resolvePriceFromRows(rows, 'hanger')).toBe(1.9);
    expect(resolvePriceFromRows(rows, 'escutcheon')).toBe(3);
  });

  it('returns null for an unknown key or no matches', () => {
    expect(resolvePriceFromRows(rows, 'nonexistent_key')).toBeNull();
    expect(resolvePriceFromRows([{ item: 'random widget', price: 5 }], 'sprinkler_head')).toBeNull();
  });

  it('keeps every band within a sane unit-cost window', () => {
    // The original small-component bands stay capped at small-component scale.
    const SMALL_COMPONENT_KEYS = ['sprinkler_head', 'branch_pipe', 'fitting', 'hanger', 'escutcheon'];
    for (const key of SMALL_COMPONENT_KEYS) {
      const band = PRICE_BANDS[key];
      expect(band.min).toBeGreaterThan(0);
      expect(band.max).toBeGreaterThan(band.min);
      expect(band.max).toBeLessThanOrEqual(80); // no assembly-scale unit costs
    }
    // ALL bands (including the larger ESFR size classes) stay positive + ordered.
    for (const [, band] of Object.entries(PRICE_BANDS)) {
      expect(band.min).toBeGreaterThan(0);
      expect(band.max).toBeGreaterThan(band.min);
    }
  });
});

// T25: larger ESFR/storage size-class bands resolve REAL pricebook medians.
// The band itself is the size-class proxy (larger pipe -> higher $/ft window);
// the resolved price is still a real in-band median, not an inflated constant.
describe('ESFR/storage size-class price bands (T25)', () => {
  // Representative rows spanning the size classes (small spray pipe up to
  // underground ductile). Each new band must pick a real in-band median.
  const rows = [
    // ESFR heads (real heads cost more than basic spray)
    { item: 'ESFR Pendent Sprinkler K25.2', price: 42 },
    { item: 'ESFR Upright Sprinkler K14', price: 38 },
    { item: 'Pendent Sprinkler Storage', price: 60 },
    // small branch pipe (below cross-main band)
    { item: 'Sch 40 Black Steel Pipe 1"', price: 2.5 }, // below cross_main min(3)
    // cross main (3"-class)
    { item: 'Sch 40 Black Pipe 3"', price: 10.92 },
    { item: 'Sch 10 Steel Pipe 3"', price: 9 },
    // feed main (6"-class)
    { item: 'Sch 40 Black Pipe 6"', price: 21.56 },
    { item: 'Sch 10 Steel Pipe 6"', price: 18 },
    // bulk main (larger riser-class)
    { item: 'Sch 40 Black Pipe 8"', price: 27.02 },
    // underground ductile
    { item: 'Ductile Iron Underground Pipe 8"', price: 30.17 },
    { item: 'C900 Underground Pipe 8"', price: 25 },
    // out-of-band assembly that must be excluded everywhere
    { item: 'Grooved Coupling Assembly Large', price: 8654 },
  ];

  it('resolves a real non-null median for every new band', () => {
    for (const key of ['esfr_head', 'cross_main_pipe', 'feed_main_pipe', 'bulk_main_pipe', 'underground_main']) {
      const p = resolvePriceFromRows(rows, key);
      expect(p).not.toBeNull();
      expect(p).toBeGreaterThan(0);
    }
  });

  it('larger size-class bands yield >= smaller size-class medians (monotonicity)', () => {
    const cross = resolvePriceFromRows(rows, 'cross_main_pipe');
    const feed = resolvePriceFromRows(rows, 'feed_main_pipe');
    const bulk = resolvePriceFromRows(rows, 'bulk_main_pipe');
    expect(feed).toBeGreaterThanOrEqual(cross);
    expect(bulk).toBeGreaterThanOrEqual(feed);
  });

  it('esfr_head band resolves a higher head price than the basic spray band', () => {
    const esfr = resolvePriceFromRows(rows, 'esfr_head');
    const spray = resolvePriceFromRows(rows, 'sprinkler_head');
    // spray band [5,80] also matches the ESFR pendent rows here, but the ESFR
    // band excludes the cheap-spray floor (min 15) so its median is >= spray.
    expect(esfr).toBeGreaterThanOrEqual(spray ?? 0);
  });
});
