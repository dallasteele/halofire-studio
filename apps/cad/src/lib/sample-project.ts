// HaloFire CAD — PURE sample/example project builder (W7 UX polish).
//
// buildSampleProject() returns a small, CLEARLY-LABELLED example Project so a
// fresh operator can drive the whole vertical (auto-layout heads -> route pipe ->
// hydraulics -> bid) from one click, without importing a plan first. It is a
// DESIGN-AID demo: every name says "example"/"Sample" so it can never be mistaken
// for the user's real plan or a real building.
//
// Pure + deterministic: no React / three / DOM imports, no randomness, no I/O. The
// same call always returns the same shape (stable ids via makeId seeds). The heads,
// pipe, and prices it later produces come from the REAL layout / routing / pricebook
// math (the store action drives those) — this file only seeds the rooms + scale.
//
// HONESTY: this is SAMPLE/EXAMPLE data, not a survey, not a real building, not an
// AHJ/PE selection. The labels carry that disclaimer so the UI can surface it.

import { emptyProject, makeId, type Project, type Room } from './model';

/** A human-visible marker that brands the sample so it reads as example data. */
export const SAMPLE_PROJECT_NAME = 'Sample Project (example data)';

/**
 * Build the deterministic example project: two named sample rooms (a 40x60
 * Ordinary-Hazard-1 zone + a 24x30 Light zone) at a 1 ft/unit scale, on a single
 * level. Source is 'manual' (operator-equivalent geometry, no fabricated import
 * provenance). NO heads/pipe yet — the store action lays + routes them with a REAL
 * head SKU so the whole vertical is exercised honestly.
 *
 * Pure: deterministic ids, no randomness, no side effects.
 */
export function buildSampleProject(): Project {
  const base = emptyProject(SAMPLE_PROJECT_NAME);

  // Scale: 1 ft per plan unit, so polygon coordinates ARE feet — the example is
  // self-evidently dimensioned (40x60 + 24x30) without any imported underlay.
  const scaleFtPerUnit = 1;

  // Room A: a 40 (wide) x 60 (deep) Ordinary Hazard 1 zone. Polygon in plan units.
  const zoneA: Room = {
    id: makeId('room', 1),
    name: 'Sample Zone A (example)',
    hazard: 'ORDINARY_1',
    ceilingHt: 12,
    polygon: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 60 },
      { x: 0, y: 60 },
    ],
  };

  // Room B: a 24 x 30 Light-hazard zone, offset so it doesn't overlap Zone A.
  const zoneB: Room = {
    id: makeId('room', 2),
    name: 'Sample Zone B (example)',
    hazard: 'LIGHT',
    ceilingHt: 10,
    polygon: [
      { x: 50, y: 0 },
      { x: 74, y: 0 },
      { x: 74, y: 30 },
      { x: 50, y: 30 },
    ],
  };

  return {
    ...base,
    name: SAMPLE_PROJECT_NAME,
    building: {
      ...base.building,
      scaleFtPerUnit,
      source: 'manual',
      walls: [],
      rooms: [zoneA, zoneB],
    },
  };
}
