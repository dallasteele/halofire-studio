import { describe, expect, it } from 'vitest';
import { buildRoomCad, buildCadModel } from '../src/engine/cad-model.js';
import { normalizeBuilding } from '../src/engine/building-model.js';
import { getComponent } from '../src/components/registry.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const room = { name: 'Bay', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 };

describe('buildRoomCad — discrete component placement markers', () => {
  const cad = buildRoomCad(room);
  const components = cad.solids.filter((s) => s.kind === 'component');

  it('emits >=1 riser_assembly, fdc, valve_alarm_check and fitting_tee', () => {
    const keys = components.map((c) => c.componentKey);
    expect(keys.filter((k) => k === 'riser_assembly').length).toBeGreaterThanOrEqual(1);
    expect(keys.filter((k) => k === 'fdc').length).toBeGreaterThanOrEqual(1);
    expect(keys.filter((k) => k === 'valve_alarm_check').length).toBeGreaterThanOrEqual(1);
    expect(keys.filter((k) => k === 'fitting_tee').length).toBeGreaterThanOrEqual(1);
  });

  it('emits one fitting_tee per branch-to-cross-main junction', () => {
    const tees = components.filter((c) => c.componentKey === 'fitting_tee');
    expect(tees).toHaveLength(cad.network.branchLines.length);
  });

  it('every component marker has the expected solid shape keyed to a real registry component', () => {
    expect(components.length).toBeGreaterThan(0);
    for (const c of components) {
      expect(c.kind).toBe('component');
      expect(c.layer).toBe('COMPONENTS');
      expect(typeof c.name).toBe('string');
      expect(typeof c.componentKey).toBe('string');
      // componentKey must resolve in the registry (fail-closed contract)
      const def = getComponent(c.componentKey);
      expect(def).toBeTruthy();
      expect(c.category).toBe(def.category);
    }
  });

  it('every component position is numeric [x,y,z] derived within the model bbox', () => {
    const { mainX, mainZ } = cad.network;
    const ys = cad.network.branchLines.map((b) => b.y);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    // plan X span across the riser axis and every branch run end (derived).
    const xsAll = cad.network.branchLines.flatMap((b) => [b.startX, b.endX]).concat([mainX]);
    const xMin = Math.min(...xsAll);
    const xMax = Math.max(...xsAll);
    // plan bbox of the 60x40 room
    expect(mainX).toBeGreaterThanOrEqual(0);
    expect(mainX).toBeLessThanOrEqual(60);
    for (const c of components) {
      const [x, y, z] = c.position;
      expect(typeof x).toBe('number');
      expect(typeof y).toBe('number');
      expect(typeof z).toBe('number');
      // X within the derived network plan span (riser axis .. branch ends).
      expect(x).toBeGreaterThanOrEqual(xMin);
      expect(x).toBeLessThanOrEqual(xMax);
      // Y within the branch-line span
      expect(y).toBeGreaterThanOrEqual(yMin);
      expect(y).toBeLessThanOrEqual(yMax);
      // Z within floor..main elevation
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(mainZ);
    }
  });
});

describe('buildRoomCad — connector fittings (elbow / coupling / reducer)', () => {
  const cad = buildRoomCad(room);
  const components = cad.solids.filter((s) => s.kind === 'component');
  const byKey = (k) => components.filter((c) => c.componentKey === k);

  it('emits >=1 fitting_elbow_90 and >=1 fitting_coupling for a 60x40 room', () => {
    expect(byKey('fitting_elbow_90').length).toBeGreaterThanOrEqual(1);
    expect(byKey('fitting_coupling').length).toBeGreaterThanOrEqual(1);
  });

  it('emits one elbow per branch far-end plus one riser-top elbow', () => {
    const n = cad.network.branchLines.length;
    expect(byKey('fitting_elbow_90')).toHaveLength(n + 1);
  });

  it('emits one coupling per branch line at its interior midpoint', () => {
    const couplings = byKey('fitting_coupling');
    expect(couplings).toHaveLength(cad.network.branchLines.length);
    for (const b of cad.network.branchLines) {
      const midX = Math.round(((b.startX + b.endX) / 2) * 1000) / 1000;
      const c = couplings.find((cc) => cc.name.endsWith(`coupling-branch-${b.row}`));
      expect(c).toBeTruthy();
      expect(c.position[0]).toBe(midX);
      expect(c.position[1]).toBe(b.y);
      expect(c.position[2]).toBe(cad.network.branchZ);
    }
  });

  it('every connector componentKey resolves via getComponent and is numeric within bbox', () => {
    const { mainX, mainZ, branchZ } = cad.network;
    const xs = cad.network.branchLines.flatMap((b) => [b.startX, b.endX]);
    const xMax = Math.max(mainX, ...xs);
    const connectorKeys = ['fitting_elbow_90', 'fitting_coupling', 'fitting_reducer'];
    const connectors = components.filter((c) => connectorKeys.includes(c.componentKey));
    expect(connectors.length).toBeGreaterThan(0);
    for (const c of connectors) {
      const def = getComponent(c.componentKey);
      expect(def).toBeTruthy();
      expect(c.category).toBe(def.category);
      const [x, y, z] = c.position;
      expect(typeof x).toBe('number');
      expect(typeof y).toBe('number');
      expect(typeof z).toBe('number');
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(xMax);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(mainZ);
      // connectors sit at or below the cross-main elevation
      expect(z).toBeLessThanOrEqual(branchZ === undefined ? mainZ : Math.max(branchZ, mainZ));
    }
  });

  it('emits fitting_reducer exactly where a branch is smaller than the cross-main', () => {
    const reducers = byKey('fitting_reducer');
    const expectedSteps = cad.network.branchLines
      .filter((b) => b.diameterIn < cad.sizing.mainDiameterIn).length;
    expect(reducers).toHaveLength(expectedSteps);
    // each reducer sits at the branch/cross-main junction (mainX, b.y, branchZ)
    for (const r of reducers) {
      expect(r.position[0]).toBe(cad.network.mainX);
      expect(r.position[2]).toBe(cad.network.branchZ);
    }
  });

  it('emits no reducer when every branch diameter equals the cross-main (single-branch space)', () => {
    // A tiny room with a single branch line: cross-main dia == branch dia.
    const tiny = buildRoomCad({ name: 'Closet', polygon: rect(10, 8), hazard: 'light', ceilingHeightFt: 12 });
    const tinyBranches = tiny.network.branchLines;
    const allEqual = tinyBranches.every((b) => b.diameterIn === tiny.sizing.mainDiameterIn);
    const reducers = tiny.solids.filter((s) => s.kind === 'component' && s.componentKey === 'fitting_reducer');
    if (allEqual) {
      expect(reducers).toHaveLength(0);
    } else {
      expect(reducers.length).toBeGreaterThan(0);
    }
  });
});

describe('counts.components reflects the number of kind:component solids', () => {
  it('single-room floor plan', () => {
    const plan = { name: 'Plan', units: 'ft', rooms: [room] };
    const m = buildCadModel(plan);
    const n = m.solids.filter((s) => s.kind === 'component').length;
    expect(n).toBeGreaterThan(0);
    expect(m.counts.components).toBe(n);
  });

  it('multi-room floor plan', () => {
    const plan = {
      name: 'Plan', units: 'ft',
      rooms: [room, { name: 'Store', polygon: rect(30, 30), hazard: 'extra', ceilingHeightFt: 20 }],
    };
    const m = buildCadModel(plan);
    const n = m.solids.filter((s) => s.kind === 'component').length;
    expect(m.counts.components).toBe(n);
  });
});

describe('buildCadModel (building) — per-space component markers', () => {
  const spec = {
    name: 'Components Building',
    units: 'ft',
    stories: [
      {
        level: 0, baseElevationFt: 0, ceilingHeightFt: 14,
        spaces: [
          { name: 'A', polygon: [[0, 0], [30, 0], [30, 20], [0, 20]], hazard: 'ordinary' },
          { name: 'B', polygon: [[30, 0], [60, 0], [60, 20], [30, 20]], hazard: 'ordinary' },
        ],
        walls: [{ a: [0, 0], b: [60, 0], type: 'exterior', openings: [] }],
        columns: [{ x: 15, y: 10, sizeFt: 1.5 }],
      },
    ],
  };
  const model = buildCadModel(normalizeBuilding(spec));
  const components = model.solids.filter((s) => s.kind === 'component');

  it('emits component solids for the building and counts them', () => {
    expect(components.length).toBeGreaterThan(0);
    expect(model.counts.components).toBe(components.length);
    expect(components.some((c) => c.componentKey === 'riser_assembly')).toBe(true);
    expect(components.some((c) => c.componentKey === 'fitting_tee')).toBe(true);
  });

  it('emits one shared riser assembly for a multi-space system', () => {
    const risers = components.filter((c) => c.componentKey === 'riser_assembly');
    // A and B share one building system; duplicating the riser per room is invalid.
    expect(risers).toHaveLength(1);
  });

  it('lifts component markers on an upper story (Z offset by baseElevationFt)', () => {
    const tower = {
      name: 'Tower', units: 'ft',
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
    const m = buildCadModel(normalizeBuilding(tower));
    const compZs = m.solids.filter((s) => s.kind === 'component').map((s) => s.position[2]);
    // riser-base fdc on level 1 sits at z=14 (lifted), level 0 at z=0
    expect(compZs.some((z) => z === 0)).toBe(true);
    expect(compZs.some((z) => z >= 14)).toBe(true);
  });
});

describe('component markers do not disturb existing counts (back-compat)', () => {
  it('a known 60x40 light-hazard room keeps walls/heads/pipes unchanged', () => {
    const cad = buildRoomCad(room);
    expect(cad.solids.filter((s) => s.kind === 'head')).toHaveLength(12);
    expect(cad.solids.filter((s) => s.kind === 'pipe')).toHaveLength(20);
    expect(cad.solids.filter((s) => s.kind === 'wall')).toHaveLength(4);
  });

  it('multi-room plan counts.walls/heads stay as before', () => {
    const plan = {
      name: 'Plan', units: 'ft',
      rooms: [room, { name: 'Store', polygon: rect(30, 30), hazard: 'extra', ceilingHeightFt: 20 }],
    };
    const m = buildCadModel(plan);
    expect(m.counts.walls).toBe(8);
    expect(m.counts.heads).toBeGreaterThan(12);
  });
});
