export interface BomItem {
  category: string;
  sizeIn: number;
  material: string;
  qty: number;
  unitCost: number;
}

export interface BomRow {
  key: string;
  category: string;
  sizeIn: number;
  material: string;
  qty: number;
  unitCost: number;
  extendedCost: number;
}

export interface BomSummary {
  rows: BomRow[];
  totalQty: number;
  totalCost: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function groupBom(items: BomItem[]): BomSummary {
  // Validate all items
  for (const item of items) {
    if (item.qty < 0 || item.unitCost < 0 || !Number.isFinite(item.qty) || !Number.isFinite(item.unitCost)) {
      throw new Error('Invalid item: negative or non-finite quantity or unit cost');
    }
  }

  // Group by key: `${category}|${sizeIn}|${material}`
  const groups = new Map<string, { items: BomItem[]; firstUnitCost: number }>();

  for (const item of items) {
    const key = `${item.category}|${item.sizeIn}|${item.material}`;
    if (!groups.has(key)) {
      groups.set(key, { items: [item], firstUnitCost: item.unitCost });
    } else {
      groups.get(key)!.items.push(item);
    }
  }

  // Create rows from groups
  const rows: BomRow[] = [];
  for (const [key, group] of groups) {
    const totalQty = group.items.reduce((sum, i) => sum + i.qty, 0);
    const extendedCost = round2(totalQty * group.firstUnitCost);
    rows.push({
      key,
      category: group.items[0].category,
      sizeIn: group.items[0].sizeIn,
      material: group.items[0].material,
      qty: totalQty,
      unitCost: group.firstUnitCost,
      extendedCost
    });
  }

  // Sort rows by key ascending
  rows.sort((a, b) => a.key.localeCompare(b.key));

  // Calculate totals
  const totalQty = rows.reduce((sum, row) => sum + row.qty, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.extendedCost, 0);

  return {
    rows,
    totalQty: round2(totalQty),
    totalCost: round2(totalCost)
  };
}