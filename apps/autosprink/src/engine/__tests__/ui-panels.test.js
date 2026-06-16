import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const PANEL_PATH = new URL('../../ui/panels/inspector/InspectorPanel.tsx', import.meta.url);

function createReactHarness() {
  let stateValue;
  let stateInitialized = false;
  const effects = [];

  return {
    effects,
    react: {
      createElement(type, props, ...children) {
        return { type, props: props || {}, children };
      },
      useEffect(callback, deps) {
        effects.push({ callback, deps });
      },
      useState(initialValue) {
        if (!stateInitialized) {
          stateValue = initialValue;
          stateInitialized = true;
        }
        return [
          stateValue,
          (nextValue) => {
            stateValue = typeof nextValue === 'function' ? nextValue(stateValue) : nextValue;
          },
        ];
      },
    },
  };
}

function flattenText(node) {
  if (typeof node === 'string') {
    return node;
  }
  if (!node || !Array.isArray(node.children)) {
    return '';
  }
  return node.children.map(flattenText).join('');
}

function findByDataValue(node, value) {
  if (!node || typeof node === 'string') {
    return null;
  }
  if (node.props?.['data-value'] === value) {
    return node;
  }
  for (const child of node.children || []) {
    const match = findByDataValue(child, value);
    if (match) {
      return match;
    }
  }
  return null;
}

async function loadInspectorPanel() {
  const source = await readFile(PANEL_PATH, 'utf8');
  const rewritten = source
    .replace(
      "import React, { useEffect, useState } from 'react';",
      'const React = globalThis.__TEST_REACT; const { useEffect, useState } = React;',
    )
    .replace(
      "import { getHazenWilliams } from '../../../engine/adapter.ts';",
      'const { getHazenWilliams } = globalThis.__TEST_ADAPTER;',
    );
  return import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
}

test('InspectorPanel fetches Hazen-Williams on mount and renders the adapter value', async () => {
  const harness = createReactHarness();
  const adapterCalls = [];

  globalThis.__TEST_REACT = harness.react;
  globalThis.__TEST_ADAPTER = {
    getHazenWilliams() {
      adapterCalls.push('getHazenWilliams');
      return Promise.resolve({
        value: { cFactor: 120, frictionLossPsi: 7.4, source: 'mock' },
      });
    },
  };

  try {
    const panelModule = await loadInspectorPanel();

    const initialTree = panelModule.InspectorPanel();
    const initialValue = findByDataValue(initialTree, 'hazen-williams');
    assert.equal(flattenText(initialValue), 'Loading...');
    assert.equal(harness.effects.length, 1);

    const cleanup = harness.effects[0].callback();
    await Promise.resolve();

    const resolvedTree = panelModule.InspectorPanel();
    const resolvedValue = findByDataValue(resolvedTree, 'hazen-williams');

    assert.deepEqual(adapterCalls, ['getHazenWilliams']);
    assert.equal(flattenText(resolvedValue), 'C=120 · 7.4 psi loss · mock');
    assert.equal(typeof cleanup, 'function');
  } finally {
    delete globalThis.__TEST_REACT;
    delete globalThis.__TEST_ADAPTER;
  }
});
