// PURE catalog logic tests: grouping buckets every record by category, and the
// case-insensitive filter matches name / key / category and returns [] when no
// record matches.

import { describe, expect, it } from 'vitest';
import {
  catalogCounts,
  filterParts,
  groupByCategory,
} from '../src/lib/catalog';
import type { PartRecord } from '../src/lib/parts-manifest';
import type { ModelStatus } from '../src/lib/provenance';

function rec(
  partial: Partial<PartRecord> & Pick<PartRecord, 'key' | 'category' | 'name'>,
): PartRecord {
  return {
    source: 'generated',
    manufacturerExact: false,
    present: true,
    file: `parts/${partial.key}.stl`,
    stlUrl: `/parts/${partial.key}.stl`,
    modelStatus: 'visual_reference' as ModelStatus,
    ...partial,
  };
}

const records: PartRecord[] = [
  rec({ key: 'head_pendent', category: 'heads', name: 'Pendent sprinkler head' }),
  rec({ key: 'head_upright', category: 'heads', name: 'Upright sprinkler head' }),
  rec({ key: 'pipe_main', category: 'pipe', name: 'Main pipe run' }),
  rec({
    key: 'valve_riser',
    category: 'valves',
    name: 'Riser check valve',
    present: false,
    file: null,
    stlUrl: null,
  }),
  rec({ key: 'pipe_branch', category: 'pipe', name: 'Branch line' }),
];

describe('groupByCategory', () => {
  it('buckets every record into exactly one category, losing none', () => {
    const groups = groupByCategory(records);
    const total = groups.reduce((n, g) => n + g.parts.length, 0);
    expect(total).toBe(records.length);
  });

  it('preserves first-seen category order', () => {
    const groups = groupByCategory(records);
    expect(groups.map((g) => g.category)).toEqual(['heads', 'pipe', 'valves']);
  });

  it('preserves within-bucket insertion order', () => {
    const groups = groupByCategory(records);
    const pipe = groups.find((g) => g.category === 'pipe');
    expect(pipe?.parts.map((p) => p.key)).toEqual(['pipe_main', 'pipe_branch']);
  });

  it('returns [] for no records', () => {
    expect(groupByCategory([])).toEqual([]);
  });

  it('does not mutate or duplicate any record', () => {
    const groups = groupByCategory(records);
    const keys = groups.flatMap((g) => g.parts.map((p) => p.key)).sort();
    expect(keys).toEqual(
      [...records].map((r) => r.key).sort(),
    );
  });
});

describe('filterParts', () => {
  it('matches on name (case-insensitive)', () => {
    const out = filterParts(records, 'PENDENT');
    expect(out.map((p) => p.key)).toEqual(['head_pendent']);
  });

  it('matches on key (case-insensitive)', () => {
    const out = filterParts(records, 'PIPE_');
    expect(out.map((p) => p.key)).toEqual(['pipe_main', 'pipe_branch']);
  });

  it('matches on category (case-insensitive)', () => {
    const out = filterParts(records, 'Valves');
    expect(out.map((p) => p.key)).toEqual(['valve_riser']);
  });

  it('returns all records for an empty / whitespace query', () => {
    expect(filterParts(records, '')).toHaveLength(records.length);
    expect(filterParts(records, '   ')).toHaveLength(records.length);
  });

  it('returns [] when nothing matches', () => {
    expect(filterParts(records, 'zzz-no-such-part')).toEqual([]);
  });

  it('preserves input order in results', () => {
    const out = filterParts(records, 'head');
    expect(out.map((p) => p.key)).toEqual(['head_pendent', 'head_upright']);
  });

  it('does not mutate the input array', () => {
    const before = records.map((r) => r.key);
    filterParts(records, 'pipe');
    expect(records.map((r) => r.key)).toEqual(before);
  });
});

describe('catalogCounts', () => {
  it('counts present vs total honestly (never inflates)', () => {
    expect(catalogCounts(records)).toEqual({ present: 4, total: 5 });
  });

  it('is zero/zero for an empty catalog', () => {
    expect(catalogCounts([])).toEqual({ present: 0, total: 0 });
  });
});
