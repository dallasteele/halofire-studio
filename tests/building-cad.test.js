import { describe, expect, it } from 'vitest';
import { buildCadModel } from '../src/engine/cad-model.js';
import { normalizeBuilding } from '../src/engine/building-model.js';
import { toDxf } from '../src/engine/dxf-export.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

// A 2-space building on one story:
//   Space A: 30x20 at origin (x 0..30)
//   Space B: 30x20 to the right (x 30..60)
//   one INTERIOR wall on the shared x=30 partition with one DOOR opening
//   one structural COLUMN
const TWO_SPACE_BUILDING = {
  name: 'Accurate Building',
  units: 'ft',
  stories: [
    {
      level: 0,
      baseElevationFt: 0,
      ceilingHeightFt: 14,
      spaces: [
        { name: 'A', polygon: [[0, 0], [30, 0], [30, 20], [0, 20]], hazard: 'ordinary' },
        { name: 'B', polygon: [[30, 0], [60, 0], [60, 20], [30, 20]], hazard: 'ordinary' },
      ],
      walls: [
        // exterior perimeter (one long box)
        { a: [0, 0], b: [60, 0], thicknessFt: 0.5, type: 'exterior', openings: [] },
        // interior partition between A and B, with a door
        {
          a: [30, 0], b: [30, 20], thicknessFt: 0.5, type: 'interior',
          openings: [{ offsetFt: 8, widthFt: 3, heightFt: 7, type: 'door' }],
        },
      ],
      columns: [{ x: 15, y: 10, sizeFt: 1.5 }],
    },
  ],
};

describe('buildCadModel — accurate building (stories/spaces/walls/columns)', () => {
  const building = normalizeBuilding(TWO_SPACE_BUILDING);
  const model = buildCadModel(building);

  it('detects the building shape and emits wall solids typed interior/exterior', () => {
    const walls = model.solids.filter((s) => s.kind === 'wall');
    expect(walls.length).toBeGreaterThanOrEqual(2);
    const interior = walls.filter((w) => w.type === 'interior');
    const exterior = walls.filter((w) => w.type === 'exterior');
    expect(interior.length).toBeGreaterThanOrEqual(1);
    expect(exterior.length).toBeGreaterThanOrEqual(1);
    // walls reuse the existing wall shape
    for (const w of walls) {
      expect(Array.isArray(w.a)).toBe(true);
      expect(Array.isArray(w.b)).toBe(true);
      expect(Array.isArray(w.center)).toBe(true);
      expect(typeof w.lengthFt).toBe('number');
      expect(typeof w.heightFt).toBe('number');
      expect(typeof w.thicknessFt).toBe('number');
      expect(typeof w.rotationY).toBe('number');
      expect(w.baseZ).toBe(0);
    }
  });

  it('records an opening on the interior wall', () => {
    const wallWithOpening = model.solids.find(
      (s) => s.kind === 'wall' && Array.isArray(s.openings) && s.openings.length > 0,
    );
    expect(wallWithOpening).toBeTruthy();
    const op = wallWithOpening.openings[0];
    expect(op.type).toBe('door');
    expect(op.widthFt).toBeGreaterThan(0);
    expect(op.heightFt).toBeGreaterThan(0);
    expect(typeof op.offsetFt).toBe('number');
  });

  it('emits a column solid', () => {
    const cols = model.solids.filter((s) => s.kind === 'column');
    expect(cols.length).toBeGreaterThanOrEqual(1);
    const c = cols[0];
    expect(typeof c.x).toBe('number');
    expect(typeof c.y).toBe('number');
    expect(c.sizeFt).toBeGreaterThan(0);
    expect(typeof c.heightFt).toBe('number');
    expect(c.baseZ).toBe(0);
  });

  it('places heads in BOTH spaces via the per-space system layout', () => {
    const heads = model.solids.filter((s) => s.kind === 'head');
    expect(heads.length).toBeGreaterThan(0);
    // Space A is x 0..30, Space B is x 30..60 — both must contain heads.
    expect(heads.some((h) => h.position[0] <= 30)).toBe(true);
    expect(heads.some((h) => h.position[0] >= 30)).toBe(true);
  });

  it('populates building counts (spaces/walls/interiorWalls/columns/openings/heads/pipes)', () => {
    const c = model.counts;
    expect(c.spaces).toBe(2);
    expect(c.walls).toBeGreaterThanOrEqual(2);
    expect(c.interiorWalls).toBeGreaterThanOrEqual(1);
    expect(c.columns).toBe(1);
    expect(c.openings).toBeGreaterThanOrEqual(1);
    expect(c.heads).toBeGreaterThan(0);
    expect(c.pipes).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildCadModel(building))).toBe(JSON.stringify(buildCadModel(building)));
  });
});

describe('buildCadModel — multi-story building stacks by baseElevationFt', () => {
  it('lifts story-1 solids above story 0 in Z', () => {
    const spec = {
      name: 'Tower',
      units: 'ft',
      stories: [
        {
          level: 0, baseElevationFt: 0, ceilingHeightFt: 14,
          spaces: [{ name: 'L0', polygon: rect(40, 30), hazard: 'light' }],
          walls: [{ a: [0, 0], b: [40, 0], type: 'exterior', openings: [] }],
          columns: [{ x: 10, y: 10, sizeFt: 1 }],
        },
        {
          level: 1, baseElevationFt: 14, ceilingHeightFt: 14,
          spaces: [{ name: 'L1', polygon: rect(40, 30), hazard: 'light' }],
          walls: [{ a: [0, 0], b: [40, 0], type: 'exterior', openings: [] }],
          columns: [{ x: 10, y: 10, sizeFt: 1 }],
        },
      ],
    };
    const model = buildCadModel(normalizeBuilding(spec));
    const headZs = model.solids.filter((s) => s.kind === 'head').map((s) => s.position[2]);
    expect(headZs.some((z) => z < 14)).toBe(true);
    expect(headZs.some((z) => z > 14)).toBe(true);
    // story-1 column sits on the second slab (baseZ 14)
    const cols = model.solids.filter((s) => s.kind === 'column');
    expect(cols.some((c) => c.baseZ === 0)).toBe(true);
    expect(cols.some((c) => c.baseZ === 14)).toBe(true);
  });
});

describe('buildCadModel — legacy floorPlan regression guard (output unchanged)', () => {
  const baseRoom = { name: 'Bay', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 };
  const legacyPlan = { name: 'Plan', units: 'ft', rooms: [baseRoom, { name: 'Store', polygon: rect(30, 30), hazard: 'extra', ceilingHeightFt: 20 }] };

  it('legacy rooms output is byte-identical and has no building-only counts', () => {
    const m = buildCadModel(legacyPlan);
    // legacy counts shape (no building extras leaking into the legacy path)
    expect(m.counts.walls).toBe(8);
    expect(m.counts.heads).toBeGreaterThan(12);
    expect(m.rooms).toHaveLength(2);
    expect(m.solids.some((s) => s.kind === 'column')).toBe(false);
    // determinism
    expect(JSON.stringify(buildCadModel(legacyPlan))).toBe(JSON.stringify(buildCadModel(legacyPlan)));
  });
});

describe('toDxf — building walls/columns/openings on layers', () => {
  const building = normalizeBuilding(TWO_SPACE_BUILDING);
  const dxf = toDxf(buildCadModel(building));

  it('emits interior vs exterior wall layers, columns, and opening centerlines', () => {
    expect(dxf).toContain('WALLS');
    expect(dxf).toContain('WALLS-INT');
    expect(dxf).toContain('COLUMNS');
    expect(dxf).toContain('OPENINGS');
  });
});
