import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDropConnections } from '../src/engine/drop-connect.js';
import { pipeOdIn } from '../src/components/openscad/part-dims.js';

function model(solids) {
  return { solids };
}

function pipe(from, to, diameterIn = 1.25, extra = {}) {
  return { kind: 'pipe', from, to, diameterIn, ...extra };
}

function head(position, name, extra = {}) {
  return { kind: 'head', position, name, ...extra };
}

test('drop reducer sits exactly between the drop nipple bottom and head top with true ODs', () => {
  const branchZ = 12;
  const headZ = 9.5;
  const m = model([
    pipe([0, 0, branchZ], [40, 0, branchZ], 1.5, { name: 'branch', role: 'branch' }),
    head([20, 0, headZ], 'h1', { orientation: 'pendent', thread: '1/2 NPT' }),
  ]);

  const result = buildDropConnections(m);
  const drop = result.added.find((s) => s.kind === 'pipe' && s.connKind === 'drop');
  const reducer = result.added.find((s) => s.kind === 'component' && s.componentKey === 'fitting_reducer');

  assert.ok(drop, 'expected generated drop nipple');
  assert.ok(reducer, 'expected generated reducer component');
  assert.ok(reducer.position, 'expected reducer center position');
  assert.ok(reducer.pipePort, 'expected reducer pipePort');
  assert.ok(reducer.headPort, 'expected reducer headPort');

  const expectedLengthFt = 2 / 12;
  const expectedPipePortZ = headZ + expectedLengthFt;
  const expectedCenterZ = headZ + expectedLengthFt / 2;

  assert.equal(drop.from[2], branchZ);
  assert.ok(Math.abs(drop.to[2] - expectedPipePortZ) < 1e-3, `expected drop bottom z ${expectedPipePortZ}, got ${drop.to[2]}`);
  assert.ok(Math.abs(reducer.pipePort[2] - expectedPipePortZ) < 1e-3, `expected reducer pipePort z ${expectedPipePortZ}, got ${reducer.pipePort[2]}`);
  assert.equal(reducer.headPort[2], headZ);
  assert.ok(Math.abs(reducer.topPort[2] - expectedPipePortZ) < 1e-3, `expected reducer topPort z ${expectedPipePortZ}, got ${reducer.topPort[2]}`);
  assert.equal(reducer.bottomPort[2], headZ);
  assert.ok(Math.abs(reducer.lengthFt - expectedLengthFt) < 1e-3, `expected reducer length ${expectedLengthFt}ft, got ${reducer.lengthFt}`);
  assert.ok(Math.abs(reducer.position[2] - expectedCenterZ) < 1e-3, `expected reducer center z ${expectedCenterZ}, got ${reducer.position[2]}`);
  assert.ok(Math.abs(reducer.topOdIn - pipeOdIn(drop.diameterIn)) < 1e-3, `expected top OD ${pipeOdIn(drop.diameterIn)}in, got ${reducer.topOdIn}`);
  assert.ok(Math.abs(reducer.bottomOdIn - 0.84) < 1e-3, `expected bottom OD 0.84in, got ${reducer.bottomOdIn}`);
});
