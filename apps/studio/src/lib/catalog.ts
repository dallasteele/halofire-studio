// PURE catalog logic — no React / three imports. Powers the CatalogBrowser
// left panel: group all catalogued parts by category, and filter them by a
// case-insensitive query over name / key / category.
//
// HONESTY: this module only groups and filters the records it is given. It
// never fabricates a part, never flips provenance, and preserves every record.

import type { PartRecord } from './parts-manifest';

export interface CategoryGroup {
  /** Category name (the bucket key). */
  category: string;
  /** Records in this category, in their original order. */
  parts: PartRecord[];
}

/**
 * Group records by category, preserving first-seen category order and within-
 * bucket insertion order. Every input record lands in exactly one group; no
 * record is dropped or duplicated.
 */
export function groupByCategory(records: readonly PartRecord[]): CategoryGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, PartRecord[]>();
  for (const r of records) {
    const existing = buckets.get(r.category);
    if (existing) {
      existing.push(r);
    } else {
      buckets.set(r.category, [r]);
      order.push(r.category);
    }
  }
  return order.map((category) => ({
    category,
    parts: buckets.get(category) as PartRecord[],
  }));
}

/**
 * Case-insensitive filter over a part's name, key, and category. An empty or
 * whitespace-only query returns all records (no filtering). Deterministic:
 * preserves input order and returns [] when nothing matches.
 */
export function filterParts(
  records: readonly PartRecord[],
  query: string,
): PartRecord[] {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return [...records];
  }
  return records.filter((r) => {
    return (
      r.name.toLowerCase().includes(q) ||
      r.key.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q)
    );
  });
}

/**
 * Total counts for the header status chip: how many records are present vs.
 * catalogued. Pure derivation, never inflates.
 */
export function catalogCounts(records: readonly PartRecord[]): {
  present: number;
  total: number;
} {
  let present = 0;
  for (const r of records) {
    if (r.present) present += 1;
  }
  return { present, total: records.length };
}
