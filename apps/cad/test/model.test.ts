// model.ts contract tests: emptyProject is a valid, fully-EMPTY project (no
// fabricated geometry), the typed shape holds, and the helpers report honestly.

import { describe, expect, it } from 'vitest';
import {
  HAZARD_CLASSES,
  NODE_TYPES,
  PIPE_MATERIALS,
  SEGMENT_ROLES,
  emptyProject,
  hasBuilding,
  hasNetwork,
  makeId,
  portFor,
  type Project,
} from '../src/lib/model';

describe('emptyProject', () => {
  it('returns a valid project with exactly one level', () => {
    const p = emptyProject();
    expect(p.id).toMatch(/^proj_/);
    expect(p.name).toBe('Untitled Project');
    expect(p.levels).toHaveLength(1);
    expect(p.levels[0].elevationFt).toBe(0);
  });

  it('accepts a custom name', () => {
    expect(emptyProject('Halo Fire HQ').name).toBe('Halo Fire HQ');
  });

  it('starts with NO building geometry (source none, empty walls/rooms)', () => {
    const p = emptyProject();
    expect(p.building.source).toBe('none');
    expect(p.building.walls).toEqual([]);
    expect(p.building.rooms).toEqual([]);
    expect(p.building.scaleFtPerUnit).toBe(1);
  });

  it('starts with an EMPTY network (no nodes/segments/remote areas)', () => {
    const p = emptyProject();
    expect(p.network.nodes).toEqual([]);
    expect(p.network.segments).toEqual([]);
    expect(p.network.remoteAreas).toEqual([]);
  });

  it('carries light-hazard defaults', () => {
    const p = emptyProject();
    expect(p.hazardDefaults.defaultClass).toBe('LIGHT');
    expect(p.hazardDefaults.defaultCeilingHt).toBeGreaterThan(0);
  });

  it('hasBuilding / hasNetwork are both false for an empty project (honest)', () => {
    const p = emptyProject();
    expect(hasBuilding(p)).toBe(false);
    expect(hasNetwork(p)).toBe(false);
  });
});

describe('helpers report geometry honestly', () => {
  it('hasBuilding is true only with a non-none source AND geometry', () => {
    const p: Project = emptyProject();
    p.building.source = 'dxf';
    p.building.rooms = [
      {
        id: 'r1',
        polygon: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        hazard: 'ORDINARY_1',
        ceilingHt: 10,
      },
    ];
    expect(hasBuilding(p)).toBe(true);
  });

  it('hasNetwork is true once a node exists', () => {
    const p = emptyProject();
    p.network.nodes = [
      { id: 'n1', type: 'SOURCE', pos: { x: 0, y: 0, z: 0 } },
    ];
    expect(hasNetwork(p)).toBe(true);
  });
});

describe('enums and constructors', () => {
  it('exposes the canonical enum buckets', () => {
    expect(HAZARD_CLASSES).toContain('LIGHT');
    expect(HAZARD_CLASSES).toContain('EXTRA_2');
    expect(NODE_TYPES).toContain('HEAD');
    expect(NODE_TYPES).toContain('SOURCE');
    expect(SEGMENT_ROLES).toContain('BRANCH');
    expect(PIPE_MATERIALS).toContain('STEEL_SCH40');
  });

  it('makeId is prefixed and deterministic with a seed', () => {
    expect(makeId('head', 42)).toBe(makeId('head', 42));
    expect(makeId('head', 42)).toMatch(/^head_/);
  });

  it('portFor reuses the connectivity Port shape', () => {
    const port = portFor('THREADED_NPT', 0.5, 'INLET');
    expect(port).toEqual({
      method: 'THREADED_NPT',
      nominalSizeIn: 0.5,
      role: 'INLET',
    });
  });
});
