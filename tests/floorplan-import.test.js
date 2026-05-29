import { describe, expect, it } from 'vitest';
import {
  parsePolygonPoints,
  parseSimplePath,
  floorPlanFromSvg,
  normalizeFloorPlan,
} from '../src/engine/floorplan-import.js';
import { generateSprinklerBid } from '../src/engine/sprinkler-layout.js';

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
