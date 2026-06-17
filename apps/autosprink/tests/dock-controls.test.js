import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { mountDockSystem } from '../src/ui/dock/dock-system.js';

function buildHarness() {
  const dom = new JSDOM(
    `<!doctype html>
    <html>
      <head></head>
      <body style="--hf-glass-tint:22,18,14">
        <div id="menuChrome"></div>
        <aside class="left"><div class="payload">left</div></aside>
        <aside class="right"><div class="payload">right</div></aside>
        <div id="status"></div>
      </body>
    </html>`,
    { url: 'https://halofire.test/autosprink' }
  );
  const { window } = dom;
  window.innerWidth = 1400;
  window.innerHeight = 900;
  window.prompt = () => 'Renamed Panel';

  const consolePanel = window.document.createElement('section');
  const actions = {};
  const api = mountDockSystem({
    window,
    document: window.document,
    statusEl: window.document.getElementById('status'),
    panels: [
      { id: 'job-tools', selector: 'aside.left', title: 'Job / Tools', defaultDock: 'left', badge: 'Left Dock' },
      { id: 'inspector-stack', selector: 'aside.right', title: 'Inspector / Results', defaultDock: 'right', badge: 'Right Dock' },
      { id: 'console', element: consolePanel, kind: 'builtin-console', title: 'Console', defaultDock: 'bottom', badge: 'Bottom Dock' },
    ],
  });
  window.document.body.appendChild(consolePanel);
  api.connectActions(actions);
  return { dom, window, document: window.document, api, actions };
}

test('dock controls cover all five requested features', async () => {
  const { window, document, api, actions } = buildHarness();

  const leftPanel = api.panels.get('job-tools').shell;
  const leftTitlebar = leftPanel.querySelector('.hf-dock-titlebar');
  leftTitlebar.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(leftPanel.classList.contains('hf-dock-maximized'), true, 'double-click maximizes panel');
  leftTitlebar.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(leftPanel.classList.contains('hf-dock-maximized'), false, 'double-click restores panel');

  leftTitlebar.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, clientX: 90, clientY: 110 }));
  const menuLabels = [...document.querySelectorAll('.hf-dock-menu button')].map((node) => node.textContent.trim());
  assert.deepEqual(menuLabels, ['Float', 'Dock to Last', 'Close', 'Hide Tab', 'Maximize', 'Rename Tab']);
  document.querySelector('.hf-dock-menu button:nth-child(1)').click();
  assert.equal(leftPanel.classList.contains('hf-dock-floating'), true, 'Float switches panel into floating mode');
  api.showPanelMenu('job-tools', 90, 110);
  document.querySelector('.hf-dock-menu button:nth-child(6)').click();
  assert.equal(leftPanel.querySelector('.hf-dock-title').textContent, 'Renamed Panel', 'Rename Tab updates title');
  api.showPanelMenu('job-tools', 90, 110);
  document.querySelector('.hf-dock-menu button:nth-child(2)').click();
  assert.equal(leftPanel.classList.contains('hf-dock-floating'), false, 'Dock to Last restores docked mode');

  actions['view.layouts']();
  const layouts = document.querySelector('.hf-dock-layouts');
  assert.equal(layouts.hidden, false, 'View menu hook opens layout presets dropdown');
  document.getElementById('hfDockPresetName').value = 'Field Layout';
  api.floatPanel('inspector-stack');
  api.saveCurrentLayout('Field Layout');
  const presets = JSON.parse(window.localStorage.getItem('hf-dock-layout-presets-v1'));
  assert.ok(presets['Field Layout'], 'preset saved to required localStorage key');
  api.dockPanel('inspector-stack');
  api.loadPreset('Field Layout');
  assert.equal(api.panels.get('inspector-stack').shell.classList.contains('hf-dock-floating'), true, 'Load Layout restores saved state');
  api.resetDefaultLayout();
  assert.equal(api.panels.get('inspector-stack').shell.classList.contains('hf-dock-floating'), false, 'Reset to Default restores default docking');

  assert.equal(api.getLayoutEditMode(), false, 'layout edit mode defaults off');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'F11', shiftKey: true, bubbles: true }));
  assert.equal(api.getLayoutEditMode(), true, 'Shift+F11 enables layout edit mode');
  assert.equal(JSON.parse(window.localStorage.getItem('hf-dock-layout-edit-v1')), true, 'layout edit mode persists per user');
  assert.equal(leftPanel.classList.contains('hf-dock-edit'), true, 'edit mode outlines drag handle/panel shell');

  const consolePanel = api.panels.get('console').shell;
  assert.equal(consolePanel.classList.contains('hf-dock-bottom'), true, 'console panel docks to the bottom by default');
  window.console.log('before-enable');
  assert.equal(consolePanel.querySelectorAll('.hf-dock-console-entry').length, 0, 'console is not patched by default');
  api.enableConsoleCapture(true);
  window.console.log('captured-log');
  window.console.error('captured-error');
  const entries = [...consolePanel.querySelectorAll('.hf-dock-console-entry')].map((node) => node.textContent);
  assert.equal(api.isConsoleCaptureEnabled(), true, 'explicit enable flips console capture on');
  assert.equal(entries.some((value) => value.includes('captured-log')), true, 'console.log is captured once enabled');
  assert.equal(entries.some((value) => value.includes('captured-error')), true, 'console.error is captured once enabled');
});
