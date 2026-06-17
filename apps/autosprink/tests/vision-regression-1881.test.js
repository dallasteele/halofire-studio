import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelFromPlan } from '../src/engine/plan-pipeline.js';

function pointDistance(a, b) {
  return Math.hypot(Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1]));
}

function isOrphanWall(wall, walls, tolFt = 3) {
  const pts = [wall.a, wall.b];
  return pts.every((pt) => walls.every((other) => {
    if (other === wall) return true;
    return pointDistance(pt, other.a) > tolFt && pointDistance(pt, other.b) > tolFt;
  }));
}

function polygonArea(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

test('1881 canonical model is a building, not fragments', async () => {
  const pdfPath = 'apps/autosprink/plans/cooperative-1881/1881-architecturals.pdf';
  const { model } = await buildModelFromPlan(pdfPath, 8, {});
  const wallIds = new Set(model.walls.map((wall) => wall.id));
  const bbox = model.shell.bbox;

  assert.ok(model.walls.length >= 30 && model.walls.length <= 800, `walls=${model.walls.length}`);
  assert.ok(model.columns.length >= 10 && model.columns.length <= 90, `columns=${model.columns.length}`);
  assert.ok(model.doors.length >= 3 && model.doors.length <= 150, `doors=${model.doors.length}`);

  const orphanWalls = model.walls.filter((wall) => isOrphanWall(wall, model.walls, 3));
  assert.equal(orphanWalls.length, 0, `orphan walls=${orphanWalls.length}`);

  const zeroAreaRooms = model.rooms.filter((room) => polygonArea(room.poly || room.polygon) <= 0);
  assert.equal(zeroAreaRooms.length, 0, `zero-area rooms=${zeroAreaRooms.length}`);

  for (const column of model.columns) {
    assert.ok(column.x >= bbox.minX && column.x <= bbox.maxX, `column.x outside shell bbox: ${column.x}`);
    assert.ok(column.y >= bbox.minY && column.y <= bbox.maxY, `column.y outside shell bbox: ${column.y}`);
  }

  for (const door of model.doors) {
    assert.ok(typeof door.hostWallId === 'string' && wallIds.has(door.hostWallId), `door missing real host wall id: ${JSON.stringify(door)}`);
  }
});
