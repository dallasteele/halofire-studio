import { describe, expect, it } from 'vitest';
import {
  normalizeBuilding,
  buildingFromFloorPlan,
} from '../src/engine/building-model.js';
import {
  buildingFromSvg,
  buildingFromDxf,
} from '../src/engine/floorplan-import.js';
import { normalizeFloorPlan } from '../src/engine/floorplan-import.js';

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
function line([x1, y1], [x2, y2], layer = 'WALLS') {
  return ['0', 'LINE', '8', layer, '10', String(x1), '20', String(y1), '11', String(x2), '21', String(y2)];
}

/** A CIRCLE entity (center + radius) on a layer. */
function circle([cx, cy], r, layer = 'COLUMN') {
  return ['0', 'CIRCLE', '8', layer, '10', String(cx), '20', String(cy), '40', String(r)];
}

describe('normalizeBuilding', () => {
  it('applies defaults and cleans a minimal spec', () => {
    const b = normalizeBuilding({
      name: 'Test',
      stories: [{ spaces: [{ polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }] }],
    });
    expect(b.name).toBe('Test');
    expect(b.units).toBe('ft');
    expect(b.stories).toHaveLength(1);
    const s = b.stories[0];
    expect(s.level).toBe(0);
    expect(s.baseElevationFt).toBe(0);
    expect(s.ceilingHeightFt).toBe(14);
    expect(s.spaces[0].hazard).toBe('ordinary');
    expect(s.spaces[0].name).toBe('Space 1');
    expect(s.walls).toEqual([]);
    expect(s.columns).toEqual([]);
  });

  it('drops degenerate spaces (<3 verts) and zero-length walls', () => {
    const b = normalizeBuilding({
      stories: [{
        spaces: [
          { polygon: [[0, 0], [10, 0], [10, 10]] },
          { polygon: [[0, 0], [1, 1]] }, // degenerate
        ],
        walls: [
          { a: [0, 0], b: [10, 0] },
          { a: [5, 5], b: [5, 5] }, // zero length
        ],
      }],
    });
    expect(b.stories[0].spaces).toHaveLength(1);
    expect(b.stories[0].walls).toHaveLength(1);
  });

  it('defaults wall thickness/type and clamps opening offset/width within the wall', () => {
    const b = normalizeBuilding({
      stories: [{
        spaces: [{ polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }],
        walls: [
          // a 10ft wall with an opening that overflows; should clamp
          { a: [0, 0], b: [10, 0], openings: [{ offsetFt: 9, widthFt: 5, heightFt: 7, type: 'door' }] },
        ],
      }],
    });
    const wall = b.stories[0].walls[0];
    expect(wall.thicknessFt).toBe(0.5);
    expect(wall.type).toBe('interior');
    const op = wall.openings[0];
    // wall length is 10; width clamped so offset+width <= length
    expect(op.offsetFt + op.widthFt).toBeLessThanOrEqual(10 + 1e-9);
    expect(op.widthFt).toBeGreaterThan(0);
    expect(op.type).toBe('door');
  });

  it('throws on no stories', () => {
    expect(() => normalizeBuilding({ stories: [] })).toThrow(/stor/i);
  });
});

describe('buildingFromFloorPlan (backward compat)', () => {
  it('converts a 2-room {rooms} plan into 2 spaces with exterior perimeter walls', () => {
    const plan = normalizeFloorPlan({
      name: 'Two Room',
      rooms: [
        { name: 'A', polygon: [[0, 0], [20, 0], [20, 10], [0, 10]], hazard: 'light' },
        { name: 'B', polygon: [[20, 0], [40, 0], [40, 10], [20, 10]] },
      ],
    });
    const b = buildingFromFloorPlan(plan);
    expect(b.stories).toHaveLength(1);
    const s = b.stories[0];
    expect(s.spaces).toHaveLength(2);
    expect(s.spaces[0].name).toBe('A');
    expect(s.spaces[0].hazard).toBe('light');
    // each room contributes 4 perimeter exterior walls
    expect(s.walls.length).toBe(8);
    expect(s.walls.every((w) => w.type === 'exterior')).toBe(true);
    expect(s.columns).toEqual([]);
  });

  it('converts a legacy {floors} plan preserving levels/elevations', () => {
    const plan = {
      name: 'Stack',
      units: 'ft',
      floors: [
        { level: 0, baseElevationFt: 0, ceilingHeightFt: 12, rooms: [{ name: 'G', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }] },
        { level: 1, baseElevationFt: 12, rooms: [{ name: 'U', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }] },
      ],
    };
    const b = buildingFromFloorPlan(plan);
    expect(b.stories).toHaveLength(2);
    expect(b.stories[0].baseElevationFt).toBe(0);
    expect(b.stories[0].ceilingHeightFt).toBe(12);
    expect(b.stories[1].level).toBe(1);
    expect(b.stories[1].baseElevationFt).toBe(12);
  });
});

describe('buildingFromSvg (multi-space)', () => {
  it('parses 2 rooms sharing an interior wall + one door + a column', () => {
    const svg = `<svg>
      <polygon data-space data-name="West" points="0,0 20,0 20,20 0,20"/>
      <polygon data-space data-name="East" points="20,0 40,0 40,20 20,20"/>
      <line data-wall data-wall-type="exterior" x1="0" y1="0" x2="40" y2="0"/>
      <line data-wall data-wall-type="exterior" x1="40" y1="0" x2="40" y2="20"/>
      <line data-wall data-wall-type="exterior" x1="40" y1="20" x2="0" y2="20"/>
      <line data-wall data-wall-type="exterior" x1="0" y1="20" x2="0" y2="0"/>
      <line data-wall data-wall-type="interior" x1="20" y1="0" x2="20" y2="20"/>
      <line data-opening data-opening-type="door" x1="20" y1="8" x2="20" y2="11"/>
      <circle data-column cx="20" cy="10" r="0.75"/>
    </svg>`;
    const b = buildingFromSvg(svg);
    const s = b.stories[0];
    expect(s.spaces).toHaveLength(2);
    expect(s.spaces.map((x) => x.name).sort()).toEqual(['East', 'West']);
    const interior = s.walls.filter((w) => w.type === 'interior');
    expect(interior.length).toBeGreaterThanOrEqual(1);
    const totalOpenings = s.walls.reduce((n, w) => n + (w.openings ? w.openings.length : 0), 0);
    expect(totalOpenings).toBe(1);
    // the door should attach to the interior wall
    expect(interior.some((w) => w.openings.some((o) => o.type === 'door'))).toBe(true);
    expect(s.columns).toHaveLength(1);
    expect(s.columns[0].x).toBe(20);
    expect(s.columns[0].y).toBe(10);
  });
});

describe('buildingFromDxf (multi-space)', () => {
  it('parses 2 spaces, walls (>=1 interior), 1 door, and a column', () => {
    const text = dxf(
      ...lwpolyline([[0, 0], [20, 0], [20, 20], [0, 20]], { layer: 'ROOMS' }),
      ...lwpolyline([[20, 0], [40, 0], [40, 20], [20, 20]], { layer: 'ROOMS' }),
      ...line([0, 0], [40, 0], 'WALLS-EXT'),
      ...line([40, 0], [40, 20], 'WALLS-EXT'),
      ...line([40, 20], [0, 20], 'WALLS-EXT'),
      ...line([0, 20], [0, 0], 'WALLS-EXT'),
      ...line([20, 0], [20, 20], 'WALLS-INT'),
      ...line([20, 8], [20, 11], 'DOOR'),
      ...circle([20, 10], 0.75, 'COLUMN'),
    );
    const b = buildingFromDxf(text, {
      layers: {
        spaces: ['ROOMS'],
        wallsExterior: ['WALLS-EXT'],
        wallsInterior: ['WALLS-INT'],
        doors: ['DOOR'],
        columns: ['COLUMN'],
      },
    });
    const s = b.stories[0];
    expect(s.spaces).toHaveLength(2);
    expect(s.walls.filter((w) => w.type === 'interior').length).toBeGreaterThanOrEqual(1);
    expect(s.walls.filter((w) => w.type === 'exterior').length).toBeGreaterThanOrEqual(4);
    const totalOpenings = s.walls.reduce((n, w) => n + (w.openings ? w.openings.length : 0), 0);
    expect(totalOpenings).toBe(1);
    expect(s.columns).toHaveLength(1);
    expect(s.columns[0].x).toBe(20);
  });
});
