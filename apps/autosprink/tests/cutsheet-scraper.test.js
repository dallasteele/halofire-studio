import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureCutsheetTables,
  seedTargetsInto,
  fetchOneInto,
  statusFrom,
  stripHtmlToText,
  setFetcher,
} from '../src/skills/cutsheet-scraper/index.js';
import { COMPONENTS } from '../src/components/registry.js';

// AS-2 — cut-sheet scraper unit tests. The fetcher is INJECTED (setFetcher
// seam) so no test ever touches the network; every fixture page is clearly
// synthetic. Honesty assertions: stored text comes only from the fetched body
// and is ALWAYS flagged needs-verification; failures are recorded as status,
// never papered over with invented text.

const NOW = '2026-06-12T12:00:00.000Z';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  ensureCutsheetTables(db);
  return db;
}

function okResponse(html) {
  return { ok: true, status: 200, text: async () => html };
}

let db;

beforeEach(() => {
  db = makeDb();
});

afterEach(() => {
  setFetcher(null); // restore global fetch
  db.close();
});

describe('stripHtmlToText', () => {
  it('drops tags/scripts/styles, decodes entities, collapses whitespace', () => {
    const html = `
      <html><head><title>ignored</title><style>.x{color:red}</style></head>
      <body>
        <script>var hidden = 'never shown';</script>
        <h1>Synthetic   Pendent Head</h1>
        <!-- comment -->
        <p>K-factor&nbsp;5.6 &amp; thread &lt;1/2 NPT&gt;</p>
      </body></html>`;
    expect(stripHtmlToText(html)).toBe('Synthetic Pendent Head K-factor 5.6 & thread <1/2 NPT>');
  });

  it('returns empty string for non-strings and empty markup', () => {
    expect(stripHtmlToText(null)).toBe('');
    expect(stripHtmlToText('<div>   </div>')).toBe('');
  });
});

describe('seedTargets', () => {
  it('seeds one pending row per catalog part and is idempotent', () => {
    const first = seedTargetsInto(db);
    expect(first.inserted).toBe(COMPONENTS.length);
    expect(first.total).toBe(COMPONENTS.length);

    const second = seedTargetsInto(db);
    expect(second.inserted).toBe(0);
    expect(second.existing).toBe(COMPONENTS.length);
    expect(second.total).toBe(COMPONENTS.length);

    const rows = db.prepare('SELECT * FROM cutsheet_targets ORDER BY id').all();
    expect(rows).toHaveLength(COMPONENTS.length);
    expect(rows.every((r) => r.status === 'pending' && r.url === null)).toBe(true);
    const sample = rows.find((r) => r.sku === 'head_pendent');
    expect(sample.category).toBe('heads');
    expect(sample.search_hint).toContain('Pendent sprinkler head');
  });

  it('re-seeding never clobbers a curated url or status', () => {
    seedTargetsInto(db);
    db.prepare("UPDATE cutsheet_targets SET url = 'https://example.test/sheet', status = 'fetched' WHERE sku = 'head_pendent'")
      .run();
    seedTargetsInto(db);
    const row = db.prepare("SELECT * FROM cutsheet_targets WHERE sku = 'head_pendent'").get();
    expect(row.url).toBe('https://example.test/sheet');
    expect(row.status).toBe('fetched');
  });
});

describe('fetchOne', () => {
  beforeEach(() => {
    seedTargetsInto(db);
  });

  it('stores stripped page text flagged needs-verification when a url is set', async () => {
    const url = 'https://example.test/synthetic-cutsheet.html';
    db.prepare('UPDATE cutsheet_targets SET url = ? WHERE sku = ?').run(url, 'head_pendent');

    const seen = [];
    setFetcher(async (u) => {
      seen.push(u);
      return okResponse('<html><body><h1>Synthetic Cut Sheet</h1><p>K 5.6,  1/2&nbsp;NPT</p></body></html>');
    });

    const result = await fetchOneInto(db, 'head_pendent', { nowIso: NOW });
    expect(seen).toEqual([url]);
    expect(result.fetched).toBe(true);
    expect(result.verificationStatus).toBe('needs-verification');

    const doc = db.prepare("SELECT * FROM cutsheet_documents WHERE sku = 'head_pendent'").get();
    expect(doc.url).toBe(url);
    expect(doc.text).toBe('Synthetic Cut Sheet K 5.6, 1/2 NPT');
    expect(doc.fetched_at).toBe(NOW);
    expect(doc.verification_status).toBe('needs-verification');

    const target = db.prepare("SELECT * FROM cutsheet_targets WHERE sku = 'head_pendent'").get();
    expect(target.status).toBe('fetched');
  });

  it('records a thrown fetch error on the target row and stores NO document', async () => {
    db.prepare("UPDATE cutsheet_targets SET url = 'https://unreachable.test/x' WHERE sku = 'pipe_sch40'").run();
    setFetcher(async () => { throw new Error('ECONNREFUSED synthetic'); });

    const result = await fetchOneInto(db, 'pipe_sch40', { nowIso: NOW });
    expect(result.fetched).toBe(false);
    expect(result.status).toBe('error');
    expect(result.reason).toContain('ECONNREFUSED synthetic');

    const target = db.prepare("SELECT * FROM cutsheet_targets WHERE sku = 'pipe_sch40'").get();
    expect(target.status).toBe('error');
    expect(target.status_reason).toContain('ECONNREFUSED synthetic');
    expect(db.prepare('SELECT COUNT(*) AS n FROM cutsheet_documents').get().n).toBe(0);
  });

  it('records a non-2xx response as an error status, never invented text', async () => {
    db.prepare("UPDATE cutsheet_targets SET url = 'https://example.test/404' WHERE sku = 'fitting_tee'").run();
    setFetcher(async () => ({ ok: false, status: 404, text: async () => 'Not Found' }));

    const result = await fetchOneInto(db, 'fitting_tee', { nowIso: NOW });
    expect(result.status).toBe('error');
    expect(result.reason).toBe('fetch failed: HTTP 404');
    expect(db.prepare('SELECT COUNT(*) AS n FROM cutsheet_documents').get().n).toBe(0);
  });

  it('a target without a url stays pending with the reason recorded', async () => {
    let called = false;
    setFetcher(async () => { called = true; return okResponse('<p>x</p>'); });

    const result = await fetchOneInto(db, 'gauge', { nowIso: NOW });
    expect(called).toBe(false);
    expect(result.fetched).toBe(false);
    expect(result.status).toBe('pending');
    expect(result.reason).toBe('no cut-sheet url set');

    const target = db.prepare("SELECT * FROM cutsheet_targets WHERE sku = 'gauge'").get();
    expect(target.status).toBe('pending');
    expect(target.status_reason).toBe('no cut-sheet url set');
    expect(db.prepare('SELECT COUNT(*) AS n FROM cutsheet_documents').get().n).toBe(0);
  });

  it('an empty fetched page is an error, not an empty document', async () => {
    db.prepare("UPDATE cutsheet_targets SET url = 'https://example.test/blank' WHERE sku = 'fdc'").run();
    setFetcher(async () => okResponse('<html><body><script>only_code();</script></body></html>'));

    const result = await fetchOneInto(db, 'fdc', { nowIso: NOW });
    expect(result.status).toBe('error');
    expect(result.reason).toBe('fetched page had no extractable text');
    expect(db.prepare('SELECT COUNT(*) AS n FROM cutsheet_documents').get().n).toBe(0);
  });

  it('an unknown sku is reported honestly, nothing written', async () => {
    const result = await fetchOneInto(db, 'not_a_part', { nowIso: NOW });
    expect(result.fetched).toBe(false);
    expect(result.reason).toContain('unknown sku');
  });
});

describe('status', () => {
  it('reports target counts by status and needs-verification document counts', async () => {
    seedTargetsInto(db);
    db.prepare("UPDATE cutsheet_targets SET url = 'https://example.test/ok' WHERE sku = 'head_pendent'").run();
    db.prepare("UPDATE cutsheet_targets SET url = 'https://example.test/bad' WHERE sku = 'pipe_sch40'").run();
    setFetcher(async (u) => (u.endsWith('/ok')
      ? okResponse('<p>Synthetic sheet text</p>')
      : { ok: false, status: 500, text: async () => '' }));

    await fetchOneInto(db, 'head_pendent', { nowIso: NOW });
    await fetchOneInto(db, 'pipe_sch40', { nowIso: NOW });

    const s = statusFrom(db);
    expect(s.targets).toBe(COMPONENTS.length);
    expect(s.catalogParts).toBe(COMPONENTS.length);
    expect(s.byStatus.fetched).toBe(1);
    expect(s.byStatus.error).toBe(1);
    expect(s.byStatus.pending).toBe(COMPONENTS.length - 2);
    expect(s.documents).toBe(1);
    expect(s.needsVerification).toBe(1);
  });
});
