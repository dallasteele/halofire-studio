function textLabelForSolid(solid, index) {
  const base = solid.name || solid.role || solid.kind || `solid-${index + 1}`;
  const suffix = solid.kind === 'pipe' && solid.diameterIn ? ` · ${solid.diameterIn}"` : '';
  return `${base}${suffix}`;
}

function groupSolidKinds(solids, indexBySolid) {
  const groups = new Map();
  for (const solid of solids || []) {
    const kind = solid.kind || 'other';
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push({ solid, solidIndex: indexBySolid.get(solid) });
  }
  return groups;
}

function appendSolidList(list, titleText, solids, indexBySolid, onSelect) {
  if (!solids || !solids.length) return;
  const item = document.createElement('li');
  item.className = 'outliner-branch';
  const title = document.createElement('div');
  title.className = 'outliner-heading';
  title.textContent = `${titleText} (${solids.length})`;
  item.appendChild(title);

  const nested = document.createElement('ul');
  nested.className = 'outliner-list';
  for (const solid of solids) {
    const solidIndex = indexBySolid.get(solid);
    const leaf = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'outliner-node';
    if (String(solidIndex) === (list.closest('[data-selected-solid-index]')?.dataset.selectedSolidIndex || '')) {
      btn.classList.add('selected');
    }
    btn.textContent = textLabelForSolid(solid, solidIndex ?? nested.children.length);
    btn.addEventListener('click', () => onSelect({ solidIndex }));
    leaf.appendChild(btn);
    nested.appendChild(leaf);
  }
  item.appendChild(nested);
  list.appendChild(item);
}

function appendLevel(list, label, solids, spaces, indexBySolid, onSelect) {
  const item = document.createElement('li');
  item.className = 'outliner-branch';

  const title = document.createElement('div');
  title.className = 'outliner-heading';
  title.textContent = label;
  item.appendChild(title);

  const nested = document.createElement('ul');
  nested.className = 'outliner-list';

  if (spaces && spaces.length) {
    const spacesItem = document.createElement('li');
    spacesItem.className = 'outliner-branch';
    const spacesTitle = document.createElement('div');
    spacesTitle.className = 'outliner-heading';
    spacesTitle.textContent = `Spaces (${spaces.length})`;
    spacesItem.appendChild(spacesTitle);
    const spacesList = document.createElement('ul');
    spacesList.className = 'outliner-list';
    for (const space of spaces) {
      const spaceRow = document.createElement('li');
      spaceRow.textContent = `${space.name || 'Space'}${space.hazard ? ` · ${space.hazard}` : ''}`;
      spacesList.appendChild(spaceRow);
    }
    spacesItem.appendChild(spacesList);
    nested.appendChild(spacesItem);
  }

  const groups = groupSolidKinds(solids, indexBySolid);
  appendSolidList(nested, 'Walls', groups.get('wall'), indexBySolid, onSelect);
  appendSolidList(nested, 'Pipes', groups.get('pipe'), indexBySolid, onSelect);
  appendSolidList(nested, 'Heads', groups.get('head'), indexBySolid, onSelect);
  appendSolidList(nested, 'Columns', groups.get('column'), indexBySolid, onSelect);
  appendSolidList(nested, 'Components', groups.get('component'), indexBySolid, onSelect);

  item.appendChild(nested);
  list.appendChild(item);
}

export function renderOutliner(root, cadModel, onSelect) {
  if (!root) throw new Error('Outliner root is required');
  root.innerHTML = '';
  root.classList.add('outliner-root');

  if (!cadModel || !Array.isArray(cadModel.solids) || cadModel.solids.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dock-empty';
    empty.textContent = 'Generate a layout to inspect the live scene tree.';
    root.appendChild(empty);
    return;
  }

  const indexBySolid = new Map(cadModel.solids.map((solid, index) => [solid, index]));
  const tree = document.createElement('ul');
  tree.className = 'outliner-list';

  const shell = document.createElement('li');
  shell.className = 'outliner-branch';
  const shellTitle = document.createElement('div');
  shellTitle.className = 'outliner-heading';
  shellTitle.textContent = cadModel.name || 'Scene';
  shell.appendChild(shellTitle);
  const shellList = document.createElement('ul');
  shellList.className = 'outliner-list';

  if (Array.isArray(cadModel.stories) && cadModel.stories.length) {
    for (const story of cadModel.stories) {
      appendLevel(
        shellList,
        `Level ${story.level ?? shellList.children.length + 1}`,
        story.solids || [],
        story.spaces || [],
        indexBySolid,
        onSelect,
      );
    }
  } else if (Array.isArray(cadModel.floors) && cadModel.floors.length) {
    for (const floor of cadModel.floors) {
      appendLevel(
        shellList,
        `Floor ${floor.level ?? shellList.children.length + 1}`,
        floor.solids || [],
        floor.rooms || [],
        indexBySolid,
        onSelect,
      );
    }
  } else {
    appendLevel(shellList, 'Model', cadModel.solids || [], cadModel.rooms || [], indexBySolid, onSelect);
  }

  shell.appendChild(shellList);
  tree.appendChild(shell);
  root.appendChild(tree);
}
