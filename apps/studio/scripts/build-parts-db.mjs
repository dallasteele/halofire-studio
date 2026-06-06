// HaloFire Studio — PARTS DATABASE BUILD (SQLite, source-of-truth).
//
// Ingests EVERY shipped parts manifest + the connector registry into a single
// SQLite database at public/parts/parts.db. The studio reads this DB client-side
// via sql.js (WASM) — no second server. The build itself ALSO uses sql.js so it
// compiles cleanly on Windows with NO native toolchain.
//
// Ingested sources (all REAL, shipped manifests):
//   - public/catalog/manufacturer-catalog.json   (T51 spec records — Tyco/Reliable/…)
//   - public/parts/build123d-parts.json          (T45 dimensioned-parametric STEP)
//   - public/parts/manufacturer-step.json        (T44/T54 manufacturer_verified STEP)
//   - public/parts/parts-manifest.json           (generated parametric massing)
//   - public/connectors/manufacturer-connectors.json (per-manufacturer connectors)
//
// HONESTY (hard, fail-closed):
//   - The DB is the parts source-of-truth but changes NO provenance gate. A part's
//     provenanceTier / engineeringAccurate are DERIVED from the same deriveModelStatus
//     mapping the studio uses — manufacturer_verified still requires a real stepUrl
//     AND a real sha256 (mirrored from the manifest; we never invent either).
//   - sha256 / stepUrl / datasheetUrl are copied verbatim from the manifests; null
//     stays null. NOTHING is fabricated to fill a gap.
//   - The DB holds metadata + URLs + hashes ONLY — never the licensed .stp bytes
//     (those stay gitignored). So parts.db is safe to commit.
//   - apiKeyRef in the connectors table is the env-var NAME from the registry, never
//     a secret. (The registry loader already sanitizes it.)
//
// Deterministic + idempotent: the same inputs always produce the same row set
// (rows are keyed by a stable id and inserted in sorted order). Re-running rebuilds
// the file from scratch. Prints row counts.
//
// Run from apps/studio:  node scripts/build-parts-db.mjs

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const STUDIO_ROOT = resolvePath(__dirname, '..');
const PUBLIC = join(STUDIO_ROOT, 'public');
const PUBLIC_PARTS = join(PUBLIC, 'parts');
const PUBLIC_CATALOG = join(PUBLIC, 'catalog');
const PUBLIC_CONNECTORS = join(PUBLIC, 'connectors');

const CATALOG_JSON = join(PUBLIC_CATALOG, 'manufacturer-catalog.json');
const BUILD123D_JSON = join(PUBLIC_PARTS, 'build123d-parts.json');
const MFR_STEP_JSON = join(PUBLIC_PARTS, 'manufacturer-step.json');
const PARTS_MANIFEST_JSON = join(PUBLIC_PARTS, 'parts-manifest.json');
const CONNECTORS_JSON = join(PUBLIC_CONNECTORS, 'manufacturer-connectors.json');

const DB_OUT = join(PUBLIC_PARTS, 'parts.db');
// The studio client loads the sql.js WASM from /parts/sql-wasm.wasm. Copy it from
// node_modules so the build + preview need no extra config.
const WASM_OUT = join(PUBLIC_PARTS, 'sql-wasm.wasm');

/* ------------------------------------------------------------ helpers */

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function str(v) {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Derive the accuracy tier from source + manufacturerExact — IDENTICAL mapping to
 * src/lib/provenance.ts deriveModelStatus. Fail-safe to visual_reference.
 */
function deriveModelStatus(source, manufacturerExact) {
  switch (source) {
    case 'generated':
    case 'ai-placeholder':
      return 'visual_reference';
    case 'step.parts':
      return 'proxy';
    case 'build123d':
      return 'dimensioned_parametric';
    case 'manufacturer-step':
      return manufacturerExact === true ? 'manufacturer_verified' : 'visual_reference';
    default:
      return 'visual_reference';
  }
}

/** engineeringAccurate is true ONLY for manufacturer_verified | sealed_approved. */
function engineeringAccurateFor(tier) {
  return tier === 'manufacturer_verified' || tier === 'sealed_approved';
}

/* ------------------------------------------------------------ row builders */

/**
 * Build the parts rows from every manifest. Each row carries a stable `id` and a
 * `source` tag so the studio can group/filter. Returns a sorted array of row
 * objects (deterministic insert order).
 */
function buildPartRows() {
  const rows = [];

  // --- T51 catalog spec records (manufacturer-catalog.json) ---
  const catalog = readJson(CATALOG_JSON);
  const catEntries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  for (const e of catEntries) {
    const mfr = str(e.mfr);
    const model = str(e.model);
    const datasheetUrl = str(e.datasheetUrl);
    // Mirror the loader's hard requirement: a real mfr + model + datasheetUrl.
    if (!mfr || !model || !datasheetUrl) continue;
    const id = str(e.id) ?? `catalog-${mfr}-${str(e.sin) ?? model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const port = e.port && typeof e.port === 'object' ? e.port : null;
    rows.push({
      id,
      source: 'catalog',
      manufacturer: mfr,
      productCode: model,
      sin: str(e.sin),
      category: str(e.category) ?? 'head',
      provenanceTier: 'catalog_spec',
      engineeringAccurate: 0,
      kFactor: num(e.kFactor),
      portMethod: port ? str(port.method) : null,
      portSizeIn: port ? num(port.nominalSizeIn) : null,
      tempRatingsF: Array.isArray(e.tempRatingsF) ? JSON.stringify(e.tempRatingsF) : null,
      responseType: str(e.responseType),
      datasheetUrl,
      stepUrl: null,
      sha256: null,
      license: null,
      sourceUrl: str(e.sourceUrl) ?? datasheetUrl,
    });
  }

  // --- T45 build123d dimensioned-parametric STEP (build123d-parts.json) ---
  const b123 = readJson(BUILD123D_JSON);
  const b123Entries = Array.isArray(b123?.entries) ? b123.entries : [];
  for (const e of b123Entries) {
    const key = str(e.key);
    const stepUrl = str(e.stepUrl);
    const sha256 = str(e.sha256);
    if (!key) continue;
    const verified = !!(stepUrl && sha256);
    const tier = verified ? deriveModelStatus('build123d', false) : 'visual_reference';
    const dims = e.dimensions && typeof e.dimensions === 'object' ? e.dimensions : null;
    rows.push({
      id: `build123d-${key}`,
      source: 'build123d',
      manufacturer: 'HaloFire (parametric)',
      productCode: str(e.productCode) ?? key,
      sin: null,
      category: str(e.category) ?? key.split('_')[0] ?? null,
      provenanceTier: tier,
      engineeringAccurate: engineeringAccurateFor(tier) ? 1 : 0,
      kFactor: null,
      portMethod: dims ? str(dims.nptSize) : null,
      portSizeIn: num(e.nominalSizeIn),
      tempRatingsF: null,
      responseType: null,
      datasheetUrl: null,
      stepUrl: verified ? stepUrl : null,
      sha256: verified ? sha256 : null,
      license: null,
      sourceUrl: null,
    });
  }

  // --- T44/T54 manufacturer_verified STEP (manufacturer-step.json) ---
  const mstep = readJson(MFR_STEP_JSON);
  const mEntries = Array.isArray(mstep?.entries) ? mstep.entries : [];
  for (const e of mEntries) {
    const key = str(e.slug) ?? str(e.key);
    const stepUrl = str(e.stepUrl);
    const sha256 = str(e.sha256);
    if (!key) continue;
    // Honesty gate: manufacturer_verified ONLY with real stepUrl AND real sha256.
    const verified = !!(stepUrl && sha256) && e.manufacturerExact === true;
    const tier = verified
      ? deriveModelStatus('manufacturer-step', true)
      : 'visual_reference';
    rows.push({
      id: `mfr-step-${key}`,
      source: 'manufacturer-step',
      manufacturer: str(e.manufacturer) ?? 'Unknown',
      productCode: str(e.productCode) ?? key,
      sin: null,
      category: str(e.category),
      provenanceTier: tier,
      engineeringAccurate: engineeringAccurateFor(tier) ? 1 : 0,
      kFactor: num(e.dimensions?.kFactor),
      portMethod: null,
      portSizeIn: null,
      tempRatingsF: null,
      responseType: null,
      datasheetUrl: null,
      stepUrl: verified ? stepUrl : null,
      sha256: verified ? sha256 : null,
      license: str(e.license),
      sourceUrl: str(e.sourceUrl),
    });
  }

  // --- generated parametric massing (parts-manifest.json) ---
  const pm = readJson(PARTS_MANIFEST_JSON);
  const components = Array.isArray(pm?.components) ? pm.components : [];
  for (const c of components) {
    const key = str(c.key);
    if (!key) continue;
    const source = str(c.source) ?? 'generated';
    const tier = deriveModelStatus(source, c.manufacturerExact === true);
    rows.push({
      id: `generated-${key}`,
      source: 'generated',
      manufacturer: c.manufacturerExact === true ? null : 'HaloFire (generated)',
      productCode: str(c.name) ?? key,
      sin: null,
      category: str(c.category),
      provenanceTier: tier,
      engineeringAccurate: engineeringAccurateFor(tier) ? 1 : 0,
      kFactor: null,
      portMethod: null,
      portSizeIn: null,
      tempRatingsF: null,
      responseType: null,
      datasheetUrl: null,
      stepUrl: null,
      sha256: null,
      license: null,
      sourceUrl: null,
    });
  }

  // Deterministic order: sort by id.
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

/** Build the connectors rows mirroring ManufacturerConnector. */
function buildConnectorRows() {
  const reg = readJson(CONNECTORS_JSON);
  const connectors = Array.isArray(reg?.connectors) ? reg.connectors : [];
  const rows = [];
  for (const c of connectors) {
    const id = str(c.id);
    const name = str(c.name);
    if (!id || !name) continue;
    rows.push({
      id,
      name,
      status: str(c.status) ?? 'needs_config',
      sourceType: str(c.sourceType) ?? 'unknown',
      catalogUrl: str(c.catalogUrl),
      apiKeyRef: str(c.apiKeyRef),
      secondaryApiKeyRef: str(c.secondaryApiKeyRef),
      lastSynced: str(c.lastSynced),
      partCount: num(c.partCount) ?? 0,
      notes: typeof c.notes === 'string' ? c.notes : '',
      ingestLane: str(c.ingestLane) ?? 'catalog_spec',
    });
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

/* ------------------------------------------------------------ main */

async function main() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: (file) => join(require.resolve('sql.js'), '..', file),
  });
  const db = new SQL.Database();

  db.run('PRAGMA foreign_keys = OFF;');

  db.run(`
    CREATE TABLE parts (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      manufacturer TEXT,
      productCode TEXT,
      sin TEXT,
      category TEXT,
      provenanceTier TEXT NOT NULL,
      engineeringAccurate INTEGER NOT NULL,
      kFactor REAL,
      portMethod TEXT,
      portSizeIn REAL,
      tempRatingsF TEXT,
      responseType TEXT,
      datasheetUrl TEXT,
      stepUrl TEXT,
      sha256 TEXT,
      license TEXT,
      sourceUrl TEXT
    );
  `);

  db.run(`
    CREATE TABLE connectors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      sourceType TEXT NOT NULL,
      catalogUrl TEXT,
      apiKeyRef TEXT,
      secondaryApiKeyRef TEXT,
      lastSynced TEXT,
      partCount INTEGER NOT NULL,
      notes TEXT,
      ingestLane TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE meta (
      k TEXT PRIMARY KEY,
      v TEXT
    );
  `);

  db.run('CREATE INDEX idx_parts_manufacturer ON parts(manufacturer);');
  db.run('CREATE INDEX idx_parts_category ON parts(category);');
  db.run('CREATE INDEX idx_parts_source ON parts(source);');

  const partRows = buildPartRows();
  const partStmt = db.prepare(`
    INSERT INTO parts
      (id, source, manufacturer, productCode, sin, category, provenanceTier,
       engineeringAccurate, kFactor, portMethod, portSizeIn, tempRatingsF,
       responseType, datasheetUrl, stepUrl, sha256, license, sourceUrl)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);
  `);
  db.run('BEGIN TRANSACTION;');
  for (const r of partRows) {
    partStmt.run([
      r.id, r.source, r.manufacturer, r.productCode, r.sin, r.category,
      r.provenanceTier, r.engineeringAccurate, r.kFactor, r.portMethod,
      r.portSizeIn, r.tempRatingsF, r.responseType, r.datasheetUrl, r.stepUrl,
      r.sha256, r.license, r.sourceUrl,
    ]);
  }
  db.run('COMMIT;');
  partStmt.free();

  const connectorRows = buildConnectorRows();
  const connStmt = db.prepare(`
    INSERT INTO connectors
      (id, name, status, sourceType, catalogUrl, apiKeyRef, secondaryApiKeyRef,
       lastSynced, partCount, notes, ingestLane)
    VALUES (?,?,?,?,?,?,?,?,?,?,?);
  `);
  db.run('BEGIN TRANSACTION;');
  for (const c of connectorRows) {
    connStmt.run([
      c.id, c.name, c.status, c.sourceType, c.catalogUrl, c.apiKeyRef,
      c.secondaryApiKeyRef, c.lastSynced, c.partCount, c.notes, c.ingestLane,
    ]);
  }
  db.run('COMMIT;');
  connStmt.free();

  // meta: deterministic build provenance (NOT a wall-clock so the build is
  // reproducible). schemaVersion + counts let the loader sanity-check.
  const metaRows = [
    ['schemaVersion', '1'],
    ['partCount', String(partRows.length)],
    ['connectorCount', String(connectorRows.length)],
    [
      'note',
      'HaloFire parts source-of-truth. Metadata + URLs + hashes only — no licensed .stp bytes. Provenance gates unchanged: manufacturer_verified requires real stepUrl + sha256. NOT AHJ / PE / code-certified.',
    ],
  ];
  const metaStmt = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?);');
  for (const [k, v] of metaRows) metaStmt.run([k, v]);
  metaStmt.free();

  // Export + write the DB file.
  const data = db.export();
  db.close();
  mkdirSync(PUBLIC_PARTS, { recursive: true });
  writeFileSync(DB_OUT, Buffer.from(data));

  // Stage the WASM for the client read path.
  const wasmSrc = join(require.resolve('sql.js'), '..', 'sql-wasm.wasm');
  if (existsSync(wasmSrc)) {
    copyFileSync(wasmSrc, WASM_OUT);
  }

  // Provenance-tier breakdown for the log.
  const tierCounts = {};
  for (const r of partRows) {
    tierCounts[r.provenanceTier] = (tierCounts[r.provenanceTier] ?? 0) + 1;
  }
  const enabledConnectors = connectorRows.filter((c) => c.status === 'enabled').length;

  console.log('[build-parts-db] wrote ' + DB_OUT);
  console.log('[build-parts-db] parts rows: ' + partRows.length);
  for (const [tier, n] of Object.entries(tierCounts).sort()) {
    console.log('[build-parts-db]   ' + tier + ': ' + n);
  }
  console.log('[build-parts-db] connector rows: ' + connectorRows.length + ' (' + enabledConnectors + ' enabled)');
  console.log('[build-parts-db] staged WASM: ' + (existsSync(WASM_OUT) ? WASM_OUT : 'MISSING'));
}

main().catch((e) => {
  console.error('[build-parts-db] FAILED:', e);
  process.exitCode = 1;
});
