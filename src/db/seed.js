/**
 * HaloFire Database Seed Script
 * Populates the database with source-linked bid rows from the real bid log.
 */

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildHomeDepotSeedRows } from '../data/home-depot-bid-package.js';
import { readBidLogRows } from '../data/bid-log-importer.js';
import { readPricebooks } from '../data/pricebook-importer.js';
import { buildHomeDepotEvidenceRows, buildHomeDepotClaimGates } from '../data/evidence-gates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.HALOFIRE_DB_PATH
  ? path.resolve(process.env.HALOFIRE_DB_PATH)
  : path.resolve(__dirname, '../../data/halofire.db');
const DATA_DIR = path.dirname(DB_PATH);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    contractor TEXT,
    value REAL DEFAULT 0,
    status TEXT DEFAULT 'Pending',
    date TEXT,
    due_date TEXT,
    sqft INTEGER DEFAULT 0,
    system_type TEXT DEFAULT 'Wet',
    contact TEXT,
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    bid_id INTEGER REFERENCES bids(id),
    phase TEXT DEFAULT 'Design',
    progress INTEGER DEFAULT 0,
    budget REAL DEFAULT 0,
    spent REAL DEFAULT 0,
    manager TEXT,
    start_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'On Track',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pricebook (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item TEXT NOT NULL,
    supplier TEXT,
    price REAL DEFAULT 0,
    unit TEXT DEFAULT 'EA',
    category TEXT,
    sku TEXT,
    source_file TEXT,
    source_sheet TEXT,
    source_row INTEGER,
    confidence REAL DEFAULT 1,
    status TEXT DEFAULT 'vendor_pricebook',
    last_updated TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS compliance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id),
    project_name TEXT,
    type TEXT NOT NULL,
    due_date TEXT,
    status TEXT DEFAULT 'Upcoming',
    authority TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS project_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL,
    evidence_type TEXT NOT NULL,
    source_file TEXT,
    source_ref TEXT,
    status TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS claim_gates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL,
    code TEXT NOT NULL,
    severity TEXT NOT NULL,
    missing_artifact TEXT NOT NULL,
    acceptable_evidence TEXT NOT NULL,
    blocked_claims TEXT NOT NULL,
    next_action TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_name, code)
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('pricebook', 'source_file', 'TEXT');
ensureColumn('pricebook', 'source_sheet', 'TEXT');
ensureColumn('pricebook', 'source_row', 'INTEGER');
ensureColumn('pricebook', 'confidence', 'REAL DEFAULT 1');
ensureColumn('pricebook', 'status', "TEXT DEFAULT 'vendor_pricebook'");
db.exec('DROP INDEX IF EXISTS pricebook_supplier_sku_source_idx');
db.exec('DROP INDEX IF EXISTS pricebook_supplier_sku_source_row_idx');

// Claim-gate resolution provenance (who/what/when cleared a gate).
ensureColumn('claim_gates', 'resolved_by', 'TEXT');
ensureColumn('claim_gates', 'resolved_at', 'DATETIME');
ensureColumn('claim_gates', 'resolved_evidence_ref', 'TEXT');

const adminUser = process.env.HALOFIRE_ADMIN_USER || 'admin';
const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUser);
if (!existingAdmin) {
  const fallbackAllowed = process.env.HALOFIRE_ALLOW_DEV_DEFAULTS === '1';
  const bootstrapPassword = process.env.HALOFIRE_ADMIN_PASSWORD
    || process.env.HALOFIRE_BOOTSTRAP_PASSWORD
    || (fallbackAllowed ? 'halofire2026' : null);

  if (!bootstrapPassword) {
    throw new Error('HALOFIRE_ADMIN_PASSWORD is required for seed unless HALOFIRE_ALLOW_DEV_DEFAULTS=1');
  }

  const hash = bcrypt.hashSync(bootstrapPassword, 12);
  db.prepare('INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)').run(
    adminUser,
    hash,
    'Dallas Steele',
    'admin',
    'admin@halofireus.com',
  );
}

console.log('[seed] Starting database seed...');

const homeDepotRows = buildHomeDepotSeedRows(PROJECT_ROOT);
const homeDepotPackageNotes = JSON.parse(homeDepotRows.bid.notes);

function buildBidNotes(row) {
  const notes = {
    source: 'actual_bid_log',
    worksheetRow: row.worksheetRow,
    source_file: row.source_file,
    sheet: row.sheet,
    sourceRefs: row.sourceRefs,
  };

  if (row.status === 'needs_amount_review') {
    notes.issue = {
      code: 'BID_AMOUNT_MISSING',
      severity: 'warning',
      message: 'Bid log row has no amount and needs Halo Fire employee review.',
    };
  }

  if (row.project === homeDepotRows.bid.project) {
    notes.source = 'actual_bid_log_with_actual_bid_package';
    notes.package = homeDepotPackageNotes;
    notes.issue = {
      code: 'BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL',
      bidLogSqft: row.sqft,
      proposalSqft: homeDepotRows.bid.sqft,
      severity: 'warning',
      message: 'Bid log square footage differs from proposal workbook square footage; employee must choose the pricing basis.',
    };
  }

  return JSON.stringify(notes);
}

const bids = readBidLogRows(PROJECT_ROOT)
  .filter((row) => row.project)
  .map((row) => ({
    project: row.project,
    contractor: row.contractor,
    value: row.value || 0,
    status: row.status || 'Bidding',
    date: row.submitted_date,
    due_date: row.due_date,
    sqft: row.sqft || 0,
    system_type: row.project === homeDepotRows.bid.project ? homeDepotRows.bid.system_type : 'Unknown',
    contact: row.project === homeDepotRows.bid.project ? homeDepotRows.bid.contact : row.contractor,
    notes: buildBidNotes(row),
  }));

db.prepare('DELETE FROM bids').run();
db.prepare('DELETE FROM projects').run();
db.prepare('DELETE FROM compliance').run();

const insertBid = db.prepare('INSERT INTO bids (project, contractor, value, status, date, due_date, sqft, system_type, contact, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,1)');
db.transaction((rows) => {
  for (const bid of rows) {
    insertBid.run(bid.project, bid.contractor, bid.value, bid.status, bid.date, bid.due_date, bid.sqft, bid.system_type, bid.contact, bid.notes);
  }
})(bids);
console.log(`[seed] Inserted ${bids.length} sourced bid-log bids`);

const insertProject = db.prepare('INSERT INTO projects (name, phase, progress, budget, spent, manager, start_date, end_date, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?)');
insertProject.run(
  homeDepotRows.project.name,
  homeDepotRows.project.phase,
  homeDepotRows.project.progress,
  homeDepotRows.project.budget,
  homeDepotRows.project.spent,
  homeDepotRows.project.manager,
  homeDepotRows.project.start_date,
  homeDepotRows.project.end_date,
  homeDepotRows.project.status,
  homeDepotRows.project.notes,
);
console.log('[seed] Inserted 1 sourced project');

db.prepare('DELETE FROM pricebook').run();
const priceItems = readPricebooks(PROJECT_ROOT);
const insertPrice = db.prepare(`
  INSERT INTO pricebook
    (item, supplier, price, unit, category, sku, source_file, source_sheet, source_row, confidence, status, last_updated)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
db.transaction((rows) => {
  for (const item of rows) {
    insertPrice.run(
      item.description,
      item.supplier,
      item.price,
      'EA',
      item.supplier,
      item.sku,
      item.source_file,
      item.source_sheet,
      item.source_row,
      1,
      'vendor_pricebook',
      '2026-01-15',
    );
  }
})(priceItems);
console.log(`[seed] Inserted ${priceItems.length} sourced pricebook items`);

const insertCompliance = db.prepare('INSERT INTO compliance (project_name, type, due_date, status, authority, notes) VALUES (?,?,?,?,?,?)');
insertCompliance.run(
  homeDepotRows.compliance.project_name,
  homeDepotRows.compliance.type,
  homeDepotRows.compliance.due_date,
  homeDepotRows.compliance.status,
  homeDepotRows.compliance.authority,
  homeDepotRows.compliance.notes,
);
console.log('[seed] Inserted 1 sourced compliance item');

// ── Evidence + fail-closed claim gates (source-linked, fail-closed on claims) ──
db.prepare('DELETE FROM project_evidence').run();
db.prepare('DELETE FROM claim_gates').run();

const insertEvidence = db.prepare(
  `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
const evidenceRows = buildHomeDepotEvidenceRows();
db.transaction((rows) => {
  for (const row of rows) {
    insertEvidence.run(row.projectName, row.evidenceType, row.sourceFile, row.sourceRef, row.status, row.notes);
  }
})(evidenceRows);
console.log(`[seed] Inserted ${evidenceRows.length} sourced evidence rows`);

const insertGate = db.prepare(
  `INSERT OR REPLACE INTO claim_gates
     (project_name, code, severity, missing_artifact, acceptable_evidence, blocked_claims, next_action, status)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
const claimGates = buildHomeDepotClaimGates();
db.transaction((gates) => {
  for (const gate of gates) {
    insertGate.run(
      gate.projectName,
      gate.code,
      gate.severity,
      gate.missingArtifact,
      gate.acceptableEvidence,
      JSON.stringify(gate.blockedClaims),
      gate.nextAction,
      gate.status,
    );
  }
})(claimGates);
console.log(`[seed] Inserted ${claimGates.length} fail-closed claim gates`);

console.log('[seed] Database seeded successfully!');
db.close();
