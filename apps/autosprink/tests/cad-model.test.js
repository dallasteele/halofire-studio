import { describe, expect, it } from 'vitest';
import { sizePipe, buildRoomCad, buildCadModel } from '../src/engine/cad-model.js';
import { toDxf } from '../src/engine/dxf-export.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const room = { name: 'Bay', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 };

describe('sizePipe (NFPA-13 schedule)', () => {
  it('returns the smallest pipe that serves the head count', () => {
    expect(sizePipe(1, 'light')).toBe(1.0);
    expect(sizePipe(3, 'light')).toBe(1.25);
    expect(sizePipe(5, 'light')).toBe(1.5);
    expect(sizePipe(10, 'light')).toBe(2.0);
    expect(sizePipe(60, 'light')).toBe(3.0);
    expect(sizePipe(40, 'ordinary')).toBe(3.0);
  });
});

describe('buildRoomCad — 3D-correct pipe network', () => {
  const cad = buildRoomCad(room);

  it('produces a head per layout head plus branch/drop/main/riser pipes', () => {
    const heads = cad.solids.filter((s) => s.kind === 'head');
    const pipes = cad.solids.filter((s) => s.kind === 'pipe');
    expect(heads).toHaveLength(12);
    expect(cad.network.branchLines).toHaveLength(3);
    // 3 branches + 12 drops + 1 main + 3 ties + 1 system riser = 20 pipes
    expect(pipes).toHaveLength(20);
    expect(cad.network.totalHeads).toBe(12);
  });

  it('orders elevations head < branch < main < ceiling', () => {
    const { headZ, branchZ, mainZ, ceiling } = cad.network;
    expect(headZ).toBeLessThan(branchZ);
    expect(branchZ).toBeLessThan(mainZ);
    expect(mainZ).toBeLessThan(ceiling);
  });

  it('sizes branches by head count and the main by total heads', () => {
    // each branch carries 4 heads -> 1.5"; main carries 12 -> 2.5"
    expect(cad.sizing.branchDiameters.every((d) => d === 1.5)).toBe(true);
    expect(cad.sizing.mainDiameterIn).toBe(2.5);
  });

  it('every pipe has a real 3D start and end (not a flat dot)', () => {
    const pipes = cad.solids.filter((s) => s.kind === 'pipe');
    expect(pipes.every((p) => Array.isArray(p.from) && p.from.length === 3 && Array.isArray(p.to) && p.to.length === 3)).toBe(true);
    // the system riser spans floor (z=0) up to the main elevation
    const riser = pipes.find((p) => p.role === 'riser');
    expect(riser.from[2]).toBe(0);
    expect(riser.to[2]).toBe(cad.network.mainZ);
    // drops are vertical (same x,y, different z)
    const drop = pipes.find((p) => p.role === 'drop');
    expect(drop.from[0]).toBe(drop.to[0]);
    expect(drop.from[1]).toBe(drop.to[1]);
    expect(drop.from[2]).toBeGreaterThan(drop.to[2]);
  });
});

describe('buildCadModel (multi-room) + determinism', () => {
  const plan = { name: 'Plan', units: 'ft', rooms: [room, { name: 'Store', polygon: rect(30, 30), hazard: 'extra', ceilingHeightFt: 20 }] };
  it('aggregates rooms and reports counts', () => {
    const m = buildCadModel(plan);
    expect(m.rooms).toHaveLength(2);
    expect(m.counts.heads).toBeGreaterThan(12);
    expect(m.counts.walls).toBe(8);
  });
  it('is deterministic', () => {
    expect(JSON.stringify(buildCadModel(plan))).toBe(JSON.stringify(buildCadModel(plan)));
  });
  it('rejects an empty plan', () => {
    expect(() => buildCadModel({ name: 'x', rooms: [] })).toThrow(/non-empty/);
  });
});

describe('toDxf (AutoCAD R12)', () => {
  const dxf = toDxf(buildCadModel({ name: 'Plan', units: 'ft', rooms: [room] }));

  it('emits a valid layered DXF document', () => {
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('$ACADVER');
    expect(dxf).toContain('AC1009');
    expect(dxf).toContain('ENTITIES');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    for (const layer of ['WALLS', 'MAIN', 'BRANCH', 'DROPS', 'RISER', 'HEADS']) {
      expect(dxf).toContain(layer);
    }
  });

  it('emits a head circle per sprinkler and sized-pipe text', () => {
    const circles = (dxf.match(/\nCIRCLE\n/g) || []).length;
    expect(circles).toBe(12);
    expect(dxf).toContain('2.5"'); // main size label
    expect(dxf).toContain('1.5"'); // branch size label
  });

  it('rejects a non-model input', () => {
    expect(() => toDxf({})).toThrow(/solids/);
  });
});
