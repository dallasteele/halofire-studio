import { stock } from './stock.js';

export function bom(components = [], quantities = {}) {
  const entries = new Map();

  for (const component of components) {
    const key = String(component?.componentKey || component?.key || '').trim();
    if (!key) continue;
    const current = entries.get(key) || 0;
    entries.set(key, current + 1);
  }

  for (const [rawKey, rawQty] of Object.entries(quantities || {})) {
    const key = String(rawKey || '').trim();
    if (!key) continue;
    const qty = positiveOrZero(rawQty);
    if (qty === 0) continue;
    entries.set(key, qty);
  }

  return [...entries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, quantity]) => {
      const itemStock = stock(key);
      return {
        key,
        description: itemStock.description,
        category: itemStock.category,
        unit: itemStock.unit,
        quantity,
        unitCost: round2(itemStock.unitCost),
        lineTotal: round2(itemStock.unitCost * quantity),
        laborHoursPerUnit: itemStock.laborHoursPerUnit,
      };
    });
}

function positiveOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
