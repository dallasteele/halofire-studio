import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildBuildingSolids } from '../apps/autosprink/src/engine/building-from-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '../apps/autosprink/src/data/plan-levels.cooperative-1881.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const level1 = fixture.levels.find((level) => Number(level.level) === 1);

test('1881 level 1 assembles the extracted interior walls as 14 ft standing solids', () => {
  assert.ok(level1, 'expected the 1881 fixture to include level 1');
  const { wallSolids, columnSolids, roomPolys } = buildBuildingSolids(level1);

  assert.ok(wallSolids.length >= 50, `expected at least 50 wall solids, got ${wallSolids.length}`);
  assert.equal(wallSolids.length, level1.plan.wallRuns.length, 'wall solids should track the verified wall-run extraction');
  assert.equal(roomPolys.length, level1.plan.rooms.length, 'room polygons should be preserved for every extracted room');

  for (const solid of wallSolids) {
    assert.ok(Math.abs(solid.heightFt - 14) < 0.001, `expected a 14 ft wall solid, got ${solid.heightFt}`);
    assert.equal(solid.baseZFt, 0, 'wall solids should start at the level floor');
  }

  assert.equal(columnSolids.length, 0, 'the checked-in 1881 extraction has no plan.columns payload yet, so the assembler must not fabricate columns');
  assert.match(fixture.structuralSheetsNote, /not yet extracted/i, 'fixture note should explain why structural columns are absent');
});

test('buildBuildingSolids emits a standing solid for every extracted column when columns are present', () => {
  const syntheticColumns = Array.from({ length: 55 }, (_, index) => ({
    x: index * 2,
    y: index,
    sizeFt: 1.5,
    source: 'synthetic-test-column',
  }));
  const { wallSolids, columnSolids, roomPolys } = buildBuildingSolids({
    columns: syntheticColumns,
    wallRuns: [{ a: [0, 0], b: [10, 0] }],
    rooms: [{ poly: [[0, 0], [10, 0], [10, 10], [0, 10]] }],
  });

  assert.equal(wallSolids.length, 1);
  assert.equal(roomPolys.length, 1);
  assert.equal(columnSolids.length, syntheticColumns.length);
  for (const solid of columnSolids) {
    assert.ok(Math.abs(solid.heightFt - 14) < 0.001, `expected a 14 ft column solid, got ${solid.heightFt}`);
    assert.equal(solid.baseZFt, 0, 'column solids should start at the level floor');
  }
});
