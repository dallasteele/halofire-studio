import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveStlUrl,
  normalizeManifest,
  partsByCategory,
  presentParts,
  type RawManifest,
} from '../src/lib/parts-manifest';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, '../public/parts/parts-manifest.json');
const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as RawManifest;

describe('normalizeManifest (real manifest)', () => {
  const records = normalizeManifest(raw);

  it('maps every component (34 total = 22 present + 12 missing)', () => {
    expect(raw.components).toBeDefined();
    expect(records).toHaveLength(raw.components!.length);
    expect(records.length).toBeGreaterThan(0);
  });

  it('derives stlUrl by stripping leading "parts/" and prefixing "/parts/"', () => {
    const head = records.find((r) => r.key === 'head_pendent');
    expect(head).toBeDefined();
    expect(head!.file).toBe('parts/head_pendent.stl');
    expect(head!.stlUrl).toBe('/parts/head_pendent.stl');
  });

  it('yields a null stlUrl for parts with no file (missing parts)', () => {
    const cap = records.find((r) => r.key === 'fitting_cap');
    expect(cap).toBeDefined();
    expect(cap!.present).toBe(false);
    expect(cap!.file).toBeNull();
    expect(cap!.stlUrl).toBeNull();
  });

  it('preserves source honestly (generated vs missing)', () => {
    const head = records.find((r) => r.key === 'head_pendent')!;
    const cap = records.find((r) => r.key === 'fitting_cap')!;
    expect(head.source).toBe('generated');
    expect(cap.source).toBe('missing');
  });

  it('never silently flips manufacturerExact to true', () => {
    // Every record in this manifest is honestly false.
    expect(records.every((r) => r.manufacturerExact === false)).toBe(true);
    // And the manifest itself reports zero manufacturer-exact parts.
    expect(raw.manufacturerExactCount).toBe(0);
  });
});

describe('presentParts', () => {
  const records = normalizeManifest(raw);

  it('returns exactly the 22 present meshes', () => {
    const present = presentParts(records);
    expect(present).toHaveLength(22);
    expect(present.every((r) => r.present === true)).toBe(true);
    expect(present.every((r) => r.stlUrl !== null)).toBe(true);
    // Matches manifest self-report.
    expect(raw.generatedCount).toBe(22);
  });

  it('filters out missing parts', () => {
    const present = presentParts(records);
    expect(present.find((r) => r.key === 'fitting_cap')).toBeUndefined();
    expect(present.find((r) => r.key === 'fdc')).toBeUndefined();
  });
});

describe('partsByCategory', () => {
  it('groups present parts into their categories', () => {
    const present = presentParts(normalizeManifest(raw));
    const byCat = partsByCategory(present);
    // Four sprinkler-head meshes are required + two optional = 6 heads present.
    expect(byCat.get('heads')).toHaveLength(6);
    // Valves: alarm_check, check, butterfly, osy_gate, prv, deluge = 6.
    expect(byCat.get('valves')).toHaveLength(6);
    // Sum across categories equals total present.
    const total = [...byCat.values()].reduce((n, b) => n + b.length, 0);
    expect(total).toBe(present.length);
  });
});

describe('deriveStlUrl (unit)', () => {
  it('strips exactly one leading parts/ segment', () => {
    expect(deriveStlUrl('parts/valve_check.stl')).toBe('/parts/valve_check.stl');
  });

  it('returns null for null/undefined/empty', () => {
    expect(deriveStlUrl(null)).toBeNull();
    expect(deriveStlUrl(undefined)).toBeNull();
    expect(deriveStlUrl('')).toBeNull();
  });

  it('handles a bare filename with no parts/ prefix', () => {
    expect(deriveStlUrl('hanger.stl')).toBe('/parts/hanger.stl');
  });
});

describe('normalizeManifest (defensive)', () => {
  it('returns [] for null / missing components', () => {
    expect(normalizeManifest(null)).toEqual([]);
    expect(normalizeManifest({})).toEqual([]);
  });

  it('does not coerce a truthy non-boolean manufacturerExact into true', () => {
    const recs = normalizeManifest({
      components: [
        // @ts-expect-error intentionally malformed to prove no silent coercion
        { key: 'x', category: 'c', name: 'X', manufacturerExact: 'yes', present: true, file: 'parts/x.stl' },
      ],
    });
    expect(recs[0].manufacturerExact).toBe(false);
  });
});
