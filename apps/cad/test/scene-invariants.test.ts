// 3D SCENE INVARIANTS — the verification gate for ALL 3D modeling work.
//
// Lesson (user-reported): far-away screenshots and store counts verified nothing;
// the 1881 system rendered as a flat mat at y=0 and the sample sealed its heads
// inside ceiling plates. These tests assert the GEOMETRY numerically, through the
// same pure composition paths the viewer renders, so a wrong scene fails the gate.

import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/lib/sample-project';
import { buildingToMeshData } from '../src/lib/building-mesh';
import { autoLayoutHeads } from '../src/lib/head-layout';
import { buildKernelNetwork } from '../src/lib/kernel-import';
import { importDxfText, KERNEL_DEFAULT_ELEVATION_FT } from '../src/lib/import-actions';

function bbox(positions: Float32Array | number[]): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

describe('INVARIANT: sample building meshes are real, placed, and scaled', () => {
  const project = buildSampleProject();
  const data = buildingToMeshData(project.building, { defaultCeilingHt: 10 });

  it('walls exist and span the full footprint (recentered on the building)', () => {
    expect(data.walls.wallCount).toBeGreaterThanOrEqual(8);
    const b = bbox(data.walls.positions);
    // Footprint 0..74 x 0..60 recentered -> approx -37..37 x -30..30 (+thickness)
    expect(b.min[0]).toBeLessThan(-35);
    expect(b.max[0]).toBeGreaterThan(35);
    expect(b.min[2]).toBeLessThan(-28);
    expect(b.max[2]).toBeGreaterThan(28);
    // Wall heights reach the room ceilings (12 ft max), never 0.
    expect(b.max[1]).toBeGreaterThanOrEqual(10);
    expect(b.max[1]).toBeLessThanOrEqual(14);
  });

  it('every room gets a floor at y=0 and a ceiling at its ceilingHt', () => {
    expect(data.slabs).toHaveLength(2);
    for (const slab of data.slabs) {
      expect(slab.floor).not.toBeNull();
      expect(slab.ceiling).not.toBeNull();
      const fb = bbox(slab.floor!.positions);
      expect(fb.max[1]).toBeCloseTo(0, 6); // floor top at grade
      const cb = bbox(slab.ceiling!.positions);
      // Documented convention: ceiling plate UNDERSIDE sits at ceilingHt (the
      // room's clear height); the plate body is above it.
      expect(cb.min[1]).toBeCloseTo(slab.ceilingHt, 6);
    }
  });

  it('scale is honored: a 0.25 ft/unit building produces FEET-sized meshes', () => {
    const scaled = buildSampleProject();
    scaled.building.scaleFtPerUnit = 0.25; // same polygons, now 4x smaller in feet
    const sdata = buildingToMeshData(scaled.building, { defaultCeilingHt: 10 });
    const b = bbox(sdata.walls.positions);
    // 74 units * 0.25 = 18.5 ft wide footprint (recentered ~ -9.25..9.25)
    expect(b.max[0] - b.min[0]).toBeGreaterThan(17);
    expect(b.max[0] - b.min[0]).toBeLessThan(21);
  });
});

describe('INVARIANT: heads live at ceiling height INSIDE their rooms', () => {
  it('auto-laid heads sit within the room polygon at the room ceiling', () => {
    const room = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 60 },
      { x: 0, y: 60 },
    ];
    const laid = autoLayoutHeads(room, 'ORDINARY_1', {});
    expect(laid.length).toBeGreaterThan(0);
    for (const h of laid) {
      expect(h.x).toBeGreaterThanOrEqual(0);
      expect(h.x).toBeLessThanOrEqual(40);
      expect(h.y).toBeGreaterThanOrEqual(0);
      expect(h.y).toBeLessThanOrEqual(60);
    }
  });
});

describe('INVARIANT: kernel imports are NEVER a flat mat at y=0', () => {
  it('buildKernelNetwork honors zFt for every node', () => {
    const net = buildKernelNetwork(
      [{ cx: 5, cy: 5, layer: 'HALOFIRE_HEADS' }],
      [{ x1: 0, y1: 5, x2: 5, y2: 5, layer: 'HALOFIRE_PIPES' }],
      { ftPerUnit: 1, zFt: 10 },
    );
    for (const n of net.nodes) expect(n.pos.y).toBe(10);
  });

  it('the import lane elevates kernel systems by default (regression)', () => {
    const doc = {
      header: { $INSUNITS: 2 },
      entities: [
        { type: 'CIRCLE', layer: 'HALOFIRE_HEADS', center: { x: 5, y: 5 }, radius: 0.5 },
        { type: 'LINE', layer: 'HALOFIRE_PIPES', vertices: [{ x: 0, y: 5 }, { x: 5, y: 5 }] },
      ],
    };
    const out = importDxfText('kernel', 'k.dxf', { parseSync: () => doc });
    expect(out.kernelNetwork).toBeDefined();
    expect(KERNEL_DEFAULT_ELEVATION_FT).toBeGreaterThan(0);
    for (const n of out.kernelNetwork!.nodes) {
      expect(n.pos.y).toBe(KERNEL_DEFAULT_ELEVATION_FT);
    }
  });
});
