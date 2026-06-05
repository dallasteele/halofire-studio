import { describe, expect, it } from 'vitest';
import {
  HAZARD_RULES,
  getHazardRule,
  boundingBox,
  polygonArea,
  pointInPolygon,
  layoutRoom,
  routePiping,
  buildBillOfMaterials,
  priceBid,
  generateSprinklerBid,
} from '../src/engine/sprinkler-layout.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

describe('hazard rules + geometry helpers', () => {
  it('exposes NFPA standard-spray protection limits', () => {
    expect(HAZARD_RULES.light.maxAreaSqFt).toBe(225);
    expect(HAZARD_RULES.ordinary.maxAreaSqFt).toBe(130);
    expect(HAZARD_RULES.extra.maxSpacingFt).toBe(12);
    expect(() => getHazardRule('nonsense')).toThrow(/Unknown hazard/);
  });

  it('computes bounding box and area', () => {
    const bb = boundingBox(rect(60, 40));
    expect(bb).toMatchObject({ minX: 0, minY: 0, maxX: 60, maxY: 40, width: 60, height: 40 });
    expect(polygonArea(rect(60, 40))).toBe(2400);
  });

  it('detects points inside / outside a polygon', () => {
    expect(pointInPolygon([5, 5], rect(10, 10))).toBe(true);
    expect(pointInPolygon([15, 5], rect(10, 10))).toBe(false);
  });
});

describe('layoutRoom', () => {
  it('keeps spacing and coverage within hazard limits (light, 60x40)', () => {
    const layout = layoutRoom({ name: 'A', polygon: rect(60, 40), hazard: 'light' });
    expect(layout.gridCols).toBe(4);
    expect(layout.gridRows).toBe(3);
    expect(layout.heads).toHaveLength(12);
    expect(layout.spacingX).toBeLessThanOrEqual(HAZARD_RULES.light.maxSpacingFt);
    expect(layout.spacingY).toBeLessThanOrEqual(HAZARD_RULES.light.maxSpacingFt);
    expect(layout.coveragePerHeadSqFt).toBeLessThanOrEqual(HAZARD_RULES.light.maxAreaSqFt);
    // First head sits spacing/2 from the wall.
    expect(layout.heads[0].x).toBeCloseTo(layout.spacingX / 2, 1);
    expect(layout.heads[0].y).toBeCloseTo(layout.spacingY / 2, 1);
  });

  it('tightens the grid for ordinary hazard so coverage <= 130 (30x30)', () => {
    const layout = layoutRoom({ name: 'B', polygon: rect(30, 30), hazard: 'ordinary' });
    expect(layout.heads).toHaveLength(9);
    expect(layout.spacingX).toBe(10);
    expect(layout.spacingY).toBe(10);
    expect(layout.coveragePerHeadSqFt).toBe(100);
    expect(layout.coveragePerHeadSqFt).toBeLessThanOrEqual(130);
  });

  it('drops heads that fall outside a non-rectangular (L-shaped) room', () => {
    // L-shape: full grid bbox would be 40x40 but a 20x20 corner is cut out.
    const lshape = [[0, 0], [40, 0], [40, 20], [20, 20], [20, 40], [0, 40]];
    const layout = layoutRoom({ name: 'L', polygon: lshape, hazard: 'light' });
    const fullGrid = layout.gridCols * layout.gridRows;
    expect(layout.heads.length).toBeLessThan(fullGrid);
    expect(layout.heads.every((h) => pointInPolygon([h.x, h.y], lshape))).toBe(true);
  });
});

describe('routePiping + BOM', () => {
  it('routes branch lines per row plus a cross-main', () => {
    const layout = layoutRoom({ name: 'B', polygon: rect(30, 30), hazard: 'ordinary' });
    const piping = routePiping(layout);
    expect(piping.branchLines).toHaveLength(3);
    expect(piping.branchFt).toBe(90); // 3 rows * ((25-5)+10)
    expect(piping.crossMainFt).toBe(30);
    expect(piping.totalPipeFt).toBe(120);
  });

  it('builds a BOM whose head/escutcheon counts match the layout', () => {
    const layout = layoutRoom({ name: 'B', polygon: rect(30, 30), hazard: 'ordinary' });
    const piping = routePiping(layout);
    const bom = buildBillOfMaterials(layout, piping);
    const byKey = Object.fromEntries(bom.map((b) => [b.key, b.quantity]));
    expect(byKey.sprinkler_head).toBe(9);
    expect(byKey.escutcheon).toBe(9);
    expect(byKey.branch_pipe).toBe(120);
  });
});

describe('priceBid', () => {
  const bom = [
    { key: 'sprinkler_head', description: 'h', unit: 'EA', quantity: 9 },
    { key: 'branch_pipe', description: 'p', unit: 'FT', quantity: 120 },
  ];

  it('uses fallback costs and flags estimates when no pricebook resolves', () => {
    const r = priceBid(bom, { laborRatePerHead: 85, markupPct: 25 });
    expect(r.anyEstimated).toBe(true);
    expect(r.lines.every((l) => l.priceSource === 'fallback_estimate')).toBe(true);
    expect(r.laborCost).toBe(765); // 9 * 85
    expect(r.markup).toBeCloseTo(r.subtotal * 0.25, 1);
    expect(r.total).toBeCloseTo(r.subtotal + r.markup, 2);
  });

  it('uses resolved pricebook prices when available', () => {
    const r = priceBid(bom, { priceResolver: (k) => (k === 'sprinkler_head' ? 20 : 5) });
    const head = r.lines.find((l) => l.key === 'sprinkler_head');
    expect(head.unitCost).toBe(20);
    expect(head.priceSource).toBe('pricebook');
    expect(head.lineTotal).toBe(180);
  });
});

describe('generateSprinklerBid (full pipeline)', () => {
  const floorPlan = {
    name: 'Test Box',
    units: 'ft',
    rooms: [
      { name: 'Sales Floor', polygon: rect(60, 40), hazard: 'ordinary' },
      { name: 'Storage', polygon: rect(30, 30), hazard: 'extra' },
    ],
  };

  it('produces a priced bid with rooms, BOM, totals, and fail-closed claims', () => {
    const bid = generateSprinklerBid(floorPlan);
    expect(bid.rooms).toHaveLength(2);
    expect(bid.totalHeadCount).toBe(bid.rooms.reduce((s, r) => s + r.headCount, 0));
    expect(bid.totalAreaSqFt).toBe(2400 + 900);
    expect(bid.pricing.total).toBeGreaterThan(0);
    expect(bid.disclaimer).toMatch(/best-effort internal alpha/i);
    expect(bid.blockedClaims).toContain('AutoSprink parity');
    expect(bid.blockedClaims).toContain('AHJ-approved');
  });

  it('is fully deterministic (identical input -> identical output)', () => {
    const a = generateSprinklerBid(floorPlan);
    const b = generateSprinklerBid(floorPlan);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('rejects an empty floor plan', () => {
    expect(() => generateSprinklerBid({ name: 'x', rooms: [] })).toThrow(/non-empty/);
  });
});
