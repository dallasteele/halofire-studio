function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function levelKeyForSolid(solid) {
  if (Number.isFinite(solid?.level)) return `Level ${solid.level}`;
  if (Number.isFinite(solid?.story)) return `Level ${solid.story}`;
  if (Number.isFinite(solid?.floor)) return `Level ${solid.floor}`;
  if (typeof solid?.levelName === 'string' && solid.levelName.trim()) return solid.levelName.trim();
  return 'Level 1';
}

function labelForSolid(solid, index) {
  if (!solid || typeof solid !== 'object') return `Item ${index + 1}`;
  if (solid.kind === 'wall') return `Wall ${index + 1}`;
  if (solid.kind === 'pipe') {
    const role = solid.smartRole || solid.role || 'pipe';
    const size = Number.isFinite(solid.diameterIn) ? ` ${solid.diameterIn}"` : '';
    return `${role}${size} #${index + 1}`;
  }
  if (solid.kind === 'head') return `Head ${index + 1}`;
  if (solid.kind === 'component') return `${solid.componentKey || 'Component'} #${index + 1}`;
  if (solid.kind === 'column') return `Column ${index + 1}`;
  return `${solid.kind || 'Item'} ${index + 1}`;
}

function buildTree(cadModel) {
  if (!cadModel || !Array.isArray(cadModel.solids)) return [];
  const levels = new Map();
  cadModel.solids.forEach((solid, solidIndex) => {
    const levelKey = levelKeyForSolid(solid);
    const bucket = levels.get(levelKey) || {
      key: levelKey,
      walls: [],
      pipes: [],
      heads: [],
      components: [],
      other: [],
    };
    const entry = { solid, solidIndex, label: labelForSolid(solid, solidIndex) };
    if (solid.kind === 'wall') bucket.walls.push(entry);
    else if (solid.kind === 'pipe') bucket.pipes.push(entry);
    else if (solid.kind === 'head') bucket.heads.push(entry);
    else if (solid.kind === 'component') bucket.components.push(entry);
    else bucket.other.push(entry);
    levels.set(levelKey, bucket);
  });
  return [...levels.values()];
}

function renderSection(title, entries, root, onSelect) {
  if (!entries.length) return '';
  const items = entries.map((entry) => (
    `<button type="button" class="dock-tree-leaf" data-solid-index="${entry.solidIndex}">${escapeHtml(entry.label)}</button>`
  )).join('');
  return `<details class="dock-tree-group"><summary>${escapeHtml(title)} <span>${entries.length}</span></summary><div class="dock-tree-children">${items}</div></details>`;
}

export function renderOutliner(root, cadModel, onSelect) {
  if (!root) return;
  const levels = buildTree(cadModel);
  if (!levels.length) {
    root.innerHTML = '<p class="dock-empty">Generate a layout to build the scene tree.</p>';
    return;
  }
  const counts = cadModel.counts || {};
  root.innerHTML = `
    <div class="dock-tree">
      <details class="dock-tree-group" open>
        <summary>Building <span>${levels.length} level${levels.length === 1 ? '' : 's'}</span></summary>
        <div class="dock-tree-children">
          <div class="dock-tree-summary">
            <span>${escapeHtml(`${counts.walls ?? 0} walls`)}</span>
            <span>${escapeHtml(`${counts.pipes ?? 0} pipes`)}</span>
            <span>${escapeHtml(`${counts.heads ?? 0} heads`)}</span>
          </div>
          ${levels.map((level) => `
            <details class="dock-tree-group" open>
              <summary>${escapeHtml(level.key)}</summary>
              <div class="dock-tree-children">
                ${renderSection('Walls', level.walls, root, onSelect)}
                ${renderSection('Pipes', level.pipes, root, onSelect)}
                ${renderSection('Heads', level.heads, root, onSelect)}
                ${renderSection('Components', level.components, root, onSelect)}
                ${renderSection('Other', level.other, root, onSelect)}
              </div>
            </details>
          `).join('')}
        </div>
      </details>
    </div>
  `;
  root.querySelectorAll('[data-solid-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const solidIndex = Number(button.dataset.solidIndex);
      if (!Number.isFinite(solidIndex) || typeof onSelect !== 'function') return;
      const solid = cadModel.solids[solidIndex];
      onSelect({ type: 'solid', solidIndex, solid, label: labelForSolid(solid, solidIndex) });
    });
  });
}
