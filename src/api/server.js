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
import { generateSprinklerBid } from '../engine/sprinkler-layout.js';
import { buildScene } from '../engine/geometry.js';
import { buildResolverFromDb } from '../engine/pricebook-pricing.js';
import { floorPlanFromSvg, normalizeFloorPlan, buildingFromSvg } from '../engine/floorplan-import.js';
import { buildCadModel } from '../engine/cad-model.js';
import { toDxf } from '../engine/dxf-export.js';
import { requiredPressureAtRiser, flagSchedule, remoteAreaDemand } from '../engine/hydraulics.js';
import { buildParityMatrix, parityAchieved } from '../engine/parity-matrix.js';
import { AUTOSPRINK_PARITY_GATE, buildParityInventory, parityGateStatus } from '../components/registry.js';
import { balanceNetwork } from '../engine/hydraulic-network.js';
import { checkCompliance } from '../engine/nfpa-compliance.js';
import { buildSubmittal, renderSubmittalPdf } from '../engine/submittal.js';
import { homeDepotRexburgFloorPlan } from '../data/floorplans.js';
import { HOME_DEPOT_PROJECT_NAME } from '../data/evidence-gates.js';

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
  if (origin && !CORS_ORIGINS.includes(origin)) {
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

app.get('/api/projects/:name/claim-gates', authMiddleware, (req, res) => {
  const gates = db
    .prepare('SELECT * FROM claim_gates WHERE project_name = ? ORDER BY severity DESC, code')
    .all(req.params.name);
  res.json(gates.map((gate) => ({
    ...gate,
    blocked_claims: safeParseJsonArray(gate.blocked_claims),
  })));
});

app.get('/api/projects/:name/evidence', authMiddleware, (req, res) => {
  const evidence = db
    .prepare('SELECT * FROM project_evidence WHERE project_name = ? ORDER BY created_at DESC, id DESC')
    .all(req.params.name);
  res.json(evidence);
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

  const resolvedAt = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(projectName, evidence_type, source_file, source_ref, 'present', notes);
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
function runSprinklerPipeline(req) {
  const projectName = req.params.name;
  let floorPlan = null;
  let building = null;
  if (req.body && typeof req.body.buildingSvg === 'string' && req.body.buildingSvg.trim()) {
    // Accurate multi-space building drawing (walls/spaces/doors/columns by layer/attr).
    building = buildingFromSvg(req.body.buildingSvg, { name: projectName, unitsPerPx: Number(req.body.unitsPerPx) || 1 });
    // Synthesize a flat floor plan from the building's spaces for bid/hydraulics/scene.
    floorPlan = {
      name: projectName, units: building.units || 'ft',
      rooms: building.stories.flatMap((s) => s.spaces.map((sp) => ({ ...sp, ceilingHeightFt: sp.ceilingHeightFt || s.ceilingHeightFt }))),
    };
    if (!floorPlan.rooms.length) return { httpError: { status: 400, error: 'Building drawing has no spaces (need data-space polygons)' } };
  } else if (req.body && typeof req.body.svg === 'string' && req.body.svg.trim()) {
    // Import a floor plan from pasted/uploaded SVG (px scaled to ft).
    floorPlan = floorPlanFromSvg(req.body.svg, { name: projectName, unitsPerPx: Number(req.body.unitsPerPx) || 1 });
  } else if (req.body && req.body.floorPlan) {
    floorPlan = normalizeFloorPlan(req.body.floorPlan);
  } else if (projectName === HOME_DEPOT_PROJECT_NAME) {
    floorPlan = homeDepotRexburgFloorPlan();
  }
  if (!floorPlan) {
    return { httpError: { status: 400, error: 'Provide an svg, a floorPlan spec, or use a project with a built-in plan' } };
  }
  // Optional hazard override from the studio UI (applies to all rooms).
  if (req.body && ['light', 'ordinary', 'extra'].includes(String(req.body.hazard))) {
    floorPlan = { ...floorPlan, rooms: floorPlan.rooms.map((r) => ({ ...r, hazard: req.body.hazard })) };
  }
  const opts = {
    priceResolver: buildResolverFromDb(db),
    laborRatePerHead: Number(req.body?.laborRatePerHead) || 85,
    markupPct: Number(req.body?.markupPct) || 25,
  };
  const bid = generateSprinklerBid(floorPlan, opts);
  const scene = buildScene(floorPlan, bid);
  // 3D-correct CAD model. For a building drawing this carries interior+exterior
  // walls (with door/window opening metadata) + columns + per-space networks.
  const cadModel = building ? buildCadModel(building) : buildCadModel(floorPlan);

  // Record that a best-effort layout was generated — as evidence, not a clearance.
  if (normalizeRole(req.user?.role) === 'admin') {
    db.prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`).run(
      projectName,
      'best_effort_ai_layout',
      null,
      `engine ${bid.generatedBy}`,
      'best_effort',
      `Generated ${bid.totalHeadCount} heads over ${bid.totalAreaSqFt} sqft. ${bid.disclaimer}`,
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

  return { projectName, floorPlan, building, bid, scene, cadModel, hydraulics, hydraulicNetwork, compliance };
}

// Best-effort sprinkler auto-layout + auto-bid + hydraulic network balance +
// NFPA-13 geometric compliance. Fail-closed: NEVER clears any regulated gate.
app.post('/api/projects/:name/sprinkler-bid', authMiddleware, (req, res) => {
  try {
    const out = runSprinklerPipeline(req);
    if (out.httpError) return res.status(out.httpError.status).json({ error: out.httpError.error });
    const { bid, scene, cadModel, hydraulics, hydraulicNetwork, compliance, building } = out;
    res.json({ bid, scene, cadModel, hydraulics, hydraulicNetwork, compliance, isBuilding: !!building });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Best-effort downloadable SUBMITTAL package (head/pipe schedules, hydraulic
// summary, BOM, gate status). Fail-closed: header honesty flags stay false,
// gateStatus.submittalReady stays false, and the AUTOSPRINK_PARITY gate stays
// blocked — this clears NO regulated gate.
app.post('/api/projects/:name/submittal', authMiddleware, async (req, res) => {
  try {
    const out = runSprinklerPipeline(req);
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
    res.status(400).json({ error: err.message });
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
