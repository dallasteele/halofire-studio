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
    for (const [key, band] of Object.entries(PRICE_BANDS)) {
      expect(band.min).toBeGreaterThan(0);
      expect(band.max).toBeGreaterThan(band.min);
      expect(band.max).toBeLessThanOrEqual(80); // no assembly-scale unit costs
    }
  });
});
