import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CLI_PATH = '/opt/hal9000/state/_ocx_extract_1881.mjs';

test('extract-1881 CLI writes real wall geometry from the 1881 A-101 sheet', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'extract-1881-'));
  const outputPath = path.join(tmpDir, '1881-geometry.json');

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, outputPath], {
      cwd: process.cwd(),
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });

    const raw = await fs.readFile(outputPath, 'utf8');
    const result = JSON.parse(raw);

    assert.ok(Array.isArray(result.walls), 'walls must be an array');
    assert.ok(Array.isArray(result.columns), 'columns must be an array');
    assert.ok(Array.isArray(result.bounds), 'bounds must be an array');
    assert.equal(result.bounds.length, 4, 'bounds must be [minx,miny,maxx,maxy]');
    assert.ok(result.walls.length > 50, `expected >50 walls, got ${result.walls.length}`);

    for (const wall of result.walls) {
      assert.deepEqual(Object.keys(wall).sort(), ['a', 'b']);
      assert.equal(wall.a.length, 2);
      assert.equal(wall.b.length, 2);
      assert.ok(wall.a.every(Number.isFinite));
      assert.ok(wall.b.every(Number.isFinite));
    }

    for (const column of result.columns) {
      assert.ok(Number.isFinite(column.x));
      assert.ok(Number.isFinite(column.y));
      assert.ok(Object.hasOwn(column, 'size'));
    }

    const summary = `${stdout}${stderr}`.trim();
    assert.match(summary, /walls=\d+\s+cols=\d+\s+bounds=/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}, 120000);
