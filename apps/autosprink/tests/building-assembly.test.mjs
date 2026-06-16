import test from 'node:test';
import assert from 'node:assert/strict';

import { cooperative1881BuildingFromExtractedPlan } from '../src/data/floorplans-server.js';
import { buildCadModel } from '../src/engine/cad-model.js';
import { buildBuildingFromPlans } from '../src/engine/building-from-plan.js';

function makeStubTHREE() {
  class Group {
    constructor() {
      this.children = [];
      this.userData = {};
      this.name = '';
      this.visible = true;
    }
    add(obj) { this.children.push(obj); }
    traverse(fn) {
      for (const child of this.children) {
        fn(child);
        if (typeof child.traverse === 'function') child.traverse(fn);
      }
    }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.userData = {};
      this.name = '';
      this.children = [];
      this.position = { set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      this.rotation = { y: 0 };
    }
    traverse(_fn) {}
  }
  class BoxGeometry { constructor(w, h, d) { this.w = w; this.h = h; this.d = d; } }
  class MeshBasicMaterial { constructor(opts) { Object.assign(this, opts); } }
  return { Group, Mesh, BoxGeometry, MeshBasicMaterial };
}

test('1881 extracted assembly produces a real building model with full-footprint CAD coverage', () => {
  const building = cooperative1881BuildingFromExtractedPlan();
  assert.ok(building, 'expected extracted 1881 building data');
  assert.equal(building.stories.length, 1);
  assert.ok(building.stories[0].spaces.length >= 10, 'expected extracted rooms, not one placeholder room');
  assert.ok(building.stories[0].walls.length >= 50, 'expected assembled wall runs, not a 4-wall envelope');

  const cad = buildCadModel(building);
  assert.ok(cad.counts.spaces >= 10, 'cad model should preserve extracted rooms');
  assert.ok(cad.counts.walls >= 50, 'cad model should preserve assembled walls');
  assert.ok(cad.counts.heads > 0, 'cad model should place sprinkler heads');

  const heads = cad.solids.filter((solid) => solid.kind === 'head');
  const xs = heads.map((head) => head.position[0]);
  const ys = heads.map((head) => head.position[1]);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  assert.ok(spanX >= 300, `expected near-full footprint width coverage, got ${spanX.toFixed(2)} ft`);
  assert.ok(spanY >= 60, `expected near-full footprint depth coverage, got ${spanY.toFixed(2)} ft`);
});

test('plan renderer counts every wall and column solid when extracted data provides them', () => {
  const THREE = makeStubTHREE();
  const wallRuns = Array.from({ length: 60 }, (_, i) => ({
    a: [i * 2, 0],
    b: [i * 2, 40],
  }));
  const columns = Array.from({ length: 55 }, (_, i) => ({
    x: 1 + (i % 11) * 10,
    y: 2 + Math.floor(i / 11) * 8,
    sizeFt: 1,
  }));
  const plan = {
    footprintFt: [[0, 0], [120, 0], [120, 40], [0, 40]],
    wallRuns,
    rooms: [
      { poly: [[0, 0], [120, 0], [120, 40], [0, 40]], kind: 'unknown', label: 'Plate', areaSqft: 4800, confidence: 0.5 },
    ],
    stairs: [],
    columns,
    provenance: 'synthetic test fixture',
  };
  const api = buildBuildingFromPlans(THREE, [{
    level: 1,
    elevationFt: 0,
    plan,
  }], {
    wallHeightFt: 14,
    wallThicknessFt: 0.5,
    slabThicknessFt: 0.75,
  });

  assert.equal(api.summary.perLevel[0].walls, 60);
  assert.equal(api.summary.perLevel[0].columns, 55);

  let wallMeshes = 0;
  let columnMeshes = 0;
  api.root.traverse((node) => {
    if (node?.userData?.kind === 'plan-wall') wallMeshes += 1;
    if (node?.userData?.kind === 'plan-column') columnMeshes += 1;
  });
  assert.equal(wallMeshes, 60);
  assert.equal(columnMeshes, 55);
});
