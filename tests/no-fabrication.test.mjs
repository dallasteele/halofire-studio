import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildBuildingFromPlans, buildBuildingSolids } from '../apps/autosprink/src/engine/building-from-plan.js';
import { detectColumnMarkers, detectColumns } from '../apps/autosprink/src/engine/structure-from-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '../apps/autosprink/src/data/plan-levels.cooperative-1881.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const level1 = fixture.levels.find((level) => Number(level.level) === 1);

function stubThree() {
  class Group {
    constructor() {
      this.children = [];
      this.visible = true;
      this.userData = {};
      this.name = '';
      this.position = { set() {}, y: 0 };
      this.rotation = { y: 0 };
    }
    add(child) { this.children.push(child); }
    traverse(fn) {
      fn(this);
      for (const child of this.children) {
        if (child && typeof child.traverse === 'function') child.traverse(fn);
        else fn(child);
      }
    }
  }
  class BoxGeometry {}
  class Mesh {
    constructor() {
      this.children = [];
      this.visible = true;
      this.userData = {};
      this.name = '';
      this.position = { set() {}, y: 0 };
      this.rotation = { y: 0 };
    }
    traverse(fn) { fn(this); }
  }
  class MeshStandardMaterial {}
  return { Group, BoxGeometry, Mesh, MeshStandardMaterial };
}

function markerAt(cx, cy) {
  const segs = [];
  for (let i = 0; i < 8; i++) {
    segs.push({ x1: cx - 0.5, y1: cy + i * 0.1 - 0.4, x2: cx + 0.5, y2: cy + i * 0.1 - 0.4 });
  }
  return segs;
}

test('1881 L1 stays open and every emitted wall cites source ink', () => {
  assert.ok(level1, 'expected the 1881 fixture to include level 1');

  const { wallSolids, columnSolids, roomPolys } = buildBuildingSolids(level1);
  assert.equal(wallSolids.length, level1.plan.wallRuns.length, 'wall solids should track the verified wall-run extraction');
  assert.equal(columnSolids.length, 0, 'the checked-in 1881 extraction has no real column markers extracted yet');
  assert.equal(roomPolys.length, level1.plan.rooms.length, 'room polygons should be preserved');
  for (const wall of wallSolids) {
    assert.ok(wall.sourceInkRef, 'every wall solid must carry a source-ink reference');
  }

  const building = buildBuildingFromPlans(stubThree(), [level1], { includeRooms: false });
  const names = [];
  const walls = [];
  building.root.traverse((node) => {
    if (!node) return;
    if (node.name) names.push(node.name);
    if (node.userData && node.userData.kind === 'plan-wall') walls.push(node);
  });

  assert.ok(!names.includes('plan-perimeter-shell'), 'no bbox perimeter shell may be emitted');
  assert.ok(!names.some((name) => String(name).startsWith('footprint-slab:')), 'bbox-derived footprint slabs must be omitted');
  assert.equal(walls.length, level1.plan.wallRuns.length, 'the 3D wall count should match the verified wall runs');
  for (const wall of walls) {
    assert.ok(wall.userData.sourceInkRef, 'every emitted 3D wall must carry a source-ink reference');
  }
});

test('column emission follows detectColumnMarkers, not grid intersections', () => {
  const grid = { xs: [0, 20], ys: [0, 20], labels: { cols: ['1', '2'], rows: ['A', 'B'] } };
  const segs = markerAt(0, 0);

  const markerRes = detectColumnMarkers(segs, { minMarkerSegs: 4, markerRadiusFt: 2.5 });
  const colRes = detectColumns(grid, segs, [], { minMarkerSegs: 4, markerRadiusFt: 2.5 });

  assert.equal(markerRes.markers.length, 1, 'exactly one real marker cluster should be found');
  assert.equal(colRes.columns.length, markerRes.markers.length, 'columns must come only from real marker clusters');
  assert.notEqual(colRes.columns.length, grid.xs.length * grid.ys.length, 'columns must not be synthesized at every grid intersection');
  assert.deepEqual(
    { x: colRes.columns[0].x, y: colRes.columns[0].y },
    { x: 0, y: 0 },
    'the emitted column should anchor to the nearest real labeled datum once a marker exists',
  );
});

test('wall and column solids fail closed without source ink', () => {
  assert.throws(
    () => buildBuildingSolids({ wallRuns: [{ a: [0, 0], b: [10, 0] }] }),
    /source-ink reference/,
  );
  assert.throws(
    () => buildBuildingSolids({ columns: [{ x: 1, y: 2, sizeFt: 1 }] }),
    /source-ink reference/,
  );
});
