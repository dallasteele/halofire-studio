// sample-project.ts (W7): the PURE example-project builder. Verifies it returns a
// clearly-labelled SAMPLE project (>=2 rooms, names carry an example/sample marker),
// a real scale, and is deterministic. No heads/pipe yet — the store action lays +
// routes them; this only seeds the rooms + scale.

import { describe, expect, it } from 'vitest';
import { buildSampleProject, SAMPLE_PROJECT_NAME } from '../src/lib/sample-project';

const MARKER = /sample|example/i;

describe('buildSampleProject', () => {
  it('has at least 2 rooms', () => {
    const p = buildSampleProject();
    expect(p.building.rooms.length).toBeGreaterThanOrEqual(2);
  });

  it('is CLEARLY labelled as example/sample data', () => {
    const p = buildSampleProject();
    // Project name + EVERY room name carry the example/sample marker.
    expect(p.name).toBe(SAMPLE_PROJECT_NAME);
    expect(p.name).toMatch(MARKER);
    for (const r of p.building.rooms) {
      expect(r.name).toBeTruthy();
      expect(r.name!).toMatch(MARKER);
    }
  });

  it('sets a positive real scale (1 ft/unit)', () => {
    const p = buildSampleProject();
    expect(p.building.scaleFtPerUnit).toBe(1);
    expect(p.building.scaleFtPerUnit).toBeGreaterThan(0);
  });

  it('gives every room a valid closed polygon (>=3 pts) and a hazard class', () => {
    const p = buildSampleProject();
    for (const r of p.building.rooms) {
      expect(r.polygon.length).toBeGreaterThanOrEqual(3);
      expect(r.hazard).toBeTruthy();
      expect(r.ceilingHt).toBeGreaterThan(0);
    }
  });

  it('is deterministic — same shape on every call', () => {
    expect(buildSampleProject().building).toEqual(buildSampleProject().building);
    // Room ids are stable (seeded), not random.
    const a = buildSampleProject().building.rooms.map((r) => r.id);
    const b = buildSampleProject().building.rooms.map((r) => r.id);
    expect(a).toEqual(b);
  });
});
