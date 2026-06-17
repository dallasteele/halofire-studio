import test from 'node:test';
import assert from 'node:assert/strict';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractDoorsFromPdf } from '../src/engine/door-extractor.js';

const ARC_K = 0.5522847498;

function pushOp(opList, fn, args) {
  opList.fnArray.push(fn);
  opList.argsArray.push(args);
}

function addDoorPattern(opList, cx, cy, radius) {
  const k = ARC_K * radius;
  pushOp(opList, OPS.moveTo, [cx + radius, cy]);
  pushOp(opList, OPS.curveTo, [
    cx + radius, cy + k,
    cx + k, cy + radius,
    cx, cy + radius,
  ]);
  pushOp(opList, OPS.moveTo, [cx + radius, cy]);
  pushOp(opList, OPS.lineTo, [cx, cy]);
}

function buildMockOpList() {
  const opList = { fnArray: [], argsArray: [] };
  addDoorPattern(opList, 0, 0, 3);
  addDoorPattern(opList, 20, 0, 2.5);
  addDoorPattern(opList, 40, 0, 3.2);
  addDoorPattern(opList, 60, 0, 3);
  addDoorPattern(opList, 80, 0, 2.8);
  return opList;
}

function chordGapWalls(cx, cy, radius, flankFt = 2) {
  const start = { x: cx + radius, y: cy };
  const end = { x: cx, y: cy + radius };
  const chordDx = start.x - end.x;
  const chordDy = start.y - end.y;
  const chordLen = Math.hypot(chordDx, chordDy);
  const ux = chordDx / chordLen;
  const uy = chordDy / chordLen;
  return [
    { a: [end.x - ux * flankFt, end.y - uy * flankFt], b: [end.x, end.y] },
    { a: [start.x, start.y], b: [start.x + ux * flankFt, start.y + uy * flankFt] },
  ];
}

test('extractDoorsFromPdf returns only the doors with arc, leaf line, and wall gap evidence', async () => {
  const page = { getOperatorList: async () => buildMockOpList() };
  const walls = [
    ...chordGapWalls(0, 0, 3),
    ...chordGapWalls(20, 0, 2.5),
    ...chordGapWalls(40, 0, 3.2),
    { a: [58, 4], b: [62, 4] },
    { a: [78, 5], b: [83, 5] },
  ];

  const doors = await extractDoorsFromPdf(page, walls);

  assert.equal(doors.length, 3);
  assert.deepEqual(
    doors.map((door) => door.position),
    [[0, 0], [20, 0], [40, 0]],
  );
  for (const door of doors) {
    assert.equal(door.kind, 'door');
    assert.equal(door.confidence, 'medium');
    assert.equal(door.evidence, 'arc+adjacent-line+wall-gap');
    assert.equal(door.needsVerification, true);
    assert.equal(door.hostWalls.length, 2);
  }
});
