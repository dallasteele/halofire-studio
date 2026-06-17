const STYLE_ID = 'hf-dock-system-style';
const PRESETS_KEY = 'hf-dock-layout-presets-v1';
const EDIT_MODE_KEY = 'hf-dock-layout-edit-v1';
const CAPTURE_KEY = 'hf-dock-console-capture-v1';

function injectStyles(document) {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .hf-dock-panel{position:relative;display:flex;flex-direction:column;min-height:0;border:1px solid rgba(255,255,255,0.1);border-radius:14px;background:linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)), rgba(var(--hf-glass-tint,22,18,14),0.26);backdrop-filter:blur(20px) saturate(140%);-webkit-backdrop-filter:blur(20px) saturate(140%);box-shadow:0 18px 48px rgba(0,0,0,0.3);overflow:hidden;}
    .hf-dock-panel[data-hf-dock-kind="existing"]{background:transparent;border-color:rgba(255,255,255,0.08);}
    .hf-dock-titlebar{display:flex;align-items:center;gap:10px;min-height:36px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.08);background:linear-gradient(180deg, rgba(var(--hf-glass-tint,22,18,14),0.66), rgba(var(--hf-glass-tint,22,18,14),0.48));user-select:none;}
    .hf-dock-handle{width:18px;min-width:18px;height:18px;border-radius:6px;display:grid;place-items:center;color:rgba(255,255,255,0.7);border:1px solid transparent;font-size:11px;line-height:1;cursor:default;}
    .hf-dock-edit .hf-dock-handle{border-color:rgba(255,255,255,0.45);outline:1px solid rgba(240,168,104,0.45);cursor:grab;}
    .hf-dock-title{font:600 12px/1.2 system-ui,sans-serif;letter-spacing:0.04em;text-transform:uppercase;color:#f4efe8;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .hf-dock-badge{font:500 10px/1 system-ui,sans-serif;color:rgba(255,255,255,0.72);padding:3px 7px;border-radius:999px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.06);}
    .hf-dock-body{flex:1;min-height:0;overflow:auto;}
    .hf-dock-floating{position:fixed !important;inset:auto;z-index:4200;width:min(420px,42vw);max-width:calc(100vw - 24px);max-height:calc(100vh - 96px);}
    .hf-dock-maximized{position:fixed !important;inset:16px 16px 56px 16px !important;width:auto !important;max-width:none !important;max-height:none !important;z-index:4300;}
    .hf-dock-hidden{display:none !important;}
    .hf-dock-bottom{position:fixed;left:16px;right:16px;bottom:44px;height:180px;z-index:4100;}
    .hf-dock-console-list{margin:0;padding:10px 12px 12px;list-style:none;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#f7f2ea;}
    .hf-dock-console-entry{padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06);white-space:pre-wrap;word-break:break-word;}
    .hf-dock-console-entry[data-level="error"]{color:#ffb6b0;}
    .hf-dock-console-entry[data-level="warn"]{color:#ffd9a1;}
    .hf-dock-menu,.hf-dock-layouts{position:fixed;min-width:190px;padding:6px;border:1px solid rgba(255,255,255,0.14);border-radius:14px;background:rgba(var(--hf-glass-tint,22,18,14),0.9);backdrop-filter:blur(24px) saturate(140%);-webkit-backdrop-filter:blur(24px) saturate(140%);box-shadow:0 18px 44px rgba(0,0,0,0.35);z-index:4400;}
    .hf-dock-menu[hidden],.hf-dock-layouts[hidden]{display:none;}
    .hf-dock-menu button,.hf-dock-layouts button{width:100%;appearance:none;border:0;border-radius:9px;padding:8px 10px;background:transparent;color:#f5efe6;text-align:left;font:500 12px/1.2 system-ui,sans-serif;cursor:pointer;}
    .hf-dock-menu button:hover,.hf-dock-layouts button:hover{background:rgba(255,255,255,0.08);}
    .hf-dock-layouts{width:min(280px,calc(100vw - 24px));padding:10px;}
    .hf-dock-layouts h4{margin:0 0 10px;font:600 12px/1.2 system-ui,sans-serif;letter-spacing:0.05em;text-transform:uppercase;color:#f5efe6;}
    .hf-dock-layouts label,.hf-dock-layouts .hf-dock-check{display:block;margin:10px 0 6px;font:500 11px/1.2 system-ui,sans-serif;color:rgba(255,255,255,0.72);}
    .hf-dock-layouts input,.hf-dock-layouts select{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,0.14);border-radius:9px;background:rgba(0,0,0,0.18);color:#f8f3ea;padding:8px 10px;font:500 12px/1.2 system-ui,sans-serif;}
    .hf-dock-layouts .hf-dock-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;}
    .hf-dock-layouts .hf-dock-grid .hf-dock-span{grid-column:1 / -1;}
    .hf-dock-layouts .hf-dock-check{display:flex;align-items:center;gap:8px;margin-top:12px;}
    .hf-dock-layouts .hf-dock-check input{width:auto;margin:0;}
    .hf-dock-layouts .hf-dock-note{margin-top:10px;font:500 11px/1.35 system-ui,sans-serif;color:rgba(255,255,255,0.6);}
  `;
  document.head.appendChild(style);
}

function storageGet(windowRef, key, fallback) {
  try {
    const raw = windowRef.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function storageSet(windowRef, key, value) {
  try {
    windowRef.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectFromStyle(windowRef, node) {
  const style = windowRef.getComputedStyle(node);
  const num = (value, fallback) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    left: num(style.left, 80),
    top: num(style.top, 80),
    width: num(style.width, 360),
    height: num(style.height, 240),
  };
}

function makeConsoleBody(document) {
  const body = document.createElement('div');
  body.className = 'hf-dock-body';
  const list = document.createElement('ol');
  list.className = 'hf-dock-console-list';
  body.appendChild(list);
  return { body, list };
}

export function mountDockSystem(options = {}) {
  const windowRef = options.window || window;
  const documentRef = options.document || windowRef.document;
  injectStyles(documentRef);

  const statusEl = options.statusEl || null;
  const rootHost = options.root || documentRef.body;
  const panels = new Map();
  const defaultLayout = {};
  const state = {
    layoutEditMode: Boolean(storageGet(windowRef, EDIT_MODE_KEY, false)),
    consoleCaptureEnabled: Boolean(storageGet(windowRef, CAPTURE_KEY, false)),
    dragging: null,
  };

  const menu = documentRef.createElement('div');
  menu.className = 'hf-dock-menu';
  menu.hidden = true;
  documentRef.body.appendChild(menu);

  const layouts = documentRef.createElement('div');
  layouts.className = 'hf-dock-layouts';
  layouts.hidden = true;
  layouts.innerHTML = `
    <h4>Layouts</h4>
    <label for="hfDockPresetName">Preset name</label>
    <input id="hfDockPresetName" type="text" placeholder="Field review layout">
    <label for="hfDockPresetSelect">Saved presets</label>
    <select id="hfDockPresetSelect"></select>
    <div class="hf-dock-grid">
      <button type="button" data-action="save" class="hf-dock-span">Save Layout As...</button>
      <button type="button" data-action="load">Load Layout...</button>
      <button type="button" data-action="reset">Reset to Default</button>
    </div>
    <label class="hf-dock-check"><input id="hfDockCaptureToggle" type="checkbox"> Enable console capture</label>
    <div class="hf-dock-note">Console capture patches window.console only when explicitly enabled.</div>
  `;
  documentRef.body.appendChild(layouts);

  const presetNameInput = layouts.querySelector('#hfDockPresetName');
  const presetSelect = layouts.querySelector('#hfDockPresetSelect');
  const captureToggle = layouts.querySelector('#hfDockCaptureToggle');
  let consoleOriginals = null;
  let consoleListenersBound = false;

  function setStatus(message) {
    if (statusEl) statusEl.textContent = message;
  }

  function loadPresets() {
    return storageGet(windowRef, PRESETS_KEY, {});
  }

  function savePresets(next) {
    storageSet(windowRef, PRESETS_KEY, next);
    refreshPresetOptions();
  }

  function refreshPresetOptions() {
    const presets = loadPresets();
    const names = Object.keys(presets).sort();
    presetSelect.innerHTML = '';
    for (const name of names) {
      const option = documentRef.createElement('option');
      option.value = name;
      option.textContent = name;
      presetSelect.appendChild(option);
    }
    if (!names.length) {
      const option = documentRef.createElement('option');
      option.value = '';
      option.textContent = 'No saved presets';
      presetSelect.appendChild(option);
    }
    captureToggle.checked = state.consoleCaptureEnabled;
  }

  function serializeLayout() {
    const layout = {};
    panels.forEach((panel, id) => {
      layout[id] = {
        title: panel.title,
        mode: panel.mode,
        dock: panel.dock,
        lastDock: panel.lastDock,
        hidden: panel.hidden,
        maximized: panel.maximized,
        rect: panel.mode === 'floating' || panel.maximized ? rectFromStyle(windowRef, panel.shell) : panel.rect,
      };
    });
    return layout;
  }

  function appendConsoleEntry(level, values) {
    const consolePanel = panels.get('console');
    if (!consolePanel) return;
    const entry = documentRef.createElement('li');
    entry.className = 'hf-dock-console-entry';
    entry.dataset.level = level;
    entry.textContent = values.map((value) => {
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }).join(' ');
    consolePanel.consoleList.appendChild(entry);
  }

  function bindConsoleCapture() {
    if (consoleListenersBound) return;
    consoleListenersBound = true;
    windowRef.addEventListener('error', (event) => {
      if (!state.consoleCaptureEnabled) return;
      appendConsoleEntry('error', [event.message || 'window error']);
    });
    windowRef.addEventListener('unhandledrejection', (event) => {
      if (!state.consoleCaptureEnabled) return;
      appendConsoleEntry('error', ['unhandled rejection', event.reason]);
    });
  }

  function enableConsoleCapture(enabled) {
    bindConsoleCapture();
    if (enabled && !consoleOriginals) {
      consoleOriginals = {
        log: windowRef.console.log,
        info: windowRef.console.info,
        warn: windowRef.console.warn,
        error: windowRef.console.error,
      };
      for (const level of ['log', 'info', 'warn', 'error']) {
        windowRef.console[level] = (...args) => {
          appendConsoleEntry(level, args);
          return consoleOriginals[level](...args);
        };
      }
    }
    if (!enabled && consoleOriginals) {
      for (const level of Object.keys(consoleOriginals)) {
        windowRef.console[level] = consoleOriginals[level];
      }
      consoleOriginals = null;
    }
    state.consoleCaptureEnabled = Boolean(enabled);
    storageSet(windowRef, CAPTURE_KEY, state.consoleCaptureEnabled);
    captureToggle.checked = state.consoleCaptureEnabled;
    setStatus(`console capture ${state.consoleCaptureEnabled ? 'enabled' : 'disabled'}`);
  }

  function updateEditModeClasses() {
    panels.forEach((panel) => {
      panel.shell.classList.toggle('hf-dock-edit', state.layoutEditMode);
    });
    storageSet(windowRef, EDIT_MODE_KEY, state.layoutEditMode);
    setStatus(`layout edit mode ${state.layoutEditMode ? 'enabled' : 'locked'}`);
  }

  function setPanelTitle(panel, title) {
    panel.title = title;
    panel.titleEl.textContent = title;
  }

  function applyPanelState(panel, next = {}) {
    if (next.title) setPanelTitle(panel, next.title);
    if (next.lastDock) panel.lastDock = next.lastDock;
    if (next.dock) panel.dock = next.dock;
    if (typeof next.hidden === 'boolean') panel.hidden = next.hidden;
    if (typeof next.maximized === 'boolean') panel.maximized = next.maximized;
    if (next.rect) panel.rect = { ...panel.rect, ...next.rect };
    if (next.mode) panel.mode = next.mode;

    panel.shell.classList.toggle('hf-dock-hidden', panel.hidden);
    panel.shell.classList.toggle('hf-dock-floating', panel.mode === 'floating');
    panel.shell.classList.toggle('hf-dock-maximized', panel.maximized);
    panel.shell.classList.toggle('hf-dock-bottom', panel.mode !== 'floating' && panel.dock === 'bottom');

    if (panel.mode === 'floating') {
      panel.shell.style.left = `${panel.rect.left}px`;
      panel.shell.style.top = `${panel.rect.top}px`;
      panel.shell.style.width = `${panel.rect.width}px`;
      panel.shell.style.height = `${panel.rect.height}px`;
    } else {
      panel.shell.style.left = '';
      panel.shell.style.top = '';
      panel.shell.style.width = '';
      panel.shell.style.height = '';
    }
  }

  function maximizePanel(panelId) {
    const panel = panels.get(panelId);
    if (!panel) return;
    panel.maximized = !panel.maximized;
    panel.hidden = false;
    if (panel.maximized) panel.mode = panel.mode || 'docked';
    applyPanelState(panel);
    setStatus(`${panel.title} ${panel.maximized ? 'maximized' : 'restored'}`);
  }

  function floatPanel(panelId) {
    const panel = panels.get(panelId);
    if (!panel) return;
    const rect = panel.shell.getBoundingClientRect();
    panel.mode = 'floating';
    panel.maximized = false;
    panel.hidden = false;
    panel.rect = {
      left: clamp(rect.left || panel.rect.left, 8, Math.max(8, windowRef.innerWidth - 220)),
      top: clamp(rect.top || panel.rect.top, 8, Math.max(8, windowRef.innerHeight - 140)),
      width: Math.max(rect.width || panel.rect.width, 260),
      height: Math.max(rect.height || panel.rect.height, 180),
    };
    applyPanelState(panel);
    setStatus(`${panel.title} floated`);
  }

  function dockPanel(panelId) {
    const panel = panels.get(panelId);
    if (!panel) return;
    panel.mode = 'docked';
    panel.maximized = false;
    panel.hidden = false;
    panel.dock = panel.lastDock || panel.defaultDock;
    applyPanelState(panel);
    setStatus(`${panel.title} docked`);
  }

  function closePanel(panelId, reason) {
    const panel = panels.get(panelId);
    if (!panel) return;
    panel.hidden = true;
    panel.maximized = false;
    applyPanelState(panel);
    setStatus(`${panel.title} ${reason}`);
  }

  function renamePanel(panelId) {
    const panel = panels.get(panelId);
    if (!panel) return;
    const next = windowRef.prompt('Rename tab', panel.title);
    if (!next) return;
    setPanelTitle(panel, next.trim() || panel.title);
    setStatus(`renamed panel to ${panel.title}`);
  }

  function hideMenu() {
    menu.hidden = true;
  }

  function showPanelMenu(panelId, x, y) {
    menu.innerHTML = '';
    const items = [
      ['Float', () => floatPanel(panelId)],
      ['Dock to Last', () => dockPanel(panelId)],
      ['Close', () => closePanel(panelId, 'closed')],
      ['Hide Tab', () => closePanel(panelId, 'hidden')],
      [panels.get(panelId)?.maximized ? 'Restore' : 'Maximize', () => maximizePanel(panelId)],
      ['Rename Tab', () => renamePanel(panelId)],
    ];
    for (const [label, fn] of items) {
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        hideMenu();
        fn();
      });
      menu.appendChild(button);
    }
    menu.hidden = false;
    menu.style.left = `${clamp(x, 8, Math.max(8, windowRef.innerWidth - 210))}px`;
    menu.style.top = `${clamp(y, 8, Math.max(8, windowRef.innerHeight - 220))}px`;
  }

  function showLayoutsMenu() {
    refreshPresetOptions();
    const anchor = documentRef.getElementById('menuChrome') || rootHost;
    const rect = anchor.getBoundingClientRect();
    layouts.style.left = `${clamp(rect.left + 12, 8, Math.max(8, windowRef.innerWidth - 300))}px`;
    layouts.style.top = `${clamp(rect.bottom + 6, 8, Math.max(8, windowRef.innerHeight - 260))}px`;
    layouts.hidden = !layouts.hidden;
  }

  function hideLayoutsMenu() {
    layouts.hidden = true;
  }

  function applyLayout(layout) {
    Object.entries(layout || {}).forEach(([id, panelLayout]) => {
      const panel = panels.get(id);
      if (!panel) return;
      applyPanelState(panel, panelLayout);
    });
  }

  function saveCurrentLayout(name) {
    if (!name) return false;
    const presets = loadPresets();
    presets[name] = serializeLayout();
    savePresets(presets);
    presetSelect.value = name;
    setStatus(`layout preset saved as ${name}`);
    return true;
  }

  function loadPreset(name) {
    const presets = loadPresets();
    if (!presets[name]) return false;
    applyLayout(presets[name]);
    setStatus(`layout preset loaded: ${name}`);
    return true;
  }

  function resetDefaultLayout() {
    applyLayout(defaultLayout);
    setStatus('dock layout reset to default');
  }

  layouts.addEventListener('click', (event) => {
    const action = event.target.closest('button')?.dataset.action;
    if (!action) return;
    if (action === 'save') {
      const fallbackName = `Layout ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      saveCurrentLayout((presetNameInput.value || presetSelect.value || fallbackName).trim());
    }
    if (action === 'load' && presetSelect.value) loadPreset(presetSelect.value);
    if (action === 'reset') resetDefaultLayout();
  });

  captureToggle.addEventListener('change', () => enableConsoleCapture(captureToggle.checked));

  function connectActions(actions = {}) {
    actions['view.layouts'] = () => showLayoutsMenu();
    actions['view.layout-edit-mode'] = () => {
      state.layoutEditMode = !state.layoutEditMode;
      updateEditModeClasses();
    };
    actions['view.console-capture'] = () => enableConsoleCapture(!state.consoleCaptureEnabled);
    return actions;
  }

  function beginDrag(panelId, event) {
    const panel = panels.get(panelId);
    if (!panel || !state.layoutEditMode || panel.mode !== 'floating' || panel.maximized) return;
    const rect = panel.shell.getBoundingClientRect();
    state.dragging = {
      panelId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    event.preventDefault();
  }

  documentRef.addEventListener('pointermove', (event) => {
    if (!state.dragging) return;
    const panel = panels.get(state.dragging.panelId);
    if (!panel) return;
    panel.rect.left = clamp(event.clientX - state.dragging.offsetX, 8, Math.max(8, windowRef.innerWidth - 220));
    panel.rect.top = clamp(event.clientY - state.dragging.offsetY, 8, Math.max(8, windowRef.innerHeight - 120));
    applyPanelState(panel);
  });

  documentRef.addEventListener('pointerup', () => {
    state.dragging = null;
  });

  documentRef.addEventListener('keydown', (event) => {
    if (event.key === 'F11' && event.shiftKey) {
      event.preventDefault();
      state.layoutEditMode = !state.layoutEditMode;
      updateEditModeClasses();
    }
    if (event.key === 'Escape') {
      hideMenu();
      hideLayoutsMenu();
    }
  });

  documentRef.addEventListener('click', (event) => {
    if (!menu.hidden && !menu.contains(event.target)) hideMenu();
    if (!layouts.hidden && !layouts.contains(event.target)) hideLayoutsMenu();
  });

  const configs = options.panels || [];
  for (const config of configs) {
    const shell = config.element || documentRef.querySelector(config.selector);
    if (!shell) continue;
    shell.classList.add('hf-dock-panel');
    shell.dataset.hfDockPanel = config.id;
    shell.dataset.hfDockKind = config.kind || 'existing';

    const titlebar = documentRef.createElement('div');
    titlebar.className = 'hf-dock-titlebar';
    titlebar.dataset.panelId = config.id;

    const handle = documentRef.createElement('span');
    handle.className = 'hf-dock-handle';
    handle.textContent = '⋮⋮';
    titlebar.appendChild(handle);

    const titleEl = documentRef.createElement('span');
    titleEl.className = 'hf-dock-title';
    titleEl.textContent = config.title;
    titlebar.appendChild(titleEl);

    const badge = documentRef.createElement('span');
    badge.className = 'hf-dock-badge';
    badge.textContent = config.badge || (config.defaultDock === 'bottom' ? 'Bottom Dock' : 'Docked');
    titlebar.appendChild(badge);

    titlebar.addEventListener('dblclick', () => maximizePanel(config.id));
    titlebar.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      showPanelMenu(config.id, event.clientX, event.clientY);
    });
    titlebar.addEventListener('pointerdown', (event) => beginDrag(config.id, event));

    let consoleList = null;
    if (config.kind === 'builtin-console') {
      const consoleBits = makeConsoleBody(documentRef);
      shell.replaceChildren();
      shell.appendChild(titlebar);
      shell.appendChild(consoleBits.body);
      consoleList = consoleBits.list;
    } else {
      shell.insertBefore(titlebar, shell.firstChild);
    }

    const panel = {
      id: config.id,
      title: config.title,
      defaultDock: config.defaultDock || 'right',
      dock: config.defaultDock || 'right',
      lastDock: config.defaultDock || 'right',
      mode: config.mode || 'docked',
      hidden: Boolean(config.hidden),
      maximized: false,
      rect: { left: config.left || 84, top: config.top || 92, width: config.width || 360, height: config.height || 220 },
      shell,
      titleEl,
      titlebar,
      handle,
      consoleList,
    };
    panels.set(config.id, panel);
    defaultLayout[config.id] = {
      title: config.title,
      mode: panel.mode,
      dock: panel.dock,
      lastDock: panel.lastDock,
      hidden: panel.hidden,
      maximized: false,
      rect: { ...panel.rect },
    };
    applyPanelState(panel);
  }

  updateEditModeClasses();
  refreshPresetOptions();
  if (state.consoleCaptureEnabled) enableConsoleCapture(true);

  return {
    panels,
    menu,
    layouts,
    connectActions,
    serializeLayout,
    saveCurrentLayout,
    loadPreset,
    resetDefaultLayout,
    showPanelMenu,
    showLayoutsMenu,
    hideLayoutsMenu,
    maximizePanel,
    floatPanel,
    dockPanel,
    renamePanel,
    enableConsoleCapture,
    isConsoleCaptureEnabled: () => state.consoleCaptureEnabled,
    toggleLayoutEditMode: () => {
      state.layoutEditMode = !state.layoutEditMode;
      updateEditModeClasses();
      return state.layoutEditMode;
    },
    getLayoutEditMode: () => state.layoutEditMode,
  };
}

if (typeof window !== 'undefined') {
  window.HFDockSystem = { mountDockSystem };
}
