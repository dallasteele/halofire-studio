import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBuildingFromPlans } from '../apps/autosprink/src/engine/building-from-plan.js';

function stubThree() {
  class Group {
    constructor() {
      this.children = [];
      this.visible = true;
      this.userData = {};
      this.name = '';
    }
    add(child) {
      this.children.push(child);
    }
    traverse(fn) {
      fn(this);
      for (const child of this.children) {
        if (child && typeof child.traverse === 'function') child.traverse(fn);
        else fn(child);
      }
    }
  }

  class Shape {
    moveTo() {}
    lineTo() {}
    closePath() {}
  }

  class ExtrudeGeometry {
    rotateX() {}
  }

  class BoxGeometry {
    rotateY() { return this; }
    translate() { return this; }
    dispose() {}
  }

  class Mesh {
    constructor() {
      this.position = { set() {}, y: 0 };
      this.rotation = { y: 0 };
      this.userData = {};
      this.name = '';
      this.children = [];
    }
    add(child) {
      this.children.push(child);
    }
    traverse(fn) {
      fn(this);
      for (const child of this.children) {
        if (child && typeof child.traverse === 'function') child.traverse(fn);
        else fn(child);
      }
    }
  }

  class MeshStandardMaterial {}

  return { Group, Shape, ExtrudeGeometry, BoxGeometry, Mesh, MeshStandardMaterial };
}

test('open wall runs do not synthesize a plan-perimeter-shell bbox box', () => {
  const THREE = stubThree();
  const openWallRuns = [
    { a: [0, 0], b: [40, 0] },
    { a: [40, 0], b: [40, 30] },
    { a: [40, 30], b: [10, 30] },
  ];

  const plan = {
    scaleFtPerUnit: 0.1481,
    scaleText: 'SCALE: 3/32" = 1\'-0"',
    footprintFt: [[0, 0], [40, 0], [40, 30], [0, 30]],
    wallRuns: openWallRuns,
    walls: [
      { a: [0, 0], b: [40, 0] },
      { a: [40, 0], b: [40, 30] },
      { a: [40, 30], b: [0, 30] },
      { a: [0, 30], b: [0, 0] },
    ],
    rooms: [],
    stairs: [],
    provenance: 'test fixture — needs-verification',
  };

  const result = buildBuildingFromPlans(THREE, [{ level: 1, elevationFt: 0, plan }]);
  const levelGroup = result.levels[0].group;

  const topLevelNames = levelGroup.children.map((child) => child.name);
  assert.equal(topLevelNames.includes('plan-perimeter-shell'), false);

  const renderedWalls = levelGroup.children.filter((child) => child.name === 'plan-wall');
  assert.equal(renderedWalls.length, openWallRuns.length);
  assert.equal(result.summary.perLevel[0].wallSource, 'wall-runs');
  assert.equal(result.summary.perLevel[0].wallRuns, openWallRuns.length);
  assert.equal(result.summary.perLevel[0].walls, openWallRuns.length);

  const traversedNames = [];
  levelGroup.traverse((node) => traversedNames.push(node?.name ?? ''));
  assert.equal(traversedNames.includes('plan-perimeter-shell'), false);
});
