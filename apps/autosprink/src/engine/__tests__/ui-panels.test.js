import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../../');
const cadAppDir = path.join(repoRoot, 'apps/cad');
const npmPath = fs.existsSync('/usr/bin/npm') ? '/usr/bin/npm' : 'npm';

test('wire-coverage-to-inspector recovery stays pinned to the live CAD inspector', () => {
  const result = spawnSync(
    npmPath,
    ['test', '--', '--run', 'test/inspector-part-viewer.test.tsx'],
    {
      cwd: cadAppDir,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
    },
  );

  assert.equal(
    result.status,
    0,
    [
      'Expected the recovered coverage-to-inspector slice to pass the live CAD inspector test.',
      result.error ? `spawn error:\n${String(result.error)}` : null,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  );
});
