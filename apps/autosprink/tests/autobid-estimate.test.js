import { describe, expect, it } from 'vitest';
import {
  buildEstimateFromBody,
  lineItemsFromManual,
  lineItemsFromCadPayload,
  assembleEstimate,
  bomKeyForCadItem,
  isCadPayload,
  ESTIMATE_DISCLAIMER,
} from '../src/autobid/estimate.js';

// AB3 — pure estimate-assembly module. No DB; the priceResolver is a stub.
const noResolver = () => null;
const fixedResolver = (key) => ({ sprinkler_head: 11, branch_pipe: 4, fitting: 3 }[key] ?? null);

describe('bomKeyForCadItem', () => {
  it('maps heads, pipe, and fittings from sku/description', () => {
    expect(bomKeyForCadItem({ sku: 'head:0.5:brass', description: 'Pendent head' })).toBe('sprinkler_head');
    expect(bomKeyForCadItem({ sku: 'pipe:2:steel', description: 'Branch pipe Sch 40' })).toBe('branch_pipe');
    expect(bomKeyForCadItem({ sku: 'fitting:2:steel', description: 'Tee fitting' })).toBe('fitting');
  });
  it('returns null for an unmappable line', () => {
    expect(bomKeyForCadItem({ sku: 'mystery:na:na', description: 'Unknown widget' })).toBeNull();
  });
});

describe('isCadPayload', () => {
  it('detects the CAD W5C payload shape', () => {
    expect(isCadPayload({ source: 'halofire-cad', items: [] })).toBe(true);
    expect(isCadPayload({ items: [] })).toBe(false);
    expect(isCadPayload(null)).toBe(false);
  });
});

describe('lineItemsFromManual', () => {
  it('uses an explicit manual unitCost (priceSource manual)', () => {
    const li = lineItemsFromManual([{ description: 'Head', quantity: 10, unit: 'ea', unitCost: 12.5 }], noResolver);
    expect(li[0]).toMatchObject({ unitCost: 12.5, extendedCost: 125, priceSource: 'manual' });
  });
  it('prices by bomKey when no manual unitCost is given', () => {
    const li = lineItemsFromManual([{ description: 'Head', quantity: 4, unit: 'ea', bomKey: 'sprinkler_head' }], fixedResolver);
    expect(li[0]).toMatchObject({ unitCost: 11, extendedCost: 44, priceSource: 'pricebook-median' });
  });
  it('falls back to a labelled representative cost when the resolver returns null', () => {
    const li = lineItemsFromManual([{ description: 'Head', quantity: 2, unit: 'ea', bomKey: 'sprinkler_head' }], noResolver);
    expect(li[0].priceSource).toBe('representative-fallback');
    expect(li[0].unitCost).toBeGreaterThan(0);
  });
  it('throws on a negative manual unitCost', () => {
    expect(() => lineItemsFromManual([{ description: 'x', quantity: 1, unit: 'ea', unitCost: -1 }], noResolver)).toThrow(/unitCost/);
  });
  it('throws on an empty items array', () => {
    expect(() => lineItemsFromManual([], noResolver)).toThrow(/non-empty/);
  });
});

describe('lineItemsFromCadPayload', () => {
  it('prices each CAD item and records a price source', () => {
    const li = lineItemsFromCadPayload({
      items: [
        { sku: 'head:0.5:brass', description: 'Head', quantity: 10, unit: 'ea' },
        { sku: 'pipe:2:steel', description: 'Pipe', quantity: 100, unit: 'ft' },
        { sku: 'mystery:na:na', description: 'Widget', quantity: 1, unit: 'ea' },
      ],
    }, fixedResolver);
    expect(li[0]).toMatchObject({ unitCost: 11, priceSource: 'pricebook-median', bomKey: 'sprinkler_head' });
    expect(li[1]).toMatchObject({ unitCost: 4, priceSource: 'pricebook-median', bomKey: 'branch_pipe' });
    expect(li[2]).toMatchObject({ unitCost: 0, priceSource: 'unpriced', bomKey: null });
  });
});

describe('assembleEstimate', () => {
  it('computes subtotal and compounded OH&P total + carries the disclaimer', () => {
    const li = [{ description: 'x', quantity: 1, unit: 'ea', unitCost: 100, extendedCost: 100, priceSource: 'manual' }];
    const est = assembleEstimate(li, { overheadPct: 10, profitPct: 10, source: 'manual' });
    expect(est.subtotal).toBe(100);
    expect(est.total).toBe(121); // 100 * 1.1 * 1.1
    expect(est.disclaimer).toBe(ESTIMATE_DISCLAIMER);
    expect(est.anyEstimated).toBe(false);
  });
  it('flags anyEstimated when a line is a fallback/unpriced', () => {
    const li = [{ description: 'x', quantity: 1, unit: 'ea', unitCost: 5, extendedCost: 5, priceSource: 'representative-fallback' }];
    expect(assembleEstimate(li).anyEstimated).toBe(true);
  });
});

describe('buildEstimateFromBody', () => {
  it('routes a CAD payload to the CAD path', () => {
    const est = buildEstimateFromBody({
      source: 'halofire-cad',
      items: [{ sku: 'head:0.5:brass', description: 'Head', quantity: 10, unit: 'ea' }],
    }, fixedResolver);
    expect(est.source).toBe('halofire-cad');
    expect(est.lineItems).toHaveLength(1);
  });
  it('routes a manual body to the manual path', () => {
    const est = buildEstimateFromBody({
      items: [{ description: 'Head', quantity: 10, unit: 'ea', unitCost: 12.5 }],
    }, fixedResolver);
    expect(est.source).toBe('manual');
    expect(est.total).toBe(151.25); // 125 * 1.1 * 1.1
  });
  it('throws on a body that is neither CAD nor a manual items array', () => {
    expect(() => buildEstimateFromBody({}, fixedResolver)).toThrow(/CAD bid-payload|items/);
  });
});
