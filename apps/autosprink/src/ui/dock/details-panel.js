function renderRow(label, value) {
  return `<div class="kv"><span>${label}</span><b>${value}</b></div>`;
}

export function renderDetails(root, selectedElement) {
  if (!root) throw new Error('Details root is required');
  root.innerHTML = '';

  if (!selectedElement) {
    root.innerHTML = '<div class="dock-empty">Select a scene element to inspect its properties.</div>';
    return;
  }

  const rows = Array.isArray(selectedElement.rows) ? selectedElement.rows : [];
  root.innerHTML = `
    <div class="dock-details-title">${selectedElement.title || 'Selected element'}</div>
    ${rows.map(([label, value]) => renderRow(label, value)).join('')}
    ${selectedElement.verify ? `<div class="nv-flag">⚠ NEEDS-VERIFICATION — ${selectedElement.verify}</div>` : ''}
  `;
}
