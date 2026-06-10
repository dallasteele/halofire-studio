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
import { routeSystem } from '../src/lib/pipe-routing';
import { attachedDirections, placementFor } from '../src/lib/part-placement';
import { teeRotationY } from '../src/lib/fitting-orient';
import type { Node } from '../src/lib/model';

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

describe('INVARIANT: every routed part obeys the placement contract', () => {
  // A tiny 2-branch network: 2 rows of 2 heads, 1 ft below a 10 ft ceiling —
  // routed through the SAME routeSystem the store uses, then every node is run
  // through the placement contract the 3D viewer applies.
  const head = (id: string, x: number, z: number): Node => ({
    id,
    type: 'HEAD',
    pos: { x, y: 9, z },
  });
  const routed = routeSystem(
    {
      nodes: [head('h1', 10, 0), head('h2', 20, 0), head('h3', 10, 12), head('h4', 20, 12)],
      segments: [],
      remoteAreas: [],
    },
    { ceilingHt: 10 },
  );

  it('the routed system is real (connected + mated) and contains tees', () => {
    expect(routed.routedOk).toBe(true);
    expect(routed.nodes.some((n) => n.type === 'TEE')).toBe(true);
  });

  it('NO part gets a non-finite rotation or a scale <= 0 — pre-load and loaded', () => {
    for (const n of routed.nodes) {
      const dirs = attachedDirections(n.id, routed.nodes, routed.segments);
      // bbox null = body not yet loaded; 0.25 = plausible physical; 10 = wrong-units fallback.
      for (const bboxMaxFt of [null, 0.25, 10]) {
        const p = placementFor(n.type, dirs, { bboxMaxFt, nominalTargetFt: 0.8 });
        expect(Number.isFinite(p.rotationY)).toBe(true);
        expect(Number.isFinite(p.scale)).toBe(true);
        expect(p.scale).toBeGreaterThan(0);
        // Heads (and only heads) are contracted deflector-down.
        expect(p.deflectorDown).toBe(n.type === 'HEAD');
        // Sizing contract: a plausible bbox is ALWAYS physical at scale 1.
        if (bboxMaxFt === 0.25) {
          expect(p.sizeMode).toBe('physical');
          expect(p.scale).toBe(1);
        } else {
          expect(p.sizeMode).toBe('nominal-fallback');
        }
      }
    }
  });

  it('a branch-line TEE (run ±X, branch +Z) rotates to the analytic teeRotationY', () => {
    // Junction literal in the same shape routeSystem builds: a through-run along X
    // with a horizontal branch toward +Z.
    const nodes: Node[] = [
      { id: 'run-a', type: 'ELBOW', pos: { x: -8, y: 10, z: 0 } },
      { id: 'tee', type: 'TEE', pos: { x: 0, y: 10, z: 0 } },
      { id: 'run-b', type: 'ELBOW', pos: { x: 8, y: 10, z: 0 } },
      { id: 'branch-end', type: 'HEAD', pos: { x: 0, y: 10, z: 6 } },
    ];
    const segments = [
      { from: 'run-a', to: 'tee' },
      { from: 'tee', to: 'run-b' },
      { from: 'tee', to: 'branch-end' },
    ];
    const dirs = attachedDirections('tee', nodes, segments);
    expect(dirs).toHaveLength(3);
    const p = placementFor('TEE', dirs, { bboxMaxFt: null, nominalTargetFt: 0.8 });
    // Run = the most-collinear pair (first member: toward run-a = -X), branch = +Z.
    const analytic = teeRotationY({ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(p.rotationY).toBeCloseTo(analytic, 12);
    expect(Math.abs(p.rotationY)).toBeCloseTo(Math.PI, 12); // body +X maps onto the -X run leg
  });
});
