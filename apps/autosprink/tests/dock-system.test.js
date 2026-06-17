import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  MouseEvent: dom.window.MouseEvent,
  localStorage: dom.window.localStorage,
});

const {
  createDockRoot,
  registerPanel,
  saveLayout,
  loadLayout,
  resetLayout,
} = await import('../src/ui/dock/dock-system.js');

function panelFactory(title) {
  const factory = () => {
    const el = document.createElement('div');
    el.textContent = `${title} body`;
    return el;
  };
  factory.title = title;
  return factory;
}

function mouse(type, target, x, y) {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    buttons: 1,
  }));
}

test('dock kernel docks a floating panel into a west split and restores the same layout from storage', async () => {
  localStorage.clear();
  registerPanel('alpha', panelFactory('Alpha'));
  registerPanel('beta', panelFactory('Beta'));
  registerPanel('gamma', panelFactory('Gamma'));

  const host = document.getElementById('root');
  host.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 600,
    bottom: 400,
    width: 600,
    height: 400,
    x: 0,
    y: 0,
    toJSON() { return this; },
  });

  const root = createDockRoot(host, {
    name: 'dock-test',
    layout: {
      dock: {
        type: 'tabset',
        tabs: ['alpha'],
        activeTabId: 'alpha',
      },
      floating: [
        {
          id: 'float-beta',
          x: 240,
          y: 80,
          width: 260,
          height: 180,
          node: {
            type: 'tabset',
            tabs: ['beta'],
            activeTabId: 'beta',
          },
        },
        {
          id: 'float-gamma',
          x: 300,
          y: 130,
          width: 220,
          height: 170,
          node: {
            type: 'tabset',
            tabs: ['gamma'],
            activeTabId: 'gamma',
          },
        },
      ],
    },
  });

  const titlebar = host.querySelector('[data-floating-id="float-beta"] .hf-dock-floating-titlebar');
  assert.ok(titlebar, 'expected floating titlebar for beta window');

  mouse('mousedown', titlebar, 260, 90);
  mouse('mousemove', document, 50, 210);
  mouse('mouseup', document, 50, 210);

  const afterDock = root.getLayout();
  assert.equal(afterDock.floating.length, 1);
  assert.equal(afterDock.floating[0].id, 'float-gamma');
  assert.equal(afterDock.dock.type, 'split');
  assert.equal(afterDock.dock.axis, 'row');
  assert.deepEqual(afterDock.dock.first.tabs, ['beta']);
  assert.deepEqual(afterDock.dock.second.tabs, ['alpha']);

  const saved = saveLayout();
  assert.deepEqual(saved.roots['dock-test'], afterDock);
  const savedJson = JSON.stringify(saved.roots['dock-test']);

  root.setLayout({
    dock: {
      type: 'tabset',
      tabs: ['gamma'],
      activeTabId: 'gamma',
    },
    floating: [],
  });

  const loaded = loadLayout();
  assert.equal(JSON.stringify(root.getLayout()), savedJson);
  assert.deepEqual(loaded.roots['dock-test'], JSON.parse(savedJson));

  resetLayout('dock-test');
  assert.deepEqual(root.getLayout().dock.tabs, ['alpha']);
  assert.equal(root.getLayout().floating.length, 2);
});
