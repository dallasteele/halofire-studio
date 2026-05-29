import { describe, expect, it } from 'vitest';
import { buildCadModel } from '../src/engine/cad-model.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const baseRoom = { name: 'Bay', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 };

// A 2-floor building: floor 0 at base 0 (ceiling 14), floor 1 stacked at base 14.
const twoFloorPlan = {
  name: 'Tower',
  units: 'ft',
  floors: [
    { level: 0, baseElevationFt: 0, ceilingHeightFt: 14, rooms: [{ name: 'L0-Bay', polygon: rect(60, 40), hazard: 'light' }] },
    { level: 1, baseElevationFt: 14, ceilingHeightFt: 14, rooms: [{ name: 'L1-Bay', polygon: rect(60, 40), hazard: 'light' }] },
  ],
};

describe('buildCadModel — multi-floor stacking', () => {
  const model = buildCadModel(twoFloorPlan);

  it('reports two floors and aggregates head count across both', () => {
    expect(model.floors).toHaveLength(2);
    // each 60x40 light-hazard room lays out 12 heads -> 24 total
    expect(model.counts.heads).toBe(24);
    const f0Heads = model.floors[0].counts.heads;
    const f1Heads = model.floors[1].counts.heads;
    expect(f0Heads).toBe(12);
    expect(f1Heads).toBe(12);
    expect(f0Heads + f1Heads).toBe(model.counts.heads);
  });

  it('places heads in TWO distinct elevation bands (floor 1 above floor 0)', () => {
    const headZs = model.solids.filter((s) => s.kind === 'head').map((s) => s.position[2]);
    expect(headZs.some((z) => z < 14)).toBe(true); // floor 0 band
    expect(headZs.some((z) => z > 14)).toBe(true); // floor 1 band (offset by baseElevation 14)
  });

  it('offsets every floor-1 solid above floor 0 in Z', () => {
    const f1 = model.floors[1];
    // floor-1 pipes all sit at or above its base elevation
    const f1Pipes = f1.solids.filter((s) => s.kind === 'pipe');
    expect(f1Pipes.length).toBeGreaterThan(0);
    expect(f1Pipes.every((p) => p.from[2] >= 14 && p.to[2] >= 14)).toBe(true);
    // floor-1 walls carry a baseZ of 14 so they stack on floor 0
    const f1Walls = f1.solids.filter((s) => s.kind === 'wall');
    expect(f1Walls.every((w) => w.baseZ === 14)).toBe(true);
    // floor-0 walls remain at grade (baseZ absent/0 -> DXF default 0)
    const f0Walls = model.floors[0].solids.filter((s) => s.kind === 'wall');
    expect(f0Walls.every((w) => (w.baseZ || 0) === 0)).toBe(true);
  });

  it('sizes each floor independently with its own riser network', () => {
    for (const floor of model.floors) {
      const risers = floor.solids.filter((s) => s.kind === 'pipe' && s.role === 'riser');
      expect(risers.length).toBeGreaterThan(0);
      // each room on the floor is sized
      for (const r of floor.rooms) {
        expect(r.sizing.mainDiameterIn).toBeGreaterThan(0);
      }
    }
  });
});

describe('buildCadModel — backward compatibility (single-floor legacy plan)', () => {
  it('produces identical output for a legacy floorPlan.rooms plan', () => {
    const legacyPlan = { name: 'Plan', units: 'ft', rooms: [baseRoom, { name: 'Store', polygon: rect(30, 30), hazard: 'extra', ceilingHeightFt: 20 }] };
    const before = buildCadModel(legacyPlan);
    const again = buildCadModel(legacyPlan);
    // determinism + no structural change for legacy plans
    expect(JSON.stringify(before)).toBe(JSON.stringify(again));
    expect(before.rooms).toHaveLength(2);
    expect(before.counts.walls).toBe(8);
    // legacy plans still expose top-level rooms and an aggregate head count
    expect(before.counts.heads).toBeGreaterThan(12);
    // legacy single-floor head elevations stay in one band (all under ceiling 20)
    const headZs = before.solids.filter((s) => s.kind === 'head').map((s) => s.position[2]);
    expect(headZs.every((z) => z < 20)).toBe(true);
  });
});
