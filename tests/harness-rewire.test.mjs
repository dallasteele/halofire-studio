import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const SCRIPT_PATH = '/opt/hal9000/state/_ocx_render_for_vision.sh';

test('render harness uses the extractor CLI and removes the browser path', async () => {
  const script = await fs.readFile(SCRIPT_PATH, 'utf8');

  assert.match(script, /node \/opt\/hal9000\/state\/_ocx_extract_1881\.mjs/);
  assert.doesNotMatch(script, /playwright/i);
  assert.doesNotMatch(script, /chromium/i);
});
