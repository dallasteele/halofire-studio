import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBuildingFromPlan } from '../src/engine/building-from-plan.js';

function stubThree() {
  class Group {
    constructor() {
      this.children = [];
      this.visible = true;
      this.userData = {};
      this.name = '';
      this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      this.rotation = { x: 0, y: 0, z: 0 };
    }
    add(child) { this.children.push(child); }
  }
  class Shape {
    moveTo() {}
    lineTo() {}
    closePath() {}
  }
  class ExtrudeGeometry {
    rotateX() {}
  }
  class BoxGeometry {}
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.children = [];
      this.visible = true;
      this.userData = {};
      this.name = '';
      this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      this.rotation = { x: 0, y: 0, z: 0 };
    }
    add(child) { this.children.push(child); }
  }
  class MeshStandardMaterial {
    constructor(config = {}) { this.config = config; }
  }
  class MeshBasicMaterial {
    constructor(config = {}) { this.config = config; }
  }
  return { Group, Shape, ExtrudeGeometry, BoxGeometry, Mesh, MeshStandardMaterial, MeshBasicMaterial };
}

test('buildBuildingFromPlan renders the canonical BuildingModel and preserves hosted door cuts', () => {
  const THREE = stubThree();
  const model = {
    name: 'Synthetic Plan',
    units: 'ft',
    shell: {
      outline: [[0, 0], [20, 0], [20, 12], [0, 12]],
      areaSqft: 240,
      bbox: { minX: 0, minY: 0, maxX: 20, maxY: 12 },
    },
    grid: { xs: [0, 10, 20], ys: [0, 12], labels: { cols: ['1', '2', '3'], rows: ['A', 'B'] } },
    zones: [{ id: 'zone-1', kind: 'unit', poly: [[0, 0], [20, 0], [20, 12], [0, 12]] }],
    walls: [
      { a: [0, 0], b: [20, 0], thicknessFt: 0.5, type: 'exterior' },
      { a: [10, 0], b: [10, 12], thicknessFt: 0.5, type: 'interior' },
    ],
    columns: [
      { x: 4, y: 4, sizeFt: 1 },
      { x: 16, y: 8, sizeFt: 1.5 },
    ],
    doors: [
      { hostWall: 0, position: [10, 0], widthFt: 4, type: 'door' },
    ],
    openings: [],
    rooms: [],
  };

  const group = buildBuildingFromPlan(THREE, model, { wallHeightFt: 9 });
  const topLevelNames = group.children.map((child) => child.name);
  const wallGroups = group.children.filter((child) => child.name === 'building-model-wall');
  const columnMeshes = group.children.filter((child) => child.name === 'building-model-column');
  const shellMeshes = group.children.filter((child) => child.name === 'building-model-shell');

  assert.equal(shellMeshes.length, 1);
  assert.equal(wallGroups.length, model.walls.length);
  assert.equal(columnMeshes.length, model.columns.length);
  assert.ok(topLevelNames.includes('building-model-floor'));
  assert.ok(topLevelNames.includes('building-model-roof'));

  const cutWall = wallGroups.find((wallGroup) => wallGroup.userData.cutCount === 1);
  assert.ok(cutWall, 'expected one wall group to carry the hosted door cut');
  assert.equal(cutWall.children.length, 2, 'a centered 4ft door should split the 20ft wall into two spans');
  assert.deepEqual(cutWall.userData.cuts[0].center, [10, 0]);
  assert.equal(group.userData.summary.cutWalls, 1);
});
