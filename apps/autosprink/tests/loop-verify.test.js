import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyPass } from '../src/engine/loop-verify.js';

function rect(x1, y1, x2, y2) {
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}

function buildPassingModel() {
  return {
    footprint: { polygon: rect(0, 0, 20, 10), contourLengthFt: 60 },
    shell: { polygon: rect(0, 0, 20, 10) },
    planInkContourLengthFt: 60,
    wallRuns: [
      { a: [0, 0], b: [20, 0] },
      { a: [20, 0], b: [20, 10] },
      { a: [20, 10], b: [0, 10] },
      { a: [0, 10], b: [0, 0] },
    ],
    grid: { cols: 2, rows: 2 },
    columns: [
      { x: 3, y: 2 },
      { x: 17, y: 2 },
      { x: 3, y: 8 },
      { x: 17, y: 8 },
    ],
    doors: [
      { position: [0, 2] },
      { position: [20, 8] },
    ],
    rooms: [
      { name: 'Room A', polygon: rect(0, 0, 10, 10), classification: 'indoor' },
      { name: 'Room B', polygon: rect(10, 0, 20, 10), classification: 'indoor' },
      { name: 'Patio', polygon: rect(22, 0, 26, 4), classification: 'outdoor' },
    ],
  };
}

test('verifyPass returns ok for a model that satisfies every loop check', () => {
  const result = verifyPass(buildPassingModel(), 'rooms');
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test('verifyPass catches shell area below 80% of the footprint area', () => {
  const model = buildPassingModel();
  model.shell = { polygon: rect(0, 0, 10, 10) };
  const result = verifyPass(model, 'shell');
  assert.equal(result.ok, false);
  assert.match(result.violations.join('\n'), /shell area .* below 80%/);
});

test('verifyPass catches wall recall below 90% of the plan-ink contour length', () => {
  const model = buildPassingModel();
  model.wallRuns = [
    { a: [0, 0], b: [20, 0] },
    { a: [20, 0], b: [20, 5] },
    { a: [20, 10], b: [0, 10] },
  ];
  const result = verifyPass(model, 'walls');
  assert.equal(result.ok, false);
  assert.match(result.violations.join('\n'), /wall total length .* below 90%/);
});

test('verifyPass catches column count outside the 30% grid estimate tolerance', () => {
  const model = buildPassingModel();
  model.columns = [{ x: 3, y: 2 }];
  const result = verifyPass(model, 'columns');
  assert.equal(result.ok, false);
  assert.match(result.violations.join('\n'), /column count 1 is outside the 30% tolerance band/);
});

test('verifyPass catches doors that do not touch an existing wall within 1 ft', () => {
  const model = buildPassingModel();
  model.doors = [{ position: [10, 5] }];
  const result = verifyPass(model, 'doors');
  assert.equal(result.ok, false);
  assert.match(result.violations.join('\n'), /door 1 does not touch an existing wall within 1 ft/);
});

test('verifyPass catches indoor rooms that have no door', () => {
  const model = buildPassingModel();
  model.doors = [{ position: [0, 2] }];
  const result = verifyPass(model, 'rooms');
  assert.equal(result.ok, false);
  assert.match(result.violations.join('\n'), /Room B has no door and is not classified as outdoor/);
});

test('verifyPass catches columns that need deduping within 4 ft', () => {
  const model = buildPassingModel();
  model.grid = { cols: 1, rows: 2 };
  model.columns = [
    { x: 3, y: 2 },
    { x: 6.5, y: 2 },
  ];
  const result = verifyPass(model, 'columns');
  assert.equal(result.ok, false);
  assert.match(result.violations.join('\n'), /columns 1 and 2 are within 4 ft of each other/);
});
