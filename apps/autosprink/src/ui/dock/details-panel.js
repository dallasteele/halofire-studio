function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtValue(value) {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function rowsForSelection(selectedElement) {
  if (!selectedElement || !selectedElement.solid || typeof selectedElement.solid !== 'object') return [];
  const solid = selectedElement.solid;
  const rows = [
    ['Label', selectedElement.label || solid.kind || 'Selected element'],
    ['Kind', solid.kind || '—'],
  ];
  if (solid.role) rows.push(['Role', solid.role]);
  if (solid.smartRole) rows.push(['Smart role', solid.smartRole]);
  if (Number.isFinite(solid.diameterIn)) rows.push(['Diameter (in)', solid.diameterIn]);
  if (Array.isArray(solid.position)) rows.push(['Position (ft)', fmtValue(solid.position)]);
  if (Array.isArray(solid.from)) rows.push(['From (ft)', fmtValue(solid.from)]);
  if (Array.isArray(solid.to)) rows.push(['To (ft)', fmtValue(solid.to)]);
  if (Number.isFinite(solid.heightFt)) rows.push(['Height (ft)', solid.heightFt]);
  if (Number.isFinite(solid.lengthFt)) rows.push(['Length (ft)', solid.lengthFt]);
  if (solid.componentKey) rows.push(['Component', solid.componentKey]);
  return rows;
}

export function renderDetails(root, selectedElement) {
  if (!root) return;
  const rows = rowsForSelection(selectedElement);
  if (!rows.length) {
    root.innerHTML = '<p class="dock-empty">No element selected. Click a part in the viewport or the outliner.</p>';
    return;
  }
  root.innerHTML = rows.map(([label, value]) => (
    `<div class="kv"><span>${escapeHtml(label)}</span><b>${escapeHtml(fmtValue(value))}</b></div>`
  )).join('');
}
