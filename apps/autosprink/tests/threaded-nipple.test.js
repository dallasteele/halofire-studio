import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { dropNippleScad } from '../src/components/openscad/generators.js';

function renderDropNippleStl(scad) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-threaded-nipple-'));
  const scadPath = path.join(tempDir, 'drop_nipple.scad');
  const stlPath = path.join(tempDir, 'drop_nipple.stl');

  try {
    fs.writeFileSync(scadPath, scad, 'utf8');
    const rendered = spawnSync('openscad', ['-q', '-o', stlPath, scadPath], {
      cwd: tempDir,
      encoding: 'utf8',
    });
    assert.equal(
      rendered.status,
      0,
      `openscad failed for threaded nipple render:\nstdout:\n${rendered.stdout}\nstderr:\n${rendered.stderr}`,
    );
    return fs.readFileSync(stlPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function countStlVertices(stlBuffer) {
  if (stlBuffer.length >= 84) {
    const triangles = stlBuffer.readUInt32LE(80);
    if (84 + triangles * 50 === stlBuffer.length) return triangles * 3;
  }
  const ascii = stlBuffer.toString('utf8');
  const explicitVertices = ascii.match(/\bvertex\b/g);
  if (explicitVertices) return explicitVertices.length;
  const facets = ascii.match(/\bfacet normal\b/g);
  return facets ? facets.length * 3 : 0;
}

test('drop nipple uses helical thread geometry with real rendered detail', () => {
  const scad = dropNippleScad({ nominalIn: 1 });
  assert.match(scad, /linear_extrude/);
  assert.match(scad, /twist =/);

  const stl = renderDropNippleStl(scad);
  const evidence = {
    sourceUrl: null,
    vertexCount: countStlVertices(stl),
  };

  assert.ok(
    Boolean(evidence.sourceUrl) || evidence.vertexCount > 200,
    `expected vendor sourceUrl or detailed threaded STL; got ${JSON.stringify(evidence)}`,
  );
});
