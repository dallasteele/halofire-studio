const STORAGE_KEY = 'hf-dock-layout-v1';
const PANEL_REGISTRY = new Map();
const ACTIVE_ROOTS = new Map();

let nextNodeId = 1;
let activePointerSession = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function ensureNodeId(node) {
  if (!node || typeof node !== 'object') return node;
  if (!node.nodeId) node.nodeId = `node-${nextNodeId++}`;
  if (node.type === 'split') {
    ensureNodeId(node.first);
    ensureNodeId(node.second);
  }
  if (Array.isArray(node.tabs)) {
    node.tabs = [...node.tabs];
    if (!node.activeTabId && node.tabs[0]) node.activeTabId = node.tabs[0];
  }
  return node;
}

function createTabset(tabs = []) {
  return ensureNodeId({
    type: 'tabset',
    nodeId: null,
    tabs: [...tabs],
    activeTabId: tabs[0] ?? null,
  });
}

function createSplit(axis, first, second, ratio = 0.5) {
  return ensureNodeId({
    type: 'split',
    nodeId: null,
    axis,
    ratio: clamp(ratio, 0.15, 0.85),
    first: ensureNodeId(first),
    second: ensureNodeId(second),
  });
}

function collectTabs(node, into = []) {
  if (!node) return into;
  if (node.type === 'tabset') {
    into.push(...node.tabs);
    return into;
  }
  collectTabs(node.first, into);
  collectTabs(node.second, into);
  return into;
}

function findNode(node, nodeId) {
  if (!node) return null;
  if (node.nodeId === nodeId) return node;
  if (node.type === 'split') return findNode(node.first, nodeId) || findNode(node.second, nodeId);
  return null;
}

function replaceNode(node, nodeId, replacement) {
  if (!node) return replacement;
  if (node.nodeId === nodeId) return replacement;
  if (node.type === 'split') {
    node.first = replaceNode(node.first, nodeId, replacement);
    node.second = replaceNode(node.second, nodeId, replacement);
  }
  return node;
}

function pruneEmpty(node, isRoot = false) {
  if (!node) return isRoot ? createTabset([]) : null;
  if (node.type === 'tabset') {
    if (node.tabs.length === 0 && !isRoot) return null;
    if (!node.activeTabId || !node.tabs.includes(node.activeTabId)) node.activeTabId = node.tabs[0] ?? null;
    return node;
  }
  node.first = pruneEmpty(node.first, false);
  node.second = pruneEmpty(node.second, false);
  if (!node.first && !node.second) return isRoot ? createTabset([]) : null;
  if (!node.first) return node.second;
  if (!node.second) return node.first;
  return node;
}

function removeTabFromTree(node, panelId, isRoot = false) {
  if (!node) return { removed: false, root: pruneEmpty(node, isRoot) };
  if (node.type === 'tabset') {
    const index = node.tabs.indexOf(panelId);
    if (index === -1) return { removed: false, root: node };
    node.tabs.splice(index, 1);
    if (node.activeTabId === panelId) node.activeTabId = node.tabs[Math.max(0, index - 1)] ?? node.tabs[0] ?? null;
    return { removed: true, root: pruneEmpty(node, isRoot) };
  }
  const left = removeTabFromTree(node.first, panelId, false);
  node.first = left.root;
  if (left.removed) return { removed: true, root: pruneEmpty(node, isRoot) };
  const right = removeTabFromTree(node.second, panelId, false);
  node.second = right.root;
  return { removed: right.removed, root: pruneEmpty(node, isRoot) };
}

function factoryResultToElement(result) {
  if (result instanceof globalThis.HTMLElement) return result;
  const el = document.createElement('div');
  el.textContent = typeof result === 'string' ? result : '';
  return el;
}

function loadStore() {
  if (typeof localStorage === 'undefined') return { roots: {} };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"roots":{}}');
    if (!parsed || typeof parsed !== 'object') return { roots: {} };
    if (!parsed.roots || typeof parsed.roots !== 'object') parsed.roots = {};
    return parsed;
  } catch {
    return { roots: {} };
  }
}

function saveStore(store) {
  if (typeof localStorage === 'undefined') return store;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  return store;
}

function getEdgeCursor(handle) {
  if (handle === 'n' || handle === 's') return 'ns-resize';
  if (handle === 'e' || handle === 'w') return 'ew-resize';
  if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
  return 'nwse-resize';
}

function moveItem(array, from, to) {
  if (from === to || from < 0 || to < 0 || from >= array.length || to >= array.length) return array;
  const [item] = array.splice(from, 1);
  array.splice(to, 0, item);
  return array;
}

function pointInRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function createFloatingRecord(tabset, bounds = {}) {
  return {
    id: `float-${nextNodeId++}`,
    x: bounds.x ?? 80,
    y: bounds.y ?? 80,
    width: bounds.width ?? 320,
    height: bounds.height ?? 240,
    node: ensureNodeId(tabset),
  };
}

function normalizeLayout(layout, fallbackTabs = []) {
  if (layout?.dock) {
    const normalized = clone(layout);
    normalized.dock = ensureNodeId(normalized.dock);
    normalized.floating = Array.isArray(normalized.floating)
      ? normalized.floating.map((item) => ({
          id: item.id ?? `float-${nextNodeId++}`,
          x: item.x ?? 80,
          y: item.y ?? 80,
          width: item.width ?? 320,
          height: item.height ?? 240,
          node: ensureNodeId(item.node ?? createTabset([])),
        }))
      : [];
    return normalized;
  }
  return {
    dock: createTabset(fallbackTabs),
    floating: [],
  };
}

export class DockPanel {
  constructor(id, options = {}) {
    this.id = id;
    this.title = options.title || id;
    this.minWidth = options.minWidth ?? 180;
    this.minHeight = options.minHeight ?? 120;
  }
}

export function registerPanel(id, factory) {
  PANEL_REGISTRY.set(id, factory);
}

class DockRoot {
  constructor(el, opts = {}) {
    this.el = el;
    this.name = opts.name || 'default';
    this.panelMeta = new Map();
    this.overlayState = null;
    this.leafElements = new Map();
    this.initialLayout = normalizeLayout(opts.layout, opts.panels || []);
    this.state = normalizeLayout(this.initialLayout);
    ACTIVE_ROOTS.set(this.name, this);
    const stored = loadStore().roots[this.name];
    if (stored) this.state = normalizeLayout(stored, opts.panels || []);
    this._installRoot();
    this.render();
  }

  _installRoot() {
    this.el.classList.add('hf-dock-root');
    if (!this.el.style.position) this.el.style.position = 'relative';
    this.el.style.overflow = 'hidden';
    this.el.style.background = this.el.style.background || '#16191f';
    this.el.style.color = this.el.style.color || '#f7f7fb';
    this.el.style.userSelect = 'none';
  }

  getLayout() {
    return clone(this.state);
  }

  setLayout(layout) {
    this.state = normalizeLayout(layout);
    this.render();
  }

  addPanel(panelId) {
    const rootTabs = collectTabs(this.state.dock);
    const floatingTabs = this.state.floating.flatMap((item) => item.node.tabs);
    if (rootTabs.includes(panelId) || floatingTabs.includes(panelId)) return;
    const target = this._firstTabset(this.state.dock);
    target.tabs.push(panelId);
    target.activeTabId = panelId;
    this.render();
  }

  floatPanel(panelId, bounds = {}) {
    const removed = removeTabFromTree(this.state.dock, panelId, true);
    this.state.dock = removed.root;
    const existing = this.state.floating.find((item) => item.node.tabs.includes(panelId));
    if (existing) {
      existing.x = bounds.x ?? existing.x;
      existing.y = bounds.y ?? existing.y;
      existing.width = bounds.width ?? existing.width;
      existing.height = bounds.height ?? existing.height;
    } else {
      this.state.floating.push(createFloatingRecord(createTabset([panelId]), bounds));
    }
    this.render();
  }

  reset() {
    this.state = normalizeLayout(this.initialLayout);
    this.render();
  }

  _firstTabset(node) {
    if (node.type === 'tabset') return node;
    return this._firstTabset(node.first);
  }

  _renderPanelBody(panelId) {
    const factory = PANEL_REGISTRY.get(panelId);
    const meta = factory?.meta instanceof DockPanel ? factory.meta : new DockPanel(panelId, { title: factory?.title || panelId });
    this.panelMeta.set(panelId, meta);
    const wrapper = document.createElement('div');
    wrapper.className = 'hf-dock-panel-body';
    Object.assign(wrapper.style, {
      flex: '1',
      minWidth: '0',
      minHeight: '0',
      overflow: 'auto',
      background: '#11141a',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      padding: '10px',
    });
    const content = factory ? factoryResultToElement(factory({ id: panelId, root: this })) : factoryResultToElement(panelId);
    wrapper.appendChild(content);
    return wrapper;
  }

  _panelTitle(panelId) {
    return this.panelMeta.get(panelId)?.title || panelId;
  }

  _tabFromEventTarget(target) {
    return target instanceof Element ? target.closest('[data-dock-tab-id]') : null;
  }

  _startTabPointer(event, node, panelId, floatingId = null) {
    event.preventDefault();
    activePointerSession = {
      kind: 'tab',
      root: this,
      nodeId: node.nodeId,
      panelId,
      floatingId,
      startX: event.clientX,
      startY: event.clientY,
      detachedFloatingId: null,
      overlayZone: null,
    };
    this._bindDocumentSession();
  }

  _startWindowPointer(event, floatingId) {
    event.preventDefault();
    const floating = this.state.floating.find((item) => item.id === floatingId);
    if (!floating) return;
    activePointerSession = {
      kind: 'window-move',
      root: this,
      floatingId,
      offsetX: event.clientX - floating.x,
      offsetY: event.clientY - floating.y,
      overlayZone: null,
    };
    this._bindDocumentSession();
  }

  _startResizePointer(event, floatingId, handle) {
    event.preventDefault();
    const floating = this.state.floating.find((item) => item.id === floatingId);
    if (!floating) return;
    activePointerSession = {
      kind: 'window-resize',
      root: this,
      floatingId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startBounds: { x: floating.x, y: floating.y, width: floating.width, height: floating.height },
    };
    this._bindDocumentSession();
  }

  _startSplitterPointer(event, nodeId) {
    event.preventDefault();
    const split = findNode(this.state.dock, nodeId);
    if (!split || split.type !== 'split') return;
    activePointerSession = {
      kind: 'splitter',
      root: this,
      nodeId,
    };
    this._bindDocumentSession();
  }

  _bindDocumentSession() {
    if (this._docHandlersBound) return;
    this._docHandlersBound = true;
    document.addEventListener('mousemove', this._onDocumentMove);
    document.addEventListener('mouseup', this._onDocumentUp);
  }

  _unbindDocumentSession() {
    if (!this._docHandlersBound) return;
    this._docHandlersBound = false;
    document.removeEventListener('mousemove', this._onDocumentMove);
    document.removeEventListener('mouseup', this._onDocumentUp);
  }

  _ensureDetachedFloating(event) {
    if (!activePointerSession || activePointerSession.detachedFloatingId) return activePointerSession.detachedFloatingId;
    const { panelId, floatingId } = activePointerSession;
    if (floatingId) {
      const existing = this.state.floating.find((item) => item.id === floatingId);
      if (!existing) return null;
      if (existing.node.tabs.length === 1) {
        activePointerSession.kind = 'window-move';
        activePointerSession.offsetX = 16;
        activePointerSession.offsetY = 12;
        return floatingId;
      }
      existing.node.tabs = existing.node.tabs.filter((tab) => tab !== panelId);
      if (existing.node.activeTabId === panelId) existing.node.activeTabId = existing.node.tabs[0] ?? null;
      const detached = createFloatingRecord(createTabset([panelId]), {
        x: event.clientX - 16,
        y: event.clientY - 12,
      });
      this.state.floating.push(detached);
      activePointerSession.detachedFloatingId = detached.id;
      activePointerSession.floatingId = detached.id;
      activePointerSession.kind = 'window-move';
      activePointerSession.offsetX = 16;
      activePointerSession.offsetY = 12;
      return detached.id;
    }
    const removed = removeTabFromTree(this.state.dock, panelId, true);
    this.state.dock = removed.root;
    const detached = createFloatingRecord(createTabset([panelId]), {
      x: event.clientX - 16,
      y: event.clientY - 12,
    });
    this.state.floating.push(detached);
    activePointerSession.detachedFloatingId = detached.id;
    activePointerSession.floatingId = detached.id;
    activePointerSession.kind = 'window-move';
    activePointerSession.offsetX = 16;
    activePointerSession.offsetY = 12;
    return detached.id;
  }

  _overlayFromPoint(clientX, clientY) {
    const rect = this.el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    if (
      clientX < rect.left - 48 ||
      clientX > rect.right + 48 ||
      clientY < rect.top - 48 ||
      clientY > rect.bottom + 48
    ) return null;
    const centerLeft = rect.left + rect.width * 0.3;
    const centerRight = rect.right - rect.width * 0.3;
    const centerTop = rect.top + rect.height * 0.3;
    const centerBottom = rect.bottom - rect.height * 0.3;
    let zone = null;
    if (clientX >= centerLeft && clientX <= centerRight && clientY >= centerTop && clientY <= centerBottom) zone = 'CENTER';
    else if (clientY < rect.top + rect.height * 0.25) zone = 'NORTH';
    else if (clientY > rect.bottom - rect.height * 0.25) zone = 'SOUTH';
    else if (clientX < rect.left + rect.width * 0.25) zone = 'WEST';
    else if (clientX > rect.right - rect.width * 0.25) zone = 'EAST';
    if (!zone && pointInRect(clientX, clientY, rect)) zone = 'CENTER';
    if (!zone) return null;
    return { rect, zone };
  }

  _updateOverlay(clientX, clientY) {
    const overlay = this._overlayFromPoint(clientX, clientY);
    this.overlayState = overlay;
    this.render();
  }

  _clearOverlay() {
    if (!this.overlayState) return;
    this.overlayState = null;
    this.render();
  }

  _dockFloatingToZone(floatingId, zone) {
    const floatingIndex = this.state.floating.findIndex((item) => item.id === floatingId);
    if (floatingIndex === -1) return;
    const floating = this.state.floating[floatingIndex];
    const sourceNode = ensureNodeId(clone(floating.node));
    this.state.floating.splice(floatingIndex, 1);
    const targetLeaf = this._firstTabset(this.state.dock);
    if (zone === 'CENTER') {
      for (const tab of sourceNode.tabs) {
        if (!targetLeaf.tabs.includes(tab)) targetLeaf.tabs.push(tab);
      }
      targetLeaf.activeTabId = sourceNode.activeTabId || sourceNode.tabs[0] || targetLeaf.activeTabId;
      this.state.dock = pruneEmpty(this.state.dock, true);
      this.render();
      return;
    }
    const axis = zone === 'WEST' || zone === 'EAST' ? 'row' : 'column';
    const incomingFirst = zone === 'WEST' || zone === 'NORTH';
    const replacement = incomingFirst
      ? createSplit(axis, sourceNode, targetLeaf, 0.35)
      : createSplit(axis, targetLeaf, sourceNode, 0.65);
    this.state.dock = replaceNode(this.state.dock, targetLeaf.nodeId, replacement);
    this.state.dock = pruneEmpty(this.state.dock, true);
    this.render();
  }

  _reorderWithinNode(nodeId, panelId, targetPanelId) {
    const node = findNode(this.state.dock, nodeId)
      || this.state.floating.map((item) => item.node).find((item) => item.nodeId === nodeId);
    if (!node || node.type !== 'tabset') return;
    const from = node.tabs.indexOf(panelId);
    const to = node.tabs.indexOf(targetPanelId);
    if (from === -1 || to === -1) return;
    moveItem(node.tabs, from, to);
    node.activeTabId = panelId;
    this.render();
  }

  _onDocumentMove = (event) => {
    if (!activePointerSession || activePointerSession.root !== this) return;
    if (activePointerSession.kind === 'tab') {
      const distance = Math.hypot(event.clientX - activePointerSession.startX, event.clientY - activePointerSession.startY);
      if (distance > 12) {
        this._ensureDetachedFloating(event);
      }
      return;
    }
    if (activePointerSession.kind === 'window-move') {
      const floating = this.state.floating.find((item) => item.id === activePointerSession.floatingId);
      if (!floating) return;
      floating.x = event.clientX - activePointerSession.offsetX;
      floating.y = event.clientY - activePointerSession.offsetY;
      this.overlayState = this._overlayFromPoint(event.clientX, event.clientY);
      this.render();
      return;
    }
    if (activePointerSession.kind === 'window-resize') {
      const floating = this.state.floating.find((item) => item.id === activePointerSession.floatingId);
      if (!floating) return;
      const dx = event.clientX - activePointerSession.startX;
      const dy = event.clientY - activePointerSession.startY;
      let { x, y, width, height } = activePointerSession.startBounds;
      if (activePointerSession.handle.includes('e')) width += dx;
      if (activePointerSession.handle.includes('s')) height += dy;
      if (activePointerSession.handle.includes('w')) {
        x += dx;
        width -= dx;
      }
      if (activePointerSession.handle.includes('n')) {
        y += dy;
        height -= dy;
      }
      if (width < 180) {
        if (activePointerSession.handle.includes('w')) x -= 180 - width;
        width = 180;
      }
      if (height < 120) {
        if (activePointerSession.handle.includes('n')) y -= 120 - height;
        height = 120;
      }
      Object.assign(floating, { x, y, width, height });
      this.render();
      return;
    }
    if (activePointerSession.kind === 'splitter') {
      const split = findNode(this.state.dock, activePointerSession.nodeId);
      const container = this.el.querySelector(`[data-dock-split-id="${activePointerSession.nodeId}"]`);
      if (!split || split.type !== 'split' || !container) return;
      const rect = container.getBoundingClientRect();
      const raw = split.axis === 'row'
        ? (event.clientX - rect.left) / Math.max(rect.width, 1)
        : (event.clientY - rect.top) / Math.max(rect.height, 1);
      split.ratio = clamp(raw, 0.15, 0.85);
      this.render();
    }
  };

  _onDocumentUp = (event) => {
    if (!activePointerSession || activePointerSession.root !== this) return;
    if (activePointerSession.kind === 'tab') {
      const tab = this._tabFromEventTarget(event.target);
      if (tab && tab.dataset.dockNodeId === activePointerSession.nodeId) {
        this._reorderWithinNode(activePointerSession.nodeId, activePointerSession.panelId, tab.dataset.dockTabId);
      }
    } else if (activePointerSession.kind === 'window-move' && this.overlayState?.zone) {
      this._dockFloatingToZone(activePointerSession.floatingId, this.overlayState.zone);
    }
    this.overlayState = null;
    activePointerSession = null;
    this._unbindDocumentSession();
    saveLayout();
    this.render();
  };

  _renderTabset(node, floatingId = null) {
    const shell = document.createElement('div');
    shell.className = 'hf-dock-tabset';
    shell.dataset.dockNodeId = node.nodeId;
    this.leafElements.set(node.nodeId, shell);
    Object.assign(shell.style, {
      display: 'flex',
      flexDirection: 'column',
      minWidth: '0',
      minHeight: '0',
      background: '#171b22',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '8px',
      overflow: 'hidden',
    });

    const tabs = document.createElement('div');
    tabs.className = 'hf-dock-tabs';
    Object.assign(tabs.style, {
      display: 'flex',
      alignItems: 'stretch',
      gap: '1px',
      background: '#222734',
      padding: '4px 4px 0',
      minHeight: '34px',
    });

    for (const panelId of node.tabs) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.dataset.dockTabId = panelId;
      tab.dataset.dockNodeId = node.nodeId;
      tab.className = 'hf-dock-tab';
      tab.textContent = this._panelTitle(panelId);
      Object.assign(tab.style, {
        border: '0',
        borderRadius: '8px 8px 0 0',
        padding: '8px 12px',
        cursor: 'grab',
        color: '#f7f7fb',
        background: node.activeTabId === panelId ? '#2d3442' : '#262c38',
      });
      tab.addEventListener('mousedown', (event) => this._startTabPointer(event, node, panelId, floatingId));
      tab.addEventListener('click', () => {
        node.activeTabId = panelId;
        this.render();
      });
      tabs.appendChild(tab);
    }

    const activePanelId = node.activeTabId || node.tabs[0] || null;
    const body = activePanelId
      ? this._renderPanelBody(activePanelId)
      : (() => {
          const empty = document.createElement('div');
          empty.textContent = 'Drop panels here';
          Object.assign(empty.style, {
            flex: '1',
            display: 'grid',
            placeItems: 'center',
            minHeight: '80px',
            color: 'rgba(255,255,255,0.5)',
            background: '#11141a',
          });
          return empty;
        })();

    shell.append(tabs, body);
    return shell;
  }

  _renderSplit(node) {
    const shell = document.createElement('div');
    shell.className = 'hf-dock-split';
    shell.dataset.dockSplitId = node.nodeId;
    Object.assign(shell.style, {
      display: 'grid',
      minWidth: '0',
      minHeight: '0',
      gap: '0',
      width: '100%',
      height: '100%',
    });
    if (node.axis === 'row') shell.style.gridTemplateColumns = `${node.ratio}fr 8px ${1 - node.ratio}fr`;
    else shell.style.gridTemplateRows = `${node.ratio}fr 8px ${1 - node.ratio}fr`;

    const first = this._renderNode(node.first);
    const second = this._renderNode(node.second);
    const splitter = document.createElement('div');
    splitter.className = 'hf-dock-splitter';
    splitter.dataset.dockSplitterId = node.nodeId;
    Object.assign(splitter.style, {
      background: 'rgba(255,255,255,0.08)',
      cursor: node.axis === 'row' ? 'col-resize' : 'row-resize',
      position: 'relative',
    });
    splitter.addEventListener('mousedown', (event) => this._startSplitterPointer(event, node.nodeId));
    const hit = document.createElement('div');
    Object.assign(hit.style, {
      position: 'absolute',
      inset: node.axis === 'row' ? '0 -4px' : '-4px 0',
    });
    splitter.appendChild(hit);
    shell.append(first, splitter, second);
    return shell;
  }

  _renderNode(node, floatingId = null) {
    return node.type === 'split' ? this._renderSplit(node) : this._renderTabset(node, floatingId);
  }

  _renderFloatingWindow(floating) {
    const shell = document.createElement('div');
    shell.className = 'hf-dock-floating';
    shell.dataset.floatingId = floating.id;
    Object.assign(shell.style, {
      position: 'absolute',
      left: `${floating.x}px`,
      top: `${floating.y}px`,
      width: `${floating.width}px`,
      height: `${floating.height}px`,
      display: 'flex',
      flexDirection: 'column',
      minWidth: '180px',
      minHeight: '120px',
      background: '#161b24',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '10px',
      boxShadow: '0 18px 48px rgba(0,0,0,0.35)',
      overflow: 'hidden',
    });
    const title = document.createElement('div');
    title.className = 'hf-dock-floating-titlebar';
    Object.assign(title.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: '32px',
      padding: '0 10px',
      background: '#252d39',
      cursor: 'move',
    });
    title.textContent = this._panelTitle(floating.node.activeTabId || floating.node.tabs[0] || 'Window');
    title.addEventListener('mousedown', (event) => this._startWindowPointer(event, floating.id));
    shell.append(title, this._renderTabset(floating.node, floating.id));
    for (const handle of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) {
      const edge = document.createElement('div');
      edge.className = 'hf-dock-resize-handle';
      edge.dataset.resizeHandle = handle;
      Object.assign(edge.style, {
        position: 'absolute',
        cursor: getEdgeCursor(handle),
        zIndex: '3',
      });
      if (handle === 'n') Object.assign(edge.style, { left: '10px', right: '10px', top: '-4px', height: '8px' });
      if (handle === 's') Object.assign(edge.style, { left: '10px', right: '10px', bottom: '-4px', height: '8px' });
      if (handle === 'e') Object.assign(edge.style, { top: '10px', bottom: '10px', right: '-4px', width: '8px' });
      if (handle === 'w') Object.assign(edge.style, { top: '10px', bottom: '10px', left: '-4px', width: '8px' });
      if (handle === 'nw') Object.assign(edge.style, { left: '-4px', top: '-4px', width: '10px', height: '10px' });
      if (handle === 'ne') Object.assign(edge.style, { right: '-4px', top: '-4px', width: '10px', height: '10px' });
      if (handle === 'sw') Object.assign(edge.style, { left: '-4px', bottom: '-4px', width: '10px', height: '10px' });
      if (handle === 'se') Object.assign(edge.style, { right: '-4px', bottom: '-4px', width: '10px', height: '10px' });
      edge.addEventListener('mousedown', (event) => this._startResizePointer(event, floating.id, handle));
      shell.appendChild(edge);
    }
    return shell;
  }

  _renderOverlay() {
    if (!this.overlayState) return null;
    const overlay = document.createElement('div');
    overlay.className = 'hf-dock-overlay';
    overlay.dataset.dockZone = this.overlayState.zone;
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      display: 'grid',
      placeItems: 'center',
      background: 'rgba(17,20,26,0.12)',
      zIndex: '20',
    });
    const compass = document.createElement('div');
    Object.assign(compass.style, {
      width: '160px',
      height: '160px',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gridTemplateRows: '1fr 1fr 1fr',
      gap: '8px',
    });
    for (const zone of ['NORTH', 'WEST', 'CENTER', 'EAST', 'SOUTH']) {
      const button = document.createElement('div');
      button.textContent = zone[0];
      button.dataset.zone = zone;
      const position = {
        NORTH: { gridColumn: '2', gridRow: '1' },
        WEST: { gridColumn: '1', gridRow: '2' },
        CENTER: { gridColumn: '2', gridRow: '2' },
        EAST: { gridColumn: '3', gridRow: '2' },
        SOUTH: { gridColumn: '2', gridRow: '3' },
      }[zone];
      Object.assign(button.style, position, {
        display: 'grid',
        placeItems: 'center',
        borderRadius: '12px',
        border: zone === this.overlayState.zone ? '2px solid #f7b538' : '1px solid rgba(255,255,255,0.24)',
        background: zone === this.overlayState.zone ? 'rgba(247,181,56,0.24)' : 'rgba(31,39,51,0.84)',
        color: '#f7f7fb',
        fontWeight: '700',
      });
      compass.appendChild(button);
    }
    overlay.appendChild(compass);
    return overlay;
  }

  render() {
    this.el.replaceChildren();
    this.leafElements.clear();
    const stage = document.createElement('div');
    stage.className = 'hf-dock-stage';
    Object.assign(stage.style, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      minWidth: '0',
      minHeight: '0',
    });
    stage.appendChild(this._renderNode(this.state.dock));
    this.el.appendChild(stage);
    for (const floating of this.state.floating) this.el.appendChild(this._renderFloatingWindow(floating));
    const overlay = this._renderOverlay();
    if (overlay) this.el.appendChild(overlay);
  }
}

export function createDockRoot(el, opts = {}) {
  return new DockRoot(el, opts);
}

export function saveLayout() {
  const store = loadStore();
  for (const [name, root] of ACTIVE_ROOTS.entries()) {
    store.roots[name] = root.getLayout();
  }
  return saveStore(store);
}

export function loadLayout() {
  const store = loadStore();
  for (const [name, root] of ACTIVE_ROOTS.entries()) {
    if (store.roots[name]) root.setLayout(store.roots[name]);
  }
  return store;
}

export function resetLayout(name) {
  const store = loadStore();
  if (name) {
    delete store.roots[name];
    saveStore(store);
    ACTIVE_ROOTS.get(name)?.reset();
    return;
  }
  saveStore({ roots: {} });
  for (const root of ACTIVE_ROOTS.values()) root.reset();
}

export { STORAGE_KEY };
