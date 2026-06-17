import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(import.meta.dirname, '..');
const HTML_PATH = path.join(ROOT, 'autosprink.html');

test('autosprink delegates left/right rails to dock roots', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const dom = new JSDOM(html);
  const { document } = dom.window;

  const left = document.querySelector('aside.left');
  const right = document.querySelector('aside.right');
  assert.ok(left, 'left aside should exist');
  assert.ok(right, 'right aside should exist');

  assert.equal(left.children.length, 1, 'left aside should only host a DockRoot mount');
  assert.equal(right.children.length, 1, 'right aside should only host a DockRoot mount');

  assert.equal(left.firstElementChild?.id, 'dockRootLeft');
  assert.equal(right.firstElementChild?.id, 'dockRootRight');
  assert.equal(left.firstElementChild?.getAttribute('data-dock-root'), 'left');
  assert.equal(right.firstElementChild?.getAttribute('data-dock-root'), 'right');

  assert.equal(left.querySelector('.panel'), null, 'left aside should not carry inline panel markup');
  assert.equal(right.querySelector('.panel'), null, 'right aside should not carry inline panel markup');
  assert.match(html, /mountDockLayout\(\)/, 'dock layout should be mounted from the Studio init flow');
});

test('dock panel modules exist and export the expected functions', async () => {
  const outlinerPath = path.join(ROOT, 'src', 'ui', 'dock', 'outliner-panel.js');
  const detailsPath = path.join(ROOT, 'src', 'ui', 'dock', 'details-panel.js');

  assert.ok(fs.existsSync(outlinerPath), 'outliner-panel.js should exist');
  assert.ok(fs.existsSync(detailsPath), 'details-panel.js should exist');

  const outliner = await import(pathToFileURL(outlinerPath).href);
  const details = await import(pathToFileURL(detailsPath).href);

  assert.equal(typeof outliner.renderOutliner, 'function');
  assert.equal(typeof details.renderDetails, 'function');
});
