const ICONS = {
  cursor: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4l6.5 15 2.2-6.2L20 10.5 5 4z" fill="currentColor"/></svg>',
  move: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 3h-2v4h4V7l3 3-3 3v-2h-4v4h2l-3 3-3-3h2v-4H7v2l-3-3 3-3v2h4V5H9l3-3z" fill="currentColor"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="4" y="4" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9 7V4h6v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  pencilRuler: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4l6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3 21l4.5-1 11-11-3.5-3.5-11 11L3 21z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M5 16l3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  squarePen: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="12" height="12" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M14 14l6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16.5 11.5l2 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  pipe: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h7a4 4 0 0 1 4 4v1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="6" cy="7" r="2" fill="currentColor"/><circle cx="17" cy="12" r="2" fill="currentColor"/></svg>',
  sprinkler: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9 14c0 2 1.3 4 3 5 1.7-1 3-3 3-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  drop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 8h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 12l-3 6h6l-3-6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  door: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V5h10v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 12h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="11" cy="12" r="1" fill="currentColor"/></svg>',
  ruler: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15l7-7 9 9-7 3-9-5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 9l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8.5 11.5l1.5 1.5M12 8l1.5 1.5M15.5 11.5l1.5 1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  scissors: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="7" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="17" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 8.5l12-5.5M8 15.5L20 21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  offset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9 9h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M17 6l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  array: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="15" y="4" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="15" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="15" y="15" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  mirror: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2 2"/><path d="M9 8l-4 4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export const TOOLBAR_MODES = [
  { id: 'SELECT', label: 'Select', icon: 'cursor', hint: 'Selection, move, copy, and delete tools' },
  { id: 'DRAW', label: 'Draw', icon: 'pencilRuler', hint: 'Wall, pipe, head, drop, and door placement tools' },
  { id: 'EDIT', label: 'Edit', icon: 'squarePen', hint: 'Trim, offset, array, and mirror tools' },
  { id: 'MEASURE', label: 'Measure', icon: 'ruler', hint: 'Distance and angle readout tools' },
];

export const TOOLBAR_ACTIONS_BY_MODE = {
  SELECT: [
    { id: 'select', label: 'Select', icon: 'cursor', hint: 'Select and inspect parts' },
    { id: 'move', label: 'Move', icon: 'move', hint: 'Move the current selection from a picked base point' },
    { id: 'copy', label: 'Copy', icon: 'copy', hint: 'Copy the current selection from a picked base point' },
    { id: 'delete', label: 'Delete', icon: 'trash', hint: 'Delete the current selection' },
  ],
  DRAW: [
    { id: 'wall', label: 'Wall', icon: 'squarePen', hint: 'Draw walls with multi-point runs' },
    { id: 'pipe', label: 'Pipe', icon: 'pipe', hint: 'Draw sprinkler pipe runs' },
    { id: 'head', label: 'Head', icon: 'sprinkler', hint: 'Place sprinkler heads' },
    { id: 'drop', label: 'Drop', icon: 'drop', hint: 'Place drops and fittings' },
    { id: 'door', label: 'Door', icon: 'door', hint: 'Place doors on plan walls' },
  ],
  EDIT: [
    { id: 'trim', label: 'Trim', icon: 'scissors', hint: 'Trim or extend a selected run' },
    { id: 'offset', label: 'Offset', icon: 'offset', hint: 'Create a parallel offset from the selected run' },
    { id: 'array', label: 'Array', icon: 'array', hint: 'Pattern the current selection into a grid' },
    { id: 'mirror', label: 'Mirror', icon: 'mirror', hint: 'Mirror the current selection across a picked axis' },
  ],
  MEASURE: [
    { id: 'measure', label: 'Measure', icon: 'ruler', hint: 'Measure distance and angle between picked points' },
  ],
};

function normalizeMode(mode) {
  return TOOLBAR_ACTIONS_BY_MODE[mode] ? mode : 'SELECT';
}

function normalizeAction(mode, actionId) {
  const actions = TOOLBAR_ACTIONS_BY_MODE[mode] || TOOLBAR_ACTIONS_BY_MODE.SELECT;
  return actions.some((action) => action.id === actionId) ? actionId : actions[0].id;
}

function modeForAction(actionId) {
  for (const [mode, actions] of Object.entries(TOOLBAR_ACTIONS_BY_MODE)) {
    if (actions.some((action) => action.id === actionId)) return mode;
  }
  return 'SELECT';
}

function iconMarkup(name) {
  return ICONS[name] || ICONS.cursor;
}

function renderModeButton(mode, selectedMode) {
  const selected = mode.id === selectedMode;
  return `<button class="hf-toolbar-mode${selected ? ' is-active' : ''}" type="button" data-mode="${mode.id}" title="${mode.hint}" aria-pressed="${selected ? 'true' : 'false'}"><span class="hf-toolbar-mode-ico">${iconMarkup(mode.icon)}</span><span class="hf-toolbar-mode-text">${mode.label}</span></button>`;
}

function renderActionButton(action, activeAction) {
  const selected = action.id === activeAction;
  return `<button class="hf-toolbar-action${selected ? ' is-active' : ''}" type="button" data-action="${action.id}" title="${action.hint}" aria-pressed="${selected ? 'true' : 'false'}"><span class="hf-toolbar-action-ico">${iconMarkup(action.icon)}</span><span class="hf-toolbar-action-text">${action.label}</span></button>`;
}

export function renderToolbarMarkup({ mode = 'SELECT', activeAction, utilitiesMarkup = '', readoutMarkup = '' } = {}) {
  const currentMode = normalizeMode(mode);
  const currentAction = normalizeAction(currentMode, activeAction);
  const actions = TOOLBAR_ACTIONS_BY_MODE[currentMode];
  return `<div class="hf-toolbar-shell" data-mode="${currentMode}">
    <div class="hf-toolbar-row hf-toolbar-row-modes">
      <div class="hf-toolbar-mode-cluster">${TOOLBAR_MODES.map((entry) => renderModeButton(entry, currentMode)).join('')}</div>
    </div>
    <div class="hf-toolbar-row hf-toolbar-row-context">
      <div class="hf-toolbar-action-cluster" data-context-mode="${currentMode}">${actions.map((action) => renderActionButton(action, currentAction)).join('')}</div>
      <div class="hf-toolbar-spacer"></div>
      ${utilitiesMarkup ? `<div class="hf-toolbar-utility-cluster">${utilitiesMarkup}</div>` : ''}
      ${readoutMarkup || ''}
    </div>
  </div>`;
}

export function renderToolbar(rootEl, { mode = 'SELECT', activeAction, onModeChange, actions = {}, utilitiesMarkup = '', readoutMarkup = '' } = {}) {
  if (!rootEl) throw new Error('renderToolbar(rootEl, ...) requires a root element');

  const state = {
    mode: normalizeMode(mode),
    activeAction: normalizeAction(normalizeMode(mode), activeAction),
  };

  function mount() {
    rootEl.innerHTML = renderToolbarMarkup({
      mode: state.mode,
      activeAction: state.activeAction,
      utilitiesMarkup,
      readoutMarkup,
    });

    for (const btn of rootEl.querySelectorAll('[data-mode]')) {
      btn.addEventListener('click', () => {
        const nextMode = normalizeMode(btn.dataset.mode);
        state.mode = nextMode;
        state.activeAction = normalizeAction(nextMode, state.activeAction);
        mount();
        if (typeof onModeChange === 'function') onModeChange(nextMode);
      });
    }

    for (const btn of rootEl.querySelectorAll('[data-action]')) {
      btn.addEventListener('click', () => {
        const actionId = btn.dataset.action;
        const nextMode = modeForAction(actionId);
        state.mode = nextMode;
        state.activeAction = actionId;
        mount();
        if (typeof actions[actionId] === 'function') actions[actionId]();
      });
    }
  }

  mount();

  return {
    getState() {
      return { ...state };
    },
    setMode(nextMode) {
      state.mode = normalizeMode(nextMode);
      state.activeAction = normalizeAction(state.mode, state.activeAction);
      mount();
    },
    setActiveAction(actionId) {
      state.mode = modeForAction(actionId);
      state.activeAction = normalizeAction(state.mode, actionId);
      mount();
    },
    update(nextState = {}) {
      if (nextState.mode) state.mode = normalizeMode(nextState.mode);
      if (nextState.activeAction) {
        state.mode = modeForAction(nextState.activeAction);
        state.activeAction = normalizeAction(state.mode, nextState.activeAction);
      } else {
        state.activeAction = normalizeAction(state.mode, state.activeAction);
      }
      mount();
    },
    destroy() {
      rootEl.innerHTML = '';
    },
  };
}
