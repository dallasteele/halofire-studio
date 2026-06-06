import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import {
  loadPartsDb,
  resolveConnectors,
  resolvePartCount,
  type InitSqlJs,
} from '../src/lib/parts-db';

const require = createRequire(import.meta.url);
const STUDIO = resolve(__dirname, '..');
const DB_PATH = join(STUDIO, 'public/parts/parts.db');
const CATALOG_PATH = join(STUDIO, 'public/catalog/manufacturer-catalog.json');
const B123_PATH = join(STUDIO, 'public/parts/build123d-parts.json');
const MSTEP_PATH = join(STUDIO, 'public/parts/manufacturer-step.json');
const PARTS_MANIFEST_PATH = join(STUDIO, 'public/parts/parts-manifest.json');

/**
 * The real sql.js initializer, located against node_modules. We IGNORE the
 * app-supplied locateFile (which points at a browser URL) and resolve the WASM
 * from node_modules so the node test runner can load it.
 */
const realInitSqlJs: InitSqlJs = (() =>
  (require('sql.js') as (c?: unknown) => Promise<unknown>)({
    locateFile: (file: string) => join(require.resolve('sql.js'), '..', file),
  })) as unknown as InitSqlJs;

/** A fetch that serves the on-disk parts.db as an arrayBuffer. */
function diskFetch(path: string): typeof fetch {
  return (async () => {
    if (!existsSync(path)) return { ok: false, status: 404 };
    const buf = readFileSync(path);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  }) as unknown as typeof fetch;
}

function jsonFetch(map: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const key = Object.keys(map).find((k) => url.endsWith(k));
    if (!key) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => map[key] };
  }) as unknown as typeof fetch;
}

function readJson(path: string): { entries?: unknown[]; components?: unknown[] } {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('parts.db build artifact', () => {
  it('exists (run `node scripts/build-parts-db.mjs` first)', () => {
    expect(existsSync(DB_PATH), 'parts.db missing — build it').toBe(true);
  });
});

describe('loadPartsDb — opens + queries via sql.js', () => {
  it('opens the DB and reports the total part count', async () => {
    const db = await loadPartsDb(realInitSqlJs, diskFetch(DB_PATH), '/parts/parts.db');
    expect(db.ok).toBe(true);
    if (!db.ok) return;
    expect(db.partCount()).toBeGreaterThan(0);
    db.close();
  });

  it('row counts MATCH the manifest sizes (ingest is complete + honest)', async () => {
    const db = await loadPartsDb(realInitSqlJs, diskFetch(DB_PATH), '/parts/parts.db');
    expect(db.ok).toBe(true);
    if (!db.ok) return;

    const all = db.allParts();
    const bySource = (s: string) => all.filter((p) => p.source === s).length;

    // T51 catalog: every entry with mfr+model+datasheetUrl (the loader's gate).
    const catEntries = (readJson(CATALOG_PATH).entries ?? []) as Array<Record<string, unknown>>;
    const catValid = catEntries.filter(
      (e) =>
        typeof e.mfr === 'string' &&
        (e.mfr as string).trim() &&
        typeof e.model === 'string' &&
        (e.model as string).trim() &&
        typeof e.datasheetUrl === 'string' &&
        (e.datasheetUrl as string).trim(),
    ).length;
    expect(bySource('catalog')).toBe(catValid);

    // T45 build123d: every keyed entry.
    const b123 = (readJson(B123_PATH).entries ?? []) as Array<Record<string, unknown>>;
    expect(bySource('build123d')).toBe(
      b123.filter((e) => typeof e.key === 'string').length,
    );

    // T44/T54 manufacturer-step: every keyed entry.
    const mstep = (readJson(MSTEP_PATH).entries ?? []) as Array<Record<string, unknown>>;
    expect(bySource('manufacturer-step')).toBe(
      mstep.filter((e) => typeof e.key === 'string' || typeof e.slug === 'string')
        .length,
    );

    // generated parametric massing: every component.
    const pm = (readJson(PARTS_MANIFEST_PATH).components ?? []) as Array<
      Record<string, unknown>
    >;
    expect(bySource('generated')).toBe(
      pm.filter((c) => typeof c.key === 'string').length,
    );

    // Total = sum of the parts.
    expect(all.length).toBe(
      bySource('catalog') + bySource('build123d') + bySource('manufacturer-step') + bySource('generated'),
    );
    db.close();
  });

  it('byManufacturer and byCategory return matching subsets', async () => {
    const db = await loadPartsDb(realInitSqlJs, diskFetch(DB_PATH), '/parts/parts.db');
    expect(db.ok).toBe(true);
    if (!db.ok) return;

    const reliable = db.byManufacturer('Reliable');
    expect(reliable.length).toBeGreaterThan(0);
    expect(reliable.every((p) => p.manufacturer === 'Reliable')).toBe(true);

    const heads = db.byCategory('head_pendent');
    expect(heads.length).toBeGreaterThan(0);
    expect(heads.every((p) => p.category === 'head_pendent')).toBe(true);
    db.close();
  });

  it('does NOT change the provenance gate: manufacturer_verified rows have real stepUrl + sha256', async () => {
    const db = await loadPartsDb(realInitSqlJs, diskFetch(DB_PATH), '/parts/parts.db');
    expect(db.ok).toBe(true);
    if (!db.ok) return;
    const verified = db.allParts().filter((p) => p.provenanceTier === 'manufacturer_verified');
    expect(verified.length).toBeGreaterThan(0);
    for (const p of verified) {
      expect(p.stepUrl, p.id).toBeTruthy();
      expect(p.sha256, p.id).toBeTruthy();
      expect(p.engineeringAccurate, p.id).toBe(true);
    }
    db.close();
  });

  it('exposes the connectors table', async () => {
    const db = await loadPartsDb(realInitSqlJs, diskFetch(DB_PATH), '/parts/parts.db');
    expect(db.ok).toBe(true);
    if (!db.ok) return;
    const conns = db.connectors();
    expect(conns.length).toBe(16);
    expect(conns.filter((c) => c.status === 'enabled').length).toBe(4);
    // No connector row leaks a secret-looking apiKeyRef.
    for (const c of conns) {
      if (c.apiKeyRef) expect(c.apiKeyRef).not.toMatch(/^sk-/i);
    }
    db.close();
  });
});

describe('loadPartsDb — fail-soft', () => {
  it('returns {ok:false} with no sql.js initializer', async () => {
    const db = await loadPartsDb(undefined, diskFetch(DB_PATH));
    expect(db.ok).toBe(false);
  });

  it('returns {ok:false} when the DB file is missing (404)', async () => {
    const db = await loadPartsDb(realInitSqlJs, diskFetch('/no/such/parts.db'));
    expect(db.ok).toBe(false);
  });

  it('returns {ok:false} when fetch is unavailable', async () => {
    const db = await loadPartsDb(realInitSqlJs, undefined);
    expect(db.ok).toBe(false);
  });
});

describe('resolvePartCount / resolveConnectors — fail-soft to JSON', () => {
  it('uses the DB when available', async () => {
    const db = await loadPartsDb(realInitSqlJs, diskFetch(DB_PATH), '/parts/parts.db');
    const { count, source } = await resolvePartCount(db);
    expect(source).toBe('db');
    expect(count).toBeGreaterThan(0);
    if (db.ok) db.close();
  });

  it('falls back to the JSON catalog loader when the DB is unavailable', async () => {
    const catalogJson = readJson(CATALOG_PATH);
    const f = jsonFetch({ '/catalog/manufacturer-catalog.json': catalogJson });
    const { count, source } = await resolvePartCount({ ok: false, reason: 'x' }, f);
    expect(source).toBe('json-fallback');
    expect(count).toBe((catalogJson.entries ?? []).length);
  });

  it('falls back to the committed connector registry when the DB is unavailable', async () => {
    const reg = JSON.parse(
      readFileSync(join(STUDIO, 'public/connectors/manufacturer-connectors.json'), 'utf8'),
    );
    const f = jsonFetch({ '/connectors/manufacturer-connectors.json': reg });
    const { connectors, source } = await resolveConnectors({ ok: false, reason: 'x' }, f);
    expect(source).toBe('json-fallback');
    expect(connectors.length).toBe(16);
  });
});
