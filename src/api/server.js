/**
 * HaloFire API Server
 * Express backend with SQLite database, JWT auth, and skill integration
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
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
import { floorPlanFromSvg, normalizeFloorPlan } from '../engine/floorplan-import.js';
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
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.resolve(__dirname, '../../')));
// Serve the bundled Three.js locally (no external CDN dependency for the 3D view).
app.use('/vendor/three', express.static(path.resolve(__dirname, '../../node_modules/three')));

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

// Best-effort sprinkler auto-layout + auto-bid. Fail-closed: this NEVER clears
// AutoSprink/AHJ/PE/manufacturer gates; it records a best_effort evidence row.
app.post('/api/projects/:name/sprinkler-bid', authMiddleware, (req, res) => {
  try {
    const projectName = req.params.name;
    let floorPlan = null;
    if (req.body && typeof req.body.svg === 'string' && req.body.svg.trim()) {
      // Import a floor plan from pasted/uploaded SVG (px scaled to ft).
      floorPlan = floorPlanFromSvg(req.body.svg, { name: projectName, unitsPerPx: Number(req.body.unitsPerPx) || 1 });
    } else if (req.body && req.body.floorPlan) {
      floorPlan = normalizeFloorPlan(req.body.floorPlan);
    } else if (projectName === HOME_DEPOT_PROJECT_NAME) {
      floorPlan = homeDepotRexburgFloorPlan();
    }
    if (!floorPlan) {
      return res.status(400).json({ error: 'Provide an svg, a floorPlan spec, or use a project with a built-in plan' });
    }
    const opts = {
      priceResolver: buildResolverFromDb(db),
      laborRatePerHead: Number(req.body?.laborRatePerHead) || 85,
      markupPct: Number(req.body?.markupPct) || 25,
    };
    const bid = generateSprinklerBid(floorPlan, opts);
    const scene = buildScene(floorPlan, bid);

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
    res.json({ bid, scene });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

// ── Health Check ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', uptime: process.uptime() });
});

// ── Serve SPA ──
app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../../app.html'));
});

// ── Start ──
app.listen(PORT, () => {
  log.info(`HaloFire API running on port ${PORT}`);
});

export default app;
