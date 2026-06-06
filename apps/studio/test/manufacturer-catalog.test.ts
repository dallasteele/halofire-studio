import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  filterCatalog,
  groupByManufacturer,
  loadManufacturerCatalog,
  parseCatalogEntry,
  parseManufacturerCatalog,
  type CatalogPart,
  type ManufacturerCatalog,
} from '../src/lib/manufacturer-catalog';

// ----------------------------------------------------------------- fixtures
function fixtureJson(): unknown {
  return {
    generatedAt: '2026-06-05T00:00:00Z',
    disclaimer: 'spec records only',
    sources: [
      { mfr: 'Tyco', url: 'https://example.com/tfp171.pdf', partCount: 2 },
      {
        mfr: 'Reliable',
        url: 'https://example.com/104.pdf',
        partCount: 0,
        error: 'no spec block parsed',
      },
    ],
    entries: [
      {
        id: 'tyco-ty1131',
        mfr: 'Tyco',
        model: 'Series TY-FRB TY1131',
        sin: 'TY1131',
        category: 'head_upright',
        kFactor: 2.8,
        port: { method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'INLET' },
        tempRatingsF: [135, 155, 175],
        responseType: 'quick',
        finishes: null,
        datasheetUrl: 'https://example.com/tfp171.pdf',
        sourceUrl: 'https://example.com/ty-frb',
      },
      {
        id: 'tyco-ty1231',
        mfr: 'Tyco',
        model: 'Series TY-FRB TY1231',
        sin: 'TY1231',
        category: 'head_pendent',
        kFactor: 2.8,
        port: { method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'INLET' },
        tempRatingsF: [135, 155],
        responseType: 'quick',
        finishes: null,
        datasheetUrl: 'https://example.com/tfp171.pdf',
        sourceUrl: 'https://example.com/ty-frb',
      },
      {
        id: 'reliable-ra6322',
        mfr: 'Reliable',
        model: 'Model F1FR80',
        sin: 'RA6322',
        category: 'head_upright',
        kFactor: 8.0,
        port: { method: 'THREADED_NPT', nominalSizeIn: 0.75, role: 'INLET' },
        tempRatingsF: [135, 155, 175, 200, 286],
        responseType: 'quick',
        finishes: null,
        datasheetUrl: 'https://example.com/063.pdf',
        sourceUrl: 'https://example.com/063.pdf',
      },
    ],
  };
}

// ----------------------------------------------------------------- parse
describe('parseCatalogEntry (honesty gate)', () => {
  it('drops an entry missing mfr / model / datasheetUrl', () => {
    expect(parseCatalogEntry({ model: 'x', datasheetUrl: 'u' })).toBeNull();
    expect(parseCatalogEntry({ mfr: 'x', datasheetUrl: 'u' })).toBeNull();
    expect(parseCatalogEntry({ mfr: 'x', model: 'y' })).toBeNull();
    expect(parseCatalogEntry({ mfr: '', model: 'y', datasheetUrl: 'u' })).toBeNull();
    expect(parseCatalogEntry(null)).toBeNull();
    expect(parseCatalogEntry('nope')).toBeNull();
  });

  it('keeps a valid entry and nulls unparseable optional fields', () => {
    const p = parseCatalogEntry({
      mfr: 'Tyco',
      model: 'Series TY-FRB TY1131',
      datasheetUrl: 'https://example.com/x.pdf',
      kFactor: 'oops', // bad -> null, NOT fabricated
      tempRatingsF: 'oops', // bad -> null
      port: { method: '', nominalSizeIn: 'no', role: '' }, // empty -> null
    });
    expect(p).not.toBeNull();
    expect(p!.kFactor).toBeNull();
    expect(p!.tempRatingsF).toBeNull();
    expect(p!.port).toBeNull();
    expect(p!.sin).toBeNull();
    // sourceUrl defaults to datasheetUrl when missing.
    expect(p!.sourceUrl).toBe('https://example.com/x.pdf');
  });

  it('preserves a real port and numeric kFactor', () => {
    const p = parseCatalogEntry({
      mfr: 'Reliable',
      model: 'Model F1FR80',
      sin: 'RA6322',
      datasheetUrl: 'https://example.com/063.pdf',
      kFactor: 8.0,
      port: { method: 'THREADED_NPT', nominalSizeIn: 0.75, role: 'INLET' },
    })!;
    expect(p.kFactor).toBe(8.0);
    expect(p.port).toEqual({
      method: 'THREADED_NPT',
      nominalSizeIn: 0.75,
      role: 'INLET',
    });
  });
});

describe('parseManufacturerCatalog', () => {
  it('parses a well-formed catalog', () => {
    const cat = parseManufacturerCatalog(fixtureJson());
    expect(cat.entries).toHaveLength(3);
    expect(cat.generatedAt).toBe('2026-06-05T00:00:00Z');
    expect(cat.sources).toHaveLength(2);
    expect(cat.sources[1].error).toBe('no spec block parsed');
  });

  it('drops malformed entries but keeps the good ones', () => {
    const cat = parseManufacturerCatalog({
      entries: [
        { mfr: 'Tyco', model: 'good', datasheetUrl: 'https://e/x.pdf' },
        { mfr: 'Tyco' }, // malformed -> dropped
        null,
        { model: 'no mfr', datasheetUrl: 'u' }, // dropped
      ],
    });
    expect(cat.entries).toHaveLength(1);
    expect(cat.entries[0].model).toBe('good');
  });

  it('unknown shape -> empty catalog', () => {
    expect(parseManufacturerCatalog(null).entries).toHaveLength(0);
    expect(parseManufacturerCatalog('x').entries).toHaveLength(0);
    expect(parseManufacturerCatalog({}).entries).toHaveLength(0);
  });
});

// ----------------------------------------------------------------- group
describe('groupByManufacturer', () => {
  it('groups by mfr then category, preserving order and counts', () => {
    const cat = parseManufacturerCatalog(fixtureJson());
    const groups = groupByManufacturer(cat.entries);
    expect(groups.map((g) => g.mfr)).toEqual(['Tyco', 'Reliable']);
    const tyco = groups[0];
    expect(tyco.count).toBe(2);
    expect(tyco.categories.map((c) => c.category)).toEqual([
      'head_upright',
      'head_pendent',
    ]);
    expect(tyco.categories[0].parts[0].sin).toBe('TY1131');
    expect(groups[1].count).toBe(1);
  });

  it('every input part lands in exactly one bucket', () => {
    const cat = parseManufacturerCatalog(fixtureJson());
    const groups = groupByManufacturer(cat.entries);
    const total = groups.reduce((s, g) => s + g.count, 0);
    expect(total).toBe(cat.entries.length);
  });
});

// ----------------------------------------------------------------- filter
describe('filterCatalog', () => {
  const parts: CatalogPart[] = parseManufacturerCatalog(fixtureJson()).entries;

  it('empty query returns all', () => {
    expect(filterCatalog(parts, '')).toHaveLength(3);
    expect(filterCatalog(parts, '   ')).toHaveLength(3);
  });

  it('matches by SIN (case-insensitive)', () => {
    const r = filterCatalog(parts, 'ra6322');
    expect(r).toHaveLength(1);
    expect(r[0].sin).toBe('RA6322');
  });

  it('matches by manufacturer', () => {
    expect(filterCatalog(parts, 'tyco')).toHaveLength(2);
  });

  it('matches by K-factor string', () => {
    expect(filterCatalog(parts, '8').length).toBeGreaterThanOrEqual(1);
  });

  it('no match -> empty', () => {
    expect(filterCatalog(parts, 'zzzznope')).toHaveLength(0);
  });
});

// ----------------------------------------------------------------- loader
describe('loadManufacturerCatalog (fail-soft)', () => {
  it('no fetchImpl -> empty', async () => {
    const out = await loadManufacturerCatalog();
    expect(out.entries).toHaveLength(0);
  });

  it('non-2xx -> empty', async () => {
    const f = vi.fn(async () => ({
      ok: false,
      status: 404,
      async json() {
        return {};
      },
    })) as unknown as typeof fetch;
    expect((await loadManufacturerCatalog(f)).entries).toHaveLength(0);
  });

  it('invalid JSON -> empty', async () => {
    const f = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        throw new Error('not json');
      },
    })) as unknown as typeof fetch;
    expect((await loadManufacturerCatalog(f)).entries).toHaveLength(0);
  });

  it('valid payload -> parsed', async () => {
    const payload = fixtureJson();
    const f = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
    })) as unknown as typeof fetch;
    const out = await loadManufacturerCatalog(f);
    expect(out.entries).toHaveLength(3);
    expect(f).toHaveBeenCalledWith('/catalog/manufacturer-catalog.json');
  });
});

// --------------------------------------- shipped-file assertion (REAL breadth)
// Runs against the SHIPPED public/catalog/manufacturer-catalog.json — the real
// ingested catalog. Proves genuine breadth (>=40 entries), that every entry
// traces to a real datasheetUrl with a real mfr + model, and that at least Tyco
// + one other manufacturer are represented (proves multi-source real data).
describe('shipped manufacturer-catalog.json (REAL ingested data)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const catalogPath = resolve(here, '../public/catalog/manufacturer-catalog.json');
  const raw = JSON.parse(readFileSync(catalogPath, 'utf-8')) as unknown;
  const cat: ManufacturerCatalog = parseManufacturerCatalog(raw);

  it('has at least 40 real entries', () => {
    expect(cat.entries.length).toBeGreaterThanOrEqual(40);
  });

  it('every entry has a non-empty datasheetUrl, mfr, and model', () => {
    for (const e of cat.entries) {
      expect(e.datasheetUrl.length).toBeGreaterThan(0);
      expect(e.datasheetUrl.startsWith('http')).toBe(true);
      expect(e.mfr.length).toBeGreaterThan(0);
      expect(e.model.length).toBeGreaterThan(0);
    }
  });

  it('represents Tyco + at least one other manufacturer', () => {
    const mfrs = new Set(cat.entries.map((e) => e.mfr));
    expect(mfrs.has('Tyco')).toBe(true);
    expect(mfrs.size).toBeGreaterThanOrEqual(2);
  });

  it('every kFactor (when present) is a plausible real discharge coefficient', () => {
    for (const e of cat.entries) {
      if (e.kFactor !== null) {
        expect(e.kFactor).toBeGreaterThan(1);
        expect(e.kFactor).toBeLessThan(40);
      }
    }
  });

  it('groups cleanly by manufacturer with conserved counts', () => {
    const groups = groupByManufacturer(cat.entries);
    const total = groups.reduce((s, g) => s + g.count, 0);
    expect(total).toBe(cat.entries.length);
    expect(groups.length).toBeGreaterThanOrEqual(2);
  });
});
