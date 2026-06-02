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
import { buildSourceAcquisitionLedger, makeBridgeInvoker, probeBridge } from '../components/auto-source-runner.js';
import { balanceNetwork } from '../engine/hydraulic-network.js';
import { checkCompliance } from '../engine/nfpa-compliance.js';
import { buildSubmittal, renderSubmittalPdf } from '../engine/submittal.js';
import { homeDepotRexburgFloorPlan, cooperative1881FloorPlan, COOPERATIVE_1881_PROJECT_NAME } from '../data/floorplans.js';
import { HOME_DEPOT_PROJECT_NAME } from '../data/evidence-gates.js';
import { readHomeDepotBidPackage, readHomeDepotRealTakeoff } from '../data/home-depot-bid-package.js';
import { readCooperative1881BidPackage, readCooperative1881RealTakeoff } from '../data/cooperative-1881-bid-package.js';
import { buildPlanSegmentationPayload } from '../components/sam-floorplan.js';
import { SAM31_FLOORPLAN_TOOL } from '../sam31/bridge.js';
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
const EVIDENCE_INSERT_FIELDS = new Set(['evidence_type', 'source_file', 'source_ref', 'status', 'notes', 'signoff']);

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

function hasStructuredSignedReviewerNotes(row) {
  if (!row?.notes || typeof row.notes !== 'string') return false;
  try {
    const parsed = JSON.parse(row.notes);
    return Boolean(
      parsed
      && parsed.kind === 'signed_reviewer_evidence'
      && parsed.signoff
      && parsed.signoff.reviewer_name
      && parsed.signoff.reviewer_title
      && parsed.signoff.signed_at,
    );
  } catch {
    return false;
  }
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
      source_openclaw_sam31_extrapolation_evidence_id: notes.source_openclaw_sam31_extrapolation_evidence_id,
      source_openclaw_sam31_extrapolation_review_evidence_id: notes.source_openclaw_sam31_extrapolation_review_evidence_id,
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
    openclaw_sam31_extrapolation_product_review_packet: notes.openclaw_sam31_extrapolation_product_review_packet || null,
    sam31_downstream_review_metadata: notes.sam31_downstream_review_metadata || null,
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
  const { evidence_type, source_file = null, source_ref = null, status, notes = null, signoff } = req.body;
  if (!evidence_type || !status) {
    return res.status(400).json({ error: 'evidence_type and status are required' });
  }
  let storedNotes = notes;
  try {
    const normalizedSignoff = normalizeSignedReviewerSignoff(evidence_type, signoff);
    if (normalizedSignoff) {
      storedNotes = JSON.stringify({
        kind: 'signed_reviewer_evidence',
        evidence_type,
        source_ref,
        signoff: normalizedSignoff,
        user_notes: notes,
        claim_gate_effect: 'no_claims_cleared',
      });
    }
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
  const result = db
    .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.params.name, evidence_type, source_file, source_ref, status, storedNotes);
  res.status(201).json({ id: result.lastInsertRowid, message: 'Evidence recorded' });
});

// Resolve a fail-closed claim gate. Admin-only, and only with a real evidence
// artifact. The evidence row is recorded (status 'present') and the gate is
// flipped blocked->cleared with who/what/when provenance. Best-effort/AI
// evidence is rejected and the gate stays blocked — fail-closed by design.
app.post('/api/projects/:name/claim-gates/:code/resolve', authMiddleware, requireRole('admin'), (req, res) => {
  const projectName = req.params.name;
  const code = req.params.code;
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
  const resolvedAt = new Date().toISOString();
  const requestedEvidenceId = Number(req.body?.evidence_id);
  if (Number.isFinite(requestedEvidenceId) && requestedEvidenceId > 0) {
    const existingEvidence = db
      .prepare('SELECT * FROM project_evidence WHERE project_name = ? AND id = ?')
      .get(projectName, requestedEvidenceId);
    if (!existingEvidence) {
      return res.status(404).json({ error: 'Existing evidence row not found for this project' });
    }
    const evidenceType = existingEvidence.evidence_type;
    if (!GATE_CLEARING_EVIDENCE_TYPES.has(evidenceType)) {
      return res.status(400).json({
        error: `evidence_type '${evidenceType}' cannot clear a gate; must be one of: ${[...GATE_CLEARING_EVIDENCE_TYPES].join(', ')}`,
      });
    }
    if (!rule.allowedEvidenceTypes.includes(evidenceType)) {
      return res.status(400).json({
        error: `Gate ${code} only accepts allowed evidence types: ${rule.allowedEvidenceTypes.join(', ')}`,
      });
    }
    if (String(existingEvidence.status) !== 'present') {
      return res.status(400).json({ error: "existing evidence row must have status 'present' to clear a gate" });
    }
    if (SIGNED_REVIEW_EVIDENCE_TYPES.has(evidenceType) && !hasStructuredSignedReviewerNotes(existingEvidence)) {
      return res.status(400).json({ error: 'existing evidence row is missing signed reviewer metadata required for this gate' });
    }
    db.prepare(`UPDATE claim_gates
                SET status = 'cleared', resolved_by = ?, resolved_at = ?, resolved_evidence_ref = ?
                WHERE project_name = ? AND code = ?`)
      .run(req.user.username, resolvedAt, existingEvidence.source_ref, projectName, code);
    return res.status(200).json({
      cleared: true,
      code,
      resolved_by: req.user.username,
      resolved_at: resolvedAt,
      resolved_evidence_id: existingEvidence.id,
      resolved_evidence_ref: existingEvidence.source_ref,
    });
  }

  const evidence = req.body?.evidence;
  if (!evidence || typeof evidence !== 'object') {
    return res.status(400).json({ error: 'Provide either evidence_id or a real evidence object to clear a gate' });
  }
  const { evidence_type, source_ref = null, source_file = null, notes = null } = evidence;
  if (!evidence_type || !source_ref) {
    return res.status(400).json({ error: 'evidence.evidence_type and evidence.source_ref are required' });
  }
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

const SAM31_SUPPORTED_APPLICATIONS = Object.freeze(['halo_fire', 'landscout', 'nameforge']);

const SAM31_BLOCKED_CLAIMS = Object.freeze(uniqueStrings([
  ...PDF_BOUNDARY_BLOCKED_CLAIMS,
  'engineering_grade',
  'survey_grade',
]));

const SAM31_EMPLOYEE_REPLACEMENT_FIELDS = Object.freeze([
  'semantic_label',
  'polygon',
  'bbox',
  'object_hypothesis',
  'vector_overlay',
  'model_3d_candidate',
  'source_ref',
  'confidence',
]);

const SAM31_EXTRAPOLATION_REVIEW_FIELDS = Object.freeze([
  'sections',
  'object_hypotheses',
  'vector_overlays',
  'model_3d_candidates',
  'semantic_labels',
  'source_ref',
  'confidence',
]);

const SAM31_EXTRAPOLATION_CONTRACT_REF = 'openclaw.sam31_extrapolation_contract';

const SAM31_EXTRAPOLATION_CONTRACT = Object.freeze({
  artifact_type: SAM31_EXTRAPOLATION_CONTRACT_REF,
  status: 'best_effort_extrapolation_ready',
  source_runtime: 'sam-3.1+llm',
  consumes: ['segments', 'object_hypotheses'],
  produces: ['llm_observations', 'vector_overlays', 'model_3d_candidates', 'extrapolation_index'],
  supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
  temporary_value_policy: 'Generated object labels, vector overlays, and 3D candidates are editable best guesses until HaloFire employees or owning product reviewers replace them with actual values.',
  claim_gate_effect: 'no_claims_cleared',
});

const SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE = 'openclaw.sam31.product_review_queue_item.v1';
const SAM31_CONSUMER_SMOKE_ARTIFACT_TYPE = 'openclaw.sam31.consumer_smoke_artifact.v1';
const SAM31_CONSUMER_REVIEW_TASK_TYPE = 'openclaw.sam31.consumer_review_task.v1';
const SAM31_CONSUMER_REVIEW_DECISION_TYPE = 'openclaw.sam31.consumer_review_task_decision.v1';
const SAM31_PRODUCT_OWNER_REPLACEMENT_INTAKE_TYPE = 'openclaw.sam31.product_owner_replacement_intake.v1';
const SAM31_TO_SPRINKLER_REVIEW_ADAPTER_TYPE = 'openclaw.sam31_to_sprinkler_review_adapter.v1';
const HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE = 'halofire.sam31_sprinkler_review_packet.v1';
const HALOFIRE_SAM31_SPRINKLER_REVIEW_QUEUE_ITEM_TYPE = 'halofire.sam31_sprinkler_review_queue_item.v1';
const HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_TYPE = 'halofire.sam31_sprinkler_review_decision.v1';
const HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_PACKET_TYPE = 'halofire.sam31_sprinkler_review_decision_packet.v1';
const HALOFIRE_SAM31_SPRINKLER_REVIEW_PRELIMINARY_REPLAY_INPUTS_TYPE = 'halofire.sam31_sprinkler_review_preliminary_replay_inputs.v1';
const HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_QUEUE_ITEM_TYPE = 'halofire.sam31_sprinkler_preliminary_replay_queue_item.v1';
const HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_ARTIFACT_TYPE = 'halofire.sam31_sprinkler_preliminary_replay_artifact.v1';
const HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_OUTPUT_TYPE = 'halofire.sam31_sprinkler_preliminary_replay_output.v1';
const HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_FOLLOWUP_DECISION_TYPE = 'halofire.sam31_sprinkler_preliminary_replay_followup_decision.v1';
const HALOFIRE_SAM31_OBSTRUCTION_CLASH_PACKET_QUEUE_ITEM_TYPE = 'halofire.sam31_obstruction_clash_packet_queue_item.v1';
const HALOFIRE_SAM31_SLEEVE_FIRESTOP_PACKET_QUEUE_ITEM_TYPE = 'halofire.sam31_sleeve_firestop_packet_queue_item.v1';
const SAM31_CONSUMER_QUEUE_TARGETS = Object.freeze(['landscout', 'nameforge']);
const SAM31_CONSUMER_UNAVAILABLE_CODES = Object.freeze({
  landscout: 'OPENCLAW_SAM31_LANDSCOUT_QUEUE_UNAVAILABLE',
  nameforge: 'OPENCLAW_SAM31_NAMEFORGE_QUEUE_UNAVAILABLE',
});
const SAM31_CONSUMER_QUEUE_URL_ENV = Object.freeze({
  landscout: 'OPENCLAW_SAM31_LANDSCOUT_QUEUE_URL',
  nameforge: 'OPENCLAW_SAM31_NAMEFORGE_QUEUE_URL',
});
const SAM31_CONSUMER_REVIEW_FIELDS = Object.freeze([
  'semantic_labels',
  'object_hypotheses',
  'vector_overlays',
  'model_3d_candidates',
  'source_ref',
  'confidence',
]);

const SAM31_APPLICATION_CONTRACTS = Object.freeze({
  halo_fire: {
    contract_ref: 'openclaw.sam31.application_contract.halo_fire.v1',
    supported_evidence_lanes: [
      'room_boundary_visual_audit',
      'sleeve_or_firestop_candidate_review',
      'obstruction_or_clash_review',
      'vector_overlay_generation',
      'model_3d_candidate_generation',
    ],
    blocked_claims: [...SAM31_BLOCKED_CLAIMS],
  },
  landscout: {
    contract_ref: 'openclaw.sam31.application_contract.landscout.v1',
    supported_evidence_lanes: [
      'parcel_or_site_boundary_review',
      'map_marker_visual_audit',
      'roof_or_driveway_visual_review',
      'vector_overlay_generation',
      'model_3d_candidate_generation',
    ],
    blocked_claims: uniqueStrings([...SAM31_BLOCKED_CLAIMS, 'CEO_ready', 'production_ready']),
  },
  nameforge: {
    contract_ref: 'openclaw.sam31.application_contract.nameforge.v1',
    supported_evidence_lanes: [
      'logo_or_sign_vector_draft',
      'storefront_or_site_visual_review',
      'object_identification_review',
      'vector_overlay_generation',
      'model_3d_candidate_generation',
    ],
    blocked_claims: uniqueStrings([...SAM31_BLOCKED_CLAIMS, 'brand_ready', 'trademark_ready', 'production_ready']),
  },
});

const SAM31_APPLICATION_NEXT_ACTIONS = Object.freeze({
  halo_fire: 'Queue HaloFire room-boundary or sleeve/firestop review with SAM31 vector/3D best guesses; keep permit, AHJ, AutoSprink, fabrication, and manufacturer claims blocked.',
  landscout: 'Queue LandScout visual review with SAM31 vector/3D best guesses; keep CEO-ready and survey claims blocked.',
  nameforge: 'Queue NameForge creative review with SAM31 vector/3D best guesses; keep brand, trademark, and production claims blocked.',
});

function uniqueStrings(values) {
  return [...new Set((values || []).map((v) => String(v || '').trim()).filter(Boolean))];
}

function uniqueByJson(values) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const key = JSON.stringify(value);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

function normalizeOpenClawSam31ToolDescriptorPath(url) {
  const trimmed = String(url || '').trim().replace(/\/$/, '');
  if (!trimmed) return null;
  if (trimmed.endsWith('/vision/sam31/tool')) return trimmed;
  if (trimmed.endsWith('/vision/sam31/extrapolate')) {
    return `${trimmed.slice(0, -'/vision/sam31/extrapolate'.length)}/vision/sam31/tool`;
  }
  if (trimmed.endsWith('/vision/sam31/perception')) {
    return `${trimmed.slice(0, -'/vision/sam31/perception'.length)}/vision/sam31/tool`;
  }
  return `${trimmed}/vision/sam31/tool`;
}

function openClawSam31ToolDescriptorEndpointConfig(env = process.env) {
  const candidates = [
    ['OPENCLAW_SAM31_TOOL_URL', env.OPENCLAW_SAM31_TOOL_URL],
    ['OPENCLAW_SAM31_EXTRAPOLATE_URL', env.OPENCLAW_SAM31_EXTRAPOLATE_URL],
    ['OPENCLAW_PERCEPTION_URL', env.OPENCLAW_PERCEPTION_URL],
    ['OPENCLAW_API_URL', env.OPENCLAW_API_URL],
    ['HAL_API_URL', env.HAL_API_URL],
    ['OPENCLAW_BRIDGE_URL', env.OPENCLAW_BRIDGE_URL],
  ];
  for (const [sourceFile, rawUrl] of candidates) {
    const endpoint = normalizeOpenClawSam31ToolDescriptorPath(rawUrl);
    if (!endpoint) continue;
    return {
      endpoint,
      source_file: sourceFile,
    };
  }
  return { endpoint: null, source_file: null };
}

async function fetchOpenClawSam31CanonicalToolDescriptor(env = process.env, fetchImpl = globalThis.fetch) {
  const endpointConfig = openClawSam31ToolDescriptorEndpointConfig(env);
  if (!endpointConfig.endpoint) {
    return {
      endpoint: null,
      source_file: null,
      reachable: false,
      status: 'unavailable',
      descriptor: null,
      error: 'No OpenClaw/HAL SAM31 tool descriptor endpoint configured',
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(env.HALOFIRE_SAM31_TOOL_DESCRIPTOR_TIMEOUT_MS || env.HALOFIRE_SAM31_STATUS_TIMEOUT_MS || 3000),
  );
  try {
    const response = await fetchImpl(endpointConfig.endpoint, { signal: controller.signal });
    if (!response.ok) {
      return {
        ...endpointConfig,
        reachable: false,
        status: 'configured_unreachable',
        descriptor: null,
        error: `HTTP ${response.status}`,
      };
    }
    const descriptor = await response.json();
    if (!descriptor || typeof descriptor !== 'object') {
      return {
        ...endpointConfig,
        reachable: false,
        status: 'invalid_descriptor',
        descriptor: null,
        error: 'Descriptor response was not an object',
      };
    }
    return {
      ...endpointConfig,
      reachable: true,
      status: descriptor.status || 'ready',
      descriptor,
      error: null,
    };
  } catch (err) {
    return {
      ...endpointConfig,
      reachable: false,
      status: 'configured_unreachable',
      descriptor: null,
      error: err && err.name === 'AbortError' ? 'timeout' : String(err?.message || err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function openClawSam31BridgeStatus(env = process.env) {
  const bridgeUrl = String(env.OPENCLAW_BRIDGE_URL || '').trim();
  const configured = !!bridgeUrl;
  const toolEndpointConfig = openClawSam31ToolDescriptorEndpointConfig(env);
  return {
    artifact_type: 'openclaw.sam31_bridge_status',
    status: configured ? 'configured_unverified' : 'unavailable',
    tool_ref: 'pdfExtract:sam',
    source_runtime: 'openclaw.sam31',
    source_runtime_ref: 'sam-3.1+llm-openclaw-bridge',
    bridge_url_configured: configured,
    bridge_url: configured ? bridgeUrl : null,
    canonical_tool_descriptor_url: toolEndpointConfig.endpoint,
    canonical_tool_descriptor_source_file: toolEndpointConfig.source_file,
    canonical_tool_descriptor_status: toolEndpointConfig.endpoint ? 'configured_unverified' : 'unavailable',
    canonical_tool_descriptor_reachable: false,
    canonical_tool_descriptor: null,
    canonical_tool_descriptor_error: toolEndpointConfig.endpoint ? null : 'No OpenClaw/HAL SAM31 tool descriptor endpoint configured',
    consumer_queue_statuses: openClawSam31ConsumerQueueStatuses(null, toolEndpointConfig.endpoint, env),
    supported_applications: ['halo_fire', 'landscout', 'nameforge'],
    supported_evidence_lanes: [
      'room_boundary_visual_audit',
      'object_identification_review',
      'vector_overlay_generation',
      'model_3d_candidate_generation',
      'spatial_observation_correction_loop',
    ],
    blocked_claims: uniqueStrings([
      ...PDF_BOUNDARY_BLOCKED_CLAIMS,
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
      'professional_approval',
    ]),
    claim_gate_effect: 'no_claims_cleared',
    next_action: configured
      ? 'Run a live OpenClaw SAM31 bridge smoke for pdfExtract:sam and attach screenshot/console evidence before trusting runtime availability; regulated claims remain blocked.'
      : 'Set OPENCLAW_BRIDGE_URL to the governed OpenClaw SAM31 bridge, run npm run sam31:bridge or connect GX10/OpenClaw, then attach screenshot/console evidence; use saved employee replacements as local fallback only.',
    limitations: [
      'Bridge configuration or reachability is operational evidence only and does not clear geometry accuracy, AHJ, PE, AutoSprink, permit, fabrication, or manufacturer-exact claims.',
      'Unavailable or configured_unverified bridge status must fail closed to vector/SAM packet fallback and employee replacement workflows.',
    ],
  };
}

async function openClawSam31BridgeStatusWithProbe(env = process.env, fetchImpl = globalThis.fetch) {
  const base = openClawSam31BridgeStatus(env);
  if (!base.bridge_url_configured) {
    return {
      ...base,
      bridge_reachable: false,
      openclaw_status: null,
      sam31_status: null,
      probe_status_url: null,
      observed_at: new Date().toISOString(),
    };
  }
  const bridgeUrl = base.bridge_url;
  const probe = probeBridge({
    bridgeUrl,
    fetchImpl,
    timeoutMs: Number(env.HALOFIRE_SAM31_STATUS_TIMEOUT_MS || 3000),
  });
  const probed = await probe();
  const raw = probed.raw && typeof probed.raw === 'object' ? probed.raw : null;
  const sam31Status =
    raw?.services?.sam31?.status != null ? String(raw.services.sam31.status) : null;
  const bridgeReachable = !!probed.reachable;
  const toolDescriptor = await fetchOpenClawSam31CanonicalToolDescriptor(env, fetchImpl);
  const consumerQueueStatuses = openClawSam31ConsumerQueueStatuses(
    toolDescriptor.descriptor,
    toolDescriptor.endpoint,
    env,
  );
  return {
    ...base,
    status: bridgeReachable ? 'verified_reachable' : 'configured_unreachable',
    bridge_reachable: bridgeReachable,
    openclaw_status: probed.openclaw || null,
    sam31_status: sam31Status,
    probe_status_url: `${String(bridgeUrl).replace(/\/$/, '')}/status`,
    observed_at: new Date().toISOString(),
    raw_status: raw,
    canonical_tool_descriptor_url: toolDescriptor.endpoint,
    canonical_tool_descriptor_source_file: toolDescriptor.source_file,
    canonical_tool_descriptor_status: toolDescriptor.status,
    canonical_tool_descriptor_reachable: toolDescriptor.reachable,
    canonical_tool_descriptor: toolDescriptor.descriptor,
    canonical_tool_descriptor_error: toolDescriptor.error,
    consumer_queue_statuses: consumerQueueStatuses,
    next_action: bridgeReachable
      ? 'Bridge /status responded. Run a SAM31 pdfExtract:sam invocation smoke and attach screenshot/console evidence before relying on runtime output; regulated claims remain blocked.'
      : 'Configured OPENCLAW_BRIDGE_URL did not answer /status. Start or fix the governed OpenClaw SAM31 bridge, then re-run this status check; use saved employee replacements as local fallback only.',
    limitations: [
      ...base.limitations,
      'A reachable bridge proves only operational contact with the SAM31 bridge status route; it does not prove segmentation accuracy or clear professional/AHJ/manufacturer claims.',
    ],
  };
}

function trimBridgeUrl(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

function normalizeOpenClawSam31ExtrapolatePath(url) {
  const trimmed = trimBridgeUrl(url);
  if (trimmed.endsWith('/vision/sam31/extrapolate')) return trimmed;
  if (trimmed.endsWith('/vision/sam31/perception')) {
    return `${trimmed.slice(0, -'/vision/sam31/perception'.length)}/vision/sam31/extrapolate`;
  }
  return `${trimmed}/vision/sam31/extrapolate`;
}

function openClawSam31ExtrapolateEndpointConfig(env = process.env) {
  const candidates = [
    ['OPENCLAW_SAM31_EXTRAPOLATE_URL', env.OPENCLAW_SAM31_EXTRAPOLATE_URL],
    ['OPENCLAW_PERCEPTION_URL', env.OPENCLAW_PERCEPTION_URL],
    ['OPENCLAW_API_URL', env.OPENCLAW_API_URL],
    ['HAL_API_URL', env.HAL_API_URL],
    ['OPENCLAW_BRIDGE_URL', env.OPENCLAW_BRIDGE_URL],
  ];
  for (const [sourceFile, rawUrl] of candidates) {
    const direct = String(rawUrl || '').trim();
    if (!direct) continue;
    return {
      endpoint: normalizeOpenClawSam31ExtrapolatePath(direct),
      source_file: sourceFile,
    };
  }
  return { endpoint: null, source_file: null };
}

function normalizeOpenClawSam31ExtrapolateEndpoint(env = process.env) {
  return openClawSam31ExtrapolateEndpointConfig(env).endpoint;
}

function openClawSam31ExtrapolateStatus(env = process.env) {
  const endpointConfig = openClawSam31ExtrapolateEndpointConfig(env);
  const endpoint = endpointConfig.endpoint;
  return {
    artifact_type: 'openclaw.sam31_extrapolation_endpoint_status',
    status: endpoint ? 'configured_unverified' : 'unavailable',
    endpoint_configured: !!endpoint,
    endpoint,
    endpoint_source_file: endpointConfig.source_file,
    source_runtime: 'sam-3.1+llm',
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    supported_evidence_lanes: [
      'room_boundary_visual_audit',
      'object_identification_review',
      'vector_overlay_generation',
      'model_3d_candidate_generation',
      'spatial_observation_correction_loop',
    ],
    blocked_claims: uniqueStrings([
      ...PDF_BOUNDARY_BLOCKED_CLAIMS,
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
      'professional_approval',
    ]),
    claim_gate_effect: 'no_claims_cleared',
    next_action: endpoint
      ? 'Run OpenClaw SAM31 extrapolation against the visual-audit request and save the artifact as best-effort product-review evidence; regulated claims remain blocked.'
      : 'Set OPENCLAW_SAM31_EXTRAPOLATE_URL, OPENCLAW_PERCEPTION_URL, OPENCLAW_API_URL, HAL_API_URL, or OPENCLAW_BRIDGE_URL to an OpenClaw/HAL service exposing /vision/sam31/extrapolate.',
    limitations: [
      'Configured endpoint status is operational evidence only and does not clear geometry accuracy, AHJ, PE, AutoSprink, permit, fabrication, or manufacturer-exact claims.',
    ],
  };
}

function normalizeSam31SmokeRequest(projectName, body = {}) {
  const scale = Number(body.pdfScale ?? body.scale);
  if (!Number.isFinite(scale) || scale <= 0) {
    const e = new Error('A positive operator or drawing supplied pdfScale is required for SAM 3.1 smoke artifacts');
    e.httpStatus = 400;
    throw e;
  }
  const pageIndex = Number.isFinite(Number(body.pdfPageIndex ?? body.pageIndex))
    ? Math.max(0, Math.trunc(Number(body.pdfPageIndex ?? body.pageIndex)))
    : 0;
  const targets = uniqueStrings(
    Array.isArray(body.targets) && body.targets.length
      ? body.targets
      : ['building_outline', 'walls', 'rooms', 'layers'],
  );
  return buildPlanSegmentationPayload({
    pdfRef: body.pdfRef || body.source_ref || `halo-fire:${projectName}:sam31-smoke`,
    pageIndex,
    scale,
    targets,
  });
}

function sam31SmokeResultSummary(result) {
  const layers = result && result.layers && typeof result.layers === 'object' ? result.layers : {};
  const layerKeys = Object.keys(layers);
  const rooms = Array.isArray(layers.rooms) ? layers.rooms.length : 0;
  const walls = Array.isArray(layers.walls) ? layers.walls.length : 0;
  const outline = Array.isArray(layers.building_outline) ? layers.building_outline.length : 0;
  return {
    ok: !!(result && result.ok),
    source: result?.source || null,
    service: result?.service || null,
    op: result?.op || null,
    runtime: result?.runtime || null,
    mode: result?.mode || null,
    confidence: Number.isFinite(Number(result?.confidence)) ? Number(result.confidence) : null,
    pageIndex: Number.isFinite(Number(result?.pageIndex)) ? Number(result.pageIndex) : null,
    scale: Number.isFinite(Number(result?.scale)) ? Number(result.scale) : null,
    imageSize: result?.imageSize && typeof result.imageSize === 'object' ? jsonClone(result.imageSize) : null,
    layer_keys: layerKeys,
    object_counts: {
      building_outline_points: outline,
      walls,
      rooms,
    },
    claim_gate_effect: result?.claim_gate_effect || 'no_claims_cleared',
    blocked_claims: uniqueStrings([...(Array.isArray(result?.blocked_claims) ? result.blocked_claims : []), ...PDF_BOUNDARY_BLOCKED_CLAIMS]),
    limitations: Array.isArray(result?.limitations) ? result.limitations : [],
  };
}

function buildSam31BridgeSmokeArtifact(projectName, bridgeStatus, sam31Request, result, bridgeEndpoint, sourceContext = {}) {
  const resultSummary = sam31SmokeResultSummary(result);
  const blockedClaims = uniqueStrings([
    ...PDF_BOUNDARY_BLOCKED_CLAIMS,
    ...(Array.isArray(bridgeStatus.blocked_claims) ? bridgeStatus.blocked_claims : []),
    ...(Array.isArray(resultSummary.blocked_claims) ? resultSummary.blocked_claims : []),
    'SAM31_runtime_verified',
    'OpenClaw_runtime_verified',
    'professional_approval',
  ]);
  return {
    artifact_type: 'openclaw.sam31_bridge_smoke_artifact',
    status: 'sam31_invocation_verified',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    source_pdf_boundary_evidence_id: sourceContext.source_pdf_boundary_evidence_id || null,
    source_ref: sourceContext.source_ref || sam31Request.pdfRef || null,
    source_file: sourceContext.source_file || null,
    application: 'halo_fire',
    supported_applications: ['halo_fire', 'landscout', 'nameforge'],
    tool_ref: 'pdfExtract:sam',
    source_runtime: 'openclaw.sam31',
    source_runtime_ref: 'sam-3.1+llm-openclaw-bridge',
    coordinate_frame_ref: 'rendered_pdf_page_pixels_scaled_to_feet_by_operator_pdfScale',
    unit: 'feet',
    bridge_status: {
      ...bridgeStatus,
      claim_gate_effect: 'no_claims_cleared',
    },
    invocation: {
      tool: SAM31_FLOORPLAN_TOOL,
      endpoint: bridgeEndpoint,
      method: 'POST',
    },
    sam31_request: sam31Request,
    result_summary: resultSummary,
    status_refs: [
      bridgeStatus.probe_status_url,
      bridgeEndpoint,
    ].filter(Boolean),
    source_refs: [
      sourceContext.source_pdf_boundary_evidence_id ? {
        evidence_id: sourceContext.source_pdf_boundary_evidence_id,
        evidence_type: 'pdf_boundary_decision',
        source_file: sourceContext.source_file || null,
        source_ref: sourceContext.source_ref || sam31Request.pdfRef || null,
        status: sourceContext.source_status || 'best_effort',
      } : null,
      {
        evidence_type: 'openclaw_sam31_bridge_status',
        source_ref: bridgeStatus.probe_status_url || bridgeEndpoint,
        status: bridgeStatus.status || 'configured_unverified',
        claim_gate_effect: 'no_claims_cleared',
      },
    ].filter(Boolean),
    acceptable_evidence: [
      'Bridge /status response captured in bridge_status.raw_status',
      'Bridge /codex-bridge/invoke response summarized in result_summary',
      'Employee review, screenshot, console transcript, and source drawing scale must be attached before using this beyond internal-alpha correction loops',
    ],
    blocked_claims: blockedClaims,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    next_action: 'Attach screenshot/console evidence and employee-reviewed SAM31 replacements, then replay the room-boundary bid packet; do not promote approval-grade claims.',
    limitations: [
      'This artifact proves only that HaloFire reached a configured OpenClaw SAM31 bridge and received a best-effort segmentation response.',
      'It does not prove segmentation accuracy, drawing scale correctness, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact content.',
      'Temporary shim results are allowed as internal-alpha fallback evidence until Halo Fire employees replace them with actual reviewed values.',
    ],
  };
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

function roundSam31Confidence(value, multiplier = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(1, n * multiplier)) * 100) / 100;
}

function polygonToSvgPath(polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return '';
  const points = polygon
    .map((point) => Array.isArray(point) && point.length >= 2 ? [Number(point[0]), Number(point[1])] : null)
    .filter((point) => point && point.every(Number.isFinite));
  if (!points.length) return '';
  const [first, ...rest] = points;
  return [
    `M ${first[0]} ${first[1]}`,
    ...rest.map((point) => `L ${point[0]} ${point[1]}`),
    'Z',
  ].join(' ');
}

function sam31GeneratedVectorOverlays(segments, supplied = []) {
  if (Array.isArray(supplied) && supplied.length) return jsonClone(supplied);
  return (Array.isArray(segments) ? segments : [])
    .filter((segment) => Array.isArray(segment.polygon) && segment.polygon.length)
    .map((segment) => ({
      id: `vector:${segment.id}`,
      segment_id: segment.id,
      kind: 'polygon_path',
      svg_path: polygonToSvgPath(segment.polygon),
      confidence: roundSam31Confidence(segment.confidence, 0.8),
      source: 'generated_best_effort_from_segment_polygon',
    }));
}

function sam31GeneratedModel3dCandidates(segments, supplied = []) {
  if (Array.isArray(supplied) && supplied.length) return jsonClone(supplied);
  return (Array.isArray(segments) ? segments : [])
    .filter((segment) => Array.isArray(segment.polygon) && segment.polygon.length)
    .map((segment) => ({
      id: `model3d:${segment.id}`,
      segment_id: segment.id,
      primitive: 'extruded_polygon',
      height_ft: 10,
      confidence: roundSam31Confidence(segment.confidence, 0.5),
      source: 'generated_best_effort_from_segment_polygon',
      limitations: [
        'Generated from 2D SAM polygon only; not a surveyed, engineered, or manufacturer-approved 3D model.',
      ],
    }));
}

function sam31ApplicationContracts() {
  const contracts = {};
  for (const application of SAM31_SUPPORTED_APPLICATIONS) {
    const contract = SAM31_APPLICATION_CONTRACTS[application];
    contracts[application] = {
      application,
      contract_ref: contract.contract_ref,
      supported_evidence_lanes: [...contract.supported_evidence_lanes],
      temporary_value_policy: 'best_guess_until_employee_replaced',
      acceptable_human_updates: [...SAM31_EMPLOYEE_REPLACEMENT_FIELDS],
      blocked_claims: [...contract.blocked_claims],
      claim_gate_effect: 'no_claims_cleared',
    };
  }
  return contracts;
}

function sam31ApplicationAdapter(application, projectRef, sourceRef, contracts = sam31ApplicationContracts()) {
  const contract = contracts[application] || contracts.halo_fire;
  const normalizedApplication = contract.application || application || 'halo_fire';
  return {
    artifact_type: `openclaw.sam31.application_adapter.${normalizedApplication}.v1`,
    application: normalizedApplication,
    project_ref: projectRef,
    source_ref: sourceRef || null,
    contract_ref: contract.contract_ref,
    status: 'best_effort_adapter_ready',
    source_runtime: 'sam-3.1+llm',
    temporary_value_policy: contract.temporary_value_policy,
    acceptable_human_updates: [...contract.acceptable_human_updates],
    supported_evidence_lanes: [...contract.supported_evidence_lanes],
    blocked_claims: [...contract.blocked_claims],
    claim_gate_effect: 'no_claims_cleared',
    next_action: SAM31_APPLICATION_NEXT_ACTIONS[normalizedApplication],
  };
}

function buildOpenClawSam31ProductReviewQueueItem({
  application = 'halo_fire',
  projectRef,
  request = {},
  perceptionPacket = {},
  productReviewAction = {},
  blockedClaims = [],
}) {
  const normalizedApplication = SAM31_SUPPORTED_APPLICATIONS.includes(application) ? application : 'halo_fire';
  const contract = SAM31_APPLICATION_CONTRACTS[normalizedApplication] || SAM31_APPLICATION_CONTRACTS.halo_fire;
  const sections = Array.isArray(request.sections)
    ? request.sections
    : (Array.isArray(perceptionPacket.segments) ? perceptionPacket.segments : []);
  const objectHypotheses = Array.isArray(perceptionPacket.object_hypotheses)
    ? perceptionPacket.object_hypotheses
    : (Array.isArray(request.object_hypotheses) ? request.object_hypotheses : []);
  const vectorOverlays = Array.isArray(perceptionPacket.vector_overlays)
    ? perceptionPacket.vector_overlays
    : (Array.isArray(request.vector_overlays) ? request.vector_overlays : []);
  const modelCandidates = Array.isArray(perceptionPacket.model_3d_candidates)
    ? perceptionPacket.model_3d_candidates
    : (Array.isArray(request.model_3d_candidates) ? request.model_3d_candidates : []);
  const sourceRefs = Array.isArray(perceptionPacket.source_refs)
    ? jsonClone(perceptionPacket.source_refs)
    : [{
      source_ref: request.source_ref || perceptionPacket.source_ref || null,
      image_ref: request.image_ref || perceptionPacket.image_ref || null,
      runtime: 'sam-3.1+llm',
    }];
  const extrapolationIndex = sam31ExtrapolationIndex({
    request,
    perceptionPacket,
    applicationContract: contract,
    sourceRefs,
    blockedClaims: uniqueStrings([...blockedClaims, ...contract.blocked_claims]),
  });
  return {
    artifact_type: SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE,
    status: 'ready_for_human_replacement_or_acceptance',
    application: normalizedApplication,
    project_ref: projectRef || request.project_ref || perceptionPacket.project_ref || null,
    source_runtime: 'sam-3.1+llm',
    source_packet_ref: perceptionPacket.artifact_type || 'openclaw.sam31_perception_packet',
    contract_ref: productReviewAction.contract_ref || contract.contract_ref,
    supported_evidence_lanes: Array.isArray(productReviewAction.supported_evidence_lanes)
      ? jsonClone(productReviewAction.supported_evidence_lanes)
      : [...contract.supported_evidence_lanes],
    acceptable_human_updates: [...SAM31_EMPLOYEE_REPLACEMENT_FIELDS],
    temporary_value_policy: 'best_guess_until_employee_replaced',
    section_count: sections.length,
    object_hypothesis_count: objectHypotheses.length,
    vector_overlay_count: vectorOverlays.length,
    model_3d_candidate_count: modelCandidates.length,
    extrapolation_index: extrapolationIndex,
    source_refs: sourceRefs,
    next_action: productReviewAction.next_action || SAM31_APPLICATION_NEXT_ACTIONS[normalizedApplication],
    use_for_claims: false,
    blocked_claims: uniqueStrings([...blockedClaims, ...contract.blocked_claims]),
    claim_gate_effect: 'no_claims_cleared',
  };
}

function normalizeOpenClawSam31ProductReviewQueueItem(rawQueueItem, fallbackQueueItem) {
  if (!rawQueueItem || typeof rawQueueItem !== 'object' || Array.isArray(rawQueueItem)) {
    return fallbackQueueItem;
  }
  const raw = jsonClone(rawQueueItem);
  return {
    ...fallbackQueueItem,
    ...raw,
    artifact_type: raw.artifact_type || SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE,
    use_for_claims: false,
    extrapolation_index: Array.isArray(raw.extrapolation_index)
      ? jsonClone(raw.extrapolation_index).map((item) => ({
        ...item,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }))
      : fallbackQueueItem.extrapolation_index,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(fallbackQueueItem.blocked_claims) ? fallbackQueueItem.blocked_claims : []),
      ...(Array.isArray(raw.blocked_claims) ? raw.blocked_claims : []),
    ]),
    claim_gate_effect: 'no_claims_cleared',
  };
}

function sam31ExtrapolationIndex({
  request = {},
  perceptionPacket = {},
  applicationContract = SAM31_APPLICATION_CONTRACTS.halo_fire,
  sourceRefs = [],
  blockedClaims = [],
}) {
  if (Array.isArray(perceptionPacket.extrapolation_index)) {
    return jsonClone(perceptionPacket.extrapolation_index).map((item) => ({
      ...item,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
  }
  const sections = Array.isArray(request.sections)
    ? request.sections
    : (Array.isArray(perceptionPacket.segments) ? perceptionPacket.segments : []);
  const objectHypotheses = Array.isArray(perceptionPacket.object_hypotheses)
    ? perceptionPacket.object_hypotheses
    : (Array.isArray(request.object_hypotheses) ? request.object_hypotheses : []);
  const vectorOverlays = Array.isArray(perceptionPacket.vector_overlays)
    ? perceptionPacket.vector_overlays
    : (Array.isArray(request.vector_overlays) ? request.vector_overlays : []);
  const modelCandidates = Array.isArray(perceptionPacket.model_3d_candidates)
    ? perceptionPacket.model_3d_candidates
    : (Array.isArray(request.model_3d_candidates) ? request.model_3d_candidates : []);

  return sections.map((section) => {
    const sectionId = section && typeof section === 'object' ? section.id : null;
    return {
      artifact_type: 'openclaw.sam31.extrapolation_index_item.v1',
      section_id: sectionId,
      semantic_label: section?.semantic_label || null,
      object_hypothesis_ids: objectHypotheses
        .filter((item) => item?.segment_id === sectionId)
        .map((item) => item.id)
        .filter(Boolean),
      vector_overlay_ids: vectorOverlays
        .filter((item) => item?.segment_id === sectionId)
        .map((item) => item.id)
        .filter(Boolean),
      model_3d_candidate_ids: modelCandidates
        .filter((item) => item?.segment_id === sectionId)
        .map((item) => item.id)
        .filter(Boolean),
      source_refs: jsonClone(sourceRefs),
      acceptable_human_updates: [...SAM31_EMPLOYEE_REPLACEMENT_FIELDS],
      supported_evidence_lanes: [...(applicationContract.supported_evidence_lanes || [])],
      use_for_claims: false,
      blocked_claims: uniqueStrings([
        ...blockedClaims,
        ...(applicationContract.blocked_claims || []),
        ...PDF_BOUNDARY_BLOCKED_CLAIMS,
      ]),
      claim_gate_effect: 'no_claims_cleared',
    };
  });
}

function sam31PerceptionSummaryFromParts(packet, vectorOverlays, modelCandidates, applicationAdapter) {
  const applicationContracts = packet.application_contracts || sam31ApplicationContracts();
  return {
    artifact_type: 'openclaw.sam31_perception_summary',
    status: packet.status || 'best_effort_perception_ready',
    project_ref: packet.project_ref || 'halo_fire:unknown',
    application: packet.application || 'halo_fire',
    source_runtime: packet.source_runtime || 'sam-3.1+llm',
    source_ref: packet.source_ref || null,
    claim_gate_effect: 'no_claims_cleared',
    perception_lanes: Array.isArray(packet.perception_lanes) ? [...packet.perception_lanes] : [...SAM31_PERCEPTION_LANES],
    segment_count: Array.isArray(packet.segments) ? packet.segments.length : 0,
    object_hypothesis_count: Array.isArray(packet.object_hypotheses) ? packet.object_hypotheses.length : 0,
    vector_overlay_count: Array.isArray(vectorOverlays) ? vectorOverlays.length : 0,
    model_3d_candidate_count: Array.isArray(modelCandidates) ? modelCandidates.length : 0,
    spatial_observation_count: Array.isArray(packet.spatial_observations) ? packet.spatial_observations.length : 0,
    blocked_claims: uniqueStrings([...(Array.isArray(packet.blocked_claims) ? packet.blocked_claims : []), ...SAM31_BLOCKED_CLAIMS]),
    extrapolation_contract_ref: SAM31_EXTRAPOLATION_CONTRACT_REF,
    application_contract_refs: SAM31_SUPPORTED_APPLICATIONS.map((application) => applicationContracts[application]?.contract_ref).filter(Boolean),
    active_application_contract_ref: applicationAdapter?.contract_ref || applicationContracts.halo_fire?.contract_ref || null,
    application_adapter_ref: applicationAdapter?.artifact_type || null,
    next_action: 'Use this summary to queue product review or download the full SAM31 perception packet; do not promote blocked claims.',
  };
}

function buildOpenClawSam31PerceptionRequest(projectName, evidence, decision, candidate = {}, pdfRef = null) {
  const projectRef = `halo_fire:${projectName}`;
  const sourceRef = evidence.source_ref || decision.sourceRef || null;
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
  const segments = [segment];
  const objectHypotheses = [
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
  ];
  const vectorOverlays = sam31GeneratedVectorOverlays(segments);
  const model3dCandidates = sam31GeneratedModel3dCandidates(segments);
  const applicationContracts = sam31ApplicationContracts();
  const applicationAdapter = sam31ApplicationAdapter('halo_fire', projectRef, sourceRef, applicationContracts);
  const request = {
    artifact_type: 'openclaw.sam31_perception_request',
    project_ref: projectRef,
    application: 'halo_fire',
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    source_runtime: 'sam-3.1+llm',
    source_ref: sourceRef,
    image_ref: evidence.source_file || decision.sourceFile || pdfRef || evidence.source_ref || decision.sourceRef || null,
    coordinate_frame_ref: 'rendered_pdf_page_pixels_scaled_to_feet_by_pdfScale',
    unit: 'feet',
    llm_model: 'openclaw-local-llm-best-effort',
    prompt: 'Use SAM 3.1 segmentation plus LLM review to identify room boundaries, walls, sleeve or penetration candidates, sprinkler obstruction candidates, vector overlays, and best-effort 3D model candidates from this floorplan evidence.',
    perception_lanes: [...SAM31_PERCEPTION_LANES],
    segments,
    object_hypotheses: objectHypotheses,
    vector_overlays: vectorOverlays,
    model_3d_candidates: model3dCandidates,
    llm_observations: segments.map((entry) => ({
      segment_id: entry.id,
      semantic_label: entry.semantic_label,
      confidence: roundSam31Confidence(entry.confidence, 0.75),
      source: 'openclaw-local-llm-best-effort',
      observation: `${entry.semantic_label} inferred from SAM 3.1 segment ${entry.id}`,
    })),
    extrapolation_contract: jsonClone(SAM31_EXTRAPOLATION_CONTRACT),
    application_contracts: applicationContracts,
    application_adapter: applicationAdapter,
    requested_outputs: ['segmentation_masks', 'semantic_labels', 'vector_overlays', 'model_3d_candidates', 'spatial_observation_packet'],
    supported_evidence_lanes: [
      'room_boundary_visual_audit',
      'object_identification_review',
      'sleeve_or_firestop_candidate_review',
      'vector_overlay_generation',
      'model_3d_candidate_generation',
      'spatial_observation_correction_loop',
    ],
    blocked_claims: [...SAM31_BLOCKED_CLAIMS],
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'SAM 3.1 plus LLM perception is measurement and correction evidence only.',
      'It cannot clear geometry accuracy, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact claims.',
      'Generated vector overlays and 3D candidates are best-effort temporary values until Halo Fire employees or owning product reviewers replace them with actual values.',
    ],
  };
  request.perception_summary = sam31PerceptionSummaryFromParts(request, vectorOverlays, model3dCandidates, applicationAdapter);
  return request;
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
  const upstreamSummary = packet.perception_summary && typeof packet.perception_summary === 'object' && !Array.isArray(packet.perception_summary)
    ? jsonClone(packet.perception_summary)
    : {};
  packet.artifact_type = 'openclaw.sam31_perception_packet';
  packet.application = SAM31_SUPPORTED_APPLICATIONS.includes(packet.application) ? packet.application : 'halo_fire';
  packet.project_ref = packet.project_ref || upstreamSummary.project_ref || 'halo_fire:unknown';
  packet.source_ref = packet.source_ref || upstreamSummary.source_ref || null;
  packet.source_runtime = packet.source_runtime || 'sam-3.1+llm';
  packet.status = packet.status || 'best_effort_perception_ready';
  packet.segments = Array.isArray(packet.segments) ? packet.segments : [];
  packet.object_hypotheses = Array.isArray(packet.object_hypotheses) ? packet.object_hypotheses : [];
  packet.vector_overlays = sam31GeneratedVectorOverlays(packet.segments, packet.vector_overlays);
  packet.model_3d_candidates = sam31GeneratedModel3dCandidates(packet.segments, packet.model_3d_candidates);
  packet.extrapolation_contract = packet.extrapolation_contract && typeof packet.extrapolation_contract === 'object'
    ? { ...jsonClone(SAM31_EXTRAPOLATION_CONTRACT), ...jsonClone(packet.extrapolation_contract), claim_gate_effect: 'no_claims_cleared' }
    : jsonClone(SAM31_EXTRAPOLATION_CONTRACT);
  const applicationContracts = sam31ApplicationContracts();
  if (packet.application_contracts && typeof packet.application_contracts === 'object' && !Array.isArray(packet.application_contracts)) {
    const suppliedContracts = jsonClone(packet.application_contracts);
    for (const application of SAM31_SUPPORTED_APPLICATIONS) {
      if (suppliedContracts[application] && typeof suppliedContracts[application] === 'object') {
        applicationContracts[application] = {
          ...applicationContracts[application],
          ...suppliedContracts[application],
          blocked_claims: uniqueStrings([
            ...(Array.isArray(applicationContracts[application].blocked_claims) ? applicationContracts[application].blocked_claims : []),
            ...(Array.isArray(suppliedContracts[application].blocked_claims) ? suppliedContracts[application].blocked_claims : []),
          ]),
          claim_gate_effect: 'no_claims_cleared',
        };
      }
    }
  }
  packet.application_contracts = applicationContracts;
  const generatedAdapter = sam31ApplicationAdapter(packet.application, packet.project_ref || 'halo_fire:unknown', packet.source_ref || null, applicationContracts);
  if (packet.application_adapter && typeof packet.application_adapter === 'object' && !Array.isArray(packet.application_adapter)) {
    const suppliedAdapter = jsonClone(packet.application_adapter);
    packet.application_adapter = {
      ...generatedAdapter,
      ...suppliedAdapter,
      blocked_claims: uniqueStrings([
        ...(Array.isArray(generatedAdapter.blocked_claims) ? generatedAdapter.blocked_claims : []),
        ...(Array.isArray(suppliedAdapter.blocked_claims) ? suppliedAdapter.blocked_claims : []),
      ]),
      claim_gate_effect: 'no_claims_cleared',
    };
  } else {
    packet.application_adapter = generatedAdapter;
  }
  packet.blocked_claims = uniqueStrings([...(packet.blocked_claims || []), ...SAM31_BLOCKED_CLAIMS, ...packet.application_adapter.blocked_claims]);
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

function sam31EmployeeReplacementFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'sam31_employee_replacement' ? parsed.replacement : null;
  } catch {
    return null;
  }
}

function latestSam31EmployeeReplacementEvidence(projectName, sourceEvidenceId) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'sam31_employee_replacement'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  for (const row of rows) {
    const replacement = sam31EmployeeReplacementFromEvidence(row);
    if (replacement && Number(replacement.source_evidence_id) === Number(sourceEvidenceId)) {
      return { evidence: row, replacement };
    }
  }
  return null;
}

function sam31BridgeSmokeArtifactFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'openclaw_sam31_bridge_smoke_artifact' && parsed.artifact
      ? parsed.artifact
      : null;
  } catch {
    return null;
  }
}

function latestSam31BridgeSmokeArtifactEvidence(projectName, sourceEvidenceId = null) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'openclaw_sam31_bridge_smoke_artifact'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  for (const row of rows) {
    const artifact = sam31BridgeSmokeArtifactFromEvidence(row);
    if (!artifact) continue;
    if (sourceEvidenceId && Number(artifact.source_pdf_boundary_evidence_id) !== Number(sourceEvidenceId)) {
      continue;
    }
    return { evidence: row, artifact };
  }
  return null;
}

function sam31BridgeSmokeReplaySummary(sam31SmokeEvidence) {
  if (!sam31SmokeEvidence?.evidence || !sam31SmokeEvidence?.artifact) return null;
  const { evidence, artifact } = sam31SmokeEvidence;
  return {
    evidence_id: evidence.id,
    evidence_type: evidence.evidence_type,
    evidence_status: evidence.status,
    source_ref: evidence.source_ref,
    status: artifact.status || 'sam31_invocation_verified',
    source_pdf_boundary_evidence_id: artifact.source_pdf_boundary_evidence_id || null,
    generated_at: artifact.generated_at || null,
    bridge_status: artifact.bridge_status || null,
    invocation: artifact.invocation || null,
    result_summary: artifact.result_summary && typeof artifact.result_summary === 'object'
      ? jsonClone(artifact.result_summary)
      : null,
    status_refs: Array.isArray(artifact.status_refs) ? [...artifact.status_refs] : [],
    claim_gate_effect: artifact.claim_gate_effect || 'no_claims_cleared',
    blocked_claims: Array.isArray(artifact.blocked_claims) ? [...artifact.blocked_claims] : [],
    limitations: Array.isArray(artifact.limitations) ? [...artifact.limitations] : [],
  };
}

function openClawSam31ExtrapolationArtifactFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'openclaw_sam31_extrapolation_artifact' && parsed.artifact
      ? parsed.artifact
      : null;
  } catch {
    return null;
  }
}

function latestOpenClawSam31ExtrapolationArtifactEvidence(projectName, sourceEvidenceId = null) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'openclaw_sam31_extrapolation_artifact'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  for (const row of rows) {
    const artifact = openClawSam31ExtrapolationArtifactFromEvidence(row);
    if (!artifact) continue;
    if (sourceEvidenceId && Number(artifact.source_pdf_boundary_evidence_id) !== Number(sourceEvidenceId)) {
      continue;
    }
    return { evidence: row, artifact };
  }
  return null;
}

function openClawSam31ExtrapolationReviewFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'openclaw_sam31_extrapolation_review' && parsed.review
      ? parsed.review
      : null;
  } catch {
    return null;
  }
}

function latestOpenClawSam31ExtrapolationReviewEvidence(projectName, sourceEvidenceId = null) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'openclaw_sam31_extrapolation_review'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  for (const row of rows) {
    const review = openClawSam31ExtrapolationReviewFromEvidence(row);
    if (!review) continue;
    if (sourceEvidenceId && Number(review.source_pdf_boundary_evidence_id) !== Number(sourceEvidenceId)) {
      continue;
    }
    return { evidence: row, review };
  }
  return null;
}

function openClawSam31ExtrapolationReplaySummary(extrapolationEvidence) {
  if (!extrapolationEvidence?.evidence || !extrapolationEvidence?.artifact) return null;
  const { evidence, artifact } = extrapolationEvidence;
  const extrapolationIndex = Array.isArray(artifact.extrapolation_index)
    ? jsonClone(artifact.extrapolation_index)
    : (Array.isArray(artifact.product_review_queue_item?.extrapolation_index)
      ? jsonClone(artifact.product_review_queue_item.extrapolation_index)
      : []);
  const missingEvidenceRows = Array.isArray(artifact.missing_evidence_rows)
    ? jsonClone(artifact.missing_evidence_rows)
    : (Array.isArray(artifact.product_review_queue_item?.missing_evidence_rows)
      ? jsonClone(artifact.product_review_queue_item.missing_evidence_rows)
      : []);
  return {
    evidence_id: evidence.id,
    evidence_type: evidence.evidence_type,
    evidence_status: evidence.status,
    source_ref: evidence.source_ref,
    status: artifact.status || 'best_effort_extrapolation_ready',
    source_pdf_boundary_evidence_id: artifact.source_pdf_boundary_evidence_id || null,
    generated_at: artifact.generated_at || null,
    openclaw_endpoint: artifact.openclaw_endpoint || null,
    section_count: Number.isFinite(Number(artifact.section_count)) ? Number(artifact.section_count) : null,
    object_hypothesis_count: Number.isFinite(Number(artifact.object_hypothesis_count)) ? Number(artifact.object_hypothesis_count) : null,
    product_review_action: artifact.product_review_action && typeof artifact.product_review_action === 'object'
      ? jsonClone(artifact.product_review_action)
      : null,
    product_review_queue_item: artifact.product_review_queue_item && typeof artifact.product_review_queue_item === 'object'
      ? jsonClone(artifact.product_review_queue_item)
      : null,
    bid_truth: artifact.bid_truth && typeof artifact.bid_truth === 'object'
      ? jsonClone(artifact.bid_truth)
      : null,
    missing_evidence_rows: missingEvidenceRows,
    missing_evidence_row_count: missingEvidenceRows.length,
    extrapolation_index: extrapolationIndex,
    extrapolation_index_count: extrapolationIndex.length,
    perception_summary: sam31PerceptionPacketSummary(artifact.perception_packet),
    claim_gate_effect: artifact.claim_gate_effect || 'no_claims_cleared',
    blocked_claims: Array.isArray(artifact.blocked_claims) ? [...artifact.blocked_claims] : [],
    limitations: Array.isArray(artifact.limitations) ? [...artifact.limitations] : [],
  };
}

function openClawSam31ExtrapolationReviewSummary(reviewEvidence) {
  if (!reviewEvidence?.evidence || !reviewEvidence?.review) return null;
  const { evidence, review } = reviewEvidence;
  return {
    evidence_id: evidence.id,
    evidence_type: evidence.evidence_type,
    evidence_status: evidence.status,
    source_ref: evidence.source_ref,
    status: review.status || 'present',
    review_decision: review.review_decision || 'replaced',
    source_pdf_boundary_evidence_id: review.source_pdf_boundary_evidence_id || null,
    source_openclaw_sam31_extrapolation_evidence_id: review.source_openclaw_sam31_extrapolation_evidence_id || null,
    reviewer_name: review.reviewer_name || null,
    replacement_ref: review.replacement_ref || null,
    replaced_fields: Array.isArray(review.replaced_fields) ? [...review.replaced_fields] : [],
    claim_gate_effect: review.claim_gate_effect || 'no_claims_cleared',
    blocked_claims: Array.isArray(review.blocked_claims) ? [...review.blocked_claims] : [],
    limitations: Array.isArray(review.limitations) ? [...review.limitations] : [],
  };
}

function buildOpenClawSam31ProductReviewQueueItemPacket(projectName, evidence, decision, extrapolationEvidence, extrapolationArtifact) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!extrapolationEvidence?.evidence || !extrapolationArtifact) {
    const e = new Error('OpenClaw SAM31 extrapolation artifact evidence is required before downloading the product review queue item');
    e.httpStatus = 409;
    throw e;
  }
  const fallbackQueueItem = buildOpenClawSam31ProductReviewQueueItem({
    application: extrapolationArtifact.application || 'halo_fire',
    projectRef: extrapolationArtifact.project_ref || `halo_fire:${projectName}`,
    request: extrapolationArtifact.request || {},
    perceptionPacket: extrapolationArtifact.perception_packet || {},
    productReviewAction: extrapolationArtifact.product_review_action || {},
    blockedClaims: [
      ...(Array.isArray(extrapolationArtifact.blocked_claims) ? extrapolationArtifact.blocked_claims : []),
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
    ],
  });
  const queueItem = normalizeOpenClawSam31ProductReviewQueueItem(
    extrapolationArtifact.product_review_queue_item,
    fallbackQueueItem,
  );
  const sourceRefs = [
    {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_file: evidence.source_file || decision.sourceFile || null,
      source_ref: evidence.source_ref || decision.sourceRef || null,
      status: evidence.status,
    },
    {
      evidence_id: extrapolationEvidence.evidence.id,
      evidence_type: extrapolationEvidence.evidence.evidence_type,
      source_file: extrapolationEvidence.evidence.source_file || null,
      source_ref: extrapolationEvidence.evidence.source_ref || extrapolationArtifact.openclaw_endpoint || null,
      status: extrapolationEvidence.evidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
    ...(Array.isArray(queueItem.source_refs) ? jsonClone(queueItem.source_refs) : []),
  ];
  return {
    ...queueItem,
    artifact_type: SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE,
    status: queueItem.status || 'ready_for_human_replacement_or_acceptance',
    application: queueItem.application || 'halo_fire',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_extrapolation_evidence_id: extrapolationEvidence.evidence.id,
    source_ref: evidence.source_ref || decision.sourceRef || extrapolationArtifact.source_ref || null,
    source_file: evidence.source_file || decision.sourceFile || extrapolationArtifact.source_file || null,
    download_name: `${slugForDownloadName(projectName)}-sam31-product-review-queue-item-${evidence.id}.json`,
    source_refs: sourceRefs,
    supported_evidence_lanes: Array.isArray(queueItem.supported_evidence_lanes)
      ? uniqueStrings(queueItem.supported_evidence_lanes)
      : [...SAM31_APPLICATION_CONTRACTS.halo_fire.supported_evidence_lanes],
    use_for_claims: false,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(queueItem.blocked_claims) ? queueItem.blocked_claims : []),
      ...(Array.isArray(extrapolationArtifact.blocked_claims) ? extrapolationArtifact.blocked_claims : []),
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      'professional_approval',
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
    ]),
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: [
      ...(Array.isArray(extrapolationArtifact.limitations) ? extrapolationArtifact.limitations : []),
      'This OpenClaw SAM31 queue item is a best-effort internal-alpha product review handoff for objects, vector overlays, and 3D model candidates.',
      'It does not prove geometry accuracy, drawing scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact models.',
    ],
  };
}

function openClawSam31ConsumerBlockedRow(consumer, result = {}) {
  const label = consumer === 'nameforge' ? 'NameForge' : 'LandScout';
  return {
    code: SAM31_CONSUMER_UNAVAILABLE_CODES[consumer] || `OPENCLAW_SAM31_${String(consumer || 'CONSUMER').toUpperCase()}_QUEUE_UNAVAILABLE`,
    status: result.status || 'unavailable',
    consumer,
    evidence_lane: `${consumer}_sam31_product_review_queue`,
    source_ref: result.endpoint || result.action_href || null,
    observed: result.error || `Canonical ${label} SAM31 consumer queue was not reachable or not configured during this smoke.`,
    expected: `Canonical ${label} SAM31 product review queue accepts ${SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE} handoffs.`,
    next_action: `Start or configure the OpenClaw ${label} SAM31 consumer queue endpoint, then rerun this smoke; HaloFire may continue with its own internal-alpha review queue.`,
    acceptable_evidence: [
      `${label} SAM31 product review queue HTTP 2xx response`,
      `${label} queue item id or persisted review packet ref`,
      'OpenClaw/HAL console or screenshot evidence for the consumer queue intake',
    ],
    ai_fallback:
      'Keep the HaloFire SAM31 queue item downloadable and reviewable locally; AI may summarize the missing consumer handoff but cannot clear downstream product, production, AHJ, PE, permit, AutoSprink, fabrication, or manufacturer claims.',
    blocked_claims: uniqueStrings([
      ...(consumer === 'nameforge' ? ['brand_ready', 'trademark_ready', 'production_ready'] : ['CEO_ready', 'production_ready']),
      'OpenClaw_runtime_verified',
      'SAM31_runtime_verified',
    ]),
    claim_gate_effect: 'no_claims_cleared',
  };
}

function resolveOpenClawSam31ConsumerEndpoint(action, descriptorEndpoint) {
  const href = String(action?.href || '').trim();
  if (!href) return null;
  try {
    return new URL(href, descriptorEndpoint || undefined).toString();
  } catch {
    return href.startsWith('http://') || href.startsWith('https://') ? href : null;
  }
}

function openClawSam31ConsumerQueueEndpointConfig(consumer, action = null, descriptorEndpoint = null, env = process.env) {
  const envKey = SAM31_CONSUMER_QUEUE_URL_ENV[consumer] || null;
  const envEndpoint = envKey ? String(env[envKey] || '').trim() : '';
  if (envEndpoint) {
    return {
      consumer,
      status: 'configured_unverified',
      method: 'POST',
      action_href: action?.href || null,
      endpoint: envEndpoint,
      endpoint_configured: true,
      endpoint_source_file: envKey,
      consumes: action?.consumes || SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE,
      artifact_type: action?.artifact_type || `openclaw.sam31.consumer_review_queue.${consumer}.v1`,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      next_action: `Run the ${consumer} SAM31 consumer queue smoke and attach queue id or HTTP 2xx evidence; no claims clear from configuration alone.`,
    };
  }
  const descriptorResolvedEndpoint = resolveOpenClawSam31ConsumerEndpoint(action, descriptorEndpoint);
  if (action && descriptorResolvedEndpoint) {
    return {
      consumer,
      status: 'descriptor_configured_unverified',
      method: String(action.method || 'POST').toUpperCase(),
      action_href: action.href || null,
      endpoint: descriptorResolvedEndpoint,
      endpoint_configured: true,
      endpoint_source_file: `canonical_tool_descriptor.consumer_actions.${consumer}.href`,
      consumes: action.consumes || SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE,
      artifact_type: action.artifact_type || `openclaw.sam31.consumer_review_queue.${consumer}.v1`,
      use_for_claims: false,
      claim_gate_effect: action.claim_gate_effect || 'no_claims_cleared',
      next_action: `Promote ${consumer} queue URL into ${envKey || 'a product-specific env var'} for live deployment, then rerun consumer queue smoke.`,
    };
  }
  return {
    consumer,
    status: action ? 'consumer_endpoint_unresolved' : 'consumer_action_missing',
    method: action?.method || 'POST',
    action_href: action?.href || null,
    endpoint: null,
    endpoint_configured: false,
    endpoint_source_file: envKey || null,
    consumes: action?.consumes || SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE,
    artifact_type: action?.artifact_type || `openclaw.sam31.consumer_review_queue.${consumer}.v1`,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    next_action: `Set ${envKey || `OPENCLAW_SAM31_${String(consumer).toUpperCase()}_QUEUE_URL`} to the live OpenClaw ${consumer} SAM31 product review queue endpoint or advertise it in the canonical tool descriptor.`,
  };
}

function openClawSam31ConsumerQueueStatuses(descriptor = null, descriptorEndpoint = null, env = process.env) {
  const actions = descriptor?.consumer_actions && typeof descriptor.consumer_actions === 'object'
    ? descriptor.consumer_actions
    : {};
  return SAM31_CONSUMER_QUEUE_TARGETS.map((consumer) => openClawSam31ConsumerQueueEndpointConfig(
    consumer,
    actions[consumer],
    descriptorEndpoint,
    env,
  ));
}

async function readJsonResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw_text: text.slice(0, 500) };
  }
}

async function postOpenClawSam31ConsumerQueue({
  consumer,
  action,
  descriptorEndpoint,
  payload,
  fetchImpl = globalThis.fetch,
  env = process.env,
  timeoutMs = Number(process.env.HALOFIRE_SAM31_CONSUMER_SMOKE_TIMEOUT_MS || 5000),
}) {
  const config = openClawSam31ConsumerQueueEndpointConfig(consumer, action, descriptorEndpoint, env);
  const endpoint = config.endpoint;
  if (!endpoint) {
    const result = {
      consumer,
      status: config.status,
      method: config.method || 'POST',
      action_href: config.action_href || null,
      endpoint,
      endpoint_source_file: config.endpoint_source_file || null,
      response_status: null,
      response_body: null,
      accepted_queue_id: null,
      persisted_review_packet_ref: null,
      error: config.status === 'consumer_endpoint_unresolved'
        ? 'Consumer action href could not be resolved'
        : 'Canonical descriptor did not advertise this consumer action and no env URL is configured',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    };
    return { ...result, missing_evidence_row: openClawSam31ConsumerBlockedRow(consumer, result) };
  }
  const method = String(config.method || 'POST').toUpperCase();
  if (method !== 'POST') {
    const result = {
      consumer,
      status: 'unsupported_method',
      method,
      action_href: config.action_href || null,
      endpoint,
      endpoint_source_file: config.endpoint_source_file || null,
      response_status: null,
      response_body: null,
      accepted_queue_id: null,
      persisted_review_packet_ref: null,
      error: `Unsupported consumer queue method ${method}`,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    };
    return { ...result, missing_evidence_row: openClawSam31ConsumerBlockedRow(consumer, result) };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const responseBody = await readJsonResponseBody(response);
    const result = {
      consumer,
      status: response.ok ? 'posted' : 'configured_unreachable',
      method,
      action_href: config.action_href || null,
      endpoint,
      endpoint_source_file: config.endpoint_source_file || null,
      response_status: response.status,
      response_body: responseBody,
      accepted_queue_id: responseBody && typeof responseBody === 'object' ? (responseBody.queue_id || null) : null,
      persisted_review_packet_ref: responseBody && typeof responseBody === 'object' ? (responseBody.persisted_review_packet_ref || null) : null,
      error: response.ok ? null : `HTTP ${response.status}`,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    };
    return response.ok
      ? result
      : { ...result, missing_evidence_row: openClawSam31ConsumerBlockedRow(consumer, result) };
  } catch (err) {
    const result = {
      consumer,
      status: 'configured_unreachable',
      method,
      action_href: config.action_href || null,
      endpoint,
      endpoint_source_file: config.endpoint_source_file || null,
      response_status: null,
      response_body: null,
      accepted_queue_id: null,
      persisted_review_packet_ref: null,
      error: err && err.name === 'AbortError' ? 'timeout' : String(err?.message || err),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    };
    return { ...result, missing_evidence_row: openClawSam31ConsumerBlockedRow(consumer, result) };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildOpenClawSam31ConsumerSmokeArtifact(projectName, evidence, decision, extrapolationEvidence, extrapolationArtifact, fetchImpl = globalThis.fetch) {
  const productReviewQueueItem = buildOpenClawSam31ProductReviewQueueItemPacket(
    projectName,
    evidence,
    decision,
    extrapolationEvidence,
    extrapolationArtifact,
  );
  const descriptor = await fetchOpenClawSam31CanonicalToolDescriptor(process.env, fetchImpl);
  const actions = descriptor.descriptor?.consumer_actions && typeof descriptor.descriptor.consumer_actions === 'object'
    ? descriptor.descriptor.consumer_actions
    : {};
  const consumerQueueStatuses = openClawSam31ConsumerQueueStatuses(
    descriptor.descriptor,
    descriptor.endpoint,
    process.env,
  );
  const payload = {
    artifact_type: 'openclaw.sam31.consumer_queue_handoff.v1',
    source_application: 'halo_fire',
    source_project_name: projectName,
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_extrapolation_evidence_id: extrapolationEvidence.evidence.id,
    product_review_queue_item: productReviewQueueItem,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
  };
  const consumerResults = [];
  if (!descriptor.reachable || !descriptor.descriptor) {
    for (const consumer of SAM31_CONSUMER_QUEUE_TARGETS) {
      const result = {
        consumer,
        status: descriptor.status || 'canonical_descriptor_unavailable',
        method: 'POST',
        action_href: null,
        endpoint: null,
        response_status: null,
        response_body: null,
        accepted_queue_id: null,
        persisted_review_packet_ref: null,
        error: descriptor.error || 'Canonical OpenClaw SAM31 tool descriptor unavailable',
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      };
      consumerResults.push({ ...result, missing_evidence_row: openClawSam31ConsumerBlockedRow(consumer, result) });
    }
  } else {
    for (const consumer of SAM31_CONSUMER_QUEUE_TARGETS) {
      consumerResults.push(await postOpenClawSam31ConsumerQueue({
        consumer,
        action: actions[consumer],
        descriptorEndpoint: descriptor.endpoint,
        payload,
        fetchImpl,
      }));
    }
  }
  const missingEvidenceRows = consumerResults
    .map((result) => result.missing_evidence_row)
    .filter(Boolean);
  const postedConsumerCount = consumerResults.filter((result) => result.status === 'posted').length;
  const blockedConsumerCount = missingEvidenceRows.length;
  const consumerResultArtifacts = consumerResults.map((result) => {
    const copy = { ...result };
    delete copy.missing_evidence_row;
    return copy;
  });
  const consumerReviewTasks = buildOpenClawSam31ConsumerReviewTasks({
    projectName,
    evidence,
    decision,
    extrapolationEvidence,
    productReviewQueueItem,
    consumerResults: consumerResultArtifacts,
  });
  return {
    artifact_type: SAM31_CONSUMER_SMOKE_ARTIFACT_TYPE,
    status: blockedConsumerCount === 0
      ? 'consumer_smoke_recorded'
      : (postedConsumerCount > 0 ? 'consumer_smoke_degraded' : 'consumer_smoke_blocked'),
    project_name: projectName,
    generated_at: new Date().toISOString(),
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_extrapolation_evidence_id: extrapolationEvidence.evidence.id,
    canonical_tool_descriptor_url: descriptor.endpoint,
    canonical_tool_descriptor_source_file: descriptor.source_file,
    canonical_tool_descriptor_status: descriptor.status,
    canonical_tool_descriptor_reachable: descriptor.reachable,
    canonical_tool_descriptor_error: descriptor.error,
    consumer_queue_statuses: consumerQueueStatuses,
    product_review_queue_item: productReviewQueueItem,
    consumer_results: consumerResultArtifacts,
    consumer_review_tasks: consumerReviewTasks,
    posted_consumer_count: postedConsumerCount,
    blocked_consumer_count: blockedConsumerCount,
    missing_evidence_rows: missingEvidenceRows,
    source_refs: [
      {
        evidence_id: evidence.id,
        evidence_type: evidence.evidence_type,
        source_file: evidence.source_file || decision.sourceFile || null,
        source_ref: evidence.source_ref || decision.sourceRef || null,
        status: evidence.status,
      },
      {
        evidence_id: extrapolationEvidence.evidence.id,
        evidence_type: extrapolationEvidence.evidence.evidence_type,
        source_file: extrapolationEvidence.evidence.source_file || null,
        source_ref: extrapolationEvidence.evidence.source_ref || extrapolationArtifact.openclaw_endpoint || null,
        status: extrapolationEvidence.evidence.status,
      },
      {
        source_file: descriptor.source_file,
        source_ref: descriptor.endpoint,
        status: descriptor.status,
        claim_gate_effect: 'no_claims_cleared',
      },
    ],
    use_for_claims: false,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(productReviewQueueItem.blocked_claims) ? productReviewQueueItem.blocked_claims : []),
      'OpenClaw_runtime_verified',
      'SAM31_runtime_verified',
      'professional_approval',
    ]),
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    next_action: blockedConsumerCount
      ? 'Resolve the listed consumer queue missing-evidence rows, then rerun the LandScout/NameForge SAM31 queue smoke; HaloFire may continue internal-alpha review locally.'
      : 'Consumer queues accepted the SAM31 handoff for product review. Continue product-specific human review; do not clear regulated claims from this smoke.',
    limitations: [
      'This smoke only proves that canonical consumer queue endpoints accepted or rejected a HaloFire SAM31 queue handoff.',
      'It does not prove downstream reviewer acceptance, geometry accuracy, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, production readiness, trademark readiness, or manufacturer-exact models.',
    ],
  };
}

function buildOpenClawSam31ConsumerReviewTasks({
  projectName,
  evidence,
  decision,
  extrapolationEvidence,
  productReviewQueueItem,
  consumerResults,
}) {
  return (Array.isArray(consumerResults) ? consumerResults : [])
    .filter((result) => result.status === 'posted' && result.accepted_queue_id && result.persisted_review_packet_ref)
    .map((result) => {
      const consumer = String(result.consumer || '').trim();
      const label = consumer === 'nameforge' ? 'NameForge' : 'LandScout';
      const contract = SAM31_APPLICATION_CONTRACTS[consumer] || {};
      return {
        artifact_type: SAM31_CONSUMER_REVIEW_TASK_TYPE,
        consumer,
        status: 'requires_product_review',
        source_application: 'halo_fire',
        source_project_name: projectName,
        source_pdf_boundary_evidence_id: evidence.id,
        source_openclaw_sam31_extrapolation_evidence_id: extrapolationEvidence.evidence.id,
        source_openclaw_sam31_consumer_smoke_evidence_id: null,
        source_ref: evidence.source_ref || decision.sourceRef || productReviewQueueItem.source_ref || null,
        source_file: evidence.source_file || decision.sourceFile || productReviewQueueItem.source_file || null,
        accepted_queue_id: result.accepted_queue_id,
        persisted_review_packet_ref: result.persisted_review_packet_ref,
        product_review_queue_item_artifact_type: productReviewQueueItem.artifact_type || SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE,
        product_review_queue_item_ref: productReviewQueueItem.source_ref || productReviewQueueItem.project_ref || null,
        next_action: `${label} reviewer must accept or replace SAM31 semantic labels, object hypotheses, vector overlays, 3D candidates, and source refs before product claims move forward; regulated claims remain blocked.`,
        acceptable_evidence: [
          'product owner review note tied to accepted queue id',
          'employee accepted or replaced SAM31 semantic label/object/vector/3D candidate',
          'source screenshot or console evidence for reviewed sectioning',
          `${label} persisted review packet linked to the accepted queue id`,
        ],
        supported_evidence_lanes: Array.isArray(contract.supported_evidence_lanes)
          ? [...contract.supported_evidence_lanes]
          : [],
        blocked_claims: uniqueStrings([
          ...(Array.isArray(productReviewQueueItem.blocked_claims) ? productReviewQueueItem.blocked_claims : []),
          ...(Array.isArray(contract.blocked_claims) ? contract.blocked_claims : []),
          'permit_ready',
          'AHJ_approval',
          'AutoSprink_parity',
          'fabrication_ready',
          'manufacturer_exact',
          'professional_approval',
        ]),
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
        limitations: [
          'This task records that a product queue accepted a SAM31 best-effort handoff; it is not proof that the product reviewer accepted the values.',
          'The reviewer may use temporary SAM31 object labels, vector overlays, and 3D candidates as a starting point, but must replace or explicitly accept them before product-specific claims move forward.',
          'This task never clears AHJ, PE, permit, fabrication, AutoSprink parity, manufacturer-exact, production, trademark, or professional approval claims by itself.',
        ],
      };
    });
}

function openClawSam31ConsumerSmokeArtifactFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'openclaw_sam31_consumer_smoke_artifact' && parsed.artifact
      ? parsed.artifact
      : null;
  } catch {
    return null;
  }
}

function latestOpenClawSam31ConsumerSmokeArtifactEvidence(projectName, sourceEvidenceId = null) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'openclaw_sam31_consumer_smoke_artifact'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  for (const row of rows) {
    const artifact = openClawSam31ConsumerSmokeArtifactFromEvidence(row);
    if (!artifact) continue;
    if (sourceEvidenceId && Number(artifact.source_pdf_boundary_evidence_id) !== Number(sourceEvidenceId)) {
      continue;
    }
    return { evidence: row, artifact };
  }
  return null;
}

function openClawSam31ConsumerReviewFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'openclaw_sam31_consumer_review' && parsed.review
      ? parsed.review
      : null;
  } catch {
    return null;
  }
}

function latestOpenClawSam31ConsumerReviewEvidence(projectName, sourceEvidenceId = null) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'openclaw_sam31_consumer_review'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  const latestByConsumer = new Map();
  for (const row of rows) {
    const review = openClawSam31ConsumerReviewFromEvidence(row);
    if (!review) continue;
    if (sourceEvidenceId && Number(review.source_pdf_boundary_evidence_id) !== Number(sourceEvidenceId)) {
      continue;
    }
    const key = String(review.consumer || '').trim();
    if (key && !latestByConsumer.has(key)) {
      latestByConsumer.set(key, { evidence: row, review });
    }
  }
  return [...latestByConsumer.values()];
}

function openClawSam31ConsumerReviewSummaries(reviewEvidences) {
  return (Array.isArray(reviewEvidences) ? reviewEvidences : [])
    .filter((item) => item?.evidence && item?.review)
    .map(({ evidence, review }) => ({
      evidence_id: evidence.id,
      evidence_status: evidence.status,
      source_ref: evidence.source_ref,
      artifact_type: review.artifact_type || SAM31_CONSUMER_REVIEW_DECISION_TYPE,
      consumer: review.consumer,
      review_decision: review.review_decision,
      reviewer_name: review.reviewer_name,
      reviewed_at: review.reviewed_at,
      accepted_queue_id: review.accepted_queue_id,
      persisted_review_packet_ref: review.persisted_review_packet_ref,
      replacement_ref: review.replacement_ref,
      screenshot_ref: review.screenshot_ref,
      console_log_ref: review.console_log_ref,
      replaced_fields: Array.isArray(review.replaced_fields) ? [...review.replaced_fields] : [],
      claim_gate_effect: review.claim_gate_effect || 'no_claims_cleared',
    }));
}

function halofireSam31SprinklerReviewDecisionFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'halofire_sam31_sprinkler_review_decision' && parsed.review
      ? parsed.review
      : null;
  } catch {
    return null;
  }
}

function latestHalofireSam31SprinklerReviewDecisionEvidence(projectName, sourceEvidenceId = null) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'halofire_sam31_sprinkler_review_decision'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  const latestByQueueKey = new Map();
  for (const row of rows) {
    const review = halofireSam31SprinklerReviewDecisionFromEvidence(row);
    if (!review) continue;
    if (sourceEvidenceId && Number(review.source_pdf_boundary_evidence_id) !== Number(sourceEvidenceId)) {
      continue;
    }
    const key = `${review.source_openclaw_sam31_consumer_review_evidence_id || ''}::${review.issue_type || ''}::${review.supported_sprinkler_review_lane || ''}`;
    if (!latestByQueueKey.has(key)) {
      latestByQueueKey.set(key, { evidence: row, review });
    }
  }
  return [...latestByQueueKey.values()];
}

function halofireSam31SprinklerReviewDecisionSummary(decisionEvidence) {
  if (!decisionEvidence?.evidence || !decisionEvidence?.review) return null;
  const { evidence, review } = decisionEvidence;
  return {
    evidence_id: evidence.id,
    evidence_status: evidence.status,
    source_ref: evidence.source_ref,
    artifact_type: review.artifact_type || HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_TYPE,
    status: review.status || 'present',
    review_decision: review.review_decision,
    reviewer_name: review.reviewer_name,
    reviewed_at: review.reviewed_at,
    issue_type: review.issue_type,
    supported_sprinkler_review_lane: review.supported_sprinkler_review_lane,
    review_ref: review.review_ref,
    claim_gate_effect: review.claim_gate_effect || 'no_claims_cleared',
    use_for_claims: false,
  };
}

function halofireSam31SprinklerPreliminaryReplayFollowupDecisionFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'halofire_sam31_sprinkler_preliminary_replay_followup_decision' && parsed.followup
      ? parsed.followup
      : null;
  } catch {
    return null;
  }
}

function latestHalofireSam31SprinklerPreliminaryReplayFollowupDecisionEvidence(projectName, sourceEvidenceId = null) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'halofire_sam31_sprinkler_preliminary_replay_followup_decision'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  const latestBySprinklerReviewEvidenceId = new Map();
  for (const row of rows) {
    const followup = halofireSam31SprinklerPreliminaryReplayFollowupDecisionFromEvidence(row);
    if (!followup) continue;
    if (sourceEvidenceId && Number(followup.source_pdf_boundary_evidence_id) !== Number(sourceEvidenceId)) {
      continue;
    }
    const key = String(followup.source_halofire_sam31_sprinkler_review_decision_evidence_id || '');
    if (key && !latestBySprinklerReviewEvidenceId.has(key)) {
      latestBySprinklerReviewEvidenceId.set(key, { evidence: row, followup });
    }
  }
  return [...latestBySprinklerReviewEvidenceId.values()];
}

function halofireSam31SprinklerPreliminaryReplayFollowupSummary(followupEvidence) {
  if (!followupEvidence?.evidence || !followupEvidence?.followup) return null;
  const { evidence, followup } = followupEvidence;
  return {
    evidence_id: evidence.id,
    evidence_status: evidence.status,
    source_ref: evidence.source_ref,
    artifact_type: followup.artifact_type || HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_FOLLOWUP_DECISION_TYPE,
    followup_decision: followup.followup_decision,
    reviewer_name: followup.reviewer_name,
    reviewed_at: followup.reviewed_at,
    review_ref: followup.review_ref,
    packet_ref: followup.packet_ref,
    packet_queue_items: Array.isArray(followup.packet_queue_items) ? jsonClone(followup.packet_queue_items) : [],
    claim_gate_effect: followup.claim_gate_effect || 'no_claims_cleared',
  };
}

function openClawSam31UnresolvedConsumerReviewSummaries(consumerSmokeSummary, consumerReviewSummaries) {
  const tasks = Array.isArray(consumerSmokeSummary?.consumer_review_tasks)
    ? consumerSmokeSummary.consumer_review_tasks
    : [];
  const reviewed = new Set((Array.isArray(consumerReviewSummaries) ? consumerReviewSummaries : [])
    .filter((review) => review?.consumer && review?.accepted_queue_id && review?.persisted_review_packet_ref)
    .map((review) => `${review.consumer}::${review.accepted_queue_id}::${review.persisted_review_packet_ref}`));
  return tasks
    .filter((task) => task?.consumer && task?.accepted_queue_id && task?.persisted_review_packet_ref)
    .filter((task) => !reviewed.has(`${task.consumer}::${task.accepted_queue_id}::${task.persisted_review_packet_ref}`))
    .map((task) => ({
      artifact_type: task.artifact_type || SAM31_CONSUMER_REVIEW_TASK_TYPE,
      consumer: task.consumer,
      status: task.status || 'requires_product_review',
      accepted_queue_id: task.accepted_queue_id,
      persisted_review_packet_ref: task.persisted_review_packet_ref,
      acceptable_evidence: Array.isArray(task.acceptable_evidence) ? [...task.acceptable_evidence] : [],
      source_application: task.source_application || 'halo_fire',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      next_action: `Review or replace the ${task.consumer} SAM31 semantic labels, object hypotheses, vector overlays, and 3D model candidates before treating that consumer handoff as accepted.`,
    }));
}

function openClawSam31ConsumerSmokeReplaySummary(consumerSmokeEvidence) {
  if (!consumerSmokeEvidence?.evidence || !consumerSmokeEvidence?.artifact) return null;
  const { evidence, artifact } = consumerSmokeEvidence;
  return {
    evidence_id: evidence.id,
    evidence_type: evidence.evidence_type,
    evidence_status: evidence.status,
    source_ref: evidence.source_ref,
    status: artifact.status || 'consumer_smoke_recorded',
    source_pdf_boundary_evidence_id: artifact.source_pdf_boundary_evidence_id || null,
    source_openclaw_sam31_extrapolation_evidence_id: artifact.source_openclaw_sam31_extrapolation_evidence_id || null,
    canonical_tool_descriptor_url: artifact.canonical_tool_descriptor_url || null,
    posted_consumer_count: Number.isFinite(Number(artifact.posted_consumer_count)) ? Number(artifact.posted_consumer_count) : 0,
    blocked_consumer_count: Number.isFinite(Number(artifact.blocked_consumer_count)) ? Number(artifact.blocked_consumer_count) : 0,
    consumer_results: Array.isArray(artifact.consumer_results) ? jsonClone(artifact.consumer_results) : [],
    consumer_review_tasks: Array.isArray(artifact.consumer_review_tasks) ? jsonClone(artifact.consumer_review_tasks) : [],
    missing_evidence_rows: Array.isArray(artifact.missing_evidence_rows) ? jsonClone(artifact.missing_evidence_rows) : [],
    use_for_claims: false,
    claim_gate_effect: artifact.claim_gate_effect || 'no_claims_cleared',
    blocked_claims: Array.isArray(artifact.blocked_claims) ? [...artifact.blocked_claims] : [],
    limitations: Array.isArray(artifact.limitations) ? [...artifact.limitations] : [],
  };
}

function buildOpenClawSam31ConsumerSmokeDownloadPacket(projectName, evidence, decision, consumerSmokeEvidence) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!consumerSmokeEvidence?.evidence || !consumerSmokeEvidence?.artifact) {
    const e = new Error('OpenClaw SAM31 consumer smoke evidence is required before downloading the consumer smoke packet');
    e.httpStatus = 409;
    throw e;
  }
  const { evidence: consumerEvidence, artifact } = consumerSmokeEvidence;
  return {
    ...jsonClone(artifact),
    artifact_type: SAM31_CONSUMER_SMOKE_ARTIFACT_TYPE,
    project_name: projectName,
    generated_at: new Date().toISOString(),
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_consumer_smoke_evidence_id: consumerEvidence.id,
    source_ref: evidence.source_ref || decision.sourceRef || artifact.source_ref || null,
    source_file: evidence.source_file || decision.sourceFile || artifact.source_file || null,
    download_name: `${slugForDownloadName(projectName)}-sam31-consumer-smoke-artifact-${evidence.id}.json`,
    consumer_results: Array.isArray(artifact.consumer_results) ? jsonClone(artifact.consumer_results) : [],
    consumer_review_tasks: Array.isArray(artifact.consumer_review_tasks)
      ? jsonClone(artifact.consumer_review_tasks).map((task) => ({
        ...task,
        source_openclaw_sam31_consumer_smoke_evidence_id: consumerEvidence.id,
      }))
      : [],
    missing_evidence_rows: Array.isArray(artifact.missing_evidence_rows) ? jsonClone(artifact.missing_evidence_rows) : [],
    posted_consumer_count: Number.isFinite(Number(artifact.posted_consumer_count)) ? Number(artifact.posted_consumer_count) : 0,
    blocked_consumer_count: Number.isFinite(Number(artifact.blocked_consumer_count)) ? Number(artifact.blocked_consumer_count) : 0,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: uniqueStrings([
      ...(Array.isArray(artifact.limitations) ? artifact.limitations : []),
      'This downloadable packet is replay evidence for consumer queue handoff only; it does not prove consumer review acceptance or regulated readiness.',
    ]),
  };
}

function buildOpenClawSam31ConsumerReviewDecisionPacket(projectName, evidence, decision, reviewEvidence, review, consumerSmokeEvidence) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!reviewEvidence || !review) {
    const e = new Error('SAM31 consumer review evidence is required before downloading the consumer review decision packet');
    e.httpStatus = 409;
    throw e;
  }
  if (Number(review.source_pdf_boundary_evidence_id) !== Number(evidence.id)) {
    const e = new Error('SAM31 consumer review evidence does not belong to the requested PDF boundary evidence');
    e.httpStatus = 409;
    throw e;
  }
  const consumerSmokeArtifact = consumerSmokeEvidence ? openClawSam31ConsumerSmokeArtifactFromEvidence(consumerSmokeEvidence) : null;
  const sourceTask = review.consumer_review_task && typeof review.consumer_review_task === 'object'
    ? review.consumer_review_task
    : (Array.isArray(consumerSmokeArtifact?.consumer_review_tasks)
      ? consumerSmokeArtifact.consumer_review_tasks.find((task) => task.consumer === review.consumer
        && task.accepted_queue_id === review.accepted_queue_id
        && task.persisted_review_packet_ref === review.persisted_review_packet_ref)
      : null);
  const sourceRefs = [
    {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_file: evidence.source_file || decision.sourceFile || null,
      source_ref: evidence.source_ref || decision.sourceRef || null,
      status: evidence.status,
    },
    ...(consumerSmokeEvidence ? [{
      evidence_id: consumerSmokeEvidence.id,
      evidence_type: consumerSmokeEvidence.evidence_type,
      source_file: consumerSmokeEvidence.source_file || null,
      source_ref: consumerSmokeEvidence.source_ref || null,
      status: consumerSmokeEvidence.status,
      claim_gate_effect: 'no_claims_cleared',
    }] : []),
    {
      evidence_id: reviewEvidence.id,
      evidence_type: reviewEvidence.evidence_type,
      source_file: reviewEvidence.source_file || null,
      source_ref: reviewEvidence.source_ref || review.replacement_ref || null,
      status: reviewEvidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
    ...(Array.isArray(review.source_refs) ? jsonClone(review.source_refs) : []),
  ];
  return {
    artifact_type: 'openclaw.sam31.consumer_review_decision_packet.v1',
    status: 'ready_for_consumer_review_replay',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    consumer: review.consumer,
    source_application: review.source_application || 'halo_fire',
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_consumer_review_evidence_id: reviewEvidence.id,
    source_openclaw_sam31_consumer_smoke_evidence_id: review.source_openclaw_sam31_consumer_smoke_evidence_id || consumerSmokeEvidence?.id || null,
    accepted_queue_id: review.accepted_queue_id,
    persisted_review_packet_ref: review.persisted_review_packet_ref,
    replacement_ref: review.replacement_ref,
    screenshot_ref: review.screenshot_ref || null,
    console_log_ref: review.console_log_ref || null,
    download_name: `${slugForDownloadName(projectName)}-sam31-consumer-review-decision-${slugForDownloadName(review.consumer)}-${reviewEvidence.id}.json`,
    consumer_review_decision: jsonClone(review),
    consumer_review_task: sourceTask ? jsonClone(sourceTask) : null,
    replacement_values: review.replacement_values && typeof review.replacement_values === 'object'
      ? jsonClone(review.replacement_values)
      : {},
    replaced_fields: Array.isArray(review.replaced_fields) ? [...review.replaced_fields] : [],
    acceptable_evidence: Array.isArray(review.acceptable_evidence) ? [...review.acceptable_evidence] : [],
    source_refs: uniqueByJson(sourceRefs),
    use_for_claims: false,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(review.blocked_claims) ? review.blocked_claims : []),
      'professional_approval',
      'AHJ_approval',
      'AutoSprink_parity',
      'fabrication_ready',
      'manufacturer_exact',
    ]),
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: uniqueStrings([
      ...(Array.isArray(review.limitations) ? review.limitations : []),
      'This consumer review decision packet is replay/export evidence for downstream product-owner review only.',
      'It does not prove consumer product acceptance, production readiness, AHJ approval, PE review, AutoSprink parity, fabrication readiness, or manufacturer-exact models.',
    ]),
  };
}

function openClawSam31SprinklerIssueSeeds(review) {
  const values = review?.replacement_values && typeof review.replacement_values === 'object'
    ? review.replacement_values
    : {};
  const seeds = [];
  const pushSeed = (issueType, count, lane, nextAction) => {
    if (count > 0) {
      seeds.push({
        issue_type: issueType,
        status: 'requires_employee_sprinkler_review',
        count,
        supported_sprinkler_review_lane: lane,
        next_action: nextAction,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      });
    }
  };
  pushSeed(
    'sam31_consumer_reviewed_semantic_labels',
    Array.isArray(values.semantic_labels) ? values.semantic_labels.length : 0,
    'room_boundary_visual_audit',
    'Compare reviewed semantic labels against the 1881 sheet room/area evidence before using them in sprinkler layout review.',
  );
  pushSeed(
    'sam31_consumer_reviewed_object_hypotheses',
    Array.isArray(values.object_hypotheses) ? values.object_hypotheses.length : 0,
    'obstruction_or_clash_review',
    'Review object hypotheses as obstruction, sleeve, penetration, or clash candidates; do not treat them as engineered facts.',
  );
  pushSeed(
    'sam31_consumer_reviewed_vector_overlays',
    Array.isArray(values.vector_overlays) ? values.vector_overlays.length : 0,
    'vector_overlay_generation',
    'Overlay reviewed vectors on the source sheet and employee-marked plan before downstream CAD/BIM use.',
  );
  pushSeed(
    'sam31_consumer_reviewed_model_3d_candidates',
    Array.isArray(values.model_3d_candidates) ? values.model_3d_candidates.length : 0,
    'model_3d_candidate_generation',
    'Treat 3D candidates as geometry proposals for visual review only until manufacturer/professional evidence replaces them.',
  );
  if (!seeds.length) {
    seeds.push({
      issue_type: 'sam31_consumer_review_values_missing',
      status: 'requires_employee_sprinkler_review',
      count: 0,
      supported_sprinkler_review_lane: 'room_boundary_visual_audit',
      next_action: 'Attach reviewed semantic labels, object hypotheses, vector overlays, or 3D candidates before using this adapter for sprinkler review.',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    });
  }
  return seeds;
}

function openClawSam31SprinklerReviewQueueItems(projectName, evidence, decision, reviewEvidences, sprinklerReviewDecisionEvidences = []) {
  if (!evidence || !decision) return [];
  const latestDecisionsByKey = new Map(
    (Array.isArray(sprinklerReviewDecisionEvidences) ? sprinklerReviewDecisionEvidences : [])
      .filter((item) => item?.evidence && item?.review)
      .map((item) => [
        `${item.review.source_openclaw_sam31_consumer_review_evidence_id || ''}::${item.review.issue_type || ''}::${item.review.supported_sprinkler_review_lane || ''}`,
        item,
      ]),
  );
  return (Array.isArray(reviewEvidences) ? reviewEvidences : [])
    .filter((item) => item?.evidence && item?.review)
    .flatMap(({ evidence: reviewEvidence, review }) => {
      const blockedClaims = uniqueStrings([
        ...(Array.isArray(review.blocked_claims) ? review.blocked_claims : []),
        ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
        'permit_ready',
        'professional_approval',
        'AHJ_approval',
        'AutoSprink_parity',
        'fabrication_ready',
        'manufacturer_exact',
      ]);
      return openClawSam31SprinklerIssueSeeds(review).map((seed) => {
        const latestDecision = latestDecisionsByKey.get(`${reviewEvidence.id}::${seed.issue_type}::${seed.supported_sprinkler_review_lane}`);
        return {
          artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_QUEUE_ITEM_TYPE,
          id: `sam31-sprinkler:${evidence.id}:${reviewEvidence.id}:${seed.issue_type}`,
          project_name: projectName,
          status: latestDecision ? 'employee_sprinkler_review_recorded' : (seed.status || 'requires_employee_sprinkler_review'),
          source_adapter_artifact_type: SAM31_TO_SPRINKLER_REVIEW_ADAPTER_TYPE,
          source_pdf_boundary_evidence_id: evidence.id,
          source_openclaw_sam31_consumer_review_evidence_id: reviewEvidence.id,
          source_openclaw_sam31_consumer_smoke_evidence_id: review.source_openclaw_sam31_consumer_smoke_evidence_id || null,
          source_application: review.source_application || 'halo_fire',
          consumer: review.consumer,
          accepted_queue_id: review.accepted_queue_id || null,
          persisted_review_packet_ref: review.persisted_review_packet_ref || null,
          replacement_ref: review.replacement_ref || null,
          screenshot_ref: review.screenshot_ref || null,
          console_log_ref: review.console_log_ref || null,
          issue_type: seed.issue_type,
          issue_count: seed.count,
          supported_sprinkler_review_lane: seed.supported_sprinkler_review_lane,
          next_action: latestDecision
            ? 'Use the latest HaloFire employee sprinkler review decision as temporary internal-alpha correction evidence; regulated claims remain blocked.'
            : seed.next_action,
          acceptable_evidence: [
            'HaloFire employee sprinkler review note',
            'marked-up 1881 sheet screenshot',
            'source-linked sleeve/firestop/obstruction/clash decision',
            'reviewed vector overlay or 3D model candidate source reference',
            'professional/AHJ/manufacturer evidence for any regulated claim',
          ],
          latest_sam31_sprinkler_review_decision: halofireSam31SprinklerReviewDecisionSummary(latestDecision),
          blocked_claims: blockedClaims,
          limitations: [
            'This row turns SAM31+LLM consumer review output into an executable employee review task only.',
            'It cannot clear AHJ, PE, AutoSprink parity, permit-ready, fabrication-ready, or manufacturer-exact claims.',
          ],
          use_for_claims: false,
          claim_gate_effect: seed.claim_gate_effect || 'no_claims_cleared',
          no_claim_gates_cleared: true,
        };
      });
    });
}

function normalizeHalofireSam31SprinklerReviewDecision(projectName, evidence, decision, reviewEvidence, review, body = {}, user = {}) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!reviewEvidence || !review) {
    const e = new Error('SAM31 consumer review evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (Number(review.source_pdf_boundary_evidence_id) !== Number(evidence.id)) {
    const e = new Error('SAM31 consumer review evidence does not belong to the requested PDF boundary evidence');
    e.httpStatus = 409;
    throw e;
  }
  const issueType = String(body.issue_type || '').trim();
  const supportedSprinklerReviewLane = String(body.supported_sprinkler_review_lane || '').trim();
  const queueItem = openClawSam31SprinklerReviewQueueItems(
    projectName,
    evidence,
    decision,
    [{ evidence: reviewEvidence, review }],
    [],
  ).find((item) => item.issue_type === issueType && item.supported_sprinkler_review_lane === supportedSprinklerReviewLane);
  if (!queueItem) {
    const e = new Error('issue_type and supported_sprinkler_review_lane must match a SAM31 sprinkler review queue item');
    e.httpStatus = 409;
    throw e;
  }
  const reviewDecision = String(body.review_decision || 'replaced').trim().toLowerCase();
  if (!['accepted', 'replaced', 'rejected'].includes(reviewDecision)) {
    const e = new Error('review_decision must be one of: accepted, replaced, rejected');
    e.httpStatus = 400;
    throw e;
  }
  const reviewRef = String(body.review_ref || body.source_ref || '').trim();
  if (!reviewRef) {
    const e = new Error('review_ref is required for SAM31 sprinkler review decision evidence');
    e.httpStatus = 400;
    throw e;
  }
  const screenshotRef = String(body.screenshot_ref || '').trim();
  const consoleLogRef = String(body.console_log_ref || '').trim();
  if (!screenshotRef && !consoleLogRef) {
    const e = new Error('screenshot_ref or console_log_ref is required for SAM31 sprinkler review decision evidence');
    e.httpStatus = 400;
    throw e;
  }
  const rawValues = body.reviewed_values;
  if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) {
    const e = new Error('reviewed_values must be an object');
    e.httpStatus = 400;
    throw e;
  }
  const reviewedValues = jsonClone(rawValues);
  if (Object.prototype.hasOwnProperty.call(reviewedValues, 'confidence')) {
    const confidence = Number(reviewedValues.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      const e = new Error('reviewed_values.confidence must be a number between 0 and 1');
      e.httpStatus = 400;
      throw e;
    }
    reviewedValues.confidence = confidence;
  }
  const sourceRefs = [
    {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_file: evidence.source_file || decision.sourceFile || null,
      source_ref: evidence.source_ref || decision.sourceRef || null,
      status: evidence.status,
    },
    {
      evidence_id: reviewEvidence.id,
      evidence_type: reviewEvidence.evidence_type,
      source_file: reviewEvidence.source_file || null,
      source_ref: reviewEvidence.source_ref || review.replacement_ref || null,
      status: reviewEvidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_type: queueItem.artifact_type,
      source_ref: queueItem.id,
      status: queueItem.status,
      issue_type: queueItem.issue_type,
      supported_sprinkler_review_lane: queueItem.supported_sprinkler_review_lane,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_type: 'employee_sam31_sprinkler_review_payload',
      source_ref: reviewRef,
      status: 'present',
      claim_gate_effect: 'no_claims_cleared',
    },
  ];
  if (screenshotRef) {
    sourceRefs.push({
      evidence_type: 'sprinkler_review_screenshot',
      source_ref: screenshotRef,
      status: 'present',
      claim_gate_effect: 'no_claims_cleared',
    });
  }
  if (consoleLogRef) {
    sourceRefs.push({
      evidence_type: 'sprinkler_review_console_log',
      source_ref: consoleLogRef,
      status: 'present',
      claim_gate_effect: 'no_claims_cleared',
    });
  }
  return {
    artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_TYPE,
    status: 'present',
    project_name: projectName,
    source_queue_item_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_QUEUE_ITEM_TYPE,
    source_queue_item_id: queueItem.id,
    source_adapter_artifact_type: SAM31_TO_SPRINKLER_REVIEW_ADAPTER_TYPE,
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_consumer_review_evidence_id: reviewEvidence.id,
    source_openclaw_sam31_consumer_smoke_evidence_id: review.source_openclaw_sam31_consumer_smoke_evidence_id || null,
    source_application: review.source_application || 'halo_fire',
    consumer: review.consumer,
    accepted_queue_id: review.accepted_queue_id || null,
    persisted_review_packet_ref: review.persisted_review_packet_ref || null,
    issue_type: issueType,
    issue_count: queueItem.issue_count,
    supported_sprinkler_review_lane: supportedSprinklerReviewLane,
    review_decision: reviewDecision,
    reviewer_name: String(body.reviewer_name || user.name || user.username || '').trim() || null,
    reviewed_at: new Date().toISOString(),
    review_ref: reviewRef,
    screenshot_ref: screenshotRef || null,
    console_log_ref: consoleLogRef || null,
    reviewed_values: reviewedValues,
    acceptable_evidence: Array.isArray(queueItem.acceptable_evidence) ? [...queueItem.acceptable_evidence] : [],
    notes: String(body.notes || '').trim() || null,
    source_refs: uniqueByJson(sourceRefs),
    blocked_claims: uniqueStrings([
      ...(Array.isArray(queueItem.blocked_claims) ? queueItem.blocked_claims : []),
      'permit_ready',
      'professional_approval',
      'AHJ_approval',
      'AutoSprink_parity',
      'fabrication_ready',
      'manufacturer_exact',
    ]),
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: [
      'This decision records HaloFire employee review of one SAM31-derived sprinkler review queue row for internal-alpha use only.',
      'It can accept or replace temporary obstruction, sleeve/firestop, vector, or 3D model candidate values, but it does not clear regulated claims.',
    ],
  };
}

function halofireSam31SprinklerReplayScope(lane) {
  return ({
    room_boundary_visual_audit: 'room_boundary_visual_audit',
    obstruction_or_clash_review: 'obstruction_clash_candidate_review',
    vector_overlay_generation: 'vector_overlay_generation',
    model_3d_candidate_generation: 'model_3d_candidate_generation',
  })[lane] || 'sprinkler_employee_review_replay';
}

function buildHalofireSam31SprinklerReviewDecisionPacket(projectName, evidence, decision, reviewEvidence, review, sprinklerReviewEvidence, sprinklerReview) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!reviewEvidence || !review) {
    const e = new Error('SAM31 consumer review evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!sprinklerReviewEvidence || !sprinklerReview) {
    const e = new Error('HaloFire SAM31 sprinkler review decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (Number(review.source_pdf_boundary_evidence_id) !== Number(evidence.id)) {
    const e = new Error('SAM31 consumer review evidence does not belong to the requested PDF boundary evidence');
    e.httpStatus = 409;
    throw e;
  }
  if (Number(sprinklerReview.source_pdf_boundary_evidence_id) !== Number(evidence.id)) {
    const e = new Error('SAM31 sprinkler review decision does not belong to the requested PDF boundary evidence');
    e.httpStatus = 409;
    throw e;
  }
  if (Number(sprinklerReview.source_openclaw_sam31_consumer_review_evidence_id) !== Number(reviewEvidence.id)) {
    const e = new Error('SAM31 sprinkler review decision does not belong to the requested consumer review evidence');
    e.httpStatus = 409;
    throw e;
  }
  const lane = sprinklerReview.supported_sprinkler_review_lane || 'sprinkler_employee_review';
  const reviewedValues = sprinklerReview.reviewed_values && typeof sprinklerReview.reviewed_values === 'object'
    ? jsonClone(sprinklerReview.reviewed_values)
    : {};
  const blockedClaims = uniqueStrings([
    ...(Array.isArray(sprinklerReview.blocked_claims) ? sprinklerReview.blocked_claims : []),
    ...(Array.isArray(review.blocked_claims) ? review.blocked_claims : []),
    ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
    'permit_ready',
    'professional_approval',
    'AHJ_approval',
    'AutoSprink_parity',
    'fabrication_ready',
    'manufacturer_exact',
    'geometry_accuracy',
    'drawing_scale',
    'PE_review',
  ]);
  const sourceRefs = uniqueByJson([
    {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_file: evidence.source_file || decision.sourceFile || null,
      source_ref: evidence.source_ref || decision.sourceRef || null,
      status: evidence.status,
    },
    {
      evidence_id: reviewEvidence.id,
      evidence_type: reviewEvidence.evidence_type,
      source_file: reviewEvidence.source_file || null,
      source_ref: reviewEvidence.source_ref || review.replacement_ref || null,
      status: reviewEvidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_id: sprinklerReviewEvidence.id,
      evidence_type: sprinklerReviewEvidence.evidence_type,
      source_file: sprinklerReviewEvidence.source_file || null,
      source_ref: sprinklerReviewEvidence.source_ref || sprinklerReview.review_ref || null,
      status: sprinklerReviewEvidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
    ...(Array.isArray(sprinklerReview.source_refs) ? jsonClone(sprinklerReview.source_refs) : []),
  ]);
  const preliminaryReplayInputs = {
    artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PRELIMINARY_REPLAY_INPUTS_TYPE,
    status: 'requires_internal_alpha_replay',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    source: HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_PACKET_TYPE,
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_consumer_review_evidence_id: reviewEvidence.id,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: sprinklerReviewEvidence.id,
    source_queue_item_id: sprinklerReview.source_queue_item_id || null,
    issue_type: sprinklerReview.issue_type || null,
    supported_sprinkler_review_lane: lane,
    evidence_lanes: uniqueStrings([lane]),
    replay_scope: halofireSam31SprinklerReplayScope(lane),
    reviewed_values: reviewedValues,
    source_refs: sourceRefs,
    next_action: 'Replay these employee-reviewed SAM31 values as internal-alpha sprinkler review inputs, then attach official/professional/manufacturer evidence before clearing any regulated claim.',
    use_for_claims: false,
    blocked_claims: blockedClaims,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: [
      'These replay inputs are correction evidence for internal-alpha review only.',
      'They do not prove AHJ approval, PE review, AutoSprink parity, fabrication readiness, drawing scale, geometry accuracy, or manufacturer exactness.',
    ],
  };
  return {
    artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_PACKET_TYPE,
    status: 'ready_for_internal_alpha_sprinkler_replay',
    source: HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_TYPE,
    project_name: projectName,
    generated_at: new Date().toISOString(),
    source_queue_item_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_QUEUE_ITEM_TYPE,
    source_queue_item_id: sprinklerReview.source_queue_item_id || null,
    source_adapter_artifact_type: SAM31_TO_SPRINKLER_REVIEW_ADAPTER_TYPE,
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_consumer_review_evidence_id: reviewEvidence.id,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: sprinklerReviewEvidence.id,
    source_openclaw_sam31_consumer_smoke_evidence_id: sprinklerReview.source_openclaw_sam31_consumer_smoke_evidence_id || review.source_openclaw_sam31_consumer_smoke_evidence_id || null,
    source_application: sprinklerReview.source_application || review.source_application || 'halo_fire',
    consumer: sprinklerReview.consumer || review.consumer || null,
    accepted_queue_id: sprinklerReview.accepted_queue_id || review.accepted_queue_id || null,
    persisted_review_packet_ref: sprinklerReview.persisted_review_packet_ref || review.persisted_review_packet_ref || null,
    issue_type: sprinklerReview.issue_type || null,
    issue_count: Number.isFinite(Number(sprinklerReview.issue_count)) ? Number(sprinklerReview.issue_count) : 0,
    supported_sprinkler_review_lane: lane,
    review_decision: sprinklerReview.review_decision || null,
    reviewer_name: sprinklerReview.reviewer_name || null,
    reviewed_at: sprinklerReview.reviewed_at || null,
    review_ref: sprinklerReview.review_ref || sprinklerReviewEvidence.source_ref || null,
    screenshot_ref: sprinklerReview.screenshot_ref || null,
    console_log_ref: sprinklerReview.console_log_ref || null,
    download_name: `${slugForDownloadName(projectName)}-sam31-sprinkler-review-decision-${slugForDownloadName(sprinklerReview.consumer || review.consumer || 'consumer')}-${sprinklerReviewEvidence.id}.json`,
    reviewed_values: reviewedValues,
    consumer_review_decision: jsonClone(review),
    sprinkler_review_decision: jsonClone(sprinklerReview),
    preliminary_replay_inputs: preliminaryReplayInputs,
    acceptable_evidence: Array.isArray(sprinklerReview.acceptable_evidence) ? [...sprinklerReview.acceptable_evidence] : [],
    source_refs: sourceRefs,
    use_for_claims: false,
    blocked_claims: blockedClaims,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: uniqueStrings([
      ...(Array.isArray(sprinklerReview.limitations) ? sprinklerReview.limitations : []),
      'This packet packages employee-reviewed SAM31+LLM segmentation/object/vector/3D-candidate corrections for replay only.',
      'It cannot clear permit-ready, AHJ-ready, PE-reviewed, AutoSprink parity, fabrication-ready, or manufacturer-exact claims.',
    ]),
  };
}

function halofireSam31SprinklerReplayIssueCandidates(reviewedValues) {
  if (!reviewedValues || typeof reviewedValues !== 'object') return [];
  const candidateFields = [
    'obstruction_candidates',
    'sleeve_or_firestop_candidates',
    'vector_overlays',
    'model_3d_candidates',
    'semantic_labels',
  ];
  return candidateFields.flatMap((field) => {
    const values = Array.isArray(reviewedValues[field]) ? reviewedValues[field] : [];
    return values.map((value, index) => ({
      source_field: field,
      source_index: index,
      value: jsonClone(value),
      status: 'requires_employee_or_professional_followup',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
  });
}

function halofireSam31SprinklerPacketQueueItemType(lane, sourceField = '') {
  const normalizedLane = String(lane || '').toLowerCase();
  const normalizedField = String(sourceField || '').toLowerCase();
  if (normalizedLane === 'sleeve_or_firestop_candidate_review' || normalizedField.includes('sleeve') || normalizedField.includes('firestop')) {
    return HALOFIRE_SAM31_SLEEVE_FIRESTOP_PACKET_QUEUE_ITEM_TYPE;
  }
  return HALOFIRE_SAM31_OBSTRUCTION_CLASH_PACKET_QUEUE_ITEM_TYPE;
}

function halofireSam31SprinklerPreliminaryReplayPacketQueueItems(followup, followupEvidenceId = null) {
  if (!followup || !Array.isArray(followup.issue_decisions)) return [];
  return followup.issue_decisions.map((decision, index) => {
    const targetLane = String(decision.target_packet_lane || followup.supported_sprinkler_review_lane || 'obstruction_or_clash_review').trim();
    const sourceField = String(decision.source_field || '').trim();
    return {
      artifact_type: halofireSam31SprinklerPacketQueueItemType(targetLane, sourceField),
      id: `sam31-sprinkler-packet:${followup.source_halofire_sam31_sprinkler_review_decision_evidence_id || 'pending'}:${index}`,
      project_name: followup.project_name,
      status: 'ready_for_internal_alpha_packet',
      source_followup_decision_artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_FOLLOWUP_DECISION_TYPE,
      source_followup_decision_evidence_id: followupEvidenceId || null,
      source_preliminary_replay_artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_ARTIFACT_TYPE,
      source_preliminary_replay_output_artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_OUTPUT_TYPE,
      source_pdf_boundary_evidence_id: followup.source_pdf_boundary_evidence_id,
      source_openclaw_sam31_consumer_review_evidence_id: followup.source_openclaw_sam31_consumer_review_evidence_id,
      source_halofire_sam31_sprinkler_review_decision_evidence_id: followup.source_halofire_sam31_sprinkler_review_decision_evidence_id,
      target_packet_lane: targetLane,
      source_field: sourceField,
      source_index: Number.isSafeInteger(Number(decision.source_index)) ? Number(decision.source_index) : index,
      decision: String(decision.decision || followup.followup_decision || 'requires_followup').trim(),
      packet_ref: decision.packet_ref || followup.packet_ref || null,
      notes: decision.notes || null,
      next_action: 'Create or download the source-linked obstruction/clash or sleeve/firestop packet for employee/professional review; keep regulated claims blocked until official evidence exists.',
      acceptable_evidence: [
        'HaloFire employee packet review',
        'marked-up obstruction/clash or sleeve/firestop screenshot',
        'source-linked packet JSON',
        'professional/AHJ/manufacturer evidence for any regulated claim',
      ],
      blocked_claims: Array.isArray(followup.blocked_claims) ? [...followup.blocked_claims] : [],
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    };
  });
}

function buildHalofireSam31SprinklerPreliminaryReplayArtifact(projectName, evidence, decision, reviewEvidence, review, sprinklerReviewEvidence, sprinklerReview) {
  const packet = buildHalofireSam31SprinklerReviewDecisionPacket(
    projectName,
    evidence,
    decision,
    reviewEvidence,
    review,
    sprinklerReviewEvidence,
    sprinklerReview,
  );
  const replayInputs = packet.preliminary_replay_inputs && typeof packet.preliminary_replay_inputs === 'object'
    ? jsonClone(packet.preliminary_replay_inputs)
    : {};
  const issueCandidates = halofireSam31SprinklerReplayIssueCandidates(packet.reviewed_values);
  return {
    artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_ARTIFACT_TYPE,
    status: 'preliminary_replay_ready_for_internal_alpha_review',
    source: HALOFIRE_SAM31_SPRINKLER_REVIEW_PRELIMINARY_REPLAY_INPUTS_TYPE,
    source_decision_packet_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_PACKET_TYPE,
    project_name: projectName,
    generated_at: new Date().toISOString(),
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_consumer_review_evidence_id: reviewEvidence.id,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: sprinklerReviewEvidence.id,
    source_queue_item_id: sprinklerReview.source_queue_item_id || null,
    source_application: packet.source_application,
    consumer: packet.consumer,
    accepted_queue_id: packet.accepted_queue_id,
    persisted_review_packet_ref: packet.persisted_review_packet_ref,
    issue_type: packet.issue_type,
    supported_sprinkler_review_lane: packet.supported_sprinkler_review_lane,
    replay_scope: replayInputs.replay_scope || packet.preliminary_replay_inputs?.replay_scope || halofireSam31SprinklerReplayScope(packet.supported_sprinkler_review_lane),
    download_name: `${slugForDownloadName(projectName)}-sam31-sprinkler-preliminary-replay-${slugForDownloadName(packet.consumer || 'consumer')}-${sprinklerReviewEvidence.id}.json`,
    replay_inputs: replayInputs,
    replay_output: {
      artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_OUTPUT_TYPE,
      status: 'requires_employee_or_professional_followup',
      project_name: projectName,
      source_halofire_sam31_sprinkler_review_decision_evidence_id: sprinklerReviewEvidence.id,
      supported_sprinkler_review_lane: packet.supported_sprinkler_review_lane,
      replay_scope: replayInputs.replay_scope || halofireSam31SprinklerReplayScope(packet.supported_sprinkler_review_lane),
      issue_candidates: issueCandidates,
      issue_candidate_count: issueCandidates.length,
      next_action: 'Review replayed obstruction, clash, sleeve/firestop, vector, or 3D-candidate rows against the 1881 sheet and official evidence before clearing any regulated claim.',
      use_for_claims: false,
      blocked_claims: Array.isArray(packet.blocked_claims) ? [...packet.blocked_claims] : [],
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    },
    source_refs: Array.isArray(packet.source_refs) ? jsonClone(packet.source_refs) : [],
    use_for_claims: false,
    blocked_claims: Array.isArray(packet.blocked_claims) ? [...packet.blocked_claims] : [],
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: uniqueStrings([
      ...(Array.isArray(packet.limitations) ? packet.limitations : []),
      'This preliminary replay artifact is an internal-alpha execution aid only.',
      'It does not clear AHJ, PE, AutoSprink parity, permit-ready, fabrication-ready, manufacturer-exact, drawing-scale, or geometry-accuracy claims.',
    ]),
  };
}

function normalizeHalofireSam31SprinklerPreliminaryReplayFollowupDecision(projectName, evidence, decision, reviewEvidence, review, sprinklerReviewEvidence, sprinklerReview, body = {}, user = {}) {
  const replayArtifact = buildHalofireSam31SprinklerPreliminaryReplayArtifact(projectName, evidence, decision, reviewEvidence, review, sprinklerReviewEvidence, sprinklerReview);
  const followupDecision = String(body.followup_decision || 'confirmed_internal_obstruction_clash_packet').trim().toLowerCase();
  const allowedDecisions = [
    'confirmed_internal_obstruction_clash_packet',
    'confirmed_internal_sleeve_firestop_packet',
    'needs_more_evidence',
    'rejected_preliminary_replay',
  ];
  if (!allowedDecisions.includes(followupDecision)) {
    const e = new Error(`followup_decision must be one of: ${allowedDecisions.join(', ')}`);
    e.httpStatus = 400;
    throw e;
  }
  const reviewRef = String(body.review_ref || body.source_ref || '').trim();
  if (!reviewRef) {
    const e = new Error('review_ref is required for SAM31 sprinkler preliminary replay follow-up evidence');
    e.httpStatus = 400;
    throw e;
  }
  const issueDecisions = Array.isArray(body.issue_decisions) ? body.issue_decisions : [];
  if (!issueDecisions.length) {
    const e = new Error('issue_decisions must include at least one preliminary replay issue decision');
    e.httpStatus = 400;
    throw e;
  }
  const normalizedIssueDecisions = issueDecisions.map((item, index) => {
    if (!item || typeof item !== 'object') {
      const e = new Error('Each issue_decisions entry must be an object');
      e.httpStatus = 400;
      throw e;
    }
    return {
      source_field: String(item.source_field || '').trim(),
      source_index: Number.isSafeInteger(Number(item.source_index)) ? Number(item.source_index) : index,
      decision: String(item.decision || followupDecision).trim(),
      target_packet_lane: String(item.target_packet_lane || replayArtifact.supported_sprinkler_review_lane || 'obstruction_or_clash_review').trim(),
      packet_ref: item.packet_ref ? String(item.packet_ref).trim() : null,
      notes: item.notes ? String(item.notes).trim() : null,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    };
  });
  const followup = {
    artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_FOLLOWUP_DECISION_TYPE,
    status: 'present',
    project_name: projectName,
    source_preliminary_replay_artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_ARTIFACT_TYPE,
    source_preliminary_replay_output_artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_OUTPUT_TYPE,
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_consumer_review_evidence_id: reviewEvidence.id,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: sprinklerReviewEvidence.id,
    source_application: replayArtifact.source_application,
    consumer: replayArtifact.consumer,
    accepted_queue_id: replayArtifact.accepted_queue_id,
    persisted_review_packet_ref: replayArtifact.persisted_review_packet_ref,
    issue_type: replayArtifact.issue_type,
    supported_sprinkler_review_lane: replayArtifact.supported_sprinkler_review_lane,
    replay_scope: replayArtifact.replay_scope,
    followup_decision: followupDecision,
    reviewer_name: String(body.reviewer_name || user.name || user.username || '').trim() || null,
    reviewed_at: new Date().toISOString(),
    review_ref: reviewRef,
    screenshot_ref: String(body.screenshot_ref || '').trim() || null,
    console_log_ref: String(body.console_log_ref || '').trim() || null,
    packet_ref: String(body.packet_ref || '').trim() || null,
    issue_decisions: normalizedIssueDecisions,
    notes: String(body.notes || '').trim() || null,
    replay_output: replayArtifact.replay_output,
    source_refs: uniqueByJson([
      ...(Array.isArray(replayArtifact.source_refs) ? replayArtifact.source_refs : []),
      {
        evidence_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_ARTIFACT_TYPE,
        source_ref: replayArtifact.download_name,
        status: replayArtifact.status,
        claim_gate_effect: 'no_claims_cleared',
      },
      {
        evidence_type: 'sam31_sprinkler_preliminary_replay_followup_payload',
        source_ref: reviewRef,
        status: 'present',
        claim_gate_effect: 'no_claims_cleared',
      },
    ]),
    blocked_claims: Array.isArray(replayArtifact.blocked_claims) ? [...replayArtifact.blocked_claims] : [],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: uniqueStrings([
      ...(Array.isArray(replayArtifact.limitations) ? replayArtifact.limitations : []),
      'This follow-up decision can queue obstruction/clash or sleeve/firestop packet work, but it does not clear any regulated claim.',
    ]),
  };
  followup.packet_queue_items = halofireSam31SprinklerPreliminaryReplayPacketQueueItems(followup);
  return followup;
}

function halofireSam31SprinklerPreliminaryReplayQueueItems(projectName, evidence, decision, reviewEvidences, sprinklerReviewDecisionEvidences = [], preliminaryReplayFollowupDecisionEvidences = []) {
  if (!evidence || !decision) return [];
  const reviewsByEvidenceId = new Map(
    (Array.isArray(reviewEvidences) ? reviewEvidences : [])
      .filter((item) => item?.evidence && item?.review)
      .map((item) => [Number(item.evidence.id), item]),
  );
  const followupsBySprinklerReviewEvidenceId = new Map(
    (Array.isArray(preliminaryReplayFollowupDecisionEvidences) ? preliminaryReplayFollowupDecisionEvidences : [])
      .filter((item) => item?.evidence && item?.followup)
      .map((item) => [Number(item.followup.source_halofire_sam31_sprinkler_review_decision_evidence_id), item]),
  );
  return (Array.isArray(sprinklerReviewDecisionEvidences) ? sprinklerReviewDecisionEvidences : [])
    .filter((item) => item?.evidence && item?.review)
    .map(({ evidence: sprinklerReviewEvidence, review: sprinklerReview }) => {
      const sourceReview = reviewsByEvidenceId.get(Number(sprinklerReview.source_openclaw_sam31_consumer_review_evidence_id));
      if (!sourceReview) return null;
      const packet = buildHalofireSam31SprinklerReviewDecisionPacket(
        projectName,
        evidence,
        decision,
        sourceReview.evidence,
        sourceReview.review,
        sprinklerReviewEvidence,
        sprinklerReview,
      );
      const replayInputs = packet.preliminary_replay_inputs || {};
      const latestFollowup = followupsBySprinklerReviewEvidenceId.get(Number(sprinklerReviewEvidence.id)) || null;
      const latestFollowupSummary = halofireSam31SprinklerPreliminaryReplayFollowupSummary(latestFollowup);
      return {
        artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_QUEUE_ITEM_TYPE,
        id: `sam31-sprinkler-preliminary-replay:${evidence.id}:${sourceReview.evidence.id}:${sprinklerReviewEvidence.id}`,
        project_name: projectName,
        status: latestFollowupSummary ? 'preliminary_replay_followup_recorded' : 'ready_for_preliminary_replay',
        source_decision_packet_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_PACKET_TYPE,
        source_preliminary_replay_inputs_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PRELIMINARY_REPLAY_INPUTS_TYPE,
        source_pdf_boundary_evidence_id: evidence.id,
        source_openclaw_sam31_consumer_review_evidence_id: sourceReview.evidence.id,
        source_halofire_sam31_sprinkler_review_decision_evidence_id: sprinklerReviewEvidence.id,
        source_application: packet.source_application,
        consumer: packet.consumer,
        accepted_queue_id: packet.accepted_queue_id,
        persisted_review_packet_ref: packet.persisted_review_packet_ref,
        issue_type: packet.issue_type,
        supported_sprinkler_review_lane: packet.supported_sprinkler_review_lane,
        replay_scope: replayInputs.replay_scope || halofireSam31SprinklerReplayScope(packet.supported_sprinkler_review_lane),
        action_label: 'Run SAM31 sprinkler preliminary replay',
        action_href: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/openclaw/sam31/sprinkler-review/${sourceReview.evidence.id}/decision/${sprinklerReviewEvidence.id}/preliminary-replay`,
        preliminary_replay_inputs: replayInputs,
        latest_sam31_sprinkler_preliminary_replay_followup_decision: latestFollowupSummary,
        packet_queue_items: latestFollowupSummary?.packet_queue_items || [],
        next_action: 'Run the preliminary replay artifact, review candidate obstruction/clash/sleeve/firestop/vector/3D rows, and attach official evidence before any regulated claim.',
        acceptable_evidence: [
          'HaloFire employee preliminary replay review',
          'marked-up obstruction/clash or sleeve/firestop screenshot',
          'source-linked vector overlay or 3D candidate review packet',
          'professional/AHJ/manufacturer evidence for any regulated claim',
        ],
        blocked_claims: Array.isArray(packet.blocked_claims) ? [...packet.blocked_claims] : [],
        limitations: [
          'This queue item executes employee-reviewed SAM31+LLM correction evidence only.',
          'It cannot clear AHJ, PE, AutoSprink parity, permit-ready, fabrication-ready, manufacturer-exact, drawing-scale, or geometry-accuracy claims.',
        ],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      };
    })
    .filter(Boolean);
}

function buildOpenClawSam31ToSprinklerReviewAdapter(projectName, evidence, decision, reviewEvidence, review, consumerSmokeEvidence) {
  const decisionPacket = buildOpenClawSam31ConsumerReviewDecisionPacket(
    projectName,
    evidence,
    decision,
    reviewEvidence,
    review,
    consumerSmokeEvidence,
  );
  const supportedSprinklerReviewLanes = uniqueStrings([
    ...SAM31_APPLICATION_CONTRACTS.halo_fire.supported_evidence_lanes,
    'vector_overlay_generation',
    'model_3d_candidate_generation',
  ]);
  const reviewedValues = review.replacement_values && typeof review.replacement_values === 'object'
    ? jsonClone(review.replacement_values)
    : {};
  const issueSeeds = openClawSam31SprinklerIssueSeeds(review);
  const blockedClaims = uniqueStrings([
    ...(Array.isArray(decisionPacket.blocked_claims) ? decisionPacket.blocked_claims : []),
    'permit_ready',
    'professional_approval',
    'AHJ_approval',
    'AutoSprink_parity',
    'fabrication_ready',
    'manufacturer_exact',
  ]);
  return {
    artifact_type: SAM31_TO_SPRINKLER_REVIEW_ADAPTER_TYPE,
    status: 'ready_for_internal_alpha_sprinkler_review',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_consumer_review_evidence_id: reviewEvidence.id,
    source_openclaw_sam31_consumer_smoke_evidence_id: decisionPacket.source_openclaw_sam31_consumer_smoke_evidence_id || null,
    source_application: review.source_application || 'halo_fire',
    consumer: review.consumer,
    accepted_queue_id: review.accepted_queue_id,
    persisted_review_packet_ref: review.persisted_review_packet_ref,
    replacement_ref: review.replacement_ref,
    screenshot_ref: review.screenshot_ref || null,
    console_log_ref: review.console_log_ref || null,
    download_name: `${slugForDownloadName(projectName)}-sam31-to-sprinkler-review-${slugForDownloadName(review.consumer)}-${reviewEvidence.id}.json`,
    supported_sprinkler_review_lanes: supportedSprinklerReviewLanes,
    reviewed_sam31_values: reviewedValues,
    consumer_review_decision_packet: decisionPacket,
    sprinkler_review_packet: {
      artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
      source: SAM31_TO_SPRINKLER_REVIEW_ADAPTER_TYPE,
      status: 'requires_employee_sprinkler_review',
      project_name: projectName,
      source_pdf_boundary_evidence_id: evidence.id,
      source_openclaw_sam31_consumer_review_evidence_id: reviewEvidence.id,
      consumer: review.consumer,
      supported_sprinkler_review_lanes: supportedSprinklerReviewLanes,
      issue_seeds: issueSeeds,
      next_action: 'Use these reviewed SAM31 values to prepare room-boundary, obstruction/clash, sleeve/firestop, vector-overlay, and 3D-candidate review tasks; keep regulated claims blocked.',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    source_refs: decisionPacket.source_refs,
    blocked_claims: blockedClaims,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: uniqueStrings([
      ...(Array.isArray(decisionPacket.limitations) ? decisionPacket.limitations : []),
      'This adapter converts reviewed SAM31 consumer/product-owner values into HaloFire sprinkler review work items only.',
      'It does not clear permit-ready, AHJ-ready, fabrication-ready, engineering-grade, AutoSprink parity, manufacturer-exact, or professionally approved claims.',
    ]),
  };
}

function buildOpenClawSam31ExtrapolationReviewPacket(projectName, evidence, decision, extrapolationEvidence, extrapolationArtifact, reviewEvidence, review) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!extrapolationEvidence?.evidence || !extrapolationArtifact) {
    const e = new Error('OpenClaw SAM31 extrapolation artifact evidence is required before downloading the product review packet');
    e.httpStatus = 409;
    throw e;
  }
  if (!reviewEvidence?.evidence || !review) {
    const e = new Error('OpenClaw SAM31 extrapolation review evidence is required before downloading the product review packet');
    e.httpStatus = 409;
    throw e;
  }
  const perception = extrapolationArtifact.perception_packet && typeof extrapolationArtifact.perception_packet === 'object'
    ? extrapolationArtifact.perception_packet
    : {};
  const originalValues = {
    sections: Array.isArray(extrapolationArtifact.request?.sections)
      ? jsonClone(extrapolationArtifact.request.sections)
      : (Array.isArray(perception.segments) ? jsonClone(perception.segments) : []),
    object_hypotheses: Array.isArray(perception.object_hypotheses)
      ? jsonClone(perception.object_hypotheses)
      : (Array.isArray(extrapolationArtifact.request?.object_hypotheses) ? jsonClone(extrapolationArtifact.request.object_hypotheses) : []),
    vector_overlays: Array.isArray(perception.vector_overlays)
      ? jsonClone(perception.vector_overlays)
      : (Array.isArray(extrapolationArtifact.request?.vector_overlays) ? jsonClone(extrapolationArtifact.request.vector_overlays) : []),
    model_3d_candidates: Array.isArray(perception.model_3d_candidates)
      ? jsonClone(perception.model_3d_candidates)
      : (Array.isArray(extrapolationArtifact.request?.model_3d_candidates) ? jsonClone(extrapolationArtifact.request.model_3d_candidates) : []),
    semantic_labels: Array.isArray(perception.semantic_labels) ? jsonClone(perception.semantic_labels) : [],
    source_ref: extrapolationArtifact.source_ref || evidence.source_ref || decision.sourceRef || null,
    confidence: Number.isFinite(Number(perception.confidence)) ? Number(perception.confidence) : null,
  };
  const sourceRefs = [
    {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_file: evidence.source_file || decision.sourceFile || null,
      source_ref: evidence.source_ref || decision.sourceRef || null,
      status: evidence.status,
    },
    {
      evidence_id: extrapolationEvidence.evidence.id,
      evidence_type: extrapolationEvidence.evidence.evidence_type,
      source_file: extrapolationEvidence.evidence.source_file || null,
      source_ref: extrapolationEvidence.evidence.source_ref || extrapolationArtifact.openclaw_endpoint || null,
      status: extrapolationEvidence.evidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_id: reviewEvidence.evidence.id,
      evidence_type: reviewEvidence.evidence.evidence_type,
      source_file: reviewEvidence.evidence.source_file || null,
      source_ref: reviewEvidence.evidence.source_ref || review.replacement_ref || null,
      status: reviewEvidence.evidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
    ...(Array.isArray(review.source_refs) ? jsonClone(review.source_refs) : []),
  ];
  return {
    artifact_type: 'openclaw.sam31_extrapolation_product_review_packet',
    status: 'ready_for_sprinkler_cad_review',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_extrapolation_evidence_id: extrapolationEvidence.evidence.id,
    source_openclaw_sam31_extrapolation_review_evidence_id: reviewEvidence.evidence.id,
    source_ref: evidence.source_ref || decision.sourceRef || null,
    source_file: evidence.source_file || decision.sourceFile || null,
    download_name: `${slugForDownloadName(projectName)}-sam31-extrapolation-product-review-packet-${evidence.id}.json`,
    downstream_review_lanes: [
      'sprinkler_obstruction_review',
      'cad_vector_overlay_review',
      'model_3d_candidate_review',
      'room_boundary_visual_audit',
      'sleeve_or_firestop_candidate_review',
    ],
    original_values: originalValues,
    reviewed_values: review.replacement_values && typeof review.replacement_values === 'object'
      ? jsonClone(review.replacement_values)
      : {},
    product_review: jsonClone(review),
    openclaw_sam31_product_review_queue_item: extrapolationArtifact.product_review_queue_item && typeof extrapolationArtifact.product_review_queue_item === 'object'
      ? {
        ...jsonClone(extrapolationArtifact.product_review_queue_item),
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }
      : null,
    openclaw_sam31_extrapolation_artifact: jsonClone(extrapolationArtifact),
    source_refs: sourceRefs,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(extrapolationArtifact.blocked_claims) ? extrapolationArtifact.blocked_claims : []),
      ...(Array.isArray(review.blocked_claims) ? review.blocked_claims : []),
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      'professional_approval',
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
    ]),
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: [
      'This packet packages reviewed SAM31+LLM object, vector, and 3D candidate values for HaloFire sprinkler/CAD review only.',
      'It can drive best-effort internal-alpha review and replay workflows, but it does not prove geometry accuracy, drawing scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact models.',
    ],
  };
}

function openClawSam31ExtrapolationReviewPacketMetadata(packet) {
  if (!packet || typeof packet !== 'object') return null;
  const reviewedValues = packet.reviewed_values && typeof packet.reviewed_values === 'object'
    ? packet.reviewed_values
    : {};
  return {
    source: 'openclaw.sam31_extrapolation_product_review_packet',
    source_pdf_boundary_evidence_id: packet.source_pdf_boundary_evidence_id || null,
    source_openclaw_sam31_extrapolation_evidence_id: packet.source_openclaw_sam31_extrapolation_evidence_id || null,
    source_openclaw_sam31_extrapolation_review_evidence_id: packet.source_openclaw_sam31_extrapolation_review_evidence_id || null,
    object_hypothesis_count: Array.isArray(reviewedValues.object_hypotheses) ? reviewedValues.object_hypotheses.length : 0,
    vector_overlay_count: Array.isArray(reviewedValues.vector_overlays) ? reviewedValues.vector_overlays.length : 0,
    model_3d_candidate_count: Array.isArray(reviewedValues.model_3d_candidates) ? reviewedValues.model_3d_candidates.length : 0,
    downstream_review_lanes: Array.isArray(packet.downstream_review_lanes) ? [...packet.downstream_review_lanes] : [],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    blocked_claims: Array.isArray(packet.blocked_claims) ? [...packet.blocked_claims] : [],
  };
}

function sam31EmployeeReplacementReplaySummary(sam31ReplacementEvidence) {
  if (!sam31ReplacementEvidence?.evidence || !sam31ReplacementEvidence?.replacement) return null;
  const { evidence, replacement } = sam31ReplacementEvidence;
  return {
    evidence_id: evidence.id,
    evidence_status: evidence.status,
    source_ref: evidence.source_ref,
    source_sam31_evidence_id: replacement.source_sam31_evidence_id,
    reviewer_name: replacement.reviewer_name,
    replaced_at: replacement.replaced_at,
    replacement_ref: replacement.replacement_ref,
    replacement_values: replacement.replacement_values && typeof replacement.replacement_values === 'object'
      ? jsonClone(replacement.replacement_values)
      : {},
    replaced_fields: Array.isArray(replacement.replaced_fields) ? [...replacement.replaced_fields] : [],
    claim_gate_effect: replacement.claim_gate_effect || 'no_claims_cleared',
  };
}

function applySam31EmployeeReplacementToPolygons(correctedRoomPolygons, sam31ReplacementSummary) {
  const polygons = Array.isArray(correctedRoomPolygons) ? jsonClone(correctedRoomPolygons) : [];
  if (!sam31ReplacementSummary) return polygons;
  const values = sam31ReplacementSummary.replacement_values || {};
  const first = polygons[0] && typeof polygons[0] === 'object' ? { ...polygons[0] } : {};
  if (Object.prototype.hasOwnProperty.call(values, 'semantic_label')) {
    const label = String(values.semantic_label || '').trim();
    if (label) first.room_id = label;
  }
  if (Array.isArray(values.polygon)) first.polygon = jsonClone(values.polygon);
  if (values.bbox && typeof values.bbox === 'object' && !Array.isArray(values.bbox)) first.bbox = jsonClone(values.bbox);
  if (Object.prototype.hasOwnProperty.call(values, 'source_ref')) {
    const sourceRef = String(values.source_ref || '').trim();
    if (sourceRef) first.source_ref = sourceRef;
  }
  if (values.object_hypothesis && typeof values.object_hypothesis === 'object') first.object_hypothesis = jsonClone(values.object_hypothesis);
  if (values.vector_overlay && typeof values.vector_overlay === 'object') first.vector_overlay = jsonClone(values.vector_overlay);
  if (values.model_3d_candidate && typeof values.model_3d_candidate === 'object') first.model_3d_candidate = jsonClone(values.model_3d_candidate);
  if (Object.prototype.hasOwnProperty.call(values, 'confidence')) first.confidence = Number(values.confidence);
  first.sam31_employee_replacement_evidence_id = sam31ReplacementSummary.evidence_id;
  first.sam31_replacement_ref = sam31ReplacementSummary.replacement_ref || null;
  first.sam31_replaced_fields = Array.isArray(sam31ReplacementSummary.replaced_fields) ? [...sam31ReplacementSummary.replaced_fields] : [];
  return [first, ...polygons.slice(1)];
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

function pdfBoundaryResolverQueueItem(projectName, evidence, decision, reviewEvidence = null, sam31Evidence = null, sam31ReplacementEvidence = null, sam31SmokeEvidence = null, sam31ExtrapolationEvidence = null, sam31ExtrapolationReviewEvidence = null, sam31ConsumerSmokeEvidence = null, sam31ConsumerReviewEvidences = [], sam31SprinklerReviewDecisionEvidences = [], sam31SprinklerPreliminaryReplayFollowupDecisionEvidences = []) {
  if (!evidence || !decision) return null;
  const candidate = decision.candidate || {};
  const pdfRef = evidence.source_file || decision.sourceFile || evidence.source_ref || decision.sourceRef || `${projectName}:pdf-boundary:${evidence.id}`;
  const bridgeStatus = openClawSam31BridgeStatus();
  const extrapolateStatus = openClawSam31ExtrapolateStatus();
  const bridgeSmokeHref = `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/smoke-artifact`;
  const extrapolateHref = `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/openclaw/sam31/extrapolation-artifact`;
  const consumerSmokeHref = `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/openclaw/sam31/consumer-smoke`;
  const sam31BridgeSmokeAction = {
    label: 'Run OpenClaw SAM31 bridge smoke artifact',
    method: 'POST',
    href: bridgeSmokeHref,
    status: bridgeStatus.status || 'unavailable',
    tool_ref: 'pdfExtract:sam',
    source_evidence_id: evidence.id,
    source_evidence_type: 'pdf_boundary_decision',
    request_body: {
      source_pdf_boundary_evidence_id: evidence.id,
      pdfRef,
      pdfPageIndex: decision.pageIndex,
      pdfScale: decision.scale,
      targets: ['building_outline', 'walls', 'rooms', 'layers', 'sprinkler_obstructions'],
    },
    blocked_claims: uniqueStrings([
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
    ]),
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'This action records operational bridge invocation evidence only; it does not clear geometry or regulated claims.',
    ],
  };
  const openclawSam31ExtrapolationAction = {
    label: 'Run OpenClaw SAM31 extrapolation artifact',
    method: 'POST',
    href: extrapolateHref,
    status: extrapolateStatus.status || 'unavailable',
    source_evidence_id: evidence.id,
    source_evidence_type: 'pdf_boundary_decision',
    endpoint: extrapolateStatus.endpoint,
    request_source: 'sam31_room_boundary_visual_audit_packet.openclaw_sam31_perception_request',
    blocked_claims: uniqueStrings([
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
    ]),
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'This action records OpenClaw SAM31+LLM extrapolation evidence only; it does not clear geometry or regulated claims.',
    ],
  };
  const openclawSam31ConsumerSmokeAction = {
    label: 'Run LandScout/NameForge SAM31 queue smoke',
    method: 'POST',
    href: consumerSmokeHref,
    status: sam31ExtrapolationEvidence ? 'ready' : 'requires_sam31_extrapolation_artifact',
    source_evidence_id: evidence.id,
    source_evidence_type: 'pdf_boundary_decision',
    source_openclaw_sam31_extrapolation_evidence_id: sam31ExtrapolationEvidence?.evidence?.id || null,
    consumes: SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE,
    produces: SAM31_CONSUMER_SMOKE_ARTIFACT_TYPE,
    consumer_targets: [...SAM31_CONSUMER_QUEUE_TARGETS],
    unavailable_evidence_rows: [
      SAM31_CONSUMER_UNAVAILABLE_CODES.landscout,
      SAM31_CONSUMER_UNAVAILABLE_CODES.nameforge,
    ],
    blocked_claims: uniqueStrings([
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
      'professional_approval',
    ]),
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'This action records queue-handoff smoke evidence only; product-specific reviewers still have to accept or replace SAM31 values.',
      'Unavailable consumer queues become missing-evidence rows instead of blocking HaloFire local review.',
    ],
  };
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
  const latestSam31EmployeeReplacement = sam31ReplacementEvidence && sam31ReplacementEvidence.replacement ? {
    evidence_id: sam31ReplacementEvidence.evidence.id,
    evidence_status: sam31ReplacementEvidence.evidence.status,
    source_ref: sam31ReplacementEvidence.evidence.source_ref,
    source_sam31_evidence_id: sam31ReplacementEvidence.replacement.source_sam31_evidence_id,
    reviewer_name: sam31ReplacementEvidence.replacement.reviewer_name,
    replaced_at: sam31ReplacementEvidence.replacement.replaced_at,
    replacement_ref: sam31ReplacementEvidence.replacement.replacement_ref,
    replacement_values: sam31ReplacementEvidence.replacement.replacement_values && typeof sam31ReplacementEvidence.replacement.replacement_values === 'object'
      ? jsonClone(sam31ReplacementEvidence.replacement.replacement_values)
      : {},
    replaced_fields: Array.isArray(sam31ReplacementEvidence.replacement.replaced_fields) ? sam31ReplacementEvidence.replacement.replaced_fields : [],
    claim_gate_effect: sam31ReplacementEvidence.replacement.claim_gate_effect || 'no_claims_cleared',
  } : null;
  const latestSam31BridgeSmokeArtifact = sam31SmokeEvidence && sam31SmokeEvidence.artifact ? {
    evidence_id: sam31SmokeEvidence.evidence.id,
    evidence_status: sam31SmokeEvidence.evidence.status,
    source_ref: sam31SmokeEvidence.evidence.source_ref,
    status: sam31SmokeEvidence.artifact.status || 'sam31_invocation_verified',
    source_pdf_boundary_evidence_id: sam31SmokeEvidence.artifact.source_pdf_boundary_evidence_id || null,
    generated_at: sam31SmokeEvidence.artifact.generated_at || null,
    bridge_status: sam31SmokeEvidence.artifact.bridge_status || null,
    invocation: sam31SmokeEvidence.artifact.invocation || null,
    result_summary: sam31SmokeEvidence.artifact.result_summary || null,
    status_refs: Array.isArray(sam31SmokeEvidence.artifact.status_refs) ? sam31SmokeEvidence.artifact.status_refs : [],
    claim_gate_effect: sam31SmokeEvidence.artifact.claim_gate_effect || 'no_claims_cleared',
    blocked_claims: Array.isArray(sam31SmokeEvidence.artifact.blocked_claims) ? sam31SmokeEvidence.artifact.blocked_claims : [],
  } : null;
  const latestOpenClawSam31ExtrapolationArtifact = openClawSam31ExtrapolationReplaySummary(sam31ExtrapolationEvidence);
  const latestOpenClawSam31ExtrapolationReview = openClawSam31ExtrapolationReviewSummary(sam31ExtrapolationReviewEvidence);
  const latestOpenClawSam31ConsumerSmokeArtifact = openClawSam31ConsumerSmokeReplaySummary(sam31ConsumerSmokeEvidence);
  const latestOpenClawSam31ConsumerReviews = openClawSam31ConsumerReviewSummaries(sam31ConsumerReviewEvidences);
  const sam31UnresolvedConsumerReviews = openClawSam31UnresolvedConsumerReviewSummaries(
    latestOpenClawSam31ConsumerSmokeArtifact,
    latestOpenClawSam31ConsumerReviews,
  );
  const sam31SprinklerReviewQueueItems = openClawSam31SprinklerReviewQueueItems(projectName, evidence, decision, sam31ConsumerReviewEvidences, sam31SprinklerReviewDecisionEvidences);
  const sam31SprinklerPreliminaryReplayQueueItems = halofireSam31SprinklerPreliminaryReplayQueueItems(projectName, evidence, decision, sam31ConsumerReviewEvidences, sam31SprinklerReviewDecisionEvidences, sam31SprinklerPreliminaryReplayFollowupDecisionEvidences);
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
  } else if (latestSam31EmployeeReplacement) {
    status = 'sam31_replacements_recorded';
    nextAction = 'Use the employee replacement payload for the temporary SAM 3.1 fields in internal-alpha replay; regulated claims remain blocked.';
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
    latest_sam31_employee_replacement: latestSam31EmployeeReplacement,
    latest_openclaw_sam31_bridge_smoke_artifact: latestSam31BridgeSmokeArtifact,
    latest_openclaw_sam31_extrapolation_artifact: latestOpenClawSam31ExtrapolationArtifact,
    latest_openclaw_sam31_extrapolation_review: latestOpenClawSam31ExtrapolationReview,
    latest_openclaw_sam31_consumer_smoke_artifact: latestOpenClawSam31ConsumerSmokeArtifact,
    latest_openclaw_sam31_consumer_reviews: latestOpenClawSam31ConsumerReviews,
    sam31_unresolved_consumer_reviews: sam31UnresolvedConsumerReviews,
    sam31_sprinkler_review_queue_items: sam31SprinklerReviewQueueItems,
    sam31_sprinkler_preliminary_replay_queue_items: sam31SprinklerPreliminaryReplayQueueItems,
    openclaw_sam31_bridge_status: bridgeStatus,
    sam31_bridge_smoke_action: sam31BridgeSmokeAction,
    openclaw_sam31_extrapolation_status: extrapolateStatus,
    openclaw_sam31_extrapolation_action: openclawSam31ExtrapolationAction,
    openclaw_sam31_consumer_smoke_action: openclawSam31ConsumerSmokeAction,
    limitations: [
      decision.limitation || 'Saved boundary choice is best-effort evidence only.',
      'This queue item does not prove geometry accuracy, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact models.',
    ],
    actions: [
      { label: 'Load defaults in Studio', href: `/autosprink.html?project=${encodeURIComponent(projectName)}&resolver=${encodeURIComponent(`pdf-boundary:${evidence.id}`)}` },
      { label: 'Download SAM 3.1 visual audit packet', href: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/sam31-visual-audit` },
      { label: 'Run OpenClaw SAM31 extrapolation artifact', href: extrapolateHref, method: 'POST' },
      { label: 'Run LandScout/NameForge SAM31 queue smoke', href: consumerSmokeHref, method: 'POST', artifact_type: SAM31_CONSUMER_SMOKE_ARTIFACT_TYPE },
      ...(latestOpenClawSam31ExtrapolationReview ? [{
        label: 'Download SAM31 product review packet',
        href: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/openclaw/sam31/extrapolation-review-packet`,
        artifact_type: 'openclaw.sam31_extrapolation_product_review_packet',
      }] : []),
      { label: 'Run OpenClaw SAM31 bridge smoke artifact', href: bridgeSmokeHref, method: 'POST' },
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
  const latestSmokeSummary = sam31BridgeSmokeReplaySummary(latestSam31BridgeSmokeArtifactEvidence(projectName, evidence.id));
  const smokeStatusRefs = latestSmokeSummary?.status_refs?.length
    ? latestSmokeSummary.status_refs
    : [
      `http://${bridgeHost}:${Number.isSafeInteger(bridgePort) ? bridgePort : 15000}/status`,
      `http://${bridgeHost}:${Number.isSafeInteger(bridgePort) ? bridgePort : 15000}/codex-bridge/invoke`,
    ];
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
      openclaw_sam31_bridge_status: openClawSam31BridgeStatus(),
      local_bridge_host: bridgeHost,
      local_bridge_port: Number.isSafeInteger(bridgePort) ? bridgePort : 15000,
      local_bridge_status_url: `http://${bridgeHost}:${Number.isSafeInteger(bridgePort) ? bridgePort : 15000}/status`,
      local_bridge_invoke_url: `http://${bridgeHost}:${Number.isSafeInteger(bridgePort) ? bridgePort : 15000}/codex-bridge/invoke`,
      local_bridge_command: 'npm run sam31:bridge',
    },
    input_defaults: queueItem.input_defaults,
    employee_capture_defaults: {
      source_openclaw_sam31_bridge_smoke_evidence_id: latestSmokeSummary?.evidence_id || null,
      sam31_result_ref: latestSmokeSummary ? `openclaw-sam31-smoke-artifact:${latestSmokeSummary.evidence_id}` : null,
      console_log_ref: latestSmokeSummary ? smokeStatusRefs.join(' | ') : null,
      openclaw_sam31_bridge_smoke_artifact: latestSmokeSummary,
      claim_gate_effect: 'no_claims_cleared',
    },
    latest_openclaw_sam31_bridge_smoke_artifact: latestSmokeSummary,
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
      ...(latestSmokeSummary
        ? [{
          evidence_id: latestSmokeSummary.evidence_id,
          evidence_type: 'openclaw_sam31_bridge_smoke_artifact',
          source_ref: latestSmokeSummary.source_ref,
          status: latestSmokeSummary.evidence_status,
          claim_gate_effect: latestSmokeSummary.claim_gate_effect || 'no_claims_cleared',
        }]
        : []),
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

function openClawSam31ExtrapolateRequestFromVisualAudit(packet) {
  const request = packet?.openclaw_sam31_perception_request;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    const e = new Error('SAM31 visual audit packet is missing openclaw_sam31_perception_request');
    e.httpStatus = 400;
    throw e;
  }
  return {
    project_ref: request.project_ref || `halo_fire:${packet.project_name || 'unknown'}`,
    application: request.application || 'halo_fire',
    source_ref: request.source_ref || packet.source_ref || null,
    image_ref: request.image_ref || packet.source_file || null,
    llm_model: request.llm_model || 'openclaw-local-llm-best-effort',
    prompt: request.prompt || 'Use SAM 3.1 plus LLM perception to identify objects, vector overlays, and best-effort 3D model candidates.',
    sections: Array.isArray(request.segments) ? jsonClone(request.segments) : [],
    object_hypotheses: Array.isArray(request.object_hypotheses) ? jsonClone(request.object_hypotheses) : [],
    vector_overlays: Array.isArray(request.vector_overlays) ? jsonClone(request.vector_overlays) : [],
    model_3d_candidates: Array.isArray(request.model_3d_candidates) ? jsonClone(request.model_3d_candidates) : [],
  };
}

function normalizeOpenClawSam31ExtrapolationArtifact(projectName, evidence, decision, visualPacket, request, responseBody, endpointConfig) {
  const endpoint = endpointConfig?.endpoint || null;
  const rawArtifact = responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)
    ? jsonClone(responseBody)
    : {};
  const rawPacket = rawArtifact.perception_packet || rawArtifact.openclaw_sam31_perception_packet || rawArtifact.sam31_perception_packet || null;
  const perceptionPacket = rawPacket
    ? normalizeOpenClawSam31PerceptionPacket({ openclaw_sam31_perception_packet: rawPacket })
    : normalizeOpenClawSam31PerceptionPacket({
      openclaw_sam31_perception_packet: {
        project_ref: request.project_ref,
        application: request.application,
        source_ref: request.source_ref,
        image_ref: request.image_ref,
        segments: request.sections,
        object_hypotheses: request.object_hypotheses,
        vector_overlays: request.vector_overlays,
        model_3d_candidates: request.model_3d_candidates,
      },
    });
  const productReviewAction = rawArtifact.product_review_action && typeof rawArtifact.product_review_action === 'object' && !Array.isArray(rawArtifact.product_review_action)
    ? {
      ...jsonClone(rawArtifact.product_review_action),
      claim_gate_effect: 'no_claims_cleared',
    }
    : {
      application: perceptionPacket.application || 'halo_fire',
      contract_ref: perceptionPacket.application_adapter?.contract_ref || SAM31_APPLICATION_CONTRACTS.halo_fire.contract_ref,
      status: 'ready_for_product_review_queue',
      next_action: perceptionPacket.application_adapter?.next_action || SAM31_APPLICATION_NEXT_ACTIONS.halo_fire,
      claim_gate_effect: 'no_claims_cleared',
    };
  const blockedClaims = uniqueStrings([
    ...(Array.isArray(rawArtifact.blocked_claims) ? rawArtifact.blocked_claims : []),
    ...(Array.isArray(perceptionPacket.blocked_claims) ? perceptionPacket.blocked_claims : []),
    ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
    'SAM31_runtime_verified',
    'OpenClaw_runtime_verified',
  ]);
  const fallbackQueueItem = buildOpenClawSam31ProductReviewQueueItem({
    application: request.application || perceptionPacket.application || 'halo_fire',
    projectRef: request.project_ref || perceptionPacket.project_ref || `halo_fire:${projectName}`,
    request,
    perceptionPacket,
    productReviewAction,
    blockedClaims,
  });
  const productReviewQueueItem = normalizeOpenClawSam31ProductReviewQueueItem(
    rawArtifact.product_review_queue_item,
    fallbackQueueItem,
  );
  const extrapolationIndex = Array.isArray(rawArtifact.extrapolation_index)
    ? jsonClone(rawArtifact.extrapolation_index).map((item) => ({
      ...item,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }))
    : jsonClone(productReviewQueueItem.extrapolation_index || []);
  return {
    artifact_type: 'openclaw.sam31_llm_extrapolation_artifact',
    status: rawArtifact.status || 'best_effort_extrapolation_ready',
    project_name: projectName,
    project_ref: request.project_ref,
    application: request.application,
    generated_at: new Date().toISOString(),
    source_pdf_boundary_evidence_id: evidence.id,
    source_evidence_type: evidence.evidence_type,
    source_ref: evidence.source_ref || decision.sourceRef || request.source_ref || null,
    source_file: evidence.source_file || decision.sourceFile || request.image_ref || null,
    source_runtime: rawArtifact.source_runtime || 'sam-3.1+llm',
    openclaw_endpoint: endpoint,
    openclaw_endpoint_source_file: endpointConfig?.source_file || null,
    bid_truth: rawArtifact.bid_truth && typeof rawArtifact.bid_truth === 'object' && !Array.isArray(rawArtifact.bid_truth)
      ? jsonClone(rawArtifact.bid_truth)
      : null,
    request,
    tool: rawArtifact.tool && typeof rawArtifact.tool === 'object'
      ? { ...jsonClone(rawArtifact.tool), claim_gate_effect: 'no_claims_cleared' }
      : {
        artifact_type: 'openclaw.sam31_llm_extrapolation_tool',
        action: { method: 'POST', href: '/vision/sam31/extrapolate', contract_ref: SAM31_EXTRAPOLATION_CONTRACT_REF },
        claim_gate_effect: 'no_claims_cleared',
      },
    perception_packet: perceptionPacket,
    section_count: Number.isFinite(Number(rawArtifact.section_count)) ? Number(rawArtifact.section_count) : request.sections.length,
    object_hypothesis_count: Number.isFinite(Number(rawArtifact.object_hypothesis_count)) ? Number(rawArtifact.object_hypothesis_count) : request.object_hypotheses.length,
    source_refs: [
      {
        evidence_id: evidence.id,
        evidence_type: evidence.evidence_type,
        source_file: evidence.source_file || decision.sourceFile || null,
        source_ref: evidence.source_ref || decision.sourceRef || null,
        status: evidence.status,
      },
      ...(Array.isArray(rawArtifact.source_refs) ? jsonClone(rawArtifact.source_refs) : []),
      {
        evidence_type: 'openclaw.sam31_llm_extrapolation_artifact',
        source_ref: endpoint,
        status: rawArtifact.status || 'best_effort_extrapolation_ready',
        claim_gate_effect: 'no_claims_cleared',
      },
    ],
    product_review_action: productReviewAction,
    product_review_queue_item: productReviewQueueItem,
    extrapolation_index: extrapolationIndex,
    missing_evidence_rows: Array.isArray(rawArtifact.missing_evidence_rows)
      ? jsonClone(rawArtifact.missing_evidence_rows)
      : (Array.isArray(productReviewQueueItem.missing_evidence_rows)
        ? jsonClone(productReviewQueueItem.missing_evidence_rows)
        : []),
    visual_audit_packet_ref: visualPacket.download_name || null,
    acceptable_evidence: [
      'OpenClaw /vision/sam31/extrapolate response captured in perception_packet',
      'Product review action with active HaloFire application contract',
      'Employee replacement evidence for temporary SAM31 values before replay',
      'Licensed professional/AHJ/AutoSprink/manufacturer evidence before regulated claims',
    ],
    blocked_claims: blockedClaims,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: [
      ...(Array.isArray(rawArtifact.limitations) ? rawArtifact.limitations : []),
      'OpenClaw SAM31+LLM extrapolation is internal-alpha correction evidence only.',
      'It does not prove geometry accuracy, drawing scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact models.',
    ],
  };
}

async function invokeOpenClawSam31Extrapolation(projectName, evidence, decision, fetchImpl = globalThis.fetch) {
  const endpointConfig = openClawSam31ExtrapolateEndpointConfig();
  const endpoint = endpointConfig.endpoint;
  if (!endpoint) {
    const e = new Error('OpenClaw SAM31 extrapolate endpoint is not configured');
    e.httpStatus = 503;
    throw e;
  }
  const visualPacket = pdfBoundarySam31VisualAuditPacket(projectName, evidence, decision);
  const request = openClawSam31ExtrapolateRequestFromVisualAudit(visualPacket);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.HALOFIRE_SAM31_EXTRAPOLATE_TIMEOUT_MS || 20000));
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const e = new Error(`OpenClaw SAM31 extrapolate returned ${response.status}: ${text || response.statusText}`);
    e.httpStatus = 502;
    throw e;
  }
  const body = await response.json();
  return normalizeOpenClawSam31ExtrapolationArtifact(projectName, evidence, decision, visualPacket, request, body, endpointConfig);
}

function normalizeOpenClawSam31ExtrapolationReview(projectName, evidence, decision, extrapolationEvidence, extrapolationArtifact, body = {}, user = {}) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!extrapolationEvidence || !extrapolationArtifact) {
    const e = new Error('OpenClaw SAM31 extrapolation artifact evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (Number(extrapolationArtifact.source_pdf_boundary_evidence_id) !== Number(evidence.id)) {
    const e = new Error('source_openclaw_sam31_extrapolation_evidence_id does not belong to the requested PDF boundary evidence');
    e.httpStatus = 409;
    throw e;
  }
  const reviewDecision = String(body.review_decision || 'replaced').trim();
  if (!['accepted', 'replaced', 'rejected'].includes(reviewDecision)) {
    const e = new Error('review_decision must be one of: accepted, replaced, rejected');
    e.httpStatus = 400;
    throw e;
  }
  const replacementRef = String(body.replacement_ref || body.source_ref || '').trim();
  if (!replacementRef) {
    const e = new Error('replacement_ref is required for OpenClaw SAM31 extrapolation review evidence');
    e.httpStatus = 400;
    throw e;
  }
  const rawValues = body.replacement_values;
  if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) {
    const e = new Error('replacement_values must be an object');
    e.httpStatus = 400;
    throw e;
  }
  const unknownFields = Object.keys(rawValues).filter((field) => !SAM31_EXTRAPOLATION_REVIEW_FIELDS.includes(field));
  if (unknownFields.length) {
    const e = new Error(`Unsupported OpenClaw SAM31 extrapolation review fields: ${unknownFields.join(', ')}`);
    e.httpStatus = 400;
    throw e;
  }
  const replacementValues = {};
  for (const field of SAM31_EXTRAPOLATION_REVIEW_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rawValues, field)) {
      replacementValues[field] = jsonClone(rawValues[field]);
    }
  }
  for (const field of ['sections', 'object_hypotheses', 'vector_overlays', 'model_3d_candidates', 'semantic_labels']) {
    if (Object.prototype.hasOwnProperty.call(replacementValues, field) && !Array.isArray(replacementValues[field])) {
      const e = new Error(`replacement_values.${field} must be an array`);
      e.httpStatus = 400;
      throw e;
    }
  }
  if (Object.prototype.hasOwnProperty.call(replacementValues, 'confidence')) {
    const confidence = Number(replacementValues.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      const e = new Error('replacement_values.confidence must be a number between 0 and 1');
      e.httpStatus = 400;
      throw e;
    }
    replacementValues.confidence = confidence;
  }
  const replacedFields = Object.keys(replacementValues);
  if (!replacedFields.length) {
    const e = new Error('replacement_values must include at least one supported OpenClaw SAM31 extrapolation review field');
    e.httpStatus = 400;
    throw e;
  }
  const sourceRefs = [
    {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_file: evidence.source_file || decision.sourceFile || null,
      source_ref: evidence.source_ref || decision.sourceRef || null,
      status: evidence.status,
    },
    {
      evidence_id: extrapolationEvidence.id,
      evidence_type: extrapolationEvidence.evidence_type,
      source_ref: extrapolationEvidence.source_ref || extrapolationArtifact.openclaw_endpoint || null,
      status: extrapolationEvidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_type: 'employee_sam31_extrapolation_review_payload',
      source_ref: replacementRef,
      status: 'present',
      claim_gate_effect: 'no_claims_cleared',
    },
  ];
  return {
    artifact_type: 'openclaw.sam31_extrapolation_product_review',
    status: 'present',
    project_name: projectName,
    source_pdf_boundary_evidence_id: evidence.id,
    source_evidence_type: evidence.evidence_type,
    source_openclaw_sam31_extrapolation_evidence_id: extrapolationEvidence.id,
    source_openclaw_sam31_extrapolation_ref: extrapolationEvidence.source_ref || extrapolationArtifact.openclaw_endpoint || null,
    source_ref: evidence.source_ref || decision.sourceRef || null,
    source_file: evidence.source_file || decision.sourceFile || null,
    source_runtime: extrapolationArtifact.source_runtime || 'sam-3.1+llm',
    review_decision: reviewDecision,
    reviewer_name: String(body.reviewer_name || user.name || user.username || '').trim() || null,
    reviewed_at: new Date().toISOString(),
    replacement_ref: replacementRef,
    replacement_values: replacementValues,
    replaced_fields: replacedFields,
    product_review_action: extrapolationArtifact.product_review_action && typeof extrapolationArtifact.product_review_action === 'object'
      ? jsonClone(extrapolationArtifact.product_review_action)
      : null,
    notes: String(body.notes || '').trim() || null,
    source_refs: sourceRefs,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(extrapolationArtifact.blocked_claims) ? extrapolationArtifact.blocked_claims : []),
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
      ...PDF_BOUNDARY_BLOCKED_CLAIMS,
    ]),
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'Employee SAM31 extrapolation reviews replace or accept temporary object, vector, and 3D candidate values for internal-alpha product review only.',
      'They do not prove geometry accuracy, drawing scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact models.',
    ],
  };
}

function normalizeOpenClawSam31ConsumerReview(projectName, evidence, decision, consumerSmokeEvidence, consumerSmokeArtifact, body = {}, user = {}) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!consumerSmokeEvidence || !consumerSmokeArtifact) {
    const e = new Error('OpenClaw SAM31 consumer smoke artifact evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (Number(consumerSmokeArtifact.source_pdf_boundary_evidence_id) !== Number(evidence.id)) {
    const e = new Error('source_openclaw_sam31_consumer_smoke_evidence_id does not belong to the requested PDF boundary evidence');
    e.httpStatus = 409;
    throw e;
  }
  const consumer = String(body.consumer || '').trim().toLowerCase();
  if (!SAM31_CONSUMER_QUEUE_TARGETS.includes(consumer)) {
    const e = new Error(`consumer must be one of: ${SAM31_CONSUMER_QUEUE_TARGETS.join(', ')}`);
    e.httpStatus = 400;
    throw e;
  }
  const sourceApplication = String(body.source_application || 'halo_fire').trim().toLowerCase();
  if (!SAM31_SUPPORTED_APPLICATIONS.includes(sourceApplication)) {
    const e = new Error(`source_application must be one of: ${SAM31_SUPPORTED_APPLICATIONS.join(', ')}`);
    e.httpStatus = 400;
    throw e;
  }
  const acceptedQueueId = String(body.accepted_queue_id || '').trim();
  if (!acceptedQueueId) {
    const e = new Error('accepted_queue_id is required for SAM31 consumer review evidence');
    e.httpStatus = 400;
    throw e;
  }
  const persistedReviewPacketRef = String(body.persisted_review_packet_ref || '').trim();
  if (!persistedReviewPacketRef) {
    const e = new Error('persisted_review_packet_ref is required for SAM31 consumer review evidence');
    e.httpStatus = 400;
    throw e;
  }
  const task = (Array.isArray(consumerSmokeArtifact.consumer_review_tasks) ? consumerSmokeArtifact.consumer_review_tasks : [])
    .find((item) => item.consumer === consumer
      && item.accepted_queue_id === acceptedQueueId
      && item.persisted_review_packet_ref === persistedReviewPacketRef);
  if (!task) {
    const e = new Error('accepted_queue_id and persisted_review_packet_ref must match a saved SAM31 consumer review task');
    e.httpStatus = 409;
    throw e;
  }
  const reviewDecision = String(body.review_decision || 'replaced').trim().toLowerCase();
  if (!['accepted', 'replaced', 'rejected'].includes(reviewDecision)) {
    const e = new Error('review_decision must be one of: accepted, replaced, rejected');
    e.httpStatus = 400;
    throw e;
  }
  const replacementRef = String(body.replacement_ref || body.source_ref || '').trim();
  if (!replacementRef) {
    const e = new Error('replacement_ref is required for SAM31 consumer review evidence');
    e.httpStatus = 400;
    throw e;
  }
  const screenshotRef = String(body.screenshot_ref || '').trim();
  const consoleLogRef = String(body.console_log_ref || '').trim();
  if (!screenshotRef && !consoleLogRef) {
    const e = new Error('screenshot_ref or console_log_ref is required for SAM31 consumer review evidence');
    e.httpStatus = 400;
    throw e;
  }
  const rawValues = body.replacement_values;
  if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) {
    const e = new Error('replacement_values must be an object');
    e.httpStatus = 400;
    throw e;
  }
  const unknownFields = Object.keys(rawValues).filter((field) => !SAM31_CONSUMER_REVIEW_FIELDS.includes(field));
  if (unknownFields.length) {
    const e = new Error(`Unsupported SAM31 consumer review fields: ${unknownFields.join(', ')}`);
    e.httpStatus = 400;
    throw e;
  }
  const replacementValues = {};
  for (const field of SAM31_CONSUMER_REVIEW_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rawValues, field)) {
      replacementValues[field] = jsonClone(rawValues[field]);
    }
  }
  for (const field of ['semantic_labels', 'object_hypotheses', 'vector_overlays', 'model_3d_candidates']) {
    if (Object.prototype.hasOwnProperty.call(replacementValues, field) && !Array.isArray(replacementValues[field])) {
      const e = new Error(`replacement_values.${field} must be an array`);
      e.httpStatus = 400;
      throw e;
    }
  }
  if (Object.prototype.hasOwnProperty.call(replacementValues, 'confidence')) {
    const confidence = Number(replacementValues.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      const e = new Error('replacement_values.confidence must be a number between 0 and 1');
      e.httpStatus = 400;
      throw e;
    }
    replacementValues.confidence = confidence;
  }
  const replacedFields = Object.keys(replacementValues);
  if (!replacedFields.length) {
    const e = new Error('replacement_values must include at least one supported SAM31 consumer review field');
    e.httpStatus = 400;
    throw e;
  }
  const sourceRefs = [
    {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_file: evidence.source_file || decision.sourceFile || null,
      source_ref: evidence.source_ref || decision.sourceRef || null,
      status: evidence.status,
    },
    {
      evidence_id: consumerSmokeEvidence.id,
      evidence_type: consumerSmokeEvidence.evidence_type,
      source_ref: consumerSmokeEvidence.source_ref || consumerSmokeArtifact.canonical_tool_descriptor_url || null,
      status: consumerSmokeEvidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_type: SAM31_CONSUMER_REVIEW_TASK_TYPE,
      source_ref: persistedReviewPacketRef,
      status: task.status || 'requires_product_review',
      accepted_queue_id: acceptedQueueId,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_type: 'employee_sam31_consumer_review_payload',
      source_ref: replacementRef,
      status: 'present',
      claim_gate_effect: 'no_claims_cleared',
    },
  ];
  if (screenshotRef) {
    sourceRefs.push({
      evidence_type: 'consumer_review_screenshot',
      source_ref: screenshotRef,
      status: 'present',
      claim_gate_effect: 'no_claims_cleared',
    });
  }
  if (consoleLogRef) {
    sourceRefs.push({
      evidence_type: 'consumer_review_console_log',
      source_ref: consoleLogRef,
      status: 'present',
      claim_gate_effect: 'no_claims_cleared',
    });
  }
  return {
    artifact_type: SAM31_CONSUMER_REVIEW_DECISION_TYPE,
    status: 'present',
    project_name: projectName,
    source_application: sourceApplication,
    source_pdf_boundary_evidence_id: evidence.id,
    source_evidence_type: evidence.evidence_type,
    source_openclaw_sam31_consumer_smoke_evidence_id: consumerSmokeEvidence.id,
    source_ref: evidence.source_ref || decision.sourceRef || null,
    source_file: evidence.source_file || decision.sourceFile || null,
    source_runtime: consumerSmokeArtifact.source_runtime || 'sam-3.1+llm',
    consumer,
    accepted_queue_id: acceptedQueueId,
    persisted_review_packet_ref: persistedReviewPacketRef,
    consumer_review_task: jsonClone(task),
    review_decision: reviewDecision,
    reviewer_name: String(body.reviewer_name || user.name || user.username || '').trim() || null,
    reviewed_at: new Date().toISOString(),
    replacement_ref: replacementRef,
    screenshot_ref: screenshotRef || null,
    console_log_ref: consoleLogRef || null,
    replacement_values: replacementValues,
    replaced_fields: replacedFields,
    acceptable_evidence: Array.isArray(task.acceptable_evidence) ? [...task.acceptable_evidence] : [
      'product owner review note tied to accepted queue id',
      'employee accepted or replaced SAM31 semantic label/object/vector/3D candidate',
      'source screenshot or console evidence for reviewed sectioning',
    ],
    notes: String(body.notes || '').trim() || null,
    source_refs: sourceRefs,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(task.blocked_claims) ? task.blocked_claims : []),
      ...(Array.isArray(consumerSmokeArtifact.blocked_claims) ? consumerSmokeArtifact.blocked_claims : []),
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      'professional_approval',
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
    ]),
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: [
      'This review records a product-owner or employee decision against a SAM31 consumer review task for internal-alpha use only.',
      'It can accept or replace temporary SAM31 semantic labels, object hypotheses, vector overlays, and 3D candidates, but it does not clear regulated or product-readiness claims.',
    ],
  };
}

function openClawSam31ProductOwnerReplacementIntakeContract(projectName) {
  return {
    artifact_type: SAM31_PRODUCT_OWNER_REPLACEMENT_INTAKE_TYPE,
    method: 'POST',
    href: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/product-owner-replacements`,
    consumes: SAM31_CONSUMER_REVIEW_TASK_TYPE,
    produces: SAM31_CONSUMER_REVIEW_DECISION_TYPE,
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    required_fields: [
      'source_pdf_boundary_evidence_id',
      'source_openclaw_sam31_consumer_smoke_evidence_id',
      'source_application',
      'consumer',
      'accepted_queue_id',
      'persisted_review_packet_ref',
      'review_decision',
      'replacement_ref',
      'screenshot_ref_or_console_log_ref',
      'replacement_values',
    ],
    replacement_value_fields: [...SAM31_CONSUMER_REVIEW_FIELDS],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
  };
}

function buildOpenClawSam31ProductOwnerReplacementIntake(projectName, reviewPacket, evidenceRow) {
  const contract = openClawSam31ProductOwnerReplacementIntakeContract(projectName);
  return {
    artifact_type: SAM31_PRODUCT_OWNER_REPLACEMENT_INTAKE_TYPE,
    status: 'accepted_for_internal_alpha_review',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    source_application: reviewPacket.source_application || 'halo_fire',
    consumer: reviewPacket.consumer,
    source_pdf_boundary_evidence_id: reviewPacket.source_pdf_boundary_evidence_id,
    source_openclaw_sam31_consumer_smoke_evidence_id: reviewPacket.source_openclaw_sam31_consumer_smoke_evidence_id,
    source_openclaw_sam31_consumer_review_evidence_id: evidenceRow?.id || null,
    accepted_queue_id: reviewPacket.accepted_queue_id,
    persisted_review_packet_ref: reviewPacket.persisted_review_packet_ref,
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    intake_contract: contract,
    product_owner_replacement: jsonClone(reviewPacket),
    evidence: evidenceRow || null,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(reviewPacket.blocked_claims) ? reviewPacket.blocked_claims : []),
      'professional_approval',
      'AHJ_approval',
      'AutoSprink_parity',
      'fabrication_ready',
      'manufacturer_exact',
    ]),
    limitations: uniqueStrings([
      'This shared OpenClaw SAM31 intake adapter records product-owner replacement evidence for HaloFire, LandScout, and NameForge only.',
      'It does not clear product acceptance, production readiness, AHJ approval, PE review, AutoSprink parity, fabrication readiness, or manufacturer-exact model claims.',
      ...(Array.isArray(reviewPacket.limitations) ? reviewPacket.limitations : []),
    ]),
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
  const sourceSmokeEvidenceId = Number(body.source_openclaw_sam31_bridge_smoke_evidence_id);
  let sourceSmokeSummary = null;
  if (Number.isSafeInteger(sourceSmokeEvidenceId) && sourceSmokeEvidenceId > 0) {
    const sourceSmokeEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_bridge_smoke_artifact'`)
      .get(sourceSmokeEvidenceId, projectName);
    const sourceSmokeArtifact = sam31BridgeSmokeArtifactFromEvidence(sourceSmokeEvidence);
    if (!sourceSmokeEvidence || !sourceSmokeArtifact) {
      const e = new Error('source_openclaw_sam31_bridge_smoke_evidence_id must reference a saved OpenClaw SAM31 bridge smoke artifact');
      e.httpStatus = 404;
      throw e;
    }
    if (Number(sourceSmokeArtifact.source_pdf_boundary_evidence_id) !== Number(evidence.id)) {
      const e = new Error('source_openclaw_sam31_bridge_smoke_evidence_id does not belong to the requested PDF boundary evidence');
      e.httpStatus = 409;
      throw e;
    }
    sourceSmokeSummary = sam31BridgeSmokeReplaySummary({ evidence: sourceSmokeEvidence, artifact: sourceSmokeArtifact });
  }
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
  if (sourceSmokeSummary) {
    sourceRefs.push({
      evidence_id: sourceSmokeSummary.evidence_id,
      evidence_type: 'openclaw_sam31_bridge_smoke_artifact',
      source_ref: sourceSmokeSummary.source_ref,
      status: sourceSmokeSummary.evidence_status,
      claim_gate_effect: sourceSmokeSummary.claim_gate_effect || 'no_claims_cleared',
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
    source_openclaw_sam31_bridge_smoke_evidence_id: sourceSmokeSummary?.evidence_id || null,
    openclaw_sam31_bridge_smoke_artifact: sourceSmokeSummary,
    notes: String(body.notes || '').trim() || null,
    input_defaults: {
      pdfPageIndex: decision.pageIndex,
      pdfScale: decision.scale,
      pdfExtract: decision.extractMode,
    },
    source_refs: sourceRefs,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      ...(Array.isArray(sourceSmokeSummary?.blocked_claims) ? sourceSmokeSummary.blocked_claims : []),
    ]),
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'SAM 3.1 visual audit results are internal-alpha correction evidence only.',
      'They may guide corrected room polygons, but they do not prove geometry accuracy, drawing scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact models.',
    ],
  };
}

function normalizeSam31EmployeeReplacement(projectName, evidence, decision, sam31Evidence, sam31Result, body = {}, user = {}) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!sam31Evidence || !sam31Result) {
    const e = new Error('source_sam31_evidence_id must reference a SAM 3.1 visual audit result for this boundary');
    e.httpStatus = 404;
    throw e;
  }
  const sourceSam31EvidenceId = Number(body.source_sam31_evidence_id);
  if (!Number.isSafeInteger(sourceSam31EvidenceId) || sourceSam31EvidenceId <= 0) {
    const e = new Error('source_sam31_evidence_id is required for SAM 3.1 employee replacement evidence');
    e.httpStatus = 400;
    throw e;
  }
  if (Number(sam31Result.source_evidence_id) !== Number(evidence.id)) {
    const e = new Error('source_sam31_evidence_id does not belong to the requested PDF boundary evidence');
    e.httpStatus = 409;
    throw e;
  }
  const replacementRef = String(body.replacement_ref || body.source_ref || '').trim();
  if (!replacementRef) {
    const e = new Error('replacement_ref is required for SAM 3.1 employee replacement evidence');
    e.httpStatus = 400;
    throw e;
  }
  const rawValues = body.replacement_values;
  if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) {
    const e = new Error('replacement_values must be an object');
    e.httpStatus = 400;
    throw e;
  }
  const unknownFields = Object.keys(rawValues).filter((field) => !SAM31_EMPLOYEE_REPLACEMENT_FIELDS.includes(field));
  if (unknownFields.length) {
    const e = new Error(`Unsupported SAM31 replacement fields: ${unknownFields.join(', ')}`);
    e.httpStatus = 400;
    throw e;
  }
  const replacementValues = {};
  for (const field of SAM31_EMPLOYEE_REPLACEMENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rawValues, field)) {
      replacementValues[field] = jsonClone(rawValues[field]);
    }
  }
  const replacedFields = Object.keys(replacementValues);
  if (!replacedFields.length) {
    const e = new Error('replacement_values must include at least one supported SAM31 replacement field');
    e.httpStatus = 400;
    throw e;
  }
  if (Object.prototype.hasOwnProperty.call(replacementValues, 'confidence')) {
    const confidence = Number(replacementValues.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      const e = new Error('replacement_values.confidence must be a number between 0 and 1');
      e.httpStatus = 400;
      throw e;
    }
    replacementValues.confidence = confidence;
  }
  const sourceRefs = [
    {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_file: evidence.source_file || decision.sourceFile || null,
      source_ref: evidence.source_ref || decision.sourceRef || null,
      status: evidence.status,
    },
    {
      evidence_id: sam31Evidence.id,
      evidence_type: sam31Evidence.evidence_type,
      source_ref: sam31Evidence.source_ref,
      status: sam31Evidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_type: 'employee_replacement_payload',
      source_ref: replacementRef,
      status: 'present',
      claim_gate_effect: 'no_claims_cleared',
    },
  ];
  return {
    artifact_type: 'sam31_employee_replacement',
    project_name: projectName,
    source_evidence_id: evidence.id,
    source_evidence_type: evidence.evidence_type,
    source_sam31_evidence_id: sam31Evidence.id,
    source_sam31_result_ref: sam31Result.sam31_result_ref || null,
    source_ref: evidence.source_ref || decision.sourceRef || null,
    source_file: evidence.source_file || decision.sourceFile || null,
    source_runtime: sam31Result.source_runtime || 'sam-3.1+llm',
    reviewer_name: String(body.reviewer_name || user.name || user.username || '').trim() || null,
    replaced_at: new Date().toISOString(),
    replacement_ref: replacementRef,
    replacement_values: replacementValues,
    replaced_fields: replacedFields,
    notes: String(body.notes || '').trim() || null,
    source_refs: sourceRefs,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      ...(Array.isArray(sam31Result.blocked_claims) ? sam31Result.blocked_claims : []),
      ...PDF_BOUNDARY_BLOCKED_CLAIMS,
    ]),
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'Employee SAM31 replacement payloads replace temporary AI values for internal-alpha replay only.',
      'They do not prove geometry accuracy, drawing scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact models.',
    ],
  };
}

function pdfBoundaryReplayInputPacket(projectName, evidence, decision, reviewEvidence, sam31Evidence = null, sam31ReplacementEvidence = null, sam31ExtrapolationEvidence = null, sam31ExtrapolationReviewEvidence = null) {
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
  const sam31ReplacementSummary = reviewSource === 'latest_sam31_visual_audit'
    ? sam31EmployeeReplacementReplaySummary(sam31ReplacementEvidence)
    : null;
  const replayRoomPolygons = applySam31EmployeeReplacementToPolygons(correctedRoomPolygons, sam31ReplacementSummary);
  const queueItem = pdfBoundaryResolverQueueItem(projectName, evidence, decision, reviewEvidence, sam31Evidence, sam31ReplacementEvidence);
  const openclawSam31PerceptionPacketSummary = reviewSource === 'latest_sam31_visual_audit'
    ? sam31PerceptionPacketSummary(review.openclaw_sam31_perception_packet)
    : null;
  const openclawSam31BridgeSmokeSummary = reviewSource === 'latest_sam31_visual_audit'
    && review.openclaw_sam31_bridge_smoke_artifact
    && typeof review.openclaw_sam31_bridge_smoke_artifact === 'object'
    ? jsonClone(review.openclaw_sam31_bridge_smoke_artifact)
    : null;
  const openclawSam31ExtrapolationProductReviewPacket = sam31ExtrapolationEvidence?.artifact && sam31ExtrapolationReviewEvidence?.review
    ? buildOpenClawSam31ExtrapolationReviewPacket(
      projectName,
      evidence,
      decision,
      sam31ExtrapolationEvidence,
      sam31ExtrapolationEvidence.artifact,
      sam31ExtrapolationReviewEvidence,
      sam31ExtrapolationReviewEvidence.review,
    )
    : null;
  const openclawSam31ExtrapolationProductReviewMetadata = openClawSam31ExtrapolationReviewPacketMetadata(openclawSam31ExtrapolationProductReviewPacket);
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
  if (openclawSam31BridgeSmokeSummary) {
    sourceRefs.push({
      evidence_id: openclawSam31BridgeSmokeSummary.evidence_id,
      evidence_type: 'openclaw_sam31_bridge_smoke_artifact',
      source_ref: openclawSam31BridgeSmokeSummary.source_ref || null,
      status: openclawSam31BridgeSmokeSummary.evidence_status || openclawSam31BridgeSmokeSummary.status || 'best_effort',
      claim_gate_effect: openclawSam31BridgeSmokeSummary.claim_gate_effect || 'no_claims_cleared',
    });
  }
  if (sam31ReplacementSummary) {
    sourceRefs.push({
      evidence_id: sam31ReplacementSummary.evidence_id,
      evidence_type: 'sam31_employee_replacement',
      source_ref: sam31ReplacementSummary.source_ref || sam31ReplacementSummary.replacement_ref || null,
      status: sam31ReplacementSummary.evidence_status,
      claim_gate_effect: sam31ReplacementSummary.claim_gate_effect || 'no_claims_cleared',
    });
  }
  if (openclawSam31ExtrapolationProductReviewPacket) {
    sourceRefs.push({
      evidence_id: openclawSam31ExtrapolationProductReviewPacket.source_openclaw_sam31_extrapolation_evidence_id,
      evidence_type: 'openclaw_sam31_extrapolation_artifact',
      source_ref: openclawSam31ExtrapolationProductReviewPacket.openclaw_sam31_extrapolation_artifact?.openclaw_endpoint || null,
      status: 'best_effort',
      claim_gate_effect: 'no_claims_cleared',
    });
    sourceRefs.push({
      evidence_id: openclawSam31ExtrapolationProductReviewPacket.source_openclaw_sam31_extrapolation_review_evidence_id,
      evidence_type: 'openclaw_sam31_extrapolation_review',
      source_ref: openclawSam31ExtrapolationProductReviewPacket.product_review?.replacement_ref || null,
      status: 'present',
      claim_gate_effect: 'no_claims_cleared',
    });
  }
  const replayBlockedClaims = uniqueStrings([
    ...(Array.isArray(queueItem.blocked_claims) ? queueItem.blocked_claims : []),
    ...(Array.isArray(review.blocked_claims) ? review.blocked_claims : []),
    ...(Array.isArray(openclawSam31BridgeSmokeSummary?.blocked_claims) ? openclawSam31BridgeSmokeSummary.blocked_claims : []),
    ...(Array.isArray(openclawSam31ExtrapolationProductReviewMetadata?.blocked_claims) ? openclawSam31ExtrapolationProductReviewMetadata.blocked_claims : []),
  ]);
  const sprinklerBidRequest = {
    room_boundary_source: reviewSource,
    source_evidence_id: evidence.id,
    pdfPageIndex: decision.pageIndex,
    pdfScale: decision.scale,
    pdfExtract: decision.extractMode,
    corrected_room_polygons: replayRoomPolygons,
    use_for_claims: false,
  };
  if (reviewSource === 'latest_employee_review_packet') {
    sprinklerBidRequest.source_review_evidence_id = reviewRow.id;
  } else {
    sprinklerBidRequest.source_sam31_evidence_id = reviewRow.id;
  }
  if (sam31ReplacementSummary) {
    sprinklerBidRequest.source_sam31_replacement_evidence_id = sam31ReplacementSummary.evidence_id;
    sprinklerBidRequest.sam31_replacement_source = 'latest_sam31_employee_replacement';
    sprinklerBidRequest.sam31_employee_replacement = sam31ReplacementSummary;
  }
  if (openclawSam31PerceptionPacketSummary) {
    sprinklerBidRequest.openclaw_sam31_perception_packet = openclawSam31PerceptionPacketSummary;
  }
  if (openclawSam31BridgeSmokeSummary) {
    sprinklerBidRequest.source_openclaw_sam31_bridge_smoke_evidence_id = openclawSam31BridgeSmokeSummary.evidence_id;
    sprinklerBidRequest.openclaw_sam31_bridge_smoke_artifact = openclawSam31BridgeSmokeSummary;
  }
  if (openclawSam31ExtrapolationProductReviewPacket) {
    sprinklerBidRequest.source_openclaw_sam31_extrapolation_evidence_id = openclawSam31ExtrapolationProductReviewPacket.source_openclaw_sam31_extrapolation_evidence_id;
    sprinklerBidRequest.source_openclaw_sam31_extrapolation_review_evidence_id = openclawSam31ExtrapolationProductReviewPacket.source_openclaw_sam31_extrapolation_review_evidence_id;
    sprinklerBidRequest.openclaw_sam31_extrapolation_product_review_packet = openclawSam31ExtrapolationProductReviewPacket;
    sprinklerBidRequest.sam31_downstream_review_metadata = openclawSam31ExtrapolationProductReviewMetadata;
  }
  return {
    artifact_type: 'room_boundary_replay_input_packet',
    status: 'ready_for_internal_alpha_replay',
    project_name: projectName,
    source_evidence_id: evidence.id,
    ...(reviewSource === 'latest_employee_review_packet'
      ? { source_review_evidence_id: reviewRow.id }
      : { source_sam31_evidence_id: reviewRow.id }),
    ...(sam31ReplacementSummary
      ? {
        source_sam31_replacement_evidence_id: sam31ReplacementSummary.evidence_id,
        sam31_replacement_source: 'latest_sam31_employee_replacement',
        latest_sam31_employee_replacement: sam31ReplacementSummary,
      }
      : {}),
    ...(openclawSam31BridgeSmokeSummary
      ? {
        source_openclaw_sam31_bridge_smoke_evidence_id: openclawSam31BridgeSmokeSummary.evidence_id,
        openclaw_sam31_bridge_smoke_artifact: openclawSam31BridgeSmokeSummary,
      }
      : {}),
    ...(openclawSam31ExtrapolationProductReviewPacket
      ? {
        source_openclaw_sam31_extrapolation_evidence_id: openclawSam31ExtrapolationProductReviewPacket.source_openclaw_sam31_extrapolation_evidence_id,
        source_openclaw_sam31_extrapolation_review_evidence_id: openclawSam31ExtrapolationProductReviewPacket.source_openclaw_sam31_extrapolation_review_evidence_id,
        openclaw_sam31_extrapolation_product_review_packet: openclawSam31ExtrapolationProductReviewPacket,
        sam31_downstream_review_metadata: openclawSam31ExtrapolationProductReviewMetadata,
      }
      : {}),
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
    corrected_room_polygons: replayRoomPolygons,
    input_defaults: queueItem.input_defaults,
    sprinkler_bid_request: sprinklerBidRequest,
    source_refs: sourceRefs,
    blocked_claims: replayBlockedClaims,
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
  const sourceSam31ReplacementEvidenceId = Number(req.body.source_sam31_replacement_evidence_id);
  const sourceSam31ExtrapolationEvidenceId = Number(req.body.source_openclaw_sam31_extrapolation_evidence_id);
  const sourceSam31ExtrapolationReviewEvidenceId = Number(req.body.source_openclaw_sam31_extrapolation_review_evidence_id);
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
  const sourceSam31ReplacementEvidence = replaySource === 'latest_sam31_visual_audit'
    && Number.isSafeInteger(sourceSam31ReplacementEvidenceId)
    && sourceSam31ReplacementEvidenceId > 0
    ? db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'sam31_employee_replacement'`)
      .get(sourceSam31ReplacementEvidenceId, projectName)
    : null;
  const sourceSam31ExtrapolationEvidence = Number.isSafeInteger(sourceSam31ExtrapolationEvidenceId)
    && sourceSam31ExtrapolationEvidenceId > 0
    ? db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_extrapolation_artifact'`)
      .get(sourceSam31ExtrapolationEvidenceId, projectName)
    : null;
  const sourceSam31ExtrapolationReviewEvidence = Number.isSafeInteger(sourceSam31ExtrapolationReviewEvidenceId)
    && sourceSam31ExtrapolationReviewEvidenceId > 0
    ? db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_extrapolation_review'`)
      .get(sourceSam31ExtrapolationReviewEvidenceId, projectName)
    : null;
  const sourceReview = replaySource === 'latest_employee_review_packet'
    ? reviewFromEvidence(sourceReviewEvidence)
    : sam31VisualAuditResultFromEvidence(sourceReviewEvidence);
  const sourceSam31Replacement = sam31EmployeeReplacementFromEvidence(sourceSam31ReplacementEvidence);
  const sourceSam31ExtrapolationArtifact = openClawSam31ExtrapolationArtifactFromEvidence(sourceSam31ExtrapolationEvidence);
  const sourceSam31ExtrapolationReview = openClawSam31ExtrapolationReviewFromEvidence(sourceSam31ExtrapolationReviewEvidence);
  if (!sourceEvidence || !sourceReview || Number(sourceReview.source_evidence_id) !== sourceEvidenceId) {
    const e = new Error(
      replaySource === 'latest_sam31_visual_audit'
        ? 'Replay input source evidence does not match a saved SAM 3.1 visual audit result'
        : 'Replay input source evidence does not match a saved room-boundary review packet',
    );
    e.httpStatus = 409;
    throw e;
  }
  if (Number.isSafeInteger(sourceSam31ReplacementEvidenceId) && sourceSam31ReplacementEvidenceId > 0) {
    if (
      !sourceSam31Replacement ||
      Number(sourceSam31Replacement.source_evidence_id) !== Number(sourceEvidenceId) ||
      Number(sourceSam31Replacement.source_sam31_evidence_id) !== Number(sourceSam31EvidenceId)
    ) {
      const e = new Error('Replay input source evidence does not match a saved SAM 3.1 employee replacement payload');
      e.httpStatus = 409;
      throw e;
    }
  }
  if (Number.isSafeInteger(sourceSam31ExtrapolationEvidenceId) && sourceSam31ExtrapolationEvidenceId > 0) {
    if (
      !sourceSam31ExtrapolationArtifact ||
      Number(sourceSam31ExtrapolationArtifact.source_pdf_boundary_evidence_id) !== Number(sourceEvidenceId)
    ) {
      const e = new Error('Replay input source evidence does not match a saved OpenClaw SAM31 extrapolation artifact');
      e.httpStatus = 409;
      throw e;
    }
  }
  if (Number.isSafeInteger(sourceSam31ExtrapolationReviewEvidenceId) && sourceSam31ExtrapolationReviewEvidenceId > 0) {
    if (
      !sourceSam31ExtrapolationReview ||
      Number(sourceSam31ExtrapolationReview.source_pdf_boundary_evidence_id) !== Number(sourceEvidenceId) ||
      Number(sourceSam31ExtrapolationReview.source_openclaw_sam31_extrapolation_evidence_id) !== Number(sourceSam31ExtrapolationEvidenceId)
    ) {
      const e = new Error('Replay input source evidence does not match a saved OpenClaw SAM31 extrapolation review');
      e.httpStatus = 409;
      throw e;
    }
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
  const openclawSam31BridgeSmokeSummary = replaySource === 'latest_sam31_visual_audit'
    && sourceReview.openclaw_sam31_bridge_smoke_artifact
    && typeof sourceReview.openclaw_sam31_bridge_smoke_artifact === 'object'
    ? jsonClone(sourceReview.openclaw_sam31_bridge_smoke_artifact)
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
  if (openclawSam31BridgeSmokeSummary) {
    sourceRefs.push({
      evidence_id: openclawSam31BridgeSmokeSummary.evidence_id,
      evidence_type: 'openclaw_sam31_bridge_smoke_artifact',
      source_ref: openclawSam31BridgeSmokeSummary.source_ref || null,
      status: openclawSam31BridgeSmokeSummary.evidence_status || openclawSam31BridgeSmokeSummary.status || 'best_effort',
      claim_gate_effect: openclawSam31BridgeSmokeSummary.claim_gate_effect || 'no_claims_cleared',
    });
  }
  const sam31ReplacementSummary = sourceSam31Replacement
    ? sam31EmployeeReplacementReplaySummary({ evidence: sourceSam31ReplacementEvidence, replacement: sourceSam31Replacement })
    : null;
  if (sam31ReplacementSummary) {
    sourceRefs.push({
      evidence_id: sam31ReplacementSummary.evidence_id,
      evidence_type: 'sam31_employee_replacement',
      source_ref: sam31ReplacementSummary.source_ref || sam31ReplacementSummary.replacement_ref || null,
      status: sam31ReplacementSummary.evidence_status,
      claim_gate_effect: sam31ReplacementSummary.claim_gate_effect || 'no_claims_cleared',
    });
  }
  const openclawSam31ExtrapolationProductReviewPacket = sourceSam31ExtrapolationArtifact && sourceSam31ExtrapolationReview
    ? buildOpenClawSam31ExtrapolationReviewPacket(
      projectName,
      sourceEvidence,
      decisionFromEvidence(sourceEvidence),
      { evidence: sourceSam31ExtrapolationEvidence, artifact: sourceSam31ExtrapolationArtifact },
      sourceSam31ExtrapolationArtifact,
      { evidence: sourceSam31ExtrapolationReviewEvidence, review: sourceSam31ExtrapolationReview },
      sourceSam31ExtrapolationReview,
    )
    : null;
  const openclawSam31ExtrapolationProductReviewMetadata = openClawSam31ExtrapolationReviewPacketMetadata(openclawSam31ExtrapolationProductReviewPacket);
  if (openclawSam31ExtrapolationProductReviewPacket) {
    sourceRefs.push({
      evidence_id: openclawSam31ExtrapolationProductReviewPacket.source_openclaw_sam31_extrapolation_evidence_id,
      evidence_type: 'openclaw_sam31_extrapolation_artifact',
      source_ref: openclawSam31ExtrapolationProductReviewPacket.openclaw_sam31_extrapolation_artifact?.openclaw_endpoint || null,
      status: sourceSam31ExtrapolationEvidence.status,
      claim_gate_effect: 'no_claims_cleared',
    });
    sourceRefs.push({
      evidence_id: openclawSam31ExtrapolationProductReviewPacket.source_openclaw_sam31_extrapolation_review_evidence_id,
      evidence_type: 'openclaw_sam31_extrapolation_review',
      source_ref: openclawSam31ExtrapolationProductReviewPacket.product_review?.replacement_ref || null,
      status: sourceSam31ExtrapolationReviewEvidence.status,
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
      ...(sam31ReplacementSummary
        ? {
          source_sam31_replacement_evidence_id: sam31ReplacementSummary.evidence_id,
          sam31_replacement_source: 'latest_sam31_employee_replacement',
          sam31_employee_replacement: sam31ReplacementSummary,
        }
        : {}),
      ...(openclawSam31ExtrapolationProductReviewPacket
        ? {
          source_openclaw_sam31_extrapolation_evidence_id: openclawSam31ExtrapolationProductReviewPacket.source_openclaw_sam31_extrapolation_evidence_id,
          source_openclaw_sam31_extrapolation_review_evidence_id: openclawSam31ExtrapolationProductReviewPacket.source_openclaw_sam31_extrapolation_review_evidence_id,
          openclaw_sam31_extrapolation_product_review_packet: openclawSam31ExtrapolationProductReviewPacket,
          sam31_downstream_review_metadata: openclawSam31ExtrapolationProductReviewMetadata,
        }
        : {}),
      source_ref: sourceEvidence.source_ref || sourceReview.source_ref || null,
      marked_up_plan_ref: sourceReview.marked_up_plan_ref || null,
      ...(replaySource === 'latest_sam31_visual_audit'
        ? {
          sam31_result_ref: sourceReview.sam31_result_ref || null,
          screenshot_ref: sourceReview.screenshot_ref || null,
          console_log_ref: sourceReview.console_log_ref || null,
          openclaw_sam31_perception_packet: openclawSam31PerceptionPacketSummary,
          source_openclaw_sam31_bridge_smoke_evidence_id: openclawSam31BridgeSmokeSummary?.evidence_id || null,
          openclaw_sam31_bridge_smoke_artifact: openclawSam31BridgeSmokeSummary,
        }
        : {}),
      corrected_room_polygon_count: correctedRoomPolygons.length,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      blocked_claims: uniqueStrings([
        ...(Array.isArray(sourceReview.blocked_claims) ? sourceReview.blocked_claims : PDF_BOUNDARY_BLOCKED_CLAIMS),
        ...(Array.isArray(openclawSam31ExtrapolationProductReviewMetadata?.blocked_claims) ? openclawSam31ExtrapolationProductReviewMetadata.blocked_claims : []),
      ]),
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
  const filters = {
    sam31ConsumerReview: String(req.query?.sam31ConsumerReview || '').trim().toLowerCase() || null,
    sam31SprinklerReview: String(req.query?.sam31SprinklerReview || '').trim().toLowerCase() || null,
    sam31SprinklerReplay: String(req.query?.sam31SprinklerReplay || '').trim().toLowerCase() || null,
    consumer: String(req.query?.consumer || '').trim().toLowerCase() || null,
    lane: String(req.query?.lane || '').trim().toLowerCase() || null,
  };
  const evidence = latestPdfBoundaryDecisionEvidence(projectName);
  const decision = decisionFromEvidence(evidence);
  const reviewEvidence = evidence ? latestPdfBoundaryReviewEvidence(projectName, evidence.id) : null;
  const sam31Evidence = evidence ? latestSam31VisualAuditEvidence(projectName, evidence.id) : null;
  const sam31ReplacementEvidence = evidence ? latestSam31EmployeeReplacementEvidence(projectName, evidence.id) : null;
  const sam31SmokeEvidence = evidence ? latestSam31BridgeSmokeArtifactEvidence(projectName, evidence.id) : null;
  const sam31ExtrapolationEvidence = evidence ? latestOpenClawSam31ExtrapolationArtifactEvidence(projectName, evidence.id) : null;
  const sam31ExtrapolationReviewEvidence = evidence ? latestOpenClawSam31ExtrapolationReviewEvidence(projectName, evidence.id) : null;
  const sam31ConsumerSmokeEvidence = evidence ? latestOpenClawSam31ConsumerSmokeArtifactEvidence(projectName, evidence.id) : null;
  const sam31ConsumerReviewEvidences = evidence ? latestOpenClawSam31ConsumerReviewEvidence(projectName, evidence.id) : [];
  const sam31SprinklerReviewDecisionEvidences = evidence ? latestHalofireSam31SprinklerReviewDecisionEvidence(projectName, evidence.id) : [];
  const sam31SprinklerPreliminaryReplayFollowupDecisionEvidences = evidence ? latestHalofireSam31SprinklerPreliminaryReplayFollowupDecisionEvidence(projectName, evidence.id) : [];
  const items = [];
  const officialFlowEvidence = latestOfficialFlowIntakeEvidence(projectName);
  const officialFlowItem = officialFlowResolverQueueItem(projectName, officialFlowEvidence);
  if (officialFlowItem) items.push(officialFlowItem);
  for (const replayEvidence of officialFlowReplayArtifactEvidenceRows(projectName)) {
    const replayItem = officialFlowReplayReviewQueueItem(projectName, replayEvidence);
    if (replayItem) items.push(replayItem);
  }
  const boundaryItem = pdfBoundaryResolverQueueItem(projectName, evidence, decision, reviewEvidence, sam31Evidence, sam31ReplacementEvidence, sam31SmokeEvidence, sam31ExtrapolationEvidence, sam31ExtrapolationReviewEvidence, sam31ConsumerSmokeEvidence, sam31ConsumerReviewEvidences, sam31SprinklerReviewDecisionEvidences, sam31SprinklerPreliminaryReplayFollowupDecisionEvidences);
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
  let visibleItems = items;
  if (filters.sam31ConsumerReview === 'unresolved') {
    visibleItems = items
      .map((item) => {
        const unresolved = Array.isArray(item.sam31_unresolved_consumer_reviews)
          ? item.sam31_unresolved_consumer_reviews.filter((review) => !filters.consumer || review.consumer === filters.consumer)
          : [];
        return unresolved.length ? { ...item, sam31_unresolved_consumer_reviews: unresolved } : null;
      })
      .filter(Boolean);
  }
  if (filters.sam31SprinklerReview === 'queued') {
    visibleItems = visibleItems
      .map((item) => {
        const sprinklerRows = Array.isArray(item.sam31_sprinkler_review_queue_items)
          ? item.sam31_sprinkler_review_queue_items
            .filter((row) => !filters.consumer || String(row.consumer || '').toLowerCase() === filters.consumer)
            .filter((row) => !filters.lane || String(row.supported_sprinkler_review_lane || '').toLowerCase() === filters.lane)
          : [];
        return sprinklerRows.length ? { ...item, sam31_sprinkler_review_queue_items: sprinklerRows } : null;
      })
      .filter(Boolean);
  }
  if (filters.sam31SprinklerReplay === 'ready') {
    visibleItems = visibleItems
      .map((item) => {
        const replayRows = Array.isArray(item.sam31_sprinkler_preliminary_replay_queue_items)
          ? item.sam31_sprinkler_preliminary_replay_queue_items
            .filter((row) => !filters.consumer || String(row.consumer || '').toLowerCase() === filters.consumer)
            .filter((row) => !filters.lane || String(row.supported_sprinkler_review_lane || '').toLowerCase() === filters.lane)
          : [];
        return replayRows.length ? { ...item, sam31_sprinkler_preliminary_replay_queue_items: replayRows } : null;
      })
      .filter(Boolean);
  }
  const statusCounts = visibleItems.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  res.json({
    project_name: projectName,
    filters,
    items: visibleItems,
    summary: {
      ready: statusCounts.ready || 0,
      blocked: statusCounts.blocked || 0,
      correction_ready: statusCounts.correction_ready || 0,
      reviewed: statusCounts.reviewed || 0,
      sam31_correction_ready: statusCounts.sam31_correction_ready || 0,
      sam31_reviewed: statusCounts.sam31_reviewed || 0,
      sam31_replacements_recorded: statusCounts.sam31_replacements_recorded || 0,
      sam31_bridge_smoke_recorded: visibleItems.filter((item) => item.latest_openclaw_sam31_bridge_smoke_artifact).length,
      sam31_extrapolation_recorded: visibleItems.filter((item) => item.latest_openclaw_sam31_extrapolation_artifact).length,
      sam31_extrapolation_reviews_recorded: visibleItems.filter((item) => item.latest_openclaw_sam31_extrapolation_review).length,
      sam31_consumer_smoke_recorded: visibleItems.filter((item) => item.latest_openclaw_sam31_consumer_smoke_artifact).length,
      sam31_consumer_reviews_recorded: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.latest_openclaw_sam31_consumer_reviews) ? item.latest_openclaw_sam31_consumer_reviews.length : 0), 0),
      sam31_consumer_reviews_unresolved: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_unresolved_consumer_reviews) ? item.sam31_unresolved_consumer_reviews.length : 0), 0),
      sam31_sprinkler_review_queue_items: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_sprinkler_review_queue_items) ? item.sam31_sprinkler_review_queue_items.length : 0), 0),
      sam31_sprinkler_review_decisions_recorded: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_sprinkler_review_queue_items) ? item.sam31_sprinkler_review_queue_items.filter((row) => row.latest_sam31_sprinkler_review_decision).length : 0), 0),
      sam31_sprinkler_preliminary_replay_queue_items: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_sprinkler_preliminary_replay_queue_items) ? item.sam31_sprinkler_preliminary_replay_queue_items.length : 0), 0),
      sam31_sprinkler_preliminary_replay_followups_recorded: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_sprinkler_preliminary_replay_queue_items) ? item.sam31_sprinkler_preliminary_replay_queue_items.filter((row) => row.latest_sam31_sprinkler_preliminary_replay_followup_decision).length : 0), 0),
      sam31_sprinkler_packet_queue_items: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_sprinkler_preliminary_replay_queue_items) ? item.sam31_sprinkler_preliminary_replay_queue_items.reduce((rowAcc, row) => rowAcc + (Array.isArray(row.packet_queue_items) ? row.packet_queue_items.length : 0), 0) : 0), 0),
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

app.get('/api/openclaw/sam31/status', authMiddleware, async (req, res) => {
  res.json(await openClawSam31BridgeStatusWithProbe());
});

app.post('/api/projects/:name/openclaw/sam31/smoke-artifact', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const projectName = req.params.name;
    const bridgeStatus = await openClawSam31BridgeStatusWithProbe();
    if (!bridgeStatus.bridge_url_configured || !bridgeStatus.bridge_reachable) {
      return res.status(503).json({
        artifact_type: 'openclaw.sam31_bridge_smoke_artifact',
        status: bridgeStatus.bridge_url_configured ? 'bridge_unreachable' : 'bridge_unavailable',
        project_name: projectName,
        tool_ref: 'pdfExtract:sam',
        bridge_status: bridgeStatus,
        claim_gate_effect: 'no_claims_cleared',
        blocked_claims: uniqueStrings([
          ...PDF_BOUNDARY_BLOCKED_CLAIMS,
          'SAM31_runtime_verified',
          'OpenClaw_runtime_verified',
        ]),
        next_action: bridgeStatus.next_action,
      });
    }

    const sam31Request = normalizeSam31SmokeRequest(projectName, req.body);
    const sourceBoundaryEvidenceId = Number(req.body?.source_pdf_boundary_evidence_id ?? req.body?.source_evidence_id);
    const sourceBoundaryEvidence = Number.isSafeInteger(sourceBoundaryEvidenceId) && sourceBoundaryEvidenceId > 0
      ? db
        .prepare(`SELECT * FROM project_evidence
                  WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
        .get(sourceBoundaryEvidenceId, projectName)
      : null;
    if (Number.isSafeInteger(sourceBoundaryEvidenceId) && sourceBoundaryEvidenceId > 0 && !sourceBoundaryEvidence) {
      return res.status(404).json({ error: 'source_pdf_boundary_evidence_id must reference a saved PDF boundary decision for this project' });
    }
    const bridgeBase = trimBridgeUrl(bridgeStatus.bridge_url);
    const bridgeEndpoint = `${bridgeBase}/codex-bridge/invoke`;
    const invoke = makeBridgeInvoker({
      bridgeUrl: bridgeBase,
      fetchImpl: globalThis.fetch,
      timeoutMs: Number(process.env.HALOFIRE_SAM31_INVOKE_TIMEOUT_MS || 20000),
    });

    let result;
    try {
      result = await invoke(SAM31_FLOORPLAN_TOOL, sam31Request);
    } catch (err) {
      return res.status(502).json({
        artifact_type: 'openclaw.sam31_bridge_smoke_artifact',
        status: 'sam31_invocation_failed',
        project_name: projectName,
        tool_ref: 'pdfExtract:sam',
        bridge_status: bridgeStatus,
        invocation: {
          tool: SAM31_FLOORPLAN_TOOL,
          endpoint: bridgeEndpoint,
          method: 'POST',
        },
        sam31_request: sam31Request,
        error: err && err.message ? err.message : 'SAM31 bridge invocation failed',
        claim_gate_effect: 'no_claims_cleared',
        blocked_claims: uniqueStrings([
          ...PDF_BOUNDARY_BLOCKED_CLAIMS,
          'SAM31_runtime_verified',
          'OpenClaw_runtime_verified',
        ]),
        next_action: 'Fix the OpenClaw SAM31 bridge invocation path, then rerun this smoke artifact; use employee replacement workflows as fallback.',
      });
    }

    const artifact = buildSam31BridgeSmokeArtifact(projectName, bridgeStatus, sam31Request, result, bridgeEndpoint, {
      source_pdf_boundary_evidence_id: sourceBoundaryEvidence?.id || null,
      source_ref: sourceBoundaryEvidence?.source_ref || sam31Request.pdfRef || null,
      source_file: sourceBoundaryEvidence?.source_file || null,
      source_status: sourceBoundaryEvidence?.status || null,
    });
    const notes = {
      kind: 'openclaw_sam31_bridge_smoke_artifact',
      artifact,
      blocked_claims: artifact.blocked_claims,
      claim_gate_effect: artifact.claim_gate_effect,
      limitations: artifact.limitations,
    };
    const insert = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'openclaw_sam31_bridge_smoke_artifact',
        'OPENCLAW_BRIDGE_URL',
        bridgeEndpoint,
        'best_effort',
        JSON.stringify(notes),
      );
    const evidence = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(insert.lastInsertRowid);
    return res.status(201).json({
      id: insert.lastInsertRowid,
      message: 'OpenClaw SAM31 bridge smoke artifact saved as best-effort evidence; claims still blocked',
      evidence,
      ...artifact,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/extrapolation-artifact', authMiddleware, requireRole('admin'), async (req, res) => {
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
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const artifact = await invokeOpenClawSam31Extrapolation(projectName, evidence, decision);
    const notes = {
      kind: 'openclaw_sam31_extrapolation_artifact',
      artifact,
      blocked_claims: artifact.blocked_claims,
      claim_gate_effect: artifact.claim_gate_effect,
      limitations: artifact.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'openclaw_sam31_extrapolation_artifact',
        artifact.openclaw_endpoint_source_file || 'OPENCLAW_PERCEPTION_URL',
        artifact.openclaw_endpoint,
        'best_effort',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'OpenClaw SAM31 extrapolation artifact saved as best-effort evidence; claims still blocked',
      evidence: evidenceRow,
      ...artifact,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/extrapolation-review', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    const sourceExtrapolationEvidenceId = Number(req.body?.source_openclaw_sam31_extrapolation_evidence_id);
    if (!Number.isSafeInteger(sourceExtrapolationEvidenceId) || sourceExtrapolationEvidenceId <= 0) {
      return res.status(400).json({ error: 'source_openclaw_sam31_extrapolation_evidence_id is required for OpenClaw SAM31 extrapolation review evidence' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const extrapolationEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_extrapolation_artifact'`)
      .get(sourceExtrapolationEvidenceId, projectName);
    const extrapolationArtifact = openClawSam31ExtrapolationArtifactFromEvidence(extrapolationEvidence);
    const reviewPacket = normalizeOpenClawSam31ExtrapolationReview(projectName, evidence, decision, extrapolationEvidence, extrapolationArtifact, req.body, req.user);
    const notes = {
      kind: 'openclaw_sam31_extrapolation_review',
      review: reviewPacket,
      blocked_claims: reviewPacket.blocked_claims,
      claim_gate_effect: reviewPacket.claim_gate_effect,
      limitations: reviewPacket.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'openclaw_sam31_extrapolation_review',
        reviewPacket.source_file,
        `pdf-boundary:${evidence.id}:openclaw-sam31-extrapolation-review:${extrapolationEvidence.id}`,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'OpenClaw SAM31 extrapolation product review values recorded; claims still blocked',
      evidence: evidenceRow,
      ...reviewPacket,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/extrapolation-review-packet', authMiddleware, (req, res) => {
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
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const extrapolationEvidence = latestOpenClawSam31ExtrapolationArtifactEvidence(projectName, evidence.id);
    const reviewEvidence = latestOpenClawSam31ExtrapolationReviewEvidence(projectName, evidence.id);
    return res.json(buildOpenClawSam31ExtrapolationReviewPacket(
      projectName,
      evidence,
      decision,
      extrapolationEvidence,
      extrapolationEvidence?.artifact || null,
      reviewEvidence,
      reviewEvidence?.review || null,
    ));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/product-review-queue-item', authMiddleware, (req, res) => {
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
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const extrapolationEvidence = latestOpenClawSam31ExtrapolationArtifactEvidence(projectName, evidence.id);
    return res.json(buildOpenClawSam31ProductReviewQueueItemPacket(
      projectName,
      evidence,
      decision,
      extrapolationEvidence,
      extrapolationEvidence?.artifact || null,
    ));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/consumer-smoke-packet', authMiddleware, (req, res) => {
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
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const consumerSmokeEvidence = latestOpenClawSam31ConsumerSmokeArtifactEvidence(projectName, evidence.id);
    return res.json(buildOpenClawSam31ConsumerSmokeDownloadPacket(
      projectName,
      evidence,
      decision,
      consumerSmokeEvidence,
    ));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/consumer-smoke', authMiddleware, requireRole('admin'), async (req, res) => {
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
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const extrapolationEvidence = latestOpenClawSam31ExtrapolationArtifactEvidence(projectName, evidence.id);
    const artifact = await buildOpenClawSam31ConsumerSmokeArtifact(
      projectName,
      evidence,
      decision,
      extrapolationEvidence,
      extrapolationEvidence?.artifact || null,
    );
    const notes = {
      kind: 'openclaw_sam31_consumer_smoke_artifact',
      artifact,
      missing_evidence_rows: artifact.missing_evidence_rows,
      blocked_claims: artifact.blocked_claims,
      claim_gate_effect: artifact.claim_gate_effect,
      limitations: artifact.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'openclaw_sam31_consumer_smoke_artifact',
        artifact.canonical_tool_descriptor_source_file || 'OPENCLAW_PERCEPTION_URL',
        artifact.canonical_tool_descriptor_url || artifact.source_ref || 'openclaw.sam31.consumer_smoke',
        'best_effort',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'OpenClaw SAM31 consumer queue smoke saved as best-effort evidence; claims still blocked',
      evidence: evidenceRow,
      ...artifact,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/consumer-review', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    const sourceConsumerSmokeEvidenceId = Number(req.body?.source_openclaw_sam31_consumer_smoke_evidence_id);
    if (!Number.isSafeInteger(sourceConsumerSmokeEvidenceId) || sourceConsumerSmokeEvidenceId <= 0) {
      return res.status(400).json({ error: 'source_openclaw_sam31_consumer_smoke_evidence_id is required for SAM31 consumer review evidence' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const consumerSmokeEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_consumer_smoke_artifact'`)
      .get(sourceConsumerSmokeEvidenceId, projectName);
    const consumerSmokeArtifact = openClawSam31ConsumerSmokeArtifactFromEvidence(consumerSmokeEvidence);
    const reviewPacket = normalizeOpenClawSam31ConsumerReview(projectName, evidence, decision, consumerSmokeEvidence, consumerSmokeArtifact, req.body, req.user);
    const notes = {
      kind: 'openclaw_sam31_consumer_review',
      review: reviewPacket,
      blocked_claims: reviewPacket.blocked_claims,
      claim_gate_effect: reviewPacket.claim_gate_effect,
      limitations: reviewPacket.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'openclaw_sam31_consumer_review',
        reviewPacket.source_file,
        reviewPacket.replacement_ref,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'SAM31 consumer product-review decision recorded; claims still blocked',
      evidence: evidenceRow,
      ...reviewPacket,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/openclaw/sam31/product-owner-replacements', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.body?.source_pdf_boundary_evidence_id);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'source_pdf_boundary_evidence_id is required for the shared OpenClaw SAM31 product-owner replacement intake' });
    }
    const sourceConsumerSmokeEvidenceId = Number(req.body?.source_openclaw_sam31_consumer_smoke_evidence_id);
    if (!Number.isSafeInteger(sourceConsumerSmokeEvidenceId) || sourceConsumerSmokeEvidenceId <= 0) {
      return res.status(400).json({ error: 'source_openclaw_sam31_consumer_smoke_evidence_id is required for the shared OpenClaw SAM31 product-owner replacement intake' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const consumerSmokeEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_consumer_smoke_artifact'`)
      .get(sourceConsumerSmokeEvidenceId, projectName);
    const consumerSmokeArtifact = openClawSam31ConsumerSmokeArtifactFromEvidence(consumerSmokeEvidence);
    const reviewPacket = normalizeOpenClawSam31ConsumerReview(projectName, evidence, decision, consumerSmokeEvidence, consumerSmokeArtifact, req.body, req.user);
    const adapterPreview = buildOpenClawSam31ProductOwnerReplacementIntake(projectName, reviewPacket, null);
    const notes = {
      kind: 'openclaw_sam31_consumer_review',
      intake_kind: 'product_owner_replacement_intake',
      intake_adapter: {
        artifact_type: adapterPreview.artifact_type,
        status: adapterPreview.status,
        source_application: adapterPreview.source_application,
        consumer: adapterPreview.consumer,
        supported_applications: adapterPreview.supported_applications,
        intake_contract: adapterPreview.intake_contract,
        claim_gate_effect: adapterPreview.claim_gate_effect,
      },
      review: reviewPacket,
      blocked_claims: reviewPacket.blocked_claims,
      claim_gate_effect: reviewPacket.claim_gate_effect,
      limitations: reviewPacket.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'openclaw_sam31_consumer_review',
        reviewPacket.source_file,
        reviewPacket.replacement_ref,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'Shared OpenClaw SAM31 product-owner replacement intake recorded; claims still blocked',
      ...buildOpenClawSam31ProductOwnerReplacementIntake(projectName, reviewPacket, evidenceRow),
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/consumer-review/:reviewEvidenceId/packet', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const reviewEvidenceId = Number(req.params.reviewEvidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    if (!Number.isSafeInteger(reviewEvidenceId) || reviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer review evidence id is required' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const reviewEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_consumer_review'`)
      .get(reviewEvidenceId, projectName);
    const review = openClawSam31ConsumerReviewFromEvidence(reviewEvidence);
    if (!reviewEvidence || !review) {
      return res.status(404).json({ error: 'SAM31 consumer review evidence not found' });
    }
    const sourceConsumerSmokeEvidenceId = Number(review.source_openclaw_sam31_consumer_smoke_evidence_id);
    const consumerSmokeEvidence = Number.isSafeInteger(sourceConsumerSmokeEvidenceId) && sourceConsumerSmokeEvidenceId > 0
      ? db
        .prepare(`SELECT * FROM project_evidence
                  WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_consumer_smoke_artifact'`)
        .get(sourceConsumerSmokeEvidenceId, projectName)
      : null;
    return res.json(buildOpenClawSam31ConsumerReviewDecisionPacket(
      projectName,
      evidence,
      decision,
      reviewEvidence,
      review,
      consumerSmokeEvidence,
    ));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/sprinkler-review-adapter/:reviewEvidenceId', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const reviewEvidenceId = Number(req.params.reviewEvidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    if (!Number.isSafeInteger(reviewEvidenceId) || reviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer review evidence id is required' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const reviewEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_consumer_review'`)
      .get(reviewEvidenceId, projectName);
    const review = openClawSam31ConsumerReviewFromEvidence(reviewEvidence);
    if (!reviewEvidence || !review) {
      return res.status(404).json({ error: 'SAM31 consumer review evidence not found' });
    }
    const sourceConsumerSmokeEvidenceId = Number(review.source_openclaw_sam31_consumer_smoke_evidence_id);
    const consumerSmokeEvidence = Number.isSafeInteger(sourceConsumerSmokeEvidenceId) && sourceConsumerSmokeEvidenceId > 0
      ? db
        .prepare(`SELECT * FROM project_evidence
                  WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_consumer_smoke_artifact'`)
        .get(sourceConsumerSmokeEvidenceId, projectName)
      : null;
    return res.json(buildOpenClawSam31ToSprinklerReviewAdapter(
      projectName,
      evidence,
      decision,
      reviewEvidence,
      review,
      consumerSmokeEvidence,
    ));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/sprinkler-review/:reviewEvidenceId/decision/:sprinklerReviewEvidenceId/packet', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const reviewEvidenceId = Number(req.params.reviewEvidenceId);
    const sprinklerReviewEvidenceId = Number(req.params.sprinklerReviewEvidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    if (!Number.isSafeInteger(reviewEvidenceId) || reviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer review evidence id is required' });
    }
    if (!Number.isSafeInteger(sprinklerReviewEvidenceId) || sprinklerReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 sprinkler review decision evidence id is required' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const reviewEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_consumer_review'`)
      .get(reviewEvidenceId, projectName);
    const review = openClawSam31ConsumerReviewFromEvidence(reviewEvidence);
    if (!reviewEvidence || !review) {
      return res.status(404).json({ error: 'SAM31 consumer review evidence not found' });
    }
    const sprinklerReviewEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'halofire_sam31_sprinkler_review_decision'`)
      .get(sprinklerReviewEvidenceId, projectName);
    const sprinklerReview = halofireSam31SprinklerReviewDecisionFromEvidence(sprinklerReviewEvidence);
    if (!sprinklerReviewEvidence || !sprinklerReview) {
      return res.status(404).json({ error: 'HaloFire SAM31 sprinkler review decision evidence not found' });
    }
    return res.json(buildHalofireSam31SprinklerReviewDecisionPacket(
      projectName,
      evidence,
      decision,
      reviewEvidence,
      review,
      sprinklerReviewEvidence,
      sprinklerReview,
    ));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/sprinkler-review/:reviewEvidenceId/decision/:sprinklerReviewEvidenceId/preliminary-replay', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const reviewEvidenceId = Number(req.params.reviewEvidenceId);
    const sprinklerReviewEvidenceId = Number(req.params.sprinklerReviewEvidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    if (!Number.isSafeInteger(reviewEvidenceId) || reviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer review evidence id is required' });
    }
    if (!Number.isSafeInteger(sprinklerReviewEvidenceId) || sprinklerReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 sprinkler review decision evidence id is required' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const reviewEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_consumer_review'`)
      .get(reviewEvidenceId, projectName);
    const review = openClawSam31ConsumerReviewFromEvidence(reviewEvidence);
    if (!reviewEvidence || !review) {
      return res.status(404).json({ error: 'SAM31 consumer review evidence not found' });
    }
    const sprinklerReviewEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'halofire_sam31_sprinkler_review_decision'`)
      .get(sprinklerReviewEvidenceId, projectName);
    const sprinklerReview = halofireSam31SprinklerReviewDecisionFromEvidence(sprinklerReviewEvidence);
    if (!sprinklerReviewEvidence || !sprinklerReview) {
      return res.status(404).json({ error: 'HaloFire SAM31 sprinkler review decision evidence not found' });
    }
    return res.json(buildHalofireSam31SprinklerPreliminaryReplayArtifact(
      projectName,
      evidence,
      decision,
      reviewEvidence,
      review,
      sprinklerReviewEvidence,
      sprinklerReview,
    ));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/sprinkler-review/:reviewEvidenceId/decision/:sprinklerReviewEvidenceId/preliminary-replay/followup', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const reviewEvidenceId = Number(req.params.reviewEvidenceId);
    const sprinklerReviewEvidenceId = Number(req.params.sprinklerReviewEvidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    if (!Number.isSafeInteger(reviewEvidenceId) || reviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer review evidence id is required' });
    }
    if (!Number.isSafeInteger(sprinklerReviewEvidenceId) || sprinklerReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 sprinkler review decision evidence id is required' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const reviewEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_consumer_review'`)
      .get(reviewEvidenceId, projectName);
    const review = openClawSam31ConsumerReviewFromEvidence(reviewEvidence);
    if (!reviewEvidence || !review) {
      return res.status(404).json({ error: 'SAM31 consumer review evidence not found' });
    }
    const sprinklerReviewEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'halofire_sam31_sprinkler_review_decision'`)
      .get(sprinklerReviewEvidenceId, projectName);
    const sprinklerReview = halofireSam31SprinklerReviewDecisionFromEvidence(sprinklerReviewEvidence);
    if (!sprinklerReviewEvidence || !sprinklerReview) {
      return res.status(404).json({ error: 'HaloFire SAM31 sprinkler review decision evidence not found' });
    }
    const followup = normalizeHalofireSam31SprinklerPreliminaryReplayFollowupDecision(
      projectName,
      evidence,
      decision,
      reviewEvidence,
      review,
      sprinklerReviewEvidence,
      sprinklerReview,
      req.body,
      req.user,
    );
    const notes = {
      kind: 'halofire_sam31_sprinkler_preliminary_replay_followup_decision',
      followup,
      blocked_claims: followup.blocked_claims,
      claim_gate_effect: followup.claim_gate_effect,
      limitations: followup.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'halofire_sam31_sprinkler_preliminary_replay_followup_decision',
        evidence.source_file || decision.sourceFile || null,
        followup.review_ref,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'HaloFire SAM31 preliminary replay follow-up recorded; claims still blocked',
      evidence: evidenceRow,
      ...followup,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/sprinkler-review/:reviewEvidenceId', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const reviewEvidenceId = Number(req.params.reviewEvidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    if (!Number.isSafeInteger(reviewEvidenceId) || reviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer review evidence id is required' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const reviewEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_consumer_review'`)
      .get(reviewEvidenceId, projectName);
    const review = openClawSam31ConsumerReviewFromEvidence(reviewEvidence);
    if (!reviewEvidence || !review) {
      return res.status(404).json({ error: 'SAM31 consumer review evidence not found' });
    }
    const reviewPacket = normalizeHalofireSam31SprinklerReviewDecision(projectName, evidence, decision, reviewEvidence, review, req.body, req.user);
    const notes = {
      kind: 'halofire_sam31_sprinkler_review_decision',
      review: reviewPacket,
      blocked_claims: reviewPacket.blocked_claims,
      claim_gate_effect: reviewPacket.claim_gate_effect,
      limitations: reviewPacket.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'halofire_sam31_sprinkler_review_decision',
        evidence.source_file || decision.sourceFile || null,
        reviewPacket.review_ref,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'HaloFire SAM31 sprinkler review decision recorded; claims still blocked',
      evidence: evidenceRow,
      ...reviewPacket,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
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

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/sam31-replacements', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    const sourceSam31EvidenceId = Number(req.body?.source_sam31_evidence_id);
    if (!Number.isSafeInteger(sourceSam31EvidenceId) || sourceSam31EvidenceId <= 0) {
      return res.status(400).json({ error: 'source_sam31_evidence_id is required for SAM 3.1 employee replacement evidence' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    const sam31Evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'sam31_room_boundary_visual_audit'`)
      .get(sourceSam31EvidenceId, projectName);
    const sam31Result = sam31VisualAuditResultFromEvidence(sam31Evidence);
    const replacementPacket = normalizeSam31EmployeeReplacement(projectName, evidence, decision, sam31Evidence, sam31Result, req.body, req.user);
    const notes = {
      kind: 'sam31_employee_replacement',
      replacement: replacementPacket,
      blocked_claims: replacementPacket.blocked_claims,
      claim_gate_effect: replacementPacket.claim_gate_effect,
      limitations: replacementPacket.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'sam31_employee_replacement',
        replacementPacket.source_file,
        `pdf-boundary:${evidence.id}:sam31-replacement:${sam31Evidence.id}`,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      id: result.lastInsertRowid,
      message: 'SAM 3.1 employee replacement values recorded; claims still blocked',
      evidence: evidenceRow,
      replacement: replacementPacket,
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
    const sam31ReplacementEvidence = evidence ? latestSam31EmployeeReplacementEvidence(projectName, evidence.id) : null;
    const sam31ExtrapolationEvidence = evidence ? latestOpenClawSam31ExtrapolationArtifactEvidence(projectName, evidence.id) : null;
    const sam31ExtrapolationReviewEvidence = evidence ? latestOpenClawSam31ExtrapolationReviewEvidence(projectName, evidence.id) : null;
    const packet = pdfBoundaryReplayInputPacket(projectName, evidence, decision, reviewEvidence, sam31Evidence, sam31ReplacementEvidence, sam31ExtrapolationEvidence, sam31ExtrapolationReviewEvidence);
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
    const replayEvidenceToken = replayInput?.source_sam31_replacement_evidence_id
      || replayInput?.source_sam31_evidence_id
      || replayInput?.source_review_evidence_id;
    const replayEvidenceKind = replayInput?.source_sam31_replacement_evidence_id
      ? 'sam31-employee-replacement-replay'
      : (replayInput?.room_boundary_source === 'latest_sam31_visual_audit'
        ? 'sam31-room-boundary-replay'
        : 'room-boundary-replay');
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
        source_sam31_replacement_evidence_id: replayInput.source_sam31_replacement_evidence_id,
        sam31_replacement_source: replayInput.sam31_replacement_source,
        sam31_employee_replacement: replayInput.sam31_employee_replacement || null,
        source_openclaw_sam31_extrapolation_evidence_id: replayInput.source_openclaw_sam31_extrapolation_evidence_id,
        source_openclaw_sam31_extrapolation_review_evidence_id: replayInput.source_openclaw_sam31_extrapolation_review_evidence_id,
        openclaw_sam31_extrapolation_product_review_packet: replayInput.openclaw_sam31_extrapolation_product_review_packet || null,
        sam31_downstream_review_metadata: replayInput.sam31_downstream_review_metadata || null,
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
          replayInput.source_sam31_replacement_evidence_id
            ? 'Generated from employee replacement payload over SAM 3.1 visual-audit correction evidence for internal-alpha replay only.'
            : replayInput.room_boundary_source === 'latest_sam31_visual_audit'
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
