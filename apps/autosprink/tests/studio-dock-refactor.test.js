import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(import.meta.dirname, '..');
const HTML_PATH = path.join(ROOT, 'autosprink.html');
const OUTLINER_PATH = path.join(ROOT, 'src/ui/dock/outliner-panel.js');
const DETAILS_PATH = path.join(ROOT, 'src/ui/dock/details-panel.js');

test('autosprink delegates studio panels to DockRoot and exposes the new dock panel modules', async () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const dom = new JSDOM(html);
  const { document } = dom.window;

  assert.ok(document.querySelector('[data-dock-root]'), 'dock root mount should exist');
  assert.equal(document.querySelector('aside.left'), null, 'left aside rail should be removed');
  assert.equal(document.querySelector('aside.right'), null, 'right aside rail should be removed');
  assert.match(html, /renderDockRoot/, 'studio shell should mount the dock system');

  assert.ok(fs.existsSync(OUTLINER_PATH), 'outliner panel module should exist');
  assert.ok(fs.existsSync(DETAILS_PATH), 'details panel module should exist');

  const outlinerModule = await import(pathToFileURL(OUTLINER_PATH).href);
  const detailsModule = await import(pathToFileURL(DETAILS_PATH).href);

  assert.equal(typeof outlinerModule.renderOutliner, 'function', 'outliner panel should export renderOutliner');
  assert.equal(typeof detailsModule.renderDetails, 'function', 'details panel should export renderDetails');
});
