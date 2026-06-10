// W2C project-io — .hfcad codec round-trip + fail-soft validation.

import { describe, expect, it } from 'vitest';
import { emptyProject, type Project } from '../src/lib/model';
import {
  deserializeProject,
  PROJECT_FILE_KIND,
  PROJECT_FILE_VERSION,
  serializeProject,
  validateProject,
} from '../src/lib/project-io';

/** A populated project literal: 2 walls, 1 triangle room, 2 nodes, 1 segment. */
function populated(): Project {
  const p = emptyProject('Round Trip');
  p.building = {
    walls: [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 40, y: 0 } },
      { id: 'w2', start: { x: 40, y: 0 }, end: { x: 40, y: 30 } },
    ],
    rooms: [
      { id: 'r1', polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 20, y: 30 }], hazard: 'ORDINARY_1', ceilingHt: 12 },
    ],
    scaleFtPerUnit: 0.25,
    source: 'manual',
  };
  p.network = {
    nodes: [
      { id: 'h1', type: 'HEAD', pos: { x: 10, y: 12, z: 10 } },
      { id: 's1', type: 'SOURCE', pos: { x: 0, y: 0, z: 0 } },
    ],
    segments: [
      { id: 'p1', from: 's1', to: 'h1', diameterIn: 1, lengthFt: 18.5, role: 'BRANCH', material: 'STEEL_SCH40' },
    ],
    remoteAreas: [],
  };
  return p;
}

describe('round-trip', () => {
  it('emptyProject survives serialize -> deserialize deep-equal', () => {
    const p = emptyProject();
    const out = deserializeProject(serializeProject(p, '2026-06-10T00:00:00Z'));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.project).toEqual({ ...p, annotations: p.annotations ?? [] });
      expect(out.savedAt).toBe('2026-06-10T00:00:00Z');
    }
  });

  it('a populated project round-trips deep-equal', () => {
    const p = populated();
    const out = deserializeProject(serializeProject(p));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.project).toEqual({ ...p, annotations: [] });
  });

  it('a missing annotations field defaults to []', () => {
    const p = populated();
    delete (p as Partial<Project>).annotations;
    const out = deserializeProject(serializeProject(p));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.project.annotations).toEqual([]);
  });
});

describe('fail-soft rejection (never throws, names the failing field)', () => {
  const cases: Array<[string, string, (f: ReturnType<typeof JSON.parse>) => void]> = [
    ['wrong kind', 'kind', (f) => { f.kind = 'other'; }],
    ['future version', 'version', (f) => { f.version = PROJECT_FILE_VERSION + 1; }],
    ['scale zero', 'scaleFtPerUnit', (f) => { f.project.building.scaleFtPerUnit = 0; }],
    ['scale null (NaN via JSON)', 'scaleFtPerUnit', (f) => { f.project.building.scaleFtPerUnit = null; }],
    ['2-point room polygon', 'polygon', (f) => { f.project.building.rooms[0].polygon = [{ x: 0, y: 0 }, { x: 1, y: 1 }]; }],
    ['segment missing to', 'from/to', (f) => { delete f.project.network.segments[0].to; }],
    ['empty levels', 'levels', (f) => { f.project.levels = []; }],
  ];

  for (const [name, field, mutate] of cases) {
    it(`rejects ${name} with a reason mentioning the field`, () => {
      const f = JSON.parse(serializeProject(populated()));
      mutate(f);
      const out = deserializeProject(JSON.stringify(f));
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason.toLowerCase()).toContain(field.toLowerCase().split('/')[0]);
    });
  }

  it('rejects invalid JSON text without throwing', () => {
    expect(() => deserializeProject('not json {')).not.toThrow();
    const out = deserializeProject('not json {');
    expect(out.ok).toBe(false);
  });

  it('validateProject accepts a real project and rejects junk', () => {
    expect(validateProject(populated()).ok).toBe(true);
    expect(validateProject(null).ok).toBe(false);
    expect(validateProject({}).ok).toBe(false);
  });

  it('kind constant matches the serialized output', () => {
    const f = JSON.parse(serializeProject(emptyProject()));
    expect(f.kind).toBe(PROJECT_FILE_KIND);
    expect(f.version).toBe(PROJECT_FILE_VERSION);
  });
});
