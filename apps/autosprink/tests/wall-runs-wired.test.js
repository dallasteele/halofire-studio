import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWallRuns } from '../src/engine/plan-wall-runs.js';
import { buildBuildingFromPlans } from '../src/engine/building-from-plan.js';

function stubThree() {
  class Group {
    constructor() { this.children = []; this.visible = true; this.userData = {}; this.name = ''; }
    add(child) { this.children.push(child); }
    traverse(fn) { fn(this); for (const child of this.children) fn(child); }
  }
  class Shape { moveTo() {} lineTo() {} closePath() {} }
  class ExtrudeGeometry { rotateX() {} }
  class BoxGeometry {}
  class Mesh {
    constructor() {
      this.position = { set() {}, y: 0 };
      this.rotation = { y: 0 };
      this.userData = {};
      this.name = '';
    }
  }
  class MeshStandardMaterial {}
  return { Group, Shape, ExtrudeGeometry, BoxGeometry, Mesh, MeshStandardMaterial };
}

function sampleWalls() {
  return [
    { a: [0, 0], b: [4, 0] },
    { a: [4, 0], b: [8, 0] },
    { a: [8, 0], b: [12, 0] },
    { a: [12, 0], b: [16, 0] },
    { a: [0, 10], b: [4, 10] },
    { a: [4, 10], b: [8, 10] },
    { a: [8, 10], b: [12, 10] },
    { a: [12, 10], b: [16, 10] },
    { a: [0, 0], b: [0, 10] },
    { a: [16, 0], b: [16, 10] },
    { a: [100, 100], b: [103, 100] },
    { a: [110, 100], b: [113, 100] },
    { a: [120, 100], b: [123, 100] },
    { a: [130, 100], b: [133, 100] },
    { a: [140, 100], b: [143, 100] },
  ];
}

test('plan wall runs are derived before rendering, with orphan runs dropped', () => {
  const walls = sampleWalls();
  const derived = buildWallRuns(walls);
  assert.equal(derived.meta.inputSegments, 15);
  assert.equal(derived.meta.runCount, 4);
  assert.equal(derived.meta.orphanRunsDropped, 5);
  assert.equal(derived.meta.shortRunsDropped, 0);
  assert.deepEqual(
    derived.runs.map((run) => ({ a: run.a, b: run.b, axis: run.axis })),
    [
      { a: [0, 0], b: [16, 0], axis: 'H' },
      { a: [0, 10], b: [16, 10], axis: 'H' },
      { a: [0, 0], b: [0, 10], axis: 'V' },
      { a: [16, 0], b: [16, 10], axis: 'V' },
    ],
  );

  const plan = {
    scaleFtPerUnit: 0.1481,
    scaleText: 'SCALE: 3/32" = 1\'',
    footprintFt: [[0, 0], [16, 0], [16, 10], [0, 10]],
    walls,
    rooms: [],
    stairs: [],
    provenance: 'test fixture — needs-verification',
  };
  const building = buildBuildingFromPlans(stubThree(), [{ level: 1, elevationFt: 0, plan }]);
  assert.equal(building.summary.perLevel[0].wallSource, 'wall-runs');
  assert.equal(building.summary.perLevel[0].wallSegmentsRaw, 15);
  assert.equal(building.summary.perLevel[0].wallRuns, 4);
  assert.equal(building.summary.perLevel[0].walls, 4);
  assert.equal(building.levels[0].wallRunsMeta.derivedAtRender, true);
  assert.equal(building.levels[0].wallRunsMeta.orphanRunsDropped, 5);
});
