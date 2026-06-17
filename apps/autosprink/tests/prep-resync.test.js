import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const adapterTsPath = path.join(ROOT, 'src/engine/adapter.ts');
const adapterJsPath = path.join(ROOT, 'src/engine/adapter.js');
const autosprinkHtmlPath = path.join(ROOT, 'autosprink.html');

test('prep resync keeps adapter.js and fail-fast module load guards in place', () => {
  assert.equal(fs.existsSync(adapterTsPath), false, 'src/engine/adapter.ts should not exist');
  assert.equal(fs.existsSync(adapterJsPath), true, 'src/engine/adapter.js should exist');

  const html = fs.readFileSync(autosprinkHtmlPath, 'utf8');

  assert.match(
    html,
    /import\s*\{\s*getBom,\s*getNfpaReport\s*\}\s*from\s*'\/src\/engine\/adapter\.js';/,
    'autosprink.html should import getBom/getNfpaReport from /src/engine/adapter.js',
  );
  assert.doesNotMatch(
    html,
    /import\s*\{\s*getBom,\s*getNfpaReport\s*\}\s*from\s*'\/src\/engine\/ui-panels\.js';/,
    'autosprink.html should not import getBom/getNfpaReport from /src/engine/ui-panels.js',
  );

  const errorTrapIndex = html.indexOf('window.__hfErrs = window.__hfErrs || [];');
  const importMapIndex = html.indexOf('<script type="importmap">');

  assert.notEqual(errorTrapIndex, -1, 'autosprink.html should include the global error trap');
  assert.notEqual(importMapIndex, -1, 'autosprink.html should include the importmap');
  assert.ok(
    errorTrapIndex < importMapIndex,
    'the global error trap should appear before the importmap script',
  );
});
