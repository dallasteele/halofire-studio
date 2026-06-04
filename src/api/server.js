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
import { generateSprinklerBid, buildEsfrSystemScope, priceBid, polygonArea } from '../engine/sprinkler-layout.js';
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
import { buildSuppliedDocumentBidTruthStatus } from '../data/supplied-document-bid-truth.js';
import { buildPlanSegmentationPayload } from '../components/sam-floorplan.js';
import {
  SAM31_FLOORPLAN_TOOL,
  buildSam31ExtrapolationArtifact,
  sam31SectioningPipelineContract,
  sam31ToolDescriptorBody,
} from '../sam31/bridge.js';
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
  ensureColumn('claim_gates', 'resolved_evidence_id', 'INTEGER');

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
const EVIDENCE_INSERT_FIELDS = new Set(['evidence_type', 'source_file', 'source_ref', 'status', 'notes', 'signoff', 'target_gate_code']);

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
      && (parsed.kind === 'signed_reviewer_evidence' || parsed.kind === 'halofire_sam31_approval_upload_validation_decision')
      && parsed.signoff
      && parsed.signoff.reviewer_name
      && parsed.signoff.reviewer_title
      && parsed.signoff.signed_at,
    );
  } catch {
    return false;
  }
}

function parseStructuredSignedReviewerNotes(row) {
  if (!hasStructuredSignedReviewerNotes(row)) return null;
  try {
    return JSON.parse(row.notes);
  } catch {
    return null;
  }
}

function buildSignedReviewerEvidenceNotes(
  projectName,
  evidenceType,
  sourceRef,
  notes,
  signoff,
  targetGateCode = null,
  options = {},
) {
  const normalizedGateCode = String(targetGateCode || '').trim().toUpperCase() || null;
  const claimGateEffect = String(options.claimGateEffect || 'no_claims_cleared');
  let gatePacket = null;
  if (normalizedGateCode) {
    const rule = gateEvidenceRule(normalizedGateCode);
    if (!rule.allowedEvidenceTypes.includes(evidenceType)) {
      const e = new Error(`Gate ${normalizedGateCode} only accepts allowed evidence types: ${rule.allowedEvidenceTypes.join(', ')}`);
      e.httpStatus = 400;
      throw e;
    }
    gatePacket = buildClaimGateReviewPacket(projectName, normalizedGateCode);
  }
  return JSON.stringify({
    kind: 'signed_reviewer_evidence',
    evidence_type: evidenceType,
    source_ref: sourceRef,
    signoff,
    ...(gatePacket ? {
      target_gate_code: normalizedGateCode,
      required_evidence_type: gatePacket.required_evidence_type || evidenceType,
      review_packet_href: gatePacket.review_packet_href,
      review_packet_artifact_type: gatePacket.review_packet_artifact_type,
      ...(claimGateEffect === 'gate_cleared' ? {
        resolve_audit_packet_href: claimGateResolveAuditPacketHref(projectName, normalizedGateCode),
        resolve_audit_packet_artifact_type: 'halofire.claim_gate_resolve_audit_packet.v1',
      } : {}),
    } : {}),
    user_notes: notes,
    claim_gate_effect: claimGateEffect,
  });
}

function buildClaimGateReviewPacket(projectName, gateCode) {
  ensureProjectClaimGates(projectName);
  const gate = db
    .prepare('SELECT * FROM claim_gates WHERE project_name = ? AND code = ?')
    .get(projectName, gateCode);
  if (!gate) {
    const e = new Error('Claim gate not found');
    e.httpStatus = 404;
    throw e;
  }
  const rule = gateEvidenceRule(gateCode);
  const allowedEvidenceTypes = [...rule.allowedEvidenceTypes];
  const signedTypes = allowedEvidenceTypes.filter((type) => SIGNED_REVIEW_EVIDENCE_TYPES.has(type));
  const matchingEvidence = allowedEvidenceTypes.length
    ? db.prepare(
      `SELECT * FROM project_evidence
       WHERE project_name = ?
         AND evidence_type IN (${allowedEvidenceTypes.map(() => '?').join(', ')})
       ORDER BY created_at DESC, id DESC`,
    ).all(projectName, ...allowedEvidenceTypes)
    : [];
  const reviewPacketHref = `/api/projects/${encodeURIComponent(projectName)}/claim-gates/${encodeURIComponent(gateCode)}/review-packet`;
  const requiresStructuredSignoff = signedTypes.length > 0;
  return {
    artifact_type: 'halofire.claim_gate_review_packet.v1',
    status: 'ready_for_review',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    download_name: `${slugForDownloadName(projectName)}-${String(gateCode || 'claim-gate').toLowerCase()}-review-packet.json`,
    blocked_claims: safeParseJsonArray(gate.blocked_claims),
    claim_gate: {
      code: gate.code,
      status: gate.status,
      severity: gate.severity,
      missing_artifact: gate.missing_artifact,
      acceptable_evidence: gate.acceptable_evidence,
      blocked_claims: safeParseJsonArray(gate.blocked_claims),
      next_action: gate.next_action,
      resolved_by: gate.resolved_by || null,
      resolved_at: gate.resolved_at || null,
      resolved_evidence_ref: gate.resolved_evidence_ref || null,
    },
    allowed_evidence_types: allowedEvidenceTypes,
    required_evidence_type: allowedEvidenceTypes.length === 1 ? allowedEvidenceTypes[0] : null,
    review_packet_href: reviewPacketHref,
    review_packet_artifact_type: 'halofire.claim_gate_review_packet.v1',
    record_evidence_route: `/api/projects/${encodeURIComponent(projectName)}/evidence`,
    resolve_route: `/api/projects/${encodeURIComponent(projectName)}/claim-gates/${encodeURIComponent(gateCode)}/resolve`,
    required_review_fields: ['source_ref', 'notes'],
    required_signoff_fields: requiresStructuredSignoff ? ['reviewer_name', 'reviewer_title', 'signed_at'] : [],
    optional_signoff_fields: requiresStructuredSignoff ? ['organization', 'license_id'] : [],
    requires_signoff_for: signedTypes,
    matching_evidence_count: matchingEvidence.length,
    matching_evidence: matchingEvidence.slice(0, 5).map((row) => hydrateSignedReviewerEvidenceRow(row, {
      projectName,
      targetGateCode: gateCode,
    })),
    claim_gate_effect: 'no_claims_cleared',
    use_for_claims: false,
    no_claim_gates_cleared: true,
    limitations: [
      'This packet organizes the exact signed reviewer lane for one claim gate.',
      'Downloading or reading this packet does not clear any AHJ, professional, manufacturer, AutoSprink, permit-ready, fabrication-ready, or engineering-grade claim.',
    ],
  };
}

function hydrateSignedReviewerEvidenceRow(row, options = {}) {
  if (!hasStructuredSignedReviewerNotes(row)) return row;
  const parsedNotes = parseStructuredSignedReviewerNotes(row);
  if (!parsedNotes) return row;
  const targetGateCode = String(options.targetGateCode || parsedNotes.target_gate_code || '').trim().toUpperCase() || null;
  const projectName = options.projectName || row.project_name || null;
  const reviewPacketHref = parsedNotes.review_packet_href
    || (projectName && targetGateCode ? `/api/projects/${encodeURIComponent(projectName)}/claim-gates/${encodeURIComponent(targetGateCode)}/review-packet` : null);
  const resolveAuditPacketHref = parsedNotes.resolve_audit_packet_href
    || (projectName && targetGateCode && parsedNotes.claim_gate_effect === 'gate_cleared'
      ? claimGateResolveAuditPacketHref(projectName, targetGateCode)
      : null);
  return {
    ...row,
    signoff: parsedNotes.signoff || null,
    target_gate_code: targetGateCode,
    required_evidence_type: parsedNotes.required_evidence_type || parsedNotes.evidence_type || row.evidence_type,
    review_packet_href: reviewPacketHref,
    review_packet_artifact_type: parsedNotes.review_packet_artifact_type || (reviewPacketHref ? 'halofire.claim_gate_review_packet.v1' : null),
    resolve_audit_packet_href: resolveAuditPacketHref,
    resolve_audit_packet_artifact_type: parsedNotes.resolve_audit_packet_artifact_type || null,
    claim_gate_effect: parsedNotes.claim_gate_effect || null,
    user_notes: parsedNotes.user_notes || null,
  };
}

function claimGateResolveAuditPacketHref(projectName, gateCode) {
  return `/api/projects/${encodeURIComponent(projectName)}/claim-gates/${encodeURIComponent(gateCode)}/resolve-audit-packet`;
}

function claimGateResolveAuditPacketAction(projectName, gateCode) {
  return {
    artifact_type: 'halofire.claim_gate_resolve_audit_packet.v1',
    href: claimGateResolveAuditPacketHref(projectName, gateCode),
    download_name: `${slugForDownloadName(projectName)}-${String(gateCode || 'claim-gate').toLowerCase()}-resolve-audit-packet.json`,
  };
}

function buildClaimGateResolveAuditPacket(projectName, gateCode) {
  ensureProjectClaimGates(projectName);
  const gate = db
    .prepare('SELECT * FROM claim_gates WHERE project_name = ? AND code = ?')
    .get(projectName, gateCode);
  if (!gate) {
    const e = new Error('Claim gate not found');
    e.httpStatus = 404;
    throw e;
  }
  if (gate.status !== 'cleared') {
    const e = new Error('Claim gate has not been resolved yet');
    e.httpStatus = 404;
    throw e;
  }
  const resolvedEvidenceId = Number(gate.resolved_evidence_id || 0) || null;
  const evidence = resolvedEvidenceId
    ? db.prepare('SELECT * FROM project_evidence WHERE project_name = ? AND id = ?').get(projectName, resolvedEvidenceId)
    : db.prepare(`SELECT * FROM project_evidence
                  WHERE project_name = ? AND source_ref = ?
                  ORDER BY created_at DESC, id DESC`)
      .get(projectName, gate.resolved_evidence_ref || '');
  if (!evidence) {
    const e = new Error('Resolved evidence row not found for this gate');
    e.httpStatus = 404;
    throw e;
  }
  const rule = gateEvidenceRule(gateCode);
  let parsedNotes = null;
  try {
    parsedNotes = evidence.notes ? JSON.parse(evidence.notes) : null;
  } catch {
    parsedNotes = null;
  }
  const requiresSignedReview = SIGNED_REVIEW_EVIDENCE_TYPES.has(evidence.evidence_type);
  const hasSignedReview = hasStructuredSignedReviewerNotes(evidence);
  const packetAction = claimGateResolveAuditPacketAction(projectName, gateCode);
  return {
    artifact_type: packetAction.artifact_type,
    status: requiresSignedReview ? 'gate_cleared_with_explicit_signed_evidence' : 'gate_cleared_with_explicit_evidence',
    project_name: projectName,
    gate_code: gate.code,
    generated_at: new Date().toISOString(),
    download_name: packetAction.download_name,
    claim_gate: {
      code: gate.code,
      status: gate.status,
      severity: gate.severity,
      missing_artifact: gate.missing_artifact,
      acceptable_evidence: gate.acceptable_evidence,
      blocked_claims: safeParseJsonArray(gate.blocked_claims),
      next_action: gate.next_action,
      resolved_by: gate.resolved_by || null,
      resolved_at: gate.resolved_at || null,
      resolved_evidence_id: evidence.id,
      resolved_evidence_ref: gate.resolved_evidence_ref || evidence.source_ref || null,
    },
    resolved_by: gate.resolved_by || null,
    resolved_at: gate.resolved_at || null,
    resolved_evidence_id: evidence.id,
    resolved_evidence_ref: gate.resolved_evidence_ref || evidence.source_ref || null,
    resolved_evidence: {
      id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_file: evidence.source_file,
      source_ref: evidence.source_ref,
      status: evidence.status,
      created_at: evidence.created_at,
      has_signed_reviewer_metadata: hasSignedReview,
      signoff: parsedNotes?.signoff || null,
    },
    validation_steps: [
      {
        code: 'GATE_ALLOWED_EVIDENCE_TYPE_CONFIRMED',
        status: rule.allowedEvidenceTypes.includes(evidence.evidence_type) ? 'passed' : 'failed',
        evidence_type: evidence.evidence_type,
        allowed_evidence_types: [...rule.allowedEvidenceTypes],
      },
      {
        code: 'EVIDENCE_STATUS_PRESENT_CONFIRMED',
        status: evidence.status === 'present' ? 'passed' : 'failed',
        evidence_status: evidence.status,
      },
      {
        code: 'SIGNED_REVIEWER_METADATA_CONFIRMED',
        status: requiresSignedReview ? (hasSignedReview ? 'passed' : 'failed') : 'not_required',
        required: requiresSignedReview,
      },
    ],
    source_refs: [
      {
        evidence_id: evidence.id,
        evidence_type: evidence.evidence_type,
        source_file: evidence.source_file,
        source_ref: evidence.source_ref,
      },
    ],
    claim_gate_effect: 'gate_cleared_after_explicit_signed_validation',
    no_unrelated_claims_cleared: true,
    limitations: [
      'This packet proves only the explicit claim gate listed here was resolved.',
      'It does not clear unrelated professional, AHJ, manufacturer, AutoSprink, permit-ready, fabrication-ready, or engineering-grade claims.',
      'If the evidence is later found invalid, the gate must be re-blocked with a new audit record.',
    ],
  };
}

const DEFAULT_PROJECT_CLAIM_GATES = Object.freeze([
  Object.freeze({
    code: 'AUTOSPRINK_EVIDENCE_MISSING',
    severity: 'blocking',
    missing_artifact: 'AutoSprink model/export evidence',
    acceptable_evidence: 'An AutoSprink file, export, report, or signed comparison packet tied to this bid.',
    blocked_claims: ['AutoSprink parity', 'design export ready', 'fabrication-ready layout'],
    next_action: 'Attach the actual AutoSprink evidence packet or keep AutoSprink parity and fabrication-ready claims blocked.',
  }),
  Object.freeze({
    code: 'AHJ_APPROVAL_MISSING',
    severity: 'blocking',
    missing_artifact: 'AHJ approval record',
    acceptable_evidence: 'AHJ approval document, email, stamp, or review record for this bid.',
    blocked_claims: ['AHJ-approved', 'permit-ready', 'approved for submission'],
    next_action: 'Record the AHJ approval artifact before showing any AHJ-approved or permit-ready status.',
  }),
  Object.freeze({
    code: 'PROFESSIONAL_REVIEW_MISSING',
    severity: 'blocking',
    missing_artifact: 'Licensed professional review/signoff',
    acceptable_evidence: 'Named licensed professional review, PE signoff, or employee approval record for this bid package.',
    blocked_claims: ['professionally reviewed', 'engineering-grade', 'PE-approved'],
    next_action: 'Attach a named professional review/signoff before claiming the package is professionally reviewed or engineering-grade.',
  }),
  Object.freeze({
    code: 'MANUFACTURER_MODEL_APPROVAL_MISSING',
    severity: 'blocking',
    missing_artifact: 'Manufacturer model approval evidence',
    acceptable_evidence: 'Manufacturer submittal, compatibility approval, or model approval artifact tied to selected materials.',
    blocked_claims: ['manufacturer-approved model', 'manufacturer-approved materials', 'submittal-ready selections'],
    next_action: 'Attach manufacturer approval evidence before claiming selected models or materials are manufacturer-approved.',
  }),
]);

function ensureProjectClaimGates(projectName) {
  const existingCount = db
    .prepare('SELECT COUNT(*) AS c FROM claim_gates WHERE project_name = ?')
    .get(projectName)?.c || 0;
  if (existingCount > 0) return;
  const insertGate = db.prepare(
    `INSERT INTO claim_gates
      (project_name, code, severity, missing_artifact, acceptable_evidence, blocked_claims, next_action, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'blocked')`,
  );
  for (const gate of DEFAULT_PROJECT_CLAIM_GATES) {
    insertGate.run(
      projectName,
      gate.code,
      gate.severity,
      gate.missing_artifact,
      gate.acceptable_evidence,
      JSON.stringify(gate.blocked_claims),
      gate.next_action,
    );
  }
}

app.get('/api/projects/:name/claim-gates', authMiddleware, (req, res) => {
  const projectName = req.params.name;
  ensureProjectClaimGates(projectName);
  const gates = db
    .prepare('SELECT * FROM claim_gates WHERE project_name = ? ORDER BY severity DESC, code')
    .all(projectName);
  res.json(gates.map((gate) => {
    const rule = gateEvidenceRule(gate.code);
    const requiresSignoffFor = rule.allowedEvidenceTypes.filter((type) => SIGNED_REVIEW_EVIDENCE_TYPES.has(type));
    return {
      ...gate,
      blocked_claims: safeParseJsonArray(gate.blocked_claims),
      allowed_evidence_types: [...rule.allowedEvidenceTypes],
      requires_signoff_for: requiresSignoffFor,
      can_resolve: rule.canResolve,
      review_packet_href: `/api/projects/${encodeURIComponent(projectName)}/claim-gates/${encodeURIComponent(gate.code)}/review-packet`,
      review_packet_artifact_type: 'halofire.claim_gate_review_packet.v1',
    };
  }));
});

app.get('/api/projects/:name/evidence-wizard', authMiddleware, (req, res) => {
  const projectName = req.params.name;
  ensureProjectClaimGates(projectName);
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
  const canExistingEvidenceClearGate = (rule, row) => {
    if (!row || !rule.allowedEvidenceTypes.includes(row.evidence_type)) return false;
    if (!GATE_CLEARING_EVIDENCE_TYPES.has(row.evidence_type)) return false;
    if (String(row.status) !== 'present') return false;
    if (SIGNED_REVIEW_EVIDENCE_TYPES.has(row.evidence_type) && !hasStructuredSignedReviewerNotes(row)) return false;
    return true;
  };
  const gateRows = gates.map((gate) => {
    const rule = gateEvidenceRule(gate.code);
    const matchingEvidence = rule.allowedEvidenceTypes
      .flatMap((type) => evidenceByType.get(type) || [])
      .filter((row) => canExistingEvidenceClearGate(rule, row));
    const requiresSignoffFor = rule.allowedEvidenceTypes.filter((type) => SIGNED_REVIEW_EVIDENCE_TYPES.has(type));
    const reviewPacketHref = `/api/projects/${encodeURIComponent(projectName)}/claim-gates/${encodeURIComponent(gate.code)}/review-packet`;
    return {
      ...gate,
      blocked_claims: safeParseJsonArray(gate.blocked_claims),
      allowed_evidence_types: [...rule.allowedEvidenceTypes],
      requires_signoff_for: requiresSignoffFor,
      can_resolve: rule.canResolve,
      review_packet_href: reviewPacketHref,
      review_packet_artifact_type: 'halofire.claim_gate_review_packet.v1',
      matching_evidence_count: matchingEvidence.length,
      matching_evidence: matchingEvidence.slice(0, 5).map((row) => hydrateSignedReviewerEvidenceRow(row, {
        projectName,
        targetGateCode: gate.code,
      })),
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

app.get('/api/projects/:name/claim-gates/:code/review-packet', authMiddleware, (req, res) => {
  try {
    return res.json(buildClaimGateReviewPacket(req.params.name, req.params.code));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/claim-gates/:code/resolve-audit-packet', authMiddleware, (req, res) => {
  try {
    return res.json(buildClaimGateResolveAuditPacket(req.params.name, req.params.code));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/evidence', authMiddleware, (req, res) => {
  const projectName = req.params.name;
  const evidence = db
    .prepare('SELECT * FROM project_evidence WHERE project_name = ? ORDER BY created_at DESC, id DESC')
    .all(projectName);
  res.json(evidence.map((row) => {
    const hydratedRow = hydrateSignedReviewerEvidenceRow(row, { projectName });
    if (row.evidence_type !== 'pdf_boundary_decision') return hydratedRow;
    const decision = decisionFromEvidence(row);
    const employeeDecision = decision?.employeeDecision && typeof decision.employeeDecision === 'object'
      ? jsonClone(decision.employeeDecision)
      : null;
    return {
      ...hydratedRow,
      decision: decision ? jsonClone(decision) : null,
      employee_decision: employeeDecision,
      selected_sheet_ref: employeeDecision?.selected_sheet_ref || null,
      selected_scale_ref: employeeDecision?.selected_scale_ref || null,
      selected_boundary_candidate_ref: employeeDecision?.selected_boundary_candidate_ref || null,
      source_refs: Array.isArray(employeeDecision?.source_refs) ? [...employeeDecision.source_refs] : [],
    };
  }));
});

const COOPERATIVE_1881_PROPOSAL_FILE = 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx';
const COOPERATIVE_1881_ACTUAL_VALUE_FALLBACK_SOURCE_REFS = [
  `${COOPERATIVE_1881_PROPOSAL_FILE}#Building (1)!G6`,
  `${COOPERATIVE_1881_PROPOSAL_FILE}#Building (1)!B9`,
  `${COOPERATIVE_1881_PROPOSAL_FILE}#Building (1)!G11`,
];

function cooperative1881ActualValueSourceRefs() {
  try {
    const bidPackage = readCooperative1881BidPackage();
    const realTakeoff = readCooperative1881RealTakeoff();
    return uniqueStrings([
      ...(Array.isArray(bidPackage.sourceRefs) ? bidPackage.sourceRefs : []),
      ...(Array.isArray(realTakeoff.sourceRefs) ? realTakeoff.sourceRefs : []),
      ...COOPERATIVE_1881_ACTUAL_VALUE_FALLBACK_SOURCE_REFS,
    ]);
  } catch (err) {
    log.warn?.(`Cooperative 1881 actual-value prefill source reader failed: ${err.message}`);
    return [...COOPERATIVE_1881_ACTUAL_VALUE_FALLBACK_SOURCE_REFS];
  }
}

function buildSam31ActualValueReplacementPrefill(projectName, item, evidence) {
  const isCooperative1881 = projectName === COOPERATIVE_1881_PROJECT_NAME;
  const suppliedSourceRefs = isCooperative1881 ? cooperative1881ActualValueSourceRefs() : [];
  const sourceRefs = uniqueStrings([
    ...suppliedSourceRefs,
    item.replacement_values_source_ref,
    item.replacement_ref,
    item.persisted_review_packet_ref,
    evidence?.source_ref,
  ].filter(Boolean));
  const preferred1881Ref = sourceRefs.find((ref) => String(ref).includes('#Building (1)!G6')) || sourceRefs[0] || null;
  const sourceRef = (isCooperative1881 ? preferred1881Ref : null) || item.replacement_values_source_ref || item.replacement_ref || evidence?.source_ref || null;
  const sourceFile = isCooperative1881
    ? COOPERATIVE_1881_PROPOSAL_FILE
    : (evidence?.source_file || item.source_file || null);
  return {
    artifact_type: 'halofire.sam31_actual_value_replacement_prefill.v1',
    status: isCooperative1881 ? 'prefill_from_supplied_1881_source_refs' : 'prefill_from_review_values',
    source_file: sourceFile,
    source_ref: sourceRef,
    replacement_values_source_ref: (isCooperative1881 ? sourceRef : null) || item.replacement_values_source_ref || sourceRef,
    source_refs: sourceRefs,
    acceptable_actual_evidence: Array.isArray(item.acceptable_actual_evidence) ? item.acceptable_actual_evidence : [],
    notes_template: 'Record the exact workbook/sheet, reviewed vector overlay, reviewed 3D model candidate, screenshot, or console evidence that replaces this SAM31 best guess.',
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function buildOpenClawSam31ActualValueWorkItemIndex(projectName) {
  const reviews = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'openclaw_sam31_consumer_review'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName)
    .map((evidence) => ({ evidence, review: openClawSam31ConsumerReviewFromEvidence(evidence) }))
    .filter((item) => item.review);
  const acceptableActualEvidence = [
    '1881 proposal workbook row or sheet reference',
    'reviewed vector overlay SVG or marked-up plan ref',
    'reviewed 3D model candidate ref or model note',
    'screenshot or console evidence for the reviewed SAM31 section',
  ];
  const arrayItemIds = (items) => uniqueStrings((Array.isArray(items) ? items : []).map((item) => (
    item && typeof item === 'object' ? item.id : null
  )));
  const deriveSourceLlmObservationIds = (replacementValues) => {
    const sourceLinkedRows = [
      ...(Array.isArray(replacementValues.object_hypotheses) ? replacementValues.object_hypotheses : []),
      ...(Array.isArray(replacementValues.vector_overlays) ? replacementValues.vector_overlays : []),
      ...(Array.isArray(replacementValues.model_3d_candidates) ? replacementValues.model_3d_candidates : []),
    ];
    return uniqueStrings([
      ...arrayItemIds(replacementValues.llm_observations),
      ...sourceLinkedRows.flatMap((row) => (
        row && typeof row === 'object' && Array.isArray(row.source_llm_observation_ids)
          ? row.source_llm_observation_ids
          : []
      )),
    ]);
  };
  const items = reviews.map(({ evidence, review }) => {
    const replacementValues = review.replacement_values && typeof review.replacement_values === 'object' && !Array.isArray(review.replacement_values)
      ? review.replacement_values
      : {};
    const countArray = (key) => (Array.isArray(replacementValues[key]) ? replacementValues[key].length : 0);
    const llmObservationIds = arrayItemIds(replacementValues.llm_observations);
    const sourceLlmObservationIds = deriveSourceLlmObservationIds(replacementValues);
    const sourcePdfBoundaryEvidenceId = Number(review.source_pdf_boundary_evidence_id);
    const item = {
      artifact_type: 'openclaw.sam31.actual_value_work_item_packet.v1',
      status: 'requires_employee_actual_value_update',
      consumer: review.consumer || 'consumer',
      source_application: review.source_application || 'halo_fire',
      source_pdf_boundary_evidence_id: Number.isSafeInteger(sourcePdfBoundaryEvidenceId) ? sourcePdfBoundaryEvidenceId : null,
      source_openclaw_sam31_consumer_review_evidence_id: evidence.id,
      source_openclaw_sam31_consumer_smoke_evidence_id: review.source_openclaw_sam31_consumer_smoke_evidence_id || null,
      accepted_queue_id: review.accepted_queue_id || null,
      persisted_review_packet_ref: review.persisted_review_packet_ref || null,
      replacement_ref: review.replacement_ref || evidence.source_ref || null,
      replacement_values_source_ref: replacementValues.source_ref || review.replacement_ref || evidence.source_ref || null,
      llm_observation_count: llmObservationIds.length,
      llm_observation_ids: llmObservationIds,
      source_llm_observation_ids: sourceLlmObservationIds,
      replacement_summary: {
        semantic_label_count: countArray('semantic_labels'),
        object_hypothesis_count: countArray('object_hypotheses'),
        llm_observation_count: countArray('llm_observations'),
        vector_overlay_count: countArray('vector_overlays'),
        model_3d_candidate_count: countArray('model_3d_candidates'),
      },
      employee_actual_value_next_action: 'Replace SAM31 best guesses with actual HaloFire documentation values before using these observations in bid/export decisions.',
      acceptable_actual_evidence: acceptableActualEvidence,
      evidence_record_type: 'sam31_actual_value_replacement',
      evidence_record_next_action: 'Record the workbook/sheet, marked-up vector overlay, reviewed 3D model candidate, or screenshot evidence that replaces this SAM31 best guess.',
      download_href: Number.isSafeInteger(sourcePdfBoundaryEvidenceId) && sourcePdfBoundaryEvidenceId > 0
        ? `/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${sourcePdfBoundaryEvidenceId}/openclaw/sam31/consumer-review/${evidence.id}/actual-value-work-item`
        : null,
      use_for_claims: false,
      blocked_claims: uniqueStrings([
        ...(Array.isArray(review.blocked_claims) ? review.blocked_claims : []),
        'permit_ready',
        'fabrication_ready',
        'AHJ_approval',
        'professional_approval',
        'manufacturer_exact',
        'AutoSprink_parity',
      ]),
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    };
    item.actual_value_replacement_prefill = buildSam31ActualValueReplacementPrefill(projectName, item, evidence);
    return item;
  });
  return {
    artifact_type: 'halofire.sam31_actual_value_work_item_index.v1',
    status: items.length ? 'requires_employee_actual_value_update' : 'no_sam31_actual_value_work_items',
    project_name: projectName,
    item_count: items.length,
    generated_at: new Date().toISOString(),
    items,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

app.get('/api/projects/:name/openclaw/sam31/actual-value-work-items', authMiddleware, (req, res) => {
  res.json(buildOpenClawSam31ActualValueWorkItemIndex(req.params.name));
});

app.get('/api/projects/:name/openclaw/sam31/actual-value-service', authMiddleware, (req, res) => {
  res.json(buildOpenClawSam31ActualValueServiceDescriptor(req.params.name, {
    consumer: req.query?.consumer,
  }));
});

function sam31ActualValueReplacementFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'sam31ActualValueReplacement'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function sam31ActualValueServiceDescriptorPrefillContext(serviceDescriptorEvidence = null, serviceDescriptorAction = null) {
  const evidenceId = serviceDescriptorEvidence?.evidence_id
    || serviceDescriptorAction?.source_openclaw_sam31_actual_value_service_descriptor_evidence_id
    || null;
  if (!evidenceId && !serviceDescriptorAction) return {};
  return {
    source_openclaw_sam31_actual_value_service_descriptor_evidence_id: evidenceId,
    source_actual_value_service_descriptor_ref: serviceDescriptorEvidence?.source_ref || serviceDescriptorAction?.evidence_source_ref || null,
    source_actual_value_service_descriptor_file: serviceDescriptorEvidence?.source_file || serviceDescriptorAction?.evidence_source_file || null,
    actual_value_service_descriptor_action: serviceDescriptorAction || null,
  };
}

function sam31ActualValueReplacementPrefillWithServiceDescriptor(prefill = {}, serviceDescriptorEvidence = null, serviceDescriptorAction = null) {
  const descriptorContext = sam31ActualValueServiceDescriptorPrefillContext(serviceDescriptorEvidence, serviceDescriptorAction);
  if (!descriptorContext.source_openclaw_sam31_actual_value_service_descriptor_evidence_id && !descriptorContext.actual_value_service_descriptor_action) {
    return prefill || {};
  }
  return {
    ...(prefill || {}),
    ...descriptorContext,
    source_refs: uniqueStrings([
      ...(Array.isArray(prefill?.source_refs) ? prefill.source_refs : []),
      descriptorContext.source_actual_value_service_descriptor_ref,
      descriptorContext.source_actual_value_service_descriptor_file,
      descriptorContext.actual_value_service_descriptor_action?.href,
    ].filter(Boolean)),
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function latestSam31ActualValueReplacementEvidenceByReview(projectName) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'sam31_actual_value_replacement'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  const latestByReviewEvidenceId = new Map();
  for (const row of rows) {
    const replacement = sam31ActualValueReplacementFromEvidence(row);
    const reviewEvidenceId = Number(replacement?.source_openclaw_sam31_consumer_review_evidence_id);
    if (!Number.isSafeInteger(reviewEvidenceId) || reviewEvidenceId <= 0) continue;
    if (latestByReviewEvidenceId.has(reviewEvidenceId)) continue;
    latestByReviewEvidenceId.set(reviewEvidenceId, {
      evidence_id: row.id,
      evidence_type: row.evidence_type,
      evidence_status: row.status,
      source_ref: row.source_ref,
      source_file: replacement.source_file || row.source_file,
      artifact_type: replacement.artifact_type || 'halofire.sam31_actual_value_replacement_evidence_note.v1',
      source_pdf_boundary_evidence_id: replacement.source_pdf_boundary_evidence_id || null,
      source_openclaw_sam31_consumer_review_evidence_id: reviewEvidenceId,
      source_openclaw_sam31_consumer_smoke_evidence_id: replacement.source_openclaw_sam31_consumer_smoke_evidence_id || null,
      consumer: replacement.consumer || null,
      replacement_values_source_ref: replacement.replacement_values_source_ref || row.source_ref || null,
      replacement_values: replacement.replacement_values || {},
      openclaw_sam31_section_to_artifacts: replacement.openclaw_sam31_section_to_artifacts || null,
      openclaw_sam31_section_to_artifacts_summary: replacement.openclaw_sam31_section_to_artifacts_summary || null,
      source_refs: uniqueStrings([
        ...(Array.isArray(replacement.source_refs) ? replacement.source_refs : []),
        ...(Array.isArray(replacement.actual_value_replacement_prefill?.source_refs) ? replacement.actual_value_replacement_prefill.source_refs : []),
        replacement.source_ref,
        replacement.replacement_values_source_ref,
        replacement.source_actual_value_service_descriptor_ref,
        replacement.source_actual_value_service_descriptor_file,
        replacement.actual_value_service_descriptor_action?.href,
        row.source_ref,
      ].filter(Boolean)),
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: replacement.source_openclaw_sam31_actual_value_service_descriptor_evidence_id
        || replacement.actual_value_replacement_prefill?.source_openclaw_sam31_actual_value_service_descriptor_evidence_id
        || null,
      source_actual_value_service_descriptor_ref: replacement.source_actual_value_service_descriptor_ref
        || replacement.actual_value_replacement_prefill?.source_actual_value_service_descriptor_ref
        || null,
      source_actual_value_service_descriptor_file: replacement.source_actual_value_service_descriptor_file
        || replacement.actual_value_replacement_prefill?.source_actual_value_service_descriptor_file
        || null,
      actual_value_service_descriptor_action: replacement.actual_value_service_descriptor_action
        || replacement.actual_value_replacement_prefill?.actual_value_service_descriptor_action
        || null,
      actual_value_replacement_prefill: replacement.actual_value_replacement_prefill || null,
      acceptable_actual_evidence: Array.isArray(replacement.acceptable_actual_evidence) ? replacement.acceptable_actual_evidence : [],
      llm_observation_count: Number(replacement.llm_observation_count || replacement.replacement_summary?.llm_observation_count || 0) || 0,
      llm_observation_ids: Array.isArray(replacement.llm_observation_ids) ? replacement.llm_observation_ids : [],
      source_llm_observation_ids: Array.isArray(replacement.source_llm_observation_ids) ? replacement.source_llm_observation_ids : [],
      use_for_claims: false,
      claim_gate_effect: replacement.claim_gate_effect || 'no_claims_cleared',
      no_claim_gates_cleared: true,
    });
  }
  return latestByReviewEvidenceId;
}

function openClawSam31ActualValueResolverContractEvidenceFromRow(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    if (!parsed || parsed.kind !== 'openclaw_sam31_actual_value_resolver_contract') return null;
    const packet = parsed.contract_packet && typeof parsed.contract_packet === 'object' && !Array.isArray(parsed.contract_packet)
      ? parsed.contract_packet
      : {};
    return {
      evidence_id: row.id,
      evidence_type: row.evidence_type,
      evidence_status: row.status,
      source_file: row.source_file || null,
      source_ref: row.source_ref || null,
      artifact_type: parsed.artifact_type || packet.artifact_type || 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
      requested_consumer: String(packet.requested_consumer || '').trim().toLowerCase() || null,
      queue_artifact_type: packet.queue_artifact_type || 'openclaw.sam31.actual_value_resolver_queue.v1',
      readback_artifact_type: packet.readback_artifact_type || 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
      supported_consumers: Array.isArray(parsed.supported_consumers) ? parsed.supported_consumers : [],
      supported_applications: Array.isArray(parsed.supported_applications) ? parsed.supported_applications : [],
      contract_packet: packet,
      use_for_claims: false,
      claim_gate_effect: parsed.claim_gate_effect || packet.claim_gate_effect || 'no_claims_cleared',
      no_claim_gates_cleared: true,
    };
  } catch {
    return null;
  }
}

function openClawSam31ActualValueResolverContractEvidenceById(projectName, evidenceId) {
  const id = Number(evidenceId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const row = db
    .prepare(`SELECT * FROM project_evidence
              WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_actual_value_resolver_contract'
              LIMIT 1`)
    .get(id, projectName);
  return openClawSam31ActualValueResolverContractEvidenceFromRow(row);
}

function latestOpenClawSam31ActualValueResolverContractEvidence(projectName, consumer = '') {
  const requestedConsumer = String(consumer || '').trim().toLowerCase();
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'openclaw_sam31_actual_value_resolver_contract'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  const candidates = rows
    .map(openClawSam31ActualValueResolverContractEvidenceFromRow)
    .filter(Boolean);
  if (!candidates.length) return null;
  if (requestedConsumer) {
    return candidates.find((row) => row.requested_consumer === requestedConsumer)
      || candidates.find((row) => row.requested_consumer === 'all-consumers' || !row.requested_consumer)
      || null;
  }
  return candidates.find((row) => row.requested_consumer === 'all-consumers' || !row.requested_consumer)
    || candidates[0]
    || null;
}

function openClawSam31ActualValueServiceDescriptorEvidenceFromRow(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    if (!parsed || parsed.kind !== 'openclaw_sam31_actual_value_service_descriptor') return null;
    const descriptor = parsed.service_descriptor && typeof parsed.service_descriptor === 'object' && !Array.isArray(parsed.service_descriptor)
      ? parsed.service_descriptor
      : {};
    const sharedContract = parsed.shared_see_label_extrapolate_contract && typeof parsed.shared_see_label_extrapolate_contract === 'object'
      ? parsed.shared_see_label_extrapolate_contract
      : (descriptor.shared_see_label_extrapolate_contract || {});
    const replacementContract = parsed.actual_value_replacement_contract && typeof parsed.actual_value_replacement_contract === 'object'
      ? parsed.actual_value_replacement_contract
      : (descriptor.actual_value_replacement_contract || {});
    return {
      evidence_id: row.id,
      evidence_type: row.evidence_type,
      evidence_status: row.status,
      source_file: row.source_file || null,
      source_ref: row.source_ref || null,
      download_name: row.source_file || 'sam31-actual-value-service-descriptor.json',
      artifact_type: parsed.artifact_type || descriptor.artifact_type || 'openclaw.sam31.actual_value_service_descriptor.v1',
      requested_consumer: String(parsed.requested_consumer || descriptor.requested_consumer || '').trim().toLowerCase() || null,
      supported_consumers: Array.isArray(parsed.supported_consumers) ? parsed.supported_consumers : (Array.isArray(descriptor.supported_consumers) ? descriptor.supported_consumers : []),
      supported_applications: Array.isArray(parsed.supported_applications) ? parsed.supported_applications : (Array.isArray(descriptor.supported_applications) ? descriptor.supported_applications : []),
      service_descriptor: descriptor,
      shared_see_label_extrapolate_contract: sharedContract,
      actual_value_replacement_contract: replacementContract,
      blocked_claims: Array.isArray(parsed.blocked_claims) ? parsed.blocked_claims : (Array.isArray(descriptor.blocked_claims) ? descriptor.blocked_claims : []),
      limitations: Array.isArray(parsed.limitations) ? parsed.limitations : (Array.isArray(descriptor.limitations) ? descriptor.limitations : []),
      use_for_claims: false,
      claim_gate_effect: parsed.claim_gate_effect || descriptor.claim_gate_effect || 'no_claims_cleared',
      no_claim_gates_cleared: true,
    };
  } catch {
    return null;
  }
}

function listOpenClawSam31ActualValueServiceDescriptorEvidence(projectName, options = {}) {
  const requestedConsumer = String(options.consumer || '').trim().toLowerCase();
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'openclaw_sam31_actual_value_service_descriptor'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  return rows
    .map(openClawSam31ActualValueServiceDescriptorEvidenceFromRow)
    .filter(Boolean)
    .filter((row) => !requestedConsumer || row.requested_consumer === requestedConsumer);
}

function openClawSam31ActualValueServiceDescriptorEvidenceById(projectName, evidenceId) {
  const id = Number(evidenceId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const row = db
    .prepare(`SELECT * FROM project_evidence
              WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_actual_value_service_descriptor'
              LIMIT 1`)
    .get(id, projectName);
  return openClawSam31ActualValueServiceDescriptorEvidenceFromRow(row);
}

function latestOpenClawSam31ActualValueServiceDescriptorEvidence(projectName, consumer = '') {
  const requestedConsumer = String(consumer || '').trim().toLowerCase();
  const candidates = listOpenClawSam31ActualValueServiceDescriptorEvidence(projectName);
  if (!candidates.length) return null;
  if (requestedConsumer) {
    return candidates.find((row) => row.requested_consumer === requestedConsumer)
      || candidates.find((row) => row.requested_consumer === 'all-consumers' || !row.requested_consumer)
      || null;
  }
  return candidates.find((row) => row.requested_consumer === 'all-consumers' || !row.requested_consumer)
    || candidates[0]
    || null;
}

function openClawSam31ActualValueReplacementReadbackEvidenceFromRow(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    if (!parsed || parsed.kind !== 'openclaw_sam31_actual_value_replacement_readback') return null;
    const readback = parsed.replacement_readback && typeof parsed.replacement_readback === 'object' && !Array.isArray(parsed.replacement_readback)
      ? parsed.replacement_readback
      : {};
    const requestedConsumer = String(parsed.requested_consumer || readback.requested_consumer || '').trim().toLowerCase() || null;
    const contractEvidenceId = Number(
      parsed.source_openclaw_sam31_actual_value_resolver_contract_evidence_id
      || readback.source_openclaw_sam31_actual_value_resolver_contract_evidence_id
      || 0,
    ) || null;
    return {
      evidence_id: row.id,
      evidence_type: row.evidence_type,
      evidence_status: row.status,
      source_file: row.source_file || null,
      source_ref: row.source_ref || null,
      download_name: row.source_file || 'sam31-actual-value-replacement-readback.json',
      artifact_type: parsed.artifact_type || readback.artifact_type || 'openclaw.sam31.actual_value_replacement_readback.v1',
      requested_consumer: requestedConsumer,
      source_queue_route: parsed.source_queue_route || readback.source_queue_route || null,
      source_claim_gate_resolve_audit_evidence_id: parsed.source_claim_gate_resolve_audit_evidence_id || null,
      source_resolved_evidence_id: parsed.source_resolved_evidence_id || null,
      source_resolved_evidence_ref: parsed.source_resolved_evidence_ref || null,
      source_resolved_evidence_type: parsed.source_resolved_evidence_type || null,
      source_claim_gate_effect: parsed.source_claim_gate_effect || null,
      no_unrelated_claims_cleared: parsed.no_unrelated_claims_cleared !== false,
      source_refs: Array.isArray(parsed.source_refs) ? parsed.source_refs : [],
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: contractEvidenceId,
      supported_consumers: Array.isArray(parsed.supported_consumers) ? parsed.supported_consumers : (Array.isArray(readback.supported_consumers) ? readback.supported_consumers : []),
      acceptable_actual_evidence: Array.isArray(parsed.acceptable_actual_evidence) ? parsed.acceptable_actual_evidence : (Array.isArray(readback.acceptable_actual_evidence) ? readback.acceptable_actual_evidence : []),
      item_count: Number(readback.item_count || 0) || 0,
      pending_count: Number(readback.pending_count || 0) || 0,
      recorded_count: Number(readback.recorded_count || 0) || 0,
      blocked_claims: Array.isArray(parsed.blocked_claims) ? parsed.blocked_claims : [],
      limitations: Array.isArray(parsed.limitations) ? parsed.limitations : [],
      replacement_readback: readback,
      use_for_claims: false,
      claim_gate_effect: parsed.claim_gate_effect || readback.claim_gate_effect || 'no_claims_cleared',
      no_claim_gates_cleared: true,
    };
  } catch {
    return null;
  }
}

function listOpenClawSam31ActualValueReplacementReadbackEvidence(projectName, options = {}) {
  const requestedConsumer = String(options.consumer || '').trim().toLowerCase();
  const contractEvidenceId = Number(options.contractEvidenceId || options.contract_evidence_id || 0) || null;
  const replacementReadbackEvidenceId = Number(options.replacementReadbackEvidenceId || options.replacement_readback_evidence_id || 0) || null;
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'openclaw_sam31_actual_value_replacement_readback'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  return rows
    .map(openClawSam31ActualValueReplacementReadbackEvidenceFromRow)
    .filter(Boolean)
    .filter((row) => !replacementReadbackEvidenceId || row.evidence_id === replacementReadbackEvidenceId)
    .filter((row) => !requestedConsumer || row.requested_consumer === requestedConsumer)
    .filter((row) => !contractEvidenceId || row.source_openclaw_sam31_actual_value_resolver_contract_evidence_id === contractEvidenceId);
}

function openClawSam31ActualValueReplacementReadbackEvidenceById(projectName, evidenceId) {
  const targetId = Number(evidenceId || 0) || null;
  if (!targetId) return null;
  return listOpenClawSam31ActualValueReplacementReadbackEvidence(projectName, {
    replacementReadbackEvidenceId: targetId,
  })[0] || null;
}

function openClawSam31SectionToArtifactsConsumerIntakeSmokeEvidenceFromRow(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    if (!parsed || parsed.kind !== 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke') return null;
    const handoff = parsed.posted_handoff && typeof parsed.posted_handoff === 'object' && !Array.isArray(parsed.posted_handoff)
      ? parsed.posted_handoff
      : {};
    const consumer = String(parsed.consumer || '').trim().toLowerCase() || null;
    return {
      evidence_id: row.id,
      evidence_type: row.evidence_type,
      evidence_status: row.status,
      source_file: row.source_file || parsed.source_file || null,
      source_ref: row.source_ref || parsed.source_ref || null,
      download_name: row.source_file || 'sam31-section-to-artifacts-consumer-intake-smoke.json',
      artifact_type: parsed.artifact_type || 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
      status: parsed.status || row.status || null,
      consumer,
      consumer_adapter: parsed.consumer_adapter || (consumer ? `openclaw.sam31.consumer_review_queue.${consumer}.v1` : null),
      source_queue_item_id: parsed.source_queue_item_id || null,
      source_openclaw_sam31_consumer_review_evidence_id: Number(
        parsed.source_openclaw_sam31_consumer_review_evidence_id
        || handoff.source_openclaw_sam31_consumer_review_evidence_id
        || 0,
      ) || null,
      source_replay_evidence_id: Number(
        parsed.source_replay_evidence_id
        || handoff.source_replay_evidence_id
        || 0,
      ) || null,
      source_sam31_actual_value_replacement_evidence_id: Number(
        parsed.source_sam31_actual_value_replacement_evidence_id
        || handoff.source_sam31_actual_value_replacement_evidence_id
        || 0,
      ) || null,
      source_openclaw_sam31_section_to_artifacts_ref: parsed.source_openclaw_sam31_section_to_artifacts_ref
        || handoff.source_openclaw_sam31_section_to_artifacts_ref
        || null,
      source_refs: Array.isArray(parsed.source_refs)
        ? parsed.source_refs
        : (Array.isArray(handoff.source_refs) ? handoff.source_refs : []),
      observed_vector_overlay_count: Number(parsed.observed_vector_overlay_count ?? handoff.vector_overlay_count ?? 0) || 0,
      observed_model_3d_candidate_count: Number(parsed.observed_model_3d_candidate_count ?? handoff.model_3d_candidate_count ?? 0) || 0,
      observed_segment_count: Number(parsed.observed_segment_count ?? handoff.segment_count ?? 0) || 0,
      observed_object_hypothesis_count: Number(parsed.observed_object_hypothesis_count ?? handoff.object_hypothesis_count ?? 0) || 0,
      supported_consumers: Array.isArray(parsed.supported_consumers) ? parsed.supported_consumers : (Array.isArray(handoff.supported_consumers) ? handoff.supported_consumers : []),
      supported_applications: Array.isArray(parsed.supported_applications) ? parsed.supported_applications : (Array.isArray(handoff.supported_applications) ? handoff.supported_applications : []),
      posted_handoff: handoff,
      blocked_claims: Array.isArray(parsed.blocked_claims) ? parsed.blocked_claims : (Array.isArray(handoff.blocked_claims) ? handoff.blocked_claims : []),
      limitations: Array.isArray(parsed.limitations) ? parsed.limitations : [],
      use_for_claims: false,
      claim_gate_effect: parsed.claim_gate_effect || handoff.claim_gate_effect || 'no_claims_cleared',
      no_claim_gates_cleared: true,
    };
  } catch {
    return null;
  }
}

function listOpenClawSam31SectionToArtifactsConsumerIntakeSmokeEvidence(projectName, options = {}) {
  const requestedConsumer = String(options.consumer || '').trim().toLowerCase();
  const targetEvidenceId = Number(options.consumerIntakeSmokeEvidenceId || options.consumer_intake_smoke_evidence_id || 0) || null;
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  return rows
    .map(openClawSam31SectionToArtifactsConsumerIntakeSmokeEvidenceFromRow)
    .filter(Boolean)
    .filter((row) => !targetEvidenceId || row.evidence_id === targetEvidenceId)
    .filter((row) => !requestedConsumer || row.consumer === requestedConsumer);
}

function openClawSam31SectionToArtifactsConsumerIntakeSmokeEvidenceById(projectName, evidenceId) {
  const targetId = Number(evidenceId || 0) || null;
  if (!targetId) return null;
  return listOpenClawSam31SectionToArtifactsConsumerIntakeSmokeEvidence(projectName, {
    consumerIntakeSmokeEvidenceId: targetId,
  })[0] || null;
}

function halofireSam31ConsumerIntakeSmokeFollowupReviewDecisionFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'halofire_sam31_consumer_intake_smoke_followup_review_decision' && parsed.review
      ? parsed.review
      : null;
  } catch {
    return null;
  }
}

function listHalofireSam31ConsumerIntakeSmokeFollowupReviewDecisionEvidence(projectName, options = {}) {
  const sourceSmokeEvidenceId = Number(options.sourceSectionToArtifactsConsumerIntakeSmokeEvidenceId
    || options.source_section_to_artifacts_consumer_intake_smoke_evidence_id
    || options.consumerIntakeSmokeEvidenceId
    || options.consumer_intake_smoke_evidence_id
    || 0) || null;
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'halofire_sam31_consumer_intake_smoke_followup_review_decision'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  return rows
    .map((evidence) => {
      const review = halofireSam31ConsumerIntakeSmokeFollowupReviewDecisionFromEvidence(evidence);
      return review ? { evidence, review } : null;
    })
    .filter(Boolean)
    .filter(({ review }) => !sourceSmokeEvidenceId
      || Number(review.source_section_to_artifacts_consumer_intake_smoke_evidence_id) === sourceSmokeEvidenceId);
}

function halofireSam31ConsumerIntakeSmokeFollowupReviewSummary(packetReviewEvidence) {
  if (!packetReviewEvidence?.evidence || !packetReviewEvidence?.review) return null;
  const { evidence, review } = packetReviewEvidence;
  return {
    evidence_id: evidence.id,
    evidence_status: evidence.status,
    evidence_type: evidence.evidence_type,
    source_ref: evidence.source_ref,
    artifact_type: review.artifact_type || 'halofire.sam31_consumer_intake_smoke_followup_review_decision.v1',
    source_packet_artifact_type: review.source_packet_artifact_type,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: review.source_section_to_artifacts_consumer_intake_smoke_evidence_id,
    review_decision: review.review_decision,
    reviewer_name: review.reviewer_name,
    reviewed_at: review.reviewed_at,
    review_ref: review.review_ref,
    marked_up_screenshot_ref: review.marked_up_screenshot_ref,
    resolver_queue_rows: Array.isArray(review.resolver_queue_rows) ? review.resolver_queue_rows : [],
    use_for_claims: false,
    claim_gate_effect: review.claim_gate_effect || 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function latestHalofireSam31ConsumerIntakeSmokeFollowupReviewDecisionEvidence(projectName, smokeEvidenceId) {
  return listHalofireSam31ConsumerIntakeSmokeFollowupReviewDecisionEvidence(projectName, {
    sourceSectionToArtifactsConsumerIntakeSmokeEvidenceId: smokeEvidenceId,
  })[0] || null;
}

function listSam31ReplayActualValueReplacementDetails(projectName, options = {}) {
  const consumerFilter = String(options.consumer || '').trim().toLowerCase();
  const sourceReplayEvidenceId = Number(options.sourceReplayEvidenceId || options.source_replay_evidence_id || 0) || null;
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'sam31_actual_value_replacement'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  const details = [];
  for (const row of rows) {
    let replacement;
    try {
      replacement = JSON.parse(row.notes || '{}');
    } catch {
      continue;
    }
    if (!replacement || replacement.kind !== 'sam31ReplayActualValueReplacement') continue;
    if (sourceReplayEvidenceId && Number(replacement.source_replay_evidence_id || 0) !== sourceReplayEvidenceId) continue;
    const contract = replacement.openclaw_sam31_shared_consumer_contract || {};
    const supportedApplications = uniqueStrings([
      ...(Array.isArray(replacement.supported_applications) ? replacement.supported_applications : []),
      ...(Array.isArray(contract.supported_applications) ? contract.supported_applications : []),
      'halo_fire',
    ]).map((value) => String(value).trim().toLowerCase()).filter(Boolean);
    if (consumerFilter && !supportedApplications.includes(consumerFilter)) continue;
    const productLanes = contract.product_lanes && typeof contract.product_lanes === 'object' && !Array.isArray(contract.product_lanes)
      ? contract.product_lanes
      : {};
    details.push({
      artifact_type: 'openclaw.sam31.replay_actual_value_replacement_detail.v1',
      evidence_id: row.id,
      evidence_type: row.evidence_type,
      evidence_status: row.status,
      status: 'actual_value_evidence_recorded',
      intake_status: 'recorded',
      project_name: projectName,
      consumer: consumerFilter || null,
      source_runtime: replacement.source_runtime || contract.source_runtime || 'sam-3.1+llm',
      source_replay_evidence_id: replacement.source_replay_evidence_id || null,
      source_replay_artifact_type: replacement.source_replay_artifact_type || null,
      source_actual_value_handoff_artifact_type: replacement.source_actual_value_handoff_artifact_type || null,
      source_file: replacement.source_file || row.source_file || null,
      source_ref: replacement.source_ref || row.source_ref || null,
      source_refs: uniqueStrings([
        ...(Array.isArray(replacement.source_refs) ? replacement.source_refs : []),
        replacement.source_ref,
        row.source_ref,
      ].filter(Boolean)),
      replacement_values: replacement.replacement_values || {},
      replacement_summary: replacement.replacement_summary || {},
      openclaw_sam31_section_to_artifacts: replacement.openclaw_sam31_section_to_artifacts || null,
      openclaw_sam31_section_to_artifacts_summary: replacement.openclaw_sam31_section_to_artifacts_summary || null,
      source_openclaw_sam31_section_to_artifacts_ref: replacement.openclaw_sam31_section_to_artifacts_summary?.section_to_artifacts_contract_ref || null,
      supported_applications: supportedApplications,
      openclaw_sam31_shared_consumer_contract: contract,
      product_lanes: productLanes,
      product_lane: consumerFilter ? (productLanes[consumerFilter] || null) : null,
      acceptable_actual_evidence: Array.isArray(replacement.acceptable_actual_evidence) ? replacement.acceptable_actual_evidence : [],
      next_action: consumerFilter
        ? `Review replay-scoped SAM31 actual-value evidence for ${consumerFilter}; regulated claims remain blocked.`
        : 'Review replay-scoped SAM31 actual-value evidence before downstream product use; regulated claims remain blocked.',
      blocked_claims: Array.isArray(replacement.blocked_claims) ? replacement.blocked_claims : [],
      use_for_claims: false,
      claim_gate_effect: replacement.claim_gate_effect || 'no_claims_cleared',
      no_claim_gates_cleared: true,
      limitations: Array.isArray(replacement.limitations) ? replacement.limitations : [
        'Replay-scoped SAM31 actual-value replacements are internal-alpha evidence only.',
      ],
    });
  }
  return details;
}

function sam31ActualValueSectionArtifactSummary(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return null;
  const perceptionPacket = artifact.perception_packet && typeof artifact.perception_packet === 'object'
    ? artifact.perception_packet
    : {};
  return {
    artifact_type: artifact.artifact_type || 'openclaw.sam31_llm_extrapolation_artifact',
    status: artifact.status || 'best_effort_extrapolation_ready',
    application: artifact.application || perceptionPacket.application || null,
    project_ref: artifact.project_ref || perceptionPacket.project_ref || null,
    section_to_artifacts_contract_ref: artifact.section_to_artifacts_contract?.artifact_type
      || perceptionPacket.section_to_artifacts_contract_ref
      || 'openclaw.sam31.section_to_artifacts_contract.v1',
    segment_count: Array.isArray(perceptionPacket.segments) ? perceptionPacket.segments.length : 0,
    object_hypothesis_count: Array.isArray(perceptionPacket.object_hypotheses) ? perceptionPacket.object_hypotheses.length : 0,
    vector_overlay_count: Array.isArray(perceptionPacket.vector_overlays) ? perceptionPacket.vector_overlays.length : 0,
    model_3d_candidate_count: Array.isArray(perceptionPacket.model_3d_candidates) ? perceptionPacket.model_3d_candidates.length : 0,
    spatial_observation_count: Array.isArray(perceptionPacket.spatial_observations) ? perceptionPacket.spatial_observations.length : 0,
    use_for_claims: false,
    claim_gate_effect: artifact.claim_gate_effect || 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function buildSam31ActualValueSectionToArtifacts(projectName, body, review, sourceRef, sourceRefs) {
  const replacementValues = body?.replacement_values && typeof body.replacement_values === 'object' && !Array.isArray(body.replacement_values)
    ? jsonClone(body.replacement_values)
    : {};
  const hasSectionArtifactInputs = [
    'sections',
    'object_hypotheses',
    'llm_observations',
    'vector_overlays',
    'model_3d_candidates',
  ].some((key) => Array.isArray(replacementValues[key]) && replacementValues[key].length);
  if (!hasSectionArtifactInputs) return null;

  const payload = {
    project_ref: `${review.consumer || 'halo_fire'}:${projectName}`,
    application: review.consumer || 'halo_fire',
    source_ref: sourceRef,
    image_ref: body?.image_ref || review.replacement_ref || body?.source_file || null,
    coordinate_frame_ref: body?.coordinate_frame_ref || replacementValues.coordinate_frame_ref || 'halofire-actual-value-replacement-frame',
    unit: body?.unit || replacementValues.unit || 'ft',
    llm_runtime: body?.llm_runtime || replacementValues.llm_runtime || 'openclaw-local-llm-best-effort',
    prompt_ref: body?.prompt_ref || replacementValues.prompt_ref || 'openclaw.sam31.prompt.identify_objects_vector_3d.v1',
    sections: Array.isArray(replacementValues.sections) ? replacementValues.sections : [],
    object_hypotheses: Array.isArray(replacementValues.object_hypotheses) ? replacementValues.object_hypotheses : [],
    llm_observations: Array.isArray(replacementValues.llm_observations) ? replacementValues.llm_observations : [],
    vector_overlays: Array.isArray(replacementValues.vector_overlays) ? replacementValues.vector_overlays : [],
    model_3d_candidates: Array.isArray(replacementValues.model_3d_candidates) ? replacementValues.model_3d_candidates : [],
    source_refs: uniqueStrings([
      ...(Array.isArray(sourceRefs) ? sourceRefs : []),
      ...(Array.isArray(replacementValues.source_refs) ? replacementValues.source_refs : []),
      replacementValues.source_ref,
      review.replacement_ref,
    ].filter(Boolean)),
  };
  const artifact = buildSam31ExtrapolationArtifact(payload);
  return {
    ...artifact,
    artifact_source: 'api.openclaw.sam31.actual_value_replacements',
    source_actual_value_replacement_ref: sourceRef,
    replacement_values_source_ref: body?.replacement_values_source_ref || replacementValues.source_ref || sourceRef,
    section_to_artifacts_contract_ref: artifact.section_to_artifacts_contract?.artifact_type
      || 'openclaw.sam31.section_to_artifacts_contract.v1',
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function normalizeSam31ActualValueReplacementIntake(projectName, body, reviewRow, item = null, user = null) {
  const review = openClawSam31ConsumerReviewFromEvidence(reviewRow);
  if (!review) {
    const err = new Error('source_openclaw_sam31_consumer_review_evidence_id must reference a SAM31 consumer review evidence row');
    err.httpStatus = 404;
    throw err;
  }
  const sourceReviewEvidenceId = Number(reviewRow.id);
  const prefill = body?.actual_value_replacement_prefill && typeof body.actual_value_replacement_prefill === 'object' && !Array.isArray(body.actual_value_replacement_prefill)
    ? body.actual_value_replacement_prefill
    : (item?.actual_value_replacement_prefill || buildSam31ActualValueReplacementPrefill(projectName, item || {}, reviewRow));
  const actualValueServiceDescriptorAction = body?.actual_value_service_descriptor_action && typeof body.actual_value_service_descriptor_action === 'object' && !Array.isArray(body.actual_value_service_descriptor_action)
    ? body.actual_value_service_descriptor_action
    : (
        prefill.actual_value_service_descriptor_action && typeof prefill.actual_value_service_descriptor_action === 'object' && !Array.isArray(prefill.actual_value_service_descriptor_action)
          ? prefill.actual_value_service_descriptor_action
          : (item?.actual_value_service_descriptor_action || null)
      );
  const serviceDescriptorEvidenceId = body?.source_openclaw_sam31_actual_value_service_descriptor_evidence_id
    || prefill.source_openclaw_sam31_actual_value_service_descriptor_evidence_id
    || item?.source_openclaw_sam31_actual_value_service_descriptor_evidence_id
    || actualValueServiceDescriptorAction?.source_openclaw_sam31_actual_value_service_descriptor_evidence_id
    || null;
  const serviceDescriptorRef = body?.source_actual_value_service_descriptor_ref
    || prefill.source_actual_value_service_descriptor_ref
    || item?.latest_actual_value_service_descriptor_evidence?.source_ref
    || actualValueServiceDescriptorAction?.evidence_source_ref
    || null;
  const serviceDescriptorFile = body?.source_actual_value_service_descriptor_file
    || prefill.source_actual_value_service_descriptor_file
    || item?.latest_actual_value_service_descriptor_evidence?.source_file
    || actualValueServiceDescriptorAction?.evidence_source_file
    || null;
  const replacementValuesSourceRef = String(
    body?.replacement_values_source_ref
      || prefill.replacement_values_source_ref
      || body?.source_ref
      || prefill.source_ref
      || item?.replacement_values_source_ref
      || review.replacement_ref
      || reviewRow.source_ref
      || '',
  ).trim();
  const sourceRef = String(
    body?.source_ref
      || replacementValuesSourceRef
      || prefill.source_ref
      || item?.replacement_ref
      || reviewRow.source_ref
      || '',
  ).trim();
  if (!sourceRef) {
    const err = new Error('source_ref or replacement_values_source_ref is required for SAM31 actual-value replacement intake');
    err.httpStatus = 400;
    throw err;
  }
  const sourceFile = String(
    body?.source_file
      || prefill.source_file
      || reviewRow.source_file
      || `openclaw_sam31_consumer_review:${sourceReviewEvidenceId}`,
  ).trim();
  const sourceRefs = uniqueStrings([
    ...(Array.isArray(body?.source_refs) ? body.source_refs : []),
    ...(Array.isArray(prefill.source_refs) ? prefill.source_refs : []),
    sourceRef,
    replacementValuesSourceRef,
    serviceDescriptorRef,
    serviceDescriptorFile,
    actualValueServiceDescriptorAction?.href,
    item?.replacement_ref,
    item?.persisted_review_packet_ref,
    review.replacement_ref,
    reviewRow.source_ref,
  ].filter(Boolean));
  const replacementValues = body?.replacement_values && typeof body.replacement_values === 'object' && !Array.isArray(body.replacement_values)
    ? jsonClone(body.replacement_values)
    : {};
  const sectionToArtifacts = buildSam31ActualValueSectionToArtifacts(
    projectName,
    body || {},
    review,
    sourceRef,
    sourceRefs,
  );
  const sectionToArtifactsSummary = sam31ActualValueSectionArtifactSummary(sectionToArtifacts);
  return {
    kind: 'sam31ActualValueReplacement',
    artifact_type: 'halofire.sam31_actual_value_replacement_intake.v1',
    evidence_record_type: 'sam31_actual_value_replacement',
    project_name: projectName,
    source_application: review.source_application || item?.source_application || 'halo_fire',
    consumer: body?.consumer || item?.consumer || review.consumer || null,
    source_pdf_boundary_evidence_id: body?.source_pdf_boundary_evidence_id || item?.source_pdf_boundary_evidence_id || review.source_pdf_boundary_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: sourceReviewEvidenceId,
    source_openclaw_sam31_consumer_smoke_evidence_id: body?.source_openclaw_sam31_consumer_smoke_evidence_id || item?.source_openclaw_sam31_consumer_smoke_evidence_id || review.source_openclaw_sam31_consumer_smoke_evidence_id || null,
    source_openclaw_sam31_actual_value_service_descriptor_evidence_id: serviceDescriptorEvidenceId,
    source_actual_value_service_descriptor_ref: serviceDescriptorRef,
    source_actual_value_service_descriptor_file: serviceDescriptorFile,
    actual_value_service_descriptor_action: actualValueServiceDescriptorAction,
    accepted_queue_id: body?.accepted_queue_id || item?.accepted_queue_id || review.accepted_queue_id || null,
    persisted_review_packet_ref: body?.persisted_review_packet_ref || item?.persisted_review_packet_ref || review.persisted_review_packet_ref || null,
    replacement_ref: body?.replacement_ref || item?.replacement_ref || review.replacement_ref || null,
    source_file: sourceFile || null,
    source_ref: sourceRef,
    replacement_values_source_ref: replacementValuesSourceRef || sourceRef,
    source_refs: sourceRefs,
    replacement_values: replacementValues,
    llm_observation_count: Number(body?.llm_observation_count ?? item?.llm_observation_count ?? 0) || 0,
    llm_observation_ids: uniqueStrings([
      ...(Array.isArray(body?.llm_observation_ids) ? body.llm_observation_ids : []),
      ...(Array.isArray(item?.llm_observation_ids) ? item.llm_observation_ids : []),
    ]),
    source_llm_observation_ids: uniqueStrings([
      ...(Array.isArray(body?.source_llm_observation_ids) ? body.source_llm_observation_ids : []),
      ...(Array.isArray(item?.source_llm_observation_ids) ? item.source_llm_observation_ids : []),
    ]),
    actual_value_replacement_prefill: {
      ...prefill,
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: serviceDescriptorEvidenceId,
      source_actual_value_service_descriptor_ref: serviceDescriptorRef,
      source_actual_value_service_descriptor_file: serviceDescriptorFile,
      actual_value_service_descriptor_action: actualValueServiceDescriptorAction,
      source_file: prefill.source_file || sourceFile || null,
      source_ref: prefill.source_ref || sourceRef,
      replacement_values_source_ref: prefill.replacement_values_source_ref || replacementValuesSourceRef || sourceRef,
      source_refs: uniqueStrings([...(Array.isArray(prefill.source_refs) ? prefill.source_refs : []), ...sourceRefs]),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    },
    replacement_summary: {
      ...(item?.replacement_summary || {}),
      ...(body?.replacement_summary || {}),
      replaced_field_count: Object.keys(replacementValues).length,
      replaced_fields: uniqueStrings(Object.keys(replacementValues)),
      has_section_to_artifacts: Boolean(sectionToArtifactsSummary),
      vector_overlay_count: sectionToArtifactsSummary?.vector_overlay_count
        ?? (Array.isArray(replacementValues.vector_overlays) ? replacementValues.vector_overlays.length : 0),
      model_3d_candidate_count: sectionToArtifactsSummary?.model_3d_candidate_count
        ?? (Array.isArray(replacementValues.model_3d_candidates) ? replacementValues.model_3d_candidates.length : 0),
      llm_observation_count: Number(
        body?.replacement_summary?.llm_observation_count
          ?? item?.replacement_summary?.llm_observation_count
          ?? body?.llm_observation_count
          ?? item?.llm_observation_count
          ?? 0,
      ) || 0,
    },
    openclaw_sam31_section_to_artifacts: sectionToArtifacts,
    openclaw_sam31_section_to_artifacts_summary: sectionToArtifactsSummary,
    acceptable_actual_evidence: Array.isArray(body?.acceptable_actual_evidence)
      ? body.acceptable_actual_evidence
      : (Array.isArray(item?.acceptable_actual_evidence) ? item.acceptable_actual_evidence : []),
    employee_actual_value_next_action: body?.employee_actual_value_next_action
      || item?.employee_actual_value_next_action
      || 'Review this typed SAM31 actual-value replacement before downstream bid/export use.',
    blocked_claims: uniqueStrings([
      ...(Array.isArray(body?.blocked_claims) ? body.blocked_claims : []),
      ...(Array.isArray(item?.blocked_claims) ? item.blocked_claims : []),
      ...(Array.isArray(review.blocked_claims) ? review.blocked_claims : []),
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'manufacturer_exact',
      'AutoSprink_parity',
    ]),
    recorded_from: body?.recorded_from || 'api.openclaw.sam31.actual_value_replacements',
    recorded_by: user?.username || user?.name || null,
    recorded_at: new Date().toISOString(),
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: [
      'This intake records actual-value replacement evidence for SAM31+LLM temporary observations only.',
      'It does not clear permit-ready, fabrication-ready, AHJ-ready, engineering-grade, AutoSprink parity, professional approval, or manufacturer-exact claims.',
    ],
  };
}

function openClawSam31ActualValueServiceDescriptorAction(projectName, consumer, serviceDescriptorEvidence = null) {
  const normalizedConsumer = String(consumer || '').trim().toLowerCase();
  const serviceDescriptorEvidenceId = serviceDescriptorEvidence?.evidence_id || null;
  const query = [
    `projectName=${encodeURIComponent(projectName)}`,
    normalizedConsumer ? `consumer=${encodeURIComponent(normalizedConsumer)}` : '',
  ].filter(Boolean).join('&');
  return {
    artifact_type: 'openclaw.sam31.actual_value_service_descriptor_action.v1',
    action: 'download_actual_value_service_descriptor',
    method: 'GET',
    href: `/api/openclaw/sam31/actual-value-service?${query}`,
    project_route_href: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-service${normalizedConsumer ? `?consumer=${encodeURIComponent(normalizedConsumer)}` : ''}`,
    produces: 'openclaw.sam31.actual_value_service_descriptor.v1',
    source_openclaw_sam31_actual_value_service_descriptor_evidence_id: serviceDescriptorEvidenceId,
    evidence_source_ref: serviceDescriptorEvidence?.source_ref || null,
    evidence_source_file: serviceDescriptorEvidence?.source_file || null,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
  };
}

function openClawSam31ActualValueResolverConsumerActions(
  projectName,
  item,
  contractEvidence = null,
  serviceDescriptorEvidence = null,
  sectionToArtifactsHandoff = null,
  consumerIntakeSmokeEvidence = null,
  latestConsumerIntakeSmokeFollowupReviewSummary = null,
) {
  const pollActions = ['halo_fire', 'landscout', 'nameforge'].map((consumer) => ({
    consumer,
    action: 'poll_actual_value_resolver_queue',
    method: 'GET',
    href: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-resolver-queue?consumer=${encodeURIComponent(consumer)}`,
    consumes: 'openclaw.sam31.actual_value_resolver_queue_item.v1',
    source_openclaw_sam31_consumer_review_evidence_id: item.source_openclaw_sam31_consumer_review_evidence_id,
    source_openclaw_sam31_actual_value_resolver_contract_evidence_id: contractEvidence?.evidence_id || null,
    source_openclaw_sam31_actual_value_service_descriptor_evidence_id: serviceDescriptorEvidence?.requested_consumer === consumer
      ? serviceDescriptorEvidence.evidence_id
      : null,
    actual_value_service_descriptor_action: openClawSam31ActualValueServiceDescriptorAction(
      projectName,
      consumer,
      serviceDescriptorEvidence?.requested_consumer === consumer ? serviceDescriptorEvidence : null,
    ),
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
  }));
  const smokeSprinklerPacketAction = consumerIntakeSmokeEvidence && latestConsumerIntakeSmokeFollowupReviewSummary ? [{
    consumer: consumerIntakeSmokeEvidence.consumer || item.consumer || null,
    action: 'download_halofire_consumer_intake_smoke_sprinkler_review_packet',
    method: 'GET',
    href: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/${encodeURIComponent(consumerIntakeSmokeEvidence.evidence_id)}/sprinkler-review-packet`,
    consumes: HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_RESOLVER_QUEUE_ITEM_TYPE,
    produces: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokeEvidence.evidence_id || null,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: latestConsumerIntakeSmokeFollowupReviewSummary.evidence_id || null,
    source_sam31_actual_value_replacement_evidence_id: consumerIntakeSmokeEvidence.source_sam31_actual_value_replacement_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: consumerIntakeSmokeEvidence.source_openclaw_sam31_consumer_review_evidence_id || item.source_openclaw_sam31_consumer_review_evidence_id,
    supported_sprinkler_review_lanes: [
      'room_boundary_visual_audit',
      'obstruction_or_clash_review',
    ],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
  }] : [];
  const savedSmokeAction = consumerIntakeSmokeEvidence ? [{
    consumer: consumerIntakeSmokeEvidence.consumer || item.consumer || null,
    action: 'download_saved_section_to_artifacts_consumer_intake_smoke',
    method: 'GET',
    href: `/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(projectName)}&consumer=${encodeURIComponent(consumerIntakeSmokeEvidence.consumer || item.consumer || '')}&consumerIntakeSmokeEvidenceId=${encodeURIComponent(consumerIntakeSmokeEvidence.evidence_id)}`,
    consumes: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
    produces: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokeEvidence.evidence_id || null,
    source_sam31_actual_value_replacement_evidence_id: consumerIntakeSmokeEvidence.source_sam31_actual_value_replacement_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: consumerIntakeSmokeEvidence.source_openclaw_sam31_consumer_review_evidence_id || item.source_openclaw_sam31_consumer_review_evidence_id,
    source_ref: consumerIntakeSmokeEvidence.source_ref || null,
    source_file: consumerIntakeSmokeEvidence.source_file || null,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
  }, {
    consumer: consumerIntakeSmokeEvidence.consumer || item.consumer || null,
    action: 'download_halofire_consumer_intake_smoke_followup_packet',
    method: 'GET',
    href: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/${encodeURIComponent(consumerIntakeSmokeEvidence.evidence_id)}/followup-packet`,
    consumes: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
    produces: 'halofire.sam31_consumer_intake_smoke_followup_packet.v1',
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokeEvidence.evidence_id || null,
    source_sam31_actual_value_replacement_evidence_id: consumerIntakeSmokeEvidence.source_sam31_actual_value_replacement_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: consumerIntakeSmokeEvidence.source_openclaw_sam31_consumer_review_evidence_id || item.source_openclaw_sam31_consumer_review_evidence_id,
    supported_sprinkler_review_lanes: [
      'room_boundary_visual_audit',
      'obstruction_or_clash_review',
      'vector_overlay_generation',
      'model_3d_candidate_generation',
    ],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
  }, ...smokeSprinklerPacketAction] : [];
  if (!sectionToArtifactsHandoff) return [...pollActions, ...savedSmokeAction];
  const handoffActions = ['halo_fire', 'landscout', 'nameforge'].map((consumer) => ({
    consumer,
    action: 'post_section_to_artifacts_consumer_handoff',
    method: 'POST',
    href: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke`,
    consumes: 'openclaw.sam31.section_to_artifacts_consumer_handoff.v1',
    produces: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
    source_openclaw_sam31_consumer_review_evidence_id: sectionToArtifactsHandoff.source_openclaw_sam31_consumer_review_evidence_id || item.source_openclaw_sam31_consumer_review_evidence_id,
    source_sam31_actual_value_replacement_evidence_id: sectionToArtifactsHandoff.source_sam31_actual_value_replacement_evidence_id || null,
    source_openclaw_sam31_section_to_artifacts_ref: sectionToArtifactsHandoff.source_openclaw_sam31_section_to_artifacts_ref || null,
    observed_vector_overlay_count: Number(sectionToArtifactsHandoff.vector_overlay_count || 0) || 0,
    observed_model_3d_candidate_count: Number(sectionToArtifactsHandoff.model_3d_candidate_count || 0) || 0,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
  }));
  return [...pollActions, ...handoffActions, ...savedSmokeAction];
}

function openClawSam31ActualValueResolverConsumerPullEndpoints(projectName) {
  return Object.fromEntries(['halo_fire', 'landscout', 'nameforge'].map((consumer) => [
    consumer,
    {
      consumer,
      action: 'poll_actual_value_resolver_queue',
      method: 'GET',
      href: `/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(projectName)}&consumer=${encodeURIComponent(consumer)}`,
      project_route_href: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-resolver-queue?consumer=${encodeURIComponent(consumer)}`,
      consumes: 'openclaw.sam31.actual_value_resolver_queue.v1',
      produces: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
  ]));
}

function openClawSam31ActualValueResolverExtrapolationContract(projectName = null) {
  const descriptor = localOpenClawSam31ToolDescriptor(projectName);
  const extrapolation = descriptor.extrapolation_contract || SAM31_EXTRAPOLATION_CONTRACT;
  return {
    artifact_type: 'openclaw.sam31.actual_value_resolver_extrapolation_contract.v1',
    status: 'ready_for_consumer_actual_value_polling',
    source_tool_descriptor_ref: descriptor.artifact_type || 'openclaw.sam31_llm_extrapolation_tool',
    source_tool_contract_ref: extrapolation.artifact_type || SAM31_EXTRAPOLATION_CONTRACT_REF,
    source_runtime: extrapolation.source_runtime || descriptor.source_runtime || 'sam-3.1+llm',
    project_name: projectName || null,
    consumes: Array.isArray(extrapolation.consumes) ? [...extrapolation.consumes] : ['segments', 'object_hypotheses'],
    produces: Array.isArray(extrapolation.produces) ? [...extrapolation.produces] : ['llm_observations', 'vector_overlays', 'model_3d_candidates', 'extrapolation_index'],
    perception_lanes: [...SAM31_PERCEPTION_LANES],
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    application_contracts: sam31ApplicationContracts(),
    product_review_queue_contract: descriptor.product_review_queue_contract || null,
    supports_object_identification: true,
    supports_vector_overlays: true,
    supports_model_3d_candidates: true,
    supports_spatial_observations: true,
    required_actual_value_replacement_fields: [...SAM31_CONSUMER_REVIEW_FIELDS],
    acceptable_actual_evidence: [
      '1881 proposal workbook row or sheet reference',
      'reviewed vector overlay SVG or marked-up plan ref',
      'reviewed 3D model candidate ref or model note',
      'screenshot or console evidence for the reviewed SAM31 section',
    ],
    temporary_value_policy: 'best_guess_until_employee_replaced',
    blocked_claims: uniqueStrings([
      ...(Array.isArray(descriptor.blocked_claims) ? descriptor.blocked_claims : []),
      ...SAM31_BLOCKED_CLAIMS,
      'CEO_ready',
      'brand_ready',
      'trademark_ready',
      'production_ready',
    ]),
    limitations: [
      'SAM31+LLM object identification, vector overlays, and 3D model candidates are best-effort temporary perception artifacts.',
      'This queue contract helps HaloFire, LandScout, and NameForge poll for actual-value replacement work; it does not clear regulated or product-readiness claims.',
    ],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function openClawSam31ActualValueServiceEndpoint(projectName, consumer) {
  const encodedProjectName = encodeURIComponent(projectName);
  const encodedConsumer = encodeURIComponent(consumer);
  return {
    consumer,
    service_descriptor: {
      method: 'GET',
      href: `/api/openclaw/sam31/actual-value-service?projectName=${encodedProjectName}&consumer=${encodedConsumer}`,
      project_route_href: `/api/projects/${encodedProjectName}/openclaw/sam31/actual-value-service?consumer=${encodedConsumer}`,
      produces: 'openclaw.sam31.actual_value_service_descriptor.v1',
      action: 'poll_actual_value_service_descriptor',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    resolver_queue: {
      method: 'GET',
      action: 'poll_actual_value_resolver_queue',
      href: `/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodedProjectName}&consumer=${encodedConsumer}`,
      project_route_href: `/api/projects/${encodedProjectName}/openclaw/sam31/actual-value-resolver-queue?consumer=${encodedConsumer}`,
      produces: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    resolver_contract: {
      method: 'GET',
      action: 'download_actual_value_resolver_contract',
      href: `/api/openclaw/sam31/actual-value-resolver-contract?projectName=${encodedProjectName}&consumer=${encodedConsumer}`,
      produces: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    replacement_readback: {
      method: 'GET',
      action: 'poll_actual_value_replacement_details',
      href: `/api/openclaw/sam31/actual-value-replacements?projectName=${encodedProjectName}&consumer=${encodedConsumer}`,
      project_route_href: `/api/projects/${encodedProjectName}/openclaw/sam31/actual-value-replacements?consumer=${encodedConsumer}`,
      produces: 'openclaw.sam31.actual_value_replacement_readback.v1',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    replacement_intake: {
      method: 'POST',
      href: `/api/projects/${encodedProjectName}/openclaw/sam31/actual-value-replacements`,
      consumes: 'halofire.sam31_actual_value_replacement_intake.v1',
      produces: 'halofire.sam31_actual_value_replacement_intake.v1',
      evidence_record_type: 'sam31_actual_value_replacement',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    section_to_artifacts_consumer_intake_smoke: {
      method: 'POST',
      href: `/api/projects/${encodedProjectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke`,
      consumes: 'openclaw.sam31.section_to_artifacts_consumer_handoff.v1',
      produces: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
      evidence_record_type: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
  };
}

function buildOpenClawSam31ActualValueServiceDescriptor(projectName, options = {}) {
  const requestedConsumer = String(options.consumer || '').trim().toLowerCase();
  const serviceConsumers = ['halo_fire', 'landscout', 'nameforge'];
  const effectiveConsumer = serviceConsumers.includes(requestedConsumer) ? requestedConsumer : null;
  const latestServiceDescriptorEvidence = latestOpenClawSam31ActualValueServiceDescriptorEvidence(projectName, effectiveConsumer || '');
  const savedServiceDescriptorEvidenceRows = listOpenClawSam31ActualValueServiceDescriptorEvidence(projectName, {
    consumer: effectiveConsumer || '',
  });
  const consumerServiceEndpoints = Object.fromEntries(serviceConsumers.map((consumer) => [
    consumer,
    openClawSam31ActualValueServiceEndpoint(projectName, consumer),
  ]));
  return {
    artifact_type: 'openclaw.sam31.actual_value_service_descriptor.v1',
    status: 'ready_for_shared_consumer_polling',
    project_name: projectName,
    requested_consumer: effectiveConsumer,
    generated_at: new Date().toISOString(),
    source_runtime: 'sam-3.1+llm',
    source_tool_descriptor_ref: 'openclaw.sam31_llm_extrapolation_tool',
    source_tool_contract_ref: SAM31_EXTRAPOLATION_CONTRACT_REF,
    supported_consumers: serviceConsumers,
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    consumer_service_endpoints: consumerServiceEndpoints,
    shared_see_label_extrapolate_contract: {
      artifact_type: 'openclaw.sam31.see_label_extrapolate_contract.v1',
      source_runtime: 'sam-3.1+llm',
      source_tool_contract_ref: SAM31_EXTRAPOLATION_CONTRACT_REF,
      perception_lanes: [...SAM31_PERCEPTION_LANES],
      produces: [
        'segments',
        'object_hypotheses',
        'semantic_labels',
        'llm_observations',
        'vector_overlays',
        'model_3d_candidates',
        'spatial_observations',
        'source_refs',
        'screenshots',
        'console_evidence',
      ],
      object_hypothesis_contract: {
        artifact_type: 'openclaw.sam31.object_hypothesis_contract.v1',
        required_fields: ['id', 'semantic_label', 'confidence', 'source_refs'],
        optional_fields: ['bbox', 'polygon', 'dimensions', 'source_llm_observation_ids', 'limitations'],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      vector_overlay_contract: {
        artifact_type: 'openclaw.sam31.vector_overlay_contract.v1',
        required_fields: ['id', 'svg_path_or_vector_ref', 'source_object_hypothesis_ids', 'source_refs'],
        optional_fields: ['coordinate_frame_ref', 'unit', 'confidence', 'limitations'],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      model_3d_candidate_contract: {
        artifact_type: 'openclaw.sam31.model_3d_candidate_contract.v1',
        required_fields: ['id', 'model_ref_or_primitive', 'source_object_hypothesis_ids', 'source_refs'],
        optional_fields: ['coordinate_frame_ref', 'unit', 'dimensions', 'confidence', 'limitations'],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      supports_object_identification: true,
      supports_semantic_labels: true,
      supports_vector_overlays: true,
      supports_model_3d_candidates: true,
      supports_spatial_observations: true,
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    },
    actual_value_replacement_contract: {
      artifact_type: 'halofire.sam31_actual_value_replacement_intake_contract.v1',
      consumes: 'openclaw.sam31.actual_value_resolver_queue_item.v1',
      produces: 'halofire.sam31_actual_value_replacement_intake.v1',
      required_fields: ['source_openclaw_sam31_consumer_review_evidence_id', 'source_ref'],
      replacement_value_fields: [...SAM31_CONSUMER_REVIEW_FIELDS],
      acceptable_actual_evidence: [
        '1881 proposal workbook row or sheet reference',
        'reviewed vector overlay SVG or marked-up plan ref',
        'reviewed 3D model candidate ref or model note',
        'screenshot or console evidence for the reviewed SAM31 section',
      ],
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    },
    temporary_value_policy: 'best_guess_until_employee_replaced',
    latest_actual_value_service_descriptor_evidence_id: latestServiceDescriptorEvidence?.evidence_id || null,
    latest_actual_value_service_descriptor_evidence: latestServiceDescriptorEvidence,
    saved_actual_value_service_descriptor_count: savedServiceDescriptorEvidenceRows.length,
    blocked_claims: uniqueStrings([
      ...SAM31_BLOCKED_CLAIMS,
      'CEO_ready',
      'brand_ready',
      'trademark_ready',
      'production_ready',
    ]),
    limitations: [
      'This descriptor lets HaloFire, LandScout, and NameForge poll one shared OpenClaw SAM31+LLM actual-value service contract.',
      'SAM31 object hypotheses, semantic labels, vector overlays, 3D model candidates, screenshots, and console evidence are temporary review artifacts until replaced by owner-reviewed actual evidence.',
      'This descriptor does not clear permit-ready, fabrication-ready, AHJ-ready, engineering-grade, AutoSprink parity, professional approval, manufacturer-exact, brand-ready, trademark-ready, CEO-ready, or production-ready claims.',
    ],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function buildOpenClawSam31ActualValueResolverQueue(projectName, options = {}) {
  const sourceReplayEvidenceFilterId = Number(options.sourceReplayEvidenceId || options.source_replay_evidence_id || 0) || null;
  const requestedServiceDescriptorEvidence = openClawSam31ActualValueServiceDescriptorEvidenceById(
    projectName,
    options.serviceDescriptorEvidenceId || options.service_descriptor_evidence_id,
  );
  const requestedReplacementReadbackEvidence = openClawSam31ActualValueReplacementReadbackEvidenceById(
    projectName,
    options.replacementReadbackEvidenceId || options.replacement_readback_evidence_id,
  );
  const requestedConsumerIntakeSmokeEvidence = openClawSam31SectionToArtifactsConsumerIntakeSmokeEvidenceById(
    projectName,
    options.consumerIntakeSmokeEvidenceId || options.consumer_intake_smoke_evidence_id,
  );
  const requestedContractEvidence = openClawSam31ActualValueResolverContractEvidenceById(
    projectName,
    options.contractEvidenceId
      || options.contract_evidence_id
      || requestedReplacementReadbackEvidence?.source_openclaw_sam31_actual_value_resolver_contract_evidence_id,
  );
  const replacementReadbackConsumer = requestedReplacementReadbackEvidence?.requested_consumer || '';
  const contractEvidenceConsumer = requestedContractEvidence?.requested_consumer && requestedContractEvidence.requested_consumer !== 'all-consumers'
    ? requestedContractEvidence.requested_consumer
    : '';
  const serviceDescriptorEvidenceConsumer = requestedServiceDescriptorEvidence?.requested_consumer && requestedServiceDescriptorEvidence.requested_consumer !== 'all-consumers'
    ? requestedServiceDescriptorEvidence.requested_consumer
    : '';
  const consumerIntakeSmokeEvidenceConsumer = requestedConsumerIntakeSmokeEvidence?.consumer || '';
  const consumerFilter = String(options.consumer || '').trim().toLowerCase()
    || consumerIntakeSmokeEvidenceConsumer
    || serviceDescriptorEvidenceConsumer
    || replacementReadbackConsumer
    || contractEvidenceConsumer;
  const index = buildOpenClawSam31ActualValueWorkItemIndex(projectName);
  const latestReplacementByReview = latestSam31ActualValueReplacementEvidenceByReview(projectName);
  const latestContractEvidence = requestedContractEvidence || latestOpenClawSam31ActualValueResolverContractEvidence(projectName, consumerFilter);
  const latestServiceDescriptorEvidence = requestedServiceDescriptorEvidence || latestOpenClawSam31ActualValueServiceDescriptorEvidence(projectName, consumerFilter);
  const savedServiceDescriptorEvidenceRows = requestedServiceDescriptorEvidence ? [requestedServiceDescriptorEvidence].filter((row) => (
    !consumerFilter || row.requested_consumer === consumerFilter
  )) : listOpenClawSam31ActualValueServiceDescriptorEvidence(projectName, {
    consumer: consumerFilter,
  });
  const savedReplacementReadbackEvidenceRows = requestedReplacementReadbackEvidence
    ? [requestedReplacementReadbackEvidence].filter((row) => (
      (!consumerFilter || row.requested_consumer === consumerFilter)
      && (!requestedContractEvidence?.evidence_id || row.source_openclaw_sam31_actual_value_resolver_contract_evidence_id === requestedContractEvidence.evidence_id)
    ))
    : listOpenClawSam31ActualValueReplacementReadbackEvidence(projectName, {
      consumer: consumerFilter,
      contractEvidenceId: requestedContractEvidence?.evidence_id || null,
    });
  const latestReplacementReadbackEvidence = savedReplacementReadbackEvidenceRows[0] || null;
  const savedConsumerIntakeSmokeEvidenceRows = requestedConsumerIntakeSmokeEvidence ? [requestedConsumerIntakeSmokeEvidence].filter((row) => (
    !consumerFilter || row.consumer === consumerFilter
  )) : listOpenClawSam31SectionToArtifactsConsumerIntakeSmokeEvidence(projectName, {
    consumer: consumerFilter,
  });
  const latestConsumerIntakeSmokeEvidence = savedConsumerIntakeSmokeEvidenceRows[0] || null;
  const latestConsumerIntakeSmokeByReview = new Map();
  const latestConsumerIntakeSmokeByReplacement = new Map();
  for (const smoke of savedConsumerIntakeSmokeEvidenceRows) {
    if (smoke.source_openclaw_sam31_consumer_review_evidence_id && !latestConsumerIntakeSmokeByReview.has(smoke.source_openclaw_sam31_consumer_review_evidence_id)) {
      latestConsumerIntakeSmokeByReview.set(smoke.source_openclaw_sam31_consumer_review_evidence_id, smoke);
    }
    if (smoke.source_sam31_actual_value_replacement_evidence_id && !latestConsumerIntakeSmokeByReplacement.has(smoke.source_sam31_actual_value_replacement_evidence_id)) {
      latestConsumerIntakeSmokeByReplacement.set(smoke.source_sam31_actual_value_replacement_evidence_id, smoke);
    }
  }
  const latestConsumerIntakeSmokeFollowupReviewBySmoke = new Map();
  const consumerIntakeSmokeFollowupReviews = listHalofireSam31ConsumerIntakeSmokeFollowupReviewDecisionEvidence(projectName);
  for (const reviewEvidence of consumerIntakeSmokeFollowupReviews) {
    const smokeId = Number(reviewEvidence.review.source_section_to_artifacts_consumer_intake_smoke_evidence_id || 0) || null;
    if (smokeId && !latestConsumerIntakeSmokeFollowupReviewBySmoke.has(smokeId)) {
      latestConsumerIntakeSmokeFollowupReviewBySmoke.set(smokeId, reviewEvidence);
    }
  }
  const sam31LlmExtrapolationContract = openClawSam31ActualValueResolverExtrapolationContract(projectName);
  const replayReplacementItems = listSam31ReplayActualValueReplacementDetails(projectName, {
    consumer: consumerFilter,
    sourceReplayEvidenceId: sourceReplayEvidenceFilterId,
  })
    .map((detail) => {
      const sectionToArtifactsHandoff = openClawSam31SectionToArtifactsConsumerHandoff(
        {
          source_openclaw_sam31_consumer_review_evidence_id: detail.source_openclaw_sam31_consumer_review_evidence_id || null,
        },
        {
          evidence_id: detail.evidence_id,
          source_replay_evidence_id: detail.source_replay_evidence_id,
          source_ref: detail.source_ref,
          source_refs: detail.source_refs,
          openclaw_sam31_section_to_artifacts_summary: detail.openclaw_sam31_section_to_artifacts_summary,
        },
      );
      return {
        artifact_type: 'openclaw.sam31.replay_actual_value_replacement_queue_item.v1',
        id: `sam31-replay-actual-value:${projectName}:${detail.evidence_id}:${consumerFilter || 'all'}`,
        evidence_id: detail.evidence_id,
        evidence_type: detail.evidence_type,
        project_name: projectName,
        consumer: consumerFilter || null,
        status: detail.status,
        intake_status: detail.intake_status,
        source_runtime: detail.source_runtime,
        source_replay_evidence_id: detail.source_replay_evidence_id,
        source_actual_value_handoff_artifact_type: detail.source_actual_value_handoff_artifact_type,
        source_file: detail.source_file,
        source_ref: detail.source_ref,
        source_refs: detail.source_refs,
        supported_applications: detail.supported_applications,
        product_lane: detail.product_lane,
        product_lanes: detail.product_lanes,
        replacement_summary: detail.replacement_summary,
        openclaw_sam31_section_to_artifacts: detail.openclaw_sam31_section_to_artifacts,
        openclaw_sam31_section_to_artifacts_summary: detail.openclaw_sam31_section_to_artifacts_summary,
        source_openclaw_sam31_section_to_artifacts_ref: detail.source_openclaw_sam31_section_to_artifacts_ref,
        section_to_artifacts_consumer_handoff: sectionToArtifactsHandoff,
        openclaw_sam31_shared_consumer_contract: detail.openclaw_sam31_shared_consumer_contract,
        acceptable_actual_evidence: detail.acceptable_actual_evidence,
        next_action: sectionToArtifactsHandoff
          ? 'Post this replay-scoped SAM31 section-to-artifacts handoff into the selected consumer intake smoke path; regulated claims remain blocked.'
          : detail.next_action,
        use_for_claims: false,
        blocked_claims: detail.blocked_claims,
        claim_gate_effect: detail.claim_gate_effect || 'no_claims_cleared',
        no_claim_gates_cleared: true,
        limitations: [
          'Replay replacement queue items expose saved SAM31+LLM actual-value evidence to shared product consumers.',
          'They do not clear regulated, survey-grade, brand-ready, production-ready, or manufacturer-exact claims.',
        ],
      };
    });
  const items = index.items
    .filter((item) => !consumerFilter || String(item.consumer || '').toLowerCase() === consumerFilter)
    .map((item) => {
      const latestReplacement = latestReplacementByReview.get(Number(item.source_openclaw_sam31_consumer_review_evidence_id)) || null;
      const itemServiceDescriptorEvidence = requestedServiceDescriptorEvidence
        || latestOpenClawSam31ActualValueServiceDescriptorEvidence(projectName, item.consumer);
      const itemServiceDescriptorAction = openClawSam31ActualValueServiceDescriptorAction(projectName, item.consumer, itemServiceDescriptorEvidence);
      const actualValueReplacementPrefill = sam31ActualValueReplacementPrefillWithServiceDescriptor(
        item.actual_value_replacement_prefill || null,
        itemServiceDescriptorEvidence,
        itemServiceDescriptorAction,
      );
      const status = latestReplacement ? 'actual_value_evidence_recorded' : 'requires_employee_actual_value_update';
      const sectionToArtifactsHandoff = openClawSam31SectionToArtifactsConsumerHandoff(item, latestReplacement);
      const consumerIntakeSmokeEvidence = latestConsumerIntakeSmokeByReplacement.get(Number(latestReplacement?.evidence_id || 0))
        || latestConsumerIntakeSmokeByReview.get(Number(item.source_openclaw_sam31_consumer_review_evidence_id || 0))
        || null;
      const latestConsumerIntakeSmokeFollowupReview = consumerIntakeSmokeEvidence
        ? latestConsumerIntakeSmokeFollowupReviewBySmoke.get(Number(consumerIntakeSmokeEvidence.evidence_id || 0)) || null
        : null;
      const latestConsumerIntakeSmokeFollowupReviewSummary = halofireSam31ConsumerIntakeSmokeFollowupReviewSummary(latestConsumerIntakeSmokeFollowupReview);
      const consumerIntakeSmokeFollowupResolverRows = latestConsumerIntakeSmokeFollowupReviewSummary?.resolver_queue_rows || [];
      return {
        artifact_type: 'openclaw.sam31.actual_value_resolver_queue_item.v1',
        id: `sam31-actual-value:${projectName}:${item.source_openclaw_sam31_consumer_review_evidence_id}`,
        project_name: projectName,
        status,
        intake_status: latestReplacement ? 'recorded' : 'missing',
        source_runtime: 'sam-3.1+llm',
        consumer: item.consumer,
        source_application: item.source_application || 'halo_fire',
        source_pdf_boundary_evidence_id: item.source_pdf_boundary_evidence_id,
        source_openclaw_sam31_consumer_review_evidence_id: item.source_openclaw_sam31_consumer_review_evidence_id,
        source_openclaw_sam31_consumer_smoke_evidence_id: item.source_openclaw_sam31_consumer_smoke_evidence_id,
        source_openclaw_sam31_actual_value_service_descriptor_evidence_id: itemServiceDescriptorEvidence?.evidence_id || null,
        latest_actual_value_service_descriptor_evidence: itemServiceDescriptorEvidence,
        actual_value_service_descriptor_action: itemServiceDescriptorAction,
        source_openclaw_sam31_actual_value_resolver_contract_evidence_id: latestContractEvidence?.evidence_id || null,
        latest_actual_value_resolver_contract_evidence: latestContractEvidence,
        accepted_queue_id: item.accepted_queue_id || null,
        persisted_review_packet_ref: item.persisted_review_packet_ref || null,
        replacement_ref: item.replacement_ref || null,
        replacement_values_source_ref: item.replacement_values_source_ref || null,
        llm_observation_count: item.llm_observation_count || 0,
        llm_observation_ids: Array.isArray(item.llm_observation_ids) ? item.llm_observation_ids : [],
        source_llm_observation_ids: Array.isArray(item.source_llm_observation_ids) ? item.source_llm_observation_ids : [],
        replacement_summary: item.replacement_summary || {},
        actual_value_replacement_prefill: actualValueReplacementPrefill,
        acceptable_actual_evidence: Array.isArray(item.acceptable_actual_evidence) ? item.acceptable_actual_evidence : [],
        evidence_record_type: item.evidence_record_type || 'sam31_actual_value_replacement',
        evidence_record_next_action: item.evidence_record_next_action || 'Record the actual HaloFire documentation evidence that replaces this SAM31 best guess.',
        next_action: latestReplacement
          ? (consumerIntakeSmokeEvidence
            ? 'Open the saved SAM31 section-to-artifacts consumer intake smoke evidence and route the observed vector/model counts into the next consumer follow-up action; regulated and product-readiness claims remain blocked.'
            : 'Review the recorded sam31_actual_value_replacement evidence before using it in downstream bid/export decisions; regulated claims remain blocked.')
          : 'Record sam31_actual_value_replacement evidence from the 1881 workbook/sheet, reviewed vector overlay, reviewed 3D model candidate, screenshot, or console evidence.',
        download_href: item.download_href,
        latest_actual_value_replacement_evidence: latestReplacement,
        openclaw_sam31_section_to_artifacts: latestReplacement?.openclaw_sam31_section_to_artifacts || null,
        openclaw_sam31_section_to_artifacts_summary: latestReplacement?.openclaw_sam31_section_to_artifacts_summary || null,
        source_openclaw_sam31_section_to_artifacts_ref: latestReplacement?.openclaw_sam31_section_to_artifacts_summary?.section_to_artifacts_contract_ref || null,
        section_to_artifacts_consumer_handoff: sectionToArtifactsHandoff,
        source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokeEvidence?.evidence_id || null,
        latest_section_to_artifacts_consumer_intake_smoke_evidence: consumerIntakeSmokeEvidence,
        latest_halofire_sam31_consumer_intake_smoke_followup_review_decision: latestConsumerIntakeSmokeFollowupReviewSummary,
        sam31_consumer_intake_smoke_followup_resolver_queue_items: consumerIntakeSmokeFollowupResolverRows,
        consumer_actions: openClawSam31ActualValueResolverConsumerActions(
          projectName,
          item,
          latestContractEvidence,
          itemServiceDescriptorEvidence,
          sectionToArtifactsHandoff,
          consumerIntakeSmokeEvidence,
          latestConsumerIntakeSmokeFollowupReviewSummary,
        ),
        use_for_claims: false,
        blocked_claims: Array.isArray(item.blocked_claims) ? item.blocked_claims : [],
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
        limitations: [
          'SAM31 plus LLM sectioning can identify likely objects, semantic labels, vector overlays, and 3D candidates, but this queue only tracks evidence replacement status.',
          'Resolver queue rows never clear permit-ready, fabrication-ready, AHJ-ready, engineering-grade, AutoSprink parity, professional approval, or manufacturer-exact claims.',
        ],
      };
    });
  const recordedCount = items.filter((item) => item.intake_status === 'recorded').length;
  const pendingCount = items.filter((item) => item.intake_status !== 'recorded').length;
  const consumerIntakeSmokeFollowupReviewsRecorded = items
    .filter((item) => item.latest_halofire_sam31_consumer_intake_smoke_followup_review_decision)
    .length;
  const consumerIntakeSmokeFollowupResolverQueueItemCount = items
    .reduce((total, item) => total + (Array.isArray(item.sam31_consumer_intake_smoke_followup_resolver_queue_items)
      ? item.sam31_consumer_intake_smoke_followup_resolver_queue_items.length
      : 0), 0);
  return {
    artifact_type: 'openclaw.sam31.actual_value_resolver_queue.v1',
    status: items.length
      ? (pendingCount ? 'actual_value_replacements_pending' : 'actual_value_replacements_recorded')
      : 'no_sam31_actual_value_work_items',
    project_name: projectName,
    requested_consumer: consumerFilter || null,
    contract_evidence_filter_id: requestedContractEvidence?.evidence_id || null,
    replacement_readback_evidence_filter_id: requestedReplacementReadbackEvidence?.evidence_id || null,
    generated_at: new Date().toISOString(),
    supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
    sam31_llm_extrapolation_contract: sam31LlmExtrapolationContract,
    service_descriptor_evidence_filter_id: requestedServiceDescriptorEvidence?.evidence_id || null,
    consumer_intake_smoke_evidence_filter_id: requestedConsumerIntakeSmokeEvidence?.evidence_id || null,
    source_replay_evidence_filter_id: sourceReplayEvidenceFilterId,
    latest_actual_value_service_descriptor_evidence_id: latestServiceDescriptorEvidence?.evidence_id || null,
    latest_actual_value_service_descriptor_evidence: latestServiceDescriptorEvidence,
    saved_actual_value_service_descriptor_count: savedServiceDescriptorEvidenceRows.length,
    source_openclaw_sam31_actual_value_resolver_contract_evidence_id: latestContractEvidence?.evidence_id || null,
    latest_actual_value_resolver_contract_evidence: latestContractEvidence,
    source_index_artifact_type: index.artifact_type,
    item_count: items.length,
    pending_count: pendingCount,
    recorded_count: recordedCount,
    replay_replacement_count: replayReplacementItems.length,
    replay_replacement_items: replayReplacementItems,
    saved_actual_value_replacement_readback_count: savedReplacementReadbackEvidenceRows.length,
    latest_actual_value_replacement_readback_evidence_id: latestReplacementReadbackEvidence?.evidence_id || null,
    latest_actual_value_replacement_readback_evidence: latestReplacementReadbackEvidence,
    saved_section_to_artifacts_consumer_intake_smoke_count: savedConsumerIntakeSmokeEvidenceRows.length,
    latest_section_to_artifacts_consumer_intake_smoke_evidence_id: latestConsumerIntakeSmokeEvidence?.evidence_id || null,
    latest_section_to_artifacts_consumer_intake_smoke_evidence: latestConsumerIntakeSmokeEvidence,
    sam31_consumer_intake_smoke_followup_reviews_recorded: consumerIntakeSmokeFollowupReviewsRecorded,
    sam31_consumer_intake_smoke_followup_resolver_queue_items: consumerIntakeSmokeFollowupResolverQueueItemCount,
    summary: {
      item_count: items.length,
      pending_count: pendingCount,
      recorded_count: recordedCount,
      sam31_consumer_intake_smoke_followup_reviews_recorded: consumerIntakeSmokeFollowupReviewsRecorded,
      sam31_consumer_intake_smoke_followup_resolver_queue_items: consumerIntakeSmokeFollowupResolverQueueItemCount,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    acceptable_actual_evidence: [
      '1881 proposal workbook row or sheet reference',
      'reviewed vector overlay SVG or marked-up plan ref',
      'reviewed 3D model candidate ref or model note',
      'screenshot or console evidence for the reviewed SAM31 section',
    ],
    items,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function openClawSam31SectionToArtifactsConsumerHandoff(item, replacementEvidence) {
  const summary = replacementEvidence?.openclaw_sam31_section_to_artifacts_summary || null;
  if (!summary || typeof summary !== 'object') return null;
  return {
    artifact_type: 'openclaw.sam31.section_to_artifacts_consumer_handoff.v1',
    status: 'ready_for_consumer_review',
    source_runtime: 'sam-3.1+llm',
    source_openclaw_sam31_consumer_review_evidence_id: item?.source_openclaw_sam31_consumer_review_evidence_id || null,
    source_replay_evidence_id: replacementEvidence?.source_replay_evidence_id || null,
    source_sam31_actual_value_replacement_evidence_id: replacementEvidence?.evidence_id || null,
    source_openclaw_sam31_section_to_artifacts_ref: summary.section_to_artifacts_contract_ref || null,
    source_refs: uniqueStrings([
      ...(Array.isArray(replacementEvidence?.source_refs) ? replacementEvidence.source_refs : []),
      replacementEvidence?.source_ref,
      item?.source_ref,
      item?.replacement_ref,
    ].filter(Boolean)),
    supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
    supported_applications: ['halo_fire', 'landscout', 'nameforge'],
    vector_overlay_count: Number(summary.vector_overlay_count || 0) || 0,
    model_3d_candidate_count: Number(summary.model_3d_candidate_count || 0) || 0,
    segment_count: Number(summary.segment_count || 0) || 0,
    object_hypothesis_count: Number(summary.object_hypothesis_count || 0) || 0,
    openclaw_sam31_section_to_artifacts_summary: summary,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    blocked_claims: [
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'manufacturer_exact',
      'AutoSprink_parity',
      'survey_grade',
      'brand_ready',
      'production_ready',
    ],
    limitations: [
      'This handoff lets HaloFire, LandScout, and NameForge consume replacement-derived SAM31 vectors/models as review evidence.',
      'It does not clear regulated, survey-grade, brand-ready, production-ready, AHJ, professional, manufacturer, or AutoSprink claims.',
    ],
  };
}

function buildOpenClawSam31SectionToArtifactsConsumerIntakeSmoke(projectName, intake = {}, user = null) {
  const consumer = String(intake.consumer || '').trim().toLowerCase();
  const supportedConsumers = ['halo_fire', 'landscout', 'nameforge'];
  if (!supportedConsumers.includes(consumer)) {
    const err = new Error('consumer must be one of halo_fire, landscout, or nameforge');
    err.httpStatus = 400;
    throw err;
  }
  const sourceReplacementEvidenceId = Number(
    intake.source_sam31_actual_value_replacement_evidence_id
    || intake.source_actual_value_replacement_evidence_id
    || intake.source_sam31_replacement_evidence_id
    || 0,
  ) || null;
  const sourceReviewEvidenceId = Number(intake.source_openclaw_sam31_consumer_review_evidence_id || 0) || null;
  if (!sourceReplacementEvidenceId && !sourceReviewEvidenceId) {
    const err = new Error('source_sam31_actual_value_replacement_evidence_id or source_openclaw_sam31_consumer_review_evidence_id is required');
    err.httpStatus = 400;
    throw err;
  }
  const queue = buildOpenClawSam31ActualValueResolverQueue(projectName, { consumer });
  const candidateItems = [
    ...(Array.isArray(queue.items) ? queue.items : []),
    ...(Array.isArray(queue.replay_replacement_items) ? queue.replay_replacement_items : []),
  ];
  const item = candidateItems.find((candidate) => {
    const handoff = candidate.section_to_artifacts_consumer_handoff || null;
    if (!handoff) return false;
    if (sourceReplacementEvidenceId && Number(handoff.source_sam31_actual_value_replacement_evidence_id) !== sourceReplacementEvidenceId) return false;
    if (sourceReviewEvidenceId && Number(handoff.source_openclaw_sam31_consumer_review_evidence_id) !== sourceReviewEvidenceId) return false;
    return true;
  }) || null;
  if (!item) {
    const err = new Error('SAM31 section-to-artifacts handoff was not found for the requested consumer/source evidence');
    err.httpStatus = 404;
    throw err;
  }
  const handoff = item.section_to_artifacts_consumer_handoff || null;
  if (!handoff) {
    const err = new Error('SAM31 section-to-artifacts handoff is missing for the requested resolver queue item');
    err.httpStatus = 400;
    throw err;
  }
  const evidenceSuffix = handoff.source_sam31_actual_value_replacement_evidence_id
    || handoff.source_openclaw_sam31_consumer_review_evidence_id
    || 'unknown';
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'halofire-project';
  return {
    artifact_type: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
    status: 'consumer_handoff_observed',
    project_name: projectName,
    consumer,
    consumer_adapter: `openclaw.sam31.consumer_review_queue.${consumer}.v1`,
    source_runtime: 'sam-3.1+llm',
    source_queue_item_id: item.id || null,
    source_openclaw_sam31_consumer_review_evidence_id: handoff.source_openclaw_sam31_consumer_review_evidence_id || null,
    source_replay_evidence_id: handoff.source_replay_evidence_id || item.source_replay_evidence_id || null,
    source_sam31_actual_value_replacement_evidence_id: handoff.source_sam31_actual_value_replacement_evidence_id || null,
    source_openclaw_sam31_section_to_artifacts_ref: handoff.source_openclaw_sam31_section_to_artifacts_ref || null,
    source_refs: uniqueStrings([
      ...(Array.isArray(item.source_refs) ? item.source_refs : []),
      ...(Array.isArray(handoff.source_refs) ? handoff.source_refs : []),
      item.source_ref,
    ].filter(Boolean)),
    source_ref: `openclaw://sam31/section-to-artifacts-consumer-intake-smoke/${consumer}/${evidenceSuffix}`,
    source_file: `${slug}-sam31-section-to-artifacts-consumer-intake-smoke-${consumer}-${evidenceSuffix}.json`,
    posted_handoff: jsonClone(handoff),
    observed_vector_overlay_count: Number(handoff.vector_overlay_count || 0) || 0,
    observed_model_3d_candidate_count: Number(handoff.model_3d_candidate_count || 0) || 0,
    observed_segment_count: Number(handoff.segment_count || 0) || 0,
    observed_object_hypothesis_count: Number(handoff.object_hypothesis_count || 0) || 0,
    supported_consumers: Array.isArray(handoff.supported_consumers) ? [...handoff.supported_consumers] : supportedConsumers,
    supported_applications: Array.isArray(handoff.supported_applications) ? [...handoff.supported_applications] : [...SAM31_SUPPORTED_APPLICATIONS],
    recorded_by: user?.username || user?.name || null,
    recorded_at: new Date().toISOString(),
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(handoff.blocked_claims) ? handoff.blocked_claims : []),
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'manufacturer_exact',
      'AutoSprink_parity',
      'survey_grade',
      'brand_ready',
      'production_ready',
    ]),
    limitations: [
      'This smoke proves a downstream consumer adapter can read replacement-derived SAM31 section/vector/model counts.',
      'It is not professional, AHJ, manufacturer, AutoSprink, permit, fabrication, survey-grade, brand, or production approval evidence.',
    ],
  };
}

function buildHalofireSam31ConsumerIntakeSmokeFollowupPacket(projectName, smokeEvidence) {
  if (!smokeEvidence) {
    const err = new Error('Saved SAM31 section-to-artifacts consumer intake smoke evidence not found');
    err.httpStatus = 404;
    throw err;
  }
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'halofire-project';
  const evidenceId = smokeEvidence.evidence_id || 'unknown';
  const sourceConsumer = smokeEvidence.consumer || 'unknown';
  const supportedSprinklerReviewLanes = [
    'room_boundary_visual_audit',
    'obstruction_or_clash_review',
    'vector_overlay_generation',
    'model_3d_candidate_generation',
  ];
  const sourceRefs = [
    ...(Array.isArray(smokeEvidence.source_refs) ? smokeEvidence.source_refs : []),
    {
      evidence_id: smokeEvidence.evidence_id || null,
      evidence_type: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
      artifact_type: smokeEvidence.artifact_type || 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
      source_ref: smokeEvidence.source_ref || null,
      source_file: smokeEvidence.source_file || null,
    },
    smokeEvidence.source_replay_evidence_id ? {
      evidence_id: smokeEvidence.source_replay_evidence_id,
      evidence_type: 'best_effort_ai_layout',
    } : null,
    smokeEvidence.source_sam31_actual_value_replacement_evidence_id ? {
      evidence_id: smokeEvidence.source_sam31_actual_value_replacement_evidence_id,
      evidence_type: 'sam31_actual_value_replacement',
    } : null,
    smokeEvidence.source_openclaw_sam31_consumer_review_evidence_id ? {
      evidence_id: smokeEvidence.source_openclaw_sam31_consumer_review_evidence_id,
      evidence_type: 'openclaw_sam31_consumer_review',
    } : null,
  ].filter(Boolean);
  const issueBase = {
    artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_queue_item.v1',
    status: 'requires_employee_sprinkler_followup_review',
    project_name: projectName,
    source_consumer: sourceConsumer,
    target_application: 'halo_fire',
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: smokeEvidence.evidence_id || null,
    source_replay_evidence_id: smokeEvidence.source_replay_evidence_id || null,
    source_sam31_actual_value_replacement_evidence_id: smokeEvidence.source_sam31_actual_value_replacement_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: smokeEvidence.source_openclaw_sam31_consumer_review_evidence_id || null,
    source_openclaw_sam31_section_to_artifacts_ref: smokeEvidence.source_openclaw_sam31_section_to_artifacts_ref || null,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
  return {
    artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_packet.v1',
    status: 'requires_employee_sprinkler_followup_review',
    project_name: projectName,
    source_consumer: sourceConsumer,
    target_application: 'halo_fire',
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: smokeEvidence.evidence_id || null,
    source_replay_evidence_id: smokeEvidence.source_replay_evidence_id || null,
    source_sam31_actual_value_replacement_evidence_id: smokeEvidence.source_sam31_actual_value_replacement_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: smokeEvidence.source_openclaw_sam31_consumer_review_evidence_id || null,
    source_openclaw_sam31_section_to_artifacts_ref: smokeEvidence.source_openclaw_sam31_section_to_artifacts_ref || null,
    source_ref: `halofire://sam31/consumer-intake-smoke-followup/${sourceConsumer}/${evidenceId}`,
    download_name: `${slug}-sam31-consumer-intake-smoke-followup-${sourceConsumer}-${evidenceId}.json`,
    observed_vector_overlay_count: smokeEvidence.observed_vector_overlay_count || 0,
    observed_model_3d_candidate_count: smokeEvidence.observed_model_3d_candidate_count || 0,
    observed_segment_count: smokeEvidence.observed_segment_count || 0,
    observed_object_hypothesis_count: smokeEvidence.observed_object_hypothesis_count || 0,
    supported_sprinkler_review_lanes: supportedSprinklerReviewLanes,
    issue_seeds: [
      {
        ...issueBase,
        issue_type: 'sam31_consumer_intake_room_boundary_visual_audit',
        supported_sprinkler_review_lane: 'room_boundary_visual_audit',
        observed: `Saved ${sourceConsumer} SAM31 consumer-intake smoke reports ${smokeEvidence.observed_segment_count || 0} segments and ${smokeEvidence.observed_object_hypothesis_count || 0} object hypotheses.`,
        expected: 'HaloFire employee verifies room boundaries against the 1881 floor-plan packet or corrected employee review packet.',
        required_action: 'Review the source-linked room boundary/vector context before using it in sprinkler layout decisions.',
      },
      {
        ...issueBase,
        issue_type: 'sam31_consumer_intake_obstruction_clash_review',
        supported_sprinkler_review_lane: 'obstruction_or_clash_review',
        observed: `Saved ${sourceConsumer} SAM31 consumer-intake smoke reports ${smokeEvidence.observed_vector_overlay_count || 0} vector overlays and ${smokeEvidence.observed_model_3d_candidate_count || 0} 3D model candidates.`,
        expected: 'HaloFire employee checks obstruction, clash, sleeve, firestop, vector overlay, and model candidates before export.',
        required_action: 'Convert reviewed candidates into a HaloFire sprinkler review packet or keep the issue open.',
      },
    ],
    source_refs: sourceRefs,
    acceptable_employee_evidence: [
      '1881 proposal workbook/sheet reference tied to the reviewed area',
      'corrected room-boundary packet or marked-up plan reference',
      'reviewed vector overlay SVG or CAD layer reference',
      'reviewed 3D model candidate, screenshot, or console evidence',
      'employee sprinkler obstruction/clash notes',
    ],
    blocked_claims: uniqueStrings([
      ...(Array.isArray(smokeEvidence.blocked_claims) ? smokeEvidence.blocked_claims : []),
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'manufacturer_exact',
      'AutoSprink_parity',
      'engineering_grade',
    ]),
    limitations: [
      'This packet starts a HaloFire internal-alpha sprinkler follow-up review from saved SAM31 consumer-intake smoke evidence.',
      'It carries source-linked SAM31+LLM observations only; it does not clear professional, AHJ, manufacturer, AutoSprink, permit, fabrication, or engineering-grade claims.',
    ],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function buildHalofireSam31ConsumerIntakeSmokeFollowupResolverRows(projectName, sourcePacket, reviewDecision, reviewEvidenceId) {
  const issueSeeds = Array.isArray(sourcePacket.issue_seeds) ? sourcePacket.issue_seeds : [];
  const issueDecisions = Array.isArray(reviewDecision.issue_decisions) ? reviewDecision.issue_decisions : [];
  const decisionByIssue = new Map();
  const decisionByLane = new Map();
  for (const decision of issueDecisions) {
    if (!decision || typeof decision !== 'object') continue;
    const issueType = String(decision.issue_type || '').trim();
    const lane = String(decision.supported_sprinkler_review_lane || '').trim();
    if (issueType && !decisionByIssue.has(issueType)) decisionByIssue.set(issueType, decision);
    if (lane && !decisionByLane.has(lane)) decisionByLane.set(lane, decision);
  }
  return issueSeeds.map((seed, index) => {
    const issueDecision = decisionByIssue.get(seed.issue_type)
      || decisionByLane.get(seed.supported_sprinkler_review_lane)
      || {};
    const decision = String(issueDecision.decision || reviewDecision.review_decision || 'accepted_internal_alpha_followup').trim().toLowerCase();
    const rejected = decision.includes('reject') || decision.includes('needs_more_evidence');
    return {
      artifact_type: HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_RESOLVER_QUEUE_ITEM_TYPE,
      id: `${sourcePacket.source_ref || 'halofire-sam31-consumer-smoke-followup'}:resolver:${index}`,
      status: rejected ? 'requires_employee_sprinkler_followup_review' : 'ready_for_internal_alpha_sprinkler_review',
      project_name: projectName,
      source_runtime: 'sam-3.1+llm',
      source_consumer: sourcePacket.source_consumer || null,
      target_application: 'halo_fire',
      source_packet_artifact_type: sourcePacket.artifact_type,
      source_packet_queue_item_artifact_type: seed.artifact_type || 'halofire.sam31_consumer_intake_smoke_followup_queue_item.v1',
      source_halofire_sam31_consumer_intake_smoke_followup_review_artifact_type: reviewDecision.artifact_type || HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_REVIEW_DECISION_TYPE,
      source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: Number(reviewEvidenceId || reviewDecision.evidence_id || 0) || null,
      source_section_to_artifacts_consumer_intake_smoke_evidence_id: sourcePacket.source_section_to_artifacts_consumer_intake_smoke_evidence_id || null,
      source_replay_evidence_id: sourcePacket.source_replay_evidence_id || null,
      source_sam31_actual_value_replacement_evidence_id: sourcePacket.source_sam31_actual_value_replacement_evidence_id || null,
      source_openclaw_sam31_consumer_review_evidence_id: sourcePacket.source_openclaw_sam31_consumer_review_evidence_id || null,
      source_openclaw_sam31_section_to_artifacts_ref: sourcePacket.source_openclaw_sam31_section_to_artifacts_ref || null,
      issue_type: seed.issue_type || issueDecision.issue_type || null,
      supported_sprinkler_review_lane: seed.supported_sprinkler_review_lane || issueDecision.supported_sprinkler_review_lane || null,
      issue_index: index,
      review_decision: reviewDecision.review_decision,
      issue_decision: decision,
      reviewer_name: reviewDecision.reviewer_name,
      reviewed_at: reviewDecision.reviewed_at,
      review_ref: reviewDecision.review_ref,
      marked_up_screenshot_ref: reviewDecision.marked_up_screenshot_ref || null,
      reviewed_values: issueDecision.reviewed_values && typeof issueDecision.reviewed_values === 'object'
        ? jsonClone(issueDecision.reviewed_values)
        : {},
      observed: seed.observed || null,
      expected: seed.expected || null,
      required_action: seed.required_action || issueDecision.required_action || null,
      next_action: rejected
        ? 'Employee review rejected or requested more evidence; keep this follow-up queue item open and keep regulated claims blocked.'
        : 'Use the accepted internal-alpha employee review as a sprinkler review input while keeping regulated claims blocked.',
      acceptable_evidence: Array.isArray(sourcePacket.acceptable_employee_evidence)
        ? [...sourcePacket.acceptable_employee_evidence]
        : [],
      source_refs: uniqueByJson([
        ...(Array.isArray(sourcePacket.source_refs) ? sourcePacket.source_refs : []),
        ...(Array.isArray(reviewDecision.source_refs) ? reviewDecision.source_refs : []),
      ]),
      blocked_claims: Array.isArray(reviewDecision.blocked_claims) ? [...reviewDecision.blocked_claims] : [],
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
      limitations: [
        'This resolver row is internal-alpha employee review routing only.',
        'It does not clear professional, AHJ, manufacturer, AutoSprink, permit, fabrication, or engineering-grade claims.',
      ],
    };
  });
}

function buildHalofireSam31ConsumerIntakeSmokeSprinklerReviewPacket(projectName, smokeEvidence, reviewEvidence) {
  if (!smokeEvidence) {
    const err = new Error('Saved SAM31 section-to-artifacts consumer intake smoke evidence not found');
    err.httpStatus = 404;
    throw err;
  }
  if (!reviewEvidence?.evidence || !reviewEvidence?.review) {
    const err = new Error('Saved HaloFire SAM31 consumer intake smoke follow-up review evidence is required before downloading the sprinkler review packet');
    err.httpStatus = 409;
    throw err;
  }
  const review = reviewEvidence.review;
  const resolverRows = Array.isArray(review.resolver_queue_rows) ? review.resolver_queue_rows : [];
  if (!resolverRows.length) {
    const err = new Error('Saved HaloFire SAM31 consumer intake smoke follow-up resolver rows are required before downloading the sprinkler review packet');
    err.httpStatus = 409;
    throw err;
  }
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'halofire-project';
  const sourceConsumer = smokeEvidence.consumer || review.source_consumer || 'unknown';
  const supportedSprinklerReviewLanes = uniqueStrings([
    ...resolverRows.map((row) => row.supported_sprinkler_review_lane).filter(Boolean),
    'room_boundary_visual_audit',
    'obstruction_or_clash_review',
  ]);
  const latestDecisionByQueueKey = new Map();
  for (const item of latestHalofireSam31SmokeSprinklerReviewDecisionEvidence(
    projectName,
    smokeEvidence.evidence_id,
    reviewEvidence.evidence.id,
  )) {
    if (!item?.review) continue;
    latestDecisionByQueueKey.set(
      `${item.review.issue_type || ''}::${item.review.supported_sprinkler_review_lane || ''}`,
      item,
    );
  }
  const latestPreliminaryReplayFollowupBySprinklerReviewEvidenceId = new Map();
  for (const item of latestHalofireSam31SprinklerPreliminaryReplayFollowupDecisionEvidence(
    projectName,
    smokeEvidence.evidence_id,
  )) {
    if (!item?.followup) continue;
    latestPreliminaryReplayFollowupBySprinklerReviewEvidenceId.set(
      Number(item.followup.source_halofire_sam31_sprinkler_review_decision_evidence_id),
      item,
    );
  }
  const latestPacketReviewDecisionEvidences = latestHalofireSam31SprinklerFollowupPacketReviewDecisionEvidence(
    projectName,
    smokeEvidence.evidence_id,
  );
  const latestApprovalUploadIntakeEvidences = latestHalofireSam31ApprovalUploadIntakeEvidence(
    projectName,
    smokeEvidence.evidence_id,
  );
  const issueSeeds = resolverRows.map((row, index) => ({
    artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_QUEUE_ITEM_TYPE,
    id: `${row.id || `consumer-smoke-followup:${reviewEvidence.evidence.id}`}:sprinkler:${index}`,
    status: row.status === 'ready_for_internal_alpha_sprinkler_review'
      ? 'requires_employee_sprinkler_review'
      : (row.status || 'requires_employee_sprinkler_review'),
    project_name: projectName,
    source_runtime: row.source_runtime || 'sam-3.1+llm',
    source: HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_RESOLVER_QUEUE_ITEM_TYPE,
    source_followup_resolver_queue_item_id: row.id || null,
    source_followup_resolver_queue_item_artifact_type: row.artifact_type || HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_RESOLVER_QUEUE_ITEM_TYPE,
    source_halofire_sam31_consumer_intake_smoke_followup_review_artifact_type: review.artifact_type || HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_REVIEW_DECISION_TYPE,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: reviewEvidence.evidence.id,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: smokeEvidence.evidence_id || row.source_section_to_artifacts_consumer_intake_smoke_evidence_id || null,
    source_replay_evidence_id: smokeEvidence.source_replay_evidence_id || row.source_replay_evidence_id || null,
    source_sam31_actual_value_replacement_evidence_id: smokeEvidence.source_sam31_actual_value_replacement_evidence_id || row.source_sam31_actual_value_replacement_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: smokeEvidence.source_openclaw_sam31_consumer_review_evidence_id || row.source_openclaw_sam31_consumer_review_evidence_id || null,
    source_openclaw_sam31_section_to_artifacts_ref: smokeEvidence.source_openclaw_sam31_section_to_artifacts_ref || row.source_openclaw_sam31_section_to_artifacts_ref || null,
    consumer: sourceConsumer,
    issue_type: row.issue_type || null,
    supported_sprinkler_review_lane: row.supported_sprinkler_review_lane || null,
    observed: row.observed || null,
    expected: row.expected || null,
    reviewed_values: row.reviewed_values && typeof row.reviewed_values === 'object' ? jsonClone(row.reviewed_values) : {},
    required_action: row.required_action || 'Employee sprinkler reviewer verifies this SAM31-derived row before it affects bid/CAD/export decisions.',
    next_action: 'Use this source-linked internal-alpha row for room-boundary or obstruction/clash review only; keep regulated claims blocked.',
    acceptable_evidence: Array.isArray(row.acceptable_evidence) ? [...row.acceptable_evidence] : [],
    source_refs: Array.isArray(row.source_refs) ? jsonClone(row.source_refs) : [],
    blocked_claims: Array.isArray(row.blocked_claims) ? [...row.blocked_claims] : [],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    latest_sam31_sprinkler_review_decision: halofireSam31SprinklerReviewDecisionSummary(
      latestDecisionByQueueKey.get(`${row.issue_type || ''}::${row.supported_sprinkler_review_lane || ''}`),
    ),
    latest_sam31_sprinkler_preliminary_replay_followup_decision: halofireSam31SprinklerPreliminaryReplayFollowupSummary(
      latestPreliminaryReplayFollowupBySprinklerReviewEvidenceId.get(
        Number(latestDecisionByQueueKey.get(`${row.issue_type || ''}::${row.supported_sprinkler_review_lane || ''}`)?.evidence?.id),
      ),
      latestPacketReviewDecisionEvidences,
      latestApprovalUploadIntakeEvidences,
    ),
    limitations: [
      'This sprinkler review queue item is sourced from employee-reviewed SAM31 consumer intake smoke follow-up rows.',
      'It cannot clear professional, AHJ, manufacturer, AutoSprink, permit, fabrication, or engineering-grade claims.',
    ],
  }));
  const sourceRefs = uniqueByJson([
    ...(Array.isArray(smokeEvidence.source_refs) ? smokeEvidence.source_refs : []),
    {
      evidence_id: smokeEvidence.evidence_id || null,
      evidence_type: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
      artifact_type: smokeEvidence.artifact_type || 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
      source_ref: smokeEvidence.source_ref || null,
      source_file: smokeEvidence.source_file || null,
    },
    smokeEvidence.source_replay_evidence_id ? {
      evidence_id: smokeEvidence.source_replay_evidence_id,
      evidence_type: 'best_effort_ai_layout',
    } : null,
    smokeEvidence.source_sam31_actual_value_replacement_evidence_id ? {
      evidence_id: smokeEvidence.source_sam31_actual_value_replacement_evidence_id,
      evidence_type: 'sam31_actual_value_replacement',
    } : null,
    {
      evidence_id: reviewEvidence.evidence.id,
      evidence_type: reviewEvidence.evidence.evidence_type,
      artifact_type: review.artifact_type || HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_REVIEW_DECISION_TYPE,
      source_ref: reviewEvidence.evidence.source_ref || review.review_ref || null,
      source_file: reviewEvidence.evidence.source_file || null,
    },
    ...resolverRows.flatMap((row) => (Array.isArray(row.source_refs) ? row.source_refs : [])),
  ]);
  const blockedClaims = uniqueStrings([
    ...(Array.isArray(smokeEvidence.blocked_claims) ? smokeEvidence.blocked_claims : []),
    ...(Array.isArray(review.blocked_claims) ? review.blocked_claims : []),
    ...resolverRows.flatMap((row) => (Array.isArray(row.blocked_claims) ? row.blocked_claims : [])),
    'permit_ready',
    'fabrication_ready',
    'AHJ_approval',
    'professional_approval',
    'manufacturer_exact',
    'AutoSprink_parity',
    'engineering_grade',
  ]);
  return {
    artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
    source: HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_RESOLVER_QUEUE_ITEM_TYPE,
    status: 'requires_employee_sprinkler_review',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    source_consumer: sourceConsumer,
    target_application: 'halo_fire',
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: smokeEvidence.evidence_id || null,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: reviewEvidence.evidence.id,
    source_replay_evidence_id: smokeEvidence.source_replay_evidence_id || review.source_replay_evidence_id || null,
    source_sam31_actual_value_replacement_evidence_id: smokeEvidence.source_sam31_actual_value_replacement_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: smokeEvidence.source_openclaw_sam31_consumer_review_evidence_id || null,
    source_openclaw_sam31_section_to_artifacts_ref: smokeEvidence.source_openclaw_sam31_section_to_artifacts_ref || null,
    supported_sprinkler_review_lanes: supportedSprinklerReviewLanes,
    issue_seeds: issueSeeds,
    source_refs: sourceRefs,
    download_name: `${slug}-sam31-consumer-intake-smoke-sprinkler-review-${sourceConsumer}-${smokeEvidence.evidence_id || 'evidence'}.json`,
    next_action: 'HaloFire employee reviews room-boundary and obstruction/clash seeds before using them as internal-alpha sprinkler inputs; regulated exports and claims remain blocked.',
    acceptable_evidence: [
      '1881 floor-plan/proposal workbook row or sheet reference tied to the reviewed area',
      'corrected employee room-boundary packet or marked-up plan reference',
      'reviewed vector overlay SVG/CAD layer reference',
      'reviewed 3D model candidate, screenshot, console evidence, or obstruction/clash notes',
    ],
    blocked_claims: blockedClaims,
    limitations: [
      'This packet converts saved SAM31 consumer intake smoke follow-up resolver rows into HaloFire sprinkler review seeds only.',
      'It does not clear permit-ready, fabrication-ready, AHJ-ready, professional approval, manufacturer-exact, engineering-grade, or AutoSprink parity claims.',
    ],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function normalizeHalofireSam31ConsumerIntakeSmokeSprinklerReviewDecision(projectName, smokeEvidence, followupReviewEvidence, sprinklerPacket, body = {}, user = {}) {
  if (!smokeEvidence) {
    const e = new Error('Saved SAM31 section-to-artifacts consumer intake smoke evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!followupReviewEvidence?.evidence || !followupReviewEvidence?.review) {
    const e = new Error('Saved HaloFire SAM31 consumer intake smoke follow-up review evidence is required before saving the sprinkler review decision');
    e.httpStatus = 409;
    throw e;
  }
  if (!sprinklerPacket || sprinklerPacket.artifact_type !== HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE) {
    const e = new Error('HaloFire SAM31 smoke sprinkler review packet is required before saving the sprinkler review decision');
    e.httpStatus = 409;
    throw e;
  }
  const issueType = String(body.issue_type || '').trim();
  const supportedSprinklerReviewLane = String(body.supported_sprinkler_review_lane || '').trim();
  const queueItem = (Array.isArray(sprinklerPacket.issue_seeds) ? sprinklerPacket.issue_seeds : [])
    .find((item) => item.issue_type === issueType && item.supported_sprinkler_review_lane === supportedSprinklerReviewLane);
  if (!queueItem) {
    const e = new Error('issue_type and supported_sprinkler_review_lane must match a smoke-derived SAM31 sprinkler review packet issue seed');
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
    const e = new Error('review_ref is required for SAM31 smoke sprinkler review decision evidence');
    e.httpStatus = 400;
    throw e;
  }
  const screenshotRef = String(body.screenshot_ref || '').trim();
  const consoleLogRef = String(body.console_log_ref || '').trim();
  if (!screenshotRef && !consoleLogRef) {
    const e = new Error('screenshot_ref or console_log_ref is required for SAM31 smoke sprinkler review decision evidence');
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
      evidence_id: smokeEvidence.evidence_id || null,
      evidence_type: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
      artifact_type: smokeEvidence.artifact_type || 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
      source_file: smokeEvidence.source_file || null,
      source_ref: smokeEvidence.source_ref || null,
      status: smokeEvidence.status || 'present',
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_id: followupReviewEvidence.evidence.id,
      evidence_type: followupReviewEvidence.evidence.evidence_type,
      artifact_type: followupReviewEvidence.review.artifact_type || HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_REVIEW_DECISION_TYPE,
      source_file: followupReviewEvidence.evidence.source_file || null,
      source_ref: followupReviewEvidence.evidence.source_ref || followupReviewEvidence.review.review_ref || null,
      status: followupReviewEvidence.evidence.status,
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
      evidence_type: 'employee_sam31_smoke_sprinkler_review_payload',
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
    source_sprinkler_review_packet_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
    source_sprinkler_review_packet_ref: sprinklerPacket.source_ref || sprinklerPacket.download_name || null,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: smokeEvidence.evidence_id || null,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: followupReviewEvidence.evidence.id,
    source_replay_evidence_id: smokeEvidence.source_replay_evidence_id || sprinklerPacket.source_replay_evidence_id || queueItem.source_replay_evidence_id || null,
    source_sam31_actual_value_replacement_evidence_id: smokeEvidence.source_sam31_actual_value_replacement_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: smokeEvidence.source_openclaw_sam31_consumer_review_evidence_id || null,
    source_openclaw_sam31_section_to_artifacts_ref: smokeEvidence.source_openclaw_sam31_section_to_artifacts_ref || null,
    source_application: 'halo_fire',
    consumer: smokeEvidence.consumer || sprinklerPacket.source_consumer || null,
    issue_type: issueType,
    issue_count: 1,
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
      ...(Array.isArray(sprinklerPacket.blocked_claims) ? sprinklerPacket.blocked_claims : []),
      'permit_ready',
      'professional_approval',
      'AHJ_approval',
      'AutoSprink_parity',
      'fabrication_ready',
      'manufacturer_exact',
      'engineering_grade',
    ]),
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: [
      'This decision records HaloFire employee review of one smoke-derived SAM31 sprinkler review packet issue seed for internal-alpha use only.',
      'It can accept or replace temporary room-boundary, obstruction, sleeve/firestop, vector, or 3D model candidate values, but it does not clear regulated claims.',
    ],
  };
}

function buildHalofireSam31ConsumerIntakeSmokePreliminaryReplayInputs(projectName, smokeEvidence, followupReviewEvidence, sprinklerReviewEvidence, sprinklerReview) {
  if (!smokeEvidence) {
    const e = new Error('Saved SAM31 section-to-artifacts consumer intake smoke evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!followupReviewEvidence?.evidence || !followupReviewEvidence?.review) {
    const e = new Error('Saved HaloFire SAM31 consumer intake smoke follow-up review evidence is required before downloading preliminary replay inputs');
    e.httpStatus = 409;
    throw e;
  }
  if (!sprinklerReviewEvidence || !sprinklerReview) {
    const e = new Error('HaloFire SAM31 smoke sprinkler review decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (Number(sprinklerReview.source_section_to_artifacts_consumer_intake_smoke_evidence_id) !== Number(smokeEvidence.evidence_id)) {
    const e = new Error('SAM31 smoke sprinkler review decision does not belong to the requested consumer intake smoke evidence');
    e.httpStatus = 409;
    throw e;
  }
  if (Number(sprinklerReview.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id) !== Number(followupReviewEvidence.evidence.id)) {
    const e = new Error('SAM31 smoke sprinkler review decision does not belong to the latest consumer intake smoke follow-up review evidence');
    e.httpStatus = 409;
    throw e;
  }
  const reviewedValues = sprinklerReview.reviewed_values && typeof sprinklerReview.reviewed_values === 'object'
    ? jsonClone(sprinklerReview.reviewed_values)
    : {};
  const issueCandidates = halofireSam31SprinklerReplayIssueCandidates(reviewedValues);
  const lane = sprinklerReview.supported_sprinkler_review_lane || 'sprinkler_employee_review';
  const sourceRefs = uniqueByJson([
    ...(Array.isArray(smokeEvidence.source_refs) ? smokeEvidence.source_refs : []),
    ...(Array.isArray(followupReviewEvidence.review.source_refs) ? followupReviewEvidence.review.source_refs : []),
    ...(Array.isArray(sprinklerReview.source_refs) ? sprinklerReview.source_refs : []),
    {
      evidence_id: smokeEvidence.evidence_id || null,
      evidence_type: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
      artifact_type: smokeEvidence.artifact_type || 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
      source_ref: smokeEvidence.source_ref || null,
      source_file: smokeEvidence.source_file || null,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_id: followupReviewEvidence.evidence.id,
      evidence_type: followupReviewEvidence.evidence.evidence_type,
      artifact_type: followupReviewEvidence.review.artifact_type || HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_REVIEW_DECISION_TYPE,
      source_ref: followupReviewEvidence.evidence.source_ref || followupReviewEvidence.review.review_ref || null,
      source_file: followupReviewEvidence.evidence.source_file || null,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_id: sprinklerReviewEvidence.id,
      evidence_type: sprinklerReviewEvidence.evidence_type,
      artifact_type: sprinklerReview.artifact_type || HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_TYPE,
      source_ref: sprinklerReviewEvidence.source_ref || sprinklerReview.review_ref || null,
      source_file: sprinklerReviewEvidence.source_file || null,
      claim_gate_effect: 'no_claims_cleared',
    },
  ]);
  const blockedClaims = uniqueStrings([
    ...(Array.isArray(smokeEvidence.blocked_claims) ? smokeEvidence.blocked_claims : []),
    ...(Array.isArray(followupReviewEvidence.review.blocked_claims) ? followupReviewEvidence.review.blocked_claims : []),
    ...(Array.isArray(sprinklerReview.blocked_claims) ? sprinklerReview.blocked_claims : []),
    'permit_ready',
    'fabrication_ready',
    'AHJ_approval',
    'professional_approval',
    'manufacturer_exact',
    'AutoSprink_parity',
    'engineering_grade',
  ]);
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'halofire-project';
  return {
    artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PRELIMINARY_REPLAY_INPUTS_TYPE,
    status: 'requires_internal_alpha_replay',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    source: HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_TYPE,
    source_sprinkler_review_packet_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
    source_decision_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_TYPE,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: smokeEvidence.evidence_id || null,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: followupReviewEvidence.evidence.id,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: sprinklerReviewEvidence.id,
    source_sam31_actual_value_replacement_evidence_id: smokeEvidence.source_sam31_actual_value_replacement_evidence_id || sprinklerReview.source_sam31_actual_value_replacement_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: smokeEvidence.source_openclaw_sam31_consumer_review_evidence_id || sprinklerReview.source_openclaw_sam31_consumer_review_evidence_id || null,
    source_openclaw_sam31_section_to_artifacts_ref: smokeEvidence.source_openclaw_sam31_section_to_artifacts_ref || sprinklerReview.source_openclaw_sam31_section_to_artifacts_ref || null,
    consumer: smokeEvidence.consumer || sprinklerReview.consumer || null,
    issue_type: sprinklerReview.issue_type || null,
    supported_sprinkler_review_lane: lane,
    replay_scope: halofireSam31SprinklerReplayScope(lane),
    review_decision: sprinklerReview.review_decision || null,
    reviewed_values: reviewedValues,
    issue_candidates: issueCandidates,
    candidate_rows: issueCandidates,
    source_refs: sourceRefs,
    download_name: `${slug}-sam31-consumer-intake-smoke-preliminary-replay-inputs-${smokeEvidence.consumer || 'consumer'}-${sprinklerReviewEvidence.id}.json`,
    next_action: 'Run internal-alpha preliminary replay against these smoke-derived reviewed values, then record employee follow-up evidence; regulated claims remain blocked.',
    acceptable_evidence: uniqueStrings([
      ...(Array.isArray(sprinklerReview.acceptable_evidence) ? sprinklerReview.acceptable_evidence : []),
      'HaloFire employee preliminary replay review',
      'marked-up obstruction/clash or sleeve/firestop screenshot',
      'source-linked vector overlay or 3D candidate review packet',
      'professional/AHJ/manufacturer evidence for any regulated claim',
    ]),
    blocked_claims: blockedClaims,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: uniqueStrings([
      ...(Array.isArray(sprinklerReview.limitations) ? sprinklerReview.limitations : []),
      'These preliminary replay inputs are sourced from smoke-derived SAM31+LLM rows and employee review only.',
      'They cannot clear permit-ready, fabrication-ready, AHJ-ready, professional approval, manufacturer-exact, engineering-grade, or AutoSprink parity claims.',
    ]),
  };
}

function buildHalofireSam31ConsumerIntakeSmokePreliminaryReplayArtifact(projectName, smokeEvidence, followupReviewEvidence, sprinklerReviewEvidence, sprinklerReview) {
  const replayInputs = buildHalofireSam31ConsumerIntakeSmokePreliminaryReplayInputs(
    projectName,
    smokeEvidence,
    followupReviewEvidence,
    sprinklerReviewEvidence,
    sprinklerReview,
  );
  const issueCandidates = Array.isArray(replayInputs.issue_candidates)
    ? jsonClone(replayInputs.issue_candidates)
    : [];
  return {
    artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_ARTIFACT_TYPE,
    status: 'preliminary_replay_ready_for_internal_alpha_review',
    source: HALOFIRE_SAM31_SPRINKLER_REVIEW_PRELIMINARY_REPLAY_INPUTS_TYPE,
    source_preliminary_replay_inputs_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PRELIMINARY_REPLAY_INPUTS_TYPE,
    source_sprinkler_review_packet_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
    source_decision_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_TYPE,
    project_name: projectName,
    generated_at: new Date().toISOString(),
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: replayInputs.source_section_to_artifacts_consumer_intake_smoke_evidence_id,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: replayInputs.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: replayInputs.source_halofire_sam31_sprinkler_review_decision_evidence_id,
    source_sam31_actual_value_replacement_evidence_id: replayInputs.source_sam31_actual_value_replacement_evidence_id,
    source_openclaw_sam31_consumer_review_evidence_id: replayInputs.source_openclaw_sam31_consumer_review_evidence_id,
    source_openclaw_sam31_section_to_artifacts_ref: replayInputs.source_openclaw_sam31_section_to_artifacts_ref,
    consumer: replayInputs.consumer,
    issue_type: replayInputs.issue_type,
    supported_sprinkler_review_lane: replayInputs.supported_sprinkler_review_lane,
    replay_scope: replayInputs.replay_scope,
    review_decision: replayInputs.review_decision,
    download_name: replayInputs.download_name
      ? replayInputs.download_name.replace('-preliminary-replay-inputs-', '-preliminary-replay-')
      : `${slugForDownloadName(projectName)}-sam31-consumer-intake-smoke-preliminary-replay-${sprinklerReviewEvidence.id}.json`,
    replay_inputs: replayInputs,
    replay_output: {
      artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_OUTPUT_TYPE,
      status: 'requires_employee_or_professional_followup',
      project_name: projectName,
      source_preliminary_replay_inputs_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PRELIMINARY_REPLAY_INPUTS_TYPE,
      source_section_to_artifacts_consumer_intake_smoke_evidence_id: replayInputs.source_section_to_artifacts_consumer_intake_smoke_evidence_id,
      source_halofire_sam31_sprinkler_review_decision_evidence_id: replayInputs.source_halofire_sam31_sprinkler_review_decision_evidence_id,
      supported_sprinkler_review_lane: replayInputs.supported_sprinkler_review_lane,
      replay_scope: replayInputs.replay_scope,
      issue_candidates: issueCandidates,
      issue_candidate_count: issueCandidates.length,
      next_action: 'Employee reviews replayed smoke-derived obstruction, clash, sleeve/firestop, vector, or 3D-candidate rows and records follow-up evidence before any regulated claim.',
      use_for_claims: false,
      blocked_claims: Array.isArray(replayInputs.blocked_claims) ? [...replayInputs.blocked_claims] : [],
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    },
    source_refs: Array.isArray(replayInputs.source_refs) ? jsonClone(replayInputs.source_refs) : [],
    use_for_claims: false,
    blocked_claims: Array.isArray(replayInputs.blocked_claims) ? [...replayInputs.blocked_claims] : [],
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: uniqueStrings([
      ...(Array.isArray(replayInputs.limitations) ? replayInputs.limitations : []),
      'This smoke-derived preliminary replay artifact is an internal-alpha execution aid only.',
      'It does not clear AHJ, PE, AutoSprink parity, permit-ready, fabrication-ready, manufacturer-exact, drawing-scale, or geometry-accuracy claims.',
    ]),
  };
}

function buildOpenClawSam31ActualValueResolverQueueReadback(projectName, options = {}) {
  const requestedConsumer = String(options.consumer || '').trim().toLowerCase();
  const sourceReplayEvidenceFilterId = Number(options.sourceReplayEvidenceId || options.source_replay_evidence_id || 0) || null;
  const queue = buildOpenClawSam31ActualValueResolverQueue(projectName, {
    consumer: requestedConsumer,
    contractEvidenceId: options.contractEvidenceId || options.contract_evidence_id,
    replacementReadbackEvidenceId: options.replacementReadbackEvidenceId || options.replacement_readback_evidence_id,
    serviceDescriptorEvidenceId: options.serviceDescriptorEvidenceId || options.service_descriptor_evidence_id,
    consumerIntakeSmokeEvidenceId: options.consumerIntakeSmokeEvidenceId || options.consumer_intake_smoke_evidence_id,
    sourceReplayEvidenceId: sourceReplayEvidenceFilterId,
  });
  const effectiveConsumer = queue.requested_consumer || requestedConsumer;
  const contractEvidenceFilterId = queue.contract_evidence_filter_id || null;
  const replacementReadbackEvidenceFilterId = queue.replacement_readback_evidence_filter_id || null;
  const serviceDescriptorEvidenceFilterId = queue.service_descriptor_evidence_filter_id || null;
  const consumerIntakeSmokeEvidenceFilterId = queue.consumer_intake_smoke_evidence_filter_id || null;
  const projectQuery = [
    effectiveConsumer ? `consumer=${encodeURIComponent(effectiveConsumer)}` : '',
    contractEvidenceFilterId ? `contractEvidenceId=${encodeURIComponent(contractEvidenceFilterId)}` : '',
    replacementReadbackEvidenceFilterId ? `replacementReadbackEvidenceId=${encodeURIComponent(replacementReadbackEvidenceFilterId)}` : '',
    serviceDescriptorEvidenceFilterId ? `serviceDescriptorEvidenceId=${encodeURIComponent(serviceDescriptorEvidenceFilterId)}` : '',
    consumerIntakeSmokeEvidenceFilterId ? `consumerIntakeSmokeEvidenceId=${encodeURIComponent(consumerIntakeSmokeEvidenceFilterId)}` : '',
    sourceReplayEvidenceFilterId ? `sourceReplayEvidenceId=${encodeURIComponent(sourceReplayEvidenceFilterId)}` : '',
  ].filter(Boolean).join('&');
  const globalQuery = [
    `projectName=${encodeURIComponent(projectName)}`,
    effectiveConsumer ? `consumer=${encodeURIComponent(effectiveConsumer)}` : '',
    contractEvidenceFilterId ? `contractEvidenceId=${encodeURIComponent(contractEvidenceFilterId)}` : '',
    replacementReadbackEvidenceFilterId ? `replacementReadbackEvidenceId=${encodeURIComponent(replacementReadbackEvidenceFilterId)}` : '',
    serviceDescriptorEvidenceFilterId ? `serviceDescriptorEvidenceId=${encodeURIComponent(serviceDescriptorEvidenceFilterId)}` : '',
    consumerIntakeSmokeEvidenceFilterId ? `consumerIntakeSmokeEvidenceId=${encodeURIComponent(consumerIntakeSmokeEvidenceFilterId)}` : '',
    sourceReplayEvidenceFilterId ? `sourceReplayEvidenceId=${encodeURIComponent(sourceReplayEvidenceFilterId)}` : '',
  ].filter(Boolean).join('&');
  const sourceProjectRoute = `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-resolver-queue${projectQuery ? `?${projectQuery}` : ''}`;
  const queueHref = `/api/openclaw/sam31/actual-value-resolver-queue?${globalQuery}`;
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'halofire-project';
  const queueReadbackSavedSmokeSuffix = consumerIntakeSmokeEvidenceFilterId
    ? `-saved-smoke-${consumerIntakeSmokeEvidenceFilterId}`
    : '';
  const sourceContractQuery = [
    `projectName=${encodeURIComponent(projectName)}`,
    effectiveConsumer ? `consumer=${encodeURIComponent(effectiveConsumer)}` : '',
    contractEvidenceFilterId ? `contractEvidenceId=${encodeURIComponent(contractEvidenceFilterId)}` : '',
  ].filter(Boolean).join('&');
  const sourceReplacementQuery = [
    `projectName=${encodeURIComponent(projectName)}`,
    effectiveConsumer ? `consumer=${encodeURIComponent(effectiveConsumer)}` : '',
    contractEvidenceFilterId ? `contractEvidenceId=${encodeURIComponent(contractEvidenceFilterId)}` : '',
    serviceDescriptorEvidenceFilterId ? `serviceDescriptorEvidenceId=${encodeURIComponent(serviceDescriptorEvidenceFilterId)}` : '',
    sourceReplayEvidenceFilterId ? `sourceReplayEvidenceId=${encodeURIComponent(sourceReplayEvidenceFilterId)}` : '',
  ].filter(Boolean).join('&');
  const sourceServiceDescriptorQuery = [
    `projectName=${encodeURIComponent(projectName)}`,
    effectiveConsumer ? `consumer=${encodeURIComponent(effectiveConsumer)}` : '',
  ].filter(Boolean).join('&');
  const latestServiceDescriptorEvidence = queue.latest_actual_value_service_descriptor_evidence || null;
  const latestReplacementReadbackEvidence = queue.latest_actual_value_replacement_readback_evidence || null;
  const latestConsumerIntakeSmokeEvidence = queue.latest_section_to_artifacts_consumer_intake_smoke_evidence || null;
  const downloadArtifacts = {
    filtered_queue_readback: {
      artifact_type: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
      href: queueHref,
      download_name: `${slug}-sam31-actual-value-resolver-queue${replacementReadbackEvidenceFilterId ? `-saved-readback-${replacementReadbackEvidenceFilterId}` : ''}${serviceDescriptorEvidenceFilterId ? `-saved-service-descriptor-${serviceDescriptorEvidenceFilterId}` : ''}${queueReadbackSavedSmokeSuffix}.json`,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    saved_replacement_readback_evidence: latestReplacementReadbackEvidence ? {
      artifact_type: latestReplacementReadbackEvidence.artifact_type || 'openclaw.sam31.actual_value_replacement_readback.v1',
      evidence_id: latestReplacementReadbackEvidence.evidence_id || null,
      source_ref: latestReplacementReadbackEvidence.source_ref || null,
      source_file: latestReplacementReadbackEvidence.source_file || null,
      download_name: latestReplacementReadbackEvidence.download_name || latestReplacementReadbackEvidence.source_file || `${slug}-saved-sam31-actual-value-replacement-readback.json`,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    } : null,
    saved_service_descriptor_evidence: latestServiceDescriptorEvidence ? {
      artifact_type: latestServiceDescriptorEvidence.artifact_type || 'openclaw.sam31.actual_value_service_descriptor.v1',
      evidence_id: latestServiceDescriptorEvidence.evidence_id || null,
      source_ref: latestServiceDescriptorEvidence.source_ref || null,
      source_file: latestServiceDescriptorEvidence.source_file || null,
      download_name: latestServiceDescriptorEvidence.download_name || latestServiceDescriptorEvidence.source_file || `${slug}-saved-sam31-actual-value-service-descriptor.json`,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    } : null,
    saved_section_to_artifacts_consumer_intake_smoke_evidence: latestConsumerIntakeSmokeEvidence ? {
      artifact_type: latestConsumerIntakeSmokeEvidence.artifact_type || 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
      evidence_id: latestConsumerIntakeSmokeEvidence.evidence_id || null,
      consumer: latestConsumerIntakeSmokeEvidence.consumer || null,
      source_ref: latestConsumerIntakeSmokeEvidence.source_ref || null,
      source_file: latestConsumerIntakeSmokeEvidence.source_file || null,
      download_name: latestConsumerIntakeSmokeEvidence.download_name || latestConsumerIntakeSmokeEvidence.source_file || `${slug}-saved-sam31-section-to-artifacts-consumer-intake-smoke.json`,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    } : null,
    halofire_consumer_intake_smoke_followup_packet: latestConsumerIntakeSmokeEvidence ? {
      artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_packet.v1',
      evidence_id: latestConsumerIntakeSmokeEvidence.evidence_id || null,
      consumer: latestConsumerIntakeSmokeEvidence.consumer || null,
      href: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/${encodeURIComponent(latestConsumerIntakeSmokeEvidence.evidence_id)}/followup-packet`,
      download_name: `${slug}-sam31-consumer-intake-smoke-followup-${latestConsumerIntakeSmokeEvidence.consumer || 'consumer'}-${latestConsumerIntakeSmokeEvidence.evidence_id || 'evidence'}.json`,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    } : null,
    source_service_descriptor: {
      artifact_type: 'openclaw.sam31.actual_value_service_descriptor.v1',
      href: `/api/openclaw/sam31/actual-value-service?${sourceServiceDescriptorQuery}`,
      download_name: `${slug}-sam31-actual-value-service-descriptor-${effectiveConsumer || 'all-consumers'}.json`,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    source_contract_packet: contractEvidenceFilterId ? {
      artifact_type: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
      evidence_id: contractEvidenceFilterId,
      href: `/api/openclaw/sam31/actual-value-resolver-contract?${sourceContractQuery}`,
      download_name: `${slug}-sam31-actual-value-resolver-contract-${effectiveConsumer || 'all-consumers'}-evidence-${contractEvidenceFilterId}.json`,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    } : null,
    source_replacement_readback: {
      artifact_type: 'openclaw.sam31.actual_value_replacement_readback.v1',
      href: `/api/openclaw/sam31/actual-value-replacements?${sourceReplacementQuery}`,
      download_name: `${slug}-sam31-actual-value-replacement-readback-${effectiveConsumer || 'all-consumers'}${contractEvidenceFilterId ? `-contract-${contractEvidenceFilterId}` : ''}${serviceDescriptorEvidenceFilterId ? `-service-descriptor-${serviceDescriptorEvidenceFilterId}` : ''}.json`,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    filtered_replacement_readback: {
      artifact_type: 'openclaw.sam31.actual_value_replacement_readback.v1',
      href: `/api/openclaw/sam31/actual-value-replacements?${sourceReplacementQuery}`,
      download_name: `${slug}-sam31-actual-value-replacement-readback-${effectiveConsumer || 'all-consumers'}${contractEvidenceFilterId ? `-contract-${contractEvidenceFilterId}` : ''}${serviceDescriptorEvidenceFilterId ? `-service-descriptor-${serviceDescriptorEvidenceFilterId}` : ''}.json`,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
  };
  const recordActualValueReplacementAction = latestReplacementReadbackEvidence ? {
    artifact_type: 'openclaw.sam31.actual_value_replacement_record_action.v1',
    label: 'Record exact replacement evidence from saved context',
    method: 'POST',
    href: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-replacements`,
    consumes: 'halofire.sam31_actual_value_replacement_intake.v1',
    produces: 'halofire.sam31_actual_value_replacement_intake.v1',
    evidence_record_type: 'sam31_actual_value_replacement',
    source_openclaw_sam31_actual_value_replacement_readback_evidence_id: latestReplacementReadbackEvidence.evidence_id || null,
    source_openclaw_sam31_actual_value_resolver_contract_evidence_id: contractEvidenceFilterId
      || latestReplacementReadbackEvidence.source_openclaw_sam31_actual_value_resolver_contract_evidence_id
      || null,
    requested_consumer: latestReplacementReadbackEvidence.requested_consumer || effectiveConsumer || null,
    acceptable_actual_evidence: queue.acceptable_actual_evidence || [
      '1881 proposal workbook row or sheet reference',
      'reviewed vector overlay SVG or marked-up plan ref',
      'reviewed 3D model candidate ref or model note',
      'screenshot or console evidence for the reviewed SAM31 section',
    ],
    actual_value_replacement_prefill: queue.items?.[0]?.actual_value_replacement_prefill || null,
    input_fields: [
      'source_ref',
      'source_file',
      'replacement_values_source_ref',
      'source_refs',
      'notes',
    ],
    blocked_claims: latestReplacementReadbackEvidence.blocked_claims || [
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'manufacturer_exact',
      'AutoSprink_parity',
    ],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  } : null;
  const latestReplacementReadbackEvidenceWithActions = latestReplacementReadbackEvidence ? {
    ...latestReplacementReadbackEvidence,
    download_artifacts: downloadArtifacts,
    record_actual_value_replacement_action: recordActualValueReplacementAction,
  } : null;
  return {
    artifact_type: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
    status: queue.status,
    project_name: projectName,
    requested_consumer: effectiveConsumer || null,
    generated_at: queue.generated_at,
    source_project_route: sourceProjectRoute,
    queue_href: queueHref,
    supported_consumers: queue.supported_consumers,
    consumer_pull_endpoints: openClawSam31ActualValueResolverConsumerPullEndpoints(projectName),
    sam31_llm_extrapolation_contract: queue.sam31_llm_extrapolation_contract,
    service_descriptor_evidence_filter_id: serviceDescriptorEvidenceFilterId,
    consumer_intake_smoke_evidence_filter_id: consumerIntakeSmokeEvidenceFilterId,
    source_replay_evidence_filter_id: sourceReplayEvidenceFilterId,
    latest_actual_value_service_descriptor_evidence_id: queue.latest_actual_value_service_descriptor_evidence_id || null,
    latest_actual_value_service_descriptor_evidence: latestServiceDescriptorEvidence,
    saved_actual_value_service_descriptor_count: queue.saved_actual_value_service_descriptor_count || 0,
    contract_evidence_filter_id: contractEvidenceFilterId,
    replacement_readback_evidence_filter_id: replacementReadbackEvidenceFilterId,
    source_openclaw_sam31_actual_value_resolver_contract_evidence_id: queue.source_openclaw_sam31_actual_value_resolver_contract_evidence_id || null,
    latest_actual_value_resolver_contract_evidence: queue.latest_actual_value_resolver_contract_evidence || null,
    latest_actual_value_replacement_readback_evidence_id: latestReplacementReadbackEvidenceWithActions?.evidence_id
      || queue.latest_actual_value_replacement_readback_evidence_id
      || null,
    latest_actual_value_replacement_readback_evidence: latestReplacementReadbackEvidenceWithActions,
    saved_actual_value_replacement_readback_count: queue.saved_actual_value_replacement_readback_count || 0,
    latest_section_to_artifacts_consumer_intake_smoke_evidence_id: queue.latest_section_to_artifacts_consumer_intake_smoke_evidence_id || null,
    latest_section_to_artifacts_consumer_intake_smoke_evidence: latestConsumerIntakeSmokeEvidence,
    saved_section_to_artifacts_consumer_intake_smoke_count: queue.saved_section_to_artifacts_consumer_intake_smoke_count || 0,
    sam31_consumer_intake_smoke_followup_reviews_recorded: queue.sam31_consumer_intake_smoke_followup_reviews_recorded || 0,
    sam31_consumer_intake_smoke_followup_resolver_queue_items: queue.sam31_consumer_intake_smoke_followup_resolver_queue_items || 0,
    item_count: queue.item_count,
    pending_count: queue.pending_count,
    recorded_count: queue.recorded_count,
    replay_replacement_count: queue.replay_replacement_count || 0,
    replay_replacement_items: Array.isArray(queue.replay_replacement_items)
      ? queue.replay_replacement_items
      : [],
    acceptable_actual_evidence: queue.acceptable_actual_evidence,
    download_artifacts: downloadArtifacts,
    summary: {
      ...(queue.summary && typeof queue.summary === 'object' ? queue.summary : {}),
      sam31_consumer_intake_smoke_followup_reviews_recorded: queue.sam31_consumer_intake_smoke_followup_reviews_recorded || 0,
      sam31_consumer_intake_smoke_followup_resolver_queue_items: queue.sam31_consumer_intake_smoke_followup_resolver_queue_items || 0,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    queue,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: [
      'This readback is a shared OpenClaw queue status contract for HaloFire, LandScout, and NameForge polling.',
      'SAM31+LLM object labels, vector overlays, and 3D candidates remain temporary values until replaced by actual evidence.',
      'Readback status never clears permit-ready, fabrication-ready, AHJ-ready, engineering-grade, AutoSprink parity, professional approval, manufacturer-exact, brand-ready, or production-ready claims.',
    ],
  };
}

function buildOpenClawSam31ActualValueResolverContractPacket(projectName, options = {}) {
  const requestedConsumer = String(options.consumer || '').trim().toLowerCase();
  const queueReadback = buildOpenClawSam31ActualValueResolverQueueReadback(projectName, {
    consumer: requestedConsumer,
    contractEvidenceId: options.contractEvidenceId || options.contract_evidence_id,
    replacementReadbackEvidenceId: options.replacementReadbackEvidenceId || options.replacement_readback_evidence_id,
  });
  const effectiveConsumer = queueReadback.requested_consumer || requestedConsumer;
  const contract = queueReadback.sam31_llm_extrapolation_contract
    || openClawSam31ActualValueResolverExtrapolationContract(projectName);
  const consumerPullEndpoint = effectiveConsumer
    ? queueReadback.consumer_pull_endpoints?.[effectiveConsumer] || null
    : null;
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'halofire-project';
  const consumerSuffix = effectiveConsumer || 'all-consumers';
  return {
    artifact_type: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
    status: 'ready_for_consumer_contract_download',
    project_name: projectName,
    requested_consumer: effectiveConsumer || null,
    generated_at: queueReadback.generated_at,
    queue_artifact_type: queueReadback.queue?.artifact_type || 'openclaw.sam31.actual_value_resolver_queue.v1',
    readback_artifact_type: queueReadback.artifact_type,
    queue_readback_href: queueReadback.queue_href,
    source_project_route: queueReadback.source_project_route,
    download_name: `${slug}-sam31-actual-value-resolver-contract-${consumerSuffix}.json`,
    contract_evidence_filter_id: queueReadback.contract_evidence_filter_id || null,
    replacement_readback_evidence_filter_id: queueReadback.replacement_readback_evidence_filter_id || null,
    supported_consumers: queueReadback.supported_consumers,
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    consumer_pull_endpoint: consumerPullEndpoint,
    consumer_pull_endpoints: queueReadback.consumer_pull_endpoints,
    sam31_llm_extrapolation_contract: contract,
    application_contracts: contract.application_contracts || sam31ApplicationContracts(),
    acceptable_actual_evidence: queueReadback.acceptable_actual_evidence,
    download_artifacts: queueReadback.download_artifacts || null,
    blocked_claims: contract.blocked_claims || [],
    limitations: [
      'This packet lets HaloFire, LandScout, and NameForge cache the shared SAM31+LLM actual-value resolver contract.',
      'It is not approval evidence and does not clear professional, AHJ, manufacturer, AutoSprink, permit, fabrication, CEO-ready, brand-ready, trademark, or production claims.',
    ],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function buildOpenClawSam31ActualValueReplacementReadback(projectName, options = {}) {
  const requestedConsumer = String(options.consumer || '').trim().toLowerCase();
  const sourceReplayEvidenceId = Number(options.sourceReplayEvidenceId || options.source_replay_evidence_id || 0) || null;
  const queue = buildOpenClawSam31ActualValueResolverQueue(projectName, {
    consumer: requestedConsumer,
    contractEvidenceId: options.contractEvidenceId || options.contract_evidence_id,
    serviceDescriptorEvidenceId: options.serviceDescriptorEvidenceId || options.service_descriptor_evidence_id,
  });
  const effectiveConsumer = queue.requested_consumer || requestedConsumer;
  const contractEvidenceFilterId = queue.contract_evidence_filter_id || null;
  const serviceDescriptorEvidenceFilterId = queue.service_descriptor_evidence_filter_id || null;
  const latestServiceDescriptorEvidence = queue.latest_actual_value_service_descriptor_evidence || null;
  const queueQuery = [
    `projectName=${encodeURIComponent(projectName)}`,
    effectiveConsumer ? `consumer=${encodeURIComponent(effectiveConsumer)}` : '',
    contractEvidenceFilterId ? `contractEvidenceId=${encodeURIComponent(contractEvidenceFilterId)}` : '',
    serviceDescriptorEvidenceFilterId ? `serviceDescriptorEvidenceId=${encodeURIComponent(serviceDescriptorEvidenceFilterId)}` : '',
    sourceReplayEvidenceId ? `sourceReplayEvidenceId=${encodeURIComponent(sourceReplayEvidenceId)}` : '',
  ].filter(Boolean).join('&');
  const replacementReadbackHref = `/api/openclaw/sam31/actual-value-replacements?${queueQuery}`;
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'halofire-project';
  const replayReplacementDetails = listSam31ReplayActualValueReplacementDetails(projectName, {
    consumer: effectiveConsumer,
    sourceReplayEvidenceId,
  });
  const items = queue.items.map((item) => {
    const recordedEvidence = item.latest_actual_value_replacement_evidence || null;
    const sectionToArtifactsHandoff = item.section_to_artifacts_consumer_handoff
      || openClawSam31SectionToArtifactsConsumerHandoff(item, recordedEvidence);
    const prefill = item.actual_value_replacement_prefill || null;
    const sourceRefs = uniqueStrings([
      ...(Array.isArray(recordedEvidence?.source_refs) ? recordedEvidence.source_refs : []),
      ...(Array.isArray(prefill?.source_refs) ? prefill.source_refs : []),
      recordedEvidence?.source_ref,
      recordedEvidence?.replacement_values_source_ref,
      item.replacement_values_source_ref,
      item.replacement_ref,
      recordedEvidence?.source_actual_value_service_descriptor_ref,
      recordedEvidence?.source_actual_value_service_descriptor_file,
      recordedEvidence?.actual_value_service_descriptor_action?.href,
      prefill?.source_actual_value_service_descriptor_ref,
      prefill?.source_actual_value_service_descriptor_file,
      prefill?.actual_value_service_descriptor_action?.href,
    ].filter(Boolean));
    const serviceDescriptorEvidenceId = recordedEvidence?.source_openclaw_sam31_actual_value_service_descriptor_evidence_id
      || prefill?.source_openclaw_sam31_actual_value_service_descriptor_evidence_id
      || item.source_openclaw_sam31_actual_value_service_descriptor_evidence_id
      || null;
    const serviceDescriptorAction = recordedEvidence?.actual_value_service_descriptor_action
      || prefill?.actual_value_service_descriptor_action
      || item.actual_value_service_descriptor_action
      || null;
    return {
      artifact_type: 'openclaw.sam31.actual_value_replacement_detail.v1',
      status: recordedEvidence ? 'actual_value_evidence_recorded' : 'requires_employee_actual_value_update',
      project_name: projectName,
      consumer: item.consumer,
      source_runtime: item.source_runtime || 'sam-3.1+llm',
      source_application: item.source_application || 'halo_fire',
      source_pdf_boundary_evidence_id: item.source_pdf_boundary_evidence_id,
      source_openclaw_sam31_consumer_review_evidence_id: item.source_openclaw_sam31_consumer_review_evidence_id,
      source_openclaw_sam31_consumer_smoke_evidence_id: item.source_openclaw_sam31_consumer_smoke_evidence_id,
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: item.source_openclaw_sam31_actual_value_resolver_contract_evidence_id || null,
      latest_actual_value_resolver_contract_evidence: item.latest_actual_value_resolver_contract_evidence || null,
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: serviceDescriptorEvidenceId,
      source_actual_value_service_descriptor_ref: recordedEvidence?.source_actual_value_service_descriptor_ref
        || prefill?.source_actual_value_service_descriptor_ref
        || item.latest_actual_value_service_descriptor_evidence?.source_ref
        || null,
      source_actual_value_service_descriptor_file: recordedEvidence?.source_actual_value_service_descriptor_file
        || prefill?.source_actual_value_service_descriptor_file
        || item.latest_actual_value_service_descriptor_evidence?.source_file
        || null,
      actual_value_service_descriptor_action: serviceDescriptorAction,
      accepted_queue_id: item.accepted_queue_id || null,
      persisted_review_packet_ref: item.persisted_review_packet_ref || null,
      source_file: recordedEvidence?.source_file || prefill?.source_file || null,
      source_ref: recordedEvidence?.source_ref || prefill?.source_ref || item.replacement_values_source_ref || null,
      replacement_values_source_ref: recordedEvidence?.replacement_values_source_ref || prefill?.replacement_values_source_ref || item.replacement_values_source_ref || null,
      source_refs: sourceRefs,
      llm_observation_count: item.llm_observation_count || recordedEvidence?.llm_observation_count || 0,
      llm_observation_ids: uniqueStrings([
        ...(Array.isArray(item.llm_observation_ids) ? item.llm_observation_ids : []),
        ...(Array.isArray(recordedEvidence?.llm_observation_ids) ? recordedEvidence.llm_observation_ids : []),
      ]),
      source_llm_observation_ids: uniqueStrings([
        ...(Array.isArray(item.source_llm_observation_ids) ? item.source_llm_observation_ids : []),
        ...(Array.isArray(recordedEvidence?.source_llm_observation_ids) ? recordedEvidence.source_llm_observation_ids : []),
      ]),
      replacement_summary: item.replacement_summary || {},
      acceptable_actual_evidence: Array.isArray(item.acceptable_actual_evidence) ? item.acceptable_actual_evidence : [],
      actual_value_replacement_prefill: prefill,
      recorded_actual_value_replacement_evidence: recordedEvidence,
      openclaw_sam31_section_to_artifacts: recordedEvidence?.openclaw_sam31_section_to_artifacts || item.openclaw_sam31_section_to_artifacts || null,
      openclaw_sam31_section_to_artifacts_summary: recordedEvidence?.openclaw_sam31_section_to_artifacts_summary || item.openclaw_sam31_section_to_artifacts_summary || null,
      source_openclaw_sam31_section_to_artifacts_ref: recordedEvidence?.openclaw_sam31_section_to_artifacts_summary?.section_to_artifacts_contract_ref
        || item.source_openclaw_sam31_section_to_artifacts_ref
        || null,
      section_to_artifacts_consumer_handoff: sectionToArtifactsHandoff,
      next_action: recordedEvidence
        ? 'Review this recorded sam31_actual_value_replacement detail before downstream use; regulated claims remain blocked.'
        : 'Record exact source refs from the 1881 workbook, reviewed vector overlay, reviewed 3D model candidate, screenshot, or console evidence.',
      use_for_claims: false,
      blocked_claims: Array.isArray(item.blocked_claims) ? item.blocked_claims : [],
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
      limitations: [
        'This detail readback reports source refs for temporary SAM31+LLM replacement evidence only.',
        'Recorded details never clear permit-ready, fabrication-ready, AHJ-ready, engineering-grade, AutoSprink parity, professional approval, manufacturer-exact, brand-ready, or production-ready claims.',
      ],
    };
  });
  return {
    artifact_type: 'openclaw.sam31.actual_value_replacement_readback.v1',
    status: queue.status,
    project_name: projectName,
    requested_consumer: effectiveConsumer || null,
    generated_at: queue.generated_at,
    source_queue_route: `/api/openclaw/sam31/actual-value-resolver-queue?${queueQuery}`,
    replacement_readback_href: replacementReadbackHref,
    supported_consumers: queue.supported_consumers,
    contract_evidence_filter_id: contractEvidenceFilterId,
    source_openclaw_sam31_actual_value_resolver_contract_evidence_id: queue.source_openclaw_sam31_actual_value_resolver_contract_evidence_id || null,
    latest_actual_value_resolver_contract_evidence: queue.latest_actual_value_resolver_contract_evidence || null,
    service_descriptor_evidence_filter_id: serviceDescriptorEvidenceFilterId,
    source_replay_evidence_filter_id: sourceReplayEvidenceId,
    latest_actual_value_service_descriptor_evidence_id: queue.latest_actual_value_service_descriptor_evidence_id || null,
    latest_actual_value_service_descriptor_evidence: latestServiceDescriptorEvidence,
    saved_actual_value_service_descriptor_count: queue.saved_actual_value_service_descriptor_count || 0,
    item_count: queue.item_count,
    pending_count: queue.pending_count,
    recorded_count: queue.recorded_count,
    replay_replacement_count: replayReplacementDetails.length,
    replay_replacement_details: replayReplacementDetails,
    acceptable_actual_evidence: queue.acceptable_actual_evidence,
    download_artifacts: {
      filtered_replacement_readback: {
        artifact_type: 'openclaw.sam31.actual_value_replacement_readback.v1',
        href: replacementReadbackHref,
        download_name: `${slug}-sam31-actual-value-replacement-readback-${effectiveConsumer || 'all-consumers'}${contractEvidenceFilterId ? `-contract-${contractEvidenceFilterId}` : ''}${serviceDescriptorEvidenceFilterId ? `-service-descriptor-${serviceDescriptorEvidenceFilterId}` : ''}.json`,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      saved_service_descriptor_evidence: latestServiceDescriptorEvidence ? {
        artifact_type: latestServiceDescriptorEvidence.artifact_type || 'openclaw.sam31.actual_value_service_descriptor.v1',
        evidence_id: latestServiceDescriptorEvidence.evidence_id || null,
        source_ref: latestServiceDescriptorEvidence.source_ref || null,
        source_file: latestServiceDescriptorEvidence.source_file || null,
        download_name: latestServiceDescriptorEvidence.download_name || latestServiceDescriptorEvidence.source_file || `${slug}-saved-sam31-actual-value-service-descriptor.json`,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      } : null,
    },
    items,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: [
      'This is a shared OpenClaw readback for HaloFire, LandScout, and NameForge actual-value replacement details.',
      'SAM31+LLM object labels, vector overlays, and 3D candidates remain temporary values until replaced by actual HaloFire employee/source evidence.',
    ],
  };
}

function buildOpenClawSam31ActualValueResolverReplay(projectName, intake, evidenceId) {
  const consumer = String(intake?.consumer || '').trim();
  const queue = buildOpenClawSam31ActualValueResolverQueue(projectName, { consumer });
  const sourceReviewEvidenceId = Number(intake?.source_openclaw_sam31_consumer_review_evidence_id);
  const item = (Array.isArray(queue.items) ? queue.items : []).find((candidate) => (
    Number(candidate.source_openclaw_sam31_consumer_review_evidence_id) === sourceReviewEvidenceId
  )) || null;
  const latestEvidenceId = Number(item?.latest_actual_value_replacement_evidence?.evidence_id || 0) || null;
  const latestContractEvidence = item?.latest_actual_value_resolver_contract_evidence || queue.latest_actual_value_resolver_contract_evidence || null;
  const serviceDescriptorEvidenceId = intake?.source_openclaw_sam31_actual_value_service_descriptor_evidence_id
    || item?.source_openclaw_sam31_actual_value_service_descriptor_evidence_id
    || intake?.actual_value_replacement_prefill?.source_openclaw_sam31_actual_value_service_descriptor_evidence_id
    || null;
  const serviceDescriptorAction = intake?.actual_value_service_descriptor_action
    || intake?.actual_value_replacement_prefill?.actual_value_service_descriptor_action
    || item?.actual_value_service_descriptor_action
    || null;
  return {
    artifact_type: 'openclaw.sam31.actual_value_resolver_replay.v1',
    source_route: `/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(projectName)}${consumer ? `&consumer=${encodeURIComponent(consumer)}` : ''}`,
    project_route: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-resolver-queue${consumer ? `?consumer=${encodeURIComponent(consumer)}` : ''}`,
    project_name: projectName,
    consumer: consumer || null,
    replay_status: item?.intake_status === 'recorded' && latestEvidenceId === Number(evidenceId)
      ? 'recorded'
      : 'not_recorded',
    item_status: item?.status || 'missing_resolver_queue_item',
    intake_status: item?.intake_status || 'missing',
    latest_actual_value_replacement_evidence_id: latestEvidenceId,
    source_openclaw_sam31_consumer_review_evidence_id: Number.isSafeInteger(sourceReviewEvidenceId)
      ? sourceReviewEvidenceId
      : null,
    source_openclaw_sam31_actual_value_resolver_contract_evidence_id: item?.source_openclaw_sam31_actual_value_resolver_contract_evidence_id
      || queue.source_openclaw_sam31_actual_value_resolver_contract_evidence_id
      || null,
    latest_actual_value_resolver_contract_evidence: latestContractEvidence,
    source_openclaw_sam31_actual_value_service_descriptor_evidence_id: serviceDescriptorEvidenceId,
    source_actual_value_service_descriptor_ref: intake?.source_actual_value_service_descriptor_ref
      || intake?.actual_value_replacement_prefill?.source_actual_value_service_descriptor_ref
      || item?.latest_actual_value_service_descriptor_evidence?.source_ref
      || null,
    source_actual_value_service_descriptor_file: intake?.source_actual_value_service_descriptor_file
      || intake?.actual_value_replacement_prefill?.source_actual_value_service_descriptor_file
      || item?.latest_actual_value_service_descriptor_evidence?.source_file
      || null,
    actual_value_service_descriptor_action: serviceDescriptorAction,
    source_pdf_boundary_evidence_id: item?.source_pdf_boundary_evidence_id || intake?.source_pdf_boundary_evidence_id || null,
      replacement_values_source_ref: item?.replacement_values_source_ref || intake?.replacement_values_source_ref || null,
      source_openclaw_sam31_section_to_artifacts_ref: intake?.openclaw_sam31_section_to_artifacts_summary?.section_to_artifacts_contract_ref || null,
      vector_overlay_count: intake?.openclaw_sam31_section_to_artifacts_summary?.vector_overlay_count || 0,
      model_3d_candidate_count: intake?.openclaw_sam31_section_to_artifacts_summary?.model_3d_candidate_count || 0,
      openclaw_sam31_section_to_artifacts_summary: intake?.openclaw_sam31_section_to_artifacts_summary || null,
      llm_observation_count: item?.llm_observation_count || intake?.llm_observation_count || 0,
    llm_observation_ids: uniqueStrings([
      ...(Array.isArray(item?.llm_observation_ids) ? item.llm_observation_ids : []),
      ...(Array.isArray(intake?.llm_observation_ids) ? intake.llm_observation_ids : []),
    ]),
    source_llm_observation_ids: uniqueStrings([
      ...(Array.isArray(item?.source_llm_observation_ids) ? item.source_llm_observation_ids : []),
      ...(Array.isArray(intake?.source_llm_observation_ids) ? intake.source_llm_observation_ids : []),
    ]),
    use_for_claims: false,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(item?.blocked_claims) ? item.blocked_claims : []),
      ...(Array.isArray(intake?.blocked_claims) ? intake.blocked_claims : []),
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'manufacturer_exact',
      'AutoSprink_parity',
    ]),
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: [
      'This replay proves the resolver queue observed the recorded SAM31 actual-value replacement evidence.',
      'It does not clear permit-ready, fabrication-ready, AHJ-ready, engineering-grade, AutoSprink parity, professional approval, or manufacturer-exact claims.',
    ],
  };
}

function buildOpenClawSam31ReplayActualValueHandoffPacket(projectName, replayEvidenceRow, replayNotes) {
  const acceptableActualEvidence = [
    '1881 proposal workbook row or sheet reference',
    'reviewed vector overlay SVG or marked-up plan ref',
    'reviewed 3D model candidate ref or model note',
    'screenshot or console evidence for the reviewed SAM31 section',
  ];
  const employeeDecision = replayNotes.employee_decision && typeof replayNotes.employee_decision === 'object'
    ? jsonClone(replayNotes.employee_decision)
    : null;
  const sourceRefs = uniqueByJson([
    {
      evidence_id: replayEvidenceRow.id,
      evidence_type: replayEvidenceRow.evidence_type,
      source_file: replayEvidenceRow.source_file || null,
      source_ref: replayEvidenceRow.source_ref || null,
      status: replayEvidenceRow.status,
      artifact_type: replayNotes.artifact_type || 'room_boundary_replay_bid_artifact',
      claim_gate_effect: replayNotes.claim_gate_effect || 'no_claims_cleared',
    },
    ...(Array.isArray(replayNotes.source_refs) ? jsonClone(replayNotes.source_refs) : []),
  ]);
  const blockedClaims = uniqueStrings([
    ...(Array.isArray(replayNotes.blocked_claims) ? replayNotes.blocked_claims : []),
    'permit_ready',
    'fabrication_ready',
    'AHJ_approval',
    'professional_approval',
    'manufacturer_exact',
    'AutoSprink_parity',
  ]);
  return {
    artifact_type: 'openclaw.sam31.actual_value_handoff_packet.v1',
    status: 'ready_for_employee_actual_value_replacement',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    source_runtime: 'sam-3.1+llm',
    source_replay_evidence_id: replayEvidenceRow.id,
    source_replay_artifact_type: replayNotes.artifact_type || 'room_boundary_replay_bid_artifact',
    source_replay_ref: replayEvidenceRow.source_ref || null,
    source_replay_packet: {
      source_evidence_id: replayNotes.source_evidence_id || null,
      source_review_evidence_id: replayNotes.source_review_evidence_id || null,
      source_sam31_evidence_id: replayNotes.source_sam31_evidence_id || null,
      source_openclaw_sam31_extrapolation_evidence_id: replayNotes.source_openclaw_sam31_extrapolation_evidence_id || null,
      source_openclaw_sam31_extrapolation_review_evidence_id: replayNotes.source_openclaw_sam31_extrapolation_review_evidence_id || null,
      source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: replayNotes.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id || null,
      marked_up_plan_ref: replayNotes.marked_up_plan_ref || null,
      corrected_room_polygon_count: replayNotes.corrected_room_polygon_count || 0,
    },
    employee_decision: employeeDecision,
    source_refs: sourceRefs,
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    consumer_queue_status: [
      {
        consumer: 'halo_fire',
        status: 'source_replay_ready',
        queue_source: 'halofire_replay_evidence',
        next_action: 'Replace replay SAM31/LLM temporary values with actual HaloFire source documentation values before downstream bid/export use.',
      },
      {
        consumer: 'landscout',
        status: 'poll_queue_not_required_for_handoff',
        queue_source: 'openclaw.sam31.actual_value_handoff_packet.v1',
        next_action: 'LandScout may consume the same typed handoff shape after its product queue is connected; HaloFire replay replacement is not blocked by that queue.',
      },
      {
        consumer: 'nameforge',
        status: 'poll_queue_not_required_for_handoff',
        queue_source: 'openclaw.sam31.actual_value_handoff_packet.v1',
        next_action: 'NameForge may consume the same typed handoff shape after its product queue is connected; HaloFire replay replacement is not blocked by that queue.',
      },
    ],
    employee_replacement_fields: SAM31_EMPLOYEE_REPLACEMENT_FIELDS.map((field) => ({
      field,
      current_value_source: 'sam31_llm_best_guess',
      acceptable_evidence: acceptableActualEvidence,
      source_ref: replayEvidenceRow.source_ref || null,
      required_action: `Replace ${field} with an actual source value or mark it not applicable before downstream use.`,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    })),
    bid_summary: replayNotes.bid_summary || {
      total_area_sqft: replayNotes.total_area_sqft || null,
      total_head_count: replayNotes.total_head_count || null,
    },
    acceptable_actual_evidence: acceptableActualEvidence,
    blocked_claims: blockedClaims,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: uniqueStrings([
      ...(Array.isArray(replayNotes.limitations) ? replayNotes.limitations : []),
      'SAM31 plus LLM sectioning can identify likely objects, semantic labels, vector overlays, and 3D candidates, but those outputs remain temporary best guesses until replaced by actual employee/source evidence.',
      'This handoff never clears permit-ready, fabrication-ready, AHJ-ready, engineering-grade, AutoSprink parity, professional approval, manufacturer-exact, survey-grade, brand-ready, trademark-ready, or production-ready claims.',
    ]),
    download_name: `${slugForDownloadName(projectName)}-sam31-actual-value-handoff-${replayEvidenceRow.id}.json`,
  };
}

function normalizeReplaySam31ActualValueReplacementIntake(projectName, replayEvidenceRow, replayNotes, body = {}, user = null) {
  const handoff = buildOpenClawSam31ReplayActualValueHandoffPacket(projectName, replayEvidenceRow, replayNotes);
  const sourceRef = String(body?.source_ref || '').trim();
  if (!sourceRef) {
    const err = new Error('source_ref is required for replay SAM31 actual-value replacement intake');
    err.httpStatus = 400;
    throw err;
  }
  const sourceFile = String(
    body?.source_file
      || replayEvidenceRow.source_file
      || `sam31-replay-actual-value-handoff:${replayEvidenceRow.id}`,
  ).trim();
  const replacementValues = body?.replacement_values && typeof body.replacement_values === 'object' && !Array.isArray(body.replacement_values)
    ? jsonClone(body.replacement_values)
    : {};
  const replacementFields = uniqueStrings([
    ...Object.keys(replacementValues),
    ...(Array.isArray(handoff.employee_replacement_fields)
      ? handoff.employee_replacement_fields.map((field) => field.field)
      : []),
  ]);
  const sourceRefs = uniqueStrings([
    ...(Array.isArray(body?.source_refs) ? body.source_refs : []),
    sourceRef,
    handoff.source_replay_ref,
    ...(Array.isArray(handoff.employee_decision?.source_refs) ? handoff.employee_decision.source_refs : []),
  ].filter(Boolean));
  const sectionToArtifactsReview = {
    consumer: 'halo_fire',
    replacement_ref: handoff.source_replay_ref || sourceRef,
  };
  const sectionToArtifacts = buildSam31ActualValueSectionToArtifacts(
    projectName,
    body || {},
    sectionToArtifactsReview,
    sourceRef,
    sourceRefs,
  );
  const sectionToArtifactsSummary = sam31ActualValueSectionArtifactSummary(sectionToArtifacts);
  return {
    kind: 'sam31ReplayActualValueReplacement',
    artifact_type: 'halofire.sam31_replay_actual_value_replacement_intake.v1',
    evidence_type: 'sam31_actual_value_replacement',
    evidence_record_type: 'sam31_actual_value_replacement',
    status: 'present',
    project_name: projectName,
    source_runtime: 'sam-3.1+llm',
    source_replay_evidence_id: replayEvidenceRow.id,
    source_replay_artifact_type: handoff.source_replay_artifact_type,
    source_actual_value_handoff_artifact_type: handoff.artifact_type,
    source_actual_value_handoff: handoff,
    source_file: sourceFile || null,
    source_ref: sourceRef,
    source_refs: sourceRefs,
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    openclaw_sam31_shared_consumer_contract: {
      artifact_type: 'openclaw.sam31.shared_consumer_actual_value_replacement_contract.v1',
      source_runtime: 'sam-3.1+llm',
      source_replay_evidence_id: replayEvidenceRow.id,
      source_actual_value_handoff_artifact_type: handoff.artifact_type,
      supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
      produces: [
        'semantic_labels',
        'segmentation_polygons',
        'vector_overlays',
        'model_3d_candidates',
        'source_refs',
        'blocked_claims',
      ],
      product_lanes: {
        halo_fire: {
          status: 'replacement_intake_ready',
          acceptable_use: 'sprinkler_bid_review',
          next_action: 'Use employee/source-reviewed replacement values for internal-alpha sprinkler review packets; regulated claims remain blocked.',
        },
        landscout: {
          status: 'portable_contract_ready',
          acceptable_use: 'site_visual_measurement_review',
          next_action: 'Map the same SAM31 sectioning evidence shape into LandScout site observation review queues before any survey-grade claim.',
        },
        nameforge: {
          status: 'portable_contract_ready',
          acceptable_use: 'brand_asset_visual_extrapolation_review',
          next_action: 'Map the same SAM31 sectioning evidence shape into NameForge visual asset/vector/model review queues before any brand-ready or trademark-ready claim.',
        },
      },
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      limitations: [
        'Shared SAM31 replacement intake is a portable see-understand-extrapolate contract, not a professional, AHJ, survey-grade, brand-ready, trademark-ready, or production-ready approval.',
      ],
    },
    reviewer_name: String(body?.reviewer_name || user?.name || user?.username || '').trim() || null,
    replacement_values: replacementValues,
    replacement_summary: {
      replaced_field_count: replacementFields.length,
      replaced_fields: replacementFields,
      has_semantic_label: Boolean(replacementValues.semantic_label || replacementValues.semantic_labels),
      has_polygon: Boolean(replacementValues.polygon || replacementValues.polygons),
      has_bbox: Boolean(replacementValues.bbox || replacementValues.bboxes),
      has_vector_overlay: Boolean(replacementValues.vector_overlay || replacementValues.vector_overlays),
      has_model_3d_candidate: Boolean(replacementValues.model_3d_candidate || replacementValues.model_3d_candidates),
      has_section_to_artifacts: Boolean(sectionToArtifactsSummary),
      vector_overlay_count: sectionToArtifactsSummary?.vector_overlay_count
        ?? (Array.isArray(replacementValues.vector_overlays) ? replacementValues.vector_overlays.length : 0),
      model_3d_candidate_count: sectionToArtifactsSummary?.model_3d_candidate_count
        ?? (Array.isArray(replacementValues.model_3d_candidates) ? replacementValues.model_3d_candidates.length : 0),
      segment_count: sectionToArtifactsSummary?.segment_count
        ?? (Array.isArray(replacementValues.sections) ? replacementValues.sections.length : 0),
      object_hypothesis_count: sectionToArtifactsSummary?.object_hypothesis_count
        ?? (Array.isArray(replacementValues.object_hypotheses) ? replacementValues.object_hypotheses.length : 0),
    },
    openclaw_sam31_section_to_artifacts: sectionToArtifacts,
    openclaw_sam31_section_to_artifacts_summary: sectionToArtifactsSummary,
    acceptable_actual_evidence: Array.isArray(handoff.acceptable_actual_evidence) ? handoff.acceptable_actual_evidence : [],
    employee_actual_value_next_action: 'Review this replay-scoped SAM31 actual-value replacement before downstream bid/export use; regulated claims remain blocked.',
    notes: String(body?.notes || '').trim() || null,
    recorded_from: body?.recorded_from || 'api.openclaw.sam31.actual_value_handoff.replacements',
    recorded_by: user?.username || user?.name || null,
    recorded_at: new Date().toISOString(),
    use_for_claims: false,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(body?.blocked_claims) ? body.blocked_claims : []),
      ...(Array.isArray(handoff.blocked_claims) ? handoff.blocked_claims : []),
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'manufacturer_exact',
      'AutoSprink_parity',
    ]),
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: uniqueStrings([
      ...(Array.isArray(handoff.limitations) ? handoff.limitations : []),
      'Replay actual-value replacement evidence is an internal-alpha correction artifact only.',
      'It does not clear permit-ready, fabrication-ready, AHJ-ready, engineering-grade, AutoSprink parity, professional approval, or manufacturer-exact claims.',
    ]),
  };
}

app.get('/api/projects/:name/openclaw/sam31/actual-value-resolver-queue', authMiddleware, (req, res) => {
  res.json(buildOpenClawSam31ActualValueResolverQueue(req.params.name, {
    consumer: req.query?.consumer,
    contractEvidenceId: req.query?.contractEvidenceId || req.query?.contract_evidence_id,
    replacementReadbackEvidenceId: req.query?.replacementReadbackEvidenceId || req.query?.replacement_readback_evidence_id,
    serviceDescriptorEvidenceId: req.query?.serviceDescriptorEvidenceId || req.query?.service_descriptor_evidence_id,
    consumerIntakeSmokeEvidenceId: req.query?.consumerIntakeSmokeEvidenceId || req.query?.consumer_intake_smoke_evidence_id,
    sourceReplayEvidenceId: req.query?.sourceReplayEvidenceId || req.query?.source_replay_evidence_id,
  }));
});

app.get('/api/projects/:name/openclaw/sam31/actual-value-replacements', authMiddleware, (req, res) => {
  res.json(buildOpenClawSam31ActualValueReplacementReadback(req.params.name, {
    consumer: req.query?.consumer,
    contractEvidenceId: req.query?.contractEvidenceId || req.query?.contract_evidence_id,
    serviceDescriptorEvidenceId: req.query?.serviceDescriptorEvidenceId || req.query?.service_descriptor_evidence_id,
    sourceReplayEvidenceId: req.query?.sourceReplayEvidenceId || req.query?.source_replay_evidence_id,
  }));
});

app.post('/api/projects/:name/openclaw/sam31/actual-value-service/evidence', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const requestedConsumer = String(req.body?.consumer || req.query?.consumer || '').trim().toLowerCase();
    const serviceDescriptor = buildOpenClawSam31ActualValueServiceDescriptor(projectName, {
      consumer: requestedConsumer,
    });
    const sourceRefConsumer = serviceDescriptor.requested_consumer || requestedConsumer || 'all-consumers';
    const sourceRef = `openclaw://sam31/actual-value-service/${sourceRefConsumer}`;
    const slug = slugForDownloadName(projectName);
    const sourceFile = `${slug}-sam31-actual-value-service-descriptor-${sourceRefConsumer}.json`;
    const notes = {
      kind: 'openclaw_sam31_actual_value_service_descriptor',
      artifact_type: serviceDescriptor.artifact_type,
      requested_consumer: serviceDescriptor.requested_consumer || sourceRefConsumer,
      service_descriptor: serviceDescriptor,
      shared_see_label_extrapolate_contract: serviceDescriptor.shared_see_label_extrapolate_contract,
      actual_value_replacement_contract: serviceDescriptor.actual_value_replacement_contract,
      supported_consumers: serviceDescriptor.supported_consumers,
      supported_applications: serviceDescriptor.supported_applications,
      blocked_claims: uniqueStrings([
        ...(Array.isArray(serviceDescriptor.blocked_claims) ? serviceDescriptor.blocked_claims : []),
        'permit_ready',
        'fabrication_ready',
        'AHJ_approval',
        'professional_approval',
        'AutoSprink_parity',
        'brand_ready',
        'trademark_ready',
        'CEO_ready',
        'production_ready',
      ]),
      limitations: uniqueStrings([
        ...(Array.isArray(serviceDescriptor.limitations) ? serviceDescriptor.limitations : []),
        'This evidence row preserves the shared OpenClaw SAM31 service descriptor so HaloFire, LandScout, and NameForge can attach it to actual-value review work.',
        'It does not clear permit-ready, fabrication-ready, AHJ-ready, engineering-grade, AutoSprink parity, professional approval, manufacturer-exact, brand-ready, trademark-ready, CEO-ready, or production-ready claims.',
      ]),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'openclaw_sam31_actual_value_service_descriptor',
        sourceFile,
        sourceRef,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      evidence_id: result.lastInsertRowid,
      evidence_type: 'openclaw_sam31_actual_value_service_descriptor',
      status: 'present',
      source_file: sourceFile,
      source_ref: sourceRef,
      requested_consumer: serviceDescriptor.requested_consumer || sourceRefConsumer,
      message: 'SAM31 actual-value service descriptor saved as attachable evidence; claims still blocked',
      evidence: evidenceRow,
      service_descriptor: serviceDescriptor,
      shared_see_label_extrapolate_contract: serviceDescriptor.shared_see_label_extrapolate_contract,
      actual_value_replacement_contract: serviceDescriptor.actual_value_replacement_contract,
      blocked_claims: notes.blocked_claims,
      limitations: notes.limitations,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/openclaw/sam31/actual-value-resolver-contract/evidence', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const requestedConsumer = String(req.body?.consumer || req.query?.consumer || '').trim().toLowerCase();
    const contractPacket = buildOpenClawSam31ActualValueResolverContractPacket(projectName, {
      consumer: requestedConsumer,
    });
    const sourceRefConsumer = requestedConsumer || 'all-consumers';
    const notes = {
      kind: 'openclaw_sam31_actual_value_resolver_contract',
      artifact_type: contractPacket.artifact_type,
      contract_packet: contractPacket,
      supported_applications: contractPacket.supported_applications,
      supported_consumers: contractPacket.supported_consumers,
      blocked_claims: uniqueStrings([
        ...(Array.isArray(contractPacket.blocked_claims) ? contractPacket.blocked_claims : []),
        'permit_ready',
        'fabrication_ready',
        'AHJ_approval',
        'professional_approval',
        'AutoSprink_parity',
        'brand_ready',
        'production_ready',
      ]),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
      limitations: [
        'This evidence row preserves the downloadable SAM31 actual-value resolver contract packet for review-packet attachment.',
        'It is not approval evidence and does not clear professional, AHJ, manufacturer, AutoSprink, permit, fabrication, brand, trademark, CEO-ready, or production claims.',
      ],
    };
    const sourceRef = `openclaw://sam31/actual-value-resolver-contract/${sourceRefConsumer}`;
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'openclaw_sam31_actual_value_resolver_contract',
        contractPacket.download_name,
        sourceRef,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      evidence_id: result.lastInsertRowid,
      evidence_type: 'openclaw_sam31_actual_value_resolver_contract',
      status: 'present',
      source_ref: sourceRef,
      message: 'SAM31 actual-value resolver contract packet saved as attachable evidence; claims still blocked',
      evidence: evidenceRow,
      contract_packet: contractPacket,
      blocked_claims: notes.blocked_claims,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/openclaw/sam31/actual-value-replacements/evidence', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const requestedConsumer = String(req.body?.consumer || req.query?.consumer || '').trim().toLowerCase();
    const contractEvidenceId = req.body?.contractEvidenceId || req.body?.contract_evidence_id || req.query?.contractEvidenceId || req.query?.contract_evidence_id;
    const serviceDescriptorEvidenceId = req.body?.serviceDescriptorEvidenceId
      || req.body?.service_descriptor_evidence_id
      || req.body?.source_openclaw_sam31_actual_value_service_descriptor_evidence_id
      || req.query?.serviceDescriptorEvidenceId
      || req.query?.service_descriptor_evidence_id;
    const replacementReadback = buildOpenClawSam31ActualValueReplacementReadback(projectName, {
      consumer: requestedConsumer,
      contractEvidenceId,
      serviceDescriptorEvidenceId,
    });
    const contractId = replacementReadback.source_openclaw_sam31_actual_value_resolver_contract_evidence_id || null;
    const descriptorId = replacementReadback.service_descriptor_evidence_filter_id || null;
    const sourceConsumer = replacementReadback.requested_consumer || requestedConsumer || 'all-consumers';
    const sourceRefParts = [`openclaw://sam31/actual-value-replacements/${sourceConsumer}`];
    if (descriptorId) sourceRefParts.push(`service-descriptor-evidence/${descriptorId}`);
    if (contractId) sourceRefParts.push(`contract-evidence/${contractId}`);
    const sourceRef = sourceRefParts.join('/');
    const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'halofire-project';
    const sourceFile = `${slug}-sam31-actual-value-replacement-readback-${sourceConsumer}${descriptorId ? `-service-descriptor-${descriptorId}` : ''}${contractId ? `-contract-${contractId}` : ''}.json`;
    const notes = {
      kind: 'openclaw_sam31_actual_value_replacement_readback',
      artifact_type: replacementReadback.artifact_type,
      replacement_readback: replacementReadback,
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: contractId,
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: descriptorId,
      latest_actual_value_service_descriptor_evidence: replacementReadback.latest_actual_value_service_descriptor_evidence || null,
      requested_consumer: replacementReadback.requested_consumer,
      source_queue_route: replacementReadback.source_queue_route,
      supported_consumers: replacementReadback.supported_consumers,
      acceptable_actual_evidence: replacementReadback.acceptable_actual_evidence,
      blocked_claims: uniqueStrings([
        ...(Array.isArray(replacementReadback.items) ? replacementReadback.items.flatMap((item) => Array.isArray(item.blocked_claims) ? item.blocked_claims : []) : []),
        'permit_ready',
        'fabrication_ready',
        'AHJ_approval',
        'professional_approval',
        'manufacturer_exact',
        'AutoSprink_parity',
        'brand_ready',
        'production_ready',
      ]),
      limitations: uniqueStrings([
        ...(Array.isArray(replacementReadback.limitations) ? replacementReadback.limitations : []),
        'This evidence row preserves a SAM31 actual-value replacement readback packet for HaloFire, LandScout, and NameForge handoffs.',
        'It does not prove actual values and does not clear professional, AHJ, manufacturer, AutoSprink, permit, fabrication, engineering-grade, brand, or production claims.',
      ]),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'openclaw_sam31_actual_value_replacement_readback',
        sourceFile,
        sourceRef,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      evidence_id: result.lastInsertRowid,
      evidence_type: 'openclaw_sam31_actual_value_replacement_readback',
      status: 'present',
      source_file: sourceFile,
      source_ref: sourceRef,
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: contractId,
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: descriptorId,
      message: 'SAM31 actual-value replacement readback saved as attachable evidence; claims still blocked',
      evidence: evidenceRow,
      replacement_readback: replacementReadback,
      blocked_claims: notes.blocked_claims,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/openclaw/sam31/actual-value-replacements', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const sourceReviewEvidenceId = Number(req.body?.source_openclaw_sam31_consumer_review_evidence_id);
    if (!Number.isSafeInteger(sourceReviewEvidenceId) || sourceReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'source_openclaw_sam31_consumer_review_evidence_id is required for SAM31 actual-value replacement intake' });
    }
    const reviewRow = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'openclaw_sam31_consumer_review'`)
      .get(sourceReviewEvidenceId, projectName);
    if (!reviewRow) {
      return res.status(404).json({ error: 'SAM31 consumer review evidence not found' });
    }
    const item = buildOpenClawSam31ActualValueWorkItemIndex(projectName).items
      .find((candidate) => Number(candidate.source_openclaw_sam31_consumer_review_evidence_id) === sourceReviewEvidenceId) || null;
    const intake = normalizeSam31ActualValueReplacementIntake(projectName, req.body || {}, reviewRow, item, req.user);
    const notes = {
      kind: 'sam31ActualValueReplacement',
      ...intake,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'sam31_actual_value_replacement',
        intake.source_file,
        intake.source_ref,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      evidence_id: result.lastInsertRowid,
      message: 'SAM31 actual-value replacement intake recorded; claim gates remain blocked',
      evidence: evidenceRow,
      actual_value_resolver_replay: buildOpenClawSam31ActualValueResolverReplay(projectName, intake, result.lastInsertRowid),
      evidence_type: 'sam31_actual_value_replacement',
      status: 'present',
      ...intake,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/openclaw/sam31/section-to-artifacts-consumer-intake-smoke', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const smoke = buildOpenClawSam31SectionToArtifactsConsumerIntakeSmoke(projectName, req.body || {}, req.user);
    const notes = {
      kind: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
      ...smoke,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
        smoke.source_file,
        smoke.source_ref,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      evidence_id: result.lastInsertRowid,
      evidence_type: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
      message: 'SAM31 section-to-artifacts consumer intake smoke recorded; claim gates remain blocked',
      evidence: evidenceRow,
      ...smoke,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/:evidenceId/followup-packet', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer intake smoke evidence id is required' });
    }
    const smokeEvidence = openClawSam31SectionToArtifactsConsumerIntakeSmokeEvidenceById(projectName, evidenceId);
    return res.json(buildHalofireSam31ConsumerIntakeSmokeFollowupPacket(projectName, smokeEvidence));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/:evidenceId/followup-packet/review', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer intake smoke evidence id is required' });
    }
    const smokeEvidence = openClawSam31SectionToArtifactsConsumerIntakeSmokeEvidenceById(projectName, evidenceId);
    if (!smokeEvidence) {
      return res.status(404).json({ error: 'Saved SAM31 section-to-artifacts consumer intake smoke evidence not found' });
    }
    const sourcePacket = buildHalofireSam31ConsumerIntakeSmokeFollowupPacket(projectName, smokeEvidence);
    const reviewDecision = normalizeHalofireSam31ConsumerIntakeSmokeFollowupReviewDecision(projectName, sourcePacket, req.body || {}, req.user || {});
    const placeholderNotes = {
      kind: 'halofire_sam31_consumer_intake_smoke_followup_review_decision',
      review: reviewDecision,
      blocked_claims: reviewDecision.blocked_claims,
      claim_gate_effect: reviewDecision.claim_gate_effect,
      limitations: reviewDecision.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'halofire_sam31_consumer_intake_smoke_followup_review_decision',
        sourcePacket.download_name || sourcePacket.artifact_type,
        reviewDecision.review_ref,
        'present',
        JSON.stringify(placeholderNotes),
      );
    const reviewWithRows = {
      ...reviewDecision,
      evidence_id: result.lastInsertRowid,
      evidence_type: 'halofire_sam31_consumer_intake_smoke_followup_review_decision',
    };
    reviewWithRows.resolver_queue_rows = buildHalofireSam31ConsumerIntakeSmokeFollowupResolverRows(
      projectName,
      sourcePacket,
      reviewWithRows,
      result.lastInsertRowid,
    );
    const notes = {
      kind: 'halofire_sam31_consumer_intake_smoke_followup_review_decision',
      artifact_type: HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_REVIEW_DECISION_TYPE,
      review: reviewWithRows,
      resolver_queue_rows: reviewWithRows.resolver_queue_rows,
      blocked_claims: reviewWithRows.blocked_claims,
      claim_gate_effect: reviewWithRows.claim_gate_effect,
      limitations: reviewWithRows.limitations,
    };
    db
      .prepare('UPDATE project_evidence SET notes = ? WHERE id = ?')
      .run(JSON.stringify(notes), result.lastInsertRowid);
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      evidence_id: result.lastInsertRowid,
      evidence_type: 'halofire_sam31_consumer_intake_smoke_followup_review_decision',
      message: 'SAM31 consumer intake smoke follow-up review recorded; downstream resolver rows are internal-alpha only and claims remain blocked',
      evidence: evidenceRow,
      ...reviewWithRows,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/:evidenceId/sprinkler-review-packet', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer intake smoke evidence id is required' });
    }
    const smokeEvidence = openClawSam31SectionToArtifactsConsumerIntakeSmokeEvidenceById(projectName, evidenceId);
    const latestReview = latestHalofireSam31ConsumerIntakeSmokeFollowupReviewDecisionEvidence(projectName, evidenceId);
    return res.json(buildHalofireSam31ConsumerIntakeSmokeSprinklerReviewPacket(projectName, smokeEvidence, latestReview));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/:evidenceId/sprinkler-review-packet/decision', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer intake smoke evidence id is required' });
    }
    const smokeEvidence = openClawSam31SectionToArtifactsConsumerIntakeSmokeEvidenceById(projectName, evidenceId);
    const latestReview = latestHalofireSam31ConsumerIntakeSmokeFollowupReviewDecisionEvidence(projectName, evidenceId);
    const sprinklerPacket = buildHalofireSam31ConsumerIntakeSmokeSprinklerReviewPacket(projectName, smokeEvidence, latestReview);
    const reviewPacket = normalizeHalofireSam31ConsumerIntakeSmokeSprinklerReviewDecision(
      projectName,
      smokeEvidence,
      latestReview,
      sprinklerPacket,
      req.body,
      req.user,
    );
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
        sprinklerPacket.download_name || smokeEvidence?.source_file || null,
        reviewPacket.review_ref,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      evidence_id: result.lastInsertRowid,
      evidence_type: 'halofire_sam31_sprinkler_review_decision',
      message: 'HaloFire SAM31 smoke sprinkler review decision recorded; claims still blocked',
      evidence: evidenceRow,
      ...reviewPacket,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/:evidenceId/sprinkler-review-packet/decision/:sprinklerReviewEvidenceId/preliminary-replay-inputs', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const sprinklerReviewEvidenceId = Number(req.params.sprinklerReviewEvidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer intake smoke evidence id is required' });
    }
    if (!Number.isSafeInteger(sprinklerReviewEvidenceId) || sprinklerReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 smoke sprinkler review decision evidence id is required' });
    }
    const smokeEvidence = openClawSam31SectionToArtifactsConsumerIntakeSmokeEvidenceById(projectName, evidenceId);
    const latestReview = latestHalofireSam31ConsumerIntakeSmokeFollowupReviewDecisionEvidence(projectName, evidenceId);
    const sprinklerReviewEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE project_name = ? AND id = ? AND evidence_type = 'halofire_sam31_sprinkler_review_decision'`)
      .get(projectName, sprinklerReviewEvidenceId);
    const sprinklerReview = halofireSam31SprinklerReviewDecisionFromEvidence(sprinklerReviewEvidence);
    return res.json(buildHalofireSam31ConsumerIntakeSmokePreliminaryReplayInputs(
      projectName,
      smokeEvidence,
      latestReview,
      sprinklerReviewEvidence,
      sprinklerReview,
    ));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/:evidenceId/sprinkler-review-packet/decision/:sprinklerReviewEvidenceId/preliminary-replay', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const sprinklerReviewEvidenceId = Number(req.params.sprinklerReviewEvidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer intake smoke evidence id is required' });
    }
    if (!Number.isSafeInteger(sprinklerReviewEvidenceId) || sprinklerReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 smoke sprinkler review decision evidence id is required' });
    }
    const smokeEvidence = openClawSam31SectionToArtifactsConsumerIntakeSmokeEvidenceById(projectName, evidenceId);
    const latestReview = latestHalofireSam31ConsumerIntakeSmokeFollowupReviewDecisionEvidence(projectName, evidenceId);
    const sprinklerReviewEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE project_name = ? AND id = ? AND evidence_type = 'halofire_sam31_sprinkler_review_decision'`)
      .get(projectName, sprinklerReviewEvidenceId);
    const sprinklerReview = halofireSam31SprinklerReviewDecisionFromEvidence(sprinklerReviewEvidence);
    return res.json(buildHalofireSam31ConsumerIntakeSmokePreliminaryReplayArtifact(
      projectName,
      smokeEvidence,
      latestReview,
      sprinklerReviewEvidence,
      sprinklerReview,
    ));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/:evidenceId/sprinkler-review-packet/decision/:sprinklerReviewEvidenceId/preliminary-replay/followup', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const sprinklerReviewEvidenceId = Number(req.params.sprinklerReviewEvidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer intake smoke evidence id is required' });
    }
    if (!Number.isSafeInteger(sprinklerReviewEvidenceId) || sprinklerReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 smoke sprinkler review decision evidence id is required' });
    }
    const smokeEvidence = openClawSam31SectionToArtifactsConsumerIntakeSmokeEvidenceById(projectName, evidenceId);
    const latestReview = latestHalofireSam31ConsumerIntakeSmokeFollowupReviewDecisionEvidence(projectName, evidenceId);
    const sprinklerReviewEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE project_name = ? AND id = ? AND evidence_type = 'halofire_sam31_sprinkler_review_decision'`)
      .get(projectName, sprinklerReviewEvidenceId);
    const sprinklerReview = halofireSam31SprinklerReviewDecisionFromEvidence(sprinklerReviewEvidence);
    const followup = normalizeHalofireSam31ConsumerIntakeSmokePreliminaryReplayFollowupDecision(
      projectName,
      smokeEvidence,
      latestReview,
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
        smokeEvidence.source_file || followup.source_openclaw_sam31_section_to_artifacts_ref || null,
        followup.review_ref,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      evidence_id: result.lastInsertRowid,
      evidence_type: 'halofire_sam31_sprinkler_preliminary_replay_followup_decision',
      message: 'HaloFire SAM31 smoke preliminary replay follow-up recorded; packet queue rows ready and claims still blocked',
      evidence: evidenceRow,
      ...followup,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

function halofireSam31ConsumerIntakeSmokePreliminaryReplayFollowupRouteContext(projectName, evidenceId, sprinklerReviewEvidenceId, followupEvidenceId) {
  const smokeEvidence = openClawSam31SectionToArtifactsConsumerIntakeSmokeEvidenceById(projectName, evidenceId);
  if (!smokeEvidence) {
    const e = new Error('Saved SAM31 section-to-artifacts consumer intake smoke evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  const followupReviewEvidence = latestHalofireSam31ConsumerIntakeSmokeFollowupReviewDecisionEvidence(projectName, evidenceId);
  const sprinklerReviewEvidence = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND id = ? AND evidence_type = 'halofire_sam31_sprinkler_review_decision'`)
    .get(projectName, sprinklerReviewEvidenceId);
  const sprinklerReview = halofireSam31SprinklerReviewDecisionFromEvidence(sprinklerReviewEvidence);
  if (!sprinklerReviewEvidence || !sprinklerReview) {
    const e = new Error('HaloFire SAM31 smoke sprinkler review decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  const followupEvidence = db
    .prepare(`SELECT * FROM project_evidence
              WHERE id = ? AND project_name = ? AND evidence_type = 'halofire_sam31_sprinkler_preliminary_replay_followup_decision'`)
    .get(followupEvidenceId, projectName);
  const followup = halofireSam31SprinklerPreliminaryReplayFollowupDecisionFromEvidence(followupEvidence);
  if (!followupEvidence || !followup) {
    const e = new Error('SAM31 smoke preliminary replay follow-up evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (Number(followup.source_section_to_artifacts_consumer_intake_smoke_evidence_id) !== Number(evidenceId)
    || Number(followup.source_halofire_sam31_sprinkler_review_decision_evidence_id) !== Number(sprinklerReviewEvidenceId)) {
    const e = new Error('SAM31 smoke preliminary replay follow-up evidence does not match the requested source chain');
    e.httpStatus = 409;
    throw e;
  }
  if (followupReviewEvidence?.evidence?.id
    && Number(followup.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id) !== Number(followupReviewEvidence.evidence.id)) {
    const e = new Error('SAM31 smoke preliminary replay follow-up evidence does not match the latest smoke follow-up review evidence');
    e.httpStatus = 409;
    throw e;
  }
  return {
    smokeEvidence,
    followupReviewEvidence,
    sprinklerReviewEvidence,
    sprinklerReview,
    followupEvidence,
    followup,
  };
}

app.get('/api/projects/:name/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/:evidenceId/sprinkler-review-packet/decision/:sprinklerReviewEvidenceId/preliminary-replay/followup/:followupEvidenceId/packet/:packetIndex', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const sprinklerReviewEvidenceId = Number(req.params.sprinklerReviewEvidenceId);
    const followupEvidenceId = Number(req.params.followupEvidenceId);
    const packetIndex = Number(req.params.packetIndex);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer intake smoke evidence id is required' });
    }
    if (!Number.isSafeInteger(sprinklerReviewEvidenceId) || sprinklerReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 smoke sprinkler review decision evidence id is required' });
    }
    if (!Number.isSafeInteger(followupEvidenceId) || followupEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 smoke preliminary replay follow-up evidence id is required' });
    }
    if (!Number.isSafeInteger(packetIndex) || packetIndex < 0) {
      return res.status(400).json({ error: 'A non-negative SAM31 smoke follow-up packet index is required' });
    }
    const context = halofireSam31ConsumerIntakeSmokePreliminaryReplayFollowupRouteContext(
      projectName,
      evidenceId,
      sprinklerReviewEvidenceId,
      followupEvidenceId,
    );
    return res.json(buildHalofireSam31SprinklerReplayFollowupPacket(
      projectName,
      null,
      null,
      context.sprinklerReviewEvidence,
      context.followupEvidence,
      context.followup,
      packetIndex,
      {
        smokeEvidence: context.smokeEvidence,
        followupReviewEvidence: context.followupReviewEvidence,
      },
    ));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/:evidenceId/sprinkler-review-packet/decision/:sprinklerReviewEvidenceId/preliminary-replay/followup/:followupEvidenceId/packet/:packetIndex/review', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const sprinklerReviewEvidenceId = Number(req.params.sprinklerReviewEvidenceId);
    const followupEvidenceId = Number(req.params.followupEvidenceId);
    const packetIndex = Number(req.params.packetIndex);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer intake smoke evidence id is required' });
    }
    if (!Number.isSafeInteger(sprinklerReviewEvidenceId) || sprinklerReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 smoke sprinkler review decision evidence id is required' });
    }
    if (!Number.isSafeInteger(followupEvidenceId) || followupEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 smoke preliminary replay follow-up evidence id is required' });
    }
    if (!Number.isSafeInteger(packetIndex) || packetIndex < 0) {
      return res.status(400).json({ error: 'A non-negative SAM31 smoke follow-up packet index is required' });
    }
    const context = halofireSam31ConsumerIntakeSmokePreliminaryReplayFollowupRouteContext(
      projectName,
      evidenceId,
      sprinklerReviewEvidenceId,
      followupEvidenceId,
    );
    const sourcePacket = buildHalofireSam31SprinklerReplayFollowupPacket(
      projectName,
      null,
      null,
      context.sprinklerReviewEvidence,
      context.followupEvidence,
      context.followup,
      packetIndex,
      {
        smokeEvidence: context.smokeEvidence,
        followupReviewEvidence: context.followupReviewEvidence,
      },
    );
    const reviewDecision = normalizeHalofireSam31SprinklerFollowupPacketReviewDecision(projectName, sourcePacket, req.body || {}, req.user || {});
    const notes = {
      kind: 'halofire_sam31_sprinkler_followup_packet_review_decision',
      review: reviewDecision,
      blocked_claims: reviewDecision.blocked_claims,
      claim_gate_effect: reviewDecision.claim_gate_effect,
      limitations: reviewDecision.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'halofire_sam31_sprinkler_followup_packet_review_decision',
        sourcePacket.download_name || sourcePacket.artifact_type,
        reviewDecision.review_ref,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'SAM31 smoke follow-up packet review decision recorded; claims still blocked',
      evidence: evidenceRow,
      ...reviewDecision,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/:evidenceId/sprinkler-review-packet/decision/:sprinklerReviewEvidenceId/preliminary-replay/followup/:followupEvidenceId/packet/:packetIndex/review/:packetReviewEvidenceId/approval-upload', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const sprinklerReviewEvidenceId = Number(req.params.sprinklerReviewEvidenceId);
    const followupEvidenceId = Number(req.params.followupEvidenceId);
    const packetIndex = Number(req.params.packetIndex);
    const packetReviewEvidenceId = Number(req.params.packetReviewEvidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer intake smoke evidence id is required' });
    }
    if (!Number.isSafeInteger(sprinklerReviewEvidenceId) || sprinklerReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 smoke sprinkler review decision evidence id is required' });
    }
    if (!Number.isSafeInteger(followupEvidenceId) || followupEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 smoke preliminary replay follow-up evidence id is required' });
    }
    if (!Number.isSafeInteger(packetIndex) || packetIndex < 0) {
      return res.status(400).json({ error: 'A non-negative SAM31 smoke follow-up packet index is required' });
    }
    if (!Number.isSafeInteger(packetReviewEvidenceId) || packetReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 smoke follow-up packet review evidence id is required' });
    }
    const context = halofireSam31ConsumerIntakeSmokePreliminaryReplayFollowupRouteContext(
      projectName,
      evidenceId,
      sprinklerReviewEvidenceId,
      followupEvidenceId,
    );
    const packetReviewEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'halofire_sam31_sprinkler_followup_packet_review_decision'`)
      .get(packetReviewEvidenceId, projectName);
    const packetReview = halofireSam31SprinklerFollowupPacketReviewDecisionFromEvidence(packetReviewEvidence);
    if (!packetReviewEvidence || !packetReview) {
      return res.status(404).json({ error: 'SAM31 smoke follow-up packet review evidence not found' });
    }
    if (Number(packetReview.source_section_to_artifacts_consumer_intake_smoke_evidence_id) !== Number(evidenceId)
      || Number(packetReview.source_halofire_sam31_sprinkler_review_decision_evidence_id) !== Number(sprinklerReviewEvidenceId)
      || Number(packetReview.source_followup_decision_evidence_id) !== Number(followupEvidenceId)
      || Number(packetReview.packet_index) !== packetIndex) {
      return res.status(409).json({ error: 'SAM31 smoke follow-up packet review evidence does not match the requested source chain' });
    }
    if (context.followupReviewEvidence?.evidence?.id
      && Number(packetReview.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id) !== Number(context.followupReviewEvidence.evidence.id)) {
      return res.status(409).json({ error: 'SAM31 smoke follow-up packet review evidence does not match the latest smoke follow-up review evidence' });
    }
    const sourcePacket = buildHalofireSam31SprinklerReplayFollowupPacket(
      projectName,
      null,
      null,
      context.sprinklerReviewEvidence,
      context.followupEvidence,
      context.followup,
      packetIndex,
      {
        smokeEvidence: context.smokeEvidence,
        followupReviewEvidence: context.followupReviewEvidence,
      },
    );
    const packetReviewWithEvidenceId = {
      ...packetReview,
      evidence_id: packetReviewEvidence.id,
      source_ref: packetReviewEvidence.source_ref,
    };
    const intake = normalizeHalofireSam31ApprovalUploadIntake(projectName, sourcePacket, packetReviewWithEvidenceId, req.body || {}, req.user || {});
    ensureHalofireSam31ApprovalUploadGate(projectName, intake.gate_code, halofireSam31ApprovalUploadRule(intake.code));
    const notes = {
      kind: 'halofire_sam31_approval_upload_intake',
      artifact_type: HALOFIRE_SAM31_APPROVAL_UPLOAD_INTAKE_TYPE,
      intake,
      signoff: intake.signoff,
      blocked_claims: intake.blocked_claims,
      claim_gate_effect: intake.claim_gate_effect,
      use_for_claims: false,
      limitations: intake.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        intake.evidence_type,
        intake.source_file || sourcePacket.download_name || sourcePacket.artifact_type,
        intake.source_ref,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    const responseIntake = {
      ...intake,
      gate_validation_action: intake.gate_validation_action ? {
        ...intake.gate_validation_action,
        request_body: { evidence_id: result.lastInsertRowid },
      } : null,
      gate_validation_packet_action: halofireSam31ApprovalUploadGateValidationPacketAction(projectName, result.lastInsertRowid),
    };
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'SAM31 smoke approval upload intake recorded for later gate validation; claims still blocked',
      evidence: evidenceRow,
      ...responseIntake,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
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
    review_source: notes.room_boundary_source || 'latest_employee_review_packet',
    source_evidence_id: notes.source_evidence_id,
    source_review_evidence_id: notes.source_review_evidence_id,
    source_sam31_evidence_id: notes.source_sam31_evidence_id,
    source_sam31_replacement_evidence_id: notes.source_sam31_replacement_evidence_id,
    employee_decision: notes.employee_decision || null,
    source_refs: Array.isArray(notes.source_refs) ? notes.source_refs : [],
    floor_plan_override: notes.floor_plan_override || null,
    corrected_room_polygons: Array.isArray(notes.corrected_room_polygons) ? notes.corrected_room_polygons : [],
    corrected_room_polygon_count: notes.corrected_room_polygon_count || 0,
    source_replay_packet: {
      source_evidence_id: notes.source_evidence_id,
      source_review_evidence_id: notes.source_review_evidence_id,
      source_sam31_evidence_id: notes.source_sam31_evidence_id,
      source_openclaw_sam31_extrapolation_evidence_id: notes.source_openclaw_sam31_extrapolation_evidence_id,
      source_openclaw_sam31_extrapolation_review_evidence_id: notes.source_openclaw_sam31_extrapolation_review_evidence_id,
      source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: notes.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id,
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
    halofire_sam31_sectioning_downstream_resolver_packet: notes.halofire_sam31_sectioning_downstream_resolver_packet || null,
    blocked_claims: Array.isArray(notes.blocked_claims) ? notes.blocked_claims : [],
    claim_gate_effect: notes.claim_gate_effect || 'no_claims_cleared',
    limitations: Array.isArray(notes.limitations) ? notes.limitations : [
      'This replay artifact is internal-alpha evidence only and does not clear regulated claims.',
    ],
  });
});

app.get('/api/projects/:name/evidence/:evidenceId/openclaw/sam31/approval-upload/gate-validation-packet', authMiddleware, (req, res) => {
  try {
    return res.json(buildHalofireSam31ApprovalUploadGateValidationPacket(req.params.name, req.params.evidenceId));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/evidence/:evidenceId/openclaw/sam31/approval-upload/gate-validation-decision', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const validationDecision = buildHalofireSam31ApprovalUploadValidationDecision(
      projectName,
      req.params.evidenceId,
      req.body || {},
      req.user || {},
    );
    const notes = {
      kind: 'halofire_sam31_approval_upload_validation_decision',
      artifact_type: HALOFIRE_SAM31_APPROVAL_UPLOAD_VALIDATION_DECISION_TYPE,
      validation_decision: validationDecision,
      signoff: validationDecision.signoff,
      blocked_claims: validationDecision.blocked_claims,
      limitations: validationDecision.limitations,
      use_for_claims: validationDecision.use_for_claims,
      claim_gate_effect: validationDecision.claim_gate_effect,
      no_claim_gates_cleared: true,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        validationDecision.evidence_type,
        validationDecision.source_file,
        validationDecision.validation_ref,
        validationDecision.status,
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    const responseDecision = {
      ...validationDecision,
      evidence_id: result.lastInsertRowid,
      id: result.lastInsertRowid,
      resolve_action: validationDecision.resolve_action ? {
        ...validationDecision.resolve_action,
        request_body: { evidence_id: result.lastInsertRowid },
      } : null,
    };
    return res.status(201).json({
      id: result.lastInsertRowid,
      evidence_id: result.lastInsertRowid,
      evidence: evidenceRow,
      message: 'SAM31 approval upload validation decision recorded; claim gates remain blocked until explicit resolve',
      ...responseDecision,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/evidence/:evidenceId/openclaw/sam31/actual-value-handoff', authMiddleware, (req, res) => {
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
  return res.json(buildOpenClawSam31ReplayActualValueHandoffPacket(req.params.name, row, notes));
});

app.post('/api/projects/:name/evidence/:evidenceId/openclaw/sam31/actual-value-handoff/replacements', authMiddleware, requireRole('admin'), (req, res) => {
  try {
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
    const intake = normalizeReplaySam31ActualValueReplacementIntake(req.params.name, row, notes, req.body || {}, req.user);
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        req.params.name,
        intake.evidence_type,
        intake.source_file,
        intake.source_ref,
        'present',
        JSON.stringify(intake),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'Replay SAM31 actual-value replacement intake recorded; claim gates remain blocked',
      evidence: evidenceRow,
      ...intake,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
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
  const { evidence_type, source_file = null, source_ref = null, status, notes = null, signoff, target_gate_code = null } = req.body;
  if (!evidence_type || !status) {
    return res.status(400).json({ error: 'evidence_type and status are required' });
  }
  let storedNotes = notes;
  try {
    const normalizedSignoff = normalizeSignedReviewerSignoff(evidence_type, signoff);
    if (normalizedSignoff) {
      storedNotes = buildSignedReviewerEvidenceNotes(
        req.params.name,
        evidence_type,
        source_ref,
        notes,
        normalizedSignoff,
        target_gate_code,
      );
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
  ensureProjectClaimGates(projectName);
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
    let structuredExistingNotes = null;
    try {
      structuredExistingNotes = existingEvidence.notes ? JSON.parse(existingEvidence.notes) : null;
    } catch {
      structuredExistingNotes = null;
    }
    if (structuredExistingNotes?.kind === 'halofire_sam31_approval_upload_intake') {
      return res.status(400).json({
        error: 'SAM31 approval upload intake must be validated with a saved halofire.sam31_approval_upload_validation_decision.v1 evidence row before resolving this claim gate',
      });
    }
    if (
      structuredExistingNotes?.kind === 'halofire_sam31_approval_upload_validation_decision'
      && structuredExistingNotes.validation_decision?.validation_decision !== HALOFIRE_SAM31_APPROVAL_UPLOAD_REAL_VALIDATION_DECISION
    ) {
      return res.status(400).json({
        error: 'SAM31 approval upload validation decision is not real_signed_evidence_validated and cannot clear this claim gate',
      });
    }
    if (SIGNED_REVIEW_EVIDENCE_TYPES.has(evidenceType) && !hasStructuredSignedReviewerNotes(existingEvidence)) {
      return res.status(400).json({ error: 'existing evidence row is missing signed reviewer metadata required for this gate' });
    }
    const tx = db.transaction(() => {
      if (structuredExistingNotes?.kind === 'halofire_sam31_approval_upload_validation_decision') {
        const upgradedNotes = {
          ...structuredExistingNotes,
          validation_decision: {
            ...structuredExistingNotes.validation_decision,
            claim_gate_effect: 'gate_cleared',
            resolved_gate_code: code,
            resolved_at: resolvedAt,
          },
          claim_gate_effect: 'gate_cleared',
          resolve_audit_packet_href: claimGateResolveAuditPacketHref(projectName, code),
          resolve_audit_packet_artifact_type: 'halofire.claim_gate_resolve_audit_packet.v1',
        };
        db.prepare('UPDATE project_evidence SET notes = ? WHERE project_name = ? AND id = ?')
          .run(JSON.stringify(upgradedNotes), projectName, existingEvidence.id);
      } else if (SIGNED_REVIEW_EVIDENCE_TYPES.has(evidenceType)) {
        const parsedNotes = parseStructuredSignedReviewerNotes(existingEvidence);
        const upgradedNotes = buildSignedReviewerEvidenceNotes(
          projectName,
          evidenceType,
          existingEvidence.source_ref,
          parsedNotes?.user_notes || existingEvidence.notes,
          parsedNotes?.signoff,
          code,
          { claimGateEffect: 'gate_cleared' },
        );
        db.prepare('UPDATE project_evidence SET notes = ? WHERE project_name = ? AND id = ?')
          .run(upgradedNotes, projectName, existingEvidence.id);
      }
      db.prepare(`UPDATE claim_gates
                  SET status = 'cleared', resolved_by = ?, resolved_at = ?, resolved_evidence_ref = ?, resolved_evidence_id = ?
                  WHERE project_name = ? AND code = ?`)
        .run(req.user.username, resolvedAt, existingEvidence.source_ref, existingEvidence.id, projectName, code);
    });
    tx();
    const auditAction = claimGateResolveAuditPacketAction(projectName, code);
    return res.status(200).json({
      cleared: true,
      code,
      resolved_by: req.user.username,
      resolved_at: resolvedAt,
      resolved_evidence_id: existingEvidence.id,
      resolved_evidence_ref: existingEvidence.source_ref,
      resolve_audit_packet_href: auditAction.href,
      resolve_audit_packet_artifact_type: auditAction.artifact_type,
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
      storedNotes = buildSignedReviewerEvidenceNotes(
        projectName,
        evidence_type,
        source_ref,
        notes,
        signoff,
        code,
        { claimGateEffect: 'gate_cleared' },
      );
    }
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }

  const tx = db.transaction(() => {
    const inserted = db.prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(projectName, evidence_type, source_file, source_ref, 'present', storedNotes);
    db.prepare(`UPDATE claim_gates
                SET status = 'cleared', resolved_by = ?, resolved_at = ?, resolved_evidence_ref = ?, resolved_evidence_id = ?
                WHERE project_name = ? AND code = ?`)
      .run(req.user.username, resolvedAt, source_ref, inserted.lastInsertRowid, projectName, code);
    return inserted.lastInsertRowid;
  });
  const resolvedEvidenceId = tx();
  const auditAction = claimGateResolveAuditPacketAction(projectName, code);

  res.status(200).json({
    cleared: true,
    code,
    resolved_by: req.user.username,
    resolved_at: resolvedAt,
    resolved_evidence_id: resolvedEvidenceId,
    resolved_evidence_ref: source_ref,
    resolve_audit_packet_href: auditAction.href,
    resolve_audit_packet_artifact_type: auditAction.artifact_type,
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

const SAM31_SECTIONING_PIPELINE_CONTRACT_REVIEW_FIELDS = Object.freeze([
  'semantic_labels',
  'polygons',
  'bboxes',
  'object_hypotheses',
  'vector_overlays',
  'model_3d_candidates',
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
const SAM31_VECTOR_MODEL_ARTIFACT_PACKET_TYPE = 'openclaw.sam31_vector_model_artifact_packet.v1';
const SAM31_CONSUMER_SMOKE_ARTIFACT_TYPE = 'openclaw.sam31.consumer_smoke_artifact.v1';
const SAM31_CONSUMER_REVIEW_TASK_TYPE = 'openclaw.sam31.consumer_review_task.v1';
const SAM31_CONSUMER_REVIEW_DECISION_TYPE = 'openclaw.sam31.consumer_review_task_decision.v1';
const SAM31_PRODUCT_OWNER_REPLACEMENT_INTAKE_TYPE = 'openclaw.sam31.product_owner_replacement_intake.v1';
const SAM31_TO_SPRINKLER_REVIEW_ADAPTER_TYPE = 'openclaw.sam31_to_sprinkler_review_adapter.v1';
const SAM31_REQUIRED_SOURCE_PROVENANCE_FIELDS = Object.freeze([
  'source_pdf_boundary_evidence_id',
  'source_openclaw_sam31_extrapolation_evidence_id',
  'source_openclaw_sam31_vector_model_artifact_evidence_id',
  'source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id',
  'source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id',
]);
const SAM31_SUPPORTED_PROVENANCE_ARTIFACTS = Object.freeze([
  'openclaw.sam31_llm_extrapolation_artifact',
  SAM31_VECTOR_MODEL_ARTIFACT_PACKET_TYPE,
  'halofire_sam31_sectioning_sprinkler_review_adapter',
  'halofire.sam31_sectioning_downstream_resolver_packet.v1',
]);
const HALOFIRE_SAM31_SECTIONING_DOWNSTREAM_RESOLVER_QUEUE_ITEM_TYPE = 'halofire.sam31_sectioning_downstream_resolver_queue_item.v1';
const HALOFIRE_SAM31_SECTIONING_DOWNSTREAM_RESOLVER_PACKET_TYPE = 'halofire.sam31_sectioning_downstream_resolver_packet.v1';
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
const HALOFIRE_SAM31_OBSTRUCTION_CLASH_PACKET_TYPE = 'halofire.sam31_obstruction_clash_packet.v1';
const HALOFIRE_SAM31_SLEEVE_FIRESTOP_PACKET_TYPE = 'halofire.sam31_sleeve_firestop_packet.v1';
const HALOFIRE_SAM31_SPRINKLER_FOLLOWUP_PACKET_REVIEW_DECISION_TYPE = 'halofire.sam31_sprinkler_followup_packet_review_decision.v1';
const HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_REVIEW_DECISION_TYPE = 'halofire.sam31_consumer_intake_smoke_followup_review_decision.v1';
const HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_RESOLVER_QUEUE_ITEM_TYPE = 'halofire.sam31_consumer_intake_smoke_followup_resolver_queue_item.v1';
const HALOFIRE_SAM31_APPROVAL_UPLOAD_RESOLVER_ROW_TYPE = 'halofire.sam31_approval_upload_resolver_row.v1';
const HALOFIRE_SAM31_APPROVAL_UPLOAD_INTAKE_TYPE = 'halofire.sam31_approval_upload_intake.v1';
const HALOFIRE_SAM31_APPROVAL_UPLOAD_GATE_VALIDATION_PACKET_TYPE = 'halofire.sam31_approval_upload_gate_validation_packet.v1';
const HALOFIRE_SAM31_APPROVAL_UPLOAD_VALIDATION_DECISION_TYPE = 'halofire.sam31_approval_upload_validation_decision.v1';
const HALOFIRE_SAM31_APPROVAL_UPLOAD_REAL_VALIDATION_DECISION = 'real_signed_evidence_validated';
const HALOFIRE_SAM31_APPROVAL_UPLOAD_VALIDATION_DECISIONS = Object.freeze([
  HALOFIRE_SAM31_APPROVAL_UPLOAD_REAL_VALIDATION_DECISION,
  'default_internal_alpha_placeholder_rejected',
  'needs_more_evidence',
]);
const HALOFIRE_SAM31_APPROVAL_UPLOAD_MISSING_CODES = Object.freeze({
  professional: 'HALOFIRE_SAM31_PROFESSIONAL_APPROVAL_UPLOAD_MISSING',
  ahj: 'HALOFIRE_SAM31_AHJ_APPROVAL_UPLOAD_MISSING',
  manufacturer: 'HALOFIRE_SAM31_MANUFACTURER_EVIDENCE_UPLOAD_MISSING',
});
const HALOFIRE_SAM31_APPROVAL_UPLOAD_RULES = Object.freeze({
  [HALOFIRE_SAM31_APPROVAL_UPLOAD_MISSING_CODES.professional]: Object.freeze({
    target_approval_lane: 'professional_approval',
    evidence_type: 'professional_review',
    required_evidence_type: 'licensed_professional_signed_review',
  }),
  [HALOFIRE_SAM31_APPROVAL_UPLOAD_MISSING_CODES.ahj]: Object.freeze({
    target_approval_lane: 'AHJ_approval',
    evidence_type: 'ahj_approval',
    required_evidence_type: 'AHJ_signed_approval_or_plan_check_record',
  }),
  [HALOFIRE_SAM31_APPROVAL_UPLOAD_MISSING_CODES.manufacturer]: Object.freeze({
    target_approval_lane: 'manufacturer_exact',
    evidence_type: 'manufacturer_approval',
    required_evidence_type: 'manufacturer_catalog_or_model_proof',
  }),
});
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
  'llm_observations',
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
  const localToolDescriptor = toolEndpointConfig.endpoint ? null : localOpenClawSam31ToolDescriptor();
  return {
    artifact_type: 'openclaw.sam31_bridge_status',
    status: configured ? 'configured_unverified' : 'unavailable',
    tool_ref: 'pdfExtract:sam',
    source_runtime: 'openclaw.sam31',
    source_runtime_ref: 'sam-3.1+llm-openclaw-bridge',
    bridge_url_configured: configured,
    bridge_url: configured ? bridgeUrl : null,
    canonical_tool_descriptor_url: toolEndpointConfig.endpoint || '/api/openclaw/sam31/tool',
    canonical_tool_descriptor_source_file: toolEndpointConfig.source_file || 'halofire-api-local-contract',
    canonical_tool_descriptor_status: toolEndpointConfig.endpoint ? 'configured_unverified' : 'internal_alpha_ready',
    canonical_tool_descriptor_reachable: !toolEndpointConfig.endpoint,
    canonical_tool_descriptor: localToolDescriptor,
    canonical_tool_descriptor_error: toolEndpointConfig.endpoint ? null : null,
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
  const rows = [
    `M ${first[0]} ${first[1]}`,
    ...rest.map((point) => `L ${point[0]} ${point[1]}`),
    'Z',
  ].join(' ');
  return rows;
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

function localOpenClawSam31ToolDescriptor(projectName = null) {
  const bridgeDescriptor = sam31ToolDescriptorBody();
  const sectioningPipelineContract = {
    ...jsonClone(bridgeDescriptor.sectioning_pipeline_contract || sam31SectioningPipelineContract()),
    source_runtime: 'halofire-api-local-contract',
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
  };
  const applicationContracts = sam31ApplicationContracts();
  const consumerActions = {};
  for (const consumer of SAM31_CONSUMER_QUEUE_TARGETS) {
    const action = bridgeDescriptor.consumer_actions?.[consumer] || {};
    consumerActions[consumer] = {
      ...jsonClone(action),
      method: action.method || 'POST',
      artifact_type: action.artifact_type || `openclaw.sam31.consumer_review_queue.${consumer}.v1`,
      consumes: action.consumes || SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE,
      required_payload_type: SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE,
      required_source_provenance_fields: [...SAM31_REQUIRED_SOURCE_PROVENANCE_FIELDS],
      supported_provenance_artifacts: [...SAM31_SUPPORTED_PROVENANCE_ARTIFACTS],
      local_smoke_route: {
        method: 'POST',
        href_template: '/api/projects/{projectName}/resolver-packets/pdf-boundary/{evidenceId}/openclaw/sam31/consumer-smoke',
        produces: SAM31_CONSUMER_SMOKE_ARTIFACT_TYPE,
        claim_gate_effect: 'no_claims_cleared',
      },
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    };
  }
  const descriptor = {
    ...jsonClone(bridgeDescriptor),
    status: 'internal_alpha_ready',
    source_runtime: 'halofire-api-local-contract',
    local_tool_descriptor_source: 'halofire-api-local-contract',
    local_descriptor_route: '/api/openclaw/sam31/tool',
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    application_contracts: applicationContracts,
    extrapolation_contract: jsonClone(SAM31_EXTRAPOLATION_CONTRACT),
    sectioning_pipeline_contract: sectioningPipelineContract,
    product_review_queue_contract: {
      ...jsonClone(bridgeDescriptor.product_review_queue_contract || {}),
      artifact_type: 'openclaw.sam31.product_review_queue_contract.v1',
      status: 'internal_alpha_ready',
      source_runtime: 'halofire-api-local-contract',
      supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
      required_payload_type: SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE,
      required_source_provenance_fields: [...SAM31_REQUIRED_SOURCE_PROVENANCE_FIELDS],
      supported_provenance_artifacts: [...SAM31_SUPPORTED_PROVENANCE_ARTIFACTS],
      requires_review_before_claims: true,
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    halofire_api_actions: {
      extrapolation_artifact: {
        method: 'POST',
        href_template: '/api/projects/{projectName}/resolver-packets/pdf-boundary/{evidenceId}/openclaw/sam31/extrapolation-artifact',
        consumes: 'pdf_boundary_decision + openclaw.sam31_perception_packet',
        produces: 'openclaw.sam31_llm_extrapolation_artifact',
        claim_gate_effect: 'no_claims_cleared',
      },
      consumer_smoke: {
        method: 'POST',
        href_template: '/api/projects/{projectName}/resolver-packets/pdf-boundary/{evidenceId}/openclaw/sam31/consumer-smoke',
        consumes: SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE,
        produces: SAM31_CONSUMER_SMOKE_ARTIFACT_TYPE,
        targets: [...SAM31_CONSUMER_QUEUE_TARGETS],
        claim_gate_effect: 'no_claims_cleared',
      },
      tool_contract_packet: {
        method: 'GET',
        href_template: '/api/projects/{projectName}/resolver-packets/openclaw/sam31/tool-contract',
        produces: 'openclaw.sam31_llm_extrapolation_tool_contract_packet.v1',
        claim_gate_effect: 'no_claims_cleared',
      },
      actual_value_service_descriptor: {
        method: 'GET',
        href_template: '/api/openclaw/sam31/actual-value-service?projectName={projectName}&consumer={consumer}',
        project_route_template: '/api/projects/{projectName}/openclaw/sam31/actual-value-service?consumer={consumer}',
        produces: 'openclaw.sam31.actual_value_service_descriptor.v1',
        shared_contract_artifact_type: 'openclaw.sam31.see_label_extrapolate_contract.v1',
        consumer_action: 'poll_actual_value_service_descriptor',
        supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
        temporary_value_policy: 'best_guess_until_employee_replaced',
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      actual_value_service_descriptor_evidence: {
        method: 'POST',
        href_template: '/api/projects/{projectName}/openclaw/sam31/actual-value-service/evidence',
        consumes: 'openclaw.sam31.actual_value_service_descriptor.v1',
        produces: 'openclaw_sam31_actual_value_service_descriptor',
        evidence_record_type: 'openclaw_sam31_actual_value_service_descriptor',
        supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
        temporary_value_policy: 'best_guess_until_employee_replaced',
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      actual_value_resolver_queue: {
        method: 'GET',
        href_template: '/api/openclaw/sam31/actual-value-resolver-queue?projectName={projectName}&consumer={consumer}',
        project_route_template: '/api/projects/{projectName}/openclaw/sam31/actual-value-resolver-queue?consumer={consumer}',
        produces: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
        queue_artifact_type: 'openclaw.sam31.actual_value_resolver_queue.v1',
        consumer_action: 'poll_actual_value_resolver_queue',
        supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
        temporary_value_policy: 'best_guess_until_employee_replaced',
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      actual_value_resolver_contract_evidence: {
        method: 'POST',
        href_template: '/api/projects/{projectName}/openclaw/sam31/actual-value-resolver-contract/evidence',
        consumes: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
        produces: 'openclaw_sam31_actual_value_resolver_contract',
        evidence_record_type: 'openclaw_sam31_actual_value_resolver_contract',
        supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
        temporary_value_policy: 'best_guess_until_employee_replaced',
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      actual_value_replacement_readback: {
        method: 'GET',
        href_template: '/api/openclaw/sam31/actual-value-replacements?projectName={projectName}&consumer={consumer}',
        project_route_template: '/api/projects/{projectName}/openclaw/sam31/actual-value-replacements?consumer={consumer}',
        produces: 'openclaw.sam31.actual_value_replacement_readback.v1',
        detail_artifact_type: 'openclaw.sam31.actual_value_replacement_detail.v1',
        consumer_action: 'poll_actual_value_replacement_details',
        supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
        temporary_value_policy: 'best_guess_until_employee_replaced',
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      actual_value_replacement_readback_evidence: {
        method: 'POST',
        href_template: '/api/projects/{projectName}/openclaw/sam31/actual-value-replacements/evidence',
        consumes: 'openclaw.sam31.actual_value_replacement_readback.v1',
        produces: 'openclaw_sam31_actual_value_replacement_readback',
        evidence_record_type: 'openclaw_sam31_actual_value_replacement_readback',
        supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
        temporary_value_policy: 'best_guess_until_employee_replaced',
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      actual_value_replacement_intake: {
        method: 'POST',
        href_template: '/api/projects/{projectName}/openclaw/sam31/actual-value-replacements',
        consumes: 'openclaw.sam31.actual_value_resolver_queue_item.v1',
        produces: 'halofire.sam31_actual_value_replacement_intake.v1',
        evidence_record_type: 'sam31_actual_value_replacement',
        required_fields: [
          'source_openclaw_sam31_consumer_review_evidence_id',
          'source_ref',
        ],
        supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
        temporary_value_policy: 'best_guess_until_employee_replaced',
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      section_to_artifacts_consumer_intake_smoke: {
        method: 'POST',
        href_template: '/api/projects/{projectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke',
        consumes: 'openclaw.sam31.section_to_artifacts_consumer_handoff.v1',
        produces: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
        evidence_record_type: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
        supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
        temporary_value_policy: 'best_guess_until_employee_replaced',
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      consumer_intake_smoke_followup_packet: {
        method: 'GET',
        href_template: '/api/projects/{projectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/{evidenceId}/followup-packet',
        consumes: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
        produces: 'halofire.sam31_consumer_intake_smoke_followup_packet.v1',
        target_application: 'halo_fire',
        supported_sprinkler_review_lanes: [
          'room_boundary_visual_audit',
          'obstruction_or_clash_review',
          'vector_overlay_generation',
          'model_3d_candidate_generation',
        ],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      consumer_intake_smoke_followup_review: {
        method: 'POST',
        href_template: '/api/projects/{projectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/{evidenceId}/followup-packet/review',
        consumes: 'halofire.sam31_consumer_intake_smoke_followup_packet.v1',
        produces: HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_REVIEW_DECISION_TYPE,
        downstream_resolver_artifact_type: HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_RESOLVER_QUEUE_ITEM_TYPE,
        target_application: 'halo_fire',
        supported_sprinkler_review_lanes: [
          'room_boundary_visual_audit',
          'obstruction_or_clash_review',
        ],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      consumer_intake_smoke_sprinkler_review_packet: {
        method: 'GET',
        href_template: '/api/projects/{projectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/{evidenceId}/sprinkler-review-packet',
        consumes: HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_RESOLVER_QUEUE_ITEM_TYPE,
        produces: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
        target_application: 'halo_fire',
        supported_sprinkler_review_lanes: [
          'room_boundary_visual_audit',
          'obstruction_or_clash_review',
        ],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      consumer_intake_smoke_sprinkler_review_decision: {
        method: 'POST',
        href_template: '/api/projects/{projectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/{evidenceId}/sprinkler-review-packet/decision',
        consumes: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
        produces: HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_TYPE,
        evidence_record_type: 'halofire_sam31_sprinkler_review_decision',
        target_application: 'halo_fire',
        required_fields: [
          'issue_type',
          'supported_sprinkler_review_lane',
          'review_ref',
          'reviewed_values',
          'screenshot_ref_or_console_log_ref',
        ],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      consumer_intake_smoke_preliminary_replay_inputs: {
        method: 'GET',
        href_template: '/api/projects/{projectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/{evidenceId}/sprinkler-review-packet/decision/{sprinklerReviewEvidenceId}/preliminary-replay-inputs',
        consumes: HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_TYPE,
        produces: HALOFIRE_SAM31_SPRINKLER_REVIEW_PRELIMINARY_REPLAY_INPUTS_TYPE,
        target_application: 'halo_fire',
        source_packet_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      consumer_intake_smoke_preliminary_replay: {
        method: 'GET',
        href_template: '/api/projects/{projectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/{evidenceId}/sprinkler-review-packet/decision/{sprinklerReviewEvidenceId}/preliminary-replay',
        consumes: HALOFIRE_SAM31_SPRINKLER_REVIEW_PRELIMINARY_REPLAY_INPUTS_TYPE,
        produces: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_ARTIFACT_TYPE,
        target_application: 'halo_fire',
        source_packet_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      consumer_intake_smoke_preliminary_replay_followup: {
        method: 'POST',
        href_template: '/api/projects/{projectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/{evidenceId}/sprinkler-review-packet/decision/{sprinklerReviewEvidenceId}/preliminary-replay/followup',
        consumes: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_ARTIFACT_TYPE,
        produces: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_FOLLOWUP_DECISION_TYPE,
        downstream_resolver_artifact_types: [
          HALOFIRE_SAM31_OBSTRUCTION_CLASH_PACKET_QUEUE_ITEM_TYPE,
          HALOFIRE_SAM31_SLEEVE_FIRESTOP_PACKET_QUEUE_ITEM_TYPE,
        ],
        target_application: 'halo_fire',
        source_packet_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      consumer_intake_smoke_preliminary_replay_followup_packet: {
        method: 'GET',
        href_template: '/api/projects/{projectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/{evidenceId}/sprinkler-review-packet/decision/{sprinklerReviewEvidenceId}/preliminary-replay/followup/{followupEvidenceId}/packet/{packetIndex}',
        consumes: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_FOLLOWUP_DECISION_TYPE,
        produces_any: [
          HALOFIRE_SAM31_OBSTRUCTION_CLASH_PACKET_TYPE,
          HALOFIRE_SAM31_SLEEVE_FIRESTOP_PACKET_TYPE,
        ],
        target_application: 'halo_fire',
        source_packet_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
      consumer_intake_smoke_preliminary_replay_followup_packet_review: {
        method: 'POST',
        href_template: '/api/projects/{projectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/{evidenceId}/sprinkler-review-packet/decision/{sprinklerReviewEvidenceId}/preliminary-replay/followup/{followupEvidenceId}/packet/{packetIndex}/review',
        consumes_any: [
          HALOFIRE_SAM31_OBSTRUCTION_CLASH_PACKET_TYPE,
          HALOFIRE_SAM31_SLEEVE_FIRESTOP_PACKET_TYPE,
        ],
        produces: HALOFIRE_SAM31_SPRINKLER_FOLLOWUP_PACKET_REVIEW_DECISION_TYPE,
        target_application: 'halo_fire',
        source_packet_artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      },
    },
    consumer_actions: consumerActions,
    temporary_value_policy: 'best_guess_until_employee_replaced',
    acceptable_human_updates: [...SAM31_EMPLOYEE_REPLACEMENT_FIELDS],
    blocked_claims: uniqueStrings([
      ...SAM31_BLOCKED_CLAIMS,
      'CEO_ready',
      'brand_ready',
      'trademark_ready',
      'production_ready',
    ]),
    limitations: uniqueStrings([
      ...(Array.isArray(bridgeDescriptor.limitations) ? bridgeDescriptor.limitations : []),
      'Local HaloFire descriptor is executable internal-alpha contract truth for SAM31+LLM correction workflows across HaloFire, LandScout, and NameForge.',
      'Generated sectioning, object labels, vector overlays, and 3D candidates are best-effort temporary values until employees or owning product reviewers replace them with actual evidence.',
      'This descriptor does not clear permit-ready, AHJ-ready, engineering-grade, AutoSprink parity, fabrication-ready, manufacturer-exact, CEO-ready, brand-ready, trademark-ready, or production-ready claims.',
    ]),
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
  };
  if (projectName) descriptor.project_name = projectName;
  return descriptor;
}

function buildOpenClawSam31ToolContractPacket(projectName) {
  const descriptor = localOpenClawSam31ToolDescriptor(projectName);
  const crossProductHandoffRows = SAM31_CONSUMER_QUEUE_TARGETS.map((consumer) => {
    const action = descriptor.consumer_actions[consumer] || {};
    const contract = SAM31_APPLICATION_CONTRACTS[consumer] || {};
    return {
      artifact_type: action.artifact_type || `openclaw.sam31.consumer_review_queue.${consumer}.v1`,
      status: 'ready_for_product_review_handoff',
      consumer,
      source_application: 'halo_fire',
      project_name: projectName,
      required_payload_type: SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE,
      required_source_provenance_fields: [...SAM31_REQUIRED_SOURCE_PROVENANCE_FIELDS],
      supported_provenance_artifacts: [...SAM31_SUPPORTED_PROVENANCE_ARTIFACTS],
      endpoint: action.href || null,
      local_smoke_route_template: descriptor.halofire_api_actions.consumer_smoke.href_template,
      acceptable_evidence: [
        'openclaw.sam31.product_review_queue_item.v1',
        'product_owner_replacement_intake',
        'screenshot_or_console_evidence',
      ],
      next_action: SAM31_APPLICATION_NEXT_ACTIONS[consumer],
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      blocked_claims: uniqueStrings([...(Array.isArray(contract.blocked_claims) ? contract.blocked_claims : []), ...SAM31_BLOCKED_CLAIMS]),
      claim_gate_effect: 'no_claims_cleared',
    };
  });
  return {
    artifact_type: 'openclaw.sam31_llm_extrapolation_tool_contract_packet.v1',
    status: 'ready_for_internal_alpha_use',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    download_name: `${slugForDownloadName(projectName)}-openclaw-sam31-tool-contract.json`,
    source_runtime: 'halofire-api-local-contract',
    canonical_tool_descriptor: descriptor,
    sectioning_pipeline_contract: descriptor.sectioning_pipeline_contract,
    product_review_queue_contract: descriptor.product_review_queue_contract,
    cross_product_handoff_rows: crossProductHandoffRows,
    temporary_value_policy: 'best_guess_until_employee_replaced',
    acceptable_evidence: [
      'SAM31 segmentation masks or section packets',
      'LLM object identification observations',
      'source-linked vector overlays',
      'best-effort 3D model candidate records',
      'employee/product-owner replacement intake',
      'screenshot or console evidence for runtime observations',
    ],
    blocked_claims: uniqueStrings([
      ...descriptor.blocked_claims,
      ...crossProductHandoffRows.flatMap((row) => row.blocked_claims),
      'production_ready',
    ]),
    limitations: [
      'This contract packet makes the SAM31+LLM see-understand-extrapolate workflow executable for internal alpha review queues only.',
      'It does not clear regulated or owning-product claims; humans must replace temporary values with actual Halo Fire, LandScout, or NameForge evidence.',
      'OpenClaw/GX10 runtime reachability, segmentation accuracy, and downstream queue acceptance still require separate screenshot, console, or signed evidence.',
    ],
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
  };
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
  const sectioningPipelineContract = perceptionPacket.sectioning_pipeline_contract && typeof perceptionPacket.sectioning_pipeline_contract === 'object'
    ? perceptionPacket.sectioning_pipeline_contract
    : sam31SectioningPipelineContract(perceptionPacket.source_runtime || request.source_runtime || 'sam-3.1+llm');
  return {
    artifact_type: SAM31_PRODUCT_REVIEW_QUEUE_ITEM_TYPE,
    status: 'ready_for_human_replacement_or_acceptance',
    application: normalizedApplication,
    project_ref: projectRef || request.project_ref || perceptionPacket.project_ref || null,
    source_runtime: 'sam-3.1+llm',
    source_packet_ref: perceptionPacket.artifact_type || 'openclaw.sam31_perception_packet',
    contract_ref: productReviewAction.contract_ref || contract.contract_ref,
    sectioning_pipeline_contract_ref: sectioningPipelineContract.artifact_type,
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
  const sectioningPipelineContract = packet.sectioning_pipeline_contract && typeof packet.sectioning_pipeline_contract === 'object'
    ? packet.sectioning_pipeline_contract
    : sam31SectioningPipelineContract(packet.source_runtime || 'sam-3.1+llm');
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
    sectioning_pipeline_contract_ref: sectioningPipelineContract.artifact_type,
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
  const sectioningPipelineContract = sam31SectioningPipelineContract('sam-3.1+llm');
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
    sectioning_pipeline_contract: sectioningPipelineContract,
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
  packet.sectioning_pipeline_contract = packet.sectioning_pipeline_contract && typeof packet.sectioning_pipeline_contract === 'object' && !Array.isArray(packet.sectioning_pipeline_contract)
    ? {
      ...jsonClone(sam31SectioningPipelineContract(packet.source_runtime || 'sam-3.1+llm')),
      ...jsonClone(packet.sectioning_pipeline_contract),
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: 'no_claims_cleared',
    }
    : sam31SectioningPipelineContract(packet.source_runtime || 'sam-3.1+llm');
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
  const sourceFile = body.source_file || body.sourceFile || null;
  const sourceRef = body.source_ref || body.sourceRef || `pdf-boundary:${projectName}:page-${pageIndex}:${extractMode}`;
  const selectedSheetRef = String(body.selected_sheet_ref || body.selectedSheetRef || sourceRef || `pdf-boundary:${projectName}:sheet:${pageIndex}`).trim();
  const selectedScaleRef = String(body.selected_scale_ref || body.selectedScaleRef || `operator-scale:${scale}`).trim();
  const selectedBoundaryCandidateRef = String(
    body.selected_boundary_candidate_ref
      || body.selectedBoundaryCandidateRef
      || candidate.id
      || candidate.ref
      || `pdf-boundary:${projectName}:page-${pageIndex}:${extractMode}:candidate`,
  ).trim();
  const sourceRefs = uniqueStrings([
    ...(Array.isArray(body.source_refs) ? body.source_refs : []),
    ...(Array.isArray(body.sourceRefs) ? body.sourceRefs : []),
    sourceRef,
    sourceFile,
    selectedSheetRef,
    selectedScaleRef,
    selectedBoundaryCandidateRef,
  ]);
  const employeeDecision = {
    artifact_type: 'halofire.pdf_boundary_employee_decision.v1',
    status: 'employee_selected_internal_alpha',
    project_name: projectName,
    selected_sheet_ref: selectedSheetRef,
    selected_scale_ref: selectedScaleRef,
    selected_boundary_candidate_ref: selectedBoundaryCandidateRef,
    source_document_ref: sourceFile || sourceRef,
    source_ref: sourceRef,
    source_refs: sourceRefs,
    acceptable_evidence: [
      '1881 source sheet reference',
      'employee-selected operator scale reference',
      'employee-selected boundary candidate reference',
      'marked-up plan screenshot or review packet',
    ],
    ai_fallback: 'Use SAM 3.1+LLM/OpenClaw sectioning as best-effort correction evidence until HaloFire employees replace it with actual 1881 values.',
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    blocked_claims: blockedClaims,
    limitations: [
      'This employee decision preserves the selected sheet, scale, and boundary candidate for internal-alpha replay only.',
      'It does not clear geometry accuracy, drawing scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact claims.',
    ],
  };
  return {
    projectName,
    pageIndex,
    scale,
    extractMode,
    candidate,
    sourceFile,
    sourceRef,
    sourceRefs,
    employeeDecision,
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

function openClawSam31SectioningPipelineContractReviewFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'openclaw_sam31_sectioning_pipeline_contract_review' && parsed.review
      ? parsed.review
      : null;
  } catch {
    return null;
  }
}

function latestOpenClawSam31SectioningPipelineContractReviewEvidence(projectName, sourceEvidenceId = null) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'openclaw_sam31_sectioning_pipeline_contract_review'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  for (const row of rows) {
    const review = openClawSam31SectioningPipelineContractReviewFromEvidence(row);
    if (!review) continue;
    if (sourceEvidenceId && Number(review.source_pdf_boundary_evidence_id) !== Number(sourceEvidenceId)) {
      continue;
    }
    return { evidence: row, review };
  }
  return null;
}

function openClawSam31VectorModelArtifactFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'openclaw_sam31_vector_model_artifact_packet' && parsed.artifact
      ? parsed.artifact
      : null;
  } catch {
    return null;
  }
}

function latestOpenClawSam31VectorModelArtifactEvidence(projectName, sourceEvidenceId = null) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'openclaw_sam31_vector_model_artifact_packet'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  for (const row of rows) {
    const artifact = openClawSam31VectorModelArtifactFromEvidence(row);
    if (!artifact) continue;
    if (sourceEvidenceId && Number(artifact.source_pdf_boundary_evidence_id) !== Number(sourceEvidenceId)) {
      continue;
    }
    return { evidence: row, artifact };
  }
  return null;
}

function openClawSam31VectorModelArtifactSummary(vectorModelEvidence) {
  if (!vectorModelEvidence?.evidence || !vectorModelEvidence?.artifact) return null;
  const { evidence, artifact } = vectorModelEvidence;
  const vectorOverlays = Array.isArray(artifact.vector_overlays) ? artifact.vector_overlays : [];
  const model3dCandidates = Array.isArray(artifact.model_3d_candidates) ? artifact.model_3d_candidates : [];
  return {
    evidence_id: evidence.id,
    evidence_type: evidence.evidence_type,
    evidence_status: evidence.status,
    artifact_type: artifact.artifact_type || SAM31_VECTOR_MODEL_ARTIFACT_PACKET_TYPE,
    status: artifact.status || 'ready_for_internal_alpha_review',
    source_ref: evidence.source_ref,
    source_pdf_boundary_evidence_id: artifact.source_pdf_boundary_evidence_id || null,
    source_sam31_visual_audit_evidence_id: artifact.source_sam31_visual_audit_evidence_id || null,
    source_runtime: artifact.source_runtime || 'sam-3.1+llm',
    vector_overlay_count: vectorOverlays.length,
    model_3d_candidate_count: model3dCandidates.length,
    vector_overlays: jsonClone(vectorOverlays),
    model_3d_candidates: jsonClone(model3dCandidates),
    use_for_claims: artifact.use_for_claims === true ? true : false,
    no_claim_gates_cleared: artifact.no_claim_gates_cleared !== false,
    claim_gate_effect: artifact.claim_gate_effect || 'no_claims_cleared',
    blocked_claims: Array.isArray(artifact.blocked_claims) ? [...artifact.blocked_claims] : [],
    limitations: Array.isArray(artifact.limitations) ? [...artifact.limitations] : [],
  };
}

function openClawSam31VectorModelArtifactReviewContext(projectName, sourceEvidenceId) {
  const summary = openClawSam31VectorModelArtifactSummary(
    latestOpenClawSam31VectorModelArtifactEvidence(projectName, sourceEvidenceId),
  );
  if (!summary) {
    return {
      source_openclaw_sam31_vector_model_artifact_evidence_id: null,
      openclaw_sam31_vector_model_artifact: null,
      source_linked_vector_overlays: [],
      source_linked_model_3d_candidates: [],
      source_refs: [],
    };
  }
  const artifactRef = {
    artifact_type: summary.artifact_type || SAM31_VECTOR_MODEL_ARTIFACT_PACKET_TYPE,
    evidence_id: summary.evidence_id,
    evidence_type: summary.evidence_type,
    evidence_status: summary.evidence_status,
    status: summary.status || 'ready_for_internal_alpha_review',
    source_ref: summary.source_ref || null,
    source_pdf_boundary_evidence_id: summary.source_pdf_boundary_evidence_id || null,
    source_sam31_visual_audit_evidence_id: summary.source_sam31_visual_audit_evidence_id || null,
    source_runtime: summary.source_runtime || 'sam-3.1+llm',
    vector_overlay_count: summary.vector_overlay_count || 0,
    model_3d_candidate_count: summary.model_3d_candidate_count || 0,
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    blocked_claims: Array.isArray(summary.blocked_claims) ? [...summary.blocked_claims] : [],
    limitations: Array.isArray(summary.limitations) ? [...summary.limitations] : [],
  };
  const enrichLinkedRow = (row, lane) => ({
    ...(row && typeof row === 'object' ? jsonClone(row) : {}),
    source_openclaw_sam31_vector_model_artifact_evidence_id: summary.evidence_id,
    source_pdf_boundary_evidence_id: summary.source_pdf_boundary_evidence_id || sourceEvidenceId || null,
    source_sam31_visual_audit_evidence_id: summary.source_sam31_visual_audit_evidence_id || null,
    source_runtime: summary.source_runtime || 'sam-3.1+llm',
    source_evidence_lane: lane,
    temporary_value_policy: 'best_guess_until_employee_replaced',
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
  });
  return {
    source_openclaw_sam31_vector_model_artifact_evidence_id: summary.evidence_id,
    openclaw_sam31_vector_model_artifact: artifactRef,
    source_linked_vector_overlays: (Array.isArray(summary.vector_overlays) ? summary.vector_overlays : [])
      .map((row) => enrichLinkedRow(row, 'vector_overlay_generation')),
    source_linked_model_3d_candidates: (Array.isArray(summary.model_3d_candidates) ? summary.model_3d_candidates : [])
      .map((row) => enrichLinkedRow(row, 'model_3d_candidate_generation')),
    source_refs: [
      {
        evidence_id: summary.evidence_id,
        evidence_type: 'openclaw_sam31_vector_model_artifact_packet',
        artifact_type: summary.artifact_type || SAM31_VECTOR_MODEL_ARTIFACT_PACKET_TYPE,
        source_ref: summary.source_ref || null,
        status: summary.evidence_status || summary.status || 'best_effort',
        source_pdf_boundary_evidence_id: summary.source_pdf_boundary_evidence_id || sourceEvidenceId || null,
        source_sam31_visual_audit_evidence_id: summary.source_sam31_visual_audit_evidence_id || null,
        claim_gate_effect: 'no_claims_cleared',
      },
    ],
  };
}

function buildOpenClawSam31SectioningPipelineContractPacket(projectName, evidence, decision, extrapolationEvidence = null) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  const extrapolationArtifact = extrapolationEvidence?.artifact || null;
  const sectioningPipelineContract = extrapolationArtifact?.sectioning_pipeline_contract && typeof extrapolationArtifact.sectioning_pipeline_contract === 'object'
    ? {
      ...jsonClone(sam31SectioningPipelineContract(extrapolationArtifact.source_runtime || 'sam-3.1+llm')),
      ...jsonClone(extrapolationArtifact.sectioning_pipeline_contract),
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: 'no_claims_cleared',
    }
    : {
      ...jsonClone(localOpenClawSam31ToolDescriptor(projectName).sectioning_pipeline_contract),
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: 'no_claims_cleared',
    };
  const sourceRefs = [
    {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_file: evidence.source_file || decision.sourceFile || null,
      source_ref: evidence.source_ref || decision.sourceRef || null,
      status: evidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
  ];
  if (extrapolationEvidence?.evidence) {
    sourceRefs.push({
      evidence_id: extrapolationEvidence.evidence.id,
      evidence_type: extrapolationEvidence.evidence.evidence_type,
      source_file: extrapolationEvidence.evidence.source_file || null,
      source_ref: extrapolationEvidence.evidence.source_ref || extrapolationArtifact?.openclaw_endpoint || null,
      status: extrapolationEvidence.evidence.status,
      claim_gate_effect: 'no_claims_cleared',
    });
  }
  return {
    artifact_type: 'openclaw.sam31.sectioning_pipeline_contract_packet.v1',
    status: 'ready_for_internal_alpha_review',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    download_name: `${slugForDownloadName(projectName)}-sam31-sectioning-pipeline-contract-${evidence.id}.json`,
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_extrapolation_evidence_id: extrapolationEvidence?.evidence?.id || null,
    source_runtime: sectioningPipelineContract.source_runtime || 'halofire-api-local-contract',
    sectioning_pipeline_contract: sectioningPipelineContract,
    source_refs: sourceRefs,
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    supported_evidence_lanes: [
      'room_boundary_visual_audit',
      'object_identification_review',
      'vector_overlay_generation',
      'model_3d_candidate_generation',
      'product_review_queue',
    ],
    temporary_value_policy: 'best_guess_until_employee_replaced',
    acceptable_evidence: [
      'employee or product-owner reviewed semantic label',
      'source-linked corrected polygon or bbox',
      'source-linked corrected vector overlay',
      'source-linked corrected 3D model candidate',
      'screenshot or console evidence for reviewed sectioning',
    ],
    next_action: 'Use this sectioning pipeline contract to review or replace SAM31/LLM sections, object labels, vector overlays, and 3D candidates; no claim gates clear until actual approval evidence is attached.',
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    blocked_claims: uniqueStrings([
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      ...SAM31_BLOCKED_CLAIMS,
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
    ]),
    limitations: [
      'This packet is a source-linked review/download affordance for SAM31+LLM sectioning semantics only.',
      'It does not prove geometry accuracy, drawing scale, professional approval, AHJ approval, AutoSprink parity, fabrication readiness, manufacturer exactness, or product readiness.',
      'Generated sectioning, object labels, vector overlays, and 3D candidates remain best-effort temporary values until employee or owning-product evidence replaces them.',
    ],
  };
}

function buildOpenClawSam31VectorModelArtifactPacket(projectName, evidence, decision, sam31Evidence) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!sam31Evidence?.evidence || !sam31Evidence?.result?.openclaw_sam31_perception_packet) {
    const e = new Error('SAM31 visual audit evidence with an OpenClaw SAM31 perception packet is required before vector/model artifacts can be persisted');
    e.httpStatus = 409;
    throw e;
  }
  const perceptionPacket = sam31Evidence.result.openclaw_sam31_perception_packet;
  const vectorOverlays = Array.isArray(perceptionPacket.vector_overlays) ? perceptionPacket.vector_overlays : [];
  const model3dCandidates = Array.isArray(perceptionPacket.model_3d_candidates) ? perceptionPacket.model_3d_candidates : [];
  const sourceRefs = [
    {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_file: evidence.source_file || decision.sourceFile || null,
      source_ref: evidence.source_ref || decision.sourceRef || null,
      status: evidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_id: sam31Evidence.evidence.id,
      evidence_type: sam31Evidence.evidence.evidence_type,
      source_file: sam31Evidence.evidence.source_file || null,
      source_ref: sam31Evidence.evidence.source_ref || sam31Evidence.result.sam31_result_ref || null,
      status: sam31Evidence.evidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
    ...(Array.isArray(perceptionPacket.source_refs) ? jsonClone(perceptionPacket.source_refs) : []),
  ];
  const enrichArtifactRow = (row) => ({
    ...(row && typeof row === 'object' ? jsonClone(row) : {}),
    source_pdf_boundary_evidence_id: evidence.id,
    source_sam31_visual_audit_evidence_id: sam31Evidence.evidence.id,
    source_ref: row?.source_ref || sam31Evidence.result.sam31_result_ref || sam31Evidence.evidence.source_ref || evidence.source_ref || decision.sourceRef || null,
    source_runtime: perceptionPacket.source_runtime || 'sam-3.1+llm',
    temporary_value_policy: 'best_guess_until_employee_replaced',
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
  });
  return {
    artifact_type: SAM31_VECTOR_MODEL_ARTIFACT_PACKET_TYPE,
    status: 'ready_for_internal_alpha_review',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    download_name: `${slugForDownloadName(projectName)}-sam31-vector-model-artifacts-${evidence.id}.json`,
    source_pdf_boundary_evidence_id: evidence.id,
    source_sam31_visual_audit_evidence_id: sam31Evidence.evidence.id,
    source_runtime: perceptionPacket.source_runtime || 'sam-3.1+llm',
    application: perceptionPacket.application || 'halo_fire',
    source_ref: sam31Evidence.result.sam31_result_ref || sam31Evidence.evidence.source_ref || evidence.source_ref || decision.sourceRef || null,
    source_file: evidence.source_file || decision.sourceFile || null,
    source_refs: sourceRefs,
    vector_overlays: vectorOverlays.map(enrichArtifactRow),
    model_3d_candidates: model3dCandidates.map(enrichArtifactRow),
    operator_audit_summary: {
      artifact_type: 'openclaw.sam31_vector_model_operator_audit_summary.v1',
      source_pdf_boundary_evidence_id: evidence.id,
      source_sam31_visual_audit_evidence_id: sam31Evidence.evidence.id,
      source_runtime: perceptionPacket.source_runtime || 'sam-3.1+llm',
      vector_overlay_count: vectorOverlays.length,
      model_3d_candidate_count: model3dCandidates.length,
      source_ref: sam31Evidence.result.sam31_result_ref || sam31Evidence.evidence.source_ref || evidence.source_ref || decision.sourceRef || null,
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: 'no_claims_cleared',
    },
    perception_summary: sam31PerceptionPacketSummary(perceptionPacket),
    supported_evidence_lanes: uniqueStrings([
      ...(SAM31_APPLICATION_CONTRACTS.halo_fire.supported_evidence_lanes || []),
      'vector_overlay_generation',
      'model_3d_candidate_generation',
    ]),
    temporary_value_policy: 'best_guess_until_employee_replaced',
    acceptable_human_updates: [...SAM31_EMPLOYEE_REPLACEMENT_FIELDS],
    use_for_claims: false,
    no_claim_gates_cleared: true,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(perceptionPacket.blocked_claims) ? perceptionPacket.blocked_claims : []),
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      ...SAM31_BLOCKED_CLAIMS,
      'geometry_accuracy',
      'permit_ready',
      'AHJ_approval',
      'AutoSprink_parity',
      'manufacturer_exact',
    ]),
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'SAM31 vector overlays and 3D candidates are best-effort internal-alpha extrapolations only.',
      'Halo Fire employees may use this packet to replace temporary values, but it does not clear geometry accuracy, permit, AHJ, PE, AutoSprink, fabrication, or manufacturer-exact claims.',
      'Source-linked SAM31 artifacts support review and replay workflows only until actual employee/professional/AHJ/manufacturer evidence is recorded.',
    ],
    next_action: 'Halo Fire employee reviews the source-linked vector overlays and 3D candidates, then accepts or replaces temporary values before replay; regulated claims remain blocked.',
  };
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

function openClawSam31SectioningPipelineContractReviewSummary(reviewEvidence) {
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
    source_sectioning_pipeline_contract_artifact_type: review.source_sectioning_pipeline_contract_artifact_type || null,
    reviewer_name: review.reviewer_name || null,
    replacement_ref: review.replacement_ref || null,
    replaced_fields: Array.isArray(review.replaced_fields) ? [...review.replaced_fields] : [],
    replacement_summary: {
      semantic_label_count: Array.isArray(review.replacement_values?.semantic_labels) ? review.replacement_values.semantic_labels.length : 0,
      polygon_count: Array.isArray(review.replacement_values?.polygons) ? review.replacement_values.polygons.length : 0,
      bbox_count: Array.isArray(review.replacement_values?.bboxes) ? review.replacement_values.bboxes.length : 0,
      vector_overlay_count: Array.isArray(review.replacement_values?.vector_overlays) ? review.replacement_values.vector_overlays.length : 0,
      model_3d_candidate_count: Array.isArray(review.replacement_values?.model_3d_candidates) ? review.replacement_values.model_3d_candidates.length : 0,
    },
    use_for_claims: review.use_for_claims === true,
    no_claim_gates_cleared: review.no_claim_gates_cleared !== false,
    claim_gate_effect: review.claim_gate_effect || 'no_claims_cleared',
    blocked_claims: Array.isArray(review.blocked_claims) ? [...review.blocked_claims] : [],
    limitations: Array.isArray(review.limitations) ? [...review.limitations] : [],
  };
}

function openClawSam31SectioningDownstreamResolverQueueItems(projectName, evidence, decision, reviewEvidence) {
  if (!evidence || !decision || !reviewEvidence?.evidence || !reviewEvidence?.review) return [];
  const { evidence: sectioningReviewEvidence, review } = reviewEvidence;
  if (review.review_decision === 'rejected') return [];
  const values = review.replacement_values && typeof review.replacement_values === 'object'
    ? review.replacement_values
    : {};
  const semanticLabels = Array.isArray(values.semantic_labels) ? values.semantic_labels : [];
  const polygons = Array.isArray(values.polygons) ? values.polygons : [];
  const bboxes = Array.isArray(values.bboxes) ? values.bboxes : [];
  const objectHypotheses = Array.isArray(values.object_hypotheses) ? values.object_hypotheses : [];
  const vectorOverlays = Array.isArray(values.vector_overlays) ? values.vector_overlays : [];
  const model3dCandidates = Array.isArray(values.model_3d_candidates) ? values.model_3d_candidates : [];
  const commonBlockedClaims = uniqueStrings([
    ...(Array.isArray(review.blocked_claims) ? review.blocked_claims : []),
    ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
    'permit_ready',
    'professional_approval',
    'AHJ_approval',
    'AutoSprink_parity',
    'fabrication_ready',
    'manufacturer_exact',
  ]);
  const sourceRefs = uniqueByJson([
    {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_file: evidence.source_file || decision.sourceFile || null,
      source_ref: evidence.source_ref || decision.sourceRef || null,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_id: review.source_openclaw_sam31_extrapolation_evidence_id || null,
      evidence_type: 'openclaw_sam31_extrapolation_artifact',
      source_ref: review.source_openclaw_sam31_extrapolation_ref || null,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_id: sectioningReviewEvidence.id,
      evidence_type: sectioningReviewEvidence.evidence_type,
      source_ref: sectioningReviewEvidence.source_ref || review.replacement_ref || null,
      artifact_type: review.artifact_type || 'openclaw.sam31.sectioning_pipeline_contract_review.v1',
      claim_gate_effect: 'no_claims_cleared',
    },
  ]);
  const base = {
    artifact_type: HALOFIRE_SAM31_SECTIONING_DOWNSTREAM_RESOLVER_QUEUE_ITEM_TYPE,
    status: 'ready_for_downstream_resolver',
    project_name: projectName,
    source_runtime: review.source_runtime || 'sam-3.1+llm',
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: sectioningReviewEvidence.id,
    source_openclaw_sam31_extrapolation_evidence_id: review.source_openclaw_sam31_extrapolation_evidence_id || null,
    source_sectioning_pipeline_contract_artifact_type: review.source_sectioning_pipeline_contract_artifact_type || 'openclaw.sam31.sectioning_pipeline_contract.v1',
    replacement_ref: review.replacement_ref || sectioningReviewEvidence.source_ref || null,
    reviewed_semantic_label_count: semanticLabels.length,
    reviewed_polygon_count: polygons.length,
    reviewed_bbox_count: bboxes.length,
    reviewed_object_hypothesis_count: objectHypotheses.length,
    reviewed_vector_overlay_count: vectorOverlays.length,
    reviewed_model_3d_candidate_count: model3dCandidates.length,
    source_refs: sourceRefs,
    blocked_claims: commonBlockedClaims,
    temporary_value_policy: review.temporary_value_policy || 'best_guess_until_employee_replaced',
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'This resolver row turns reviewed SAM31 sectioning values into executable internal-alpha follow-up work only.',
      'It does not prove geometry accuracy, drawing scale, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact models.',
    ],
  };
  const rows = [];
  if (semanticLabels.length || polygons.length || bboxes.length) {
    rows.push({
      ...base,
      id: `sam31-sectioning-downstream:${evidence.id}:${sectioningReviewEvidence.id}:room-boundary`,
      downstream_resolver_lane: 'room_boundary_visual_audit',
      supported_evidence_lanes: ['sam31_sectioning', 'room_boundary_visual_audit'],
      issue_type: 'sam31_sectioning_reviewed_room_boundary',
      next_action: 'Use the reviewed SAM31 semantic labels, polygons, and bboxes to run a room-boundary replay packet; attach employee/AHJ/professional evidence before any regulated claim.',
      acceptable_evidence: [
        'employee reviewed room-boundary replay packet',
        'marked-up 1881 sheet screenshot tied to reviewed SAM31 sectioning values',
        'licensed professional or AHJ signoff for regulated claims',
      ],
      executable_action: {
        label: 'Download room-boundary replay input',
        method: 'GET',
        href: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/replay-input`,
        claim_gate_effect: 'no_claims_cleared',
      },
    });
  }
  if (objectHypotheses.length || vectorOverlays.length || model3dCandidates.length) {
    rows.push({
      ...base,
      id: `sam31-sectioning-downstream:${evidence.id}:${sectioningReviewEvidence.id}:sprinkler-obstruction`,
      downstream_resolver_lane: 'obstruction_or_clash_review',
      supported_evidence_lanes: ['llm_object_identification', 'vector_overlay_generation', 'model_3d_candidate_generation', 'obstruction_or_clash_review'],
      issue_type: 'sam31_sectioning_reviewed_vector_model_candidates',
      next_action: 'Use the reviewed SAM31 object/vector/3D candidates to queue obstruction, clash, sleeve, or firestop review; attach signed approval evidence before any regulated claim.',
      acceptable_evidence: [
        'HaloFire employee obstruction/clash review note',
        'source-linked vector overlay or 3D model candidate reference',
        'marked-up 1881 sheet screenshot',
        'professional/AHJ/manufacturer evidence for any regulated claim',
      ],
      executable_action: {
        label: 'Download SAM31 vector/model artifact packet',
        method: 'GET',
        href: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/openclaw/sam31/vector-model-artifacts`,
        claim_gate_effect: 'no_claims_cleared',
      },
    });
  }
  return rows;
}

function buildHalofireSam31SectioningDownstreamResolverPacket(projectName, evidence, decision, reviewEvidence) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!reviewEvidence?.evidence || !reviewEvidence?.review) {
    const e = new Error('OpenClaw SAM31 sectioning contract review evidence is required before downstream resolver rows can be downloaded');
    e.httpStatus = 409;
    throw e;
  }
  const rows = openClawSam31SectioningDownstreamResolverQueueItems(projectName, evidence, decision, reviewEvidence);
  if (!rows.length) {
    const e = new Error('Reviewed SAM31 sectioning values did not produce downstream resolver queue rows');
    e.httpStatus = 409;
    throw e;
  }
  const { evidence: sectioningReviewEvidence, review } = reviewEvidence;
  const reviewedValues = review.replacement_values && typeof review.replacement_values === 'object'
    ? jsonClone(review.replacement_values)
    : {};
  const sourceRefs = uniqueByJson([
    {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      source_file: evidence.source_file || decision.sourceFile || null,
      source_ref: evidence.source_ref || decision.sourceRef || null,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_id: sectioningReviewEvidence.id,
      evidence_type: sectioningReviewEvidence.evidence_type,
      source_file: sectioningReviewEvidence.source_file || null,
      source_ref: sectioningReviewEvidence.source_ref || review.replacement_ref || null,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_id: review.source_openclaw_sam31_extrapolation_evidence_id || null,
      evidence_type: 'openclaw_sam31_extrapolation_artifact',
      source_ref: review.source_openclaw_sam31_extrapolation_ref || null,
      claim_gate_effect: 'no_claims_cleared',
    },
    ...(Array.isArray(review.source_refs) ? jsonClone(review.source_refs) : []),
  ]);
  return {
    artifact_type: HALOFIRE_SAM31_SECTIONING_DOWNSTREAM_RESOLVER_PACKET_TYPE,
    status: 'ready_for_downstream_resolver',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    download_name: `${slugForDownloadName(projectName)}-sam31-sectioning-downstream-resolvers-${evidence.id}.json`,
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: sectioningReviewEvidence.id,
    source_openclaw_sam31_extrapolation_evidence_id: review.source_openclaw_sam31_extrapolation_evidence_id || null,
    source_runtime: review.source_runtime || 'sam-3.1+llm',
    source_sectioning_pipeline_contract_artifact_type: review.source_sectioning_pipeline_contract_artifact_type || 'openclaw.sam31.sectioning_pipeline_contract.v1',
    downstream_resolver_queue_item_count: rows.length,
    downstream_resolver_lanes: uniqueStrings(rows.map((row) => row.downstream_resolver_lane).filter(Boolean)),
    downstream_resolver_queue_items: rows,
    reviewed_sectioning_values: reviewedValues,
    source_refs: sourceRefs,
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    supported_evidence_lanes: uniqueStrings(rows.flatMap((row) => Array.isArray(row.supported_evidence_lanes) ? row.supported_evidence_lanes : [])),
    temporary_value_policy: review.temporary_value_policy || 'best_guess_until_employee_replaced',
    acceptable_evidence: uniqueStrings(rows.flatMap((row) => Array.isArray(row.acceptable_evidence) ? row.acceptable_evidence : [])),
    next_action: 'Download this packet to drive the next room-boundary replay, obstruction/clash, sleeve, firestop, or sprinkler-review adapter step; attach employee/professional/AHJ/manufacturer evidence before any regulated claim.',
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    blocked_claims: uniqueStrings([
      ...(Array.isArray(review.blocked_claims) ? review.blocked_claims : []),
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      ...rows.flatMap((row) => Array.isArray(row.blocked_claims) ? row.blocked_claims : []),
      'permit_ready',
      'professional_approval',
      'AHJ_approval',
      'AutoSprink_parity',
      'fabrication_ready',
      'manufacturer_exact',
    ]),
    limitations: [
      'This packet makes reviewed SAM31 sectioning values executable as internal-alpha resolver work only.',
      'It does not prove geometry accuracy, drawing scale, professional approval, AHJ approval, AutoSprink parity, permit readiness, fabrication readiness, or manufacturer-exact models.',
      'All generated labels, vectors, and 3D candidates remain temporary best guesses until HaloFire employees or owning approvers replace them with actual evidence.',
    ],
  };
}

function halofireSam31SectioningDownstreamResolverPacketFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'halofire_sam31_sectioning_downstream_resolver_packet' && parsed.packet
      ? parsed.packet
      : null;
  } catch {
    return null;
  }
}

function latestHalofireSam31SectioningDownstreamResolverPacketEvidence(projectName, sourceEvidenceId = null) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'halofire_sam31_sectioning_downstream_resolver_packet'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  for (const row of rows) {
    const packet = halofireSam31SectioningDownstreamResolverPacketFromEvidence(row);
    if (!packet) continue;
    if (sourceEvidenceId && Number(packet.source_pdf_boundary_evidence_id) !== Number(sourceEvidenceId)) continue;
    return { evidence: row, packet };
  }
  return null;
}

function halofireSam31SectioningDownstreamResolverPacketSummary(packetEvidence) {
  if (!packetEvidence?.evidence || !packetEvidence?.packet) return null;
  const { evidence, packet } = packetEvidence;
  return {
    evidence_id: evidence.id,
    evidence_type: evidence.evidence_type,
    evidence_status: evidence.status,
    artifact_type: packet.artifact_type || HALOFIRE_SAM31_SECTIONING_DOWNSTREAM_RESOLVER_PACKET_TYPE,
    status: packet.status || 'ready_for_downstream_resolver',
    source_ref: evidence.source_ref,
    source_pdf_boundary_evidence_id: packet.source_pdf_boundary_evidence_id || null,
    source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: packet.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || null,
    source_openclaw_sam31_extrapolation_evidence_id: packet.source_openclaw_sam31_extrapolation_evidence_id || null,
    downstream_resolver_queue_item_count: Number(packet.downstream_resolver_queue_item_count) || 0,
    downstream_resolver_lanes: Array.isArray(packet.downstream_resolver_lanes) ? [...packet.downstream_resolver_lanes] : [],
    claim_gate_effect: packet.claim_gate_effect || 'no_claims_cleared',
    blocked_claims: Array.isArray(packet.blocked_claims) ? [...packet.blocked_claims] : [],
    limitations: Array.isArray(packet.limitations) ? [...packet.limitations] : [],
  };
}

function halofireSam31SectioningSprinklerReviewAdapterFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'halofire_sam31_sectioning_sprinkler_review_adapter' && parsed.adapter
      ? parsed.adapter
      : null;
  } catch {
    return null;
  }
}

function latestHalofireSam31SectioningSprinklerReviewAdapterEvidence(projectName, sourceEvidenceId = null) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'halofire_sam31_sectioning_sprinkler_review_adapter'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  for (const row of rows) {
    const adapter = halofireSam31SectioningSprinklerReviewAdapterFromEvidence(row);
    if (!adapter) continue;
    if (sourceEvidenceId && Number(adapter.source_pdf_boundary_evidence_id) !== Number(sourceEvidenceId)) continue;
    return { evidence: row, adapter };
  }
  return null;
}

function halofireSam31SectioningSprinklerReviewAdapterSummary(adapterEvidence) {
  if (!adapterEvidence?.evidence || !adapterEvidence?.adapter) return null;
  const { evidence, adapter } = adapterEvidence;
  const issueSeeds = Array.isArray(adapter.sprinkler_review_packet?.issue_seeds)
    ? adapter.sprinkler_review_packet.issue_seeds
    : [];
  return {
    evidence_id: evidence.id,
    evidence_type: evidence.evidence_type,
    evidence_status: evidence.status,
    artifact_type: adapter.artifact_type || SAM31_TO_SPRINKLER_REVIEW_ADAPTER_TYPE,
    status: adapter.status || 'ready_for_internal_alpha_sprinkler_review',
    adapter_source: adapter.adapter_source || HALOFIRE_SAM31_SECTIONING_DOWNSTREAM_RESOLVER_PACKET_TYPE,
    source_ref: evidence.source_ref,
    source_pdf_boundary_evidence_id: adapter.source_pdf_boundary_evidence_id || null,
    source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: adapter.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id || null,
    source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: adapter.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || null,
    source_openclaw_sam31_extrapolation_evidence_id: adapter.source_openclaw_sam31_extrapolation_evidence_id || null,
    sprinkler_review_issue_seed_count: issueSeeds.length,
    supported_sprinkler_review_lanes: Array.isArray(adapter.supported_sprinkler_review_lanes)
      ? [...adapter.supported_sprinkler_review_lanes]
      : [],
    source_linked_vector_overlay_count: Array.isArray(adapter.source_linked_vector_overlays) ? adapter.source_linked_vector_overlays.length : 0,
    source_linked_model_3d_candidate_count: Array.isArray(adapter.source_linked_model_3d_candidates) ? adapter.source_linked_model_3d_candidates.length : 0,
    claim_gate_effect: adapter.claim_gate_effect || 'no_claims_cleared',
    blocked_claims: Array.isArray(adapter.blocked_claims) ? [...adapter.blocked_claims] : [],
    limitations: Array.isArray(adapter.limitations) ? [...adapter.limitations] : [],
  };
}

function halofireSam31SectioningSprinklerReviewAdapterReplayContext(projectName, sourceEvidenceId = null) {
  const adapterEvidence = latestHalofireSam31SectioningSprinklerReviewAdapterEvidence(projectName, sourceEvidenceId);
  const summary = halofireSam31SectioningSprinklerReviewAdapterSummary(adapterEvidence);
  if (!summary || !adapterEvidence?.adapter) {
    return {
      source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id: null,
      source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: null,
      source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: null,
      source_openclaw_sam31_extrapolation_evidence_id: null,
      halofire_sam31_sectioning_sprinkler_review_adapter: null,
      source_linked_vector_overlays: [],
      source_linked_model_3d_candidates: [],
      source_refs: [],
    };
  }
  const { evidence, adapter } = adapterEvidence;
  return {
    source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id: evidence.id,
    source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: adapter.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id || null,
    source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: adapter.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || null,
    source_openclaw_sam31_extrapolation_evidence_id: adapter.source_openclaw_sam31_extrapolation_evidence_id || null,
    halofire_sam31_sectioning_sprinkler_review_adapter: summary,
    source_linked_vector_overlays: Array.isArray(adapter.source_linked_vector_overlays) ? jsonClone(adapter.source_linked_vector_overlays) : [],
    source_linked_model_3d_candidates: Array.isArray(adapter.source_linked_model_3d_candidates) ? jsonClone(adapter.source_linked_model_3d_candidates) : [],
    source_refs: uniqueByJson([
      {
        evidence_id: evidence.id,
        evidence_type: evidence.evidence_type,
        source_file: evidence.source_file || null,
        source_ref: evidence.source_ref || null,
        status: evidence.status,
        claim_gate_effect: 'no_claims_cleared',
      },
      ...(Array.isArray(adapter.source_refs) ? jsonClone(adapter.source_refs) : []),
    ]),
  };
}

function halofireSam31SectioningSprinklerIssueSeeds(packet) {
  const rows = Array.isArray(packet?.downstream_resolver_queue_items)
    ? packet.downstream_resolver_queue_items
    : [];
  const issueCountForRow = (row) => {
    const lane = String(row.downstream_resolver_lane || '');
    if (lane === 'room_boundary_visual_audit') {
      return Number(row.reviewed_semantic_label_count || 0)
        + Number(row.reviewed_polygon_count || 0)
        + Number(row.reviewed_bbox_count || 0);
    }
    if (lane === 'obstruction_or_clash_review') {
      return Number(row.reviewed_object_hypothesis_count || 0)
        + Number(row.reviewed_vector_overlay_count || 0)
        + Number(row.reviewed_model_3d_candidate_count || 0);
    }
    return 0;
  };
  const seeds = rows.map((row) => ({
    issue_type: row.issue_type || `sam31_sectioning_downstream_${row.downstream_resolver_lane || 'review'}`,
    status: 'requires_employee_sprinkler_review',
    count: issueCountForRow(row),
    supported_sprinkler_review_lane: row.downstream_resolver_lane || 'room_boundary_visual_audit',
    source_downstream_resolver_queue_item_id: row.id || null,
    next_action: row.next_action || 'Review the SAM31 sectioning downstream row before sprinkler layout, CAD, BIM, sleeve, firestop, obstruction, or clash use.',
    acceptable_evidence: Array.isArray(row.acceptable_evidence) ? [...row.acceptable_evidence] : [],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
  }));
  if (!seeds.length) {
    seeds.push({
      issue_type: 'sam31_sectioning_downstream_rows_missing',
      status: 'requires_employee_sprinkler_review',
      count: 0,
      supported_sprinkler_review_lane: 'room_boundary_visual_audit',
      source_downstream_resolver_queue_item_id: null,
      next_action: 'Attach a saved SAM31 sectioning downstream resolver packet with room-boundary or obstruction/clash rows before sprinkler review.',
      acceptable_evidence: ['saved SAM31 sectioning downstream resolver packet'],
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    });
  }
  return seeds;
}

function buildHalofireSam31SectioningToSprinklerReviewAdapter(projectName, evidence, decision, downstreamPacketEvidence) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!downstreamPacketEvidence?.evidence || !downstreamPacketEvidence?.packet) {
    const e = new Error('Saved HaloFire SAM31 sectioning downstream resolver packet evidence is required before building the sprinkler review adapter');
    e.httpStatus = 404;
    throw e;
  }
  const { evidence: packetEvidence, packet } = downstreamPacketEvidence;
  if (Number(packet.source_pdf_boundary_evidence_id) !== Number(evidence.id)) {
    const e = new Error('SAM31 sectioning downstream resolver packet does not belong to the requested PDF boundary evidence');
    e.httpStatus = 409;
    throw e;
  }
  const reviewedValues = packet.reviewed_sectioning_values && typeof packet.reviewed_sectioning_values === 'object'
    ? jsonClone(packet.reviewed_sectioning_values)
    : {};
  const rows = Array.isArray(packet.downstream_resolver_queue_items)
    ? jsonClone(packet.downstream_resolver_queue_items)
    : [];
  const sourceLinkedVectorOverlays = Array.isArray(reviewedValues.vector_overlays)
    ? jsonClone(reviewedValues.vector_overlays)
    : [];
  const sourceLinkedModel3dCandidates = Array.isArray(reviewedValues.model_3d_candidates)
    ? jsonClone(reviewedValues.model_3d_candidates)
    : [];
  const supportedSprinklerReviewLanes = uniqueStrings([
    ...rows.map((row) => row.downstream_resolver_lane).filter(Boolean),
    ...rows.flatMap((row) => Array.isArray(row.supported_evidence_lanes) ? row.supported_evidence_lanes : []),
    'room_boundary_visual_audit',
    'obstruction_or_clash_review',
    'vector_overlay_generation',
    'model_3d_candidate_generation',
  ]);
  const issueSeeds = halofireSam31SectioningSprinklerIssueSeeds(packet);
  const blockedClaims = uniqueStrings([
    ...(Array.isArray(packet.blocked_claims) ? packet.blocked_claims : []),
    ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
    'permit_ready',
    'professional_approval',
    'AHJ_approval',
    'AutoSprink_parity',
    'fabrication_ready',
    'manufacturer_exact',
  ]);
  const sourceRefs = uniqueByJson([
    ...(Array.isArray(packet.source_refs) ? jsonClone(packet.source_refs) : []),
    {
      evidence_id: packetEvidence.id,
      evidence_type: packetEvidence.evidence_type,
      source_ref: packetEvidence.source_ref,
      artifact_type: packet.artifact_type || HALOFIRE_SAM31_SECTIONING_DOWNSTREAM_RESOLVER_PACKET_TYPE,
      claim_gate_effect: 'no_claims_cleared',
    },
  ]);
  return {
    artifact_type: SAM31_TO_SPRINKLER_REVIEW_ADAPTER_TYPE,
    status: 'ready_for_internal_alpha_sprinkler_review',
    adapter_source: HALOFIRE_SAM31_SECTIONING_DOWNSTREAM_RESOLVER_PACKET_TYPE,
    project_name: projectName,
    generated_at: new Date().toISOString(),
    download_name: `${slugForDownloadName(projectName)}-sam31-sectioning-sprinkler-review-adapter-${packetEvidence.id}.json`,
    source_pdf_boundary_evidence_id: evidence.id,
    source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: packetEvidence.id,
    source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: packet.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || null,
    source_openclaw_sam31_extrapolation_evidence_id: packet.source_openclaw_sam31_extrapolation_evidence_id || null,
    source_runtime: packet.source_runtime || 'sam-3.1+llm',
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    supported_sprinkler_review_lanes: supportedSprinklerReviewLanes,
    downstream_resolver_queue_items: rows,
    reviewed_sam31_values: reviewedValues,
    source_linked_vector_overlays: sourceLinkedVectorOverlays,
    source_linked_model_3d_candidates: sourceLinkedModel3dCandidates,
    sprinkler_review_packet: {
      artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
      source: SAM31_TO_SPRINKLER_REVIEW_ADAPTER_TYPE,
      adapter_source: HALOFIRE_SAM31_SECTIONING_DOWNSTREAM_RESOLVER_PACKET_TYPE,
      status: 'requires_employee_sprinkler_review',
      project_name: projectName,
      source_pdf_boundary_evidence_id: evidence.id,
      source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: packetEvidence.id,
      source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: packet.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || null,
      source_openclaw_sam31_extrapolation_evidence_id: packet.source_openclaw_sam31_extrapolation_evidence_id || null,
      supported_sprinkler_review_lanes: supportedSprinklerReviewLanes,
      issue_seeds: issueSeeds,
      source_linked_vector_overlays: sourceLinkedVectorOverlays,
      source_linked_model_3d_candidates: sourceLinkedModel3dCandidates,
      next_action: 'Use these reviewed SAM31 sectioning values to prepare room-boundary visual audit, obstruction/clash, vector overlay, 3D candidate, sleeve, or firestop review tasks; keep regulated claims blocked.',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    source_refs: sourceRefs,
    blocked_claims: blockedClaims,
    temporary_value_policy: packet.temporary_value_policy || 'best_guess_until_employee_replaced',
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: uniqueStrings([
      ...(Array.isArray(packet.limitations) ? packet.limitations : []),
      'This adapter converts saved SAM31+LLM sectioning downstream rows into HaloFire sprinkler review evidence only.',
      'It does not clear permit-ready, AHJ-ready, fabrication-ready, engineering-grade, AutoSprink parity, manufacturer-exact, or professionally approved claims.',
      'All labels, vectors, and 3D candidates remain temporary best guesses until HaloFire employees or owning approvers replace them with actual evidence.',
    ]),
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
        required_source_provenance_fields: [...SAM31_REQUIRED_SOURCE_PROVENANCE_FIELDS],
        supported_provenance_artifacts: [...SAM31_SUPPORTED_PROVENANCE_ARTIFACTS],
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
    .map(({ evidence, review }) => {
      const replacementValues = review.replacement_values && typeof review.replacement_values === 'object' && !Array.isArray(review.replacement_values)
        ? jsonClone(review.replacement_values)
        : {};
      return {
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
        replacement_values: replacementValues,
        replaced_fields: Array.isArray(review.replaced_fields) ? [...review.replaced_fields] : [],
        replacement_summary: {
          semantic_label_count: Array.isArray(replacementValues.semantic_labels) ? replacementValues.semantic_labels.length : 0,
          object_hypothesis_count: Array.isArray(replacementValues.object_hypotheses) ? replacementValues.object_hypotheses.length : 0,
          vector_overlay_count: Array.isArray(replacementValues.vector_overlays) ? replacementValues.vector_overlays.length : 0,
          model_3d_candidate_count: Array.isArray(replacementValues.model_3d_candidates) ? replacementValues.model_3d_candidates.length : 0,
        },
        use_for_claims: review.use_for_claims === true,
        no_claim_gates_cleared: review.no_claim_gates_cleared !== false,
        claim_gate_effect: review.claim_gate_effect || 'no_claims_cleared',
      };
    });
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

function latestHalofireSam31SmokeSprinklerReviewDecisionEvidence(projectName, smokeEvidenceId = null, followupReviewEvidenceId = null) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'halofire_sam31_sprinkler_review_decision'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  const latestByQueueKey = new Map();
  for (const row of rows) {
    const review = halofireSam31SprinklerReviewDecisionFromEvidence(row);
    if (!review) continue;
    if (smokeEvidenceId && Number(review.source_section_to_artifacts_consumer_intake_smoke_evidence_id) !== Number(smokeEvidenceId)) {
      continue;
    }
    if (followupReviewEvidenceId && Number(review.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id) !== Number(followupReviewEvidenceId)) {
      continue;
    }
    const key = `${review.issue_type || ''}::${review.supported_sprinkler_review_lane || ''}`;
    if (!latestByQueueKey.has(key)) {
      latestByQueueKey.set(key, { evidence: row, review });
    }
  }
  return [...latestByQueueKey.values()];
}

function halofireSam31SprinklerReviewDecisionSummary(decisionEvidence) {
  if (!decisionEvidence?.evidence || !decisionEvidence?.review) return null;
  const { evidence, review } = decisionEvidence;
  const smokeEvidenceId = review.source_section_to_artifacts_consumer_intake_smoke_evidence_id;
  const projectName = review.project_name || evidence.project_name || '';
  const preliminaryReplayInputsAction = smokeEvidenceId ? {
    method: 'GET',
    href: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/${encodeURIComponent(smokeEvidenceId)}/sprinkler-review-packet/decision/${encodeURIComponent(evidence.id)}/preliminary-replay-inputs`,
    consumes: HALOFIRE_SAM31_SPRINKLER_REVIEW_DECISION_TYPE,
    produces: HALOFIRE_SAM31_SPRINKLER_REVIEW_PRELIMINARY_REPLAY_INPUTS_TYPE,
    target_application: 'halo_fire',
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
  } : null;
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
    preliminary_replay_inputs_action: preliminaryReplayInputsAction,
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
    const sourceBoundaryEvidenceId = Number(followup.source_pdf_boundary_evidence_id || 0);
    const sourceSmokeEvidenceId = Number(followup.source_section_to_artifacts_consumer_intake_smoke_evidence_id || 0);
    if (
      sourceEvidenceId
      && sourceBoundaryEvidenceId
      && sourceBoundaryEvidenceId !== Number(sourceEvidenceId)
      && sourceSmokeEvidenceId !== Number(sourceEvidenceId)
    ) {
      continue;
    }
    const key = String(followup.source_halofire_sam31_sprinkler_review_decision_evidence_id || '');
    if (key && !latestBySprinklerReviewEvidenceId.has(key)) {
      latestBySprinklerReviewEvidenceId.set(key, { evidence: row, followup });
    }
  }
  return [...latestBySprinklerReviewEvidenceId.values()];
}

function halofireSam31SprinklerFollowupPacketReviewDecisionFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'halofire_sam31_sprinkler_followup_packet_review_decision' && parsed.review
      ? parsed.review
      : null;
  } catch {
    return null;
  }
}

function latestHalofireSam31SprinklerFollowupPacketReviewDecisionEvidence(projectName, sourceEvidenceId = null) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'halofire_sam31_sprinkler_followup_packet_review_decision'
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  const latestByFollowupAndPacketIndex = new Map();
  for (const row of rows) {
    const review = halofireSam31SprinklerFollowupPacketReviewDecisionFromEvidence(row);
    if (!review) continue;
    const sourceBoundaryEvidenceId = Number(review.source_pdf_boundary_evidence_id || 0);
    const sourceSmokeEvidenceId = Number(review.source_section_to_artifacts_consumer_intake_smoke_evidence_id || 0);
    if (
      sourceEvidenceId
      && sourceBoundaryEvidenceId
      && sourceBoundaryEvidenceId !== Number(sourceEvidenceId)
      && sourceSmokeEvidenceId !== Number(sourceEvidenceId)
    ) {
      continue;
    }
    const key = `${review.source_followup_decision_evidence_id || ''}:${Number(review.packet_index) || 0}`;
    if (key !== ':' && !latestByFollowupAndPacketIndex.has(key)) {
      latestByFollowupAndPacketIndex.set(key, { evidence: row, review });
    }
  }
  return [...latestByFollowupAndPacketIndex.values()];
}

function halofireSam31SprinklerFollowupPacketReviewSummary(packetReviewEvidence) {
  if (!packetReviewEvidence?.evidence || !packetReviewEvidence?.review) return null;
  const { evidence, review } = packetReviewEvidence;
  return {
    evidence_id: evidence.id,
    evidence_status: evidence.status,
    source_ref: evidence.source_ref,
    artifact_type: review.artifact_type || HALOFIRE_SAM31_SPRINKLER_FOLLOWUP_PACKET_REVIEW_DECISION_TYPE,
    source_packet_artifact_type: review.source_packet_artifact_type,
    source_followup_decision_evidence_id: review.source_followup_decision_evidence_id,
    source_pdf_boundary_evidence_id: review.source_pdf_boundary_evidence_id || null,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: review.source_section_to_artifacts_consumer_intake_smoke_evidence_id || null,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: review.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id || null,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: review.source_halofire_sam31_sprinkler_review_decision_evidence_id || null,
    packet_index: review.packet_index,
    review_decision: review.review_decision,
    reviewer_name: review.reviewer_name,
    reviewed_at: review.reviewed_at,
    review_ref: review.review_ref,
    signed_packet_ref: review.signed_packet_ref,
    marked_up_screenshot_ref: review.marked_up_screenshot_ref,
    claim_gate_effect: review.claim_gate_effect || 'no_claims_cleared',
  };
}

function halofireSam31ApprovalUploadRule(code) {
  return HALOFIRE_SAM31_APPROVAL_UPLOAD_RULES[String(code || '').trim()] || null;
}

function halofireSam31ApprovalUploadGateCode(targetApprovalLane) {
  switch (String(targetApprovalLane || '').trim()) {
    case 'professional_approval':
      return 'PROFESSIONAL_REVIEW_MISSING';
    case 'AHJ_approval':
      return 'AHJ_APPROVAL_MISSING';
    case 'manufacturer_exact':
      return 'MANUFACTURER_MODEL_APPROVAL_MISSING';
    default:
      return null;
  }
}

function ensureHalofireSam31ApprovalUploadGate(projectName, gateCode, rule) {
  if (!gateCode || !rule) return null;
  const existing = db
    .prepare('SELECT * FROM claim_gates WHERE project_name = ? AND code = ?')
    .get(projectName, gateCode);
  if (existing) return existing;
  const laneLabel = rule.target_approval_lane === 'professional_approval'
    ? 'Licensed professional review/signoff'
    : rule.target_approval_lane === 'AHJ_approval'
      ? 'AHJ approval record'
      : 'Manufacturer model/source approval evidence';
  const blockedClaims = rule.target_approval_lane === 'professional_approval'
    ? ['professionally reviewed', 'engineering-grade', 'PE-approved', 'permit-ready', 'fabrication-ready']
    : rule.target_approval_lane === 'AHJ_approval'
      ? ['AHJ-approved', 'permit-ready', 'approved for submission']
      : ['manufacturer-approved model', 'manufacturer-approved materials', 'fabrication-ready selections'];
  const nextAction = rule.target_approval_lane === 'professional_approval'
    ? 'Validate the uploaded signed professional review through the claim gate resolver before claiming professional, permit-ready, or fabrication-ready status.'
    : rule.target_approval_lane === 'AHJ_approval'
      ? 'Validate the uploaded AHJ approval or plan-check record through the claim gate resolver before claiming AHJ approval or permit readiness.'
      : 'Validate the uploaded manufacturer catalog/model proof through the claim gate resolver before claiming manufacturer-exact or fabrication-ready output.';
  db.prepare(`INSERT INTO claim_gates (project_name, code, severity, missing_artifact, acceptable_evidence, blocked_claims, next_action, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      projectName,
      gateCode,
      'blocking',
      laneLabel,
      rule.required_evidence_type,
      JSON.stringify(blockedClaims),
      nextAction,
      'blocked',
    );
  return db
    .prepare('SELECT * FROM claim_gates WHERE project_name = ? AND code = ?')
    .get(projectName, gateCode);
}

function halofireSam31ApprovalUploadIntakeFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'halofire_sam31_approval_upload_intake' && parsed.intake
      ? parsed.intake
      : null;
  } catch {
    return null;
  }
}

function halofireSam31ApprovalUploadValidationDecisionFromEvidence(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.notes || '{}');
    return parsed && parsed.kind === 'halofire_sam31_approval_upload_validation_decision' && parsed.validation_decision
      ? parsed.validation_decision
      : null;
  } catch {
    return null;
  }
}

function latestHalofireSam31ApprovalUploadValidationDecisionEvidence(projectName, approvalUploadEvidenceId) {
  const targetId = Number(approvalUploadEvidenceId);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return null;
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ?
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  for (const row of rows) {
    const validationDecision = halofireSam31ApprovalUploadValidationDecisionFromEvidence(row);
    if (validationDecision && Number(validationDecision.source_halofire_sam31_approval_upload_evidence_id) === targetId) {
      return { evidence: row, validation_decision: validationDecision };
    }
  }
  return null;
}

function isHalofireSam31ApprovalUploadPlaceholderIntake(intake, evidence) {
  const signoff = intake?.signoff || {};
  const haystack = [
    evidence?.source_ref,
    evidence?.source_file,
    intake?.source_ref,
    intake?.source_file,
    intake?.notes,
    signoff.reviewer_name,
    signoff.reviewer_title,
    signoff.organization,
    signoff.license_id,
  ].map((item) => String(item || '').toLowerCase()).join(' ');
  return haystack.includes('default-professional-upload')
    || haystack.includes('internal alpha placeholder')
    || haystack.includes('internal-alpha placeholder')
    || haystack.includes('pending_real_professional_license')
    || haystack.includes('replace with licensed professional');
}

function buildHalofireSam31ApprovalUploadValidationDecision(projectName, uploadEvidenceId, body = {}, user = {}) {
  const sourceUploadEvidenceId = Number(uploadEvidenceId);
  if (!Number.isSafeInteger(sourceUploadEvidenceId) || sourceUploadEvidenceId <= 0) {
    const e = new Error('A positive SAM31 approval upload evidence id is required');
    e.httpStatus = 400;
    throw e;
  }
  const evidence = db
    .prepare('SELECT * FROM project_evidence WHERE id = ? AND project_name = ?')
    .get(sourceUploadEvidenceId, projectName);
  const intake = halofireSam31ApprovalUploadIntakeFromEvidence(evidence);
  if (!evidence || !intake) {
    const e = new Error('SAM31 approval upload intake evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  const validationDecision = String(body.validation_decision || body.review_decision || '').trim();
  if (!HALOFIRE_SAM31_APPROVAL_UPLOAD_VALIDATION_DECISIONS.includes(validationDecision)) {
    const e = new Error(`validation_decision must be one of: ${HALOFIRE_SAM31_APPROVAL_UPLOAD_VALIDATION_DECISIONS.join(', ')}`);
    e.httpStatus = 400;
    throw e;
  }
  const isRealValidation = validationDecision === HALOFIRE_SAM31_APPROVAL_UPLOAD_REAL_VALIDATION_DECISION;
  const isPlaceholder = isHalofireSam31ApprovalUploadPlaceholderIntake(intake, evidence);
  if (isRealValidation && isPlaceholder) {
    const e = new Error('default/internal-alpha SAM31 approval upload placeholders cannot be validated as real signed evidence');
    e.httpStatus = 400;
    throw e;
  }
  const rule = halofireSam31ApprovalUploadRule(intake.code);
  const evidenceType = intake.evidence_type || rule?.evidence_type;
  const gateCode = intake.gate_code || halofireSam31ApprovalUploadGateCode(intake.target_approval_lane);
  const validationRef = String(body.validation_ref || body.review_ref || '').trim();
  if (!validationRef) {
    const e = new Error('validation_ref is required for SAM31 approval upload validation decisions');
    e.httpStatus = 400;
    throw e;
  }
  const signoff = normalizeSignedReviewerSignoff(evidenceType, {
    reviewer_name: body.reviewer_name || body.reviewerName || intake.signoff?.reviewer_name,
    reviewer_title: body.reviewer_title || body.reviewerTitle || intake.signoff?.reviewer_title,
    signed_at: body.signed_at || body.signedAt || intake.signoff?.signed_at,
    organization: body.organization || intake.signoff?.organization,
    license_id: body.license_id || body.licenseId || intake.signoff?.license_id,
  });
  const gateValidationPacketAction = halofireSam31ApprovalUploadGateValidationPacketAction(projectName, evidence.id);
  const resolveRoute = isRealValidation && gateCode
    ? `/api/projects/${encodeURIComponent(projectName)}/claim-gates/${encodeURIComponent(gateCode)}/resolve`
    : null;
  return {
    artifact_type: HALOFIRE_SAM31_APPROVAL_UPLOAD_VALIDATION_DECISION_TYPE,
    status: isRealValidation ? 'present' : 'blocked_pending_real_signed_evidence',
    validation_decision: validationDecision,
    project_name: projectName,
    reviewed_by: user.username || user.name || 'unknown',
    reviewed_at: new Date().toISOString(),
    source_halofire_sam31_approval_upload_evidence_id: evidence.id,
    source_halofire_sam31_approval_upload_artifact_type: intake.artifact_type || HALOFIRE_SAM31_APPROVAL_UPLOAD_INTAKE_TYPE,
    source_halofire_sam31_approval_upload_source_ref: evidence.source_ref,
    evidence_type: evidenceType,
    target_gate_code: gateCode,
    code: intake.code,
    target_approval_lane: intake.target_approval_lane,
    required_evidence_type: intake.required_evidence_type,
    source_packet_review_decision_evidence_id: intake.source_packet_review_decision_evidence_id,
    source_followup_decision_evidence_id: intake.source_followup_decision_evidence_id,
    source_pdf_boundary_evidence_id: intake.source_pdf_boundary_evidence_id || null,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: intake.source_section_to_artifacts_consumer_intake_smoke_evidence_id || null,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: intake.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id || null,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: intake.source_halofire_sam31_sprinkler_review_decision_evidence_id || null,
    validation_ref: validationRef,
    source_file: String(body.source_file || body.sourceFile || evidence.source_file || '').trim() || null,
    signoff,
    gate_validation_packet_action: gateValidationPacketAction,
    resolve_action: resolveRoute ? {
      method: 'POST',
      href: resolveRoute,
      request_body: { evidence_id: null },
    } : null,
    source_refs: uniqueByJson([
      ...(Array.isArray(intake.source_refs) ? intake.source_refs : []),
      {
        evidence_type: evidence.evidence_type,
        evidence_id: evidence.id,
        source_ref: evidence.source_ref,
        source_file: evidence.source_file,
        status: evidence.status,
        claim_gate_effect: 'no_claims_cleared',
      },
      {
        evidence_type: `${evidenceType}_validation_decision`,
        source_ref: validationRef,
        source_file: String(body.source_file || body.sourceFile || evidence.source_file || '').trim() || null,
        status: isRealValidation ? 'present' : 'blocked_pending_real_signed_evidence',
        claim_gate_effect: isRealValidation ? 'ready_for_explicit_gate_resolve' : 'no_claims_cleared',
      },
    ]),
    blocked_claims: uniqueStrings([
      ...(Array.isArray(intake.blocked_claims) ? intake.blocked_claims : []),
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'manufacturer_exact',
      'AutoSprink_parity',
      'engineering_grade',
    ]),
    limitations: uniqueStrings([
      ...(Array.isArray(intake.limitations) ? intake.limitations : []),
      'This validation decision records employee/professional review of uploaded approval evidence.',
      'It does not clear any claim gate until the explicit claim-gate resolve action is run with this validation decision evidence row.',
      ...(isPlaceholder ? ['Default/internal-alpha placeholder approval uploads cannot validate or clear regulated claims.'] : []),
    ]),
    use_for_claims: isRealValidation,
    claim_gate_effect: isRealValidation ? 'ready_for_explicit_gate_resolve' : 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function latestHalofireSam31ApprovalUploadIntakeEvidence(projectName, sourceEvidenceId = null) {
  const rows = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ?
              ORDER BY created_at DESC, id DESC`)
    .all(projectName);
  const latestByPacketReviewAndCode = new Map();
  for (const row of rows) {
    const intake = halofireSam31ApprovalUploadIntakeFromEvidence(row);
    if (!intake) continue;
    const sourceBoundaryEvidenceId = Number(intake.source_pdf_boundary_evidence_id || 0);
    const sourceSmokeEvidenceId = Number(intake.source_section_to_artifacts_consumer_intake_smoke_evidence_id || 0);
    if (
      sourceEvidenceId
      && sourceBoundaryEvidenceId
      && sourceBoundaryEvidenceId !== Number(sourceEvidenceId)
      && sourceSmokeEvidenceId !== Number(sourceEvidenceId)
    ) {
      continue;
    }
    const key = `${intake.source_packet_review_decision_evidence_id || ''}:${intake.code || ''}`;
    if (key !== ':' && !latestByPacketReviewAndCode.has(key)) {
      latestByPacketReviewAndCode.set(key, { evidence: row, intake });
    }
  }
  return [...latestByPacketReviewAndCode.values()];
}

function halofireSam31ApprovalUploadGateValidationPacketAction(projectName, evidenceId) {
  if (!Number.isFinite(Number(evidenceId)) || Number(evidenceId) <= 0) return null;
  return {
    method: 'GET',
    href: `/api/projects/${encodeURIComponent(projectName)}/evidence/${encodeURIComponent(evidenceId)}/openclaw/sam31/approval-upload/gate-validation-packet`,
    artifact_type: HALOFIRE_SAM31_APPROVAL_UPLOAD_GATE_VALIDATION_PACKET_TYPE,
    claim_gate_effect: 'no_claims_cleared',
  };
}

function halofireSam31ApprovalUploadValidationDecisionSummary(validationEvidence) {
  if (!validationEvidence?.evidence || !validationEvidence?.validation_decision) return null;
  const { evidence, validation_decision: decision } = validationEvidence;
  const resolveAction = decision.resolve_action
    ? {
        ...decision.resolve_action,
        request_body: { evidence_id: evidence.id },
      }
    : null;
  return {
    evidence_id: evidence.id,
    evidence_status: evidence.status,
    evidence_type: evidence.evidence_type,
    source_ref: evidence.source_ref,
    source_file: evidence.source_file,
    artifact_type: decision.artifact_type || HALOFIRE_SAM31_APPROVAL_UPLOAD_VALIDATION_DECISION_TYPE,
    status: decision.status || evidence.status,
    validation_decision: decision.validation_decision,
    target_gate_code: decision.target_gate_code,
    code: decision.code,
    target_approval_lane: decision.target_approval_lane,
    evidence_type_required: decision.evidence_type,
    required_evidence_type: decision.required_evidence_type,
    source_halofire_sam31_approval_upload_evidence_id: decision.source_halofire_sam31_approval_upload_evidence_id,
    validation_ref: decision.validation_ref,
    reviewed_by: decision.reviewed_by,
    reviewed_at: decision.reviewed_at,
    signoff: decision.signoff || null,
    gate_validation_packet_action: decision.gate_validation_packet_action || null,
    resolve_action: resolveAction,
    use_for_claims: Boolean(decision.use_for_claims),
    claim_gate_effect: decision.claim_gate_effect || 'no_claims_cleared',
    no_claim_gates_cleared: decision.no_claim_gates_cleared !== false,
    blocked_claims: Array.isArray(decision.blocked_claims) ? decision.blocked_claims : [],
    limitations: Array.isArray(decision.limitations) ? decision.limitations : [],
  };
}

function halofireSam31ApprovalUploadIntakeSummary(uploadEvidence) {
  if (!uploadEvidence?.evidence || !uploadEvidence?.intake) return null;
  const { evidence, intake } = uploadEvidence;
  const latestValidationDecision = halofireSam31ApprovalUploadValidationDecisionSummary(
    latestHalofireSam31ApprovalUploadValidationDecisionEvidence(evidence.project_name, evidence.id),
  );
  return {
    evidence_id: evidence.id,
    evidence_status: evidence.status,
    evidence_type: evidence.evidence_type,
    source_ref: evidence.source_ref,
    source_file: evidence.source_file,
    artifact_type: intake.artifact_type || HALOFIRE_SAM31_APPROVAL_UPLOAD_INTAKE_TYPE,
    status: intake.status || 'uploaded_pending_gate_validation',
    code: intake.code,
    target_approval_lane: intake.target_approval_lane,
    required_evidence_type: intake.required_evidence_type,
    gate_code: intake.gate_code || halofireSam31ApprovalUploadGateCode(intake.target_approval_lane),
    source_packet_review_decision_evidence_id: intake.source_packet_review_decision_evidence_id,
    source_followup_decision_evidence_id: intake.source_followup_decision_evidence_id,
    source_pdf_boundary_evidence_id: intake.source_pdf_boundary_evidence_id || null,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: intake.source_section_to_artifacts_consumer_intake_smoke_evidence_id || null,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: intake.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id || null,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: intake.source_halofire_sam31_sprinkler_review_decision_evidence_id || null,
    packet_index: intake.packet_index,
    uploaded_by: intake.uploaded_by,
    uploaded_at: intake.uploaded_at,
    signoff: intake.signoff || null,
    gate_validation_action: intake.gate_validation_action || null,
    gate_validation_packet_action: halofireSam31ApprovalUploadGateValidationPacketAction(evidence.project_name, evidence.id),
    latest_approval_upload_validation_decision: latestValidationDecision,
    use_for_claims: false,
    claim_gate_effect: intake.claim_gate_effect || 'no_claims_cleared',
    blocked_claims: Array.isArray(intake.blocked_claims) ? intake.blocked_claims : [],
  };
}

function buildHalofireSam31ApprovalUploadGateValidationPacket(projectName, evidenceId) {
  const uploadEvidenceId = Number(evidenceId);
  if (!Number.isSafeInteger(uploadEvidenceId) || uploadEvidenceId <= 0) {
    const e = new Error('A positive SAM31 approval upload evidence id is required');
    e.httpStatus = 400;
    throw e;
  }
  const evidence = db
    .prepare('SELECT * FROM project_evidence WHERE id = ? AND project_name = ?')
    .get(uploadEvidenceId, projectName);
  const intake = halofireSam31ApprovalUploadIntakeFromEvidence(evidence);
  if (!evidence || !intake) {
    const e = new Error('SAM31 approval upload intake evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  const gateCode = intake.gate_code || halofireSam31ApprovalUploadGateCode(intake.target_approval_lane);
  const gate = gateCode
    ? db.prepare('SELECT * FROM claim_gates WHERE project_name = ? AND code = ?').get(projectName, gateCode)
    : null;
  const resolveRoute = gateCode
    ? `/api/projects/${encodeURIComponent(projectName)}/claim-gates/${encodeURIComponent(gateCode)}/resolve`
    : null;
  const signoff = intake.signoff || {};
  const hasStructuredSignoff = Boolean(signoff.reviewer_name && signoff.reviewer_title && signoff.signed_at);
  const sourceRefs = uniqueByJson([
    ...(Array.isArray(intake.source_refs) ? intake.source_refs : []),
    {
      evidence_type: evidence.evidence_type,
      evidence_id: evidence.id,
      source_ref: evidence.source_ref,
      source_file: evidence.source_file,
      status: evidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
    intake.source_section_to_artifacts_consumer_intake_smoke_evidence_id ? {
      evidence_type: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
      evidence_id: intake.source_section_to_artifacts_consumer_intake_smoke_evidence_id,
    } : null,
    intake.source_packet_review_decision_evidence_id ? {
      evidence_type: 'halofire_sam31_sprinkler_followup_packet_review_decision',
      evidence_id: intake.source_packet_review_decision_evidence_id,
    } : null,
  ].filter(Boolean));
  return {
    artifact_type: HALOFIRE_SAM31_APPROVAL_UPLOAD_GATE_VALIDATION_PACKET_TYPE,
    status: intake.status || 'uploaded_pending_gate_validation',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    download_name: `${slugForDownloadName(projectName)}-sam31-approval-upload-${uploadEvidenceId}-gate-validation-packet.json`,
    approval_upload_evidence_id: evidence.id,
    approval_upload_artifact_type: intake.artifact_type || HALOFIRE_SAM31_APPROVAL_UPLOAD_INTAKE_TYPE,
    evidence_type: evidence.evidence_type,
    evidence_status: evidence.status,
    source_ref: evidence.source_ref,
    source_file: evidence.source_file,
    code: intake.code,
    target_approval_lane: intake.target_approval_lane,
    required_evidence_type: intake.required_evidence_type,
    gate_code: gateCode,
    gate_status: gate?.status || 'blocked',
    resolve_route: resolveRoute,
    resolve_action: resolveRoute ? {
      method: 'POST',
      href: resolveRoute,
      request_body: { evidence_id: evidence.id },
    } : null,
    source_packet_review_decision_evidence_id: intake.source_packet_review_decision_evidence_id,
    source_followup_decision_evidence_id: intake.source_followup_decision_evidence_id,
    source_pdf_boundary_evidence_id: intake.source_pdf_boundary_evidence_id || null,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: intake.source_section_to_artifacts_consumer_intake_smoke_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: intake.source_openclaw_sam31_consumer_review_evidence_id || null,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: intake.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id || null,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: intake.source_halofire_sam31_sprinkler_review_decision_evidence_id || null,
    packet_index: intake.packet_index,
    target_packet_lane: intake.target_packet_lane || null,
    source_refs: sourceRefs,
    signoff: intake.signoff || null,
    validation_steps: [
      {
        code: 'approval_upload_evidence_present',
        status: evidence.status === 'present' ? 'satisfied' : 'blocked',
        evidence_id: evidence.id,
      },
      {
        code: 'signed_reviewer_metadata_present',
        status: hasStructuredSignoff ? 'satisfied' : 'blocked',
        required_fields: ['reviewer_name', 'reviewer_title', 'signed_at'],
      },
      {
        code: 'explicit_claim_gate_resolve_required',
        status: gate?.status === 'cleared' ? 'resolved' : 'pending',
        action: resolveRoute,
        request_body: { evidence_id: evidence.id },
      },
    ],
    blocked_claims: uniqueStrings([
      ...(Array.isArray(intake.blocked_claims) ? intake.blocked_claims : []),
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'manufacturer_exact',
      'AutoSprink_parity',
      'engineering_grade',
    ]),
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: uniqueStrings([
      ...(Array.isArray(intake.limitations) ? intake.limitations : []),
      'This packet validates that uploaded evidence is eligible for an explicit claim-gate resolve action.',
      'Reading this packet, or uploading evidence, does not clear any regulated claim by itself.',
    ]),
  };
}

function halofireSam31ApprovalUploadResolverRows(packet, latestReview, approvalUploadEvidences = []) {
  if (!packet || !latestReview) return [];
  const latestUploadsByCode = new Map(
    (Array.isArray(approvalUploadEvidences) ? approvalUploadEvidences : [])
      .filter((item) => item?.evidence && item?.intake && Number(item.intake.source_packet_review_decision_evidence_id) === Number(latestReview.evidence_id))
      .map((item) => [String(item.intake.code || ''), item]),
  );
  const latestUploadsByFollowupPacketAndCode = new Map(
    (Array.isArray(approvalUploadEvidences) ? approvalUploadEvidences : [])
      .filter((item) => item?.evidence && item?.intake)
      .map((item) => [
        `${item.intake.source_followup_decision_evidence_id || ''}:${Number(item.intake.packet_index) || 0}:${String(item.intake.code || '')}`,
        item,
      ]),
  );
  const commonBlockedClaims = uniqueStrings([
    ...(Array.isArray(packet.blocked_claims) ? packet.blocked_claims : []),
    'permit_ready',
    'AHJ_approval',
    'AutoSprink_parity',
    'fabrication_ready',
    'professional_approval',
    'manufacturer_exact',
  ]);
  const sourceRefs = uniqueByJson([
    {
      evidence_type: 'halofire_sam31_sprinkler_followup_packet_review_decision',
      evidence_id: latestReview.evidence_id,
      source_ref: latestReview.source_ref || latestReview.review_ref || null,
      artifact_type: latestReview.artifact_type || HALOFIRE_SAM31_SPRINKLER_FOLLOWUP_PACKET_REVIEW_DECISION_TYPE,
    },
    {
      evidence_type: 'halofire_sam31_sprinkler_preliminary_replay_followup_decision',
      evidence_id: packet.source_followup_decision_evidence_id || latestReview.source_followup_decision_evidence_id || null,
      artifact_type: packet.source_followup_decision_artifact_type || HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_FOLLOWUP_DECISION_TYPE,
    },
    {
      evidence_type: 'pdf_boundary_decision',
      evidence_id: packet.source_pdf_boundary_evidence_id || null,
    },
    {
      evidence_type: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
      evidence_id: packet.source_section_to_artifacts_consumer_intake_smoke_evidence_id || latestReview.source_section_to_artifacts_consumer_intake_smoke_evidence_id || null,
    },
  ]);
  const base = {
    artifact_type: HALOFIRE_SAM31_APPROVAL_UPLOAD_RESOLVER_ROW_TYPE,
    status: 'missing_required_approval_upload',
    source_runtime: 'sam-3.1+llm',
    source_packet_queue_item_artifact_type: packet.artifact_type,
    source_packet_review_decision_artifact_type: latestReview.artifact_type || HALOFIRE_SAM31_SPRINKLER_FOLLOWUP_PACKET_REVIEW_DECISION_TYPE,
    source_packet_review_decision_evidence_id: latestReview.evidence_id,
    source_packet_artifact_type: latestReview.source_packet_artifact_type || null,
    source_followup_decision_evidence_id: packet.source_followup_decision_evidence_id || latestReview.source_followup_decision_evidence_id || null,
    source_pdf_boundary_evidence_id: packet.source_pdf_boundary_evidence_id || null,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: packet.source_section_to_artifacts_consumer_intake_smoke_evidence_id || latestReview.source_section_to_artifacts_consumer_intake_smoke_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: packet.source_openclaw_sam31_consumer_review_evidence_id || null,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: packet.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id || latestReview.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id || null,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: packet.source_halofire_sam31_sprinkler_review_decision_evidence_id || null,
    target_packet_lane: packet.target_packet_lane || null,
    source_field: packet.source_field || null,
    source_index: packet.source_index ?? null,
    packet_index: latestReview.packet_index ?? packet.packet_index ?? 0,
    source_refs: sourceRefs,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: [
      'SAM31+LLM packet review is correction and routing evidence only.',
      'This resolver row describes the exact approval upload still required; it cannot clear the claim by itself.',
    ],
  };
  const rows = [
    {
      ...base,
      id: `${packet.id || 'sam31-packet'}:approval-upload:professional`,
      code: HALOFIRE_SAM31_APPROVAL_UPLOAD_MISSING_CODES.professional,
      target_approval_lane: 'professional_approval',
      required_evidence_type: 'licensed_professional_signed_review',
      next_action: 'Upload a PE or licensed sprinkler professional signed review packet tied to this SAM31 follow-up packet before claiming professional approval, permit readiness, or fabrication readiness.',
      acceptable_evidence: [
        'PE or licensed sprinkler professional signed review packet',
        'signed/sealed plan markup referencing this obstruction/clash or sleeve/firestop packet',
        'professional review letter with scope, date, reviewer identity, and source packet reference',
      ],
      ai_fallback: 'SAM31 may keep producing best-effort issue lists, vector overlays, and 3D candidates for review, but AI output remains temporary until a licensed reviewer uploads signed evidence.',
      blocked_claims: uniqueStrings([...commonBlockedClaims, 'professional_approval', 'permit_ready', 'fabrication_ready']),
    },
    {
      ...base,
      id: `${packet.id || 'sam31-packet'}:approval-upload:ahj`,
      code: HALOFIRE_SAM31_APPROVAL_UPLOAD_MISSING_CODES.ahj,
      target_approval_lane: 'AHJ_approval',
      required_evidence_type: 'AHJ_signed_approval_or_plan_check_record',
      next_action: 'Upload the AHJ signed approval, plan-check response, correction letter, or permit review record tied to this packet before claiming AHJ approval or permit readiness.',
      acceptable_evidence: [
        'AHJ signed approval, plan-check response, or correction letter',
        'permit review record with jurisdiction, date, reviewer, and drawing/packet reference',
        'source-linked AHJ correspondence accepting or requiring corrections for this packet lane',
      ],
      ai_fallback: 'SAM31 may prepare correction packets and response drafts for AHJ review, but it cannot substitute for an AHJ approval record.',
      blocked_claims: uniqueStrings([...commonBlockedClaims, 'AHJ_approval', 'permit_ready']),
    },
    {
      ...base,
      id: `${packet.id || 'sam31-packet'}:approval-upload:manufacturer`,
      code: HALOFIRE_SAM31_APPROVAL_UPLOAD_MISSING_CODES.manufacturer,
      target_approval_lane: 'manufacturer_exact',
      required_evidence_type: 'manufacturer_catalog_or_model_proof',
      next_action: 'Upload manufacturer catalog, cut sheet, licensed BIM/STEP model proof, or approved vendor source tied to the components in this packet before claiming manufacturer-exact or fabrication-ready output.',
      acceptable_evidence: [
        'manufacturer catalog page, cut sheet, BIM/STEP file, or source-linked model proof',
        'license/terms and downloaded artifact hash for any CAD/BIM/STEP model',
        'manufacturer or vendor approval note referencing the exact component family and packet source',
      ],
      ai_fallback: 'SAM31 can generate editable vector/model candidates and rank catalog matches, but HaloFire staff must upload real manufacturer/vendor proof before manufacturer-exact or fabrication claims.',
      blocked_claims: uniqueStrings([...commonBlockedClaims, 'manufacturer_exact', 'fabrication_ready']),
    },
  ];
  return rows.map((row) => {
    const uploadSummary = halofireSam31ApprovalUploadIntakeSummary(
      latestUploadsByCode.get(row.code)
      || latestUploadsByFollowupPacketAndCode.get(`${row.source_followup_decision_evidence_id || ''}:${Number(row.packet_index) || 0}:${row.code}`),
    );
    const rule = halofireSam31ApprovalUploadRule(row.code);
    return {
      ...row,
      gate_evidence_type: rule?.evidence_type || null,
      status: uploadSummary ? 'approval_upload_recorded_pending_gate_validation' : row.status,
      latest_approval_upload_intake: uploadSummary,
    };
  });
}

function halofireSam31SprinklerPreliminaryReplayFollowupSummary(followupEvidence, packetReviewDecisionEvidences = [], approvalUploadEvidences = []) {
  if (!followupEvidence?.evidence || !followupEvidence?.followup) return null;
  const { evidence, followup } = followupEvidence;
  const latestPacketReviewsByIndex = new Map(
    (Array.isArray(packetReviewDecisionEvidences) ? packetReviewDecisionEvidences : [])
      .filter((item) => item?.evidence && item?.review && Number(item.review.source_followup_decision_evidence_id) === Number(evidence.id))
      .map((item) => [Number(item.review.packet_index) || 0, item]),
  );
  const packetQueueItems = halofireSam31SprinklerPreliminaryReplayPacketQueueItems(followup, evidence.id).map((packet, index) => {
    const latestReview = halofireSam31SprinklerFollowupPacketReviewSummary(latestPacketReviewsByIndex.get(index));
    return {
      ...packet,
      status: latestReview ? 'internal_alpha_packet_review_recorded' : packet.status,
      latest_packet_review_decision: latestReview,
      approval_upload_resolver_rows: halofireSam31ApprovalUploadResolverRows(packet, latestReview, approvalUploadEvidences),
    };
  });
  return {
    evidence_id: evidence.id,
    evidence_status: evidence.status,
    source_ref: evidence.source_ref,
    artifact_type: followup.artifact_type || HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_FOLLOWUP_DECISION_TYPE,
    source_preliminary_replay_artifact_type: followup.source_preliminary_replay_artifact_type,
    source_preliminary_replay_output_artifact_type: followup.source_preliminary_replay_output_artifact_type,
    source_pdf_boundary_evidence_id: followup.source_pdf_boundary_evidence_id || null,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: followup.source_section_to_artifacts_consumer_intake_smoke_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: followup.source_openclaw_sam31_consumer_review_evidence_id || null,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: followup.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id || null,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: followup.source_halofire_sam31_sprinkler_review_decision_evidence_id,
    source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id: followup.source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id || null,
    source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: followup.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id || null,
    source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: followup.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || null,
    source_openclaw_sam31_extrapolation_evidence_id: followup.source_openclaw_sam31_extrapolation_evidence_id || null,
    followup_decision: followup.followup_decision,
    reviewer_name: followup.reviewer_name,
    reviewed_at: followup.reviewed_at,
    review_ref: followup.review_ref,
    packet_ref: followup.packet_ref,
    issue_decisions: Array.isArray(followup.issue_decisions) ? followup.issue_decisions : [],
    packet_queue_item_count: packetQueueItems.length,
    packet_queue_items: packetQueueItems,
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

function buildOpenClawSam31ActualValueWorkItemPacket(projectName, evidence, decision, reviewEvidence, review, consumerSmokeEvidence) {
  if (!evidence || !decision) {
    const e = new Error('PDF boundary decision evidence not found');
    e.httpStatus = 404;
    throw e;
  }
  if (!reviewEvidence || !review) {
    const e = new Error('SAM31 consumer review evidence is required before downloading the SAM31 actual-value work item packet');
    e.httpStatus = 409;
    throw e;
  }
  if (Number(review.source_pdf_boundary_evidence_id) !== Number(evidence.id)) {
    const e = new Error('SAM31 consumer review evidence does not belong to the requested PDF boundary evidence');
    e.httpStatus = 409;
    throw e;
  }
  const replacementValues = review.replacement_values && typeof review.replacement_values === 'object' && !Array.isArray(review.replacement_values)
    ? jsonClone(review.replacement_values)
    : {};
  const countArray = (key) => (Array.isArray(replacementValues[key]) ? replacementValues[key].length : 0);
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
  const acceptableActualEvidence = [
    '1881 proposal workbook row or sheet reference',
    'reviewed vector overlay SVG or marked-up plan ref',
    'reviewed 3D model candidate ref or model note',
    'screenshot or console evidence for the reviewed SAM31 section',
  ];
  return {
    artifact_type: 'openclaw.sam31.actual_value_work_item_packet.v1',
    status: 'requires_employee_actual_value_update',
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
    download_name: `${slugForDownloadName(projectName)}-sam31-actual-value-work-item-${slugForDownloadName(review.consumer)}-${reviewEvidence.id}.json`,
    employee_actual_value_next_action: 'Replace SAM31 best guesses with actual HaloFire documentation values before using these observations in bid/export decisions.',
    acceptable_actual_evidence: acceptableActualEvidence,
    update_fields: [
      'semantic_labels',
      'object_hypotheses',
      'vector_overlays',
      'model_3d_candidates',
      'source_ref',
      'confidence',
    ],
    replacement_values: replacementValues,
    replacement_summary: {
      semantic_label_count: countArray('semantic_labels'),
      object_hypothesis_count: countArray('object_hypotheses'),
      vector_overlay_count: countArray('vector_overlays'),
      model_3d_candidate_count: countArray('model_3d_candidates'),
    },
    source_refs: uniqueByJson(sourceRefs),
    use_for_claims: false,
    blocked_claims: uniqueStrings([
      ...(Array.isArray(review.blocked_claims) ? review.blocked_claims : []),
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'manufacturer_exact',
      'AutoSprink_parity',
    ]),
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: uniqueStrings([
      ...(Array.isArray(review.limitations) ? review.limitations : []),
      'SAM31 plus LLM section understanding can identify likely objects, semantic labels, vector overlays, and 3D candidates, but these remain best guesses until replaced by actual HaloFire documentation values.',
      'This actual-value work item packet does not clear permit-ready, fabrication-ready, AHJ-ready, engineering-grade, AutoSprink parity, professional approval, or manufacturer-exact claims.',
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
  const vectorModelContext = openClawSam31VectorModelArtifactReviewContext(projectName, evidence.id);
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
          source_openclaw_sam31_vector_model_artifact_evidence_id: vectorModelContext.source_openclaw_sam31_vector_model_artifact_evidence_id,
          source_linked_vector_overlay_count: vectorModelContext.source_linked_vector_overlays.length,
          source_linked_model_3d_candidate_count: vectorModelContext.source_linked_model_3d_candidates.length,
          openclaw_sam31_vector_model_artifact: vectorModelContext.openclaw_sam31_vector_model_artifact,
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
  const vectorModelContext = openClawSam31VectorModelArtifactReviewContext(projectName, evidence.id);
  const sectioningAdapterContext = halofireSam31SectioningSprinklerReviewAdapterReplayContext(projectName, evidence.id);
  const sourceLinkedVectorOverlays = uniqueByJson([
    ...sectioningAdapterContext.source_linked_vector_overlays,
    ...vectorModelContext.source_linked_vector_overlays,
  ]);
  const sourceLinkedModel3dCandidates = uniqueByJson([
    ...sectioningAdapterContext.source_linked_model_3d_candidates,
    ...vectorModelContext.source_linked_model_3d_candidates,
  ]);
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
    ...sectioningAdapterContext.source_refs,
    ...vectorModelContext.source_refs,
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
    source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id: sectioningAdapterContext.source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id,
    source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: sectioningAdapterContext.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id,
    source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: sectioningAdapterContext.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id,
    source_openclaw_sam31_extrapolation_evidence_id: sectioningAdapterContext.source_openclaw_sam31_extrapolation_evidence_id,
    source_openclaw_sam31_vector_model_artifact_evidence_id: vectorModelContext.source_openclaw_sam31_vector_model_artifact_evidence_id,
    source_queue_item_id: sprinklerReview.source_queue_item_id || null,
    issue_type: sprinklerReview.issue_type || null,
    supported_sprinkler_review_lane: lane,
    evidence_lanes: uniqueStrings([lane]),
    replay_scope: halofireSam31SprinklerReplayScope(lane),
    reviewed_values: reviewedValues,
    halofire_sam31_sectioning_sprinkler_review_adapter: sectioningAdapterContext.halofire_sam31_sectioning_sprinkler_review_adapter,
    openclaw_sam31_vector_model_artifact: vectorModelContext.openclaw_sam31_vector_model_artifact,
    source_linked_vector_overlays: sourceLinkedVectorOverlays,
    source_linked_model_3d_candidates: sourceLinkedModel3dCandidates,
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
    source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id: sectioningAdapterContext.source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id,
    source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: sectioningAdapterContext.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id,
    source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: sectioningAdapterContext.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id,
    source_openclaw_sam31_extrapolation_evidence_id: sectioningAdapterContext.source_openclaw_sam31_extrapolation_evidence_id,
    source_openclaw_sam31_consumer_smoke_evidence_id: sprinklerReview.source_openclaw_sam31_consumer_smoke_evidence_id || review.source_openclaw_sam31_consumer_smoke_evidence_id || null,
    source_openclaw_sam31_vector_model_artifact_evidence_id: vectorModelContext.source_openclaw_sam31_vector_model_artifact_evidence_id,
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
    halofire_sam31_sectioning_sprinkler_review_adapter: sectioningAdapterContext.halofire_sam31_sectioning_sprinkler_review_adapter,
    openclaw_sam31_vector_model_artifact: vectorModelContext.openclaw_sam31_vector_model_artifact,
    source_linked_vector_overlays: sourceLinkedVectorOverlays,
    source_linked_model_3d_candidates: sourceLinkedModel3dCandidates,
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
  const vectorOverlays = Array.isArray(followup.source_linked_vector_overlays) ? followup.source_linked_vector_overlays : [];
  const model3dCandidates = Array.isArray(followup.source_linked_model_3d_candidates) ? followup.source_linked_model_3d_candidates : [];
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
      source_section_to_artifacts_consumer_intake_smoke_evidence_id: followup.source_section_to_artifacts_consumer_intake_smoke_evidence_id || null,
      source_openclaw_sam31_consumer_review_evidence_id: followup.source_openclaw_sam31_consumer_review_evidence_id,
      source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: followup.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id || null,
      source_halofire_sam31_sprinkler_review_decision_evidence_id: followup.source_halofire_sam31_sprinkler_review_decision_evidence_id,
      source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id: followup.source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id || null,
      source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: followup.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id || null,
      source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: followup.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || null,
      source_openclaw_sam31_extrapolation_evidence_id: followup.source_openclaw_sam31_extrapolation_evidence_id || null,
      source_openclaw_sam31_vector_model_artifact_evidence_id: followup.source_openclaw_sam31_vector_model_artifact_evidence_id || followup.openclaw_sam31_vector_model_artifact?.evidence_id || null,
      source_linked_vector_overlay_count: vectorOverlays.length,
      source_linked_model_3d_candidate_count: model3dCandidates.length,
      openclaw_sam31_vector_model_artifact: followup.openclaw_sam31_vector_model_artifact || null,
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

function halofireSam31SprinklerReplayFollowupPacketArtifactType(packetQueueItem) {
  return packetQueueItem?.artifact_type === HALOFIRE_SAM31_SLEEVE_FIRESTOP_PACKET_QUEUE_ITEM_TYPE
    ? HALOFIRE_SAM31_SLEEVE_FIRESTOP_PACKET_TYPE
    : HALOFIRE_SAM31_OBSTRUCTION_CLASH_PACKET_TYPE;
}

function halofireSam31SprinklerReplayFollowupPacketDownloadSlug(packetQueueItem) {
  return packetQueueItem?.artifact_type === HALOFIRE_SAM31_SLEEVE_FIRESTOP_PACKET_QUEUE_ITEM_TYPE
    ? 'sam31-sleeve-firestop-packet'
    : 'sam31-obstruction-clash-packet';
}

function emptyOpenClawSam31VectorModelArtifactReviewContext() {
  return {
    source_openclaw_sam31_vector_model_artifact_evidence_id: null,
    openclaw_sam31_vector_model_artifact: null,
    source_linked_vector_overlays: [],
    source_linked_model_3d_candidates: [],
    source_refs: [],
  };
}

function buildHalofireSam31SprinklerReplayFollowupPacket(projectName, evidence, reviewEvidence, sprinklerReviewEvidence, followupEvidence, followup, packetIndex = 0, options = {}) {
  const smokeEvidence = options.smokeEvidence || null;
  const followupReviewEvidence = options.followupReviewEvidence || null;
  const sourceBoundaryEvidenceId = evidence?.id || followup.source_pdf_boundary_evidence_id || null;
  const vectorModelContext = sourceBoundaryEvidenceId
    ? openClawSam31VectorModelArtifactReviewContext(projectName, sourceBoundaryEvidenceId)
    : emptyOpenClawSam31VectorModelArtifactReviewContext();
  const packetQueueItems = halofireSam31SprinklerPreliminaryReplayPacketQueueItems(followup, followupEvidence.id);
  const queueItem = packetQueueItems[packetIndex];
  const issueDecision = Array.isArray(followup.issue_decisions) ? followup.issue_decisions[packetIndex] : null;
  if (!queueItem || !issueDecision) {
    const e = new Error('SAM31 sprinkler preliminary replay follow-up packet index not found');
    e.httpStatus = 404;
    throw e;
  }
  const artifactType = halofireSam31SprinklerReplayFollowupPacketArtifactType(queueItem);
  const downloadSlug = halofireSam31SprinklerReplayFollowupPacketDownloadSlug(queueItem);
  const acceptableEvidence = uniqueStrings([
    ...(Array.isArray(queueItem.acceptable_evidence) ? queueItem.acceptable_evidence : []),
    'source-linked packet JSON',
    'professional/AHJ/manufacturer evidence for any regulated claim',
  ]);
  return {
    artifact_type: artifactType,
    id: `sam31-sprinkler-followup-packet:${followupEvidence.id}:${packetIndex}`,
    project_name: projectName,
    status: 'ready_for_internal_alpha_review',
    download_name: `${slugForDownloadName(projectName)}-${downloadSlug}-${followupEvidence.id}-${packetIndex}.json`,
    packet_index: packetIndex,
    source_packet_queue_item_artifact_type: queueItem.artifact_type,
    source_followup_decision_artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_FOLLOWUP_DECISION_TYPE,
    source_followup_decision_evidence_id: followupEvidence.id,
    source_preliminary_replay_artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_ARTIFACT_TYPE,
    source_preliminary_replay_output_artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_OUTPUT_TYPE,
    source_pdf_boundary_evidence_id: sourceBoundaryEvidenceId,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: queueItem.source_section_to_artifacts_consumer_intake_smoke_evidence_id || followup.source_section_to_artifacts_consumer_intake_smoke_evidence_id || smokeEvidence?.evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: reviewEvidence?.id || followup.source_openclaw_sam31_consumer_review_evidence_id || null,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: queueItem.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id || followup.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id || followupReviewEvidence?.evidence?.id || null,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: sprinklerReviewEvidence.id,
    source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id: queueItem.source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id || followup.source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id || null,
    source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: queueItem.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id || followup.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id || null,
    source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: queueItem.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || followup.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || null,
    source_openclaw_sam31_extrapolation_evidence_id: queueItem.source_openclaw_sam31_extrapolation_evidence_id || followup.source_openclaw_sam31_extrapolation_evidence_id || null,
    source_openclaw_sam31_vector_model_artifact_evidence_id: vectorModelContext.source_openclaw_sam31_vector_model_artifact_evidence_id,
    source_application: followup.source_application || null,
    consumer: followup.consumer || null,
    accepted_queue_id: followup.accepted_queue_id || null,
    persisted_review_packet_ref: followup.persisted_review_packet_ref || null,
    target_packet_lane: queueItem.target_packet_lane,
    supported_sprinkler_review_lane: followup.supported_sprinkler_review_lane,
    replay_scope: followup.replay_scope,
    issue_type: followup.issue_type,
    source_field: queueItem.source_field,
    source_index: queueItem.source_index,
    decision: queueItem.decision,
    issue_decision: {
      ...jsonClone(issueDecision),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    packet_queue_item: queueItem,
    replay_output: followup.replay_output || null,
    halofire_sam31_sectioning_sprinkler_review_adapter: followup.halofire_sam31_sectioning_sprinkler_review_adapter || null,
    openclaw_sam31_vector_model_artifact: vectorModelContext.openclaw_sam31_vector_model_artifact,
    source_linked_vector_overlays: Array.isArray(followup.source_linked_vector_overlays) ? jsonClone(followup.source_linked_vector_overlays) : vectorModelContext.source_linked_vector_overlays,
    source_linked_model_3d_candidates: Array.isArray(followup.source_linked_model_3d_candidates) ? jsonClone(followup.source_linked_model_3d_candidates) : vectorModelContext.source_linked_model_3d_candidates,
    review_ref: followup.review_ref || null,
    screenshot_ref: followup.screenshot_ref || null,
    console_log_ref: followup.console_log_ref || null,
    packet_ref: queueItem.packet_ref || followup.packet_ref || null,
    reviewer_name: followup.reviewer_name || null,
    reviewed_at: followup.reviewed_at || null,
    next_action: queueItem.next_action || 'Create or download the source-linked obstruction/clash or sleeve/firestop packet for employee/professional review; keep regulated claims blocked until official evidence exists.',
    acceptable_evidence: acceptableEvidence,
    source_refs: uniqueByJson([
      ...(Array.isArray(followup.source_refs) ? followup.source_refs : []),
      evidence ? {
        evidence_type: 'pdf_boundary_decision',
        evidence_id: evidence.id,
        source_ref: evidence.source_ref || evidence.source_file || null,
        status: evidence.status,
      } : null,
      smokeEvidence ? {
        evidence_type: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
        evidence_id: smokeEvidence.evidence_id || null,
        artifact_type: smokeEvidence.artifact_type || 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
        source_ref: smokeEvidence.source_ref || null,
        source_file: smokeEvidence.source_file || null,
        status: smokeEvidence.status || 'present',
        claim_gate_effect: 'no_claims_cleared',
      } : null,
      reviewEvidence ? {
        evidence_type: 'openclaw_sam31_consumer_review',
        evidence_id: reviewEvidence.id,
        source_ref: reviewEvidence.source_ref || null,
        status: reviewEvidence.status,
      } : null,
      followupReviewEvidence?.evidence ? {
        evidence_type: followupReviewEvidence.evidence.evidence_type,
        evidence_id: followupReviewEvidence.evidence.id,
        artifact_type: followupReviewEvidence.review?.artifact_type || HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_REVIEW_DECISION_TYPE,
        source_ref: followupReviewEvidence.evidence.source_ref || followupReviewEvidence.review?.review_ref || null,
        status: followupReviewEvidence.evidence.status,
        claim_gate_effect: 'no_claims_cleared',
      } : null,
      {
        evidence_type: 'halofire_sam31_sprinkler_review_decision',
        evidence_id: sprinklerReviewEvidence.id,
        source_ref: sprinklerReviewEvidence.source_ref || null,
        status: sprinklerReviewEvidence.status,
      },
      {
        evidence_type: 'halofire_sam31_sprinkler_preliminary_replay_followup_decision',
        evidence_id: followupEvidence.id,
        source_ref: followupEvidence.source_ref || followup.review_ref || null,
        status: followupEvidence.status,
      },
      ...vectorModelContext.source_refs,
      followup.packet_ref ? {
        evidence_type: artifactType,
        source_ref: followup.packet_ref,
        status: 'queued_for_internal_alpha_review',
      } : null,
    ].filter(Boolean)),
    blocked_claims: Array.isArray(followup.blocked_claims) ? [...followup.blocked_claims] : [],
    limitations: uniqueStrings([
      ...(Array.isArray(followup.limitations) ? followup.limitations : []),
      'This packet is source-linked internal-alpha review evidence only; it cannot clear professional, AHJ, manufacturer, fabrication, permit, or AutoSprink parity claims by itself.',
    ]),
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function normalizeHalofireSam31SprinklerFollowupPacketReviewDecision(projectName, sourcePacket, body = {}, user = {}) {
  const reviewDecision = String(body.review_decision || 'needs_more_evidence').trim().toLowerCase();
  const allowedDecisions = [
    'accepted_internal_alpha_packet',
    'rejected_internal_alpha_packet',
    'needs_more_evidence',
  ];
  if (!allowedDecisions.includes(reviewDecision)) {
    const e = new Error(`review_decision must be one of: ${allowedDecisions.join(', ')}`);
    e.httpStatus = 400;
    throw e;
  }
  const reviewerName = String(body.reviewer_name || user.name || user.username || '').trim();
  if (!reviewerName) {
    const e = new Error('reviewer_name is required for SAM31 follow-up packet review evidence');
    e.httpStatus = 400;
    throw e;
  }
  const reviewRef = String(body.review_ref || body.source_ref || '').trim();
  if (!reviewRef) {
    const e = new Error('review_ref is required for SAM31 follow-up packet review evidence');
    e.httpStatus = 400;
    throw e;
  }
  return {
    artifact_type: HALOFIRE_SAM31_SPRINKLER_FOLLOWUP_PACKET_REVIEW_DECISION_TYPE,
    status: 'present',
    project_name: projectName,
    source_packet_artifact_type: sourcePacket.artifact_type,
    source_packet_queue_item_artifact_type: sourcePacket.source_packet_queue_item_artifact_type,
    source_followup_decision_artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_FOLLOWUP_DECISION_TYPE,
    source_followup_decision_evidence_id: sourcePacket.source_followup_decision_evidence_id,
    source_pdf_boundary_evidence_id: sourcePacket.source_pdf_boundary_evidence_id,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: sourcePacket.source_section_to_artifacts_consumer_intake_smoke_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: sourcePacket.source_openclaw_sam31_consumer_review_evidence_id,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: sourcePacket.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id || null,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: sourcePacket.source_halofire_sam31_sprinkler_review_decision_evidence_id,
    source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id: sourcePacket.source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id || null,
    source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: sourcePacket.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id || null,
    source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: sourcePacket.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || null,
    source_openclaw_sam31_extrapolation_evidence_id: sourcePacket.source_openclaw_sam31_extrapolation_evidence_id || null,
    packet_index: sourcePacket.packet_index,
    target_packet_lane: sourcePacket.target_packet_lane,
    source_field: sourcePacket.source_field,
    source_index: sourcePacket.source_index,
    review_decision: reviewDecision,
    reviewer_name: reviewerName,
    reviewed_at: new Date().toISOString(),
    review_ref: reviewRef,
    signed_packet_ref: String(body.signed_packet_ref || '').trim() || null,
    marked_up_screenshot_ref: String(body.marked_up_screenshot_ref || body.screenshot_ref || '').trim() || null,
    notes: String(body.notes || '').trim() || null,
    source_packet: sourcePacket,
    source_refs: uniqueByJson([
      ...(Array.isArray(sourcePacket.source_refs) ? sourcePacket.source_refs : []),
      {
        evidence_type: HALOFIRE_SAM31_SPRINKLER_FOLLOWUP_PACKET_REVIEW_DECISION_TYPE,
        source_ref: reviewRef,
        status: 'present',
        claim_gate_effect: 'no_claims_cleared',
      },
      body.signed_packet_ref ? {
        evidence_type: 'sam31_followup_packet_signed_review_packet',
        source_ref: String(body.signed_packet_ref).trim(),
        status: 'present',
        claim_gate_effect: 'no_claims_cleared',
      } : null,
      body.marked_up_screenshot_ref ? {
        evidence_type: 'sam31_followup_packet_marked_up_screenshot',
        source_ref: String(body.marked_up_screenshot_ref).trim(),
        status: 'present',
        claim_gate_effect: 'no_claims_cleared',
      } : null,
    ].filter(Boolean)),
    acceptable_evidence: Array.isArray(sourcePacket.acceptable_evidence) ? [...sourcePacket.acceptable_evidence] : [],
    blocked_claims: Array.isArray(sourcePacket.blocked_claims) ? [...sourcePacket.blocked_claims] : [],
    limitations: uniqueStrings([
      ...(Array.isArray(sourcePacket.limitations) ? sourcePacket.limitations : []),
      'This packet review decision records internal-alpha employee/professional workflow status only; regulated claims require separate official evidence.',
    ]),
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function normalizeHalofireSam31ConsumerIntakeSmokeFollowupReviewDecision(projectName, sourcePacket, body = {}, user = {}) {
  const reviewDecision = String(body.review_decision || 'needs_more_evidence').trim().toLowerCase();
  const allowedDecisions = [
    'accepted_internal_alpha_followup',
    'rejected_internal_alpha_followup',
    'needs_more_evidence',
  ];
  if (!allowedDecisions.includes(reviewDecision)) {
    const e = new Error(`review_decision must be one of: ${allowedDecisions.join(', ')}`);
    e.httpStatus = 400;
    throw e;
  }
  const reviewerName = String(body.reviewer_name || user.name || user.username || '').trim();
  if (!reviewerName) {
    const e = new Error('reviewer_name is required for SAM31 consumer intake smoke follow-up review evidence');
    e.httpStatus = 400;
    throw e;
  }
  const reviewRef = String(body.review_ref || body.source_ref || '').trim();
  if (!reviewRef) {
    const e = new Error('review_ref is required for SAM31 consumer intake smoke follow-up review evidence');
    e.httpStatus = 400;
    throw e;
  }
  const issueDecisions = Array.isArray(body.issue_decisions)
    ? body.issue_decisions
      .filter((decision) => decision && typeof decision === 'object')
      .map((decision) => ({
        issue_type: String(decision.issue_type || '').trim() || null,
        supported_sprinkler_review_lane: String(decision.supported_sprinkler_review_lane || '').trim() || null,
        decision: String(decision.decision || reviewDecision).trim().toLowerCase(),
        reviewed_values: decision.reviewed_values && typeof decision.reviewed_values === 'object' && !Array.isArray(decision.reviewed_values)
          ? jsonClone(decision.reviewed_values)
          : {},
        required_action: String(decision.required_action || '').trim() || null,
        notes: String(decision.notes || '').trim() || null,
      }))
    : [];
  return {
    artifact_type: HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_REVIEW_DECISION_TYPE,
    status: 'present',
    project_name: projectName,
    source_packet_artifact_type: sourcePacket.artifact_type,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: sourcePacket.source_section_to_artifacts_consumer_intake_smoke_evidence_id,
    source_replay_evidence_id: sourcePacket.source_replay_evidence_id || null,
    source_sam31_actual_value_replacement_evidence_id: sourcePacket.source_sam31_actual_value_replacement_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: sourcePacket.source_openclaw_sam31_consumer_review_evidence_id || null,
    source_openclaw_sam31_section_to_artifacts_ref: sourcePacket.source_openclaw_sam31_section_to_artifacts_ref || null,
    source_consumer: sourcePacket.source_consumer || null,
    target_application: 'halo_fire',
    review_decision: reviewDecision,
    reviewer_name: reviewerName,
    reviewed_at: new Date().toISOString(),
    review_ref: reviewRef,
    marked_up_screenshot_ref: String(body.marked_up_screenshot_ref || body.screenshot_ref || '').trim() || null,
    notes: String(body.notes || '').trim() || null,
    issue_decisions: issueDecisions,
    source_packet: sourcePacket,
    source_refs: uniqueByJson([
      ...(Array.isArray(sourcePacket.source_refs) ? sourcePacket.source_refs : []),
      {
        evidence_type: HALOFIRE_SAM31_CONSUMER_INTAKE_SMOKE_FOLLOWUP_REVIEW_DECISION_TYPE,
        source_ref: reviewRef,
        status: 'present',
        claim_gate_effect: 'no_claims_cleared',
      },
      body.marked_up_screenshot_ref ? {
        evidence_type: 'sam31_consumer_intake_smoke_marked_up_screenshot',
        source_ref: String(body.marked_up_screenshot_ref).trim(),
        status: 'present',
        claim_gate_effect: 'no_claims_cleared',
      } : null,
    ].filter(Boolean)),
    acceptable_evidence: Array.isArray(sourcePacket.acceptable_employee_evidence)
      ? [...sourcePacket.acceptable_employee_evidence]
      : [],
    blocked_claims: Array.isArray(sourcePacket.blocked_claims) ? [...sourcePacket.blocked_claims] : [],
    limitations: uniqueStrings([
      ...(Array.isArray(sourcePacket.limitations) ? sourcePacket.limitations : []),
      'This follow-up review turns SAM31 consumer-intake smoke issue seeds into internal-alpha sprinkler resolver rows only.',
      'Professional, AHJ, manufacturer, engineering-grade, AutoSprink parity, permit-ready, and fabrication-ready claims still require official evidence.',
    ]),
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
  };
}

function normalizeHalofireSam31ApprovalUploadIntake(projectName, sourcePacket, packetReview, body = {}, user = {}) {
  const code = String(body.code || '').trim();
  const rule = halofireSam31ApprovalUploadRule(code);
  if (!rule) {
    const e = new Error(`code must be one of: ${Object.values(HALOFIRE_SAM31_APPROVAL_UPLOAD_MISSING_CODES).join(', ')}`);
    e.httpStatus = 400;
    throw e;
  }
  const targetApprovalLane = String(body.target_approval_lane || rule.target_approval_lane).trim();
  if (targetApprovalLane !== rule.target_approval_lane) {
    const e = new Error(`target_approval_lane must be ${rule.target_approval_lane} for ${code}`);
    e.httpStatus = 400;
    throw e;
  }
  const evidenceType = String(body.evidence_type || rule.evidence_type).trim();
  if (evidenceType !== rule.evidence_type) {
    const e = new Error(`evidence_type must be ${rule.evidence_type} for ${code}`);
    e.httpStatus = 400;
    throw e;
  }
  const sourceRef = String(body.source_ref || '').trim();
  if (!sourceRef) {
    const e = new Error('source_ref is required for SAM31 approval upload intake evidence');
    e.httpStatus = 400;
    throw e;
  }
  const rowStatus = String(body.status || 'present').trim().toLowerCase();
  if (rowStatus !== 'present') {
    const e = new Error("SAM31 approval upload intake evidence must be recorded with status 'present'");
    e.httpStatus = 400;
    throw e;
  }
  const signoff = normalizeSignedReviewerSignoff(evidenceType, body.signoff);
  const gateCode = halofireSam31ApprovalUploadGateCode(rule.target_approval_lane);
  return {
    artifact_type: HALOFIRE_SAM31_APPROVAL_UPLOAD_INTAKE_TYPE,
    status: 'uploaded_pending_gate_validation',
    project_name: projectName,
    code,
    target_approval_lane: rule.target_approval_lane,
    evidence_type: evidenceType,
    required_evidence_type: rule.required_evidence_type,
    gate_code: gateCode,
    source_packet_review_decision_artifact_type: packetReview.artifact_type || HALOFIRE_SAM31_SPRINKLER_FOLLOWUP_PACKET_REVIEW_DECISION_TYPE,
    source_packet_review_decision_evidence_id: packetReview.evidence_id,
    source_packet_artifact_type: packetReview.source_packet_artifact_type || sourcePacket.artifact_type,
    source_packet_queue_item_artifact_type: sourcePacket.source_packet_queue_item_artifact_type,
    source_followup_decision_evidence_id: sourcePacket.source_followup_decision_evidence_id,
    source_pdf_boundary_evidence_id: sourcePacket.source_pdf_boundary_evidence_id,
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: sourcePacket.source_section_to_artifacts_consumer_intake_smoke_evidence_id || null,
    source_openclaw_sam31_consumer_review_evidence_id: sourcePacket.source_openclaw_sam31_consumer_review_evidence_id,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: sourcePacket.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id || null,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: sourcePacket.source_halofire_sam31_sprinkler_review_decision_evidence_id,
    source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id: sourcePacket.source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id || null,
    source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: sourcePacket.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id || null,
    source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: sourcePacket.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || null,
    source_openclaw_sam31_extrapolation_evidence_id: sourcePacket.source_openclaw_sam31_extrapolation_evidence_id || null,
    packet_index: sourcePacket.packet_index,
    target_packet_lane: sourcePacket.target_packet_lane,
    source_field: sourcePacket.source_field,
    source_index: sourcePacket.source_index,
    source_ref: sourceRef,
    source_file: String(body.source_file || body.sourceFile || '').trim() || null,
    signoff,
    uploaded_by: user.username || user.name || 'unknown',
    uploaded_at: new Date().toISOString(),
    notes: String(body.notes || '').trim() || null,
    gate_validation_action: gateCode ? {
      method: 'POST',
      href: `/api/projects/${encodeURIComponent(projectName)}/claim-gates/${encodeURIComponent(gateCode)}/resolve`,
      request_body: { evidence_id: null },
    } : null,
    source_refs: uniqueByJson([
      ...(Array.isArray(sourcePacket.source_refs) ? sourcePacket.source_refs : []),
      ...(Array.isArray(packetReview.source_refs) ? packetReview.source_refs : []),
      {
        evidence_type: evidenceType,
        source_ref: sourceRef,
        source_file: String(body.source_file || body.sourceFile || '').trim() || null,
        status: 'present',
        claim_gate_effect: 'no_claims_cleared',
      },
      {
        evidence_type: HALOFIRE_SAM31_SPRINKLER_FOLLOWUP_PACKET_REVIEW_DECISION_TYPE,
        evidence_id: packetReview.evidence_id,
        source_ref: packetReview.source_ref || packetReview.review_ref || null,
        status: 'present',
        claim_gate_effect: 'no_claims_cleared',
      },
    ].filter(Boolean)),
    blocked_claims: uniqueStrings([
      ...(Array.isArray(sourcePacket.blocked_claims) ? sourcePacket.blocked_claims : []),
      ...(rule.target_approval_lane === 'professional_approval' ? ['professional_approval', 'permit_ready', 'fabrication_ready'] : []),
      ...(rule.target_approval_lane === 'AHJ_approval' ? ['AHJ_approval', 'permit_ready'] : []),
      ...(rule.target_approval_lane === 'manufacturer_exact' ? ['manufacturer_exact', 'fabrication_ready'] : []),
    ]),
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: [
      'This upload intake records signed evidence for later claim-gate validation only.',
      'It does not clear professional, AHJ, manufacturer, permit-ready, fabrication-ready, AutoSprink parity, or engineering-grade claims by itself.',
    ],
  };
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
    source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id: packet.source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id || null,
    source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: packet.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id || null,
    source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: packet.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || null,
    source_openclaw_sam31_extrapolation_evidence_id: packet.source_openclaw_sam31_extrapolation_evidence_id || null,
    source_openclaw_sam31_vector_model_artifact_evidence_id: packet.source_openclaw_sam31_vector_model_artifact_evidence_id || null,
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
    halofire_sam31_sectioning_sprinkler_review_adapter: packet.halofire_sam31_sectioning_sprinkler_review_adapter || null,
    openclaw_sam31_vector_model_artifact: packet.openclaw_sam31_vector_model_artifact || null,
    source_linked_vector_overlays: Array.isArray(packet.source_linked_vector_overlays) ? jsonClone(packet.source_linked_vector_overlays) : [],
    source_linked_model_3d_candidates: Array.isArray(packet.source_linked_model_3d_candidates) ? jsonClone(packet.source_linked_model_3d_candidates) : [],
    replay_output: {
      artifact_type: HALOFIRE_SAM31_SPRINKLER_PRELIMINARY_REPLAY_OUTPUT_TYPE,
      status: 'requires_employee_or_professional_followup',
      project_name: projectName,
      source_halofire_sam31_sprinkler_review_decision_evidence_id: sprinklerReviewEvidence.id,
      source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id: packet.source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id || null,
      source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: packet.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id || null,
      source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: packet.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || null,
      source_openclaw_sam31_extrapolation_evidence_id: packet.source_openclaw_sam31_extrapolation_evidence_id || null,
      source_openclaw_sam31_vector_model_artifact_evidence_id: packet.source_openclaw_sam31_vector_model_artifact_evidence_id || null,
      supported_sprinkler_review_lane: packet.supported_sprinkler_review_lane,
      replay_scope: replayInputs.replay_scope || halofireSam31SprinklerReplayScope(packet.supported_sprinkler_review_lane),
      issue_candidates: issueCandidates,
      issue_candidate_count: issueCandidates.length,
      source_linked_vector_overlays: Array.isArray(packet.source_linked_vector_overlays) ? jsonClone(packet.source_linked_vector_overlays) : [],
      source_linked_model_3d_candidates: Array.isArray(packet.source_linked_model_3d_candidates) ? jsonClone(packet.source_linked_model_3d_candidates) : [],
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
    source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id: replayArtifact.source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id || null,
    source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: replayArtifact.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id || null,
    source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: replayArtifact.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || null,
    source_openclaw_sam31_extrapolation_evidence_id: replayArtifact.source_openclaw_sam31_extrapolation_evidence_id || null,
    source_openclaw_sam31_vector_model_artifact_evidence_id: replayArtifact.source_openclaw_sam31_vector_model_artifact_evidence_id || null,
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
    halofire_sam31_sectioning_sprinkler_review_adapter: replayArtifact.halofire_sam31_sectioning_sprinkler_review_adapter || null,
    openclaw_sam31_vector_model_artifact: replayArtifact.openclaw_sam31_vector_model_artifact || null,
    source_linked_vector_overlays: Array.isArray(replayArtifact.source_linked_vector_overlays) ? jsonClone(replayArtifact.source_linked_vector_overlays) : [],
    source_linked_model_3d_candidates: Array.isArray(replayArtifact.source_linked_model_3d_candidates) ? jsonClone(replayArtifact.source_linked_model_3d_candidates) : [],
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

function normalizeHalofireSam31ConsumerIntakeSmokePreliminaryReplayFollowupDecision(projectName, smokeEvidence, followupReviewEvidence, sprinklerReviewEvidence, sprinklerReview, body = {}, user = {}) {
  const replayArtifact = buildHalofireSam31ConsumerIntakeSmokePreliminaryReplayArtifact(
    projectName,
    smokeEvidence,
    followupReviewEvidence,
    sprinklerReviewEvidence,
    sprinklerReview,
  );
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
    const e = new Error('review_ref is required for SAM31 smoke preliminary replay follow-up evidence');
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
    source_section_to_artifacts_consumer_intake_smoke_evidence_id: replayArtifact.source_section_to_artifacts_consumer_intake_smoke_evidence_id,
    source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: replayArtifact.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id,
    source_openclaw_sam31_consumer_review_evidence_id: replayArtifact.source_openclaw_sam31_consumer_review_evidence_id || null,
    source_halofire_sam31_sprinkler_review_decision_evidence_id: sprinklerReviewEvidence.id,
    source_sam31_actual_value_replacement_evidence_id: replayArtifact.source_sam31_actual_value_replacement_evidence_id || null,
    source_openclaw_sam31_section_to_artifacts_ref: replayArtifact.source_openclaw_sam31_section_to_artifacts_ref || null,
    consumer: replayArtifact.consumer,
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
      'This smoke-derived follow-up decision can queue obstruction/clash or sleeve/firestop packet work, but it does not clear any regulated claim.',
    ]),
  };
  followup.packet_queue_items = halofireSam31SprinklerPreliminaryReplayPacketQueueItems(followup);
  return followup;
}

function halofireSam31SprinklerPreliminaryReplayQueueItems(projectName, evidence, decision, reviewEvidences, sprinklerReviewDecisionEvidences = [], preliminaryReplayFollowupDecisionEvidences = [], followupPacketReviewDecisionEvidences = [], approvalUploadIntakeEvidences = []) {
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
      const latestFollowupSummary = halofireSam31SprinklerPreliminaryReplayFollowupSummary(latestFollowup, followupPacketReviewDecisionEvidences, approvalUploadIntakeEvidences);
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
        source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id: packet.source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id || null,
        source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: packet.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id || null,
        source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: packet.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id || null,
        source_openclaw_sam31_extrapolation_evidence_id: packet.source_openclaw_sam31_extrapolation_evidence_id || null,
        source_openclaw_sam31_vector_model_artifact_evidence_id: packet.source_openclaw_sam31_vector_model_artifact_evidence_id || null,
        source_linked_vector_overlay_count: Array.isArray(packet.source_linked_vector_overlays) ? packet.source_linked_vector_overlays.length : 0,
        source_linked_model_3d_candidate_count: Array.isArray(packet.source_linked_model_3d_candidates) ? packet.source_linked_model_3d_candidates.length : 0,
        openclaw_sam31_vector_model_artifact: packet.openclaw_sam31_vector_model_artifact || null,
        halofire_sam31_sectioning_sprinkler_review_adapter: packet.halofire_sam31_sectioning_sprinkler_review_adapter || null,
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
  const vectorModelContext = openClawSam31VectorModelArtifactReviewContext(projectName, evidence.id);
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
    source_openclaw_sam31_vector_model_artifact_evidence_id: vectorModelContext.source_openclaw_sam31_vector_model_artifact_evidence_id,
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
    openclaw_sam31_vector_model_artifact: vectorModelContext.openclaw_sam31_vector_model_artifact,
    source_linked_vector_overlays: vectorModelContext.source_linked_vector_overlays,
    source_linked_model_3d_candidates: vectorModelContext.source_linked_model_3d_candidates,
    consumer_review_decision_packet: decisionPacket,
    sprinkler_review_packet: {
      artifact_type: HALOFIRE_SAM31_SPRINKLER_REVIEW_PACKET_TYPE,
      source: SAM31_TO_SPRINKLER_REVIEW_ADAPTER_TYPE,
      status: 'requires_employee_sprinkler_review',
      project_name: projectName,
      source_pdf_boundary_evidence_id: evidence.id,
      source_openclaw_sam31_consumer_review_evidence_id: reviewEvidence.id,
      source_openclaw_sam31_vector_model_artifact_evidence_id: vectorModelContext.source_openclaw_sam31_vector_model_artifact_evidence_id,
      consumer: review.consumer,
      supported_sprinkler_review_lanes: supportedSprinklerReviewLanes,
      issue_seeds: issueSeeds,
      openclaw_sam31_vector_model_artifact: vectorModelContext.openclaw_sam31_vector_model_artifact,
      source_linked_vector_overlays: vectorModelContext.source_linked_vector_overlays,
      source_linked_model_3d_candidates: vectorModelContext.source_linked_model_3d_candidates,
      next_action: 'Use these reviewed SAM31 values to prepare room-boundary, obstruction/clash, sleeve/firestop, vector-overlay, and 3D-candidate review tasks; keep regulated claims blocked.',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    source_refs: uniqueByJson([
      ...(Array.isArray(decisionPacket.source_refs) ? decisionPacket.source_refs : []),
      ...vectorModelContext.source_refs,
    ]),
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

function buildRoomBoundaryFloorPlanOverride(projectName, replaySource, sourceEvidence, sourceReviewEvidence, correctedRoomPolygons, sourceRefs) {
  const reviewEvidenceKey = replaySource === 'latest_employee_review_packet'
    ? 'source_review_evidence_id'
    : 'source_sam31_evidence_id';
  return {
    artifact_type: 'halofire.room_boundary_floor_plan_override.v1',
    status: 'internal_alpha_floor_plan_override',
    project_name: projectName,
    room_boundary_source: replaySource,
    source_evidence_id: sourceEvidence?.id || null,
    [reviewEvidenceKey]: sourceReviewEvidence?.id || null,
    source_file: sourceEvidence?.source_file || null,
    source_ref: sourceEvidence?.source_ref || sourceReviewEvidence?.source_ref || null,
    corrected_room_polygon_count: Array.isArray(correctedRoomPolygons) ? correctedRoomPolygons.length : 0,
    source_refs: uniqueByJson(sourceRefs),
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    blocked_claims: [
      'geometry_accuracy',
      'drawing_scale_verified',
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'AutoSprink_parity',
      'engineering_grade',
    ],
    limitations: [
      'This override lets employee-reviewed room polygons drive an internal-alpha best-effort sprinkler bid replay.',
      'It does not prove geometry accuracy, drawing scale, AHJ approval, professional approval, AutoSprink parity, permit readiness, fabrication readiness, or engineering-grade output.',
    ],
  };
}

function annotateRoomBoundaryFloorPlanOverridePolygons(correctedRoomPolygons, floorPlanOverride) {
  const polygons = Array.isArray(correctedRoomPolygons) ? correctedRoomPolygons : [];
  return polygons.map((entry) => {
    const polygon = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? jsonClone(entry)
      : { polygon: entry };
    return {
      ...polygon,
      floor_plan_override_source: floorPlanOverride.room_boundary_source,
      source_evidence_id: floorPlanOverride.source_evidence_id,
      ...(floorPlanOverride.source_review_evidence_id
        ? { source_review_evidence_id: floorPlanOverride.source_review_evidence_id }
        : {}),
      ...(floorPlanOverride.source_sam31_evidence_id
        ? { source_sam31_evidence_id: floorPlanOverride.source_sam31_evidence_id }
        : {}),
      floor_plan_override_artifact_type: floorPlanOverride.artifact_type,
      source_refs: uniqueByJson([
        ...(Array.isArray(polygon.source_refs) ? polygon.source_refs : []),
        ...(Array.isArray(floorPlanOverride.source_refs) ? floorPlanOverride.source_refs : []),
      ]),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    };
  });
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

function pdfBoundaryResolverQueueItem(projectName, evidence, decision, reviewEvidence = null, sam31Evidence = null, sam31ReplacementEvidence = null, sam31SmokeEvidence = null, sam31ExtrapolationEvidence = null, sam31ExtrapolationReviewEvidence = null, sam31SectioningContractReviewEvidence = null, sam31SectioningDownstreamPacketEvidence = null, sam31SectioningSprinklerReviewAdapterEvidence = null, sam31ConsumerSmokeEvidence = null, sam31ConsumerReviewEvidences = [], sam31SprinklerReviewDecisionEvidences = [], sam31SprinklerPreliminaryReplayFollowupDecisionEvidences = [], sam31SprinklerFollowupPacketReviewDecisionEvidences = [], sam31ApprovalUploadIntakeEvidences = []) {
  if (!evidence || !decision) return null;
  const candidate = decision.candidate || {};
  const pdfRef = evidence.source_file || decision.sourceFile || evidence.source_ref || decision.sourceRef || `${projectName}:pdf-boundary:${evidence.id}`;
  const bridgeStatus = openClawSam31BridgeStatus();
  const extrapolateStatus = openClawSam31ExtrapolateStatus();
  const bridgeSmokeHref = `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/smoke-artifact`;
  const extrapolateHref = `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/openclaw/sam31/extrapolation-artifact`;
  const consumerSmokeHref = `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/openclaw/sam31/consumer-smoke`;
  const toolContractHref = `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/openclaw/sam31/tool-contract`;
  const sectioningPipelineContractHref = `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/openclaw/sam31/sectioning-pipeline-contract`;
  const sectioningPipelineContractReviewHref = `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/openclaw/sam31/sectioning-pipeline-contract-review`;
  const vectorModelArtifactHref = `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/openclaw/sam31/vector-model-artifacts`;
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
  const openclawSam31ToolContractAction = {
    label: 'Download SAM31 tool contract',
    method: 'GET',
    href: toolContractHref,
    status: 'ready',
    artifact_type: 'openclaw.sam31_llm_extrapolation_tool_contract_packet.v1',
    source_runtime: 'halofire-api-local-contract',
    source_evidence_id: evidence.id,
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'The local SAM31 tool contract makes the see/understand/extrapolate workflow executable; it does not prove runtime capture or regulated claims.',
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
  const latestOpenClawSam31SectioningPipelineContractReview = openClawSam31SectioningPipelineContractReviewSummary(sam31SectioningContractReviewEvidence);
  const latestHalofireSam31SectioningDownstreamResolverPacket = halofireSam31SectioningDownstreamResolverPacketSummary(sam31SectioningDownstreamPacketEvidence);
  const latestHalofireSam31SectioningSprinklerReviewAdapter = halofireSam31SectioningSprinklerReviewAdapterSummary(sam31SectioningSprinklerReviewAdapterEvidence);
  const latestOpenClawSam31VectorModelArtifact = openClawSam31VectorModelArtifactSummary(latestOpenClawSam31VectorModelArtifactEvidence(projectName, evidence.id));
  const latestOpenClawSam31ConsumerSmokeArtifact = openClawSam31ConsumerSmokeReplaySummary(sam31ConsumerSmokeEvidence);
  const latestOpenClawSam31ConsumerReviews = openClawSam31ConsumerReviewSummaries(sam31ConsumerReviewEvidences);
  const sam31UnresolvedConsumerReviews = openClawSam31UnresolvedConsumerReviewSummaries(
    latestOpenClawSam31ConsumerSmokeArtifact,
    latestOpenClawSam31ConsumerReviews,
  );
  const sam31SectioningDownstreamResolverQueueItems = openClawSam31SectioningDownstreamResolverQueueItems(projectName, evidence, decision, sam31SectioningContractReviewEvidence);
  const sam31SprinklerReviewQueueItems = openClawSam31SprinklerReviewQueueItems(projectName, evidence, decision, sam31ConsumerReviewEvidences, sam31SprinklerReviewDecisionEvidences);
  const sam31SprinklerPreliminaryReplayQueueItems = halofireSam31SprinklerPreliminaryReplayQueueItems(projectName, evidence, decision, sam31ConsumerReviewEvidences, sam31SprinklerReviewDecisionEvidences, sam31SprinklerPreliminaryReplayFollowupDecisionEvidences, sam31SprinklerFollowupPacketReviewDecisionEvidences, sam31ApprovalUploadIntakeEvidences);
  const openclawSam31VectorModelArtifactAction = {
    label: 'Download SAM31 vector/model artifact packet',
    method: 'GET',
    href: vectorModelArtifactHref,
    status: latestSam31VisualAudit?.openclaw_sam31_perception_packet ? 'ready' : 'requires_sam31_visual_audit',
    artifact_type: SAM31_VECTOR_MODEL_ARTIFACT_PACKET_TYPE,
    source_pdf_boundary_evidence_id: evidence.id,
    source_sam31_visual_audit_evidence_id: latestSam31VisualAudit?.evidence_id || null,
    source_runtime: 'sam-3.1+llm',
    supported_evidence_lanes: [
      'vector_overlay_generation',
      'model_3d_candidate_generation',
    ],
    temporary_value_policy: 'best_guess_until_employee_replaced',
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    blocked_claims: uniqueStrings([
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      ...SAM31_BLOCKED_CLAIMS,
      'geometry_accuracy',
      'permit_ready',
      'AHJ_approval',
      'AutoSprink_parity',
      'manufacturer_exact',
    ]),
    limitations: [
      'This action downloads or records source-linked vector/model best guesses only; no approval or accuracy claim is cleared.',
    ],
  };
  const openclawSam31SectioningPipelineContractAction = {
    label: 'Download SAM31 sectioning pipeline contract',
    method: 'GET',
    href: sectioningPipelineContractHref,
    status: latestOpenClawSam31ExtrapolationArtifact ? 'ready' : 'requires_sam31_extrapolation_artifact',
    artifact_type: 'openclaw.sam31.sectioning_pipeline_contract_packet.v1',
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_extrapolation_evidence_id: sam31ExtrapolationEvidence?.evidence?.id || null,
    source_runtime: sam31ExtrapolationEvidence?.artifact?.sectioning_pipeline_contract?.source_runtime || 'halofire-api-local-contract',
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'This action downloads the source-linked SAM31 sectioning pipeline contract for product review; it does not clear geometry or regulated claims.',
    ],
  };
  const openclawSam31SectioningPipelineContractReviewAction = {
    label: 'Save SAM31 sectioning contract review',
    method: 'POST',
    href: sectioningPipelineContractReviewHref,
    status: latestOpenClawSam31ExtrapolationArtifact ? 'ready_for_employee_replacement' : 'requires_sam31_extrapolation_artifact',
    artifact_type: 'openclaw.sam31.sectioning_pipeline_contract_review.v1',
    source_pdf_boundary_evidence_id: evidence.id,
    source_openclaw_sam31_extrapolation_evidence_id: sam31ExtrapolationEvidence?.evidence?.id || null,
    source_sectioning_pipeline_contract_artifact_type: sam31ExtrapolationEvidence?.artifact?.sectioning_pipeline_contract?.artifact_type || 'openclaw.sam31.sectioning_pipeline_contract.v1',
    acceptable_replacement_fields: [...SAM31_SECTIONING_PIPELINE_CONTRACT_REVIEW_FIELDS],
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'This action records employee/product-owner replacement values for SAM31 sectioning outputs only; it does not clear geometry or regulated claims.',
    ],
  };
  const openclawSam31SectioningSprinklerReviewAdapterAction = latestHalofireSam31SectioningDownstreamResolverPacket ? {
    label: 'Save SAM31 sectioning sprinkler review adapter',
    method: 'POST',
    href: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/openclaw/sam31/sectioning-downstream-resolvers/${latestHalofireSam31SectioningDownstreamResolverPacket.evidence_id}/sprinkler-review-adapter`,
    status: latestHalofireSam31SectioningSprinklerReviewAdapter ? 'adapter_recorded' : 'ready_for_internal_alpha_sprinkler_review',
    artifact_type: SAM31_TO_SPRINKLER_REVIEW_ADAPTER_TYPE,
    source_pdf_boundary_evidence_id: evidence.id,
    source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: latestHalofireSam31SectioningDownstreamResolverPacket.evidence_id,
    source_adapter_artifact_type: HALOFIRE_SAM31_SECTIONING_DOWNSTREAM_RESOLVER_PACKET_TYPE,
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'This action persists a sectioning-derived sprinkler review adapter for internal-alpha review only.',
      'It does not clear permit-ready, AHJ, professional, AutoSprink, fabrication, manufacturer, geometry, or drawing-scale claims.',
    ],
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
  const replayReviewEvidence = latestReview ? reviewEvidence?.evidence : (latestSam31VisualAudit ? sam31Evidence?.evidence : null);
  const replayReviewPayload = latestReview ? reviewEvidence?.review : (latestSam31VisualAudit ? sam31Evidence?.result : null);
  const replayReviewSource = latestReview ? 'latest_employee_review_packet' : (latestSam31VisualAudit ? 'latest_sam31_visual_audit' : null);
  const replayCorrectedRoomPolygons = Array.isArray(replayReviewPayload?.corrected_room_polygons)
    ? replayReviewPayload.corrected_room_polygons
    : [];
  const floorPlanOverride = replayReviewEvidence && replayReviewSource && status !== 'blocked'
    ? buildRoomBoundaryFloorPlanOverride(
      projectName,
      replayReviewSource,
      evidence,
      replayReviewEvidence,
      replayCorrectedRoomPolygons,
      [
        {
          evidence_id: replayReviewEvidence.id,
          evidence_type: replayReviewEvidence.evidence_type,
          source_ref: replayReviewEvidence.source_ref || null,
        },
        ...(Array.isArray(decision.sourceRefs) ? decision.sourceRefs : []),
      ],
    )
    : null;
  const floorPlanOverrideAction = floorPlanOverride ? {
    label: 'Run replay bid with floor-plan override',
    method: 'POST',
    href: `/api/projects/${encodeURIComponent(projectName)}/sprinkler-bid`,
    download_href: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/pdf-boundary/${evidence.id}/floor-plan-override-action`,
    artifact_type: floorPlanOverride.artifact_type,
    status: 'ready_for_internal_alpha_replay',
    floor_plan_override_status: 'internal_alpha_floor_plan_override_ready',
    room_boundary_source: floorPlanOverride.room_boundary_source,
    source_evidence_id: floorPlanOverride.source_evidence_id,
    source_review_evidence_id: floorPlanOverride.source_review_evidence_id || null,
    source_sam31_evidence_id: floorPlanOverride.source_sam31_evidence_id || null,
    corrected_room_polygon_count: floorPlanOverride.corrected_room_polygon_count,
    source_refs: floorPlanOverride.source_refs,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    blocked_claims: floorPlanOverride.blocked_claims,
    limitations: floorPlanOverride.limitations,
  } : null;
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
    ...(floorPlanOverride ? {
      floor_plan_override_status: 'internal_alpha_floor_plan_override_ready',
      floor_plan_override_source: floorPlanOverride.room_boundary_source,
      floor_plan_override_artifact_type: floorPlanOverride.artifact_type,
      floor_plan_override: floorPlanOverride,
      floor_plan_override_action: floorPlanOverrideAction,
      source_review_evidence_id: floorPlanOverride.source_review_evidence_id || null,
      source_sam31_evidence_id: floorPlanOverride.source_sam31_evidence_id || null,
      corrected_room_polygon_count: floorPlanOverride.corrected_room_polygon_count,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    } : {}),
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
      employeeDecision: decision.employeeDecision || null,
      source_refs: Array.isArray(decision.sourceRefs) ? decision.sourceRefs : [],
    },
    employee_decision: decision.employeeDecision || null,
    blocked_claims: Array.isArray(decision.blockedClaims) ? decision.blockedClaims : [...PDF_BOUNDARY_BLOCKED_CLAIMS],
    latest_review: latestReview,
    latest_sam31_visual_audit: latestSam31VisualAudit,
    latest_sam31_employee_replacement: latestSam31EmployeeReplacement,
    latest_openclaw_sam31_bridge_smoke_artifact: latestSam31BridgeSmokeArtifact,
    latest_openclaw_sam31_extrapolation_artifact: latestOpenClawSam31ExtrapolationArtifact,
    latest_openclaw_sam31_extrapolation_review: latestOpenClawSam31ExtrapolationReview,
    latest_openclaw_sam31_sectioning_pipeline_contract_review: latestOpenClawSam31SectioningPipelineContractReview,
    latest_halofire_sam31_sectioning_downstream_resolver_packet: latestHalofireSam31SectioningDownstreamResolverPacket,
    latest_halofire_sam31_sectioning_sprinkler_review_adapter: latestHalofireSam31SectioningSprinklerReviewAdapter,
    latest_openclaw_sam31_vector_model_artifact: latestOpenClawSam31VectorModelArtifact,
    latest_openclaw_sam31_consumer_smoke_artifact: latestOpenClawSam31ConsumerSmokeArtifact,
    latest_openclaw_sam31_consumer_reviews: latestOpenClawSam31ConsumerReviews,
    sam31_unresolved_consumer_reviews: sam31UnresolvedConsumerReviews,
    sam31_sectioning_downstream_resolver_queue_items: sam31SectioningDownstreamResolverQueueItems,
    sam31_sprinkler_review_queue_items: sam31SprinklerReviewQueueItems,
    sam31_sprinkler_preliminary_replay_queue_items: sam31SprinklerPreliminaryReplayQueueItems,
    openclaw_sam31_bridge_status: bridgeStatus,
    sam31_bridge_smoke_action: sam31BridgeSmokeAction,
    openclaw_sam31_tool_contract_action: openclawSam31ToolContractAction,
    openclaw_sam31_sectioning_pipeline_contract_action: openclawSam31SectioningPipelineContractAction,
    openclaw_sam31_sectioning_pipeline_contract_review_action: openclawSam31SectioningPipelineContractReviewAction,
    openclaw_sam31_sectioning_sprinkler_review_adapter_action: openclawSam31SectioningSprinklerReviewAdapterAction,
    openclaw_sam31_vector_model_artifact_action: openclawSam31VectorModelArtifactAction,
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
      { label: 'Download SAM31 tool contract', href: toolContractHref, method: 'GET', artifact_type: 'openclaw.sam31_llm_extrapolation_tool_contract_packet.v1' },
      { label: 'Download SAM31 sectioning pipeline contract', href: sectioningPipelineContractHref, method: 'GET', artifact_type: 'openclaw.sam31.sectioning_pipeline_contract_packet.v1' },
      { label: 'Save SAM31 sectioning contract review', href: sectioningPipelineContractReviewHref, method: 'POST', artifact_type: 'openclaw.sam31.sectioning_pipeline_contract_review.v1' },
      { label: 'Download SAM31 vector/model artifact packet', href: vectorModelArtifactHref, method: 'GET', artifact_type: SAM31_VECTOR_MODEL_ARTIFACT_PACKET_TYPE },
      { label: 'Run OpenClaw SAM31 extrapolation artifact', href: extrapolateHref, method: 'POST' },
      { label: 'Run LandScout/NameForge SAM31 queue smoke', href: consumerSmokeHref, method: 'POST', artifact_type: SAM31_CONSUMER_SMOKE_ARTIFACT_TYPE },
      ...(floorPlanOverrideAction ? [floorPlanOverrideAction] : []),
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

function suppliedDocumentBidTruthReplacementFromEvidence(row) {
  if (!row) return null;
  const notes = safeParseJsonObject(row.notes) || {};
  const replacement = notes.replacement || notes;
  if (!replacement || typeof replacement !== 'object') return null;
  return {
    evidence_id: row.id,
    evidence_status: row.status,
    source_file: row.source_file || replacement.source_file || null,
    source_ref: row.source_ref || replacement.replacement_ref || replacement.source_ref || null,
    ...replacement,
    claim_gate_effect: replacement.claim_gate_effect || notes.claim_gate_effect || 'no_claims_cleared',
    blocked_claims: Array.isArray(replacement.blocked_claims)
      ? replacement.blocked_claims
      : (Array.isArray(notes.blocked_claims) ? notes.blocked_claims : []),
  };
}

function latestSuppliedDocumentBidTruthReplacementEvidence(projectName) {
  const row = db
    .prepare(`SELECT * FROM project_evidence
              WHERE project_name = ? AND evidence_type = 'supplied_document_bid_truth_replacement'
              ORDER BY created_at DESC, id DESC
              LIMIT 1`)
    .get(projectName);
  return row ? { evidence: row, replacement: suppliedDocumentBidTruthReplacementFromEvidence(row) } : null;
}

function suppliedDocumentBidTruthDownstreamDefaults(projectName) {
  const status = buildSuppliedDocumentBidTruthStatus(path.resolve(__dirname, '../..'), projectName);
  const latest = latestSuppliedDocumentBidTruthReplacementEvidence(projectName);
  if (!latest?.replacement) return null;
  const replacementValues = latest.replacement.replacement_values
    && typeof latest.replacement.replacement_values === 'object'
    && !Array.isArray(latest.replacement.replacement_values)
    ? jsonClone(latest.replacement.replacement_values)
    : {};
  const replacedFields = Array.isArray(latest.replacement.replaced_fields)
    ? latest.replacement.replaced_fields
    : Object.keys(replacementValues);
  return {
    artifact_type: 'halofire.supplied_document_bid_truth_downstream_defaults.v1',
    status: 'employee_replacement_applied',
    project_name: projectName,
    source_evidence_type: 'supplied_document_bid_truth_replacement',
    source_replacement_evidence_id: latest.evidence.id,
    replacement_ref: latest.replacement.replacement_ref || latest.replacement.source_ref || latest.evidence.source_ref,
    source_file: latest.evidence.source_file || latest.replacement.source_file || null,
    source_refs: Array.isArray(latest.replacement.source_refs) ? latest.replacement.source_refs : [],
    replacement_values: replacementValues,
    replaced_fields: replacedFields,
    project_truth: {
      ...(status.project_truth || {}),
      ...replacementValues,
      source_status: 'employee_replacement_recorded',
    },
    temporary_value_policy: status.temporary_value_policy || latest.replacement.temporary_value_policy || 'best_guess_until_employee_replaced',
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    blocked_claims: Array.isArray(latest.replacement.blocked_claims) && latest.replacement.blocked_claims.length
      ? latest.replacement.blocked_claims
      : (Array.isArray(status.blocked_claims) ? status.blocked_claims : []),
    limitations: [
      ...(Array.isArray(status.limitations) ? status.limitations : []),
      'Employee supplied-document bid-truth replacements may update internal-alpha defaults only.',
      'They do not clear permit-ready, AHJ, professional, manufacturer, engineering-grade, fabrication-ready, or AutoSprink parity claims.',
    ],
  };
}

function suppliedDocumentBidTruthDownstreamDefaultsPacket(projectName) {
  const defaults = suppliedDocumentBidTruthDownstreamDefaults(projectName);
  if (!defaults) {
    const e = new Error('No supplied_document_bid_truth_replacement evidence is available for downstream defaults');
    e.httpStatus = 409;
    throw e;
  }
  return {
    ...defaults,
    artifact_type: 'halofire.supplied_document_bid_truth_downstream_defaults_packet.v1',
    artifact_type_source: defaults.artifact_type,
    status: defaults.status,
    project_name: projectName,
    generated_at: new Date().toISOString(),
    download_name: `${slugForDownloadName(projectName)}-supplied-bid-truth-downstream-defaults.json`,
    source_supplied_document_bid_truth_replacement_evidence_id: defaults.source_replacement_evidence_id,
    downstream_application: {
      endpoint: `/api/projects/${encodeURIComponent(projectName)}/sprinkler-bid`,
      applies_to: 'built_in_internal_alpha_floorplan_defaults',
      geometry_policy: 'scale_placeholder_footprint_area_only',
      head_count_policy: 'metadata_only_not_forced_into_layout_engine',
      temporary_value_policy: defaults.temporary_value_policy,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    },
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      ...(Array.isArray(defaults.limitations) ? defaults.limitations : []),
      'This packet is a downloadable resolver artifact for workbench replay/provenance only.',
      'Downloading or applying this packet does not clear regulated claims.',
    ],
  };
}

function scaleFloorPlanAreaForSuppliedBidTruth(floorPlan, suppliedDocumentBidTruth) {
  const targetSqFt = Number(suppliedDocumentBidTruth?.project_truth?.square_feet);
  if (!(targetSqFt > 0) || !floorPlan?.rooms?.length) return floorPlan;
  const currentSqFt = floorPlan.rooms.reduce((sum, room) => sum + polygonArea(room.polygon || []), 0);
  if (!(currentSqFt > 0)) return floorPlan;
  const scale = Math.sqrt(targetSqFt / currentSqFt);
  return {
    ...floorPlan,
    source: [
      floorPlan.source || 'built-in internal-alpha floor plan',
      `supplied_document_bid_truth_replacement:${suppliedDocumentBidTruth.source_replacement_evidence_id}`,
      `square_feet=${targetSqFt}`,
      'claim_gate_effect=no_claims_cleared',
    ].join('; '),
    supplied_document_bid_truth_replacement_evidence_id: suppliedDocumentBidTruth.source_replacement_evidence_id,
    rooms: floorPlan.rooms.map((room) => ({
      ...room,
      polygon: (room.polygon || []).map(([x, y]) => [x * scale, y * scale]),
    })),
  };
}

function suppliedDocumentBidTruthReviewPacket(projectName) {
  const status = buildSuppliedDocumentBidTruthStatus(path.resolve(__dirname, '../..'), projectName);
  const blockedClaims = Array.isArray(status.blocked_claims) ? status.blocked_claims : [];
  return {
    artifact_type: 'halofire.supplied_document_bid_truth_review_packet.v1',
    status: 'ready_for_employee_review',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    download_name: `${slugForDownloadName(projectName)}-supplied-bid-truth-employee-review-packet.json`,
    source_evidence_type: 'supplied_document_bid_truth',
    source_status_artifact_type: status.artifact_type,
    source_ref: status.project_truth?.source_file || 'supplied-halo-fire-documents',
    project_truth: status.project_truth || null,
    cross_project_truth: Array.isArray(status.cross_project_truth) ? status.cross_project_truth : [],
    pricebook_sources: Array.isArray(status.pricebook_sources) ? status.pricebook_sources : [],
    source_document_counts: status.source_document_counts || {},
    acceptable_evidence: Array.isArray(status.acceptable_evidence) ? status.acceptable_evidence : [],
    employee_next_actions: Array.isArray(status.employee_next_actions) ? status.employee_next_actions : [],
    employee_decision_fields: [
      'reviewer_name',
      'review_decision',
      'replacement_ref',
      'replacement_values',
      'source_refs',
      'notes',
    ],
    employee_replaceable_fields: Array.isArray(status.project_truth?.employee_replaceable_fields)
      ? status.project_truth.employee_replaceable_fields
      : [],
    temporary_value_policy: status.temporary_value_policy || 'best_guess_until_employee_replaced',
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    blocked_claims: blockedClaims,
    limitations: Array.isArray(status.limitations) ? status.limitations : [],
  };
}

function normalizeSuppliedDocumentBidTruthReplacement(projectName, body = {}, user = {}) {
  const packet = suppliedDocumentBidTruthReviewPacket(projectName);
  const reviewDecision = String(body.review_decision || body.reviewDecision || '').trim();
  const allowedDecisions = ['accepted_supplied_defaults', 'replaced_temporary_values', 'needs_more_info'];
  if (!allowedDecisions.includes(reviewDecision)) {
    const e = new Error(`review_decision must be one of: ${allowedDecisions.join(', ')}`);
    e.httpStatus = 400;
    throw e;
  }
  const reviewerName = String(body.reviewer_name || body.reviewerName || user.username || '').trim();
  if (!reviewerName) {
    const e = new Error('reviewer_name is required');
    e.httpStatus = 400;
    throw e;
  }
  const replacementRef = String(body.replacement_ref || body.replacementRef || body.source_ref || '').trim();
  if (!replacementRef) {
    const e = new Error('replacement_ref is required');
    e.httpStatus = 400;
    throw e;
  }
  const replacementValues = body.replacement_values && typeof body.replacement_values === 'object' && !Array.isArray(body.replacement_values)
    ? jsonClone(body.replacement_values)
    : {};
  if (!Object.keys(replacementValues).length) {
    const e = new Error('replacement_values must be a non-empty object');
    e.httpStatus = 400;
    throw e;
  }
  const sourceRefs = Array.isArray(body.source_refs)
    ? body.source_refs.map((ref) => String(ref || '').trim()).filter(Boolean)
    : [];
  const replacedFields = Object.keys(replacementValues).filter((field) => field !== 'notes');
  return {
    artifact_type: 'halofire.supplied_document_bid_truth_replacement.v1',
    project_name: projectName,
    source_evidence_type: 'supplied_document_bid_truth',
    source_packet_ref: packet.download_name,
    source_ref: replacementRef,
    source_file: String(body.source_file || body.sourceFile || packet.project_truth?.source_file || 'supplied-document-bid-truth-review.json').trim(),
    review_decision: reviewDecision,
    reviewer_name: reviewerName,
    reviewed_at: body.reviewed_at || body.reviewedAt || new Date().toISOString(),
    replacement_ref: replacementRef,
    replacement_values: replacementValues,
    replaced_fields: replacedFields,
    source_refs: sourceRefs,
    notes: body.notes || null,
    acceptable_evidence: packet.acceptable_evidence,
    temporary_value_policy: packet.temporary_value_policy,
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    blocked_claims: packet.blocked_claims,
    limitations: [
      'Employee supplied-bid-truth replacements are internal-alpha value corrections only.',
      'This evidence does not clear professional, AHJ, manufacturer, engineering-grade, AutoSprink parity, permit-ready, or fabrication-ready claims.',
    ],
  };
}

function suppliedDocumentBidTruthResolverQueueItem(projectName) {
  const status = buildSuppliedDocumentBidTruthStatus(path.resolve(__dirname, '../..'), projectName);
  const projectTruth = status.project_truth || null;
  const latestReplacement = latestSuppliedDocumentBidTruthReplacementEvidence(projectName);
  const replacementSummary = latestReplacement?.replacement || null;
  const rowStatus = replacementSummary ? 'employee_replacement_recorded' : status.status;
  return {
    id: `resolver:supplied-document-bid-truth:${slugForDownloadName(projectName)}`,
    project_name: projectName,
    kind: 'supplied_document_bid_truth',
    title: 'Supplied document bid-truth defaults for SAM31/LLM review',
    artifact_type: status.artifact_type,
    status: rowStatus,
    source_evidence_type: 'supplied_document_bid_truth',
    source_ref: projectTruth?.source_file || 'supplied-halo-fire-documents',
    next_action:
      'Review the supplied document bid-truth defaults, replace any best guesses with employee-confirmed source refs, and keep professional/AHJ/manufacturer/AutoSprink claims blocked until real evidence is uploaded.',
    acceptable_evidence: Array.isArray(status.acceptable_evidence) ? status.acceptable_evidence : [],
    ai_fallback:
      'Use the SAM31+LLM OpenClaw tool to see, identify, vectorize, and extrapolate from source documents; AI may create review artifacts and temporary values but cannot clear regulated claims.',
    input_defaults: {
      artifact_type: status.artifact_type,
      project_truth: projectTruth,
      cross_project_truth: Array.isArray(status.cross_project_truth) ? status.cross_project_truth : [],
      pricebook_sources: Array.isArray(status.pricebook_sources) ? status.pricebook_sources : [],
      source_document_counts: status.source_document_counts || {},
      employee_next_actions: Array.isArray(status.employee_next_actions) ? status.employee_next_actions : [],
    },
    latest_supplied_document_bid_truth_replacement: replacementSummary,
    temporary_value_policy: status.temporary_value_policy || 'best_guess_until_employee_replaced',
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    blocked_claims: Array.isArray(status.blocked_claims) ? status.blocked_claims : [],
    limitations: Array.isArray(status.limitations) ? status.limitations : [],
    actions: [
      { label: 'Review supplied bid-truth defaults', href: `/workbench.html?project=${encodeURIComponent(projectName)}#supplied-document-bid-truth` },
      { label: 'Download supplied bid-truth review packet', href: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/supplied-document-bid-truth/review-packet`, artifact_type: 'halofire.supplied_document_bid_truth_review_packet.v1' },
      { label: 'Download SAM31 tool contract', href: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/openclaw/sam31/tool-contract`, artifact_type: 'openclaw.sam31_llm_extrapolation_tool_contract_packet.v1' },
      { label: 'Open source documents settings', href: '/settings.html#settingsCatalogSourceAcquisition' },
    ],
  };
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

function catalogApprovalPacketRows(projectName, row) {
  if (!row || !row.family_ref) return [];
  ensureProjectClaimGates(projectName);
  const uploadRoute = `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/catalog-source/${encodeURIComponent(row.family_ref)}/approval-validation`;
  const rows = [];
  for (const [approvalRefField, rule] of Object.entries(CATALOG_APPROVAL_VALIDATION_RULES)) {
    for (const [targetGateCode, evidenceType] of Object.entries(rule.targetGates || {})) {
      const detail = CATALOG_APPROVAL_PACKET_DETAILS[evidenceType] || CATALOG_APPROVAL_PACKET_DETAILS.manufacturer_approval;
      const query = new URLSearchParams({
        approval_ref_field: approvalRefField,
        target_gate_code: targetGateCode,
      });
      const gate = db
        .prepare('SELECT status, resolved_by, resolved_at, resolved_evidence_ref FROM claim_gates WHERE project_name = ? AND code = ?')
        .get(projectName, targetGateCode);
      rows.push({
        artifact_type: 'halofire.catalog_approval_resolver_packet.v1',
        status: 'ready_for_signed_evidence_upload',
        project_name: projectName,
        family_ref: row.family_ref,
        component_key: row.component_key || null,
        approval_ref_field: approvalRefField,
        target_gate_code: targetGateCode,
        required_evidence_type: evidenceType,
        download_href: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/catalog-source/${encodeURIComponent(row.family_ref)}/approval-packet?${query.toString()}`,
        upload_route: uploadRoute,
        acceptable_evidence: Array.from(detail.acceptableEvidence || []),
        blocked_claims: Array.from(detail.blockedClaims || []),
        next_action: detail.nextAction,
        claim_gate_effect: 'no_claims_cleared',
        use_for_claims: false,
        no_claim_gates_cleared: true,
        latest_gate_status: gate?.status || 'blocked',
        latest_resolved_by: gate?.resolved_by || null,
        latest_resolved_at: gate?.resolved_at || null,
        latest_resolved_evidence_ref: gate?.resolved_evidence_ref || null,
        limitations: [
          'This approval packet row is a resolver next action and download affordance only.',
          'Downloading this packet does not clear permit-ready, AHJ-ready, professional, manufacturer, fabrication, engineering-grade, or AutoSprink parity claims.',
        ],
      });
    }
  }
  return rows;
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
    catalog_approval_packet_rows: catalogApprovalPacketRows(projectName, row),
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
      { label: 'Download catalog source evidence packet', href: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/catalog-source/${encodeURIComponent(row.family_ref)}/review-packet`, artifact_type: 'halofire.catalog_source_evidence_packet.v1' },
      { label: 'Open evidence workbench', href: `/workbench.html?project=${encodeURIComponent(projectName)}#catalogSourceAcquisition` },
    ],
  };
}

function catalogSourceEvidencePacket(projectName, familyRef) {
  const row = currentSourceAcquisitionLedger().find((entry) => entry && entry.family_ref === familyRef);
  if (!row) return null;
  const matchedEvidence = matchingCatalogEvidenceByFamily(projectName).get(familyRef) || null;
  const notes = matchedEvidence?.notes || {};
  const evidenceRow = matchedEvidence?.evidence || null;
  const queueItem = catalogResolverQueueItem(projectName, row, matchedEvidence);
  const sourceRefs = [];
  if (evidenceRow) {
    sourceRefs.push({
      evidence_id: evidenceRow.id,
      evidence_type: evidenceRow.evidence_type,
      source_ref: evidenceRow.source_ref || null,
      source_file: evidenceRow.source_file || null,
      status: evidenceRow.status || null,
    });
  }
  const sourceUrl = notes.source_url || row.source_url || null;
  const downloadedArtifactHash = notes.downloaded_artifact_hash || row.downloaded_artifact_hash || null;
  const license = notes.license || row.license || null;
  const statusTier = notes.status_tier || row.status_tier || 'missing_catalog_source';
  const blockedClaims = Array.isArray(row.blocked_claims) && row.blocked_claims.length
    ? row.blocked_claims
    : ['manufacturer_exact', 'AutoSprink_parity', 'fabrication_ready', 'permit_ready', 'AHJ_approval', 'PE_review'];
  return {
    artifact_type: 'halofire.catalog_source_evidence_packet.v1',
    status: 'ready_for_employee_review',
    project_name: projectName,
    family_ref: row.family_ref,
    component_key: row.component_key || null,
    description: row.description || null,
    nominal_size_in: row.nominal_size_in ?? null,
    source_evidence_type: 'catalog_source_acquisition',
    source_ref: sourceUrl || row.family_ref,
    generated_at: new Date().toISOString(),
    download_name: `${slugForDownloadName(projectName)}-catalog-source-evidence-packet-${slugForDownloadName(row.family_ref)}.json`,
    source_url: sourceUrl,
    license,
    downloaded_artifact_hash: downloadedArtifactHash,
    rejected_candidates: Array.isArray(row.rejected_candidates) ? row.rejected_candidates : [],
    status_tier: statusTier,
    manufacturer_exact: false,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    claim_gate_effect_description: 'This is a review artifact only; recording or downloading it clears no manufacturer, AHJ, PE, AutoSprink, permit-ready, fabrication-ready, or engineering-grade claim.',
    latest_catalog_source_acquisition: evidenceRow ? {
      evidence_id: evidenceRow.id,
      evidence_status: evidenceRow.status,
      source_ref: evidenceRow.source_ref || null,
      source_file: evidenceRow.source_file || null,
      family_ref: notes.family_ref || row.family_ref,
      component_key: notes.component_key || row.component_key || null,
      nominal_size_in: notes.nominal_size_in ?? row.nominal_size_in ?? null,
      source_url: notes.source_url || sourceUrl,
      license: notes.license || license,
      downloaded_artifact_hash: notes.downloaded_artifact_hash || downloadedArtifactHash,
      status_tier: notes.status_tier || statusTier,
      manufacturer_exact: false,
      claim_gate_effect: notes.claim_gate_effect || 'no_claims_cleared',
      no_claim_gates_cleared: notes.no_claim_gates_cleared !== false,
    } : null,
    source_refs: sourceRefs,
    acceptable_evidence: queueItem?.acceptable_evidence || [
      'manufacturer catalog page or vendor product page URL',
      'license or terms for downloaded CAD/BIM/STEP artifact',
      'downloaded artifact hash tied to the exact component family',
      'HaloFire employee review note for internal-alpha use',
      'manufacturer/professional approval before manufacturer-exact or fabrication claims',
    ],
    employee_decision_fields: [
      'reviewer_name',
      'verified_source_url',
      'verified_license_or_terms_ref',
      'downloaded_artifact_hash',
      'rejected_candidate_notes',
      'manufacturer_model_approval_ref',
      'professional_or_ahj_review_ref',
      'autosprink_or_equivalent_export_ref',
      'review_decision',
      'notes',
    ],
    evidence_attachment_fields: [
      {
        field: 'manufacturer_model_approval_ref',
        acceptable_evidence_type: 'manufacturer_model_approval_or_exact_catalog_part_match',
        blocked_claims_relieved_only_after_employee_verification: ['manufacturer_exact', 'fabrication_ready'],
      },
      {
        field: 'professional_or_ahj_review_ref',
        acceptable_evidence_type: 'licensed_professional_or_AHJ_review',
        blocked_claims_relieved_only_after_employee_verification: ['PE_review', 'AHJ_approval', 'permit_ready', 'engineering_grade'],
      },
      {
        field: 'autosprink_or_equivalent_export_ref',
        acceptable_evidence_type: 'AutoSprink_or_equivalent_professional_model_export',
        blocked_claims_relieved_only_after_employee_verification: ['AutoSprink_parity'],
      },
    ],
    review_steps: [
      'Open the vendor/manufacturer/catalog source URL and confirm it describes the exact component family.',
      'Verify license or terms and record a downloaded artifact hash when CAD/BIM/STEP content is used.',
      'Reject unrelated or generated-only candidates with a source-linked reason.',
      'Attach manufacturer, professional, AHJ, or AutoSprink/equivalent evidence through the correct resolver before any regulated claim is unblocked.',
    ],
    ai_fallback: queueItem?.ai_fallback ||
      'Use OpenClaw web search, vendor catalog search, and step.parts-style acquisition to find candidates; AI may rank/reject candidates but cannot clear manufacturer/AHJ/PE/AutoSprink claims.',
    blocked_claims: blockedClaims,
    limitations: [
      row.limitations || 'Catalog/source acquisition rows are evidence collection work items only.',
      'The packet can organize candidate source facts and employee review defaults, but it does not prove manufacturer-exact geometry, AHJ approval, PE review, AutoSprink parity, permit readiness, fabrication readiness, or engineering-grade results.',
    ],
  };
}

const CATALOG_APPROVAL_VALIDATION_RULES = Object.freeze({
  manufacturer_model_approval_ref: Object.freeze({
    targetGates: Object.freeze({
      MANUFACTURER_MODEL_APPROVAL_MISSING: 'manufacturer_approval',
    }),
  }),
  professional_or_ahj_review_ref: Object.freeze({
    targetGates: Object.freeze({
      PROFESSIONAL_REVIEW_MISSING: 'professional_review',
      AHJ_APPROVAL_MISSING: 'ahj_approval',
    }),
  }),
  autosprink_or_equivalent_export_ref: Object.freeze({
    targetGates: Object.freeze({
      AUTOSPRINK_EVIDENCE_MISSING: 'autosprink_packet',
    }),
  }),
});

const CATALOG_APPROVAL_PACKET_DETAILS = Object.freeze({
  manufacturer_approval: Object.freeze({
    slug: 'manufacturer-model',
    acceptableEvidence: Object.freeze([
      'signed manufacturer model approval',
      'manufacturer catalog page or exact part/model approval reference',
      'reviewer license or authority reference when available',
    ]),
    blockedClaims: Object.freeze(['manufacturer_exact', 'fabrication_ready']),
    nextAction: 'Upload signed manufacturer model approval evidence for this exact catalog family.',
  }),
  professional_review: Object.freeze({
    slug: 'professional-review',
    acceptableEvidence: Object.freeze([
      'signed licensed professional review package',
      'reviewer license or authority reference when available',
      'source-linked calculation/export packet',
    ]),
    blockedClaims: Object.freeze(['permit_ready', 'engineering_grade', 'professionally_approved', 'PE_review']),
    nextAction: 'Upload signed professional review evidence before claiming engineering-grade, professional, permit, or fabrication readiness.',
  }),
  ahj_approval: Object.freeze({
    slug: 'ahj-approval',
    acceptableEvidence: Object.freeze([
      'signed AHJ approval or review response',
      'AHJ jurisdiction/contact reference',
      'source-linked submittal or response packet',
    ]),
    blockedClaims: Object.freeze(['permit_ready', 'AHJ_ready', 'AHJ_approval']),
    nextAction: 'Upload signed AHJ approval or review response before claiming AHJ-ready or permit-ready status.',
  }),
  autosprink_packet: Object.freeze({
    slug: 'autosprink',
    acceptableEvidence: Object.freeze([
      'AutoSprink or equivalent model export',
      'source-linked calculation/export packet',
      'reviewer signoff tying the export to this HaloFire catalog family',
    ]),
    blockedClaims: Object.freeze(['AutoSprink_parity']),
    nextAction: 'Upload signed AutoSprink/equivalent export evidence before claiming AutoSprink parity.',
  }),
});

function catalogApprovalValidationSpec(body) {
  const approvalRefField = String(body?.approval_ref_field || '').trim();
  const rule = CATALOG_APPROVAL_VALIDATION_RULES[approvalRefField];
  if (!rule) {
    const e = new Error('approval_ref_field must be one of manufacturer_model_approval_ref, professional_or_ahj_review_ref, autosprink_or_equivalent_export_ref');
    e.httpStatus = 400;
    throw e;
  }
  const allowedGateCodes = Object.keys(rule.targetGates);
  const requestedGateCode = String(body?.target_gate_code || allowedGateCodes[0] || '').trim();
  const evidenceType = rule.targetGates[requestedGateCode];
  if (!evidenceType) {
    const e = new Error(`approval_ref_field ${approvalRefField} only supports target_gate_code: ${allowedGateCodes.join(', ')}`);
    e.httpStatus = 400;
    throw e;
  }
  return { approvalRefField, targetGateCode: requestedGateCode, evidenceType };
}

function catalogApprovalResolverPacket(projectName, familyRef, body) {
  const row = currentSourceAcquisitionLedger().find((entry) => entry && entry.family_ref === familyRef);
  if (!row) {
    const e = new Error('Catalog source acquisition row not found');
    e.httpStatus = 404;
    throw e;
  }
  const { approvalRefField, targetGateCode, evidenceType } = catalogApprovalValidationSpec(body);
  ensureProjectClaimGates(projectName);
  const gate = db
    .prepare('SELECT * FROM claim_gates WHERE project_name = ? AND code = ?')
    .get(projectName, targetGateCode);
  if (!gate) {
    const e = new Error(`Claim gate ${targetGateCode} is not configured for ${projectName}`);
    e.httpStatus = 404;
    throw e;
  }
  const matchedEvidence = matchingCatalogEvidenceByFamily(projectName).get(familyRef) || null;
  const sourcePacket = catalogSourceEvidencePacket(projectName, familyRef);
  const detail = CATALOG_APPROVAL_PACKET_DETAILS[evidenceType] || CATALOG_APPROVAL_PACKET_DETAILS.manufacturer_approval;
  const sourceRefs = [];
  if (sourcePacket) {
    sourceRefs.push({
      artifact_type: sourcePacket.artifact_type,
      source_ref: sourcePacket.source_ref,
      claim_gate_effect: sourcePacket.claim_gate_effect,
    });
  }
  if (matchedEvidence?.evidence) {
    sourceRefs.push({
      evidence_id: matchedEvidence.evidence.id,
      evidence_type: matchedEvidence.evidence.evidence_type,
      source_ref: matchedEvidence.evidence.source_ref || null,
      status: matchedEvidence.evidence.status || null,
    });
  }
  return {
    artifact_type: 'halofire.catalog_approval_resolver_packet.v1',
    status: 'ready_for_signed_evidence_upload',
    project_name: projectName,
    family_ref: row.family_ref,
    component_key: row.component_key || null,
    description: row.description || null,
    generated_at: new Date().toISOString(),
    download_name: `${slugForDownloadName(projectName)}-catalog-approval-${detail.slug}-packet-${slugForDownloadName(row.family_ref)}.json`,
    approval_ref_field: approvalRefField,
    target_gate_code: targetGateCode,
    required_evidence_type: evidenceType,
    upload_route: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/catalog-source/${encodeURIComponent(familyRef)}/approval-validation`,
    required_upload_body: {
      approval_ref_field: approvalRefField,
      target_gate_code: targetGateCode,
      source_ref: '<signed evidence source ref>',
      source_file: '<signed evidence file or URL>',
      signoff: {
        reviewer_name: '<required>',
        reviewer_title: '<required>',
        signed_at: '<ISO-8601 required>',
        organization: '<optional>',
        license_id: '<optional but preferred>',
      },
    },
    required_signoff_fields: ['reviewer_name', 'reviewer_title', 'signed_at'],
    optional_signoff_fields: ['organization', 'license_id'],
    acceptable_evidence: [...detail.acceptableEvidence],
    source_refs: sourceRefs,
    source_catalog_packet: sourcePacket ? {
      artifact_type: sourcePacket.artifact_type,
      family_ref: sourcePacket.family_ref,
      source_ref: sourcePacket.source_ref,
      latest_catalog_source_acquisition: sourcePacket.latest_catalog_source_acquisition,
      claim_gate_effect: sourcePacket.claim_gate_effect,
    } : null,
    claim_gate: {
      code: gate.code,
      status: gate.status,
      missing_artifact: gate.missing_artifact,
      acceptable_evidence: gate.acceptable_evidence,
      blocked_claims: safeParseJsonArray(gate.blocked_claims),
      next_action: gate.next_action,
    },
    next_action: detail.nextAction,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    blocked_claims: uniqueStrings([...detail.blockedClaims, ...safeParseJsonArray(gate.blocked_claims)]),
    limitations: [
      'This packet organizes the exact signed-evidence upload lane only; downloading it does not clear any claim gate.',
      'SAM/OpenClaw observations, catalog evidence, and AI extrapolations remain review support until the required signed evidence is uploaded and validated.',
      'Do not claim permit-ready, fabrication-ready, AHJ-ready, engineering-grade, professionally approved, or AutoSprink parity from this packet alone.',
    ],
  };
}

function validateCatalogSourceApproval(projectName, familyRef, body, user) {
  const row = currentSourceAcquisitionLedger().find((entry) => entry && entry.family_ref === familyRef);
  if (!row) {
    const e = new Error('Catalog source acquisition row not found');
    e.httpStatus = 404;
    throw e;
  }
  const { approvalRefField, targetGateCode, evidenceType } = catalogApprovalValidationSpec(body);
  ensureProjectClaimGates(projectName);
  const gate = db
    .prepare('SELECT * FROM claim_gates WHERE project_name = ? AND code = ?')
    .get(projectName, targetGateCode);
  if (!gate) {
    const e = new Error('Claim gate not found');
    e.httpStatus = 404;
    throw e;
  }
  const gateRule = gateEvidenceRule(targetGateCode);
  if (!gateRule.canResolve || !gateRule.allowedEvidenceTypes.includes(evidenceType)) {
    const e = new Error(`Gate ${targetGateCode} only accepts allowed evidence types: ${gateRule.allowedEvidenceTypes.join(', ')}`);
    e.httpStatus = 400;
    throw e;
  }
  const sourceRef = String(body?.source_ref || '').trim();
  if (!sourceRef) {
    const e = new Error('source_ref is required for catalog approval validation');
    e.httpStatus = 400;
    throw e;
  }
  const signoff = normalizeSignedReviewerSignoff(evidenceType, body?.signoff);
  const sourceFile = body?.source_file == null ? null : String(body.source_file);
  const resolvedAt = new Date().toISOString();
  const evidenceNotes = {
    kind: 'catalog_source_approval_validation',
    evidence_type: evidenceType,
    family_ref: row.family_ref,
    component_key: row.component_key || null,
    nominal_size_in: row.nominal_size_in ?? null,
    approval_ref_field: approvalRefField,
    target_gate_code: targetGateCode,
    source_ref: sourceRef,
    source_catalog_ref: body?.source_catalog_ref || row.source_url || row.family_ref,
    signoff,
    user_notes: body?.notes || null,
    claim_gate_effect: 'gate_cleared_after_explicit_signed_validation',
  };
  const tx = db.transaction(() => {
    const insert = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, 'present', ?)`)
      .run(projectName, evidenceType, sourceFile, sourceRef, JSON.stringify(evidenceNotes));
    db.prepare(`UPDATE claim_gates
                SET status = 'cleared', resolved_by = ?, resolved_at = ?, resolved_evidence_ref = ?
                WHERE project_name = ? AND code = ?`)
      .run(user?.username || 'unknown', resolvedAt, sourceRef, projectName, targetGateCode);
    return insert.lastInsertRowid;
  });
  const evidenceId = tx();
  const evidence = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(evidenceId);
  return {
    cleared: true,
    code: targetGateCode,
    approval_ref_field: approvalRefField,
    family_ref: row.family_ref,
    component_key: row.component_key || null,
    resolved_by: user?.username || 'unknown',
    resolved_at: resolvedAt,
    resolved_evidence_id: evidenceId,
    resolved_evidence_ref: sourceRef,
    evidence,
    evidence_notes: evidenceNotes,
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
    employee_decision: decision.employeeDecision || null,
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
    sectioning_pipeline_contract: perceptionPacket.sectioning_pipeline_contract,
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

function normalizeOpenClawSam31SectioningPipelineContractReview(projectName, evidence, decision, extrapolationEvidence, extrapolationArtifact, body = {}, user = {}) {
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
  const sectioningPipelineContract = extrapolationArtifact.sectioning_pipeline_contract && typeof extrapolationArtifact.sectioning_pipeline_contract === 'object'
    ? {
      ...jsonClone(sam31SectioningPipelineContract(extrapolationArtifact.source_runtime || 'sam-3.1+llm')),
      ...jsonClone(extrapolationArtifact.sectioning_pipeline_contract),
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: 'no_claims_cleared',
    }
    : {
      ...jsonClone(localOpenClawSam31ToolDescriptor(projectName).sectioning_pipeline_contract),
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: 'no_claims_cleared',
    };
  const reviewDecision = String(body.review_decision || 'replaced').trim();
  if (!['accepted', 'replaced', 'rejected'].includes(reviewDecision)) {
    const e = new Error('review_decision must be one of: accepted, replaced, rejected');
    e.httpStatus = 400;
    throw e;
  }
  const replacementRef = String(body.replacement_ref || body.source_ref || '').trim();
  if (!replacementRef) {
    const e = new Error('replacement_ref is required for OpenClaw SAM31 sectioning contract review evidence');
    e.httpStatus = 400;
    throw e;
  }
  const rawValues = body.replacement_values;
  if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) {
    const e = new Error('replacement_values must be an object');
    e.httpStatus = 400;
    throw e;
  }
  const unknownFields = Object.keys(rawValues).filter((field) => !SAM31_SECTIONING_PIPELINE_CONTRACT_REVIEW_FIELDS.includes(field));
  if (unknownFields.length) {
    const e = new Error(`Unsupported OpenClaw SAM31 sectioning contract review fields: ${unknownFields.join(', ')}`);
    e.httpStatus = 400;
    throw e;
  }
  const replacementValues = {};
  for (const field of SAM31_SECTIONING_PIPELINE_CONTRACT_REVIEW_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rawValues, field)) {
      replacementValues[field] = jsonClone(rawValues[field]);
    }
  }
  for (const field of ['semantic_labels', 'polygons', 'bboxes', 'object_hypotheses', 'vector_overlays', 'model_3d_candidates']) {
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
    const e = new Error('replacement_values must include at least one supported OpenClaw SAM31 sectioning contract review field');
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
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_id: extrapolationEvidence.id,
      evidence_type: extrapolationEvidence.evidence_type,
      source_ref: extrapolationEvidence.source_ref || extrapolationArtifact.openclaw_endpoint || null,
      status: extrapolationEvidence.status,
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_type: 'openclaw.sam31.sectioning_pipeline_contract.v1',
      source_ref: sectioningPipelineContract.contract_ref || 'openclaw.sam31.sectioning_pipeline_contract.v1',
      status: sectioningPipelineContract.status || 'best_effort_contract_ready',
      claim_gate_effect: 'no_claims_cleared',
    },
    {
      evidence_type: 'employee_sam31_sectioning_contract_review_payload',
      source_ref: replacementRef,
      status: 'present',
      claim_gate_effect: 'no_claims_cleared',
    },
  ];
  return {
    artifact_type: 'openclaw.sam31.sectioning_pipeline_contract_review.v1',
    status: 'present',
    project_name: projectName,
    source_pdf_boundary_evidence_id: evidence.id,
    source_evidence_type: evidence.evidence_type,
    source_openclaw_sam31_extrapolation_evidence_id: extrapolationEvidence.id,
    source_openclaw_sam31_extrapolation_ref: extrapolationEvidence.source_ref || extrapolationArtifact.openclaw_endpoint || null,
    source_sectioning_pipeline_contract_artifact_type: sectioningPipelineContract.artifact_type || 'openclaw.sam31.sectioning_pipeline_contract.v1',
    source_sectioning_pipeline_contract: sectioningPipelineContract,
    source_ref: evidence.source_ref || decision.sourceRef || null,
    source_file: evidence.source_file || decision.sourceFile || null,
    source_runtime: sectioningPipelineContract.source_runtime || extrapolationArtifact.source_runtime || 'sam-3.1+llm',
    review_decision: reviewDecision,
    reviewer_name: String(body.reviewer_name || user.name || user.username || '').trim() || null,
    reviewed_at: new Date().toISOString(),
    replacement_ref: replacementRef,
    replacement_values: replacementValues,
    replaced_fields: replacedFields,
    notes: String(body.notes || '').trim() || null,
    source_refs: sourceRefs,
    supported_applications: [...SAM31_SUPPORTED_APPLICATIONS],
    supported_evidence_lanes: [
      'sam31_sectioning',
      'llm_object_identification',
      'vector_overlay_generation',
      'model_3d_candidate_generation',
      'product_review_queue',
    ],
    temporary_value_policy: 'best_guess_until_employee_replaced',
    acceptable_evidence: [
      'employee reviewed semantic label replacements',
      'employee reviewed polygon or bbox replacements',
      'employee reviewed vector overlay replacements',
      'employee reviewed 3D candidate references',
      'source-linked screenshot or console evidence for reviewed sectioning',
    ],
    blocked_claims: uniqueStrings([
      ...(Array.isArray(extrapolationArtifact.blocked_claims) ? extrapolationArtifact.blocked_claims : []),
      ...(Array.isArray(decision.blockedClaims) ? decision.blockedClaims : PDF_BOUNDARY_BLOCKED_CLAIMS),
      ...SAM31_BLOCKED_CLAIMS,
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
    ]),
    use_for_claims: false,
    no_claim_gates_cleared: true,
    claim_gate_effect: 'no_claims_cleared',
    limitations: [
      'Employee SAM31 sectioning contract reviews replace temporary sectioning outputs for internal-alpha product review only.',
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
  for (const field of ['semantic_labels', 'object_hypotheses', 'llm_observations', 'vector_overlays', 'model_3d_candidates']) {
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

function pdfBoundaryReplayInputPacket(projectName, evidence, decision, reviewEvidence, sam31Evidence = null, sam31ReplacementEvidence = null, sam31ExtrapolationEvidence = null, sam31ExtrapolationReviewEvidence = null, sam31SectioningDownstreamPacketEvidence = null) {
  if (!evidence || !decision) return null;
  const employeeDecision = decision.employeeDecision && typeof decision.employeeDecision === 'object'
    ? jsonClone(decision.employeeDecision)
    : null;
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
  const halofireSam31SectioningDownstreamResolverPacket = halofireSam31SectioningDownstreamResolverPacketSummary(sam31SectioningDownstreamPacketEvidence);
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
  if (employeeDecision) {
    sourceRefs.push({
      evidence_id: evidence.id,
      evidence_type: employeeDecision.artifact_type || 'halofire.pdf_boundary_employee_decision.v1',
      selected_sheet_ref: employeeDecision.selected_sheet_ref || null,
      selected_scale_ref: employeeDecision.selected_scale_ref || null,
      selected_boundary_candidate_ref: employeeDecision.selected_boundary_candidate_ref || null,
      source_ref: employeeDecision.source_ref || evidence.source_ref || decision.sourceRef || null,
      source_refs: Array.isArray(employeeDecision.source_refs) ? [...employeeDecision.source_refs] : [],
      status: employeeDecision.status || 'employee_selected_internal_alpha',
      claim_gate_effect: employeeDecision.claim_gate_effect || 'no_claims_cleared',
      use_for_claims: false,
    });
  }
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
  if (halofireSam31SectioningDownstreamResolverPacket) {
    sourceRefs.push({
      evidence_id: halofireSam31SectioningDownstreamResolverPacket.evidence_id,
      evidence_type: 'halofire_sam31_sectioning_downstream_resolver_packet',
      artifact_type: halofireSam31SectioningDownstreamResolverPacket.artifact_type,
      source_ref: halofireSam31SectioningDownstreamResolverPacket.source_ref || null,
      status: halofireSam31SectioningDownstreamResolverPacket.evidence_status || 'best_effort',
      claim_gate_effect: halofireSam31SectioningDownstreamResolverPacket.claim_gate_effect || 'no_claims_cleared',
    });
  }
  const floorPlanOverride = buildRoomBoundaryFloorPlanOverride(
    projectName,
    reviewSource,
    evidence,
    reviewRow,
    replayRoomPolygons,
    sourceRefs,
  );
  const replayOverrideRoomPolygons = annotateRoomBoundaryFloorPlanOverridePolygons(replayRoomPolygons, floorPlanOverride);
  const replayBlockedClaims = uniqueStrings([
    ...(Array.isArray(queueItem.blocked_claims) ? queueItem.blocked_claims : []),
    ...(Array.isArray(review.blocked_claims) ? review.blocked_claims : []),
    ...(Array.isArray(floorPlanOverride.blocked_claims) ? floorPlanOverride.blocked_claims : []),
    ...(Array.isArray(openclawSam31BridgeSmokeSummary?.blocked_claims) ? openclawSam31BridgeSmokeSummary.blocked_claims : []),
    ...(Array.isArray(openclawSam31ExtrapolationProductReviewMetadata?.blocked_claims) ? openclawSam31ExtrapolationProductReviewMetadata.blocked_claims : []),
    ...(Array.isArray(halofireSam31SectioningDownstreamResolverPacket?.blocked_claims) ? halofireSam31SectioningDownstreamResolverPacket.blocked_claims : []),
  ]);
  const sprinklerBidRequest = {
    room_boundary_source: reviewSource,
    source_evidence_id: evidence.id,
    pdfPageIndex: decision.pageIndex,
    pdfScale: decision.scale,
    pdfExtract: decision.extractMode,
    corrected_room_polygons: replayOverrideRoomPolygons,
    floor_plan_override: floorPlanOverride,
    employee_decision: employeeDecision,
    source_refs: sourceRefs,
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
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
  if (halofireSam31SectioningDownstreamResolverPacket) {
    sprinklerBidRequest.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id = halofireSam31SectioningDownstreamResolverPacket.evidence_id;
    sprinklerBidRequest.halofire_sam31_sectioning_downstream_resolver_packet = halofireSam31SectioningDownstreamResolverPacket;
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
    ...(halofireSam31SectioningDownstreamResolverPacket
      ? {
        source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: halofireSam31SectioningDownstreamResolverPacket.evidence_id,
        halofire_sam31_sectioning_downstream_resolver_packet: halofireSam31SectioningDownstreamResolverPacket,
      }
      : {}),
    source_ref: evidence.source_ref || decision.sourceRef || null,
    source_file: evidence.source_file || decision.sourceFile || null,
    employee_decision: employeeDecision,
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
    corrected_room_polygons: replayOverrideRoomPolygons,
    floor_plan_override: floorPlanOverride,
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

function pdfBoundaryFloorPlanOverrideActionPacket(projectName, replayPacket) {
  if (!replayPacket || !replayPacket.floor_plan_override || !replayPacket.sprinkler_bid_request) {
    return null;
  }
  const sourceEvidenceId = replayPacket.source_evidence_id || replayPacket.floor_plan_override.source_evidence_id || null;
  return {
    artifact_type: 'halofire.room_boundary_floor_plan_override_action_packet.v1',
    status: 'ready_for_internal_alpha_replay',
    project_name: projectName,
    generated_at: new Date().toISOString(),
    method: 'POST',
    action_href: `/api/projects/${encodeURIComponent(projectName)}/sprinkler-bid`,
    download_name: `${slugForDownloadName(projectName)}-floor-plan-override-action-${sourceEvidenceId || 'boundary'}.json`,
    source_evidence_id: sourceEvidenceId,
    source_review_evidence_id: replayPacket.source_review_evidence_id || replayPacket.floor_plan_override.source_review_evidence_id || null,
    source_sam31_evidence_id: replayPacket.source_sam31_evidence_id || replayPacket.floor_plan_override.source_sam31_evidence_id || null,
    floor_plan_override_source: replayPacket.floor_plan_override.room_boundary_source || replayPacket.review_source || null,
    floor_plan_override: replayPacket.floor_plan_override,
    request_body: {
      markupPct: 25,
      ...jsonClone(replayPacket.sprinkler_bid_request),
    },
    source_refs: Array.isArray(replayPacket.source_refs) ? jsonClone(replayPacket.source_refs) : [],
    blocked_claims: Array.isArray(replayPacket.blocked_claims)
      ? jsonClone(replayPacket.blocked_claims)
      : jsonClone(replayPacket.floor_plan_override.blocked_claims || []),
    acceptable_evidence: [
      'employee room-boundary review packet',
      'OpenClaw SAM31+LLM visual audit evidence',
      'source-linked corrected room polygon list',
      'licensed professional/AHJ/manufacturer/AutoSprink evidence for regulated claims',
    ],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    no_claim_gates_cleared: true,
    limitations: [
      'This action packet is a readback of the internal-alpha replay POST body only.',
      'It does not clear geometry accuracy, drawing scale, AHJ approval, professional approval, AutoSprink parity, permit readiness, fabrication readiness, or engineering-grade output.',
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
  const sourceHalofireSam31SectioningDownstreamPacketEvidenceId = Number(req.body.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id);
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
  const sourceHalofireSam31SectioningDownstreamPacketEvidence = Number.isSafeInteger(sourceHalofireSam31SectioningDownstreamPacketEvidenceId)
    && sourceHalofireSam31SectioningDownstreamPacketEvidenceId > 0
    ? db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'halofire_sam31_sectioning_downstream_resolver_packet'`)
      .get(sourceHalofireSam31SectioningDownstreamPacketEvidenceId, projectName)
    : null;
  const sourceReview = replaySource === 'latest_employee_review_packet'
    ? reviewFromEvidence(sourceReviewEvidence)
    : sam31VisualAuditResultFromEvidence(sourceReviewEvidence);
  const sourceDecision = decisionFromEvidence(sourceEvidence);
  const employeeDecision = sourceDecision?.employeeDecision && typeof sourceDecision.employeeDecision === 'object'
    ? jsonClone(sourceDecision.employeeDecision)
    : (req.body.employee_decision && typeof req.body.employee_decision === 'object' && !Array.isArray(req.body.employee_decision)
      ? jsonClone(req.body.employee_decision)
      : null);
  const sourceSam31Replacement = sam31EmployeeReplacementFromEvidence(sourceSam31ReplacementEvidence);
  const sourceSam31ExtrapolationArtifact = openClawSam31ExtrapolationArtifactFromEvidence(sourceSam31ExtrapolationEvidence);
  const sourceSam31ExtrapolationReview = openClawSam31ExtrapolationReviewFromEvidence(sourceSam31ExtrapolationReviewEvidence);
  const sourceHalofireSam31SectioningDownstreamPacket = halofireSam31SectioningDownstreamResolverPacketFromEvidence(sourceHalofireSam31SectioningDownstreamPacketEvidence);
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
  if (Number.isSafeInteger(sourceHalofireSam31SectioningDownstreamPacketEvidenceId) && sourceHalofireSam31SectioningDownstreamPacketEvidenceId > 0) {
    if (
      !sourceHalofireSam31SectioningDownstreamPacket ||
      Number(sourceHalofireSam31SectioningDownstreamPacket.source_pdf_boundary_evidence_id) !== Number(sourceEvidenceId)
    ) {
      const e = new Error('Replay input source evidence does not match a saved HaloFire SAM31 sectioning downstream resolver packet');
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
  if (employeeDecision) {
    sourceRefs.push({
      evidence_id: sourceEvidence.id,
      evidence_type: employeeDecision.artifact_type || 'halofire.pdf_boundary_employee_decision.v1',
      selected_sheet_ref: employeeDecision.selected_sheet_ref || null,
      selected_scale_ref: employeeDecision.selected_scale_ref || null,
      selected_boundary_candidate_ref: employeeDecision.selected_boundary_candidate_ref || null,
      source_ref: employeeDecision.source_ref || sourceEvidence.source_ref || null,
      source_refs: Array.isArray(employeeDecision.source_refs) ? [...employeeDecision.source_refs] : [],
      status: employeeDecision.status || 'employee_selected_internal_alpha',
      claim_gate_effect: employeeDecision.claim_gate_effect || 'no_claims_cleared',
      use_for_claims: false,
    });
  }
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
      sourceDecision,
      { evidence: sourceSam31ExtrapolationEvidence, artifact: sourceSam31ExtrapolationArtifact },
      sourceSam31ExtrapolationArtifact,
      { evidence: sourceSam31ExtrapolationReviewEvidence, review: sourceSam31ExtrapolationReview },
      sourceSam31ExtrapolationReview,
    )
    : null;
  const openclawSam31ExtrapolationProductReviewMetadata = openClawSam31ExtrapolationReviewPacketMetadata(openclawSam31ExtrapolationProductReviewPacket);
  const halofireSam31SectioningDownstreamResolverPacket = halofireSam31SectioningDownstreamResolverPacketSummary(
    sourceHalofireSam31SectioningDownstreamPacketEvidence && sourceHalofireSam31SectioningDownstreamPacket
      ? {
        evidence: sourceHalofireSam31SectioningDownstreamPacketEvidence,
        packet: sourceHalofireSam31SectioningDownstreamPacket,
      }
      : null,
  );
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
  if (halofireSam31SectioningDownstreamResolverPacket) {
    sourceRefs.push({
      evidence_id: halofireSam31SectioningDownstreamResolverPacket.evidence_id,
      evidence_type: 'halofire_sam31_sectioning_downstream_resolver_packet',
      artifact_type: halofireSam31SectioningDownstreamResolverPacket.artifact_type,
      source_ref: halofireSam31SectioningDownstreamResolverPacket.source_ref || null,
      status: halofireSam31SectioningDownstreamResolverPacket.evidence_status || 'best_effort',
      claim_gate_effect: halofireSam31SectioningDownstreamResolverPacket.claim_gate_effect || 'no_claims_cleared',
    });
  }
  const floorPlanOverride = buildRoomBoundaryFloorPlanOverride(
    projectName,
    replaySource,
    sourceEvidence,
    sourceReviewEvidence,
    correctedRoomPolygons,
    sourceRefs,
  );
  const replayOverrideRoomPolygons = annotateRoomBoundaryFloorPlanOverridePolygons(correctedRoomPolygons, floorPlanOverride);
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
      ...(halofireSam31SectioningDownstreamResolverPacket
        ? {
          source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: halofireSam31SectioningDownstreamResolverPacket.evidence_id,
          halofire_sam31_sectioning_downstream_resolver_packet: halofireSam31SectioningDownstreamResolverPacket,
        }
        : {}),
      source_ref: sourceEvidence.source_ref || sourceReview.source_ref || null,
      marked_up_plan_ref: sourceReview.marked_up_plan_ref || null,
      employee_decision: employeeDecision,
      corrected_room_polygons: replayOverrideRoomPolygons,
      floor_plan_override: floorPlanOverride,
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
        ...(Array.isArray(floorPlanOverride.blocked_claims) ? floorPlanOverride.blocked_claims : []),
        ...(Array.isArray(openclawSam31ExtrapolationProductReviewMetadata?.blocked_claims) ? openclawSam31ExtrapolationProductReviewMetadata.blocked_claims : []),
        ...(Array.isArray(halofireSam31SectioningDownstreamResolverPacket?.blocked_claims) ? halofireSam31SectioningDownstreamResolverPacket.blocked_claims : []),
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

function sam31ApprovalUploadGateStatusMap(projectName) {
  ensureProjectClaimGates(projectName);
  return new Map(db
    .prepare('SELECT code, status FROM claim_gates WHERE project_name = ?')
    .all(projectName)
    .map((row) => [String(row.code || '').toUpperCase(), String(row.status || 'blocked').toLowerCase()]));
}

function decorateSam31ApprovalUploadValidationRow(row, gateStatusByCode) {
  const targetGateCode = String(row.target_gate_code || halofireSam31ApprovalUploadGateCode(row.target_approval_lane) || '').toUpperCase() || null;
  const gateStatus = targetGateCode ? gateStatusByCode.get(targetGateCode) || 'blocked' : 'blocked';
  const hasUpload = Boolean(row.latest_approval_upload_intake);
  const latestValidationDecision = row.latest_approval_upload_validation_decision
    || row.latest_approval_upload_intake?.latest_approval_upload_validation_decision
    || null;
  let gateValidationStatus = 'approval_upload_missing';
  if (hasUpload && gateStatus === 'cleared') {
    gateValidationStatus = 'gate_cleared';
  } else if (hasUpload && latestValidationDecision?.claim_gate_effect === 'ready_for_explicit_gate_resolve') {
    gateValidationStatus = 'ready_for_explicit_gate_resolve';
  } else if (hasUpload && latestValidationDecision) {
    gateValidationStatus = 'validation_decision_no_claims_cleared';
  } else if (hasUpload) {
    gateValidationStatus = 'pending_gate_validation';
  }
  return {
    ...row,
    target_gate_code: targetGateCode,
    gate_status: gateStatus,
    gate_validation_status: gateValidationStatus,
    latest_approval_upload_validation_decision: latestValidationDecision,
    claim_gate_effect: latestValidationDecision?.claim_gate_effect || row.claim_gate_effect || 'no_claims_cleared',
  };
}

function sam31ApprovalValidationRowMatches(row, filters) {
  if (filters.targetGate && String(row.target_gate_code || '').toUpperCase() !== filters.targetGate) return false;
  if (filters.sam31ApprovalValidation === 'pending') {
    return row.gate_validation_status === 'pending_gate_validation';
  }
  if (
    filters.sam31ApprovalValidation === 'ready'
    || filters.sam31ApprovalValidation === 'ready_for_gate_resolve'
    || filters.sam31ApprovalValidation === 'ready_for_explicit_gate_resolve'
  ) {
    return row.gate_validation_status === 'ready_for_explicit_gate_resolve';
  }
  if (
    filters.sam31ApprovalValidation === 'placeholder'
    || filters.sam31ApprovalValidation === 'placeholder_no_claims'
    || filters.sam31ApprovalValidation === 'decision_no_claims'
  ) {
    return row.gate_validation_status === 'validation_decision_no_claims_cleared';
  }
  if (filters.sam31ApprovalValidation === 'decided') {
    return Boolean(row.latest_approval_upload_validation_decision);
  }
  if (filters.sam31ApprovalValidation === 'cleared') {
    return row.gate_validation_status === 'gate_cleared';
  }
  if (filters.sam31ApprovalValidation === 'missing') {
    return !row.latest_approval_upload_intake;
  }
  return Boolean(row.latest_approval_upload_intake);
}

function filterSam31ApprovalValidationItems(items, filters, gateStatusByCode) {
  return items
    .map((item) => {
      if (item.kind === 'sam31_approval_upload_validation') {
        const approvalRows = Array.isArray(item.approval_upload_resolver_rows)
          ? item.approval_upload_resolver_rows
            .map((row) => decorateSam31ApprovalUploadValidationRow(row, gateStatusByCode))
            .filter((row) => sam31ApprovalValidationRowMatches(row, filters))
          : [];
        return approvalRows.length ? { ...item, approval_upload_resolver_rows: approvalRows } : null;
      }
      const replayRows = Array.isArray(item.sam31_sprinkler_preliminary_replay_queue_items)
        ? item.sam31_sprinkler_preliminary_replay_queue_items
          .map((replayRow) => {
            const packetRows = Array.isArray(replayRow.packet_queue_items)
              ? replayRow.packet_queue_items
                .map((packet) => {
                  const approvalRows = Array.isArray(packet.approval_upload_resolver_rows)
                    ? packet.approval_upload_resolver_rows
                      .map((row) => decorateSam31ApprovalUploadValidationRow(row, gateStatusByCode))
                      .filter((row) => sam31ApprovalValidationRowMatches(row, filters))
                    : [];
                  return approvalRows.length ? { ...packet, approval_upload_resolver_rows: approvalRows } : null;
                })
                .filter(Boolean)
              : [];
            return packetRows.length ? { ...replayRow, packet_queue_items: packetRows } : null;
          })
          .filter(Boolean)
        : [];
      return replayRows.length ? { ...item, sam31_sprinkler_preliminary_replay_queue_items: replayRows } : null;
    })
    .filter(Boolean);
}

function sam31ApprovalUploadValidationRowsFromItems(items, gateStatusByCode) {
  const rows = [];
  for (const item of Array.isArray(items) ? items : []) {
    for (const row of Array.isArray(item.approval_upload_resolver_rows) ? item.approval_upload_resolver_rows : []) {
      rows.push(decorateSam31ApprovalUploadValidationRow(row, gateStatusByCode));
    }
    for (const replayRow of Array.isArray(item.sam31_sprinkler_preliminary_replay_queue_items) ? item.sam31_sprinkler_preliminary_replay_queue_items : []) {
      for (const packet of Array.isArray(replayRow.packet_queue_items) ? replayRow.packet_queue_items : []) {
        for (const row of Array.isArray(packet.approval_upload_resolver_rows) ? packet.approval_upload_resolver_rows : []) {
          rows.push(decorateSam31ApprovalUploadValidationRow(row, gateStatusByCode));
        }
      }
    }
  }
  return rows;
}

function sam31ApprovalUploadValidationStandaloneItems(projectName, approvalUploadEvidences, gateStatusByCode) {
  return (Array.isArray(approvalUploadEvidences) ? approvalUploadEvidences : [])
    .map((uploadEvidence) => {
      const summary = halofireSam31ApprovalUploadIntakeSummary(uploadEvidence);
      if (!summary) return null;
      const rule = halofireSam31ApprovalUploadRule(summary.code);
      const row = decorateSam31ApprovalUploadValidationRow({
        id: `approval-upload-validation:${summary.evidence_id}:${summary.code || 'approval'}`,
        artifact_type: HALOFIRE_SAM31_APPROVAL_UPLOAD_RESOLVER_ROW_TYPE,
        status: 'approval_upload_recorded_pending_gate_validation',
        code: summary.code,
        target_gate_code: summary.gate_code,
        target_approval_lane: summary.target_approval_lane,
        gate_evidence_type: summary.evidence_type,
        required_evidence_type: summary.required_evidence_type || rule?.required_evidence_type || summary.evidence_type,
        source_packet_review_decision_evidence_id: summary.source_packet_review_decision_evidence_id,
        source_followup_decision_evidence_id: summary.source_followup_decision_evidence_id,
        source_pdf_boundary_evidence_id: summary.source_pdf_boundary_evidence_id || null,
        source_section_to_artifacts_consumer_intake_smoke_evidence_id: summary.source_section_to_artifacts_consumer_intake_smoke_evidence_id || null,
        source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: summary.source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id || null,
        source_halofire_sam31_sprinkler_review_decision_evidence_id: summary.source_halofire_sam31_sprinkler_review_decision_evidence_id || null,
        packet_index: summary.packet_index ?? 0,
        latest_approval_upload_intake: summary,
        acceptable_evidence: [summary.required_evidence_type || rule?.required_evidence_type || summary.evidence_type].filter(Boolean),
        next_action: 'Review the uploaded approval evidence and validation packet before explicitly resolving the claim gate.',
        blocked_claims: Array.isArray(summary.blocked_claims) ? summary.blocked_claims : [],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }, gateStatusByCode);
      return {
        id: `sam31-approval-upload-validation:${summary.evidence_id}`,
        kind: 'sam31_approval_upload_validation',
        artifact_type: 'halofire.sam31_approval_upload_validation_queue_item.v1',
        status: row.gate_validation_status || 'pending_gate_validation',
        project_name: projectName,
        evidence_id: summary.evidence_id,
        next_action: row.next_action,
        acceptable_evidence: row.acceptable_evidence,
        blocked_claims: row.blocked_claims,
        approval_upload_resolver_rows: [row],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      };
    })
    .filter(Boolean);
}

function claimGateResolveAuditQueueItems(projectName) {
  ensureProjectClaimGates(projectName);
  const gates = db
    .prepare(`SELECT * FROM claim_gates
              WHERE project_name = ? AND status = 'cleared'
              ORDER BY resolved_at DESC, code`)
    .all(projectName);
  return gates.map((gate) => {
    const auditPacketAction = claimGateResolveAuditPacketAction(projectName, gate.code);
    const evidenceId = Number(gate.resolved_evidence_id || 0) || null;
    const evidence = evidenceId
      ? db.prepare('SELECT * FROM project_evidence WHERE project_name = ? AND id = ?').get(projectName, evidenceId)
      : null;
    return {
      id: `claim-gate-resolve-audit:${gate.code}`,
      kind: 'claim_gate_resolve_audit',
      artifact_type: 'halofire.claim_gate_resolve_audit_queue_item.v1',
      project_name: projectName,
      code: gate.code,
      status: gate.status,
      severity: gate.severity,
      missing_artifact: gate.missing_artifact,
      acceptable_evidence: [gate.acceptable_evidence],
      blocked_claims: safeParseJsonArray(gate.blocked_claims),
      next_action: 'Download and review the resolve audit packet before relying on this cleared gate; unrelated regulated claims remain blocked.',
      resolved_by: gate.resolved_by || null,
      resolved_at: gate.resolved_at || null,
      resolved_evidence_id: evidence?.id || evidenceId,
      resolved_evidence_ref: gate.resolved_evidence_ref || evidence?.source_ref || null,
      resolved_evidence_type: evidence?.evidence_type || null,
      audit_packet_action: auditPacketAction,
      download_href: auditPacketAction.href,
      download_name: auditPacketAction.download_name,
      claim_gate_effect: 'gate_cleared_after_explicit_signed_validation',
      no_unrelated_claims_cleared: true,
      limitations: [
        'This row indexes a previously resolved claim gate.',
        'It does not clear unrelated professional, AHJ, manufacturer, AutoSprink, permit-ready, fabrication-ready, or engineering-grade claims.',
      ],
    };
  });
}

function sam31ActualValueResolverQueueItems(projectName) {
  const queue = buildOpenClawSam31ActualValueResolverQueue(projectName);
  const rows = Array.isArray(queue.items) ? queue.items : [];
  return rows.map((row) => {
    const prefill = row.actual_value_replacement_prefill && typeof row.actual_value_replacement_prefill === 'object'
      ? row.actual_value_replacement_prefill
      : null;
    const sourceRefs = uniqueStrings([
      ...(Array.isArray(prefill?.source_refs) ? prefill.source_refs : []),
      row.replacement_values_source_ref,
      row.replacement_ref,
      row.persisted_review_packet_ref,
    ].filter(Boolean));
    const sourceRef = prefill?.source_ref || row.replacement_values_source_ref || row.replacement_ref || row.persisted_review_packet_ref || null;
    const sourceFile = prefill?.source_file || row.source_file || `openclaw_sam31_consumer_review:${row.source_openclaw_sam31_consumer_review_evidence_id || 'missing'}`;
    const replacementValuesSourceRef = prefill?.replacement_values_source_ref || row.replacement_values_source_ref || sourceRef;
    const acceptableActualEvidence = Array.isArray(row.acceptable_actual_evidence)
      ? [...row.acceptable_actual_evidence]
      : [
        '1881 proposal workbook row or sheet reference',
        'reviewed vector overlay SVG or marked-up plan ref',
        'reviewed 3D model candidate ref or model note',
        'screenshot or console evidence for the reviewed SAM31 section',
      ];
    const recordRequestBody = {
      kind: 'sam31ActualValueReplacement',
      artifact_type: 'halofire.sam31_actual_value_replacement_intake.v1',
      source_pdf_boundary_evidence_id: row.source_pdf_boundary_evidence_id || null,
      source_openclaw_sam31_consumer_review_evidence_id: row.source_openclaw_sam31_consumer_review_evidence_id || null,
      source_openclaw_sam31_consumer_smoke_evidence_id: row.source_openclaw_sam31_consumer_smoke_evidence_id || null,
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: row.source_openclaw_sam31_actual_value_service_descriptor_evidence_id || null,
      actual_value_service_descriptor_action: row.actual_value_service_descriptor_action || null,
      consumer: row.consumer || null,
      accepted_queue_id: row.accepted_queue_id || null,
      persisted_review_packet_ref: row.persisted_review_packet_ref || null,
      replacement_ref: row.replacement_ref || null,
      source_file: sourceFile,
      source_ref: sourceRef,
      replacement_values_source_ref: replacementValuesSourceRef,
      source_refs: uniqueStrings([...sourceRefs, sourceRef, sourceFile].filter(Boolean)),
      llm_observation_count: row.llm_observation_count || row.replacement_summary?.llm_observation_count || 0,
      llm_observation_ids: Array.isArray(row.llm_observation_ids) ? [...row.llm_observation_ids] : [],
      source_llm_observation_ids: Array.isArray(row.source_llm_observation_ids) ? [...row.source_llm_observation_ids] : [],
      replacement_summary: row.replacement_summary || {},
      acceptable_actual_evidence: acceptableActualEvidence,
      actual_value_replacement_prefill: prefill,
      employee_actual_value_next_action: row.employee_actual_value_next_action || null,
      blocked_claims: Array.isArray(row.blocked_claims) ? [...row.blocked_claims] : [],
      recorded_from: 'resolver_queue.sam31_actual_value_replacement',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    };
    return {
      ...row,
      kind: 'sam31_actual_value_replacement',
      resolver_artifact_type: 'halofire.sam31_actual_value_resolver_queue_item.v1',
      project_name: projectName,
      source_refs: sourceRefs,
      acceptable_evidence: acceptableActualEvidence,
      ai_fallback: 'Use SAM31+LLM object, vector, and 3D candidates only as temporary internal-alpha values until HaloFire employee evidence replaces them.',
      shared_queue_href: `/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(projectName)}${row.consumer ? `&consumer=${encodeURIComponent(row.consumer)}` : ''}`,
      source_project_queue_href: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-resolver-queue${row.consumer ? `?consumer=${encodeURIComponent(row.consumer)}` : ''}`,
      record_actual_value_replacement_action: {
        artifact_type: 'halofire.sam31_actual_value_replacement_record_action.v1',
        label: 'Record exact replacement evidence from resolver row',
        method: 'POST',
        href: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-replacements`,
        consumes: 'halofire.sam31_actual_value_replacement_intake.v1',
        produces: 'halofire.sam31_actual_value_replacement_intake.v1',
        evidence_record_type: 'sam31_actual_value_replacement',
        request_body: recordRequestBody,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      },
      next_action: row.next_action || 'Record sam31_actual_value_replacement evidence from the 1881 workbook/sheet, reviewed vector overlay, reviewed 3D model candidate, screenshot, or console evidence.',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    };
  });
}

app.get('/api/projects/:name/resolver-queue', authMiddleware, (req, res) => {
  const projectName = req.params.name;
  const filters = {
    roomBoundarySource: String(req.query?.roomBoundarySource || req.query?.room_boundary_source || '').trim().toLowerCase() || null,
    roomBoundaryState: String(req.query?.roomBoundaryState || req.query?.room_boundary_state || '').trim().toLowerCase() || null,
    sam31SectioningReview: String(req.query?.sam31SectioningReview || req.query?.sam31_sectioning_review || '').trim().toLowerCase() || null,
    sam31ConsumerReview: String(req.query?.sam31ConsumerReview || '').trim().toLowerCase() || null,
    sam31SprinklerReview: String(req.query?.sam31SprinklerReview || '').trim().toLowerCase() || null,
    sam31SprinklerReplay: String(req.query?.sam31SprinklerReplay || '').trim().toLowerCase() || null,
    sam31ApprovalValidation: String(req.query?.sam31ApprovalValidation || req.query?.sam31_approval_validation || '').trim().toLowerCase() || null,
    sam31ActualValue: String(req.query?.sam31ActualValue || req.query?.sam31_actual_value || '').trim().toLowerCase() || null,
    consumer: String(req.query?.consumer || '').trim().toLowerCase() || null,
    lane: String(req.query?.lane || '').trim().toLowerCase() || null,
    catalogApproval: String(req.query?.catalogApproval || req.query?.catalog_approval || '').trim().toLowerCase() || null,
    claimGateAudit: String(req.query?.claimGateAudit || req.query?.claim_gate_audit || '').trim().toLowerCase() || null,
    evidenceType: String(req.query?.evidenceType || req.query?.evidence_type || '').trim().toLowerCase() || null,
    targetGate: String(req.query?.targetGate || req.query?.target_gate || '').trim().toUpperCase() || null,
  };
  const evidence = latestPdfBoundaryDecisionEvidence(projectName);
  const decision = decisionFromEvidence(evidence);
  const reviewEvidence = evidence ? latestPdfBoundaryReviewEvidence(projectName, evidence.id) : null;
  const sam31Evidence = evidence ? latestSam31VisualAuditEvidence(projectName, evidence.id) : null;
  const sam31ReplacementEvidence = evidence ? latestSam31EmployeeReplacementEvidence(projectName, evidence.id) : null;
  const sam31SmokeEvidence = evidence ? latestSam31BridgeSmokeArtifactEvidence(projectName, evidence.id) : null;
  const sam31ExtrapolationEvidence = evidence ? latestOpenClawSam31ExtrapolationArtifactEvidence(projectName, evidence.id) : null;
  const sam31ExtrapolationReviewEvidence = evidence ? latestOpenClawSam31ExtrapolationReviewEvidence(projectName, evidence.id) : null;
  const sam31SectioningContractReviewEvidence = evidence ? latestOpenClawSam31SectioningPipelineContractReviewEvidence(projectName, evidence.id) : null;
  const sam31SectioningDownstreamPacketEvidence = evidence ? latestHalofireSam31SectioningDownstreamResolverPacketEvidence(projectName, evidence.id) : null;
  const sam31SectioningSprinklerReviewAdapterEvidence = evidence ? latestHalofireSam31SectioningSprinklerReviewAdapterEvidence(projectName, evidence.id) : null;
  const sam31ConsumerSmokeEvidence = evidence ? latestOpenClawSam31ConsumerSmokeArtifactEvidence(projectName, evidence.id) : null;
  const sam31ConsumerReviewEvidences = evidence ? latestOpenClawSam31ConsumerReviewEvidence(projectName, evidence.id) : [];
  const sam31SprinklerReviewDecisionEvidences = evidence ? latestHalofireSam31SprinklerReviewDecisionEvidence(projectName, evidence.id) : [];
  const sam31SprinklerPreliminaryReplayFollowupDecisionEvidences = evidence ? latestHalofireSam31SprinklerPreliminaryReplayFollowupDecisionEvidence(projectName, evidence.id) : [];
  const sam31SprinklerFollowupPacketReviewDecisionEvidences = evidence ? latestHalofireSam31SprinklerFollowupPacketReviewDecisionEvidence(projectName, evidence.id) : [];
  const sam31ApprovalUploadIntakeEvidences = evidence ? latestHalofireSam31ApprovalUploadIntakeEvidence(projectName, evidence.id) : [];
  const standaloneSam31ApprovalUploadIntakeEvidences = filters.sam31ApprovalValidation
    ? latestHalofireSam31ApprovalUploadIntakeEvidence(projectName, null)
    : sam31ApprovalUploadIntakeEvidences;
  const approvalGateStatusByCode = sam31ApprovalUploadGateStatusMap(projectName);
  const items = [];
  for (const claimGateAuditItem of claimGateResolveAuditQueueItems(projectName)) {
    items.push(claimGateAuditItem);
  }
  for (const actualValueItem of sam31ActualValueResolverQueueItems(projectName)) {
    items.push(actualValueItem);
  }
  const suppliedDocumentBidTruthItem = suppliedDocumentBidTruthResolverQueueItem(projectName);
  if (suppliedDocumentBidTruthItem) items.push(suppliedDocumentBidTruthItem);
  const officialFlowEvidence = latestOfficialFlowIntakeEvidence(projectName);
  const officialFlowItem = officialFlowResolverQueueItem(projectName, officialFlowEvidence);
  if (officialFlowItem) items.push(officialFlowItem);
  for (const replayEvidence of officialFlowReplayArtifactEvidenceRows(projectName)) {
    const replayItem = officialFlowReplayReviewQueueItem(projectName, replayEvidence);
    if (replayItem) items.push(replayItem);
  }
  const boundaryItem = pdfBoundaryResolverQueueItem(projectName, evidence, decision, reviewEvidence, sam31Evidence, sam31ReplacementEvidence, sam31SmokeEvidence, sam31ExtrapolationEvidence, sam31ExtrapolationReviewEvidence, sam31SectioningContractReviewEvidence, sam31SectioningDownstreamPacketEvidence, sam31SectioningSprinklerReviewAdapterEvidence, sam31ConsumerSmokeEvidence, sam31ConsumerReviewEvidences, sam31SprinklerReviewDecisionEvidences, sam31SprinklerPreliminaryReplayFollowupDecisionEvidences, sam31SprinklerFollowupPacketReviewDecisionEvidences, sam31ApprovalUploadIntakeEvidences);
  if (boundaryItem) items.push(boundaryItem);
  if (filters.sam31ApprovalValidation) {
    for (const approvalValidationItem of sam31ApprovalUploadValidationStandaloneItems(projectName, standaloneSam31ApprovalUploadIntakeEvidences, approvalGateStatusByCode)) {
      items.push(approvalValidationItem);
    }
  }
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
  if (filters.sam31ActualValue) {
    visibleItems = visibleItems.filter((item) => {
      if (item.kind !== 'sam31_actual_value_replacement') return false;
      if (filters.consumer && String(item.consumer || '').toLowerCase() !== filters.consumer) return false;
      if (filters.sam31ActualValue === 'pending' && item.intake_status === 'recorded') return false;
      if (filters.sam31ActualValue === 'recorded' && item.intake_status !== 'recorded') return false;
      if (filters.sam31ActualValue === 'prefilled_1881') {
        const prefillStatus = String(item.actual_value_replacement_prefill?.status || '').toLowerCase();
        if (prefillStatus !== 'prefill_from_supplied_1881_source_refs') return false;
      }
      return true;
    });
  }
  if (filters.roomBoundarySource || filters.roomBoundaryState) {
    visibleItems = visibleItems.filter((item) => {
      if (item.kind !== 'room_boundary_visual_audit') return false;
      if (filters.roomBoundarySource === 'employee_review' && !item.latest_review) return false;
      if (filters.roomBoundarySource === 'sam31_visual_audit' && !item.latest_sam31_visual_audit) return false;
      if (filters.roomBoundaryState && String(item.status || '').toLowerCase() !== filters.roomBoundaryState) return false;
      return true;
    });
  }
  if (filters.sam31SectioningReview === 'ready') {
    visibleItems = visibleItems
      .map((item) => {
        const downstreamRows = Array.isArray(item.sam31_sectioning_downstream_resolver_queue_items)
          ? item.sam31_sectioning_downstream_resolver_queue_items
            .filter((row) => !filters.lane || String(row.downstream_resolver_lane || '').toLowerCase() === filters.lane)
          : [];
        return downstreamRows.length ? { ...item, sam31_sectioning_downstream_resolver_queue_items: downstreamRows } : null;
      })
      .filter(Boolean);
  }
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
  if (filters.sam31ApprovalValidation) {
    visibleItems = filterSam31ApprovalValidationItems(visibleItems, filters, approvalGateStatusByCode);
  }
  if (filters.claimGateAudit) {
    visibleItems = visibleItems.filter((item) => {
      if (item.kind !== 'claim_gate_resolve_audit') return false;
      if (filters.claimGateAudit === 'cleared' && item.status !== 'cleared') return false;
      if (filters.targetGate && String(item.code || '').toUpperCase() !== filters.targetGate) return false;
      return true;
    });
  }
  if (filters.catalogApproval || filters.evidenceType || (filters.targetGate && !filters.sam31ApprovalValidation && !filters.claimGateAudit)) {
    visibleItems = visibleItems
      .map((item) => {
        const approvalRows = Array.isArray(item.catalog_approval_packet_rows)
          ? item.catalog_approval_packet_rows
            .filter((row) => filters.catalogApproval !== 'ready' || row.status === 'ready_for_signed_evidence_upload')
            .filter((row) => !filters.evidenceType || String(row.required_evidence_type || '').toLowerCase() === filters.evidenceType)
            .filter((row) => !filters.targetGate || String(row.target_gate_code || '').toUpperCase() === filters.targetGate)
          : [];
        return approvalRows.length ? { ...item, catalog_approval_packet_rows: approvalRows } : null;
      })
      .filter(Boolean);
  }
  const statusCounts = visibleItems.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const sam31ApprovalValidationRows = sam31ApprovalUploadValidationRowsFromItems(visibleItems, approvalGateStatusByCode);
  const sam31ActualValueRows = visibleItems.filter((item) => item.kind === 'sam31_actual_value_replacement');
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
      sam31_sectioning_contract_reviews_recorded: visibleItems.filter((item) => item.latest_openclaw_sam31_sectioning_pipeline_contract_review).length,
      sam31_sectioning_downstream_resolver_queue_items: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_sectioning_downstream_resolver_queue_items) ? item.sam31_sectioning_downstream_resolver_queue_items.length : 0), 0),
      sam31_sectioning_downstream_resolver_packets_recorded: visibleItems.filter((item) => item.latest_halofire_sam31_sectioning_downstream_resolver_packet).length,
      sam31_sectioning_sprinkler_review_adapters_recorded: visibleItems.filter((item) => item.latest_halofire_sam31_sectioning_sprinkler_review_adapter).length,
      sam31_vector_model_artifacts_recorded: visibleItems.filter((item) => item.latest_openclaw_sam31_vector_model_artifact).length,
      sam31_consumer_smoke_recorded: visibleItems.filter((item) => item.latest_openclaw_sam31_consumer_smoke_artifact).length,
      sam31_consumer_reviews_recorded: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.latest_openclaw_sam31_consumer_reviews) ? item.latest_openclaw_sam31_consumer_reviews.length : 0), 0),
      sam31_consumer_reviews_unresolved: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_unresolved_consumer_reviews) ? item.sam31_unresolved_consumer_reviews.length : 0), 0),
      sam31_sprinkler_review_queue_items: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_sprinkler_review_queue_items) ? item.sam31_sprinkler_review_queue_items.length : 0), 0),
      sam31_sprinkler_review_decisions_recorded: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_sprinkler_review_queue_items) ? item.sam31_sprinkler_review_queue_items.filter((row) => row.latest_sam31_sprinkler_review_decision).length : 0), 0),
      sam31_sprinkler_preliminary_replay_queue_items: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_sprinkler_preliminary_replay_queue_items) ? item.sam31_sprinkler_preliminary_replay_queue_items.length : 0), 0),
      sam31_sprinkler_preliminary_replay_followups_recorded: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_sprinkler_preliminary_replay_queue_items) ? item.sam31_sprinkler_preliminary_replay_queue_items.filter((row) => row.latest_sam31_sprinkler_preliminary_replay_followup_decision).length : 0), 0),
      sam31_sprinkler_packet_queue_items: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_sprinkler_preliminary_replay_queue_items) ? item.sam31_sprinkler_preliminary_replay_queue_items.reduce((rowAcc, row) => rowAcc + (Array.isArray(row.packet_queue_items) ? row.packet_queue_items.length : 0), 0) : 0), 0),
      sam31_sprinkler_packet_reviews_recorded: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_sprinkler_preliminary_replay_queue_items) ? item.sam31_sprinkler_preliminary_replay_queue_items.reduce((rowAcc, row) => rowAcc + (Array.isArray(row.packet_queue_items) ? row.packet_queue_items.filter((packet) => packet.latest_packet_review_decision).length : 0), 0) : 0), 0),
      sam31_approval_upload_resolver_rows: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_sprinkler_preliminary_replay_queue_items) ? item.sam31_sprinkler_preliminary_replay_queue_items.reduce((rowAcc, row) => rowAcc + (Array.isArray(row.packet_queue_items) ? row.packet_queue_items.reduce((packetAcc, packet) => packetAcc + (Array.isArray(packet.approval_upload_resolver_rows) ? packet.approval_upload_resolver_rows.length : 0), 0) : 0), 0) : 0), 0),
      sam31_approval_uploads_recorded: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.sam31_sprinkler_preliminary_replay_queue_items) ? item.sam31_sprinkler_preliminary_replay_queue_items.reduce((rowAcc, row) => rowAcc + (Array.isArray(row.packet_queue_items) ? row.packet_queue_items.reduce((packetAcc, packet) => packetAcc + (Array.isArray(packet.approval_upload_resolver_rows) ? packet.approval_upload_resolver_rows.filter((uploadRow) => uploadRow.latest_approval_upload_intake).length : 0), 0) : 0), 0) : 0), 0),
      sam31_approval_validation_decisions_recorded: sam31ApprovalValidationRows.filter((row) => row.latest_approval_upload_validation_decision).length,
      sam31_approval_validation_pending: sam31ApprovalValidationRows.filter((row) => row.gate_validation_status === 'pending_gate_validation').length,
      sam31_approval_validation_placeholder_no_claims: sam31ApprovalValidationRows.filter((row) => row.gate_validation_status === 'validation_decision_no_claims_cleared').length,
      sam31_approval_validation_ready_for_gate_resolve: sam31ApprovalValidationRows.filter((row) => row.gate_validation_status === 'ready_for_explicit_gate_resolve').length,
      sam31_approval_validation_cleared: sam31ApprovalValidationRows.filter((row) => row.gate_validation_status === 'gate_cleared').length,
      sam31_actual_value_replacement_pending: sam31ActualValueRows.filter((row) => row.intake_status !== 'recorded').length,
      sam31_actual_value_prefilled_1881: sam31ActualValueRows.filter((row) => String(row.actual_value_replacement_prefill?.status || '').toLowerCase() === 'prefill_from_supplied_1881_source_refs').length,
      sam31_actual_value_replacements_recorded: sam31ActualValueRows.filter((row) => row.intake_status === 'recorded').length,
      claim_gate_resolve_audit_cleared: visibleItems.filter((item) => item.kind === 'claim_gate_resolve_audit' && item.status === 'cleared').length,
      claim_gate_resolve_audit_ready_for_download: visibleItems.filter((item) => item.kind === 'claim_gate_resolve_audit' && item.audit_packet_action?.href).length,
      catalog_source_needed: statusCounts.catalog_source_needed || 0,
      catalog_review_needed: statusCounts.catalog_review_needed || 0,
      catalog_evidence_recorded: statusCounts.catalog_evidence_recorded || 0,
      catalog_approval_packet_ready: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.catalog_approval_packet_rows) ? item.catalog_approval_packet_rows.filter((row) => row.status === 'ready_for_signed_evidence_upload').length : 0), 0),
      catalog_approval_professional_packets: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.catalog_approval_packet_rows) ? item.catalog_approval_packet_rows.filter((row) => row.required_evidence_type === 'professional_review').length : 0), 0),
      catalog_approval_ahj_packets: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.catalog_approval_packet_rows) ? item.catalog_approval_packet_rows.filter((row) => row.required_evidence_type === 'ahj_approval').length : 0), 0),
      catalog_approval_autosprink_packets: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.catalog_approval_packet_rows) ? item.catalog_approval_packet_rows.filter((row) => row.required_evidence_type === 'autosprink_packet').length : 0), 0),
      catalog_approval_claims_cleared: visibleItems.reduce((acc, item) => acc + (Array.isArray(item.catalog_approval_packet_rows) ? item.catalog_approval_packet_rows.filter((row) => row.claim_gate_effect !== 'no_claims_cleared').length : 0), 0),
      employee_room_boundary_correction_ready: visibleItems.filter((item) => item.kind === 'room_boundary_visual_audit' && item.latest_review && item.status === 'correction_ready').length,
      supplied_document_bid_truth_review_needed: visibleItems.filter((item) => item.kind === 'supplied_document_bid_truth' && item.status === 'employee_review_needed').length,
      supplied_document_bid_truth_replacements_recorded: visibleItems.filter((item) => item.kind === 'supplied_document_bid_truth' && item.status === 'employee_replacement_recorded').length,
      supplied_document_bid_truth_claims_cleared: visibleItems.filter((item) => item.kind === 'supplied_document_bid_truth' && item.claim_gate_effect !== 'no_claims_cleared').length,
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

app.get('/api/openclaw/sam31/tool', authMiddleware, (req, res) => {
  res.json(localOpenClawSam31ToolDescriptor());
});

app.get('/api/openclaw/sam31/actual-value-service', authMiddleware, (req, res) => {
  const projectName = String(req.query?.projectName || req.query?.project_name || '').trim();
  if (!projectName) {
    return res.status(400).json({ error: 'projectName is required for OpenClaw SAM31 actual-value service descriptor' });
  }
  res.json(buildOpenClawSam31ActualValueServiceDescriptor(projectName, {
    consumer: req.query?.consumer,
  }));
});

app.get('/api/openclaw/sam31/actual-value-resolver-contract', authMiddleware, (req, res) => {
  const projectName = String(req.query?.projectName || req.query?.project_name || '').trim();
  if (!projectName) {
    return res.status(400).json({ error: 'projectName is required for OpenClaw SAM31 actual-value resolver contract packet' });
  }
  res.json(buildOpenClawSam31ActualValueResolverContractPacket(projectName, {
    consumer: req.query?.consumer,
    contractEvidenceId: req.query?.contractEvidenceId || req.query?.contract_evidence_id,
    replacementReadbackEvidenceId: req.query?.replacementReadbackEvidenceId || req.query?.replacement_readback_evidence_id,
  }));
});

app.get('/api/openclaw/sam31/actual-value-resolver-queue', authMiddleware, (req, res) => {
  const projectName = String(req.query?.projectName || req.query?.project_name || '').trim();
  if (!projectName) {
    return res.status(400).json({ error: 'projectName is required for OpenClaw SAM31 actual-value resolver queue readback' });
  }
  res.json(buildOpenClawSam31ActualValueResolverQueueReadback(projectName, {
    consumer: req.query?.consumer,
    contractEvidenceId: req.query?.contractEvidenceId || req.query?.contract_evidence_id,
    replacementReadbackEvidenceId: req.query?.replacementReadbackEvidenceId || req.query?.replacement_readback_evidence_id,
    serviceDescriptorEvidenceId: req.query?.serviceDescriptorEvidenceId || req.query?.service_descriptor_evidence_id,
    consumerIntakeSmokeEvidenceId: req.query?.consumerIntakeSmokeEvidenceId || req.query?.consumer_intake_smoke_evidence_id,
    sourceReplayEvidenceId: req.query?.sourceReplayEvidenceId || req.query?.source_replay_evidence_id,
  }));
});

app.get('/api/openclaw/sam31/actual-value-replacements', authMiddleware, (req, res) => {
  const projectName = String(req.query?.projectName || req.query?.project_name || '').trim();
  if (!projectName) {
    return res.status(400).json({ error: 'projectName is required for OpenClaw SAM31 actual-value replacement readback' });
  }
  res.json(buildOpenClawSam31ActualValueReplacementReadback(projectName, {
    consumer: req.query?.consumer,
    contractEvidenceId: req.query?.contractEvidenceId || req.query?.contract_evidence_id,
    serviceDescriptorEvidenceId: req.query?.serviceDescriptorEvidenceId || req.query?.service_descriptor_evidence_id,
    sourceReplayEvidenceId: req.query?.sourceReplayEvidenceId || req.query?.source_replay_evidence_id,
  }));
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

app.get('/api/projects/:name/resolver-packets/openclaw/sam31/tool-contract', authMiddleware, (req, res) => {
  try {
    res.json(buildOpenClawSam31ToolContractPacket(req.params.name));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/sectioning-pipeline-contract', authMiddleware, (req, res) => {
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
    return res.json(buildOpenClawSam31SectioningPipelineContractPacket(projectName, evidence, decision, extrapolationEvidence));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/sectioning-pipeline-contract-review', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    const sourceExtrapolationEvidenceId = Number(req.body?.source_openclaw_sam31_extrapolation_evidence_id);
    if (!Number.isSafeInteger(sourceExtrapolationEvidenceId) || sourceExtrapolationEvidenceId <= 0) {
      return res.status(400).json({ error: 'source_openclaw_sam31_extrapolation_evidence_id is required for OpenClaw SAM31 sectioning contract review evidence' });
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
    const reviewPacket = normalizeOpenClawSam31SectioningPipelineContractReview(projectName, evidence, decision, extrapolationEvidence, extrapolationArtifact, req.body, req.user);
    const notes = {
      kind: 'openclaw_sam31_sectioning_pipeline_contract_review',
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
        'openclaw_sam31_sectioning_pipeline_contract_review',
        reviewPacket.source_file,
        reviewPacket.replacement_ref,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'OpenClaw SAM31 sectioning contract review values recorded; claims still blocked',
      evidence: evidenceRow,
      ...reviewPacket,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/sectioning-downstream-resolvers', authMiddleware, (req, res) => {
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
    const reviewEvidence = latestOpenClawSam31SectioningPipelineContractReviewEvidence(projectName, evidence.id);
    return res.json(buildHalofireSam31SectioningDownstreamResolverPacket(projectName, evidence, decision, reviewEvidence));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/sectioning-downstream-resolvers', authMiddleware, requireRole('admin'), (req, res) => {
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
    const reviewEvidence = latestOpenClawSam31SectioningPipelineContractReviewEvidence(projectName, evidence.id);
    const artifact = buildHalofireSam31SectioningDownstreamResolverPacket(projectName, evidence, decision, reviewEvidence);
    const review = reviewEvidence?.review || {};
    const notes = {
      kind: 'halofire_sam31_sectioning_downstream_resolver_packet',
      packet: artifact,
      source_pdf_boundary_evidence_id: evidence.id,
      source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: artifact.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id,
      source_openclaw_sam31_extrapolation_evidence_id: artifact.source_openclaw_sam31_extrapolation_evidence_id,
      blocked_claims: artifact.blocked_claims,
      claim_gate_effect: artifact.claim_gate_effect,
      limitations: artifact.limitations,
      source_refs: artifact.source_refs,
      replacement_ref: review.replacement_ref || null,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'halofire_sam31_sectioning_downstream_resolver_packet',
        evidence.source_file || decision.sourceFile || null,
        `pdf-boundary:${evidence.id}:sam31-sectioning-downstream-resolvers:${artifact.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id}`,
        'best_effort',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'HaloFire SAM31 sectioning downstream resolver packet saved as best-effort evidence; claims still blocked',
      evidence: evidenceRow,
      ...artifact,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/sectioning-downstream-resolvers/:packetEvidenceId/sprinkler-review-adapter', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const packetEvidenceId = Number(req.params.packetEvidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    if (!Number.isSafeInteger(packetEvidenceId) || packetEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 sectioning downstream packet evidence id is required' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const packetEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'halofire_sam31_sectioning_downstream_resolver_packet'`)
      .get(packetEvidenceId, projectName);
    const packet = halofireSam31SectioningDownstreamResolverPacketFromEvidence(packetEvidence);
    return res.json(buildHalofireSam31SectioningToSprinklerReviewAdapter(
      projectName,
      evidence,
      decision,
      { evidence: packetEvidence, packet },
    ));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/sectioning-downstream-resolvers/:packetEvidenceId/sprinkler-review-adapter', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const packetEvidenceId = Number(req.params.packetEvidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    if (!Number.isSafeInteger(packetEvidenceId) || packetEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 sectioning downstream packet evidence id is required' });
    }
    const evidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'pdf_boundary_decision'`)
      .get(evidenceId, projectName);
    const decision = decisionFromEvidence(evidence);
    if (!evidence || !decision) {
      return res.status(404).json({ error: 'PDF boundary decision evidence not found' });
    }
    const packetEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'halofire_sam31_sectioning_downstream_resolver_packet'`)
      .get(packetEvidenceId, projectName);
    const packet = halofireSam31SectioningDownstreamResolverPacketFromEvidence(packetEvidence);
    const adapter = buildHalofireSam31SectioningToSprinklerReviewAdapter(
      projectName,
      evidence,
      decision,
      { evidence: packetEvidence, packet },
    );
    const notes = {
      kind: 'halofire_sam31_sectioning_sprinkler_review_adapter',
      adapter,
      source_pdf_boundary_evidence_id: evidence.id,
      source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: packetEvidence.id,
      source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id: adapter.source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id,
      source_openclaw_sam31_extrapolation_evidence_id: adapter.source_openclaw_sam31_extrapolation_evidence_id,
      blocked_claims: adapter.blocked_claims,
      claim_gate_effect: adapter.claim_gate_effect,
      limitations: adapter.limitations,
      source_refs: adapter.source_refs,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'halofire_sam31_sectioning_sprinkler_review_adapter',
        evidence.source_file || decision.sourceFile || null,
        `pdf-boundary:${evidence.id}:sam31-sectioning-sprinkler-review-adapter:${packetEvidence.id}`,
        'best_effort',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'HaloFire SAM31 sectioning sprinkler review adapter saved as best-effort evidence; claims still blocked',
      evidence: evidenceRow,
      ...adapter,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/vector-model-artifacts', authMiddleware, (req, res) => {
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
    const sam31Evidence = latestSam31VisualAuditEvidence(projectName, evidence.id);
    return res.json(buildOpenClawSam31VectorModelArtifactPacket(projectName, evidence, decision, sam31Evidence));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/vector-model-artifacts', authMiddleware, requireRole('admin'), (req, res) => {
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
    const sam31Evidence = latestSam31VisualAuditEvidence(projectName, evidence.id);
    const artifact = buildOpenClawSam31VectorModelArtifactPacket(projectName, evidence, decision, sam31Evidence);
    const notes = {
      kind: 'openclaw_sam31_vector_model_artifact_packet',
      artifact,
      source_pdf_boundary_evidence_id: evidence.id,
      source_sam31_visual_audit_evidence_id: sam31Evidence.evidence.id,
      blocked_claims: artifact.blocked_claims,
      claim_gate_effect: artifact.claim_gate_effect,
      limitations: artifact.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'openclaw_sam31_vector_model_artifact_packet',
        artifact.source_file || evidence.source_file || decision.sourceFile || null,
        `pdf-boundary:${evidence.id}:sam31-vector-model-artifacts:${sam31Evidence.evidence.id}`,
        'best_effort',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'OpenClaw SAM31 vector/model artifact packet saved as best-effort evidence; claims still blocked',
      evidence: evidenceRow,
      ...artifact,
    });
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

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/consumer-review/:reviewEvidenceId/actual-value-work-item', authMiddleware, (req, res) => {
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
    return res.json(buildOpenClawSam31ActualValueWorkItemPacket(
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

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/sprinkler-review/:reviewEvidenceId/decision/:sprinklerReviewEvidenceId/preliminary-replay/followup/:followupEvidenceId/packet/:packetIndex', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const reviewEvidenceId = Number(req.params.reviewEvidenceId);
    const sprinklerReviewEvidenceId = Number(req.params.sprinklerReviewEvidenceId);
    const followupEvidenceId = Number(req.params.followupEvidenceId);
    const packetIndex = Number(req.params.packetIndex);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    if (!Number.isSafeInteger(reviewEvidenceId) || reviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer review evidence id is required' });
    }
    if (!Number.isSafeInteger(sprinklerReviewEvidenceId) || sprinklerReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 sprinkler review decision evidence id is required' });
    }
    if (!Number.isSafeInteger(followupEvidenceId) || followupEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 preliminary replay follow-up evidence id is required' });
    }
    if (!Number.isSafeInteger(packetIndex) || packetIndex < 0) {
      return res.status(400).json({ error: 'A non-negative SAM31 follow-up packet index is required' });
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
    const followupEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'halofire_sam31_sprinkler_preliminary_replay_followup_decision'`)
      .get(followupEvidenceId, projectName);
    const followup = halofireSam31SprinklerPreliminaryReplayFollowupDecisionFromEvidence(followupEvidence);
    if (!followupEvidence || !followup) {
      return res.status(404).json({ error: 'SAM31 sprinkler preliminary replay follow-up evidence not found' });
    }
    if (Number(followup.source_pdf_boundary_evidence_id) !== evidenceId
      || Number(followup.source_openclaw_sam31_consumer_review_evidence_id) !== reviewEvidenceId
      || Number(followup.source_halofire_sam31_sprinkler_review_decision_evidence_id) !== sprinklerReviewEvidenceId) {
      return res.status(409).json({ error: 'SAM31 sprinkler preliminary replay follow-up evidence does not match the requested source chain' });
    }
    return res.json(buildHalofireSam31SprinklerReplayFollowupPacket(
      projectName,
      evidence,
      reviewEvidence,
      sprinklerReviewEvidence,
      followupEvidence,
      followup,
      packetIndex,
    ));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/sprinkler-review/:reviewEvidenceId/decision/:sprinklerReviewEvidenceId/preliminary-replay/followup/:followupEvidenceId/packet/:packetIndex/review', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const reviewEvidenceId = Number(req.params.reviewEvidenceId);
    const sprinklerReviewEvidenceId = Number(req.params.sprinklerReviewEvidenceId);
    const followupEvidenceId = Number(req.params.followupEvidenceId);
    const packetIndex = Number(req.params.packetIndex);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    if (!Number.isSafeInteger(reviewEvidenceId) || reviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer review evidence id is required' });
    }
    if (!Number.isSafeInteger(sprinklerReviewEvidenceId) || sprinklerReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 sprinkler review decision evidence id is required' });
    }
    if (!Number.isSafeInteger(followupEvidenceId) || followupEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 preliminary replay follow-up evidence id is required' });
    }
    if (!Number.isSafeInteger(packetIndex) || packetIndex < 0) {
      return res.status(400).json({ error: 'A non-negative SAM31 follow-up packet index is required' });
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
    const followupEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'halofire_sam31_sprinkler_preliminary_replay_followup_decision'`)
      .get(followupEvidenceId, projectName);
    const followup = halofireSam31SprinklerPreliminaryReplayFollowupDecisionFromEvidence(followupEvidence);
    if (!followupEvidence || !followup) {
      return res.status(404).json({ error: 'SAM31 sprinkler preliminary replay follow-up evidence not found' });
    }
    if (Number(followup.source_pdf_boundary_evidence_id) !== evidenceId
      || Number(followup.source_openclaw_sam31_consumer_review_evidence_id) !== reviewEvidenceId
      || Number(followup.source_halofire_sam31_sprinkler_review_decision_evidence_id) !== sprinklerReviewEvidenceId) {
      return res.status(409).json({ error: 'SAM31 sprinkler preliminary replay follow-up evidence does not match the requested source chain' });
    }
    const sourcePacket = buildHalofireSam31SprinklerReplayFollowupPacket(
      projectName,
      evidence,
      reviewEvidence,
      sprinklerReviewEvidence,
      followupEvidence,
      followup,
      packetIndex,
    );
    const reviewDecision = normalizeHalofireSam31SprinklerFollowupPacketReviewDecision(projectName, sourcePacket, req.body || {}, req.user || {});
    const notes = {
      kind: 'halofire_sam31_sprinkler_followup_packet_review_decision',
      review: reviewDecision,
      blocked_claims: reviewDecision.blocked_claims,
      claim_gate_effect: reviewDecision.claim_gate_effect,
      limitations: reviewDecision.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'halofire_sam31_sprinkler_followup_packet_review_decision',
        sourcePacket.download_name || sourcePacket.artifact_type,
        reviewDecision.review_ref,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'SAM31 follow-up packet review decision recorded; claims still blocked',
      evidence: evidenceRow,
      ...reviewDecision,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/openclaw/sam31/sprinkler-review/:reviewEvidenceId/decision/:sprinklerReviewEvidenceId/preliminary-replay/followup/:followupEvidenceId/packet/:packetIndex/review/:packetReviewEvidenceId/approval-upload', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const evidenceId = Number(req.params.evidenceId);
    const reviewEvidenceId = Number(req.params.reviewEvidenceId);
    const sprinklerReviewEvidenceId = Number(req.params.sprinklerReviewEvidenceId);
    const followupEvidenceId = Number(req.params.followupEvidenceId);
    const packetIndex = Number(req.params.packetIndex);
    const packetReviewEvidenceId = Number(req.params.packetReviewEvidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ error: 'A positive evidence id is required' });
    }
    if (!Number.isSafeInteger(reviewEvidenceId) || reviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 consumer review evidence id is required' });
    }
    if (!Number.isSafeInteger(sprinklerReviewEvidenceId) || sprinklerReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 sprinkler review decision evidence id is required' });
    }
    if (!Number.isSafeInteger(followupEvidenceId) || followupEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 preliminary replay follow-up evidence id is required' });
    }
    if (!Number.isSafeInteger(packetIndex) || packetIndex < 0) {
      return res.status(400).json({ error: 'A non-negative SAM31 follow-up packet index is required' });
    }
    if (!Number.isSafeInteger(packetReviewEvidenceId) || packetReviewEvidenceId <= 0) {
      return res.status(400).json({ error: 'A positive SAM31 follow-up packet review evidence id is required' });
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
    const followupEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'halofire_sam31_sprinkler_preliminary_replay_followup_decision'`)
      .get(followupEvidenceId, projectName);
    const followup = halofireSam31SprinklerPreliminaryReplayFollowupDecisionFromEvidence(followupEvidence);
    if (!followupEvidence || !followup) {
      return res.status(404).json({ error: 'SAM31 sprinkler preliminary replay follow-up evidence not found' });
    }
    if (Number(followup.source_pdf_boundary_evidence_id) !== evidenceId
      || Number(followup.source_openclaw_sam31_consumer_review_evidence_id) !== reviewEvidenceId
      || Number(followup.source_halofire_sam31_sprinkler_review_decision_evidence_id) !== sprinklerReviewEvidenceId) {
      return res.status(409).json({ error: 'SAM31 sprinkler preliminary replay follow-up evidence does not match the requested source chain' });
    }
    const packetReviewEvidence = db
      .prepare(`SELECT * FROM project_evidence
                WHERE id = ? AND project_name = ? AND evidence_type = 'halofire_sam31_sprinkler_followup_packet_review_decision'`)
      .get(packetReviewEvidenceId, projectName);
    const packetReview = halofireSam31SprinklerFollowupPacketReviewDecisionFromEvidence(packetReviewEvidence);
    if (!packetReviewEvidence || !packetReview) {
      return res.status(404).json({ error: 'SAM31 follow-up packet review evidence not found' });
    }
    if (Number(packetReview.source_pdf_boundary_evidence_id) !== evidenceId
      || Number(packetReview.source_openclaw_sam31_consumer_review_evidence_id) !== reviewEvidenceId
      || Number(packetReview.source_halofire_sam31_sprinkler_review_decision_evidence_id) !== sprinklerReviewEvidenceId
      || Number(packetReview.source_followup_decision_evidence_id) !== followupEvidenceId
      || Number(packetReview.packet_index) !== packetIndex) {
      return res.status(409).json({ error: 'SAM31 follow-up packet review evidence does not match the requested source chain' });
    }
    const sourcePacket = buildHalofireSam31SprinklerReplayFollowupPacket(
      projectName,
      evidence,
      reviewEvidence,
      sprinklerReviewEvidence,
      followupEvidence,
      followup,
      packetIndex,
    );
    const packetReviewWithEvidenceId = {
      ...packetReview,
      evidence_id: packetReviewEvidence.id,
      source_ref: packetReviewEvidence.source_ref,
    };
    const intake = normalizeHalofireSam31ApprovalUploadIntake(projectName, sourcePacket, packetReviewWithEvidenceId, req.body || {}, req.user || {});
    ensureHalofireSam31ApprovalUploadGate(projectName, intake.gate_code, halofireSam31ApprovalUploadRule(intake.code));
    const notes = {
      kind: 'halofire_sam31_approval_upload_intake',
      artifact_type: HALOFIRE_SAM31_APPROVAL_UPLOAD_INTAKE_TYPE,
      intake,
      signoff: intake.signoff,
      blocked_claims: intake.blocked_claims,
      claim_gate_effect: intake.claim_gate_effect,
      use_for_claims: false,
      limitations: intake.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        intake.evidence_type,
        intake.source_file || sourcePacket.download_name || sourcePacket.artifact_type,
        intake.source_ref,
        'present',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    const responseIntake = {
      ...intake,
      gate_validation_action: intake.gate_validation_action ? {
        ...intake.gate_validation_action,
        request_body: { evidence_id: result.lastInsertRowid },
      } : null,
      gate_validation_packet_action: halofireSam31ApprovalUploadGateValidationPacketAction(projectName, result.lastInsertRowid),
    };
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'SAM31 approval upload intake recorded for later gate validation; claims still blocked',
      evidence: evidenceRow,
      ...responseIntake,
    });
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

app.get('/api/projects/:name/resolver-packets/catalog-source/:familyRef/review-packet', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    const familyRef = req.params.familyRef;
    const packet = catalogSourceEvidencePacket(projectName, familyRef);
    if (!packet) {
      return res.status(404).json({ error: 'Catalog source acquisition row not found' });
    }
    return res.json(packet);
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/catalog-source/:familyRef/approval-packet', authMiddleware, (req, res) => {
  try {
    const packet = catalogApprovalResolverPacket(req.params.name, req.params.familyRef, req.query);
    return res.json(packet);
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/catalog-source/:familyRef/approval-validation', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const result = validateCatalogSourceApproval(req.params.name, req.params.familyRef, req.body, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/supplied-document-bid-truth/review-packet', authMiddleware, (req, res) => {
  try {
    return res.json(suppliedDocumentBidTruthReviewPacket(req.params.name));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/supplied-document-bid-truth/downstream-defaults-packet', authMiddleware, (req, res) => {
  try {
    return res.json(suppliedDocumentBidTruthDownstreamDefaultsPacket(req.params.name));
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.post('/api/projects/:name/resolver-packets/supplied-document-bid-truth/replacements', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const projectName = req.params.name;
    const replacement = normalizeSuppliedDocumentBidTruthReplacement(projectName, req.body, req.user);
    const notes = {
      kind: 'supplied_document_bid_truth_replacement',
      replacement,
      blocked_claims: replacement.blocked_claims,
      claim_gate_effect: replacement.claim_gate_effect,
      limitations: replacement.limitations,
    };
    const result = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        projectName,
        'supplied_document_bid_truth_replacement',
        replacement.source_file,
        replacement.replacement_ref,
        'best_effort',
        JSON.stringify(notes),
      );
    const evidenceRow = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: 'Supplied document bid-truth replacement recorded as best-effort evidence; claims still blocked',
      evidence: evidenceRow,
      replacement,
    });
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.message });
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
    const sam31SectioningDownstreamPacketEvidence = evidence ? latestHalofireSam31SectioningDownstreamResolverPacketEvidence(projectName, evidence.id) : null;
    const packet = pdfBoundaryReplayInputPacket(projectName, evidence, decision, reviewEvidence, sam31Evidence, sam31ReplacementEvidence, sam31ExtrapolationEvidence, sam31ExtrapolationReviewEvidence, sam31SectioningDownstreamPacketEvidence);
    if (!packet) {
      return res.status(409).json({ error: 'No employee or SAM 3.1 room-boundary review packet is available for replay input' });
    }
    res.json(packet);
  } catch (err) {
    res.status(err.httpStatus || 400).json({ error: err.message });
  }
});

app.get('/api/projects/:name/resolver-packets/pdf-boundary/:evidenceId/floor-plan-override-action', authMiddleware, (req, res) => {
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
    const sam31SectioningDownstreamPacketEvidence = evidence ? latestHalofireSam31SectioningDownstreamResolverPacketEvidence(projectName, evidence.id) : null;
    const replayPacket = pdfBoundaryReplayInputPacket(projectName, evidence, decision, reviewEvidence, sam31Evidence, sam31ReplacementEvidence, sam31ExtrapolationEvidence, sam31ExtrapolationReviewEvidence, sam31SectioningDownstreamPacketEvidence);
    const actionPacket = pdfBoundaryFloorPlanOverrideActionPacket(projectName, replayPacket);
    if (!actionPacket) {
      return res.status(409).json({ error: 'No floor-plan override action is available until employee or SAM 3.1 review evidence exists' });
    }
    res.json(actionPacket);
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
  const suppliedDocumentBidTruth = suppliedDocumentBidTruthDownstreamDefaults(projectName);
  const requestEmployeeDecision = req.body?.employee_decision && typeof req.body.employee_decision === 'object' && !Array.isArray(req.body.employee_decision)
    ? jsonClone(req.body.employee_decision)
    : null;
  const requestSourceRefs = Array.isArray(req.body?.source_refs)
    ? uniqueStrings(req.body.source_refs.map((ref) => String(ref || '').trim()).filter(Boolean))
    : [];
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
    floorPlan = scaleFloorPlanAreaForSuppliedBidTruth(floorPlan, suppliedDocumentBidTruth);
  } else if (projectName === COOPERATIVE_1881_PROJECT_NAME) {
    // Residential apartment job with no DXF — built-in plan uses the REAL
    // sprinklered area (170,654 sqft) with a placeholder footprint shape.
    floorPlan = cooperative1881FloorPlan();
    floorPlan = scaleFloorPlanAreaForSuppliedBidTruth(floorPlan, suppliedDocumentBidTruth);
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
        source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id: replayInput.source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id,
        openclaw_sam31_extrapolation_product_review_packet: replayInput.openclaw_sam31_extrapolation_product_review_packet || null,
        sam31_downstream_review_metadata: replayInput.sam31_downstream_review_metadata || null,
        halofire_sam31_sectioning_downstream_resolver_packet: replayInput.halofire_sam31_sectioning_downstream_resolver_packet || null,
        source_ref: replayInput.source_ref,
        employee_decision: replayInput.employee_decision || null,
        source_refs: Array.isArray(replayInput.source_refs) ? replayInput.source_refs : [],
        floor_plan_override: replayInput.floor_plan_override || null,
        marked_up_plan_ref: replayInput.marked_up_plan_ref,
        sam31_result_ref: replayInput.sam31_result_ref,
        screenshot_ref: replayInput.screenshot_ref,
        console_log_ref: replayInput.console_log_ref,
        openclaw_sam31_perception_packet: replayInput.openclaw_sam31_perception_packet || null,
        corrected_room_polygons: Array.isArray(replayInput.corrected_room_polygons) ? replayInput.corrected_room_polygons : [],
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
      : suppliedDocumentBidTruth
      ? JSON.stringify({
        kind: 'best_effort_ai_layout',
        artifact_type: 'halofire.best_effort_ai_layout.supplied_document_bid_truth_defaults.v1',
        artifact_status: 'best_effort_internal_alpha',
        generated_at: new Date().toISOString(),
        generated_by: bid.generatedBy,
        source_evidence_type: 'supplied_document_bid_truth_replacement',
        source_supplied_document_bid_truth_replacement_evidence_id: suppliedDocumentBidTruth.source_replacement_evidence_id,
        supplied_document_bid_truth: suppliedDocumentBidTruth,
        total_head_count: bid.totalHeadCount,
        total_area_sqft: bid.totalAreaSqFt,
        bid_summary: {
          total_area_sqft: bid.totalAreaSqFt,
          total_head_count: bid.totalHeadCount,
          pricing_total: bid.pricing?.total ?? null,
          markup_pct: bid.pricing?.markupPct ?? null,
        },
        blocked_claims: suppliedDocumentBidTruth.blocked_claims,
        claim_gate_effect: 'no_claims_cleared',
        summary: `claim_gate_effect=no_claims_cleared source_evidence_type=supplied_document_bid_truth_replacement replacement_ref=${suppliedDocumentBidTruth.replacement_ref}`,
        limitations: [
          'Generated with employee supplied-document bid-truth replacements for internal-alpha defaults only.',
          bid.disclaimer,
        ],
      })
      : requestEmployeeDecision || requestSourceRefs.length
      ? JSON.stringify({
        kind: 'best_effort_ai_layout',
        artifact_type: 'halofire.best_effort_ai_layout.loaded_pdf_boundary_defaults.v1',
        artifact_status: 'best_effort_internal_alpha',
        generated_at: new Date().toISOString(),
        generated_by: bid.generatedBy,
        employee_decision: requestEmployeeDecision,
        source_refs: requestSourceRefs,
        total_head_count: bid.totalHeadCount,
        total_area_sqft: bid.totalAreaSqFt,
        bid_summary: {
          total_area_sqft: bid.totalAreaSqFt,
          total_head_count: bid.totalHeadCount,
          pricing_total: bid.pricing?.total ?? null,
          markup_pct: bid.pricing?.markupPct ?? null,
        },
        blocked_claims: Array.isArray(requestEmployeeDecision?.blocked_claims) ? requestEmployeeDecision.blocked_claims : [],
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
        limitations: [
          'Generated from a loaded employee-selected PDF boundary decision for internal-alpha correction loops only.',
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

  return { projectName, floorPlan, building, replayInput, suppliedDocumentBidTruth, bid, scene, cadModel, hydraulics, hydraulicNetwork, compliance, fullScopeBid };
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
    const { bid, scene, cadModel, hydraulics, hydraulicNetwork, compliance, fullScopeBid, building, replayInput, floorPlan, suppliedDocumentBidTruth } = out;
    res.json({
      bid,
      floorPlan,
      suppliedDocumentBidTruth,
      scene,
      cadModel,
      hydraulics,
      hydraulicNetwork,
      compliance,
      fullScopeBid,
      isBuilding: !!building,
      ...(replayInput ? { replayInput, roomBoundaryReplay: replayInput } : {}),
      ...(prebuilt && prebuilt.pdfMeta ? { pdfMeta: prebuilt.pdfMeta } : {}),
    });
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
