/**
 * HaloFire API Server
 * Express backend with SQLite database, JWT auth, and skill integration
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';
import { createLogger } from '../core/logger.js';
import { generateSprinklerBid, buildEsfrSystemScope, priceBid } from '../engine/sprinkler-layout.js';
import { buildFullScopeBid } from '../engine/bid-scope.js';
import { buildScene } from '../engine/geometry.js';
import { buildResolverFromDb } from '../engine/pricebook-pricing.js';
import { floorPlanFromSvg, floorPlanFromDxf, normalizeFloorPlan, buildingFromSvg, buildingFromDxf } from '../engine/floorplan-import.js';
import { floorPlanFromPdf } from '../engine/pdf-floorplan.js';
import { buildCadModel } from '../engine/cad-model.js';
import { toDxf } from '../engine/dxf-export.js';
import { requiredPressureAtRiser, flagSchedule, remoteAreaDemand } from '../engine/hydraulics.js';
import { buildParityMatrix, parityAchieved } from '../engine/parity-matrix.js';
import { AUTOSPRINK_PARITY_GATE, buildParityInventory, parityGateStatus, getComponent } from '../components/registry.js';
import { buildPartManifest } from '../components/part-mesh.js';
import { buildSourceAcquisitionLedger } from '../components/auto-source-runner.js';
import { balanceNetwork } from '../engine/hydraulic-network.js';
import { checkCompliance } from '../engine/nfpa-compliance.js';
import { buildSubmittal, renderSubmittalPdf } from '../engine/submittal.js';
import { homeDepotRexburgFloorPlan, cooperative1881FloorPlan, COOPERATIVE_1881_PROJECT_NAME } from '../data/floorplans.js';
import { HOME_DEPOT_PROJECT_NAME } from '../data/evidence-gates.js';
import { readHomeDepotBidPackage, readHomeDepotRealTakeoff } from '../data/home-depot-bid-package.js';
import { readCooperative1881BidPackage, readCooperative1881RealTakeoff } from '../data/cooperative-1881-bid-package.js';
import { buildPlanSegmentationPayload } from '../components/sam-floorplan.js';
import { buildSamInvoker } from './sam-invoker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('api-server');

// ── Config ──
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ALLOW_DEV_DEFAULTS = process.env.HALOFIRE_ALLOW_DEV_DEFAULTS === '1';
const JWT_SECRET = process.env.JWT_SECRET || (NODE_ENV === 'development' && ALLOW_DEV_DEFAULTS ? 'halofire-local-dev-secret-change-me' : null);
const ADMIN_USERNAME = process.env.HALOFIRE_ADMIN_USER || (ALLOW_DEV_DEFAULTS ? 'admin' : null);
const ADMIN_PASSWORD = process.env.HALOFIRE_ADMIN_PASSWORD || (ALLOW_DEV_DEFAULTS ? 'halofire2026' : null);
const DB_PATH = process.env.HALOFIRE_DB_PATH
  ? path.resolve(process.env.HALOFIRE_DB_PATH)
  : path.resolve(__dirname, '../../data/halofire.db');
const DATA_DIR = path.dirname(DB_PATH);
const CORS_ORIGINS = (process.env.HALOFIRE_CORS_ORIGINS || 'http://localhost:3001,http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Real submitted ESI bid-log total for the Home Depot - Rexburg ID job
// ('01-Bid Log.xlsx' -> sheet 'Bid Log', amount column, ~792543.8391569464
// rounded to cents). Used ONLY as an INFORMATIONAL calibration reference for the
// best-effort full-scope estimate on the built-in Home Depot project — it is
// never an accuracy/parity claim and never clears a gate.
const HOME_DEPOT_BID_LOG_TOTAL = 792543.84;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required unless HALOFIRE_ALLOW_DEV_DEFAULTS=1 in local development');
}

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  throw new Error('HALOFIRE_ADMIN_USER and HALOFIRE_ADMIN_PASSWORD are required unless HALOFIRE_ALLOW_DEV_DEFAULTS=1');
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Database ──
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Init Tables ──
function initDatabase() {
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

    CREATE TABLE IF NOT EXISTS estimates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT,
      sqft INTEGER,
      stories INTEGER DEFAULT 1,
      system_type TEXT DEFAULT 'Wet',
      hazard TEXT DEFAULT 'Light',
      labor_rate REAL DEFAULT 85,
      markup REAL DEFAULT 25,
      material_cost REAL,
      labor_cost REAL,
      total REAL,
      head_count INTEGER,
      pipe_length INTEGER,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
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

    CREATE TABLE IF NOT EXISTS settings_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_type TEXT NOT NULL,
      mode TEXT NOT NULL,
      url TEXT,
      filename TEXT,
      notes TEXT,
      evidence_id INTEGER REFERENCES project_evidence(id),
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS part_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      mode TEXT NOT NULL,
      ref TEXT,
      format TEXT,
      manufacturer TEXT,
      license TEXT,
      notes TEXT,
      evidence_id INTEGER REFERENCES project_evidence(id),
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  // Settings document upload/link records (T19).
  ensureColumn('settings_documents', 'mode', 'TEXT');
  ensureColumn('settings_documents', 'url', 'TEXT');
  ensureColumn('settings_documents', 'filename', 'TEXT');
  ensureColumn('settings_documents', 'notes', 'TEXT');
  ensureColumn('settings_documents', 'evidence_id', 'INTEGER');
  ensureColumn('settings_documents', 'created_by', 'TEXT');

  // Per-component catalog part override records (R4).
  ensureColumn('part_overrides', 'mode', 'TEXT');
  ensureColumn('part_overrides', 'ref', 'TEXT');
  ensureColumn('part_overrides', 'format', 'TEXT');
  ensureColumn('part_overrides', 'manufacturer', 'TEXT');
  ensureColumn('part_overrides', 'license', 'TEXT');
  ensureColumn('part_overrides', 'notes', 'TEXT');
  ensureColumn('part_overrides', 'evidence_id', 'INTEGER');
  ensureColumn('part_overrides', 'created_by', 'TEXT');

  // Bootstrap the configured admin user without hardcoded credentials.
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USERNAME);
  if (!existing) {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
    db.prepare('INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)').run(
      ADMIN_USERNAME,
      hash,
      'HaloFire Admin',
      'admin',
      'admin@halofire.local',
    );
    log.info('Configured admin user created');
  }

  log.info('Database initialized');
}

initDatabase();

// ── Express App ──
const app = express();
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const sameOrigin = origin === `${req.protocol}://${req.get('host')}`;
  if (origin && !sameOrigin && !CORS_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'CORS origin not allowed' });
  }
  next();
});
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
// In tests, many spawned-server suites run in parallel and make far more than
// the production budget of requests per server; raise the ceilings under
// NODE_ENV=test so the rate limiters don't cause spurious 429s. Production
// limits are unchanged.
const API_RATE_MAX = NODE_ENV === 'test' ? 100000 : 100;
const LOGIN_RATE_MAX = NODE_ENV === 'test' ? 100000 : 10;
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: API_RATE_MAX, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: LOGIN_RATE_MAX, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.resolve(__dirname, '../../')));
// Serve the bundled Three.js + OpenGeometry CAD kernel locally (no CDN).
app.use('/vendor/three', express.static(path.resolve(__dirname, '../../node_modules/three')));
app.use('/vendor/opengeometry', express.static(path.resolve(__dirname, '../../node_modules/opengeometry')));

// ── Auth Middleware ──
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function normalizeRole(role) {
  return String(role || 'user').trim().toLowerCase();
}

function requireRole(role) {
  return (req, res, next) => {
    if (normalizeRole(req.user?.role) !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

function buildAllowedUpdate(body, allowedFields) {
  const entries = Object.entries(body).filter(([key]) => key !== 'id');
  const rejected = entries.filter(([key]) => !allowedFields.has(key)).map(([key]) => key);
  if (rejected.length) return { error: `Unsupported fields: ${rejected.join(', ')}` };
  if (!entries.length) return { error: 'No fields to update' };
  return {
    sets: entries.map(([key]) => `${key} = ?`).join(', '),
    values: entries.map(([, value]) => value),
  };
}

const BID_UPDATE_FIELDS = new Set(['project', 'contractor', 'value', 'status', 'date', 'due_date', 'sqft', 'system_type', 'contact', 'notes']);
const PROJECT_UPDATE_FIELDS = new Set(['name', 'bid_id', 'phase', 'progress', 'budget', 'spent', 'manager', 'start_date', 'end_date', 'status', 'notes']);
const COMPLIANCE_UPDATE_FIELDS = new Set(['project_id', 'project_name', 'type', 'due_date', 'status', 'authority', 'notes']);

// ── Auth Routes ──
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const role = normalizeRole(user.role);
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, name, role, email FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// ── Bids CRUD ──
app.get('/api/bids', authMiddleware, (req, res) => {
  const { status, search, limit = 100, offset = 0 } = req.query;
  let query = 'SELECT * FROM bids WHERE 1=1';
  const params = [];
  if (status && status !== 'All') { query += ' AND status = ?'; params.push(status); }
  if (search) { query += ' AND (project LIKE ? OR contractor LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  const bids = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM bids').get().count;
  res.json({ bids, total });
});

app.post('/api/bids', authMiddleware, (req, res) => {
  const { project, contractor, value, status, date, due_date, sqft, system_type, contact, notes } = req.body;
  const result = db.prepare('INSERT INTO bids (project, contractor, value, status, date, due_date, sqft, system_type, contact, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(project, contractor, value || 0, status || 'Pending', date, due_date, sqft || 0, system_type || 'Wet', contact, notes, req.user.id);
  res.json({ id: result.lastInsertRowid, message: 'Bid created' });
});

app.put('/api/bids/:id', authMiddleware, (req, res) => {
  const update = buildAllowedUpdate(req.body, BID_UPDATE_FIELDS);
  if (update.error) return res.status(400).json({ error: update.error });
  db.prepare(`UPDATE bids SET ${update.sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...update.values, req.params.id);
  res.json({ message: 'Bid updated' });
});

app.delete('/api/bids/:id', authMiddleware, requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM bids WHERE id = ?').run(req.params.id);
  res.json({ message: 'Bid deleted' });
});

// ── Projects CRUD ──
app.get('/api/projects', authMiddleware, (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.json(projects);
});

app.post('/api/projects', authMiddleware, (req, res) => {
  const { name, bid_id, phase, progress, budget, spent, manager, start_date, end_date, status, notes } = req.body;
  const result = db.prepare('INSERT INTO projects (name, bid_id, phase, progress, budget, spent, manager, start_date, end_date, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(name, bid_id, phase||'Design', progress||0, budget||0, spent||0, manager, start_date, end_date, status||'On Track', notes);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/projects/:id', authMiddleware, (req, res) => {
  const update = buildAllowedUpdate(req.body, PROJECT_UPDATE_FIELDS);
  if (update.error) return res.status(400).json({ error: update.error });
  db.prepare(`UPDATE projects SET ${update.sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...update.values, req.params.id);
  res.json({ message: 'Project updated' });
});

// ── Pricebook ──
app.get('/api/pricebook', authMiddleware, (req, res) => {
  const { search, category, supplier, limit = 500 } = req.query;
  let query = 'SELECT * FROM pricebook WHERE 1=1';
  const params = [];
  if (search) { query += ' AND (item LIKE ? OR sku LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (category && category !== 'All') { query += ' AND category = ?'; params.push(category); }
  if (supplier) { query += ' AND supplier = ?'; params.push(supplier); }
  query += ' ORDER BY category, item LIMIT ?';
  params.push(parseInt(limit));
  res.json(db.prepare(query).all(...params));
});

app.post('/api/pricebook/bulk', authMiddleware, requireRole('admin'), (req, res) => {
  const { items } = req.body;
  const insert = db.prepare(`
    INSERT OR REPLACE INTO pricebook
      (item, supplier, price, unit, category, sku, source_file, source_sheet, source_row, confidence, status, last_updated)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((items) => {
    for (const i of items) {
      insert.run(
        i.item || i.description,
        i.supplier,
        i.price,
        i.unit || 'EA',
        i.category || i.supplier,
        i.sku,
        i.source_file || null,
        i.source_sheet || null,
        i.source_row || null,
        i.confidence ?? 1,
        i.status || 'vendor_pricebook',
        i.last_updated || new Date().toISOString().slice(0, 10),
      );
    }
  });
  tx(items);
  res.json({ imported: items.length });
});

// ── Compliance ──
app.get('/api/compliance', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM compliance ORDER BY due_date ASC').all());
});

app.post('/api/compliance', authMiddleware, (req, res) => {
  const { project_id, project_name, type, due_date, status, authority, notes } = req.body;
  const result = db.prepare('INSERT INTO compliance (project_id, project_name, type, due_date, status, authority, notes) VALUES (?,?,?,?,?,?,?)').run(project_id, project_name, type, due_date, status||'Upcoming', authority, notes);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/compliance/:id', authMiddleware, (req, res) => {
  const update = buildAllowedUpdate(req.body, COMPLIANCE_UPDATE_FIELDS);
  if (update.error) return res.status(400).json({ error: update.error });
  db.prepare(`UPDATE compliance SET ${update.sets} WHERE id = ?`).run(...update.values, req.params.id);
  res.json({ message: 'Updated' });
});

// ── Estimates ──
app.get('/api/estimates', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM estimates ORDER BY created_at DESC').all());
});

app.post('/api/estimates', authMiddleware, (req, res) => {
  const e = req.body;
  const result = db.prepare('INSERT INTO estimates (project_name, sqft, stories, system_type, hazard, labor_rate, markup, material_cost, labor_cost, total, head_count, pipe_length, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(e.project_name, e.sqft, e.stories, e.system_type, e.hazard, e.labor_rate, e.markup, e.material_cost, e.labor_cost, e.total, e.head_count, e.pipe_length, e.notes, req.user.id);
  res.json({ id: result.lastInsertRowid });
});

// ── Analytics ──
app.get('/api/analytics/summary', authMiddleware, (req, res) => {
  const totalBids = db.prepare('SELECT COUNT(*) as count FROM bids').get().count;
  const wonBids = db.prepare("SELECT COUNT(*) as count FROM bids WHERE status = 'Won'").get().count;
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(value), 0) as total FROM bids WHERE status = 'Won'").get().total;
  const activeProjects = db.prepare("SELECT COUNT(*) as count FROM projects WHERE status != 'Complete'").get().count;
  const avgDealSize = wonBids > 0 ? Math.round(totalRevenue / wonBids) : 0;

  res.json({
    totalBids, wonBids, totalRevenue, activeProjects, avgDealSize,
    winRate: totalBids > 0 ? Math.round(wonBids / totalBids * 100) : 0,
  });
});

// ── Project Evidence & Claim Gates ──
// Evidence rows are append-only source-of-truth records. Claim gates are
// fail-closed: adding best-effort/AI evidence never flips a blocking gate to
// cleared. Only a recorded human/professional/AHJ artifact can do that, and
// that resolution path is intentionally not exposed as a casual write here.
const EVIDENCE_INSERT_FIELDS = new Set(['evidence_type', 'source_file', 'source_ref', 'status', 'notes']);

// Only these real-world artifact types may clear a fail-closed claim gate.
// AI/best-effort output is intentionally excluded — it can never clear a gate.
const GATE_CLEARING_EVIDENCE_TYPES = new Set([
  'ahj_approval',
  'professional_review',
  'pe_signoff',
  'manufacturer_approval',
  'autosprink_packet',
  'employee_signoff',
]);
const SIGNED_REVIEW_EVIDENCE_TYPES = new Set([
  'ahj_approval',
  'professional_review',
  'pe_signoff',
  'manufacturer_approval',
  'autosprink_packet',
]);

const GATE_EVIDENCE_RULES = Object.freeze({
  AUTOSPRINK_EVIDENCE_MISSING: Object.freeze({
    allowedEvidenceTypes: ['autosprink_packet'],
    canResolve: true,
  }),
  AHJ_APPROVAL_MISSING: Object.freeze({
    allowedEvidenceTypes: ['ahj_approval'],
    canResolve: true,
  }),
  PROFESSIONAL_REVIEW_MISSING: Object.freeze({
    allowedEvidenceTypes: ['professional_review', 'pe_signoff', 'employee_signoff'],
    canResolve: true,
  }),
  MANUFACTURER_MODEL_APPROVAL_MISSING: Object.freeze({
    allowedEvidenceTypes: ['manufacturer_approval'],
    canResolve: true,
  }),
  BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL: Object.freeze({
    allowedEvidenceTypes: ['employee_signoff'],
    canResolve: true,
  }),
});

function gateEvidenceRule(code) {
  return GATE_EVIDENCE_RULES[code] || { allowedEvidenceTypes: [], canResolve: false };
}

function normalizeSignedReviewerSignoff(evidenceType, signoff) {
  if (!SIGNED_REVIEW_EVIDENCE_TYPES.has(evidenceType)) return null;
  if (!signoff || typeof signoff !== 'object') {
    const e = new Error(`evidence.signoff is required for ${evidenceType}`);
    e.httpStatus = 400;
    throw e;
  }
  const reviewerName = String(signoff.reviewer_name || signoff.reviewerName || '').trim();
  const reviewerTitle = String(signoff.reviewer_title || signoff.reviewerTitle || '').trim();
  const signedAt = String(signoff.signed_at || signoff.signedAt || '').trim();
  if (!reviewerName || !reviewerTitle || !signedAt) {
    const e = new Error('evidence.signoff must include reviewer_name, reviewer_title, and signed_at');
    e.httpStatus = 400;
    throw e;
  }
  const signedAtIso = new Date(signedAt).toISOString();
  if (!signedAtIso || Number.isNaN(Date.parse(signedAtIso))) {
    const e = new Error('evidence.signoff.signed_at must be a valid timestamp');
    e.httpStatus = 400;
    throw e;
  }
  return {
    reviewer_name: reviewerName,
    reviewer_title: reviewerTitle,
    signed_at: signedAtIso,
    ...(signoff.organization ? { organization: String(signoff.organization).trim() } : {}),
    ...(signoff.license_id || signoff.licenseId ? { license_id: String(signoff.license_id || signoff.licenseId).trim() } : {}),
  };
}

app.get('/api/projects/:name/claim-gates', authMiddleware, (req, res) => {
  const gates = db
    .prepare('SELECT * FROM claim_gates WHERE project_name = ? ORDER BY severity DESC, code')
    .all(req.params.name);
  res.json(gates.map((gate) => ({
    ...gate,
    blocked_claims: safeParseJsonArray(gate.blocked_claims),
  })));
});

app.get('/api/projects/:name/evidence-wizard', authMiddleware, (req, res) => {
  const projectName = req.params.name;
  const gates = db
    .prepare('SELECT * FROM claim_gates WHERE project_name = ? ORDER BY severity DESC, code')
    .all(projectName);
  const evidence = db
    .prepare('SELECT * FROM project_evidence WHERE project_name = ? ORDER BY created_at DESC, id DESC')
    .all(projectName);
  const evidenceByType = new Map();
  for (const row of evidence) {
    if (!evidenceByType.has(row.evidence_type)) evidenceByType.set(row.evidence_type, []);
    evidenceByType.get(row.evidence_type).push(row);
  }
  const gateRows = gates.map((gate) => {
    const rule = gateEvidenceRule(gate.code);
    const matchingEvidence = rule.allowedEvidenceTypes.flatMap((type) => evidenceByType.get(type) || []);
    const requiresSignoffFor = rule.allowedEvidenceTypes.filter((type) => SIGNED_REVIEW_EVIDENCE_TYPES.has(type));
    return {
      ...gate,
      blocked_claims: safeParseJsonArray(gate.blocked_claims),
      allowed_evidence_types: [...rule.allowedEvidenceTypes],
      requires_signoff_for: requiresSignoffFor,
      can_resolve: rule.canResolve,
      matching_evidence_count: matchingEvidence.length,
      matching_evidence: matchingEvidence.slice(0, 5),
    };
  });
  res.json({
    project_name: projectName,
    can_write: normalizeRole(req.user?.role) === 'admin',
    summary: {
      blocked: gateRows.filter((gate) => gate.status === 'blocked').length,
      cleared: gateRows.filter((gate) => gate.status === 'cleared').length,
      evidence_rows: evidence.length,
    },
    gates: gateRows,
  });
});

app.get('/api/projects/:name/evidence', authMiddleware, (req, res) => {
  const evidence = db
    .prepare('SELECT * FROM project_evidence WHERE project_name = ? ORDER BY created_at DESC, id DESC')
    .all(req.params.name);
  res.json(evidence);
});

app.get('/api/projects/:name/evidence/:evidenceId/replay-bid-artifact', authMiddleware, (req, res) => {
  const row = db
    .prepare('SELECT * FROM project_evidence WHERE project_name = ? AND id = ?')
    .get(req.params.name, Number(req.params.evidenceId));
  if (!row) return res.status(404).json({ error: 'Evidence row not found' });
  if (row.evidence_type !== 'best_effort_ai_layout') {
    return res.status(400).json({ error: 'Evidence row is not a replay bid artifact' });
  }
  let notes;
  try {
    notes = JSON.parse(row.notes || '{}');
  } catch {
    return res.status(400).json({ error: 'Evidence row does not contain structured replay artifact notes' });
  }
  if (notes.kind !== 'best_effort_ai_layout_replay') {
    return res.status(400).json({ error: 'Evidence row is not a room-boundary replay artifact' });
  }
  res.json({
    artifact_type: notes.artifact_type || 'room_boundary_replay_bid_artifact',
    status: notes.artifact_status || 'best_effort_internal_alpha',
    project_name: row.project_name,
    evidence_id: row.id,
    evidence_type: row.evidence_type,
    generated_at: notes.replay_generated_at || row.created_at,
    download_name: notes.download_name || `room-boundary-replay-bid-artifact-${row.id}.json`,
    source_ref: row.source_ref,
    source_replay_packet: {
      source_evidence_id: notes.source_evidence_id,
      source_review_evidence_id: notes.source_review_evidence_id,
      source_sam31_evidence_id: notes.source_sam31_evidence_id,
      marked_up_plan_ref: notes.marked_up_plan_ref,
      sam31_result_ref: notes.sam31_result_ref,
      screenshot_ref: notes.screenshot_ref,
      console_log_ref: notes.console_log_ref,
      corrected_room_polygon_count: notes.corrected_room_polygon_count,
    },
    bid_summary: notes.bid_summary || {
      total_area_sqft: notes.total_area_sqft,
      total_head_count: notes.total_head_count,
    },
    blocked_claims: Array.isArray(notes.blocked_claims) ? notes.blocked_claims : [],
    claim_gate_effect: notes.claim_gate_effect || 'no_claims_cleared',
    limitations: Array.isArray(notes.limitations) ? notes.limitations : [
      'This replay artifact is internal-alpha evidence only and does not clear regulated claims.',
    ],
  });
});

app.get('/api/projects/:name/evidence/:evidenceId/official-flow-hydraulic-replay-artifact', authMiddleware, (req, res) => {
  const row = db
    .prepare('SELECT * FROM project_evidence WHERE project_name = ? AND id = ?')
    .get(req.params.name, Number(req.params.evidenceId));
  if (!row) return res.status(404).json({ error: 'Evidence row not found' });
  if (row.evidence_type !== 'official_flow_hydraulic_replay_artifact') {
    return res.status(400).json({ error: 'Evidence row is not an official-flow hydraulic replay artifact' });
  }
  let notes;
  try {
    notes = JSON.parse(row.notes || '{}');
  } catch {
    return res.status(400).json({ error: 'Evidence row does not contain structured official-flow replay notes' });
  }
  if (notes.kind !== 'official_flow_hydraulic_replay_artifact') {
    return res.status(400).json({ error: 'Evidence row is not an official-flow hydraulic replay artifact' });
  }
  const artifact = notes.artifact || {};
  res.json({
    ...artifact,
    artifact_type: artifact.artifact_type || notes.artifact_type || 'official_flow_hydraulic_replay_artifact',
    status: artifact.status || notes.artifact_status || 'best_effort_internal_alpha',
    project_name: row.project_name,
    evidence_id: row.id,
    evidence_type: row.evidence_type,
    source_ref: row.source_ref,
    source_evidence_id: artifact.source_evidence_id || notes.source_evidence_id,
    generated_at: artifact.generated_at || notes.replay_generated_at || row.created_at,
    download_name: artifact.download_name || notes.download_name || `official-flow-hydraulic-replay-artifact-${row.id}.json`,
    blocked_claims: Array.isArray(artifact.blocked_claims) ? artifact.blocked_claims : (Array.isArray(notes.blocked_claims) ? notes.blocked_claims : []),
    claim_gate_effect: artifact.claim_gate_effect || notes.claim_gate_effect || 'no_claims_cleared',
    limitations: Array.isArray(artifact.limitations) ? artifact.limitations : [
      'This persisted replay artifact is internal-alpha evidence only and does not clear regulated claims.',
    ],
  });
});

app.post('/api/projects/:name/evidence', authMiddleware, requireRole('admin'), (req, res) => {
  const rejected = Object.keys(req.body).filter((key) => !EVIDENCE_INSERT_FIELDS.has(key));
  if (rejected.length) return res.status(400).json({ error: `Unsupported fields: ${rejected.join(', ')}` });
  const { evidence_type, source_file = null, source_ref = null, status, notes = null } = req.body;
  if (!evidence_type || !status) {
    return res.status(400).json({ error: 'evidence_type and status are required' });
  }
  const result = db
    .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.params.name, evidence_type, source_file, source_ref, status, notes);
  res.status(201).json({ id: result.lastInsertRowid, message: 'Evidence recorded' });
});

// Resolve a fail-closed claim gate. Admin-only, and only with a real evidence
// artifact. The evidence row is recorded (status 'present') and the gate is
// flipped blocked->cleared with who/what/when provenance. Best-effort/AI
// evidence is rejected and the gate stays blocked — fail-closed by design.
app.post('/api/projects/:name/claim-gates/:code/resolve', authMiddleware, requireRole('admin'), (req, res) => {
  const projectName = req.params.name;
  const code = req.params.code;
  const evidence = req.body?.evidence;
  if (!evidence || typeof evidence !== 'object') {
    return res.status(400).json({ error: 'A real evidence object is required to clear a gate' });
  }
  const { evidence_type, source_ref = null, source_file = null, notes = null } = evidence;
  if (!evidence_type || !source_ref) {
    return res.status(400).json({ error: 'evidence.evidence_type and evidence.source_ref are required' });
  }
  // Status is treated as 'present' on success; an explicit best_effort status is rejected.
  const status = evidence.status === undefined ? 'present' : String(evidence.status);
  if (status === 'best_effort') {
    return res.status(400).json({ error: 'best_effort evidence cannot clear a claim gate' });
  }
  if (status !== 'present') {
    return res.status(400).json({ error: "evidence status must be 'present' to clear a gate" });
  }
  if (!GATE_CLEARING_EVIDENCE_TYPES.has(evidence_type)) {
    return res.status(400).json({
      error: `evidence_type '${evidence_type}' cannot clear a gate; must be one of: ${[...GATE_CLEARING_EVIDENCE_TYPES].join(', ')}`,
    });
  }

  const existing = db
    .prepare('SELECT * FROM claim_gates WHERE project_name = ? AND code = ?')
    .get(projectName, code);
  if (!existing) {
    return res.status(404).json({ error: 'Claim gate not found' });
  }
  const rule = gateEvidenceRule(code);
  if (!rule.canResolve) {
    return res.status(400).json({ error: 'This gate cannot be cleared through the evidence wizard' });
  }
  if (!rule.allowedEvidenceTypes.includes(evidence_type)) {
    return res.status(400).json({
      error: `Gate ${code} only accepts allowed evidence types: ${rule.allowedEvidenceTypes.join(', ')}`,
    });
  }
  let storedNotes = notes;
  try {
    const signoff = normalizeSignedReviewerSignoff(evidence_type, evidence.signoff);
    if (signoff) {
      storedNotes = JSON.stringify({
        kind: 'signed_reviewer_evidence',
        evidence_type,
        source_ref,
        signoff,
        user_notes: notes,
        claim_gate_effect: 'gate_cleared',
      });
    }
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }

  const resolvedAt = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(projectName, evidence_type, source_file, source_ref, 'present', storedNotes);
    db.prepare(`UPDATE claim_gates
                SET status = 'cleared', resolved_by = ?, resolved_at = ?, resolved_evidence_ref = ?
                WHERE project_name = ? AND code = ?`)
      .run(req.user.username, resolvedAt, source_ref, projectName, code);
  });
  tx();

  res.status(200).json({
    cleared: true,
    code,
    resolved_by: req.user.username,
    resolved_at: resolvedAt,
    resolved_evidence_ref: source_ref,
  });
});

// Shared best-effort sprinkler pipeline: resolve the input drawing, generate the
// auto-layout/bid, build the 3D CAD model, run the single-path hydraulic estimate,
// the FULL network balance, and the NFPA-13 geometric compliance check. Returns
// either { httpError:{status,error} } or the assembled artifacts. Fail-closed:
// this NEVER clears AutoSprink/AHJ/PE/manufacturer gates; it records a best_effort
// evidence row only. Used by both /sprinkler-bid and /submittal.

// Default AutoCAD-style layer name conventions for a building DXF import. Callers
// may override per-request via req.body.dxfLayers. Matching is exact per layer name.
const DEFAULT_DXF_LAYERS = Object.freeze({
  spaces: ['ROOMS', 'SPACES', 'A-AREA', 'PLAN'],
  wallsExterior: ['WALLS-EXT', 'A-WALL-EXT', 'WALLS'],
  wallsInterior: ['WALLS-INT', 'A-WALL-INT', 'PARTITIONS'],
  doors: ['DOOR', 'DOORS', 'A-DOOR'],
  columns: ['COLUMN', 'COLUMNS', 'COLS', 'A-COLS'],
});

// Lazily-loaded pdfjs (legacy build) for headless Node vector-PDF extraction.
// Cached after first load. Worker is pointed at the legacy worker module via a
// file:// URL so it runs without a browser/canvas.
let _pdfjsModulePromise = null;
async function loadPdfjs() {
  if (!_pdfjsModulePromise) {
    _pdfjsModulePromise = (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      try {
        const { createRequire } = await import('node:module');
        const { pathToFileURL } = await import('node:url');
        const require = createRequire(import.meta.url);
        pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
          require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
        ).href;
      } catch {
        // If worker wiring fails, pdfjs falls back to its in-process fake worker.
      }
      return pdfjs;
    })();
  }
  return _pdfjsModulePromise;
}

// T28 — Resolve a "pdf" plan source (base64 vector PDF) into a normalized floor
// plan, ASYNCHRONOUSLY (PDF parsing is async). Returns null when no pdf was sent.
// Throws an Error with .httpStatus=400 on a bad/missing scale or unparseable PDF
// so the caller can fail-soft to a clear 400 (never 500). The extracted geometry
// is REAL; the scale is operator-supplied and never guessed.
async function resolvePdfFloorPlan(req) {
  if (!req.body || typeof req.body.pdf !== 'string' || !req.body.pdf.trim()) return null;
  let data;
  try {
    data = Buffer.from(req.body.pdf, 'base64');
    if (!data.length) throw new Error('empty PDF payload');
  } catch (err) {
    const e = new Error(`Invalid base64 PDF payload: ${err.message}`);
    e.httpStatus = 400;
    throw e;
  }
  const pageIndex = Number.isFinite(Number(req.body.pdfPageIndex)) ? Number(req.body.pdfPageIndex) : 0;
  const scale = Number(req.body.pdfScale);
  const pdfExtract = typeof req.body.pdfExtract === 'string' && req.body.pdfExtract.trim()
    ? req.body.pdfExtract.trim()
    : (typeof req.body.extract === 'string' ? req.body.extract.trim() : '');
  const vectorExtractOptions = {};
  if (pdfExtract === 'outline') {
    vectorExtractOptions.extract = 'outline';
  } else if (pdfExtract === 'wallLayer' || pdfExtract === 'layerSelect') {
    vectorExtractOptions.extract = 'wallLayer';
  } else if (pdfExtract === 'dominant' || pdfExtract === 'isolated') {
    vectorExtractOptions.isolate = 'dominant';
  } else if (pdfExtract === 'fullExtent') {
    vectorExtractOptions.isolate = 'fullExtent';
  } else if (pdfExtract && !['sam', 'vector', 'bbox', 'wholeSheet'].includes(pdfExtract)) {
    const e = new Error(`Unsupported PDF extraction mode: ${pdfExtract}`);
    e.httpStatus = 400;
    throw e;
  }
  // T36 — SAM-3.1 plan-segmentation request. Accepted via pdfExtract:"sam" (also the
  // legacy alias extract:"sam"). The production SAM invoker is wired to the OpenClaw
  // governed bridge ONLY when OPENCLAW_BRIDGE_URL is set; segmentFloorPlanViaSam calls
  // it with a single payload arg, so buildSamInvoker adapts the (tool,args) bridge.
  // FAIL-SOFT: with no bridge URL, OR when SAM is unreachable/empty (floorPlanFromPdf
  // returns { samSkipped:true }), we FALL BACK to the existing vector footprint so the
  // response still 200s with a real bid, marking pdfMeta.samSkipped + samReason. We
  // NEVER throw to 500 and NEVER fabricate a segmentation. The scale guard still applies.
  const wantsSam = pdfExtract === 'sam';
  try {
    const pdfjs = await loadPdfjs();
    let samSkipped = false;
    let samReason = null;
    if (wantsSam) {
      const samInvoker = buildSamInvoker({
        bridgeUrl: process.env.OPENCLAW_BRIDGE_URL,
        fetchImpl: globalThis.fetch,
      });
      if (!samInvoker) {
        samSkipped = true;
        samReason = 'openclaw_bridge_url_unset';
      } else {
        const samExtracted = await floorPlanFromPdf(new Uint8Array(data), {
          extract: 'sam',
          pageIndex,
          scale, // operator-supplied; floorPlanFromPdf throws if absent/<=0 (still 400)
          hazard: req.body.hazard,
          samInvoker,
          pdfjs,
        });
        if (samExtracted.samSkipped) {
          // SAM down/unreachable/empty -> fall through to the vector fallback below.
          samSkipped = true;
          samReason = samExtracted.reason || 'sam_unavailable';
        } else {
          const samFloorPlan = normalizeFloorPlan({
            name: req.params.name || 'Imported PDF Plan',
            units: 'ft',
            rooms: samExtracted.rooms,
          });
          return {
            floorPlan: samFloorPlan,
            pdfMeta: {
              pageIndex: samExtracted.pageIndex,
              scale: samExtracted.scale,
              segmentCount: samExtracted.segmentCount,
              bbox: samExtracted.bbox,
              note: samExtracted.note,
              method: samExtracted.method,
              source: samExtracted.source,
              label: samExtracted.label,
              areaSqft: samExtracted.areaSqft,
            },
          };
        }
      }
    }
    const extracted = await floorPlanFromPdf(new Uint8Array(data), {
      pageIndex,
      scale, // operator-supplied feet-per-PDF-point; floorPlanFromPdf throws if absent/<=0
      hazard: req.body.hazard,
      pdfjs,
      ...vectorExtractOptions,
    });
    const floorPlan = normalizeFloorPlan({
      name: req.params.name || 'Imported PDF Plan',
      units: 'ft',
      rooms: extracted.rooms,
    });
    const pdfMeta = {
      pageIndex: extracted.pageIndex,
      scale: extracted.scale,
      segmentCount: extracted.segmentCount,
      bbox: extracted.bbox,
      note: extracted.note,
      extraction: wantsSam && samSkipped ? 'vector-fallback' : (pdfExtract || 'vector'),
    };
    for (const key of [
      'areaSqft',
      'method',
      'wallSegmentCount',
      'networkSegmentCount',
      'chosen',
      'groups',
      'keptCount',
      'droppedBorderCount',
      'droppedOutlierCount',
      'groupCount',
      'retainedGroupCount',
    ]) {
      if (extracted[key] !== undefined) pdfMeta[key] = extracted[key];
    }
    if (samSkipped) {
      // FAIL-SOFT fallback marker: SAM was requested but skipped; this bid is the
      // honest VECTOR footprint, NOT a fabricated SAM segmentation.
      pdfMeta.samSkipped = true;
      pdfMeta.samReason = samReason;
    }
    return { floorPlan, pdfMeta };
  } catch (err) {
    const e = new Error(err && err.message ? err.message : String(err));
    e.httpStatus = 400; // bad scale / unparseable pdf -> 400, never 500
    throw e;
  }
}

async function inspectPdfPages(req) {
  if (!req.body || typeof req.body.pdf !== 'string' || !req.body.pdf.trim()) {
    const e = new Error('PDF payload is required');
    e.httpStatus = 400;
    throw e;
  }
  let data;
  try {
    data = Buffer.from(req.body.pdf, 'base64');
    if (!data.length) throw new Error('empty PDF payload');
  } catch (err) {
    const e = new Error(`Invalid base64 PDF payload: ${err.message}`);
    e.httpStatus = 400;
    throw e;
  }
  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(data),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({
        index: i - 1,
        widthPt: Math.round(viewport.width * 1000) / 1000,
        heightPt: Math.round(viewport.height * 1000) / 1000,
        rotation: Number(page.rotate) || 0,
      });
    }
    return {
      pageCount: doc.numPages,
      pages,
      note: 'Best-effort PDF page selection metadata only; it does not prove geometry_accuracy, scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer approval.',
      blockedClaims: [
        'geometry_accuracy',
        'drawing_scale',
        'AHJ_approval',
        'PE_review',
        'AutoSprink_parity',
        'permit_ready',
        'fabrication_ready',
        'manufacturer_exact',
      ],
    };
  } catch (err) {
    const e = new Error(err && err.message ? err.message : String(err));
    e.httpStatus = 400;
    throw e;
  }
}

app.post('/api/pdf/inspect', authMiddleware, async (req, res) => {
  try {
    res.json(await inspectPdfPages(req));
  } catch (err) {
    res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

const PDF_BOUNDARY_BLOCKED_CLAIMS = Object.freeze([
  'geometry_accuracy',
  'drawing_scale',
  'AHJ_approval',
  'PE_review',
  'AutoSprink_parity',
  'permit_ready',
  'fabrication_ready',
  'manufacturer_exact',
]);

function pdfCandidateFromExtraction(mode, label, extracted) {
  const candidate = {
    mode,
    label,
    status: 'candidate',
    segmentCount: extracted.segmentCount,
    bbox: extracted.bbox,
    note: extracted.note,
    blockedClaims: [...PDF_BOUNDARY_BLOCKED_CLAIMS],
  };
  for (const key of [
    'areaSqft',
    'method',
    'wallSegmentCount',
    'networkSegmentCount',
    'chosen',
    'groups',
    'keptCount',
    'droppedBorderCount',
    'droppedOutlierCount',
    'groupCount',
    'retainedGroupCount',
  ]) {
    if (extracted[key] !== undefined) candidate[key] = extracted[key];
  }
  return candidate;
}

async function inspectPdfBoundaryCandidates(req) {
  if (!req.body || typeof req.body.pdf !== 'string' || !req.body.pdf.trim()) {
    const e = new Error('PDF payload is required');
    e.httpStatus = 400;
    throw e;
  }
  const scale = Number(req.body.pdfScale);
  if (!Number.isFinite(scale) || scale <= 0) {
    const e = new Error('A positive pdfScale is required for boundary candidates');
    e.httpStatus = 400;
    throw e;
  }
  let data;
  try {
    data = Buffer.from(req.body.pdf, 'base64');
    if (!data.length) throw new Error('empty PDF payload');
  } catch (err) {
    const e = new Error(`Invalid base64 PDF payload: ${err.message}`);
    e.httpStatus = 400;
    throw e;
  }
  const pageIndex = Number.isFinite(Number(req.body.pdfPageIndex)) ? Number(req.body.pdfPageIndex) : 0;
  try {
    const pdfjs = await loadPdfjs();
    const modes = [
      { mode: 'vector', label: 'Whole vector bbox', opts: {} },
      { mode: 'dominant', label: 'Dominant plan cluster', opts: { isolate: 'dominant' } },
      { mode: 'fullExtent', label: 'Full plan extent', opts: { isolate: 'fullExtent' } },
      { mode: 'outline', label: 'Wall-network outline', opts: { extract: 'outline' } },
      { mode: 'wallLayer', label: 'Lineweight/color wall layer', opts: { extract: 'wallLayer' } },
    ];
    const candidates = [];
    for (const spec of modes) {
      const extracted = await floorPlanFromPdf(new Uint8Array(data), {
        pageIndex,
        scale,
        hazard: req.body.hazard,
        pdfjs,
        ...spec.opts,
      });
      candidates.push(pdfCandidateFromExtraction(spec.mode, spec.label, extracted));
    }
    return {
      pageIndex,
      scale,
      candidates,
      note: 'Boundary candidates are best-effort extraction choices for employee review. Selecting one only sets the import mode; it does not prove geometry accuracy, scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer approval.',
      blockedClaims: [...PDF_BOUNDARY_BLOCKED_CLAIMS],
    };
  } catch (err) {
    const e = new Error(err && err.message ? err.message : String(err));
    e.httpStatus = 400;
    throw e;
  }
}

app.post('/api/pdf/boundary-candidates', authMiddleware, async (req, res) => {
  try {
    res.json(await inspectPdfBoundaryCandidates(req));
  } catch (err) {
    res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

const SAM31_PERCEPTION_LANES = Object.freeze([
  'segmentation',
  'object_identification',
  'vector_overlay',
  'model_3d_candidate',
  'spatial_observation',
]);

function uniqueStrings(values) {
  return [...new Set((values || []).map((v) => String(v || '').trim()).filter(Boolean))];
}

function bboxToPolygon(bbox) {
  if (!bbox) return null;
  if (Array.isArray(bbox) && bbox.length >= 4) {
    const [x0, y0, a, b] = bbox.map((v) => Number(v));
    if (![x0, y0, a, b].every(Number.isFinite)) return null;
    const x1 = a > x0 ? a : x0 + a;
    const y1 = b > y0 ? b : y0 + b;
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }
  if (typeof bbox === 'object') {
    const x = Number(bbox.x ?? bbox.left ?? bbox.x0 ?? bbox.minX);
    const y = Number(bbox.y ?? bbox.top ?? bbox.y0 ?? bbox.minY);
    const width = Number(bbox.width ?? bbox.w ?? ((bbox.x1 ?? bbox.maxX) - x));
    const height = Number(bbox.height ?? bbox.h ?? ((bbox.y1 ?? bbox.maxY) - y));
    if (![x, y, width, height].every(Number.isFinite)) return null;
    return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
  }
  return null;
}

function buildOpenClawSam31PerceptionRequest(projectName, evidence, decision, candidate = {}, pdfRef = null) {
  const segment = {
    id: 'candidate:pdf-boundary',
    semantic_label: 'room_boundary_candidate',
    confidence: Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : 0.65,
    bbox: candidate.bbox || null,
    polygon: bboxToPolygon(candidate.bbox),
    source_ref: evidence.source_ref || decision.sourceRef || pdfRef || null,
    limitations: [
      'Candidate geometry is a best-effort PDF extraction seed for SAM 3.1 and LLM review.',
      'This segment does not prove drawing scale, geometry accuracy, or regulated readiness.',
    ],
  };
  return {
    artifact_type: 'openclaw.sam31_perception_request',
    project_ref: `halo_fire:${projectName}`,
    application: 'halo_fire',
    source_runtime: 'sam-3.1+llm',
    source_ref: evidence.source_ref || decision.sourceRef || null,
    image_ref: evidence.source_file || decision.sourceFile || pdfRef || evidence.source_ref || decision.sourceRef || null,
    coordinate_frame_ref: 'rendered_pdf_page_pixels_scaled_to_feet_by_pdfScale',
    unit: 'feet',
    llm_model: 'openclaw-local-llm-best-effort',
    prompt: 'Use SAM 3.1 segmentation plus LLM review to identify room boundaries, walls, sleeve or penetration candidates, sprinkler obstruction candidates, vector overlays, and best-effort 3D model candidates from this floorplan evidence.',
    perception_lanes: [...SAM31_PERCEPTION_LANES],
    segments: [segment],
    object_hypotheses: [
      {
        id: 'object:room-boundary',
        segment_id: segment.id,
        semantic_label: 'room_boundary',
        confidence: 0.65,
      },
      {
        id: 'object:wall-candidate',
        segment_id: segment.id,
        semantic_label: 'wall_candidate',
        confidence: 0.55,
      },
      {
        id: 'object:sleeve-or-penetration-candidate',
        segment_id: segment.id,
        semantic_label: 'sleeve_or_penetration_candidate',
        confidence: 0.42,
      },
      {
        id: 'object:sprinkler-obstruction-candidate',
        segment_id: segment.id,
        semantic_label: 'sprinkler_obstruction_candidate',
        confidence: 0.42,
      },
    ],
    requested_outputs: ['segmentation_masks', 'semantic_labels', 'vector_overlays', 'model_3d_candidates', 'spatial_observation_packet'],
    blocked_claims: [...PDF_BOUNDARY_BLOCKED_CLAIMS],
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'SAM 3.1 plus LLM perception is measurement and correction evidence only.',
      'It cannot clear geometry accuracy, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact claims.',
    ],
  };
}

function normalizeOpenClawSam31PerceptionPacket(body = {}) {
  const raw = body.openclaw_sam31_perception_packet || body.perception_packet || body.sam31_perception_packet || null;
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const e = new Error('openclaw_sam31_perception_packet must be an object when provided');
    e.httpStatus = 400;
    throw e;
  }
  const packet = jsonClone(raw);
  packet.artifact_type = 'openclaw.sam31_perception_packet';
  packet.application = packet.application || 'halo_fire';
  packet.source_runtime = packet.source_runtime || 'sam-3.1+llm';
  packet.status = packet.status || 'best_effort_perception_ready';
  packet.segments = Array.isArray(packet.segments) ? packet.segments : [];
  packet.object_hypotheses = Array.isArray(packet.object_hypotheses) ? packet.object_hypotheses : [];
  packet.vector_overlays = Array.isArray(packet.vector_overlays) ? packet.vector_overlays : [];
  packet.model_3d_candidates = Array.isArray(packet.model_3d_candidates) ? packet.model_3d_candidates : [];
  packet.blocked_claims = uniqueStrings([...(packet.blocked_claims || []), ...PDF_BOUNDARY_BLOCKED_CLAIMS]);
  packet.claim_gate_effect = 'no_claims_cleared';
  packet.limitations = [
    ...(Array.isArray(packet.limitations) ? packet.limitations : []),
    'OpenClaw/SAM31+LLM perception is internal-alpha correction evidence only and clears no regulated claim gate.',
  ];
  packet.perception_summary = sam31PerceptionPacketSummary(packet);
  return packet;
}

function sam31PerceptionPacketSummary(packet) {
  if (!packet || typeof packet !== 'object') return null;
  const upstream = packet.perception_summary && typeof packet.perception_summary === 'object' && !Array.isArray(packet.perception_summary)
    ? packet.perception_summary
    : {};
  const blockedClaims = uniqueStrings([
    ...(Array.isArray(upstream.blocked_claims) ? upstream.blocked_claims : []),
    ...(Array.isArray(packet.blocked_claims) ? packet.blocked_claims : []),
    ...PDF_BOUNDARY_BLOCKED_CLAIMS,
  ]);
  return {
    artifact_type: 'openclaw.sam31_perception_summary',
    status: upstream.status || packet.status || 'best_effort_perception_ready',
    project_ref: upstream.project_ref || packet.project_ref || 'halo-fire:unknown',
    application: upstream.application || packet.application || 'halo_fire',
    source_runtime: upstream.source_runtime || packet.source_runtime || 'sam-3.1+llm',
    source_ref: upstream.source_ref || packet.source_ref || null,
    perception_lanes: Array.isArray(upstream.perception_lanes)
      ? upstream.perception_lanes
      : (Array.isArray(packet.perception_lanes) ? packet.perception_lanes : [...SAM31_PERCEPTION_LANES]),
    segment_count: Number.isFinite(Number(upstream.segment_count)) ? Number(upstream.segment_count) : (Array.isArray(packet.segments) ? packet.segments.length : 0),
    object_hypothesis_count: Number.isFinite(Number(upstream.object_hypothesis_count)) ? Number(upstream.object_hypothesis_count) : (Array.isArray(packet.object_hypotheses) ? packet.object_hypotheses.length : 0),
    vector_overlay_count: Number.isFinite(Number(upstream.vector_overlay_count)) ? Number(upstream.vector_overlay_count) : (Array.isArray(packet.vector_overlays) ? packet.vector_overlays.length : 0),
    model_3d_candidate_count: Number.isFinite(Number(upstream.model_3d_candidate_count)) ? Number(upstream.model_3d_candidate_count) : (Array.isArray(packet.model_3d_candidates) ? packet.model_3d_candidates.length : 0),
    spatial_observation_count: Number.isFinite(Number(upstream.spatial_observation_count)) ? Number(upstream.spatial_observation_count) : 0,
    blocked_claims: blockedClaims,
    claim_gate_effect: 'no_claims_cleared',
    extrapolation_contract_ref: upstream.extrapolation_contract_ref || packet.extrapolation_contract?.artifact_type || null,
    application_contract_refs: Array.isArray(upstream.application_contract_refs)
      ? upstream.application_contract_refs
      : Object.values(packet.application_contracts || {})
        .map((contract) => contract && typeof contract === 'object' ? contract.contract_ref : null)
        .filter(Boolean),
    extrapolation_contract: packet.extrapolation_contract && typeof packet.extrapolation_contract === 'object'
      ? jsonClone(packet.extrapolation_contract)
      : (upstream.extrapolation_contract && typeof upstream.extrapolation_contract === 'object' ? jsonClone(upstream.extrapolation_contract) : null),
    application_contracts: packet.application_contracts && typeof packet.application_contracts === 'object' && !Array.isArray(packet.application_contracts)
      ? jsonClone(packet.application_contracts)
      : (upstream.application_contracts && typeof upstream.application_contracts === 'object' && !Array.isArray(upstream.application_contracts) ? jsonClone(upstream.application_contracts) : null),
    next_action: upstream.next_action || 'Use this summary to queue HaloFire room-boundary replay; do not promote blocked claims.',
    limitations: [
      'Summary of best-effort OpenClaw/SAM31+LLM perception evidence; it clears no regulated gate.',
    ],
  };
}

function normalizePdfBoundaryDecision(projectName, body = {}) {
  const scale = Number(body.pdfScale);
  if (!Number.isFinite(scale) || scale <= 0) {
    const e = new Error('A positive operator-supplied pdfScale is required');
    e.httpStatus = 400;
    throw e;
  }
  const pageIndex = Number.isFinite(Number(body.pdfPageIndex)) ? Math.max(0, Math.trunc(Number(body.pdfPageIndex))) : 0;
  const candidate = body.candidate && typeof body.candidate === 'object' ? jsonClone(body.candidate) : null;
  if (!candidate) {
    const e = new Error('candidate is required');
    e.httpStatus = 400;
    throw e;
  }
  const extractMode = String(body.pdfExtract || candidate.mode || '').trim();
  if (!extractMode) {
    const e = new Error('pdfExtract or candidate.mode is required');
    e.httpStatus = 400;
    throw e;
  }
  const blockedClaims = [...new Set([
    ...PDF_BOUNDARY_BLOCKED_CLAIMS,
    ...(Array.isArray(candidate.blockedClaims) ? candidate.blockedClaims : []),
  ])];
  candidate.blockedClaims = blockedClaims;
  return {
    projectName,
    pageIndex,
    scale,
    extractMode,
    candidate,
    sourceFile: body.source_file || body.sourceFile || null,
    sourceRef: body.source_ref || body.sourceRef || `pdf-boundary:${projectName}:page-${pageIndex}:${extractMode}`,
    employeeNotes: body.notes || null,
    blockedClaims,
    limitation: 'Employee boundary selection is best-effort correction evidence only; regulated claims still blocked until real AHJ/PE/AutoSprink/manufacturer evidence is attached.',
  };
}

function decisionFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'pdf_boundary_decision' ? parsed.decision : null;
  } catch {
    return null;
  }
}

function latestPdfBoundaryDecisionEvidence(projectName) {
  return db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'pdf_boundary_decision'
              ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(projectName);
}

function reviewFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'room_boundary_review_packet_decision' ? parsed.review : null;
  } catch {
    return null;
  }
}

function latestPdfBoundaryReviewEvidence(projectName, sourceEvidenceId) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'room_boundary_review_packet'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  for (const row of rows) {
    const review = reviewFromEvidence(row);
    if (review && Number(review.source_evidence_id) === Number(sourceEvidenceId)) {
      return { evidence: row, review };
    }
  }
  return null;
}

function sam31VisualAuditResultFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'sam31_room_boundary_visual_audit_result' ? parsed.result : null;
  } catch {
    return null;
  }
}

function latestSam31VisualAuditEvidence(projectName, sourceEvidenceId) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'sam31_room_boundary_visual_audit'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  for (const row of rows) {
    const result = sam31VisualAuditResultFromEvidence(row);
    if (result && Number(result.source_evidence_id) === Number(sourceEvidenceId)) {
      return { evidence: row, result };
    }
  }
  return null;
}

app.get('/api/projects/:name/pdf-boundary-decision', authMiddleware, (req, res) => {
  const evidence = latestPdfBoundaryDecisionEvidence(req.params.name);
  res.json({ evidence: evidence || null, decision: decisionFromEvidence(evidence) });
});

app.post('/api/projects/:name/pdf-boundary-decision', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const decision = normalizePdfBoundaryDecision(projectName, req.body);
    const packet = {
      kind: 'pdf_boundary_decision',
      recordedBy: req.user.username,
      recordedAt: new Date().toISOString(),
      decision,
      status: 'best_effort',
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'pdf_boundary_decision',
        decision.sourceFile,
        decision.sourceRef,
        'best_effort',
        JSON.stringify(packet),
      );
    const evidence = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      id: result.lastInsertRowid,
      message: 'PDF boundary decision recorded as best-effort evidence; claims still blocked',
      evidence,
      decision,
    });
  } catch (err) {
    res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

function pdfBoundaryResolverQueueItem(projectName, evidence, decision, reviewEvidence = null, sam31Evidence = null) {
  if (!evidence || !decision) return null;
  const candidate = decision.candidate || {};
  const latestReview = reviewEvidence && reviewEvidence.review ? {
    evidence_id: reviewEvidence.evidence.id,
    evidence_status: reviewEvidence.evidence.status,
    source_ref: reviewEvidence.evidence.source_ref,
    review_decision: reviewEvidence.review.review_decision,
    reviewer_name: reviewEvidence.review.reviewer_name,
    reviewed_at: reviewEvidence.review.reviewed_at,
    marked_up_plan_ref: reviewEvidence.review.marked_up_plan_ref,
    issue_count: Array.isArray(reviewEvidence.review.issue_list) ? reviewEvidence.review.issue_list.length : 0,
    corrected_room_polygon_count: Array.isArray(reviewEvidence.review.corrected_room_polygons) ? reviewEvidence.review.corrected_room_polygons.length : 0,
    claim_gate_effect: reviewEvidence.review.claim_gate_effect || 'no_claims_cleared',
  } : null;
  const latestSam31VisualAudit = sam31Evidence && sam31Evidence.result ? {
    evidence_id: sam31Evidence.evidence.id,
    evidence_status: sam31Evidence.evidence.status,
    source_ref: sam31Evidence.evidence.source_ref,
    review_decision: sam31Evidence.result.review_decision,
    reviewer_name: sam31Evidence.result.reviewer_name,
    reviewed_at: sam31Evidence.result.reviewed_at,
    sam31_result_ref: sam31Evidence.result.sam31_result_ref,
    screenshot_ref: sam31Evidence.result.screenshot_ref,
    console_log_ref: sam31Evidence.result.console_log_ref,
    marked_up_plan_ref: sam31Evidence.result.marked_up_plan_ref,
    issue_count: Array.isArray(sam31Evidence.result.issue_list) ? sam31Evidence.result.issue_list.length : 0,
    corrected_room_polygon_count: Array.isArray(sam31Evidence.result.corrected_room_polygons) ? sam31Evidence.result.corrected_room_polygons.length : 0,
    openclaw_sam31_perception_packet: sam31PerceptionPacketSummary(sam31Evidence.result.openclaw_sam31_perception_packet),
    claim_gate_effect: sam31Evidence.result.claim_gate_effect || 'no_claims_cleared',
  } : null;
  let status = 'ready';
  let nextAction = 'Open the selected PDF sheet with these defaults, run a room-boundary visual audit packet, and attach employee review evidence before any geometry-accuracy claim.';
  if (latestReview?.review_decision === 'corrected') {
    status = 'correction_ready';
    nextAction = 'Replay the best-effort layout with the corrected room polygons from the latest employee review packet; regulated claims remain blocked.';
  } else if (latestReview?.review_decision === 'accepted') {
    status = 'reviewed';
    nextAction = 'Use the accepted employee-reviewed boundary for internal-alpha replay; attach licensed/AHJ/AutoSprink/manufacturer evidence before any regulated claim.';
  } else if (latestReview?.review_decision === 'rejected') {
    status = 'blocked';
    nextAction = 'The latest employee review rejected this boundary. Save a new boundary decision or corrected review packet before replay.';
  } else if (latestSam31VisualAudit?.review_decision === 'corrected') {
    status = 'sam31_correction_ready';
    nextAction = 'Replay the best-effort layout with the corrected room polygons from the latest SAM 3.1 visual audit result; regulated claims remain blocked.';
  } else if (latestSam31VisualAudit?.review_decision === 'accepted') {
    status = 'sam31_reviewed';
    nextAction = 'Use the accepted SAM 3.1 visual audit result for internal-alpha replay; attach licensed/AHJ/AutoSprink/manufacturer evidence before any regulated claim.';
  } else if (latestSam31VisualAudit?.review_decision === 'rejected') {
    status = 'blocked';
    nextAction = 'The latest SAM 3.1 visual audit rejected this boundary. Save a new boundary decision, SAM result, or corrected review packet before replay.';
  }
  return {
    id: `resolver:pdf-boundary:${evidence.id}`,
    project_name: projectName,
    kind: 'room_boundary_visual_audit',
    title: 'Room-boundary visual audit from saved PDF boundary decision',
    status,
    evidence_id: evidence.id,
    source_evidence_type: 'pdf_boundary_decision',
    source_ref: evidence.source_ref || decision.sourceRef || null,
    next_action: nextAction,
    acceptable_evidence: [
      'employee room-boundary review packet',
      'OpenClaw SAM31+LLM perception packet',
      'source-linked marked-up plan screenshot',
      'room polygon correction list',
      'licensed professional review/signoff for regulated claims',
    ],
    ai_fallback: 'If manual room boundaries are not yet supplied, run best-effort SAM+LLM/OpenClaw room-boundary review using the saved sheet, scale, and extraction mode; label results as correction evidence only.',
    input_defaults: {
      pdfPageIndex: decision.pageIndex,
      pdfScale: decision.scale,
      pdfExtract: decision.extractMode,
      candidate,
    },
    blocked_claims: Array.isArray(decision.blockedClaims) ? decision.blockedClaims : [...PDF_BOUNDARY_BLOCKED_CLAIMS],
    latest_review: latestReview,
    latest_sam31_visual_audit: latestSam31VisualAudit,
    limitations: [
      decision.limitation || 'Saved boundary choice is best-effort evidence only.',
      'This queue item does not prove geometry accuracy, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact models.',
    ],
    actions: [
      { label: 'Load defaults in Studio', href: `/autosprink.html?project=${encodeURIComponent(projectName)}&resolver=${encodeURIComponent(`pdf-boundary:${evidence.id}`)}` },
      { label: 'Download SAM 3.1 visual audit packet', href: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/sam31-visual-audit` },
      { label: 'View source evidence', href: `/workbench.html?project=${encodeURIComponent(projectName)}#evidence-${evidence.id}` },
    ],
  };
}

function safeParseJsonObject(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function currentSourceAcquisitionLedger() {
  try {
    if (fs.existsSync(AUTO_SOURCE_STATUS_PATH)) {
      const status = JSON.parse(fs.readFileSync(AUTO_SOURCE_STATUS_PATH, 'utf8'));
      if (Array.isArray(status.sourceAcquisitionLedger)) return status.sourceAcquisitionLedger;
    }
  } catch (err) {
    log.warn(`auto-source status read failed for resolver queue: ${err.message}`);
  }
  return buildSourceAcquisitionLedger({}, new Date(0).toISOString());
}

function matchingCatalogEvidenceByFamily(projectName) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'catalog_source_acquisition'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  const byFamily = new Map();
  for (const row of rows) {
    const notes = safeParseJsonObject(row.notes) || {};
    const familyRef = notes.family_ref || row.source_ref || row.source_file;
    if (familyRef && !byFamily.has(String(familyRef))) {
      byFamily.set(String(familyRef), { evidence: row, notes });
    }
  }
  return byFamily;
}

function catalogResolverQueueItem(projectName, row, matchedEvidence = null) {
  if (!row || !row.family_ref) return null;
  const hasCandidate = !!(row.source_url || row.downloaded_artifact_hash);
  const hasEvidence = !!matchedEvidence;
  const status = hasEvidence
    ? 'catalog_evidence_recorded'
    : (hasCandidate ? 'catalog_review_needed' : 'catalog_source_needed');
  const nextAction = hasEvidence
    ? 'Review the recorded catalog_source_acquisition evidence row, then attach real manufacturer/AHJ/PE/AutoSprink approval evidence through the proper gate resolver before clearing any regulated claim.'
    : (hasCandidate
      ? 'Review the candidate vendor/catalog source, verify license and downloaded artifact hash, then record catalog_source_acquisition evidence in Settings; no claim gates clear.'
      : 'Acquire a manufacturer or vendor catalog/STEP/BIM source for this family, record license/hash/source URL in Settings, and keep all regulated claims blocked.');
  const componentKey = row.component_key || null;
  const catalogUrl = row.source_url || '';
  const settingsParams = new URLSearchParams();
  if (componentKey) settingsParams.set('component', componentKey);
  if (catalogUrl) settingsParams.set('catalogUrl', catalogUrl);
  return {
    id: `resolver:catalog-source:${row.family_ref}`,
    project_name: projectName,
    kind: 'catalog_vendor_acquisition',
    title: `Catalog/vendor source acquisition for ${row.family_ref}`,
    status,
    evidence_id: matchedEvidence?.evidence?.id || null,
    source_evidence_type: 'catalog_source_acquisition',
    source_ref: row.source_url || row.family_ref,
    next_action: nextAction,
    acceptable_evidence: [
      'manufacturer catalog page or vendor product page URL',
      'license or terms for downloaded CAD/BIM/STEP artifact',
      'downloaded artifact hash tied to the exact component family',
      'HaloFire employee review note for internal-alpha use',
      'manufacturer/professional approval before manufacturer-exact or fabrication claims',
    ],
    ai_fallback:
      'Use OpenClaw web search, vendor catalog search, and step.parts-style acquisition to find candidates; AI may rank/reject candidates but cannot clear manufacturer/AHJ/PE/AutoSprink claims.',
    input_defaults: {
      family_ref: row.family_ref,
      component_key: componentKey,
      nominal_size_in: row.nominal_size_in ?? null,
      source_url: row.source_url || null,
      license: row.license || null,
      downloaded_artifact_hash: row.downloaded_artifact_hash || null,
      status_tier: row.status_tier || 'missing_catalog_source',
      rejected_candidates: Array.isArray(row.rejected_candidates) ? row.rejected_candidates : [],
    },
    blocked_claims: Array.isArray(row.blocked_claims) ? row.blocked_claims : [],
    claim_gate_effect: row.claim_gate_effect || 'no_claims_cleared',
    latest_review: matchedEvidence ? {
      evidence_id: matchedEvidence.evidence.id,
      evidence_status: matchedEvidence.evidence.status,
      source_ref: matchedEvidence.evidence.source_ref,
      claim_gate_effect: matchedEvidence.notes.claim_gate_effect || 'no_claims_cleared',
    } : null,
    limitations: [
      row.limitations || 'Catalog/source acquisition rows are evidence collection work items only.',
      'This queue item does not prove manufacturer-exact geometry, AHJ approval, PE review, AutoSprink parity, permit readiness, or fabrication readiness.',
    ],
    actions: [
      { label: hasEvidence ? 'Review recorded evidence' : 'Record source evidence in Settings', href: `/settings.html?${settingsParams.toString()}#settingsCatalogSourceAcquisition` },
      { label: 'Open evidence workbench', href: `/workbench.html?project=${encodeURIComponent(projectName)}#catalogSourceAcquisition` },
    ],
  };
}

const OFFICIAL_FLOW_BLOCKED_CLAIMS = [
  'permit_ready',
  'AHJ_approval',
  'PE_review',
  'AutoSprink_parity',
  'engineering_grade',
  'fabrication_ready',
];

function officialFlowFactsForProject(projectName) {
  if (projectName === HOME_DEPOT_PROJECT_NAME) {
    try {
      const pkg = readHomeDepotBidPackage();
      const water = pkg.water || {};
      const hasDocumentedValues =
        Number(water.staticPsi) > 0 &&
        Number(water.residualPsi) > 0 &&
        Number(water.flowingGpm) > 0;
      return {
        project: pkg.project,
        sourceStatus: hasDocumentedValues ? 'documented_bid_package_values' : 'missing_official_flow_values',
        staticPsi: Number(water.staticPsi) || null,
        residualPsi: Number(water.residualPsi) || null,
        flowingGpm: Number(water.flowingGpm) || null,
        flowDataDate: water.flowDataDate || null,
        waterModelRequired: water.waterModelRequired || null,
        projectHeadCount: Number(pkg.headCount) || null,
        projectSqft: Number(pkg.sqft) || null,
        sourceRefs: Array.isArray(pkg.sourceRefs) ? pkg.sourceRefs : [],
      };
    } catch (err) {
      log.warn(`official-flow Home Depot reader failed: ${err.message}`);
    }
  }
  if (projectName === COOPERATIVE_1881_PROJECT_NAME) {
    try {
      const pkg = readCooperative1881BidPackage();
      return {
        project: pkg.project,
        sourceStatus: 'missing_official_flow_values',
        staticPsi: null,
        residualPsi: null,
        flowingGpm: null,
        flowDataDate: null,
        waterModelRequired: null,
        projectHeadCount: Number(pkg.headCount) || null,
        projectSqft: Number(pkg.sqft) || null,
        sourceRefs: Array.isArray(pkg.sourceRefs) ? pkg.sourceRefs : [],
      };
    } catch (err) {
      log.warn(`official-flow Cooperative 1881 reader failed: ${err.message}`);
    }
  }
  return {
    project: projectName,
    sourceStatus: 'missing_official_flow_values',
    staticPsi: null,
    residualPsi: null,
    flowingGpm: null,
    flowDataDate: null,
    waterModelRequired: null,
    projectHeadCount: null,
    projectSqft: null,
    sourceRefs: [],
  };
}

function officialFlowIntakeFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'official_flow_intake_record' ? parsed.intake : null;
  } catch {
    return null;
  }
}

function latestOfficialFlowIntakeEvidence(projectName) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'official_flow_intake'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  for (const row of rows) {
    const intake = officialFlowIntakeFromEvidence(row);
    if (intake) return { evidence: row, intake };
  }
  return null;
}

function normalizeOfficialFlowIntake(projectName, body = {}, user = {}) {
  const staticPsi = Number(body.staticPsi ?? body.static_psi);
  const residualPsi = Number(body.residualPsi ?? body.residual_psi);
  const flowingGpm = Number(body.flowingGpm ?? body.flowing_gpm);
  for (const [field, value] of [
    ['staticPsi', staticPsi],
    ['residualPsi', residualPsi],
    ['flowingGpm', flowingGpm],
  ]) {
    if (!Number.isFinite(value) || value <= 0) {
      const e = new Error(`${field} must be a positive number`);
      e.httpStatus = 400;
      throw e;
    }
  }
  if (residualPsi > staticPsi) {
    const e = new Error('residualPsi must be less than or equal to staticPsi');
    e.httpStatus = 400;
    throw e;
  }
  const sourceRef = String(body.source_ref || body.sourceRef || '').trim();
  if (!sourceRef) {
    const e = new Error('source_ref is required for official-flow intake evidence');
    e.httpStatus = 400;
    throw e;
  }
  const sourceFile = String(body.source_file || body.sourceFile || '').trim() || null;
  const reviewerName = String(body.reviewer_name || body.reviewerName || user.username || '').trim() || null;
  return {
    kind: 'official_flow_intake_record',
    project_name: projectName,
    staticPsi,
    residualPsi,
    flowingGpm,
    flowDataDate: body.flowDataDate || body.flow_data_date || null,
    waterModelRequired: body.waterModelRequired || body.water_model_required || null,
    source_file: sourceFile,
    source_ref: sourceRef,
    reviewer_name: reviewerName,
    recorded_at: body.recorded_at || body.recordedAt || new Date().toISOString(),
    notes: body.notes || null,
    source_status: 'employee_recorded_official_flow_intake',
    acceptable_evidence: [
      'official flow test report or water supply data sheet',
      'source-linked municipal or utility water supply record',
      'licensed professional hydraulic calculation review',
      'AHJ-reviewed hydraulic calculation package',
      'AutoSprink or equivalent professional hydraulic model export for parity review',
    ],
    blocked_claims: [...OFFICIAL_FLOW_BLOCKED_CLAIMS],
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'Employee-recorded flow values are preliminary intake evidence until official/professional review is attached.',
      'This intake can seed hydraulic replay and issue lists, but it does not prove permit readiness, AHJ approval, PE review, engineering-grade results, AutoSprink parity, fabrication readiness, or manufacturer-exact models.',
    ],
  };
}

function buildOfficialFlowHydraulicReplayArtifact(projectName, evidence, intake, user = {}) {
  const pipelineReq = {
    params: { name: projectName },
    body: { markupPct: 25 },
    user: { ...user, role: 'user' },
  };
  const out = runSprinklerPipeline(pipelineReq, null);
  if (out.httpError) {
    const e = new Error(out.httpError.error || 'Unable to run preliminary hydraulic replay');
    e.httpStatus = out.httpError.status || 400;
    throw e;
  }
  const hazard = out.bid?.rooms?.[0]?.hazard || 'ordinary';
  const demand = out.hydraulicNetwork?.totalDemandGpm
    ?? out.hydraulics?.requiredFlowGpm
    ?? remoteAreaDemand(hazard).requiredFlowGpm;
  const requiredSourcePsi = out.hydraulicNetwork?.requiredSourcePsi
    ?? out.hydraulics?.requiredPressurePsi
    ?? null;
  const residualPsi = Number(intake.residualPsi);
  const flowingGpm = Number(intake.flowingGpm);
  const issueList = [
    {
      code: 'PROFESSIONAL_HYDRAULIC_REVIEW_MISSING',
      severity: 'blocking',
      source_ref: intake.source_ref,
      observed: 'Only internal-alpha preliminary hydraulic replay evidence is present.',
      expected: 'Licensed professional hydraulic calculation review/signoff.',
      required_action: 'Attach PE/professional hydraulic review before any engineering-grade, permit-ready, or AHJ-ready claim.',
    },
    {
      code: 'AHJ_HYDRAULIC_APPROVAL_MISSING',
      severity: 'blocking',
      source_ref: intake.source_ref,
      observed: 'No AHJ-reviewed hydraulic calculation package is attached.',
      expected: 'AHJ-reviewed hydraulic calculation package or official approval record.',
      required_action: 'Attach AHJ review/approval evidence before any AHJ-ready or permit-ready claim.',
    },
  ];
  if (typeof requiredSourcePsi === 'number') {
    issueList.push({
      code: residualPsi >= requiredSourcePsi ? 'PRELIMINARY_SOURCE_PRESSURE_MARGIN' : 'PRELIMINARY_SOURCE_PRESSURE_SHORTFALL',
      severity: residualPsi >= requiredSourcePsi ? 'warning' : 'blocking',
      source_ref: intake.source_ref,
      observed: `${round2(residualPsi)} psi residual vs ${round2(requiredSourcePsi)} psi preliminary required source pressure`,
      expected: 'Positive pressure margin verified by professional hydraulic calculation.',
      required_action: 'Use this only as a replay issue until professional hydraulic review confirms or corrects the model.',
    });
  }
  if (typeof demand === 'number') {
    issueList.push({
      code: flowingGpm >= demand ? 'PRELIMINARY_FLOW_GPM_MARGIN' : 'PRELIMINARY_FLOW_GPM_SHORTFALL',
      severity: flowingGpm >= demand ? 'warning' : 'blocking',
      source_ref: intake.source_ref,
      observed: `${round2(flowingGpm)} gpm available vs ${round2(demand)} gpm preliminary demand`,
      expected: 'Flow margin verified by official flow test and professional hydraulic calculation.',
      required_action: 'Use this only as a replay issue until official/professional evidence confirms or corrects the values.',
    });
  }
  return {
    artifact_type: 'official_flow_hydraulic_replay_artifact',
    status: 'best_effort_internal_alpha',
    project_name: projectName,
    source_evidence_id: evidence.id,
    source_evidence_type: evidence.evidence_type,
    generated_at: new Date().toISOString(),
    download_name: `${slugForDownloadName(projectName)}-official-flow-hydraulic-replay-${evidence.id}.json`,
    official_flow_input: {
      staticPsi: intake.staticPsi,
      residualPsi: intake.residualPsi,
      flowingGpm: intake.flowingGpm,
      flowDataDate: intake.flowDataDate || null,
      waterModelRequired: intake.waterModelRequired || null,
      source_file: intake.source_file || evidence.source_file || null,
      source_ref: intake.source_ref || evidence.source_ref || null,
      reviewer_name: intake.reviewer_name || null,
    },
    hydraulic_summary: {
      estimate: true,
      sourcePsiBasis: 'residualPsi',
      sourcePsi: residualPsi,
      requiredSourcePsi,
      sourceMarginPsi: typeof requiredSourcePsi === 'number' ? round2(residualPsi - requiredSourcePsi) : null,
      totalDemandGpm: typeof demand === 'number' ? round2(demand) : null,
      flowMarginGpm: typeof demand === 'number' ? round2(flowingGpm - demand) : null,
      hazard,
      singlePath: out.hydraulics || null,
      network: out.hydraulicNetwork || null,
      disclaimer: 'best-effort official-flow hydraulic replay artifact — NOT PE-reviewed, NOT AHJ-approved, NOT AutoSprink parity, and NOT permit-ready.',
    },
    bid_summary: {
      total_area_sqft: out.bid?.totalAreaSqFt ?? null,
      total_head_count: out.bid?.totalHeadCount ?? null,
      pricing_total: out.bid?.pricing?.total ?? null,
      markup_pct: out.bid?.pricing?.markupPct ?? null,
    },
    issue_list: issueList,
    blocked_claims: [...OFFICIAL_FLOW_BLOCKED_CLAIMS],
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'This artifact is generated from recorded official-flow intake and the internal-alpha hydraulic replay model.',
      'It creates review issues and questions only; it does not clear permit-ready, AHJ approval, PE review, engineering-grade, fabrication-ready, manufacturer-exact, or AutoSprink parity claims.',
    ],
  };
}

function officialFlowReplayArtifactEvidenceNotes(artifact) {
  return {
    kind: 'official_flow_hydraulic_replay_artifact',
    artifact_type: artifact.artifact_type,
    artifact_status: artifact.status,
    source_evidence_id: artifact.source_evidence_id,
    replay_generated_at: artifact.generated_at,
    download_name: artifact.download_name,
    official_flow_input: artifact.official_flow_input,
    hydraulic_summary: artifact.hydraulic_summary,
    bid_summary: artifact.bid_summary,
    issue_count: Array.isArray(artifact.issue_list) ? artifact.issue_list.length : 0,
    issue_codes: Array.isArray(artifact.issue_list) ? artifact.issue_list.map((issue) => issue.code).filter(Boolean) : [],
    blocked_claims: Array.isArray(artifact.blocked_claims) ? artifact.blocked_claims : [],
    claim_gate_effect: artifact.claim_gate_effect || 'no_claims_cleared',
    limitations: Array.isArray(artifact.limitations) ? artifact.limitations : [],
    artifact,
  };
}

function officialFlowReplayArtifactFromEvidence(row) {
  if (!row || row.evidence_type !== 'official_flow_hydraulic_replay_artifact') return null;
  const notes = safeParseJsonObject(row.notes);
  if (!notes || notes.kind !== 'official_flow_hydraulic_replay_artifact') return null;
  const artifact = notes.artifact && typeof notes.artifact === 'object' ? notes.artifact : {
    artifact_type: notes.artifact_type || 'official_flow_hydraulic_replay_artifact',
    status: notes.artifact_status || 'best_effort_internal_alpha',
    source_evidence_id: notes.source_evidence_id,
    official_flow_input: notes.official_flow_input || null,
    hydraulic_summary: notes.hydraulic_summary || null,
    bid_summary: notes.bid_summary || null,
    issue_list: [],
    blocked_claims: notes.blocked_claims || [],
    claim_gate_effect: notes.claim_gate_effect || 'no_claims_cleared',
    limitations: notes.limitations || [],
  };
  return { evidence: row, notes, artifact };
}

function officialFlowReplayArtifactEvidenceRows(projectName) {
  return db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'official_flow_hydraulic_replay_artifact'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName)
    .map(officialFlowReplayArtifactFromEvidence)
    .filter(Boolean);
}

function officialFlowReplayIssueAction(issue = {}, fallbackSourceRef = null) {
  const code = issue.code || issue.issue_type || 'OFFICIAL_FLOW_REPLAY_REVIEW_NEEDED';
  const professionalClaims = ['permit_ready', 'PE_review', 'engineering_grade'];
  const ahjClaims = ['permit_ready', 'AHJ_approval'];
  const preliminaryClaims = ['permit_ready', 'PE_review', 'engineering_grade', 'AutoSprink_parity'];
  if (code === 'PROFESSIONAL_HYDRAULIC_REVIEW_MISSING') {
    return {
      code,
      severity: issue.severity || 'blocking',
      evidence_lane: 'licensed_professional_hydraulic_review',
      next_action: 'Attach licensed professional hydraulic calculation review/signoff before any engineering-grade, permit-ready, or PE-reviewed claim.',
      acceptable_evidence: ['licensed professional hydraulic calculation review', 'sealed hydraulic calculation package', 'professional correction note tied to this replay artifact'],
      blocked_claims: professionalClaims,
      source_ref: issue.source_ref || fallbackSourceRef,
      observed: issue.observed || null,
      expected: issue.expected || null,
    };
  }
  if (code === 'AHJ_HYDRAULIC_APPROVAL_MISSING') {
    return {
      code,
      severity: issue.severity || 'blocking',
      evidence_lane: 'AHJ_reviewed_hydraulic_calculation_package',
      next_action: 'Attach AHJ-reviewed hydraulic calculation package or official approval record before any AHJ-ready or permit-ready claim.',
      acceptable_evidence: ['AHJ-reviewed hydraulic calculation package', 'AHJ approval record', 'official permit-review comment clearing the hydraulic calculation'],
      blocked_claims: ahjClaims,
      source_ref: issue.source_ref || fallbackSourceRef,
      observed: issue.observed || null,
      expected: issue.expected || null,
    };
  }
  const isFlow = /FLOW_GPM/i.test(code);
  return {
    code,
    severity: issue.severity || (/SHORTFALL/i.test(code) ? 'blocking' : 'warning'),
    evidence_lane: isFlow ? 'preliminary_flow_margin_review' : 'preliminary_pressure_margin_review',
    next_action: issue.required_action || 'Review this preliminary margin with official flow/professional hydraulic evidence; do not clear regulated claims from this artifact alone.',
    acceptable_evidence: isFlow
      ? ['official flow test report', 'professional hydraulic demand review', 'AutoSprink/equivalent model export for parity review']
      : ['professional hydraulic pressure calculation review', 'official water supply data sheet', 'AutoSprink/equivalent model export for parity review'],
    blocked_claims: preliminaryClaims,
    source_ref: issue.source_ref || fallbackSourceRef,
    observed: issue.observed || null,
    expected: issue.expected || null,
  };
}

function officialFlowReplayReviewQueueItem(projectName, replayEvidence) {
  if (!replayEvidence?.evidence || !replayEvidence.artifact) return null;
  const artifact = replayEvidence.artifact;
  const issueList = Array.isArray(artifact.issue_list) ? artifact.issue_list : [];
  const sourceRef = artifact.official_flow_input?.source_ref || replayEvidence.evidence.source_ref || null;
  const issueActions = issueList.map((issue) => officialFlowReplayIssueAction(issue, sourceRef));
  return {
    id: `resolver:official-flow-replay-review:${replayEvidence.evidence.id}`,
    project_name: projectName,
    kind: 'official_flow_hydraulic_replay_review',
    title: 'Official-flow hydraulic replay issue actions',
    status: 'official_flow_replay_review_needed',
    evidence_id: replayEvidence.evidence.id,
    source_evidence_type: 'official_flow_hydraulic_replay_artifact',
    source_ref: replayEvidence.evidence.source_ref || sourceRef,
    next_action: 'Resolve the replay issue actions with professional hydraulic review, AHJ review, and official flow/model evidence before any regulated claim.',
    acceptable_evidence: [
      'licensed professional hydraulic calculation review',
      'AHJ-reviewed hydraulic calculation package',
      'official flow test report or water supply data sheet',
      'AutoSprink or equivalent professional hydraulic model export for parity review',
    ],
    ai_fallback:
      'AI may summarize preliminary pressure/flow margin issues and assemble review packets, but it cannot clear PE, AHJ, permit-ready, engineering-grade, fabrication-ready, or AutoSprink parity claims.',
    input_defaults: {
      source_evidence_id: artifact.source_evidence_id || replayEvidence.notes.source_evidence_id || null,
      issue_count: issueList.length,
      issue_codes: issueActions.map((issue) => issue.code),
      requiredSourcePsi: artifact.hydraulic_summary?.requiredSourcePsi ?? null,
      sourceMarginPsi: artifact.hydraulic_summary?.sourceMarginPsi ?? null,
      totalDemandGpm: artifact.hydraulic_summary?.totalDemandGpm ?? null,
      flowMarginGpm: artifact.hydraulic_summary?.flowMarginGpm ?? null,
      source_ref: sourceRef,
    },
    issue_actions: issueActions,
    blocked_claims: Array.isArray(artifact.blocked_claims) ? artifact.blocked_claims : [...OFFICIAL_FLOW_BLOCKED_CLAIMS],
    claim_gate_effect: artifact.claim_gate_effect || replayEvidence.notes.claim_gate_effect || 'no_claims_cleared',
    latest_review: {
      evidence_id: replayEvidence.evidence.id,
      evidence_status: replayEvidence.evidence.status,
      source_ref: replayEvidence.evidence.source_ref,
      issue_count: issueList.length,
      claim_gate_effect: artifact.claim_gate_effect || 'no_claims_cleared',
    },
    limitations: [
      'This resolver item is generated from a best-effort internal-alpha replay artifact.',
      'It creates review actions only; it does not clear permit-ready, AHJ approval, PE review, engineering-grade, fabrication-ready, manufacturer-exact, or AutoSprink parity claims.',
    ],
    actions: [
      { label: 'Download saved replay artifact', href: `/api/projects/${encodeURIComponent(projectName)}/evidence/${replayEvidence.evidence.id}/official-flow-hydraulic-replay-artifact` },
      { label: 'Download professional/AHJ review packet', href: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow-replay/${replayEvidence.evidence.id}/review-packet` },
      { label: 'Open evidence workbench', href: `/workbench.html?project=${encodeURIComponent(projectName)}#official-flow-replay-review` },
    ],
  };
}

function officialFlowProfessionalAhjReviewPacket(projectName, replayEvidence) {
  const queueItem = officialFlowReplayReviewQueueItem(projectName, replayEvidence);
  if (!queueItem) return null;
  const artifact = replayEvidence.artifact || {};
  const row = replayEvidence.evidence;
  const originalSourceEvidenceId = artifact.source_evidence_id || replayEvidence.notes?.source_evidence_id || null;
  const sourceRefs = [
    {
      evidence_id: row.id,
      evidence_type: row.evidence_type,
      source_ref: row.source_ref || queueItem.source_ref || null,
      status: row.status || null,
    },
  ];
  if (originalSourceEvidenceId) {
    sourceRefs.push({
      evidence_id: originalSourceEvidenceId,
      evidence_type: artifact.source_evidence_type || 'official_flow_intake',
      source_ref: artifact.official_flow_input?.source_ref || queueItem.input_defaults?.source_ref || null,
      status: 'referenced',
    });
  }
  return {
    artifact_type: 'official_flow_professional_ahj_review_packet',
    status: 'ready_for_employee_review',
    project_name: projectName,
    source_evidence_id: row.id,
    source_evidence_type: 'official_flow_hydraulic_replay_artifact',
    source_ref: row.source_ref || queueItem.source_ref || null,
    generated_at: new Date().toISOString(),
    download_name: `${slugForDownloadName(projectName)}-official-flow-professional-ahj-review-packet-${row.id}.json`,
    claim_gate_effect: 'no_claims_cleared',
    source_refs: sourceRefs,
    official_flow_input: artifact.official_flow_input || null,
    hydraulic_summary: artifact.hydraulic_summary || null,
    bid_summary: artifact.bid_summary || null,
    issue_actions: queueItem.issue_actions,
    acceptable_evidence: queueItem.acceptable_evidence,
    employee_decision_fields: [
      'reviewer_name',
      'professional_review_ref',
      'ahj_review_ref',
      'autosprink_export_ref',
      'official_flow_test_ref',
      'review_decision',
      'notes',
    ],
    evidence_attachment_fields: [
      {
        field: 'professional_review_ref',
        acceptable_evidence_type: 'licensed_professional_hydraulic_review',
        blocked_claims_relieved_only_after_employee_verification: ['PE_review', 'engineering_grade'],
      },
      {
        field: 'ahj_review_ref',
        acceptable_evidence_type: 'AHJ_reviewed_hydraulic_calculation_package',
        blocked_claims_relieved_only_after_employee_verification: ['AHJ_approval', 'permit_ready'],
      },
      {
        field: 'autosprink_export_ref',
        acceptable_evidence_type: 'AutoSprink_or_equivalent_professional_model_export',
        blocked_claims_relieved_only_after_employee_verification: ['AutoSprink_parity'],
      },
      {
        field: 'official_flow_test_ref',
        acceptable_evidence_type: 'official_flow_test_report_or_water_supply_data_sheet',
        blocked_claims_relieved_only_after_employee_verification: ['permit_ready'],
      },
    ],
    review_steps: [
      'Review the saved official-flow hydraulic replay artifact and issue actions.',
      'Attach professional hydraulic review, AHJ review, official flow, and AutoSprink/equivalent model evidence where available.',
      'Record employee decision fields before any downstream claim-gate resolver evaluates whether claims may be unblocked.',
    ],
    blocked_claims: queueItem.blocked_claims,
    limitations: [
      'This packet organizes best-effort official-flow replay evidence for employee/professional/AHJ review.',
      'It does not clear permit-ready, AHJ approval, PE review, engineering-grade, fabrication-ready, manufacturer-exact, or AutoSprink parity claims by itself.',
    ],
  };
}

function officialFlowResolverQueueItem(projectName, matchedEvidence = null) {
  const intake = matchedEvidence?.intake || null;
  const facts = intake ? {
    project: projectName,
    sourceStatus: 'employee_recorded_official_flow_intake',
    staticPsi: intake.staticPsi,
    residualPsi: intake.residualPsi,
    flowingGpm: intake.flowingGpm,
    flowDataDate: intake.flowDataDate || null,
    waterModelRequired: intake.waterModelRequired || null,
    projectHeadCount: officialFlowFactsForProject(projectName).projectHeadCount,
    projectSqft: officialFlowFactsForProject(projectName).projectSqft,
    sourceRefs: [intake.source_ref],
  } : officialFlowFactsForProject(projectName);
  const hasDocumentedValues = facts.sourceStatus === 'documented_bid_package_values';
  const hasRecordedEvidence = !!intake;
  const status = hasRecordedEvidence
    ? 'official_flow_evidence_recorded'
    : (hasDocumentedValues ? 'official_flow_available' : 'official_flow_needed');
  const sourceRef = facts.sourceRefs.find((ref) => /Job Information!B3:B7/i.test(ref)) || facts.sourceRefs[0] || projectName;
  return {
    id: `resolver:official-flow:${slugForDownloadName(projectName)}`,
    project_name: projectName,
    kind: 'official_flow_intake',
    title: 'Official flow intake and preliminary hydraulic replay',
    status,
    evidence_id: matchedEvidence?.evidence?.id || null,
    source_evidence_type: 'official_flow_intake',
    source_ref: sourceRef,
    next_action: hasRecordedEvidence
      ? 'Review the recorded official-flow intake evidence, run preliminary hydraulic replay for issues/questions, and attach professional/AHJ/AutoSprink evidence before any regulated claim.'
      : (hasDocumentedValues
        ? 'Use the documented bid-package water values as preliminary hydraulic replay defaults, then attach official flow test/professional hydraulic review evidence before any permit-ready or AHJ claim.'
        : 'Attach official flow test or water supply data, enter static/residual/flowing values, and run a preliminary hydraulic replay; all regulated claims remain blocked.'),
    acceptable_evidence: [
      'official flow test report or water supply data sheet',
      'source-linked municipal or utility water supply record',
      'licensed professional hydraulic calculation review',
      'AHJ-reviewed hydraulic calculation package',
      'AutoSprink or equivalent professional hydraulic model export for parity review',
    ],
    ai_fallback:
      'Run preliminary hydraulic replay from available bid defaults and modeled demand to create issues and questions; AI can suggest candidate values/workflow gaps but cannot clear permit-ready, AHJ, PE, engineering, or AutoSprink parity claims.',
    input_defaults: {
      source_status: facts.sourceStatus,
      staticPsi: facts.staticPsi,
      residualPsi: facts.residualPsi,
      flowingGpm: facts.flowingGpm,
      flowDataDate: facts.flowDataDate,
      waterModelRequired: facts.waterModelRequired,
      project_head_count: facts.projectHeadCount,
      project_sqft: facts.projectSqft,
      source_refs: facts.sourceRefs,
      use_for_claims: false,
    },
    blocked_claims: [...OFFICIAL_FLOW_BLOCKED_CLAIMS],
    claim_gate_effect: 'no_claims_cleared',
    latest_review: matchedEvidence ? {
      evidence_id: matchedEvidence.evidence.id,
      evidence_status: matchedEvidence.evidence.status,
      source_ref: matchedEvidence.evidence.source_ref,
      reviewer_name: intake.reviewer_name || null,
      recorded_at: intake.recorded_at || null,
      claim_gate_effect: intake.claim_gate_effect || 'no_claims_cleared',
    } : null,
    limitations: [
      'Documented or employee-entered flow values are preliminary intake evidence until official/professional review is attached.',
      'This resolver item can seed hydraulic replay and issue lists, but it does not prove permit readiness, AHJ approval, PE review, engineering-grade results, AutoSprink parity, fabrication readiness, or manufacturer-exact models.',
    ],
    actions: [
      { label: 'Open hydraulic replay in Studio', href: `/autosprink.html?project=${encodeURIComponent(projectName)}&resolver=official-flow` },
      { label: 'Open evidence workbench', href: `/workbench.html?project=${encodeURIComponent(projectName)}#officialFlowIntake` },
    ],
  };
}

function slugForDownloadName(value) {
  return String(value || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'project';
}

function pdfBoundaryReviewPacket(projectName, evidence, decision) {
  const queueItem = pdfBoundaryResolverQueueItem(projectName, evidence, decision);
  if (!queueItem) return null;
  const candidate = decision.candidate || {};
  return {
    artifact_type: 'room_boundary_review_packet',
    status: 'ready_for_employee_review',
    project_name: projectName,
    source_evidence_id: evidence.id,
    source_evidence_type: 'pdf_boundary_decision',
    source_ref: evidence.source_ref || decision.sourceRef || null,
    source_file: evidence.source_file || decision.sourceFile || null,
    download_name: `${slugForDownloadName(projectName)}-room-boundary-review-packet-${evidence.id}.json`,
    generated_at: new Date().toISOString(),
    input_defaults: queueItem.input_defaults,
    candidate_summary: {
      mode: candidate.mode || decision.extractMode,
      label: candidate.label || candidate.mode || decision.extractMode,
      status: candidate.status || 'candidate',
      bbox: candidate.bbox || null,
      segmentCount: candidate.segmentCount ?? null,
      areaSqft: candidate.areaSqft ?? null,
      method: candidate.method || null,
      wallSegmentCount: candidate.wallSegmentCount ?? null,
      networkSegmentCount: candidate.networkSegmentCount ?? null,
    },
    source_refs: [
      {
        evidence_id: evidence.id,
        evidence_type: evidence.evidence_type,
        source_file: evidence.source_file || decision.sourceFile || null,
        source_ref: evidence.source_ref || decision.sourceRef || null,
        status: evidence.status,
      },
    ],
    review_steps: [
      'Open the original PDF/source sheet referenced by source_ref.',
      'Apply the saved page, operator scale, extraction mode, and candidate defaults.',
      'Compare the extracted boundary against the visual plan and create a source-linked marked-up plan screenshot.',
      'Record accepted, rejected, or corrected room polygons and list every mismatch as an issue.',
      'Attach licensed professional, AHJ, manufacturer, or AutoSprink evidence separately before clearing any regulated claim.',
    ],
    employee_decision_fields: [
      'review_decision',
      'reviewer_name',
      'reviewed_at',
      'marked_up_plan_ref',
      'corrected_room_polygons',
      'issue_list',
      'notes',
    ],
    issue_list_template: [
      {
        issue_type: 'room_boundary_mismatch',
        severity: 'blocking',
        source_ref: evidence.source_ref || decision.sourceRef || null,
        observed: '',
        expected: '',
        required_action: 'Correct the room polygon or reject the extracted boundary before using it for layout.',
      },
      {
        issue_type: 'scale_or_sheet_uncertainty',
        severity: 'blocking',
        source_ref: evidence.source_ref || decision.sourceRef || null,
        observed: '',
        expected: '',
        required_action: 'Confirm the drawing sheet and operator scale against project documents.',
      },
    ],
    acceptable_evidence: queueItem.acceptable_evidence,
    ai_fallback: queueItem.ai_fallback,
    blocked_claims: queueItem.blocked_claims,
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      ...queueItem.limitations,
      'This packet is a review aid; it does not prove geometry accuracy, drawing scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact models.',
    ],
  };
}

function pdfBoundarySam31VisualAuditPacket(projectName, evidence, decision) {
  const queueItem = pdfBoundaryResolverQueueItem(projectName, evidence, decision);
  if (!queueItem) return null;
  const candidate = decision.candidate || {};
  const pdfRef = evidence.source_file || decision.sourceFile || evidence.source_ref || decision.sourceRef || `${projectName}:pdf-boundary:${evidence.id}`;
  const bridgeHost = process.env.HALOFIRE_SAM31_BRIDGE_HOST || '127.0.0.1';
  const bridgePort = Number(process.env.HALOFIRE_SAM31_BRIDGE_PORT || 15000);
  return {
    artifact_type: 'sam31_room_boundary_visual_audit_packet',
    status: 'ready_for_sam31_visual_audit',
    project_name: projectName,
    source_evidence_id: evidence.id,
    source_evidence_type: 'pdf_boundary_decision',
    source_ref: evidence.source_ref || decision.sourceRef || null,
    source_file: evidence.source_file || decision.sourceFile || null,
    source_runtime: 'sam-3.1',
    coordinate_frame_ref: 'rendered_pdf_page_pixels_scaled_to_feet_by_pdfScale',
    unit: 'feet',
    semantic_label: 'room_boundary_visual_audit',
    generated_at: new Date().toISOString(),
    download_name: `${slugForDownloadName(projectName)}-sam31-room-boundary-visual-audit-packet-${evidence.id}.json`,
    sam31_request: buildPlanSegmentationPayload({
      pdfRef,
      pageIndex: decision.pageIndex,
      scale: decision.scale,
      targets: ['building_outline', 'walls', 'rooms', 'layers'],
    }),
    openclaw_sam31_perception_request: buildOpenClawSam31PerceptionRequest(projectName, evidence, decision, candidate, pdfRef),
    bridge: {
      openclaw_bridge_url_configured: !!String(process.env.OPENCLAW_BRIDGE_URL || '').trim(),
      local_bridge_host: bridgeHost,
      local_bridge_port: Number.isSafeInteger(bridgePort) ? bridgePort : 15000,
      local_bridge_status_url: `http://${bridgeHost}:${Number.isSafeInteger(bridgePort) ? bridgePort : 15000}/status`,
      local_bridge_invoke_url: `http://${bridgeHost}:${Number.isSafeInteger(bridgePort) ? bridgePort : 15000}/codex-bridge/invoke`,
      local_bridge_command: 'npm run sam31:bridge',
    },
    input_defaults: queueItem.input_defaults,
    candidate_summary: {
      mode: candidate.mode || decision.extractMode,
      label: candidate.label || candidate.mode || decision.extractMode,
      status: candidate.status || 'candidate',
      bbox: candidate.bbox || null,
      segmentCount: candidate.segmentCount ?? null,
      method: candidate.method || null,
    },
    employee_capture_fields: [
      'sam31_result_ref',
      'screenshot_ref',
      'console_log_ref',
      'marked_up_plan_ref',
      'issue_list',
      'corrected_room_polygons',
      'openclaw_sam31_perception_packet',
      'review_decision',
      'reviewer_name',
      'notes',
    ],
    supported_evidence_lanes: [
      'room_boundary_visual_audit',
      'spatial_observation_correction_loop',
      'object_identification_review',
      'vector_overlay_generation',
      'model_3d_candidate_generation',
      'best_effort_ai_layout_replay',
    ],
    source_refs: [
      {
        evidence_id: evidence.id,
        evidence_type: evidence.evidence_type,
        source_file: evidence.source_file || decision.sourceFile || null,
        source_ref: evidence.source_ref || decision.sourceRef || null,
        status: evidence.status,
      },
    ],
    review_steps: [
      'Start or connect the SAM 3.1 bridge, then run sam31_request through the OpenClaw/SAM bridge envelope.',
      'Attach the raw SAM 3.1 result, screenshot, and console/log evidence refs before using the visual audit for correction.',
      'Compare SAM building_outline, walls, and rooms against the selected PDF sheet and record every mismatch.',
      'Save corrected room polygons as employee review evidence before replaying the sprinkler bid.',
    ],
    issue_list_template: [
      {
        issue_type: 'sam31_visual_boundary_mismatch',
        severity: 'blocking',
        source_ref: evidence.source_ref || decision.sourceRef || null,
        observed: '',
        expected: '',
        required_action: 'Mark up the visual mismatch and provide corrected room polygons before replay.',
      },
      {
        issue_type: 'sam31_runtime_or_scale_uncertainty',
        severity: 'blocking',
        source_ref: evidence.source_ref || decision.sourceRef || null,
        observed: '',
        expected: '',
        required_action: 'Confirm the SAM 3.1 runtime, selected sheet, and operator scale before relying on the segmentation for correction.',
      },
    ],
    acceptable_evidence: [
      'SAM 3.1 segmentation result JSON',
      'OpenClaw SAM31+LLM perception packet with object/vector/3D candidate evidence',
      'OpenClaw/SAM console or screenshot evidence',
      'source-linked marked-up plan screenshot',
      'employee corrected room polygon list',
      'licensed professional review/signoff for regulated claims',
    ],
    blocked_claims: queueItem.blocked_claims,
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'This packet prepares a SAM 3.1 visual audit/correction run from saved PDF boundary evidence.',
      'SAM/OpenClaw observations are measurement and correction evidence only.',
      'This packet does not prove geometry accuracy, drawing scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact models.',
    ],
  };
}

function normalizeSam31VisualAuditResult(projectName, evidence, decision, body = {}, user = {}) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  const reviewDecision = String(body.review_decision || 'corrected').trim().toLowerCase();
  if (!['accepted', 'corrected', 'rejected'].includes(reviewDecision)) {
    const e = new Error('review_decision must be accepted, corrected, or rejected');
    e.httpStatus = 400;
    throw e;
  }
  const sam31ResultRef = String(body.sam31_result_ref || '').trim();
  if (!sam31ResultRef) {
    const e = new Error('sam31_result_ref is required to persist a SAM 3.1 visual audit result');
    e.httpStatus = 400;
    throw e;
  }
  const screenshotRef = String(body.screenshot_ref || '').trim();
  const markedUpPlanRef = String(body.marked_up_plan_ref || '').trim();
  if (!screenshotRef && !markedUpPlanRef) {
    const e = new Error('screenshot_ref or marked_up_plan_ref is required for SAM 3.1 visual audit evidence');
    e.httpStatus = 400;
    throw e;
  }
  const openclawSam31PerceptionPacket = normalizeOpenClawSam31PerceptionPacket(body);
  const sourceRefs = [
    {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_file: evidence.source_file || decision.sourceFile || null,
      source_ref: evidence.source_ref || decision.sourceRef || null,
      status: evidence.status,
    },
  ];
  if (openclawSam31PerceptionPacket) {
    sourceRefs.push({
      evidence_type: 'openclaw.sam31_perception_packet',
      source_ref: openclawSam31PerceptionPacket.source_ref || 'openclaw.sam31_perception_packet',
      status: openclawSam31PerceptionPacket.status || 'best_effort_perception_ready',
      claim_gate_effect: 'no_claims_cleared',
    });
  }
  return {
    artifact_type: 'sam31_room_boundary_visual_audit_result',
    project_name: projectName,
    source_evidence_id: evidence.id,
    source_evidence_type: evidence.evidence_type,
    source_ref: evidence.source_ref || decision.sourceRef || null,
    source_file: evidence.source_file || decision.sourceFile || null,
    source_runtime: openclawSam31PerceptionPacket ? 'sam-3.1+llm' : 'sam-3.1',
    review_decision: reviewDecision,
    reviewer_name: String(body.reviewer_name || user.name || user.username || '').trim() || null,
    reviewed_at: new Date().toISOString(),
    sam31_result_ref: sam31ResultRef,
    screenshot_ref: screenshotRef || null,
    console_log_ref: String(body.console_log_ref || '').trim() || null,
    marked_up_plan_ref: markedUpPlanRef || null,
    corrected_room_polygons: Array.isArray(body.corrected_room_polygons) ? jsonClone(body.corrected_room_polygons) : [],
    issue_list: Array.isArray(body.issue_list) ? jsonClone(body.issue_list) : [],
    openclaw_sam31_perception_packet: openclawSam31PerceptionPacket,
    notes: String(body.notes || '').trim() || null,
    input_defaults: {
      pdfPageIndex: decision.pageIndex,
      pdfScale: decision.scale,
      pdfExtract: decision.extractMode,
    },
    source_refs: sourceRefs,
    blocked_claims: Array.isArray(decision.blockedClaims) ? decision.blockedClaims : [...PDF_BOUNDARY_BLOCKED_CLAIMS],
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'SAM 3.1 visual audit results are internal-alpha correction evidence only.',
      'They may guide corrected room polygons, but they do not prove geometry accuracy, drawing scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact models.',
    ],
  };
}

function pdfBoundaryReplayInputPacket(projectName, evidence, decision, reviewEvidence, sam31Evidence = null) {
  if (!evidence || !decision) return null;
  const review = reviewEvidence?.review || sam31Evidence?.result || null;
  if (!review) return null;
  const reviewSource = reviewEvidence?.review ? 'latest_employee_review_packet' : 'latest_sam31_visual_audit';
  const reviewRow = reviewEvidence?.review ? reviewEvidence.evidence : sam31Evidence.evidence;
  if (review.review_decision === 'rejected') {
    const e = new Error(
      reviewSource === 'latest_sam31_visual_audit'
        ? 'Latest SAM 3.1 visual audit rejected this boundary; replay input is blocked'
        : 'Latest room-boundary review rejected this boundary; replay input is blocked',
    );
    e.httpStatus = 409;
    throw e;
  }
  const correctedRoomPolygons = Array.isArray(review.corrected_room_polygons)
    ? jsonClone(review.corrected_room_polygons)
    : [];
  const queueItem = pdfBoundaryResolverQueueItem(projectName, evidence, decision, reviewEvidence, sam31Evidence);
  const openclawSam31PerceptionPacketSummary = reviewSource === 'latest_sam31_visual_audit'
    ? sam31PerceptionPacketSummary(review.openclaw_sam31_perception_packet)
    : null;
  const sourceRefs = [
    {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_ref: evidence.source_ref || decision.sourceRef || null,
      status: evidence.status,
    },
    {
      evidence_id: reviewRow.id,
      evidence_type: reviewRow.evidence_type,
      source_ref: reviewRow.source_ref,
      status: reviewRow.status,
    },
  ];
  if (openclawSam31PerceptionPacketSummary) {
    sourceRefs.push({
      evidence_type: 'openclaw.sam31_perception_packet',
      source_ref: openclawSam31PerceptionPacketSummary.source_ref || 'openclaw.sam31_perception_packet',
      status: openclawSam31PerceptionPacketSummary.status,
      claim_gate_effect: 'no_claims_cleared',
    });
  }
  const sprinklerBidRequest = {
    room_boundary_source: reviewSource,
    source_evidence_id: evidence.id,
    pdfPageIndex: decision.pageIndex,
    pdfScale: decision.scale,
    pdfExtract: decision.extractMode,
    corrected_room_polygons: correctedRoomPolygons,
    use_for_claims: false,
  };
  if (reviewSource === 'latest_employee_review_packet') {
    sprinklerBidRequest.source_review_evidence_id = reviewRow.id;
  } else {
    sprinklerBidRequest.source_sam31_evidence_id = reviewRow.id;
  }
  if (openclawSam31PerceptionPacketSummary) {
    sprinklerBidRequest.openclaw_sam31_perception_packet = openclawSam31PerceptionPacketSummary;
  }
  return {
    artifact_type: 'room_boundary_replay_input_packet',
    status: 'ready_for_internal_alpha_replay',
    project_name: projectName,
    source_evidence_id: evidence.id,
    ...(reviewSource === 'latest_employee_review_packet'
      ? { source_review_evidence_id: reviewRow.id }
      : { source_sam31_evidence_id: reviewRow.id }),
    source_ref: evidence.source_ref || decision.sourceRef || null,
    source_file: evidence.source_file || decision.sourceFile || null,
    download_name: `${slugForDownloadName(projectName)}-room-boundary-replay-input-${evidence.id}.json`,
    generated_at: new Date().toISOString(),
    review_source: reviewSource,
    review_decision: review.review_decision,
    reviewer_name: review.reviewer_name,
    reviewed_at: review.reviewed_at,
    marked_up_plan_ref: review.marked_up_plan_ref,
    ...(reviewSource === 'latest_sam31_visual_audit'
      ? {
        sam31_result_ref: review.sam31_result_ref || null,
        screenshot_ref: review.screenshot_ref || null,
        console_log_ref: review.console_log_ref || null,
        openclaw_sam31_perception_packet: openclawSam31PerceptionPacketSummary,
      }
      : {}),
    issue_list: Array.isArray(review.issue_list) ? jsonClone(review.issue_list) : [],
    corrected_room_polygons: correctedRoomPolygons,
    input_defaults: queueItem.input_defaults,
    sprinkler_bid_request: sprinklerBidRequest,
    source_refs: sourceRefs,
    blocked_claims: queueItem.blocked_claims,
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'This replay input is internal-alpha correction evidence only.',
      'It may seed a best-effort layout replay, but it does not prove geometry accuracy, drawing scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact models.',
    ],
  };
}

function resolveRoomBoundaryReplayFloorPlan(req, projectName) {
  const replaySource = String(req.body?.room_boundary_source || '').trim();
  if (!['latest_employee_review_packet', 'latest_sam31_visual_audit'].includes(replaySource)) return null;
  const sourceEvidenceId = Number(req.body.source_evidence_id);
  const sourceReviewEvidenceId = Number(req.body.source_review_evidence_id);
  const sourceSam31EvidenceId = Number(req.body.source_sam31_evidence_id);
  if (!Number.isSafeInteger(sourceEvidenceId) || sourceEvidenceId <= 0) {
    const e = new Error('source_evidence_id is required for room-boundary replay input');
    e.httpStatus = 400;
    throw e;
  }
  if (replaySource === 'latest_employee_review_packet' && (!Number.isSafeInteger(sourceReviewEvidenceId) || sourceReviewEvidenceId <= 0)) {
    const e = new Error('source_review_evidence_id is required for room-boundary replay input');
    e.httpStatus = 400;
    throw e;
  }
  if (replaySource === 'latest_sam31_visual_audit' && (!Number.isSafeInteger(sourceSam31EvidenceId) || sourceSam31EvidenceId <= 0)) {
    const e = new Error('source_sam31_evidence_id is required for SAM 3.1 room-boundary replay input');
    e.httpStatus = 400;
    throw e;
  }
  const correctedRoomPolygons = Array.isArray(req.body.corrected_room_polygons)
    ? req.body.corrected_room_polygons
    : [];
  if (!correctedRoomPolygons.length) {
    const e = new Error('corrected_room_polygons is required for room-boundary replay input');
    e.httpStatus = 400;
    throw e;
  }
  const sourceEvidence = db
    .prepare(`SELECT * FROM project_evidence
              WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
    .get(sourceEvidenceId, projectName);
  const sourceReviewEvidence = replaySource === 'latest_employee_review_packet'
    ? db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'room_boundary_review_packet'`)
      .get(sourceReviewEvidenceId, projectName)
    : db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'sam31_room_boundary_visual_audit'`)
      .get(sourceSam31EvidenceId, projectName);
  const sourceReview = replaySource === 'latest_employee_review_packet'
    ? reviewFromEvidence(sourceReviewEvidence)
    : sam31VisualAuditResultFromEvidence(sourceReviewEvidence);
  if (!sourceEvidence || !sourceReview || Number(sourceReview.source_evidence_id) !== sourceEvidenceId) {
    const e = new Error(
      replaySource === 'latest_sam31_visual_audit'
        ? 'Replay input source evidence does not match a saved SAM 3.1 visual audit result'
        : 'Replay input source evidence does not match a saved room-boundary review packet',
    );
    e.httpStatus = 409;
    throw e;
  }
  if (sourceReview.review_decision === 'rejected') {
    const e = new Error(
      replaySource === 'latest_sam31_visual_audit'
        ? 'Latest SAM 3.1 visual audit rejected this boundary; replay input is blocked'
        : 'Latest room-boundary review rejected this boundary; replay input is blocked',
    );
    e.httpStatus = 409;
    throw e;
  }
  const rooms = correctedRoomPolygons.map((entry, index) => ({
    name: entry.room_id || entry.name || `Reviewed Room ${index + 1}`,
    polygon: entry.polygon,
    hazard: entry.hazard || req.body.hazard || 'ordinary',
    ...(entry.ceilingHeightFt ? { ceilingHeightFt: entry.ceilingHeightFt } : {}),
  }));
  const floorPlan = normalizeFloorPlan({
    name: `${projectName} - reviewed room-boundary replay`,
    units: 'ft',
    rooms,
  });
  const openclawSam31PerceptionPacketSummary = replaySource === 'latest_sam31_visual_audit'
    ? sam31PerceptionPacketSummary(sourceReview.openclaw_sam31_perception_packet)
    : null;
  const sourceRefs = [
    {
      evidence_id: sourceEvidence.id,
      evidence_type: sourceEvidence.evidence_type,
      source_ref: sourceEvidence.source_ref || null,
      status: sourceEvidence.status,
    },
    {
      evidence_id: sourceReviewEvidence.id,
      evidence_type: sourceReviewEvidence.evidence_type,
      source_ref: sourceReviewEvidence.source_ref || null,
      status: sourceReviewEvidence.status,
    },
  ];
  if (openclawSam31PerceptionPacketSummary) {
    sourceRefs.push({
      evidence_type: 'openclaw.sam31_perception_packet',
      source_ref: openclawSam31PerceptionPacketSummary.source_ref || 'openclaw.sam31_perception_packet',
      status: openclawSam31PerceptionPacketSummary.status,
      claim_gate_effect: 'no_claims_cleared',
    });
  }
  return {
    floorPlan,
    replayInput: {
      room_boundary_source: replaySource,
      source_evidence_id: sourceEvidenceId,
      ...(replaySource === 'latest_employee_review_packet'
        ? { source_review_evidence_id: sourceReviewEvidenceId }
        : { source_sam31_evidence_id: sourceSam31EvidenceId }),
      source_ref: sourceEvidence.source_ref || sourceReview.source_ref || null,
      marked_up_plan_ref: sourceReview.marked_up_plan_ref || null,
      ...(replaySource === 'latest_sam31_visual_audit'
        ? {
          sam31_result_ref: sourceReview.sam31_result_ref || null,
          screenshot_ref: sourceReview.screenshot_ref || null,
          console_log_ref: sourceReview.console_log_ref || null,
          openclaw_sam31_perception_packet: openclawSam31PerceptionPacketSummary,
        }
        : {}),
      corrected_room_polygon_count: correctedRoomPolygons.length,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      blocked_claims: Array.isArray(sourceReview.blocked_claims) ? sourceReview.blocked_claims : [...PDF_BOUNDARY_BLOCKED_CLAIMS],
      source_refs: sourceRefs,
    },
  };
}

function normalizePdfBoundaryReview(projectName, evidence, decision, body = {}, user = {}) {
  const packet = pdfBoundaryReviewPacket(projectName, evidence, decision);
  if (!packet) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  const reviewDecision = String(body.review_decision || body.reviewDecision || '').trim();
  if (!['accepted', 'rejected', 'corrected'].includes(reviewDecision)) {
    const e = new Error("review_decision must be one of: accepted, rejected, corrected");
    e.httpStatus = 400;
    throw e;
  }
  const reviewerName = String(body.reviewer_name || body.reviewerName || user.username || '').trim();
  if (!reviewerName) {
    const e = new Error('reviewer_name is required');
    e.httpStatus = 400;
    throw e;
  }
  const markedUpPlanRef = String(body.marked_up_plan_ref || body.markedUpPlanRef || '').trim();
  if (!markedUpPlanRef) {
    const e = new Error('marked_up_plan_ref is required');
    e.httpStatus = 400;
    throw e;
  }
  const correctedRoomPolygons = Array.isArray(body.corrected_room_polygons)
    ? jsonClone(body.corrected_room_polygons)
    : [];
  const issueList = Array.isArray(body.issue_list) ? jsonClone(body.issue_list) : [];
  if (reviewDecision === 'corrected' && !correctedRoomPolygons.length) {
    const e = new Error('corrected_room_polygons is required when review_decision is corrected');
    e.httpStatus = 400;
    throw e;
  }
  return {
    kind: 'room_boundary_review_packet_decision',
    project_name: projectName,
    source_evidence_id: evidence.id,
    source_packet_ref: packet.download_name,
    source_ref: packet.source_ref,
    review_decision: reviewDecision,
    reviewer_name: reviewerName,
    reviewed_at: body.reviewed_at || body.reviewedAt || new Date().toISOString(),
    marked_up_plan_ref: markedUpPlanRef,
    corrected_room_polygons: correctedRoomPolygons,
    issue_list: issueList,
    notes: body.notes || null,
    acceptable_evidence: packet.acceptable_evidence,
    blocked_claims: packet.blocked_claims,
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'Employee room-boundary review packets are internal-alpha correction evidence only.',
      'This review does not clear geometry accuracy, drawing scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact claims.',
    ],
  };
}

app.get('/api/projects/:name/resolver-queue', authMiddleware, (req, res) => {
  const projectName = req.params.name;
  const evidence = latestPdfBoundaryDecisionEvidence(projectName);
  const decision = decisionFromEvidence(evidence);
  const reviewEvidence = evidence ? latestPdfBoundaryReviewEvidence(projectName, evidence.id) : null;
  const sam31Evidence = evidence ? latestSam31VisualAuditEvidence(projectName, evidence.id) : null;
  const items = [];
  const officialFlowEvidence = latestOfficialFlowIntakeEvidence(projectName);
  const officialFlowItem = officialFlowResolverQueueItem(projectName, officialFlowEvidence);
  if (officialFlowItem) items.push(officialFlowItem);
  for (const replayEvidence of officialFlowReplayArtifactEvidenceRows(projectName)) {
    const replayItem = officialFlowReplayReviewQueueItem(projectName, replayEvidence);
    if (replayItem) items.push(replayItem);
  }
  const boundaryItem = pdfBoundaryResolverQueueItem(projectName, evidence, decision, reviewEvidence, sam31Evidence);
  if (boundaryItem) items.push(boundaryItem);
  const catalogEvidence = matchingCatalogEvidenceByFamily(projectName);
  for (const row of currentSourceAcquisitionLedger()) {
    const matchedEvidence =
      catalogEvidence.get(String(row.family_ref)) ||
      catalogEvidence.get(String(row.source_url || '')) ||
      catalogEvidence.get(String(row.component_key || '')) ||
      null;
    const catalogItem = catalogResolverQueueItem(projectName, row, matchedEvidence);
    if (catalogItem) items.push(catalogItem);
  }
  const statusCounts = items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  res.json({
    project_name: projectName,
    items,
    summary: {
      ready: statusCounts.ready || 0,
      blocked: statusCounts.blocked || 0,
      correction_ready: statusCounts.correction_ready || 0,
      reviewed: statusCounts.reviewed || 0,
      sam31_correction_ready: statusCounts.sam31_correction_ready || 0,
      sam31_reviewed: statusCounts.sam31_reviewed || 0,
      catalog_source_needed: statusCounts.catalog_source_needed || 0,
      catalog_review_needed: statusCounts.catalog_review_needed || 0,
      catalog_evidence_recorded: statusCounts.catalog_evidence_recorded || 0,
      official_flow_available: statusCounts.official_flow_available || 0,
      official_flow_needed: statusCounts.official_flow_needed || 0,
      official_flow_evidence_recorded: statusCounts.official_flow_evidence_recorded || 0,
      official_flow_replay_review_needed: statusCounts.official_flow_replay_review_needed || 0,
    },
  });
});

app.post('/api/projects/:name/resolver-packets/official-flow/intake', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const intake = normalizeOfficialFlowIntake(projectName, req.body, req.user);
    const packet = {
      kind: 'official_flow_intake_record',
      project_name: projectName,
      intake,
      stored_at: new Date().toISOString(),
      no_claim_gates_cleared: true,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'official_flow_intake',
        intake.source_file,
        intake.source_ref,
        'present',
        JSON.stringify(packet),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      id: result.lastInsertRowid,
      message: 'Official-flow intake evidence recorded for preliminary hydraulic replay; claims still blocked',
      evidence: evidenceRow,
      intake,
    });
  } catch (err) {
    res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/official-flow/:evidenceId/replay-artifact', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'official_flow_intake'`)
      .get(evidenceId, projectName);
    const intake = officialFlowIntakeFromEvidence(evidence);
    if (!evidence || !intake) {
      return res.status(404).json({ error: 'Official-flow intake evidence not found' });
    }
    res.json(buildOfficialFlowHydraulicReplayArtifact(projectName, evidence, intake, req.user));
  } catch (err) {
    res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/official-flow/:evidenceId/replay-artifact', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'official_flow_intake'`)
      .get(evidenceId, projectName);
    const intake = officialFlowIntakeFromEvidence(evidence);
    if (!evidence || !intake) {
      return res.status(404).json({ error: 'Official-flow intake evidence not found' });
    }
    const artifact = buildOfficialFlowHydraulicReplayArtifact(projectName, evidence, intake, req.user);
    const notes = officialFlowReplayArtifactEvidenceNotes(artifact);
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'official_flow_hydraulic_replay_artifact',
        artifact.official_flow_input?.source_file || null,
        `official-flow:${evidence.id}:hydraulic-replay`,
        'best_effort',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      id: result.lastInsertRowid,
      message: 'Official-flow hydraulic replay artifact saved as best-effort evidence; claims still blocked',
      evidence: evidenceRow,
      artifact,
    });
  } catch (err) {
    res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/official-flow-replay/:evidenceId/review-packet', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'official_flow_hydraulic_replay_artifact'`)
      .get(evidenceId, projectName);
    const replayEvidence = officialFlowReplayArtifactFromEvidence(evidence);
    const packet = officialFlowProfessionalAhjReviewPacket(projectName, replayEvidence);
    if (!packet) {
      return res.status(404).json({ error: 'Official-flow hydraulic replay evidence not found' });
    }
    res.json(packet);
  } catch (err) {
    res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId', authMiddleware, (req, res) => {
  const projectName = req.params.name;
  const evidenceId = Number(req.params.evidenceId);
  if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
    return res.status(400).json({ error: 'A positive evidence id is required' });
  }
  const evidence = db
    .prepare(`SELECT * FROM project_evidence
              WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
    .get(evidenceId, projectName);
  const decision = decisionFromEvidence(evidence);
  const packet = pdfBoundaryReviewPacket(projectName, evidence, decision);
  if (!packet) {
    return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
  }
  res.json(packet);
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/sam31-visual-audit', authMiddleware, (req, res) => {
  const projectName = req.params.name;
  const evidenceId = Number(req.params.evidenceId);
  if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
    return res.status(400).json({ error: 'A positive evidence id is required' });
  }
  const evidence = db
    .prepare(`SELECT * FROM project_evidence
              WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
    .get(evidenceId, projectName);
  const decision = decisionFromEvidence(evidence);
  const packet = pdfBoundarySam31VisualAuditPacket(projectName, evidence, decision);
  if (!packet) {
    return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
  }
  res.json(packet);
});

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/sam31-visual-audit/results', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    const resultPacket = normalizeSam31VisualAuditResult(projectName, evidence, decision, req.body, req.user);
    const notes = {
      kind: 'sam31_room_boundary_visual_audit_result',
      result: resultPacket,
      blocked_claims: resultPacket.blocked_claims,
      claim_gate_effect: resultPacket.claim_gate_effect,
      limitations: resultPacket.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'sam31_room_boundary_visual_audit',
        resultPacket.source_file,
        `pdf-boundary:${evidence.id}:sam31-visual-audit:${resultPacket.review_decision}`,
        'best_effort',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      id: result.lastInsertRowid,
      message: 'SAM 3.1 visual audit result recorded as best-effort evidence; claims still blocked',
      evidence: evidenceRow,
      result: resultPacket,
    });
  } catch (err) {
    res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/replay-input', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    const reviewEvidence = evidence ? latestPdfBoundaryReviewEvidence(projectName, evidence.id) : null;
    const sam31Evidence = evidence ? latestSam31VisualAuditEvidence(projectName, evidence.id) : null;
    const packet = pdfBoundaryReplayInputPacket(projectName, evidence, decision, reviewEvidence, sam31Evidence);
    if (!packet) {
      return res.status(409).json({ error: 'No employee or SAM 3.1 room-boundary review packet is available for replay input' });
    }
    res.json(packet);
  } catch (err) {
    res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/reviews', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    const review = normalizePdfBoundaryReview(projectName, evidence, decision, req.body, req.user);
    const sourceRef = `pdf-boundary:${evidence.id}:room-boundary-review:${review.review_decision}`;
    const packet = {
      kind: 'room_boundary_review_packet_decision',
      recordedBy: req.user.username,
      recordedAt: new Date().toISOString(),
      review,
      status: 'best_effort',
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'room_boundary_review_packet',
        evidence.source_file || decision.sourceFile || null,
        sourceRef,
        'best_effort',
        JSON.stringify(packet),
      );
    const reviewEvidence = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      id: result.lastInsertRowid,
      message: 'Room-boundary review recorded as best-effort evidence; claims still blocked',
      evidence: reviewEvidence,
      review,
    });
  } catch (err) {
    res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

function runSprinklerPipeline(req, prebuilt = null) {
  const projectName = req.params.name;
  let floorPlan = (prebuilt && prebuilt.floorPlan) || null;
  let building = null;
  let replayInput = null;
  if (floorPlan) {
    // A PDF (or other async) source was resolved upstream; skip source selection.
  } else if (['latest_employee_review_packet', 'latest_sam31_visual_audit'].includes(req.body?.room_boundary_source)) {
    const replay = resolveRoomBoundaryReplayFloorPlan(req, projectName);
    floorPlan = replay.floorPlan;
    replayInput = replay.replayInput;
  } else if (req.body && typeof req.body.buildingSvg === 'string' && req.body.buildingSvg.trim()) {
    // Accurate multi-space building drawing (walls/spaces/doors/columns by layer/attr).
    building = buildingFromSvg(req.body.buildingSvg, { name: projectName, unitsPerPx: Number(req.body.unitsPerPx) || 1 });
  } else if (req.body && typeof req.body.buildingDxf === 'string' && req.body.buildingDxf.trim()) {
    // Multi-space building from a DXF drawing (layer-mapped spaces/walls/doors/columns).
    building = buildingFromDxf(req.body.buildingDxf, {
      name: projectName,
      unitsPerDrawingUnit: Number(req.body.unitsPerDrawingUnit) || 1,
      layers: req.body.dxfLayers || DEFAULT_DXF_LAYERS,
    });
  } else if (req.body && typeof req.body.svg === 'string' && req.body.svg.trim()) {
    // Import a floor plan from pasted/uploaded SVG (px scaled to ft).
    floorPlan = floorPlanFromSvg(req.body.svg, { name: projectName, unitsPerPx: Number(req.body.unitsPerPx) || 1 });
  } else if (req.body && typeof req.body.dxf === 'string' && req.body.dxf.trim()) {
    // Single-space floor plan from a DXF drawing (closed polylines/loops scaled to ft).
    floorPlan = floorPlanFromDxf(req.body.dxf, {
      name: projectName,
      unitsPerDrawingUnit: Number(req.body.unitsPerDrawingUnit) || 1,
      layer: req.body.dxfLayer || undefined,
      hazard: req.body.hazard,
    });
  } else if (req.body && req.body.floorPlan) {
    floorPlan = normalizeFloorPlan(req.body.floorPlan);
  } else if (projectName === HOME_DEPOT_PROJECT_NAME) {
    floorPlan = homeDepotRexburgFloorPlan();
  } else if (projectName === COOPERATIVE_1881_PROJECT_NAME) {
    // Residential apartment job with no DXF — built-in plan uses the REAL
    // sprinklered area (170,654 sqft) with a placeholder footprint shape.
    floorPlan = cooperative1881FloorPlan();
  }
  // A building drawing (SVG or DXF) -> synthesize a flat floor plan for bid/hydraulics/scene.
  if (building && !floorPlan) {
    floorPlan = {
      name: projectName, units: building.units || 'ft',
      rooms: building.stories.flatMap((s) => s.spaces.map((sp) => ({ ...sp, ceilingHeightFt: sp.ceilingHeightFt || s.ceilingHeightFt }))),
    };
    if (!floorPlan.rooms.length) return { httpError: { status: 400, error: 'Building drawing has no spaces (need space polygons / mapped layers)' } };
  }
  if (!floorPlan) {
    return { httpError: { status: 400, error: 'Provide an svg/dxf/pdf, a buildingSvg/buildingDxf, a floorPlan spec, or use a project with a built-in plan' } };
  }
  // Optional hazard override from the studio UI (applies to all rooms).
  if (req.body && ['light', 'ordinary', 'extra'].includes(String(req.body.hazard))) {
    floorPlan = { ...floorPlan, rooms: floorPlan.rooms.map((r) => ({ ...r, hazard: req.body.hazard })) };
  }

  // T25 — ESFR/storage system class. The built-in Home Depot project is an ESFR
  // warehouse system; a caller may also request it explicitly via
  // systemClass:"esfr". When ESFR, lay the system out with the ESFR storage
  // hazard rule AND append the diameter-aware ESFR mains scope to the BOM below.
  // Non-ESFR projects are byte-for-byte unchanged (this branch never runs).
  const isEsfr = projectName === HOME_DEPOT_PROJECT_NAME
    || String(req.body?.systemClass || '').toLowerCase() === 'esfr';
  if (isEsfr) {
    floorPlan = { ...floorPlan, rooms: floorPlan.rooms.map((r) => ({ ...r, hazard: 'esfr' })) };
  }

  const opts = {
    priceResolver: buildResolverFromDb(db),
    laborRatePerHead: Number(req.body?.laborRatePerHead) || 85,
    markupPct: Number(req.body?.markupPct) || 25,
  };
  const bid = generateSprinklerBid(floorPlan, opts);

  // T25 — Append the ESFR system scope (esfr heads + diameter-aware feed/cross/
  // bulk mains + underground lead-in) to the aggregated BOM, then re-price so the
  // materialCost reflects the real ESFR materials from the pricebook. ADDITIVE +
  // fail-soft: any error leaves the standard bid untouched. ESFR heads REPLACE
  // the standard spray sprinkler_head line (no double-counting); pricing flows
  // through the same priceResolver (real pricebook medians, labelled fallbacks).
  if (isEsfr) {
    try {
      const esfrScope = [];
      for (const room of bid.rooms) {
        if (room.layout && room.piping) {
          esfrScope.push(...buildEsfrSystemScope(room.layout, room.piping, {
            bulkMainFt: Number(req.body?.esfrBulkMainFt) || undefined,
            undergroundFt: Number(req.body?.esfrUndergroundFt) || undefined,
          }));
        }
      }
      if (esfrScope.length) {
        // Aggregate ESFR scope by key across rooms.
        const esfrByKey = new Map();
        for (const line of esfrScope) {
          const prev = esfrByKey.get(line.key);
          if (prev) prev.quantity = round2(prev.quantity + line.quantity);
          else esfrByKey.set(line.key, { ...line });
        }
        // Drop the standard spray head line; ESFR heads take its place.
        const augmentedBom = bid.bom.filter((b) => b.key !== 'sprinkler_head');
        augmentedBom.push(...esfrByKey.values());
        bid.bom = augmentedBom;
        bid.systemClass = 'esfr';
        // Re-price the augmented BOM through the same resolver + markup options.
        bid.pricing = priceBid(bid.bom, opts);
      }
    } catch (e) {
      log.warn?.('esfr scope augmentation failed; keeping standard bid', { error: e.message });
    }
  }
  const scene = buildScene(floorPlan, bid);
  // 3D-correct CAD model. For a building drawing this carries interior+exterior
  // walls (with door/window opening metadata) + columns + per-space networks.
  const cadModel = building ? buildCadModel(building) : buildCadModel(floorPlan);

  // Record that a best-effort layout was generated — as evidence, not a clearance.
  if (normalizeRole(req.user?.role) === 'admin') {
    const replayEvidenceToken = replayInput?.source_sam31_evidence_id || replayInput?.source_review_evidence_id;
    const replayEvidenceKind = replayInput?.room_boundary_source === 'latest_sam31_visual_audit'
      ? 'sam31-room-boundary-replay'
      : 'room-boundary-replay';
    const evidenceSourceRef = replayInput
      ? `pdf-boundary:${replayInput.source_evidence_id}:${replayEvidenceKind}:${replayEvidenceToken}`
      : `engine ${bid.generatedBy}`;
    const evidenceNotes = replayInput
      ? JSON.stringify({
        kind: 'best_effort_ai_layout_replay',
        artifact_type: 'room_boundary_replay_bid_artifact',
        artifact_status: 'best_effort_internal_alpha',
        replay_generated_at: new Date().toISOString(),
        download_name: `room-boundary-replay-bid-artifact-${replayInput.source_evidence_id}-${replayEvidenceToken}.json`,
        generated_by: bid.generatedBy,
        room_boundary_source: replayInput.room_boundary_source,
        source_evidence_id: replayInput.source_evidence_id,
        source_review_evidence_id: replayInput.source_review_evidence_id,
        source_sam31_evidence_id: replayInput.source_sam31_evidence_id,
        source_ref: replayInput.source_ref,
        marked_up_plan_ref: replayInput.marked_up_plan_ref,
        sam31_result_ref: replayInput.sam31_result_ref,
        screenshot_ref: replayInput.screenshot_ref,
        console_log_ref: replayInput.console_log_ref,
        openclaw_sam31_perception_packet: replayInput.openclaw_sam31_perception_packet || null,
        corrected_room_polygon_count: replayInput.corrected_room_polygon_count,
        total_head_count: bid.totalHeadCount,
        total_area_sqft: bid.totalAreaSqFt,
        bid_summary: {
          total_area_sqft: bid.totalAreaSqFt,
          total_head_count: bid.totalHeadCount,
          pricing_total: bid.pricing?.total ?? null,
          markup_pct: bid.pricing?.markupPct ?? null,
        },
        blocked_claims: replayInput.blocked_claims,
        claim_gate_effect: 'no_claims_cleared',
        summary: `claim_gate_effect=no_claims_cleared room_boundary_source=${replayInput.room_boundary_source} replay_evidence_id=${replayEvidenceToken}`,
        limitations: [
          replayInput.room_boundary_source === 'latest_sam31_visual_audit'
            ? 'Generated from SAM 3.1 visual-audit correction evidence for internal-alpha replay only.'
            : 'Generated from employee-reviewed room-boundary correction evidence for internal-alpha replay only.',
          bid.disclaimer,
        ],
      })
      : `Generated ${bid.totalHeadCount} heads over ${bid.totalAreaSqFt} sqft. ${bid.disclaimer}`;
    db.prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`).run(
      projectName,
      'best_effort_ai_layout',
      null,
      evidenceSourceRef,
      'best_effort',
      evidenceNotes,
    );
  }

  const hazard = bid.rooms?.[0]?.hazard || 'ordinary';

  // Best-effort NFPA-13 hydraulic check (single representative path; NOT a
  // full network balance). Surfaced in the studio; never clears a gate.
  let hydraulics = null;
  try {
    // buildCadModel nests the network under rooms[].network (or floors[].rooms[]).
    const room0 = (cadModel.rooms && cadModel.rooms[0])
      || (cadModel.floors && cadModel.floors[0] && cadModel.floors[0].rooms && cadModel.floors[0].rooms[0]);
    const network = room0 && room0.network;
    if (!network) throw new Error('no network in cad model');
    const required = requiredPressureAtRiser({ network, hazard });
    hydraulics = {
      ...required,
      demand: remoteAreaDemand(hazard),
      warnings: flagSchedule(network, hazard),
      disclaimer: 'best-effort single-path estimate — NOT a full hydraulic network balance, NOT PE/AHJ reviewed.',
    };
  } catch (e) {
    hydraulics = { error: e.message };
  }

  // Best-effort FULL hydraulic NETWORK balance over the remote design area.
  // balanceNetwork resolves the network from cadModel.network (TOP-LEVEL), which
  // buildCadModel does not produce — the network lives at cadModel.rooms[0].network
  // (legacy/floorPlan path). Building drawings expose no rooms[].network, so this
  // skips gracefully rather than fabricating one. Never clears a gate.
  let hydraulicNetwork = null;
  try {
    const room0 = (cadModel.rooms && cadModel.rooms[0])
      || (cadModel.floors && cadModel.floors[0] && cadModel.floors[0].rooms && cadModel.floors[0].rooms[0]);
    const network = room0 && room0.network;
    if (!network) throw new Error('no per-room network for full balance (building path)');
    hydraulicNetwork = balanceNetwork({ network, hazard });
  } catch (e) {
    hydraulicNetwork = { error: e.message };
  }

  // Best-effort NFPA-13 GEOMETRIC compliance check. Build a system-layout shape
  // from the bid (per-room laid-out heads/spacing/bbox) so the check has real
  // geometry. checkCompliance ALWAYS appends a 'warn' honesty note and clears NO
  // gate — a geometric "passed" is not AHJ/PE/permit-ready approval.
  let compliance = null;
  try {
    const complianceInput = {
      stories: [{
        spaces: bid.rooms.map((r) => ({ name: r.name, hazard: r.hazard, ...(r.layout || {}) })),
      }],
    };
    compliance = checkCompliance(complianceInput, hazard);
  } catch (e) {
    compliance = { error: e.message };
  }

  // Best-effort FULL-SCOPE estimate: bare-materials priced bid + assumed system
  // components + assumed soft costs. Every non-pricebook line stays flagged
  // (fallback_estimate / soft_cost_assumption) and estimate:true rides along.
  // This is NOT a complete/quoted bid and clears NO gate. Fail-closed: if the
  // build throws we surface { error } rather than fabricating a number.
  let fullScopeBid = null;
  try {
    // T23: feed the detailed field-labor model from the bid BOM. branch_pipe is
    // priced per-FT (quantity = pipe footage); fitting quantity = fitting count.
    const bomItems = Array.isArray(bid.bom) ? bid.bom : [];
    const pipeFootage = bomItems.find((b) => b.key === 'branch_pipe')?.quantity ?? 0;
    const fittingCount = bomItems.find((b) => b.key === 'fitting')?.quantity ?? 0;
    fullScopeBid = buildFullScopeBid(bid.pricing, {
      priceResolver: opts.priceResolver,
      totalHeadCount: bid.totalHeadCount,
      pipeFootage,
      fittingCount,
      hazard,
      // Required pressure from the single-path estimate (when it ran) lets the
      // fire-pump conditional evaluate honestly. availablePressure is left
      // undefined for generic projects so NO fire pump is fabricated.
      requiredPressure: (hydraulics && !hydraulics.error) ? hydraulics.requiredPressurePsi : undefined,
    });
    // INFORMATIONAL calibration vs the real submitted Home Depot bid-log total.
    // Built-in Home Depot project only; informational delta, not an accuracy or
    // parity claim, and it never clears a gate.
    if (projectName === HOME_DEPOT_PROJECT_NAME && typeof fullScopeBid.fullScopeTotal === 'number') {
      const deltaUsd = round2(fullScopeBid.fullScopeTotal - HOME_DEPOT_BID_LOG_TOTAL);
      const deltaPct = HOME_DEPOT_BID_LOG_TOTAL
        ? round2((deltaUsd / HOME_DEPOT_BID_LOG_TOTAL) * 100)
        : 0;
      fullScopeBid.calibration = {
        source: 'home-depot-bid-log',
        referenceTotal: HOME_DEPOT_BID_LOG_TOTAL,
        fullScopeTotal: fullScopeBid.fullScopeTotal,
        deltaUsd,
        deltaPct,
        note: 'informational comparison only — not an accuracy or parity claim, '
          + 'and it clears no regulated gate. The full-scope figure is a best-effort '
          + 'estimate, not a complete or quoted bid.',
      };

      // T24: enrich the calibration with the REAL ESI takeoff parsed from the
      // proposal workbook (Building 1 SOV block; source cells cited). Fail-closed:
      // an absent/unparseable workbook OMITS realTakeoff and leaves the existing
      // calibration intact — it must NEVER throw or 500. The real takeoff is REAL
      // parsed data (an evidence trail), NOT a model achievement and NOT a parity
      // claim; it flips NO gate.
      try {
        const realTakeoff = readHomeDepotRealTakeoff();
        fullScopeBid.calibration.realTakeoff = realTakeoff;

        // Itemized model-vs-real category comparison (INFORMATIONAL). The real
        // takeoff bundles equipment under labor and sub+misc under design, so we
        // compare against the model's analogous roll-ups. Each delta is labelled
        // informational and asserts no parity.
        const m = fullScopeBid;
        const modelSoftPlusOhp = round2((m.softCostTotal || 0) + (m.ohp?.ohpTotal || 0));
        const realLaborPlusEquip = round2(realTakeoff.cost.labor + realTakeoff.cost.equipment);
        const realDesignSub = round2(realTakeoff.cost.subcontractor + realTakeoff.cost.miscellaneous);
        const cmp = (label, modelUsd, realUsd) => ({
          label,
          modelUsd: round2(modelUsd),
          realUsd: round2(realUsd),
          deltaUsd: round2((modelUsd || 0) - (realUsd || 0)),
        });
        fullScopeBid.calibration.byCategory = {
          basis: 'cost (un-marked-up) — model estimate categories vs real ESI takeoff categories',
          rows: [
            cmp('materials', m.materialsOnly, realTakeoff.cost.material),
            cmp('labor (+ equipment)', m.laborCost, realLaborPlusEquip),
            cmp('system components', m.systemComponentCost, 0),
            cmp('design (sub + misc)', modelSoftPlusOhp, realDesignSub),
          ],
          note: 'informational itemized comparison only — not an accuracy or '
            + 'parity claim, and it clears no regulated gate. The dominant gap is '
            + 'MATERIALS: the auto-estimate models simplified geometry and does not '
            + 'capture the full ESFR/bulk-main scope in the real submitted takeoff.',
        };
      } catch (takeoffErr) {
        // Absent or unparseable workbook: omit realTakeoff, keep base calibration.
        log.warn?.('home-depot real takeoff unavailable', { error: takeoffErr.message });
      }
    }

    // Cooperative 1881 — a RESIDENTIAL apartment job (standard-spray, NOT ESFR).
    // Enrich the full-scope bid with the REAL ESI/Knowify takeoff parsed from the
    // proposal workbook (Building (1) Knowify SOV cost block; column sums
    // validated against the sheet "Knowify Check" total; source cells cited).
    // Fail-soft: an absent/unparseable workbook OMITS the calibration entirely
    // and leaves the bid intact — it must NEVER throw or 500. The real takeoff is
    // REAL parsed data (an evidence trail), NOT a model achievement and NOT a
    // parity/accuracy/AHJ/PE claim; it flips NO gate. Home Depot + generic
    // projects are untouched (this branch never runs for them).
    if (projectName === COOPERATIVE_1881_PROJECT_NAME && typeof fullScopeBid.fullScopeTotal === 'number') {
      try {
        const realTakeoff = readCooperative1881RealTakeoff();
        const referenceTotal = realTakeoff.total; // 538,792.35 single-building proposal total
        const deltaUsd = round2(fullScopeBid.fullScopeTotal - referenceTotal);
        const deltaPct = referenceTotal
          ? round2((deltaUsd / referenceTotal) * 100)
          : 0;
        const m = fullScopeBid;
        // The real takeoff bundles equipment alongside labor at the cost level,
        // so compare labor (+ equipment) like the Home Depot calibration. Misc +
        // subcontractor map to the model's soft-cost + OH&P roll-up.
        const modelSoftPlusOhp = round2((m.softCostTotal || 0) + (m.ohp?.ohpTotal || 0));
        const realLaborPlusEquip = round2(realTakeoff.cost.labor + realTakeoff.cost.equipment);
        const realDesignSub = round2(realTakeoff.cost.subcontractor + realTakeoff.cost.miscellaneous);
        const cmp = (label, modelUsd, realUsd) => ({
          label,
          modelUsd: round2(modelUsd),
          realUsd: round2(realUsd),
          deltaUsd: round2((modelUsd || 0) - (realUsd || 0)),
        });
        fullScopeBid.calibration = {
          source: 'cooperative-1881-proposal',
          referenceTotal,
          fullScopeTotal: fullScopeBid.fullScopeTotal,
          deltaUsd,
          deltaPct,
          realTakeoff,
          byCategory: {
            basis: 'cost (un-marked-up) — model estimate categories vs real ESI/Knowify takeoff categories',
            rows: [
              cmp('materials', m.materialsOnly, realTakeoff.cost.material),
              cmp('labor (+ equipment)', m.laborCost, realLaborPlusEquip),
              cmp('system components', m.systemComponentCost, 0),
              cmp('design (sub + misc)', modelSoftPlusOhp, realDesignSub),
            ],
            note: 'informational itemized comparison only — not an accuracy or '
              + 'parity claim, and it clears no regulated gate. Residential '
              + 'standard-spray materials are well-modeled by the engine, so this '
              + 'is an honest second calibration check distinct from the ESFR '
              + 'Home Depot job.',
          },
          note: 'informational comparison only — not an accuracy or parity claim, '
            + 'and it clears no regulated gate. The full-scope figure is a '
            + 'best-effort estimate, not a complete or quoted bid. The reference '
            + 'is the REAL single-building proposal total (538,792.35).',
        };
      } catch (takeoffErr) {
        // Absent or unparseable workbook: omit calibration entirely (fail-soft).
        log.warn?.('cooperative-1881 real takeoff unavailable', { error: takeoffErr.message });
      }
    }
  } catch (e) {
    fullScopeBid = { error: e.message };
  }

  return { projectName, floorPlan, building, replayInput, bid, scene, cadModel, hydraulics, hydraulicNetwork, compliance, fullScopeBid };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Best-effort sprinkler auto-layout + auto-bid + hydraulic network balance +
// NFPA-13 geometric compliance. Fail-closed: NEVER clears any regulated gate.
app.post('/api/projects/:name/sprinkler-bid', authMiddleware, async (req, res) => {
  try {
    const prebuilt = await resolvePdfFloorPlan(req);
    const out = runSprinklerPipeline(req, prebuilt);
    if (out.httpError) return res.status(out.httpError.status).json({ error: out.httpError.error });
    const { bid, scene, cadModel, hydraulics, hydraulicNetwork, compliance, fullScopeBid, building, replayInput } = out;
    res.json({ bid, scene, cadModel, hydraulics, hydraulicNetwork, compliance, fullScopeBid, isBuilding: !!building, ...(replayInput ? { replayInput, roomBoundaryReplay: replayInput } : {}), ...(prebuilt && prebuilt.pdfMeta ? { pdfMeta: prebuilt.pdfMeta } : {}) });
  } catch (err) {
    res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

// Best-effort downloadable SUBMITTAL package (head/pipe schedules, hydraulic
// summary, BOM, gate status). Fail-closed: header honesty flags stay false,
// gateStatus.submittalReady stays false, and the AUTOSPRINK_PARITY gate stays
// blocked — this clears NO regulated gate.
app.post('/api/projects/:name/submittal', authMiddleware, async (req, res) => {
  try {
    const prebuilt = await resolvePdfFloorPlan(req);
    const out = runSprinklerPipeline(req, prebuilt);
    if (out.httpError) return res.status(out.httpError.status).json({ error: out.httpError.error });
    const { projectName, bid, cadModel, hydraulics, hydraulicNetwork, compliance } = out;
    const pkg = buildSubmittal({
      project: { name: projectName },
      bid,
      cadModel,
      // Prefer the full network balance when it ran; fall back to the single-path
      // estimate. Either way it is best-effort and carries its own disclaimer.
      hydraulics: (hydraulicNetwork && !hydraulicNetwork.error) ? hydraulicNetwork : hydraulics,
      compliance: (compliance && !compliance.error) ? compliance : null,
    });
    // Optional PDF render via an injected tool invoker. No server-side invoker is
    // wired here, so renderSubmittalPdf returns a { skipped } shape (never throws)
    // — surfaced honestly so the studio can show that no PDF was produced.
    let pdf = null;
    if (req.body && (req.body.pdf === true || req.body.pdf === 'true')) {
      pdf = await renderSubmittalPdf(pkg);
    }
    const safeName = String(projectName).replace(/[^A-Za-z0-9._-]+/g, '_') || 'project';
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-submittal.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(pdf ? { ...pkg, pdf } : pkg);
  } catch (err) {
    res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

// Export the CAD model as an AutoCAD-openable DXF (layered 3D wireframe:
// building shell, sized piping centerlines, head symbols, pipe-size labels).
app.post('/api/projects/:name/cad.dxf', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    let floorPlan = null;
    if (req.body && typeof req.body.svg === 'string' && req.body.svg.trim()) {
      floorPlan = floorPlanFromSvg(req.body.svg, { name: projectName, unitsPerPx: Number(req.body.unitsPerPx) || 1 });
    } else if (req.body && req.body.floorPlan) {
      floorPlan = normalizeFloorPlan(req.body.floorPlan);
    } else if (projectName === HOME_DEPOT_PROJECT_NAME) {
      floorPlan = homeDepotRexburgFloorPlan();
    }
    if (!floorPlan) return res.status(400).json({ error: 'No floor plan for DXF export' });
    const dxf = toDxf(buildCadModel(floorPlan));
    res.setHeader('Content-Type', 'application/dxf');
    res.setHeader('Content-Disposition', `attachment; filename="${projectName.replace(/[^a-z0-9]+/gi, '_')}.dxf"`);
    res.send(dxf);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Settings: documentation upload/link + dependency status (T19) ──
// Docs we cannot auto-source (catalogs, cut sheets, approvals, the AutoSprink
// reference, the OpenSCAD binary, pricebook updates) are user-uploaded/LINKED in
// Settings and wired to the evidence system. A slot is 'missing' until a real
// link/upload row exists; recording one inserts a present project_evidence row so
// it can satisfy resolve-gate evidence. HONESTY/fail-closed: a catalog upload is
// evidence, but it NEVER auto-clears a regulated claim gate — AHJ/PE/AutoSprink
// parity gates still require their specific approved evidence types (T5 rules).
const REQUIRED_DOC_SLOTS = [
  { doc_type: 'catalogs', label: 'Manufacturer / vendor component catalogs', project_name: 'HaloFire Library' },
  { doc_type: 'manufacturer_cut_sheets', label: 'Manufacturer cut sheets', project_name: 'HaloFire Library' },
  { doc_type: 'ahj_approval', label: 'Authority Having Jurisdiction approval', project_name: 'HaloFire Library' },
  { doc_type: 'autosprink_reference', label: 'AutoSprink reference packet', project_name: 'HaloFire Library' },
  { doc_type: 'openscad_binary', label: 'OpenSCAD binary path', project_name: 'HaloFire Library' },
  { doc_type: 'pricebook_updates', label: 'Pricebook updates', project_name: 'HaloFire Library' },
];
const DOC_SLOT_BY_TYPE = new Map(REQUIRED_DOC_SLOTS.map((slot) => [slot.doc_type, slot]));
const SETTINGS_DOC_FIELDS = new Set(['doc_type', 'mode', 'url', 'filename', 'notes']);

function openscadInstalled() {
  // Detect the external OpenSCAD CLI without spawning a render. Best-effort and
  // honest: false when not on PATH or detection itself fails.
  try {
    const result = spawnSync('openscad', ['--version'], { timeout: 4000, stdio: 'ignore' });
    return result.status === 0 || (!result.error && result.status === null);
  } catch {
    return false;
  }
}

app.get('/api/settings/documents', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM settings_documents ORDER BY created_at DESC, id DESC').all();
  const byType = new Map();
  for (const row of rows) {
    if (!byType.has(row.doc_type)) byType.set(row.doc_type, row);
  }
  res.json(REQUIRED_DOC_SLOTS.map((slot) => {
    const latest = byType.get(slot.doc_type) || null;
    const satisfied = Boolean(latest);
    return {
      doc_type: slot.doc_type,
      label: slot.label,
      status: satisfied ? 'satisfied' : 'missing',
      satisfied,
      latest,
    };
  }));
});

app.post('/api/settings/documents', authMiddleware, requireRole('admin'), (req, res) => {
  const rejected = Object.keys(req.body).filter((key) => !SETTINGS_DOC_FIELDS.has(key));
  if (rejected.length) return res.status(400).json({ error: `Unsupported fields: ${rejected.join(', ')}` });
  const { doc_type, mode, url = null, filename = null, notes = null } = req.body;
  const slot = DOC_SLOT_BY_TYPE.get(doc_type);
  if (!slot) {
    return res.status(400).json({ error: `Unknown doc_type; must be one of: ${[...DOC_SLOT_BY_TYPE.keys()].join(', ')}` });
  }
  if (mode !== 'link' && mode !== 'upload') {
    return res.status(400).json({ error: "mode must be 'link' or 'upload'" });
  }
  if (mode === 'link' && (!url || !String(url).trim())) {
    return res.status(400).json({ error: 'url is required for mode=link' });
  }
  if (mode === 'upload' && (!filename || !String(filename).trim())) {
    return res.status(400).json({ error: 'filename is required for mode=upload' });
  }

  // A real link/upload is recorded as PRESENT evidence so it can satisfy a
  // resolve-gate evidence requirement — but recording it here never clears a
  // gate by itself (fail-closed; gates clear only via the T5 resolve route).
  const sourceRef = mode === 'link' ? String(url) : String(filename);
  const evidenceNotes = `Settings ${mode} for ${doc_type}${notes ? `: ${notes}` : ''}`;
  const tx = db.transaction(() => {
    const evidence = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(slot.project_name, doc_type, mode === 'upload' ? String(filename) : null, sourceRef, 'present', evidenceNotes);
    const doc = db
      .prepare(`INSERT INTO settings_documents (doc_type, mode, url, filename, notes, evidence_id, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(doc_type, mode, url, filename, notes, evidence.lastInsertRowid, req.user.username);
    return { id: doc.lastInsertRowid, evidence_id: evidence.lastInsertRowid };
  });
  const result = tx();
  res.status(200).json({ ...result, doc_type, status: 'satisfied', message: 'Document recorded' });
});

app.get('/api/settings/dependencies', authMiddleware, (req, res) => {
  const hasSamRef = db
    .prepare("SELECT COUNT(*) c FROM settings_documents WHERE doc_type = 'autosprink_reference'")
    .get().c > 0;
  res.json({
    openscad_installed: openscadInstalled(),
    sam_gateway: 'unknown', // GX10 'sam3' via OpenClaw bridge — status not probed here.
    autosprink_reference: hasSamRef ? 'linked' : 'missing',
  });
});

// ── Parity matrix + fail-closed AUTOSPRINK_PARITY gate status (P6) ──
// Reports FUNCTIONAL feature-area coverage only. The AHJ/PE/manufacturer-exact
// rows are GATED: they require real-world evidence and are never auto-present.
// HONESTY/fail-closed: this surface NEVER flips the AUTOSPRINK_PARITY gate. The
// gate is derived from an EMPTY component inventory (no manufacturer-exact models
// proven here), so it stays 'blocked', and parityAchieved stays false.
app.get('/api/parity', authMiddleware, (req, res) => {
  // The deterministic engine modules below all exist and emit output, so their
  // functional areas are PRESENT. PDF drawing import is still deferred, so the
  // gated rows (AHJ/PE/manufacturer-exact) carry NO real evidence here.
  const state = {
    drawingImport: true,
    buildingModeling: true,
    headLayout: true,
    scheduleSizing: true,
    hydraulicNetwork: true,
    nfpaCompliance: true,
    supports: true,
    componentLibrary: true,
    submittal: true,
    cadExport: true,
    bidBom: true,
    evidenceSettings: true,
    // GATED: no real AHJ/PE/manufacturer evidence is asserted by this surface.
    ahjEvidence: false,
    peEvidence: false,
    manufacturerEvidence: false,
  };
  const matrix = buildParityMatrix(state);
  // Component model inventory is empty here -> no manufacturer-exact models ->
  // the AUTOSPRINK_PARITY gate is fail-closed BLOCKED.
  const inventory = buildParityInventory({});
  const gateStatus = parityGateStatus(inventory);
  res.json({
    matrix,
    parityAchieved: parityAchieved(matrix, { generatedOnly: false, inventory }),
    gate: {
      code: AUTOSPRINK_PARITY_GATE.code,
      severity: AUTOSPRINK_PARITY_GATE.severity,
      status: gateStatus, // always 'blocked' from an empty inventory (fail-closed)
      blockedClaims: AUTOSPRINK_PARITY_GATE.blockedClaims,
      reason: AUTOSPRINK_PARITY_GATE.reason,
    },
    disclaimer: matrix.disclaimer,
  });
});

// ── Part-mesh manifest (R2) ──
// Serves the prebuilt parts/parts-manifest.json when present (written by
// `npm run build:parts`), else computes a LIVE all-from-registry manifest with
// no runner (every part 'missing'). The parts/<key>.stl files themselves are
// reachable via the repo-root static mount (line ~278), so no extra static
// route is needed.
// HONESTY/fail-closed: generated meshes are best-effort, NOT manufacturer-exact.
// manufacturerExactCount is 0 for generated/missing parts; it only rises when a
// user attaches a real catalog model (manufacturer+license) via the R4 override
// route. EITHER WAY the AUTOSPRINK_PARITY gate stays hardcoded 'blocked' (parity
// needs manufacturer-exact models for EVERY required part + PE/AHJ review). No STL
// is ever fabricated for a part without a real mesh.
const PARTS_MANIFEST_PATH = path.resolve(__dirname, '../../parts/parts-manifest.json');
// S5: the autonomous part-sourcing run (scripts/auto-source-run.mjs) writes its
// observable status here, relative to the repo root (same place the script writes).
const AUTO_SOURCE_STATUS_PATH = path.resolve(__dirname, '../../out/auto-source-status.json');
const PARTS_DISCLAIMER =
  'Generated part meshes are best-effort parametric massing — NOT ' +
  'manufacturer-exact and conferring NO AutoSprink/AutoCAD/AHJ/PE approval. ' +
  'The AUTOSPRINK_PARITY gate stays BLOCKED.';

// A part is manufacturer-exact ONLY if it comes from a real licensed
// catalog/manufacturer source. Generated/missing parts (and any tampered
// on-disk manifest entry) are coerced to manufacturerExact:false here so the
// served manifest can never leak a false manufacturer-exact claim.
const REAL_PART_SOURCES = new Set(['catalog', 'manufacturer']);
function sanitizePartEntry(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const source = typeof e.source === 'string' ? e.source : 'missing';
  return { ...e, source, manufacturerExact: REAL_PART_SOURCES.has(source) && e.manufacturerExact === true };
}

// Only these formats are web-renderable 3D meshes. A non-mesh upload (STEP/DWG)
// is recorded as catalog evidence but carries NO renderable file (file stays
// null, present stays false) — we never fabricate a mesh from CAD source.
const WEB_MESH_FORMATS = new Set(['stl', 'glb', 'gltf', 'obj']);
const PART_OVERRIDE_FIELDS = new Set(['mode', 'url', 'filename', 'format', 'manufacturer', 'license', 'notes']);

// Merge user-attached catalog part overrides over a base manifest's components.
// For an overridden key: source -> 'catalog'; manufacturerExact -> true ONLY when
// BOTH a manufacturer AND a license were attested; file/present -> set ONLY for a
// web-renderable mesh format. Every merged entry is re-run through
// sanitizePartEntry (defense in depth: it re-affirms the source-set guard so a
// tampered row can never leak a false manufacturer-exact claim). Overrides NEVER
// touch parityGateStatus — that gate stays hardcoded 'blocked' at the call site.
function mergePartOverrides(components) {
  let rows;
  try {
    rows = db.prepare('SELECT * FROM part_overrides ORDER BY created_at DESC, id DESC').all();
  } catch {
    return components;
  }
  const byKey = new Map();
  for (const row of rows) {
    if (!byKey.has(row.key)) byKey.set(row.key, row); // latest override per component
  }
  return components.map((c) => {
    const o = byKey.get(c.key);
    if (!o) return c;
    const fmt = o.format ? String(o.format).toLowerCase() : null;
    const isWebMesh = Boolean(fmt && WEB_MESH_FORMATS.has(fmt));
    const manufacturerExact = Boolean(
      o.manufacturer && String(o.manufacturer).trim() && o.license && String(o.license).trim(),
    );
    return sanitizePartEntry({
      ...c,
      source: 'catalog',
      manufacturer: o.manufacturer || null,
      license: o.license || null,
      provenance: o.mode === 'link' ? 'catalog_link' : 'catalog_upload',
      format: isWebMesh ? fmt : null,
      file: isWebMesh ? (o.ref || null) : null, // web mesh only; non-mesh => null
      present: isWebMesh ? Boolean(o.ref) : false,
      manufacturerExact, // sanitizePartEntry re-affirms source ∈ {catalog,manufacturer}
    });
  });
}

// Recompute the honest count fields from a (possibly override-merged) component
// list. parityGateStatus is intentionally NOT derived here — see call sites.
function recountParts(components) {
  return {
    generatedCount: components.filter((c) => c.source === 'generated' && c.present === true).length,
    missingCount: components.filter((c) => c.present !== true).length,
    manufacturerExactCount: components.filter((c) => c.manufacturerExact === true).length,
  };
}

app.get('/api/parts', authMiddleware, async (req, res) => {
  // Prefer a prebuilt on-disk manifest.
  try {
    if (fs.existsSync(PARTS_MANIFEST_PATH)) {
      const raw = JSON.parse(fs.readFileSync(PARTS_MANIFEST_PATH, 'utf8'));
      const base = (Array.isArray(raw.components) ? raw.components : []).map(sanitizePartEntry);
      const components = mergePartOverrides(base);
      return res.json({
        components,
        ...recountParts(components),
        parityGateStatus: 'blocked', // fail-closed: found/generated/override parts never clear parity
        disclaimer: raw.disclaimer || PARTS_DISCLAIMER,
      });
    }
  } catch (err) {
    log.warn(`parts manifest read failed: ${err.message}`);
  }

  // No prebuilt manifest -> live registry view with no runner (all 'missing').
  const manifest = await buildPartManifest({});
  const components = mergePartOverrides(manifest.components);
  res.json({
    components,
    ...recountParts(components),
    parityGateStatus: 'blocked',
    disclaimer: PARTS_DISCLAIMER,
  });
});

// ── Per-component catalog part override (R4) ──
// A user attaches a real catalog/manufacturer part for one component via Settings
// to override its generated/missing mesh. This is the ONLY path to source
// 'catalog' + manufacturerExact:true (the build pipeline only produces
// generated/missing and is hardcoded manufacturerExact:false).
// HONESTY/fail-closed: attaching a part is recorded as PRESENT catalog evidence,
// but it NEVER clears AUTOSPRINK_PARITY — that gate requires manufacturer-exact
// models for EVERY required component PLUS licensed PE/AHJ review, none of which
// a single upload provides. GET /api/parts keeps parityGateStatus hardcoded
// 'blocked'. A non-mesh format (STEP/DWG) is recorded but is NOT web-renderable
// (file stays null); we never fabricate a renderable mesh or a license.
app.post('/api/parts/:key/override', authMiddleware, requireRole('admin'), (req, res) => {
  const rejected = Object.keys(req.body).filter((k) => !PART_OVERRIDE_FIELDS.has(k));
  if (rejected.length) return res.status(400).json({ error: `Unsupported fields: ${rejected.join(', ')}` });

  const key = req.params.key;
  if (!getComponent(key)) return res.status(404).json({ error: 'Unknown component key' });

  const { mode, url = null, filename = null, format = null, manufacturer = null, license = null, notes = null } = req.body;
  if (mode !== 'link' && mode !== 'upload') {
    return res.status(400).json({ error: "mode must be 'link' or 'upload'" });
  }
  const ref = mode === 'link' ? url : filename;
  if (!ref || !String(ref).trim()) {
    return res.status(400).json({ error: mode === 'link' ? 'url is required for mode=link' : 'filename is required for mode=upload' });
  }

  const fmt = format ? String(format).toLowerCase() : null;
  const isWebMesh = Boolean(fmt && WEB_MESH_FORMATS.has(fmt));
  // manufacturerExact requires BOTH a manufacturer AND a license attestation.
  const manufacturerExact = Boolean(
    manufacturer && String(manufacturer).trim() && license && String(license).trim(),
  );

  const evidenceNotes =
    `Catalog part override (${mode}) for ${key}` +
    `${manufacturer ? ` — mfr ${manufacturer}` : ''}` +
    `${license ? `, license ${license}` : ''}` +
    `${isWebMesh ? '' : ' [non-mesh: recorded as evidence, not web-renderable]'}` +
    `${notes ? `: ${notes}` : ''}`;

  const tx = db.transaction(() => {
    const evidence = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run('HaloFire Library', 'catalog_part', mode === 'upload' ? String(ref) : null, String(ref), 'present', evidenceNotes);
    const ov = db
      .prepare(`INSERT INTO part_overrides (key, mode, ref, format, manufacturer, license, notes, evidence_id, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(key, mode, String(ref), fmt, manufacturer, license, notes, evidence.lastInsertRowid, req.user.username);
    return { id: ov.lastInsertRowid, evidence_id: evidence.lastInsertRowid };
  });
  const result = tx();
  res.status(200).json({
    ...result,
    key,
    source: 'catalog',
    manufacturerExact,
    message: 'Part override recorded',
  });
});

// Remove the override(s) for a component (admin). Returns 404 if none exist so
// the caller knows nothing was changed.
app.delete('/api/parts/:key/override', authMiddleware, requireRole('admin'), (req, res) => {
  const key = req.params.key;
  if (!getComponent(key)) return res.status(404).json({ error: 'Unknown component key' });
  const info = db.prepare('DELETE FROM part_overrides WHERE key = ?').run(key);
  if (info.changes === 0) return res.status(404).json({ error: 'No override for component key' });
  res.status(200).json({ key, removed: info.changes, message: 'Part override removed' });
});

function safeParseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Public summary (pre-login landing): real, non-sensitive scale counts ──
app.get('/api/public/summary', (req, res) => {
  const count = (sql) => { try { return db.prepare(sql).get().c; } catch { return 0; } };
  res.json({
    status: 'internal-alpha',
    bidsTracked: count('SELECT COUNT(*) c FROM bids'),
    pricebookItems: count('SELECT COUNT(*) c FROM pricebook'),
    sourceWorkbooks: 4, // ARGCO, FFF, Victaulic pricebooks + bid log
    claimGates: count('SELECT COUNT(*) c FROM claim_gates'),
  });
});

// ── Auto-source run status (S5) ──
// Read-only observability of the autonomous part-sourcing loop (NOT admin-only).
// HONESTY/fail-closed: nothing here is manufacturer-exact and auto-sourced parts
// NEVER clear parity. We DEFENSIVELY re-force parityGateStatus 'blocked' +
// manufacturerExactCount 0 on the response so a tampered status file can never
// surface a cleared gate (mirrors the /api/parts sanitize discipline). If the file
// is missing/unreadable we return a 200 'never-run' status — never a 500.
app.get('/api/auto-source/status', authMiddleware, (req, res) => {
  try {
    if (fs.existsSync(AUTO_SOURCE_STATUS_PATH)) {
      const status = JSON.parse(fs.readFileSync(AUTO_SOURCE_STATUS_PATH, 'utf8'));
      return res.json({
        ...status,
        // Re-forced regardless of file contents — auto-source never clears parity.
        parityGateStatus: 'blocked',
        manufacturerExactCount: 0,
      });
    }
  } catch (err) {
    log.warn(`auto-source status read failed: ${err.message}`);
  }
  return res.json({
    status: 'never-run',
    parityGateStatus: 'blocked',
    manufacturerExactCount: 0,
    sourceAcquisitionLedger: buildSourceAcquisitionLedger({}, new Date(0).toISOString()),
    note: 'Auto-source loop has not run yet.',
  });
});

// ── Health Check ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', uptime: process.uptime() });
});

// ── Serve SPA ──
app.get('*', (req, res) => {
  // T9: serve the landing (index) for unknown routes; the legacy app.html
  // dashboard is retired (now a redirect to the real workbench/studio).
  res.sendFile(path.resolve(__dirname, '../../index.html'));
});

// ── Start ──
app.listen(PORT, () => {
  log.info(`HaloFire API running on port ${PORT}`);
});

export default app;
