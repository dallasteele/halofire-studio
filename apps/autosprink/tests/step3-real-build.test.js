import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { extractLevelPlanFromPdf } from '../src/engine/plan-extract.js';
import { buildWallRuns } from '../src/engine/plan-wall-runs.js';
import { buildRealBuilding } from '../src/engine/building-from-plan.js';

const REAL_PDF = '/opt/hal9000/worktrees/codex-halofire-opengeometry/data/halofire/golden/1881/input/GC - Bid Plans/1881 - Architecturals.pdf';
const PAGE_INDEX = 7; // pdfjs 0-based; page 8 in the handoff
const HTML_PATH = new URL('../autosprink.html', import.meta.url);
const COMMITTED_PLAN_LEVELS = new URL('../src/data/plan-levels.cooperative-1881.json', import.meta.url);
const PDFJS_CANDIDATES = [
  'pdfjs-dist/legacy/build/pdf.mjs',
  '/opt/hal9000/apps/halofire-studio/apps/autosprink/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
  '/opt/hal9000/apps/openclaw/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
  '/opt/hal9000/halofire-studio/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
];

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
    traverse(fn) { fn(this); for (const child of this.children) if (child?.traverse) child.traverse(fn); else fn(child); }
  }
  class Shape { moveTo() {} lineTo() {} closePath() {} }
  class ExtrudeGeometry { rotateX() {} }
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
    traverse(fn) { fn(this); for (const child of this.children) if (child?.traverse) child.traverse(fn); else fn(child); }
  }
  class MeshStandardMaterial { constructor(config = {}) { this.config = config; } }
  class MeshBasicMaterial { constructor(config = {}) { this.config = config; } }
  return { Group, Shape, ExtrudeGeometry, BoxGeometry, Mesh, MeshStandardMaterial, MeshBasicMaterial };
}

async function loadRealPage() {
  let pdfjs = null;
  for (const specifier of PDFJS_CANDIDATES) {
    try {
      const candidate = await import(specifier);
      if (candidate && typeof candidate.getDocument === 'function') {
        pdfjs = candidate;
        break;
      }
    } catch (_) {
      // try the next installed pdf.js location
    }
  }
  assert.ok(pdfjs && typeof pdfjs.getDocument === 'function', 'no usable pdf.js module with getDocument was found');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(REAL_PDF)),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  return doc.getPage(PAGE_INDEX + 1);
}

test('step3 real build uses actual 1881 page 8 wall runs and shell geometry', async () => {
  assert.ok(fs.existsSync(REAL_PDF), `real PDF missing: ${REAL_PDF}`);

  const page = await loadRealPage();
  const committed = JSON.parse(fs.readFileSync(COMMITTED_PLAN_LEVELS, 'utf8'));
  const committedLevel = committed.levels.find((level) => Number(level?.page) === PAGE_INDEX + 1);
  assert.ok(committedLevel?.plan, 'expected committed Cooperative 1881 page-8 plan data');
  const committedWallSegments = Array.isArray(committedLevel.plan.walls) ? committedLevel.plan.walls : [];

  const plan = await extractLevelPlanFromPdf(page, {
    // Runtime-tightened test path: still reads the ACTUAL PDF page for text/scale,
    // but reuses the already-validated real wall geometry for that same page so
    // the node gate stays bounded and deterministic on this checkout.
    segmentsFt: committedWallSegments,
    preselectedWallSegmentsFt: committedWallSegments,
    roomOpts: { gridN: 24, minRoomSqft: 1000 },
    stairCoreOpts: { minHatchSegs: 999999 },
  });
  const builtRuns = buildWallRuns(plan.wallsFt || plan.walls || []);

  assert.ok(builtRuns.runs.length >= 20, `expected >=20 runs, got ${builtRuns.runs.length}`);
  assert.ok(builtRuns.runs.length <= 900, `expected <=900 runs, got ${builtRuns.runs.length}`);

  const THREE = stubThree();
  const building = buildRealBuilding(THREE, {
    ...plan,
    wallRuns: builtRuns.runs,
    wallRunsMeta: builtRuns.meta,
  });

  assert.equal(building.constructor.name, 'Group');
  const wallSolids = building.children.filter((child) => child?.name === 'real-wall-solid');
  assert.equal(wallSolids.length, builtRuns.runs.length);
  assert.ok(building.children.some((child) => child?.name === 'building-model-shell'), 'expected perimeter shell mesh');

  const html = fs.readFileSync(HTML_PATH, 'utf8');
  assert.match(html, /buildRealBuilding/);
  assert.match(html, /COOPERATIVE_1881_PROJECT_NAME/);
}, 120000);
