import { describe, expect, it } from 'vitest';
import {
  parsePolygonPoints,
  parseSimplePath,
  floorPlanFromSvg,
  floorPlanFromDxf,
  normalizeFloorPlan,
} from '../src/engine/floorplan-import.js';
import { generateSprinklerBid } from '../src/engine/sprinkler-layout.js';

/** Build a minimal DXF with a single ENTITIES section from entity blocks. */
function dxf(...entityBlocks) {
  return [
    '0', 'SECTION',
    '2', 'ENTITIES',
    ...entityBlocks,
    '0', 'ENDSEC',
    '0', 'EOF',
  ].join('\n');
}

/** LWPOLYLINE entity from [[x,y],...] vertices; closed flag default true. */
function lwpolyline(verts, { layer = 'PLAN', closed = true } = {}) {
  const out = ['0', 'LWPOLYLINE', '8', layer, '90', String(verts.length), '70', closed ? '1' : '0'];
  for (const [x, y] of verts) out.push('10', String(x), '20', String(y));
  return out;
}

/** A LINE entity between two points on a layer. */
function line([x1, y1], [x2, y2], layer = 'PLAN') {
  return ['0', 'LINE', '8', layer, '10', String(x1), '20', String(y1), '11', String(x2), '21', String(y2)];
}

describe('point + path parsing', () => {
  it('parses polygon points in comma and space form', () => {
    expect(parsePolygonPoints('0,0 10,0 10,5 0,5')).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
    expect(parsePolygonPoints('0 0 10 0 10 5')).toEqual([[0, 0], [10, 0], [10, 5]]);
  });

  it('parses an absolute M/L/Z path', () => {
    expect(parseSimplePath('M 0 0 L 10 0 L 10 5 L 0 5 Z')).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
  });

  it('parses relative m/l path commands', () => {
    expect(parseSimplePath('m 0 0 l 10 0 l 0 5')).toEqual([[0, 0], [10, 0], [10, 5]]);
  });
});

describe('floorPlanFromSvg', () => {
  it('extracts a rect as a room and scales px->ft', () => {
    const svg = '<svg><rect x="0" y="0" width="30" height="20" data-name="Bay" data-hazard="extra"/></svg>';
    const plan = floorPlanFromSvg(svg, { unitsPerPx: 2 });
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0].name).toBe('Bay');
    expect(plan.rooms[0].hazard).toBe('extra');
    // scaled by 2: 30x20 px -> 60x40 ft
    expect(plan.rooms[0].polygon).toEqual([[0, 0], [60, 0], [60, 40], [0, 40]]);
  });

  it('extracts multiple primitives (rect + polygon)', () => {
    const svg = `<svg>
      <rect x="0" y="0" width="20" height="10"/>
      <polygon points="0,0 40,0 40,20 20,20 20,40 0,40" data-name="L-room"/>
    </svg>`;
    const plan = floorPlanFromSvg(svg);
    expect(plan.rooms).toHaveLength(2);
    expect(plan.rooms[1].name).toBe('L-room');
  });

  it('feeds straight into the layout engine', () => {
    const svg = '<svg><rect x="0" y="0" width="60" height="40" data-hazard="light"/></svg>';
    const plan = floorPlanFromSvg(svg);
    const bid = generateSprinklerBid(plan);
    expect(bid.totalAreaSqFt).toBe(2400);
    expect(bid.totalHeadCount).toBeGreaterThan(0);
    expect(bid.blockedClaims).toContain('AutoSprink parity');
  });

  it('throws when no usable shapes are present', () => {
    expect(() => floorPlanFromSvg('<svg><circle r="5"/></svg>')).toThrow(/No <rect>/);
  });
});

describe('floorPlanFromDxf', () => {
  it('extracts a closed LWPOLYLINE rectangle as a room', () => {
    const text = dxf(...lwpolyline([[0, 0], [40, 0], [40, 30], [0, 30]]));
    const plan = floorPlanFromDxf(text);
    expect(plan.units).toBe('ft');
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0].polygon).toEqual([[0, 0], [40, 0], [40, 30], [0, 30]]);
    expect(plan.rooms[0].hazard).toBe('ordinary');
  });

  it('extracts an L-shaped LWPOLYLINE', () => {
    const verts = [[0, 0], [40, 0], [40, 20], [20, 20], [20, 40], [0, 40]];
    const plan = floorPlanFromDxf(dxf(...lwpolyline(verts)), { hazard: 'extra' });
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0].polygon).toEqual(verts);
    expect(plan.rooms[0].hazard).toBe('extra');
  });

  it('scales drawing units to feet via unitsPerDrawingUnit', () => {
    // inches -> feet
    const text = dxf(...lwpolyline([[0, 0], [120, 0], [120, 240]]));
    const plan = floorPlanFromDxf(text, { unitsPerDrawingUnit: 1 / 12 });
    expect(plan.rooms[0].polygon).toEqual([[0, 0], [10, 0], [10, 20]]);
  });

  it('filters entities by layer', () => {
    const text = dxf(
      ...lwpolyline([[0, 0], [10, 0], [10, 10]], { layer: 'PLAN' }),
      ...lwpolyline([[0, 0], [5, 0], [5, 5]], { layer: 'NOTES' }),
    );
    const plan = floorPlanFromDxf(text, { layer: 'PLAN' });
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0].polygon).toEqual([[0, 0], [10, 0], [10, 10]]);
  });

  it('assembles a closed loop from LINE entities', () => {
    const text = dxf(
      ...line([0, 0], [30, 0]),
      ...line([30, 0], [30, 20]),
      ...line([30, 20], [0, 20]),
      ...line([0, 20], [0, 0]),
    );
    const plan = floorPlanFromDxf(text);
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0].polygon).toEqual([[0, 0], [30, 0], [30, 20], [0, 20]]);
  });

  it('skips degenerate (<3 vertex) shapes', () => {
    const text = dxf(...lwpolyline([[0, 0], [10, 10]]), ...lwpolyline([[0, 0], [40, 0], [40, 30], [0, 30]]));
    const plan = floorPlanFromDxf(text);
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0].polygon).toEqual([[0, 0], [40, 0], [40, 30], [0, 30]]);
  });

  it('throws when no usable entities are present', () => {
    expect(() => floorPlanFromDxf(dxf())).toThrow(/No .*entit/i);
  });

  it('feeds straight into the layout engine', () => {
    const text = dxf(...lwpolyline([[0, 0], [60, 0], [60, 40], [0, 40]]));
    const plan = floorPlanFromDxf(text, { hazard: 'light' });
    const bid = generateSprinklerBid(plan);
    expect(bid.totalAreaSqFt).toBe(2400);
    expect(bid.totalHeadCount).toBeGreaterThan(0);
    expect(bid.blockedClaims).toContain('AutoSprink parity');
  });
});

describe('normalizeFloorPlan', () => {
  it('cleans a JSON spec and defaults hazard to ordinary', () => {
    const plan = normalizeFloorPlan({ rooms: [{ polygon: [[0, 0], [10, 0], [10, 10]], hazard: 'bogus' }] });
    expect(plan.rooms[0].hazard).toBe('ordinary');
    expect(plan.rooms[0].name).toBe('Room 1');
  });

  it('rejects bad geometry', () => {
    expect(() => normalizeFloorPlan({ rooms: [] })).toThrow(/non-empty/);
    expect(() => normalizeFloorPlan({ rooms: [{ polygon: [[0, 0]] }] })).toThrow(/>= 3 vertices/);
    expect(() => normalizeFloorPlan({ rooms: [{ polygon: [[0, 0], [1, 1], ['x', 2]] }] })).toThrow(/invalid vertex/);
  });
});
