function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderTabGroup(regionClass, spec) {
  const region = el('section', `dock-region ${regionClass}`);
  const shell = el('div', 'dock-group');
  const header = el('div', 'dock-group-header');
  const title = el('div', 'dock-group-title', spec.title || '');
  const tabs = el('div', 'dock-tabs');
  const panels = el('div', 'dock-panels');
  const buttons = new Map();
  const panelNodes = new Map();

  header.append(title, tabs);
  shell.append(header, panels);
  region.appendChild(shell);

  const activeId = spec.activeId || (spec.tabs[0] && spec.tabs[0].id) || null;
  let currentId = activeId;

  function activate(tabId) {
    currentId = tabId;
    for (const [id, btn] of buttons) {
      const on = id === currentId;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      const panel = panelNodes.get(id);
      if (panel) panel.hidden = !on;
    }
  }

  for (const tab of spec.tabs) {
    const btn = el('button', 'dock-tab', tab.label);
    btn.type = 'button';
    btn.dataset.tabId = tab.id;
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => activate(tab.id));
    buttons.set(tab.id, btn);
    tabs.appendChild(btn);

    const panel = el('div', 'dock-panel');
    panel.dataset.tabId = tab.id;
    panel.setAttribute('role', 'tabpanel');
    if (tab.mount) panel.appendChild(tab.mount);
    panelNodes.set(tab.id, panel);
    panels.appendChild(panel);
  }

  activate(currentId);
  return { region, activate, panels: panelNodes };
}

export function renderDockRoot(root, spec) {
  if (!root) throw new Error('Dock root mount is required');
  root.innerHTML = '';

  const dock = el('div', 'dock-root');
  const left = renderTabGroup('dock-region-left', spec.left);
  const right = renderTabGroup('dock-region-right', spec.right);
  const bottom = renderTabGroup('dock-region-bottom', spec.bottom);
  const center = el('section', 'dock-region dock-region-center');

  if (spec.center && spec.center.mount) center.appendChild(spec.center.mount);

  dock.append(left.region, center, right.region, bottom.region);
  root.appendChild(dock);

  return {
    activate(region, tabId) {
      if (region === 'left') left.activate(tabId);
      if (region === 'right') right.activate(tabId);
      if (region === 'bottom') bottom.activate(tabId);
    },
    regions: {
      left: left.region,
      center,
      right: right.region,
      bottom: bottom.region,
    },
    panels: {
      left: left.panels,
      right: right.panels,
      bottom: bottom.panels,
    },
  };
}
