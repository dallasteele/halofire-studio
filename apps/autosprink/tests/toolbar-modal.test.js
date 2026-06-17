import test from 'node:test';
import assert from 'node:assert/strict';

import { renderToolbar } from '../src/ui/dock/toolbar.js';

class FakeButton {
  constructor(attrs, text) {
    this.attrs = attrs;
    this.dataset = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('data-')) {
        this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      }
    }
    this.textContent = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  click() {
    const handler = this.listeners.get('click');
    if (handler) handler({ currentTarget: this, target: this });
  }
}

class FakeRoot {
  constructor() {
    this._html = '';
    this.buttons = [];
  }

  set innerHTML(value) {
    this._html = value;
    this.buttons = parseButtons(value);
  }

  get innerHTML() {
    return this._html;
  }

  querySelectorAll(selector) {
    if (selector === '[data-mode]') return this.buttons.filter((button) => button.dataset.mode);
    if (selector === '[data-action]') return this.buttons.filter((button) => button.dataset.action);
    return [];
  }

  querySelector(selector) {
    const modeMatch = selector.match(/^\[data-mode="([^"]+)"\]$/);
    if (modeMatch) return this.buttons.find((button) => button.dataset.mode === modeMatch[1]) || null;
    const actionMatch = selector.match(/^\[data-action="([^"]+)"\]$/);
    if (actionMatch) return this.buttons.find((button) => button.dataset.action === actionMatch[1]) || null;
    return null;
  }
}

function parseButtons(html) {
  const buttons = [];
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    buttons.push(new FakeButton(parseAttrs(match[1]), match[2]));
  }
  return buttons;
}

function parseAttrs(attrString) {
  const attrs = {};
  const re = /([^\s=]+)="([^"]*)"/g;
  let match;
  while ((match = re.exec(attrString)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function actionIds(root) {
  return root.querySelectorAll('[data-action]').map((button) => button.dataset.action);
}

test('renders select-mode actions by default', () => {
  const root = new FakeRoot();
  const toolbar = renderToolbar(root, {
    mode: 'SELECT',
    activeAction: 'select',
    actions: {},
  });

  assert.deepEqual(actionIds(root), ['select', 'move', 'copy', 'delete']);
  assert.equal(toolbar.getState().mode, 'SELECT');
  assert.equal(toolbar.getState().activeAction, 'select');
});

test('switches modes and renders the requested contextual actions', () => {
  const root = new FakeRoot();
  const modeChanges = [];
  renderToolbar(root, {
    mode: 'SELECT',
    activeAction: 'select',
    onModeChange: (mode) => modeChanges.push(mode),
    actions: {},
  });

  root.querySelector('[data-mode="DRAW"]').click();
  assert.deepEqual(actionIds(root), ['wall', 'pipe', 'head', 'drop', 'door']);

  root.querySelector('[data-mode="EDIT"]').click();
  assert.deepEqual(actionIds(root), ['trim', 'offset', 'array', 'mirror']);

  root.querySelector('[data-mode="MEASURE"]').click();
  assert.deepEqual(actionIds(root), ['measure']);
  assert.deepEqual(modeChanges, ['DRAW', 'EDIT', 'MEASURE']);
});

test('invokes the action callback and keeps the rendered mode in sync', () => {
  const root = new FakeRoot();
  const calls = [];
  const toolbar = renderToolbar(root, {
    mode: 'DRAW',
    activeAction: 'pipe',
    actions: {
      mirror: () => calls.push('mirror'),
    },
  });

  toolbar.setMode('EDIT');
  root.querySelector('[data-action="mirror"]').click();

  assert.deepEqual(actionIds(root), ['trim', 'offset', 'array', 'mirror']);
  assert.deepEqual(calls, ['mirror']);
  assert.equal(toolbar.getState().mode, 'EDIT');
  assert.equal(toolbar.getState().activeAction, 'mirror');
});
