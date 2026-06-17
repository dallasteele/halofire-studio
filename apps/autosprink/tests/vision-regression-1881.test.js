import test from 'node:test';
import assert from 'node:assert/strict';

import { buildModelFromPlan } from '../src/engine/plan-pipeline.js';

const PDF_PATH = 'apps/autosprink/plans/cooperative-1881/1881-architecturals.pdf';
const PAGE = 8;

function inBbox(point, bbox) {
  return point[0] >= bbox.minX
    && point[0] <= bbox.maxX
    && point[1] >= bbox.minY
    && point[1] <= bbox.maxY;
}

test('1881 page 8 builds a real building model instead of fragments', async () => {
  const model = await buildModelFromPlan({ pdfPath: PDF_PATH, page: PAGE });
  const wallIds = new Set(model.wallIndex.map((wall) => wall.id));

  assert.ok(model.walls.length >= 30, `expected at least 30 walls, got ${model.walls.length}`);
  assert.ok(model.walls.length <= 800, `expected at most 800 walls, got ${model.walls.length}`);

  assert.ok(model.columns.length >= 10, `expected at least 10 columns, got ${model.columns.length}`);
  assert.ok(model.columns.length <= 90, `expected at most 90 columns, got ${model.columns.length}`);

  assert.ok(model.doors.length >= 3, `expected at least 3 doors, got ${model.doors.length}`);
  assert.ok(model.doors.length <= 150, `expected at most 150 doors, got ${model.doors.length}`);

  assert.equal(model.orphanWalls.length, 0, `expected no orphan walls, got ${model.orphanWalls.length}`);
  assert.equal(model.rooms.filter((room) => !(room.areaSqft > 0)).length, 0, 'expected no zero-area rooms');

  for (const column of model.columns) {
    assert.ok(
      inBbox([column.x, column.y], model.shell.bbox),
      `column ${column.id} lies outside shell bbox`,
    );
  }

  for (const door of model.doors) {
    assert.ok(wallIds.has(door.wallId), `door ${door.id} references missing wall ${door.wallId}`);
  }
});
