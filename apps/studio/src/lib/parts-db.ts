// PARTS DATABASE read layer — loads the SQLite source-of-truth via sql.js (WASM)
// and exposes typed queries. NO React / three imports.
//
// The DB (public/parts/parts.db) is built by scripts/build-parts-db.mjs from every
// shipped manifest + the connector registry. This module is the studio's READ path:
// it loads the .db client-side via sql.js (no second server) and answers typed
// queries. It FAIL-SOFTS to the existing JSON loaders when the DB is unavailable,
// so nothing breaks if the .db is missing / blocked / sql.js fails to init.
//
// HONESTY (hard, fail-closed):
//   - The DB is the parts source-of-truth but changes NO provenance gate. Rows
//     carry the SAME provenanceTier the manifests earned (manufacturer_verified
//     still required a real stepUrl + sha256 at build time). This module never
//     upgrades a tier and never fabricates a row.
//   - On ANY failure (no fetch, non-2xx, sql.js init error, bad bytes) the loader
//     returns { ok:false } and callers fall back to the JSON loaders. The studio
//     never claims DB parts it could not load.

import type { SqlJsStatic, Database } from 'sql.js';
import {
  loadManufacturerCatalog,
  type ManufacturerCatalog,
} from './manufacturer-catalog';
import { loadConnectorRegistry } from './manufacturer-connectors';
import type {
  ConnectorRegistry,
  ManufacturerConnector,
} from './manufacturer-connectors';

/** One part row as stored in the DB (typed projection of the `parts` table). */
export interface DbPart {
  id: string;
  source: string;
  manufacturer: string | null;
  productCode: string | null;
  sin: string | null;
  category: string | null;
  provenanceTier: string;
  engineeringAccurate: boolean;
  kFactor: number | null;
  portMethod: string | null;
  portSizeIn: number | null;
  tempRatingsF: number[] | null;
  responseType: string | null;
  datasheetUrl: string | null;
  stepUrl: string | null;
  sha256: string | null;
  license: string | null;
  sourceUrl: string | null;
}

/** A loaded, queryable parts DB handle. */
export interface PartsDb {
  ok: true;
  /** All part rows (deterministic id order). */
  allParts(): DbPart[];
  /** Part rows for one manufacturer (case-insensitive exact match). */
  byManufacturer(manufacturer: string): DbPart[];
  /** Part rows for one category (case-insensitive exact match). */
  byCategory(category: string): DbPart[];
  /** Total part count. */
  partCount(): number;
  /** Connector rows from the DB (mirrors ManufacturerConnector). */
  connectors(): ManufacturerConnector[];
  /** Close + free the underlying sql.js database. */
  close(): void;
}

export interface PartsDbUnavailable {
  ok: false;
  reason: string;
}

export type PartsDbResult = PartsDb | PartsDbUnavailable;

/**
 * sql.js initializer signature. Injected so tests can supply a real or mock
 * initSqlJs without this module importing the WASM glue directly (keeps it pure
 * + node-test friendly). In the app, App.tsx passes the real initSqlJs.
 */
export type InitSqlJs = (config?: {
  locateFile?: (file: string) => string;
}) => Promise<SqlJsStatic>;

function asNumberArray(json: string | null): number[] | null {
  if (typeof json !== 'string' || json.length === 0) return null;
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return null;
    const nums = v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    return nums.length > 0 ? nums : null;
  } catch {
    return null;
  }
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Map a sql.js row object (column->value) to a typed DbPart. */
function rowToPart(r: Record<string, unknown>): DbPart {
  return {
    id: String(r.id ?? ''),
    source: String(r.source ?? ''),
    manufacturer: asStr(r.manufacturer),
    productCode: asStr(r.productCode),
    sin: asStr(r.sin),
    category: asStr(r.category),
    provenanceTier: String(r.provenanceTier ?? 'visual_reference'),
    engineeringAccurate: Number(r.engineeringAccurate) === 1,
    kFactor: asNum(r.kFactor),
    portMethod: asStr(r.portMethod),
    portSizeIn: asNum(r.portSizeIn),
    tempRatingsF: asNumberArray(asStr(r.tempRatingsF)),
    responseType: asStr(r.responseType),
    datasheetUrl: asStr(r.datasheetUrl),
    stepUrl: asStr(r.stepUrl),
    sha256: asStr(r.sha256),
    license: asStr(r.license),
    sourceUrl: asStr(r.sourceUrl),
  };
}

/** Run a SELECT and return rows as plain objects. */
function selectRows(db: Database, sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params as never[]);
    const out: Record<string, unknown>[] = [];
    while (stmt.step()) {
      out.push(stmt.getAsObject());
    }
    return out;
  } finally {
    stmt.free();
  }
}

function rowToConnector(r: Record<string, unknown>): ManufacturerConnector {
  const status = String(r.status ?? 'needs_config');
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    status: (['enabled', 'needs_config', 'manual', 'disabled'].includes(status)
      ? status
      : 'needs_config') as ManufacturerConnector['status'],
    sourceType: String(r.sourceType ?? 'unknown') as ManufacturerConnector['sourceType'],
    catalogUrl: asStr(r.catalogUrl),
    apiKeyRef: asStr(r.apiKeyRef),
    secondaryApiKeyRef: asStr(r.secondaryApiKeyRef),
    lastSynced: asStr(r.lastSynced),
    partCount: asNum(r.partCount) ?? 0,
    notes: typeof r.notes === 'string' ? r.notes : '',
    ingestLane: String(r.ingestLane ?? 'catalog_spec') as ManufacturerConnector['ingestLane'],
  };
}

/**
 * Load the parts DB via sql.js. Fail-soft: returns { ok:false, reason } on any
 * error (no fetch, non-2xx, sql.js init failure, bad bytes). NEVER throws.
 *
 * @param initSqlJs  sql.js initializer (injected; the app passes the real one).
 * @param fetchImpl  fetch used to load /parts/parts.db and locate the WASM.
 * @param dbUrl      DB url (default /parts/parts.db).
 * @param wasmUrl    WASM url passed to locateFile (default /parts/sql-wasm.wasm).
 */
export async function loadPartsDb(
  initSqlJs: InitSqlJs | undefined,
  fetchImpl?: typeof fetch,
  dbUrl = '/parts/parts.db',
  wasmUrl = '/parts/sql-wasm.wasm',
): Promise<PartsDbResult> {
  if (typeof initSqlJs !== 'function') {
    return { ok: false, reason: 'sql.js initializer not provided' };
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'fetch not available' };
  }
  let bytes: Uint8Array;
  try {
    const res = await fetchImpl(dbUrl);
    if (!res || !res.ok) {
      return { ok: false, reason: `db fetch failed (${res ? res.status : 'no response'})` };
    }
    const buf = await res.arrayBuffer();
    bytes = new Uint8Array(buf);
    if (bytes.byteLength === 0) {
      return { ok: false, reason: 'db file is empty' };
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'db fetch error' };
  }

  let db: Database;
  try {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    db = new SQL.Database(bytes);
    // Sanity probe — a real HaloFire DB has a parts table.
    selectRows(db, 'SELECT COUNT(*) AS n FROM parts');
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'sql.js init error' };
  }

  const handle: PartsDb = {
    ok: true,
    allParts() {
      return selectRows(db, 'SELECT * FROM parts ORDER BY id').map(rowToPart);
    },
    byManufacturer(manufacturer: string) {
      return selectRows(
        db,
        'SELECT * FROM parts WHERE manufacturer = ? COLLATE NOCASE ORDER BY id',
        [manufacturer],
      ).map(rowToPart);
    },
    byCategory(category: string) {
      return selectRows(
        db,
        'SELECT * FROM parts WHERE category = ? COLLATE NOCASE ORDER BY id',
        [category],
      ).map(rowToPart);
    },
    partCount() {
      const rows = selectRows(db, 'SELECT COUNT(*) AS n FROM parts');
      return rows.length > 0 ? Number(rows[0].n) : 0;
    },
    connectors() {
      return selectRows(db, 'SELECT * FROM connectors ORDER BY id').map(rowToConnector);
    },
    close() {
      db.close();
    },
  };
  return handle;
}

/**
 * Resolve the parts count from the DB, FAIL-SOFT to the JSON catalog loader when
 * the DB is unavailable. This is the wiring point the studio uses to show a count
 * sourced from the DB while never breaking if the DB is missing.
 *
 * Returns { count, source } so the caller can show whether the DB or the JSON
 * fallback answered — honest by construction.
 */
export async function resolvePartCount(
  db: PartsDbResult,
  fetchImpl?: typeof fetch,
): Promise<{ count: number; source: 'db' | 'json-fallback' }> {
  if (db.ok) {
    return { count: db.partCount(), source: 'db' };
  }
  // Fail-soft: the existing JSON catalog loader (spec records). This deliberately
  // mirrors only the catalog count — the honest fallback the studio already had.
  const cat: ManufacturerCatalog = await loadManufacturerCatalog(fetchImpl);
  return { count: cat.entries.length, source: 'json-fallback' };
}

/**
 * Resolve the connector list from the DB, FAIL-SOFT to the committed registry JSON
 * when the DB is unavailable. The committed registry is always the defaults.
 */
export async function resolveConnectors(
  db: PartsDbResult,
  fetchImpl?: typeof fetch,
): Promise<{ connectors: ManufacturerConnector[]; source: 'db' | 'json-fallback' }> {
  if (db.ok) {
    const fromDb = db.connectors();
    if (fromDb.length > 0) return { connectors: fromDb, source: 'db' };
  }
  const reg: ConnectorRegistry = await loadConnectorRegistry(fetchImpl);
  return { connectors: reg.connectors, source: 'json-fallback' };
}
