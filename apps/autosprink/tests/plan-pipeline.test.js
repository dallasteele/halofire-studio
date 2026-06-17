import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelFromPlan } from '../src/engine/plan-pipeline.js';
import { validateBuildingModel } from '../src/engine/building-model.js';

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

test('buildModelFromPlan creates a validated canonical model for cooperative-1881 page 8', async () => {
  const pdfPath = 'apps/autosprink/plans/cooperative-1881/1881-architecturals.pdf';
  const { model, passesRun } = await buildModelFromPlan(pdfPath, 8, {});

  assert.ok(Array.isArray(model.shell.outline));
  assert.ok(model.shell.outline.length >= 4);
  assert.ok(Array.isArray(model.walls));
  assert.ok(model.walls.length > 20);
  assert.equal(validateBuildingModel(model), true);
  assert.deepEqual(passesRun, [
    'pass1-footprint-grid',
    'pass2-zones',
    'pass3-walls',
    'pass4-columns',
    'pass5-doors',
    'pass6-openings',
    'pass7-rooms',
  ]);

  const orphanWalls = model.walls.filter((wall) => isOrphanWall(wall, model.walls, 3));
  assert.equal(orphanWalls.length, 0);
});
