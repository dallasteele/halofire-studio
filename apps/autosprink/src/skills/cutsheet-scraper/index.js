/**
 * AS-2 — Cut-sheet Scraper skill (feeds the parts pipeline).
 *
 * Maintains one cutsheet_targets row per canonical catalog part
 * (src/components/registry.js COMPONENTS) and, when a manufacturer cut-sheet
 * URL has been set on a row, fetches that page and stores the stripped page
 * text into cutsheet_documents — ALWAYS flagged 'needs-verification'.
 *
 * HONESTY (doctrine: BUILD-COMPLETE, FLAG-DON'T-GATE): no fabricated text,
 * ever. An unreachable/missing url, a non-2xx response, or an empty page body
 * never produces invented content — the failure (with its reason) is recorded
 * on the target row and the part simply stays pending/error for a later pass.
 *
 * Like the other cron skills this runs in the skill-cron process (separate
 * from the API server), so the ctx-level actions open their OWN better-sqlite3
 * connection at the same DB path the server uses. The db-taking helpers below
 * are the unit-testable core (in-memory DB + injected mock fetcher, no
 * network) — mirroring the autobid intake split.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { COMPONENTS } from '../../components/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.HALOFIRE_DB_PATH
  ? path.resolve(process.env.HALOFIRE_DB_PATH)
  : path.resolve(__dirname, '../../../data/halofire.db');

// ── Injectable fetcher seam (tests inject a mock; production uses fetch) ──

let fetchImpl = null;

/** Inject a fetcher for tests; pass null/undefined to restore global fetch. */
export function setFetcher(fn) {
  fetchImpl = fn || null;
}

function currentFetcher() {
  return fetchImpl || globalThis.fetch;
}

// ── Pure helpers ──

/**
 * Strip HTML to plain text: drop script/style/head blocks, drop tags, decode
 * the common entities, collapse whitespace. Pure + deterministic.
 */
export function stripHtmlToText(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<(script|style|head|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Human search hint used by later loops to hunt down the real cut-sheet URL. */
function searchHintFor(component) {
  return `${component.name} fire sprinkler ${component.category} manufacturer cut sheet`;
}

// ── Schema (mirrors initDatabase in src/api/server.js and src/db/seed.js) ──

export function ensureCutsheetTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cutsheet_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      category TEXT,
      search_hint TEXT,
      url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      status_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cutsheet_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL,
      url TEXT NOT NULL,
      text TEXT NOT NULL,
      fetched_at DATETIME NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'needs-verification',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ── DB-taking core (unit-testable; no network, no file DB) ──

/**
 * Seed one cutsheet_targets row per catalog part. Idempotent: existing rows
 * (including any curated url/status) are left untouched.
 */
export function seedTargetsInto(db) {
  ensureCutsheetTables(db);
  const insert = db.prepare(`
    INSERT INTO cutsheet_targets (sku, category, search_hint, url, status)
    VALUES (?, ?, ?, NULL, 'pending')
    ON CONFLICT(sku) DO NOTHING
  `);
  let inserted = 0;
  const tx = db.transaction(() => {
    for (const c of COMPONENTS) {
      inserted += insert.run(c.key, c.category, searchHintFor(c)).changes;
    }
  });
  tx();
  const total = db.prepare('SELECT COUNT(*) AS n FROM cutsheet_targets').get().n;
  return { inserted, existing: total - inserted, total, catalogParts: COMPONENTS.length };
}

function setTargetStatus(db, sku, status, reason) {
  db.prepare(`UPDATE cutsheet_targets
              SET status = ?, status_reason = ?, updated_at = CURRENT_TIMESTAMP
              WHERE sku = ?`)
    .run(status, reason || null, sku);
}

/**
 * Fetch ONE target's cut-sheet page and store the stripped text flagged
 * needs-verification. Honesty: every failure path records the reason on the
 * target row and writes NO document — text is never invented.
 */
export async function fetchOneInto(db, sku, { nowIso = new Date().toISOString() } = {}) {
  ensureCutsheetTables(db);
  const target = db.prepare('SELECT * FROM cutsheet_targets WHERE sku = ?').get(sku);
  if (!target) {
    return { sku, fetched: false, reason: 'unknown sku (run seedTargets first)' };
  }
  if (!target.url) {
    // No url yet — stays pending with the reason, never fabricated around.
    setTargetStatus(db, sku, 'pending', 'no cut-sheet url set');
    return { sku, fetched: false, status: 'pending', reason: 'no cut-sheet url set' };
  }

  let body;
  try {
    const res = await currentFetcher()(target.url);
    if (!res.ok) {
      const reason = `fetch failed: HTTP ${res.status}`;
      setTargetStatus(db, sku, 'error', reason);
      return { sku, fetched: false, status: 'error', reason };
    }
    body = await res.text();
  } catch (err) {
    const reason = `fetch failed: ${String(err.message || err).slice(0, 300)}`;
    setTargetStatus(db, sku, 'error', reason);
    return { sku, fetched: false, status: 'error', reason };
  }

  const text = stripHtmlToText(body);
  if (!text) {
    const reason = 'fetched page had no extractable text';
    setTargetStatus(db, sku, 'error', reason);
    return { sku, fetched: false, status: 'error', reason };
  }

  const docId = db.prepare(`
    INSERT INTO cutsheet_documents (sku, url, text, fetched_at, verification_status)
    VALUES (?, ?, ?, ?, 'needs-verification')
  `).run(sku, target.url, text, nowIso).lastInsertRowid;
  setTargetStatus(db, sku, 'fetched', null);

  return {
    sku,
    fetched: true,
    status: 'fetched',
    documentId: Number(docId),
    textLength: text.length,
    verificationStatus: 'needs-verification',
  };
}

/** Pipeline status: target counts by status + stored-document counts. */
export function statusFrom(db) {
  ensureCutsheetTables(db);
  const byStatus = {};
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM cutsheet_targets GROUP BY status').all()) {
    byStatus[row.status] = row.n;
  }
  const targets = db.prepare('SELECT COUNT(*) AS n FROM cutsheet_targets').get().n;
  const documents = db.prepare('SELECT COUNT(*) AS n FROM cutsheet_documents').get().n;
  const needsVerification = db.prepare(
    "SELECT COUNT(*) AS n FROM cutsheet_documents WHERE verification_status = 'needs-verification'",
  ).get().n;
  return { targets, byStatus, documents, needsVerification, catalogParts: COMPONENTS.length };
}

// ── ctx-level skill actions (skill-runner / skill-cron entry points) ──

function openDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export async function seedTargets(ctx) {
  const db = openDb();
  try {
    const result = seedTargetsInto(db);
    ctx.log.info(`cutsheet: seeded ${result.inserted} new targets (${result.total} total)`);
    ctx.saveState({ lastSeed: { ...result, at: new Date().toISOString() } });
    return result;
  } finally {
    db.close();
  }
}

export async function fetchOne(ctx) {
  const { sku } = ctx.params || {};
  if (!sku) throw new Error('sku is required for fetchOne');
  const db = openDb();
  try {
    const result = await fetchOneInto(db, sku);
    ctx.log.info(`cutsheet: fetchOne ${sku} -> ${result.status || 'unknown'}${result.reason ? ` (${result.reason})` : ''}`);
    return result;
  } finally {
    db.close();
  }
}

export async function status(ctx) {
  const db = openDb();
  try {
    const result = statusFrom(db);
    ctx.log.info(`cutsheet: ${result.documents} documents stored for ${result.targets} targets`);
    return result;
  } finally {
    db.close();
  }
}

export default { seedTargets, fetchOne, status };
