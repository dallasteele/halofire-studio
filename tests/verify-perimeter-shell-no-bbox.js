const test = require('node:test');
const assert = require('node:assert/strict');

function stubThree() {
  class Group {
    constructor() {
      this.type = 'Group';
      this.name = '';
      this.children = [];
      this.userData = {};
      this.visible = true;
      this.position = { x: 0, y: 0, z: 0 };
      this.rotation = { x: 0, y: 0, z: 0 };
    }
    add(child) {
      this.children.push(child);
    }
  }

  class Shape {
    moveTo() {}
    lineTo() {}
    closePath() {}
  }

  class ExtrudeGeometry {
    constructor() {
      this.type = 'ExtrudeGeometry';
    }
    rotateX() {
      return this;
    }
  }

  class BoxGeometry {
    constructor(width, height, depth) {
      this.type = 'BoxGeometry';
      this.width = width;
      this.height = height;
      this.depth = depth;
    }
  }

  class MeshStandardMaterial {
    constructor(props = {}) {
      this.type = 'MeshStandardMaterial';
      Object.assign(this, props);
    }
  }

  class Mesh {
    constructor(geometry, material) {
      this.type = 'Mesh';
      this.geometry = geometry;
      this.material = material;
      this.name = '';
      this.userData = {};
      this.children = [];
      this.visible = true;
      this.position = {
        x: 0,
        y: 0,
        z: 0,
        set: (x, y, z) => {
          this.position.x = x;
          this.position.y = y;
          this.position.z = z;
        },
      };
      this.rotation = { x: 0, y: 0, z: 0 };
    }
    add(child) {
      this.children.push(child);
    }
  }

  return { Group, Shape, ExtrudeGeometry, BoxGeometry, MeshStandardMaterial, Mesh };
}

function collectPerimeterShellMatches(node, matches = []) {
  if (!node || typeof node !== 'object') return matches;

  const isPerimeterShell = node.name === 'plan-perimeter-shell'
    || node?.userData?.kind === 'plan-perimeter-shell';

  if (isPerimeterShell) {
    matches.push({
      name: node.name ?? null,
      userDataKind: node?.userData?.kind ?? null,
      geometryType: node?.geometry?.type ?? null,
    });
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) collectPerimeterShellMatches(child, matches);
  }

  return matches;
}

test('makePerimeterShell output contains no plan-perimeter-shell box element', async () => {
  const { buildBuildingFromPlans } = await import('../apps/autosprink/src/engine/building-from-plan.js');
  const plan = {
    footprintFt: [[0, 0], [40, 0], [40, 20], [0, 20]],
    walls: [
      { a: [0, 0], b: [40, 0] },
      { a: [40, 0], b: [40, 20] },
      { a: [40, 20], b: [0, 20] },
      { a: [0, 20], b: [0, 0] },
    ],
    rooms: [],
    stairs: [],
  };

  const output = buildBuildingFromPlans(stubThree(), [{ level: 1, elevationFt: 0, plan }]);
  const parsedOutput = JSON.parse(JSON.stringify(output.root));
  const matches = collectPerimeterShellMatches(parsedOutput);

  assert.deepEqual(matches, []);
});
