/**
 * HaloFire Database Seed Script
 * Populates the database with sample data derived from the real bid log
 */

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { buildHomeDepotSeedRows } from '../data/home-depot-bid-package.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/halofire.db');
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
`);

const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!existingAdmin) {
  const fallbackAllowed = process.env.HALOFIRE_ALLOW_DEV_DEFAULTS === '1';
  const bootstrapPassword = process.env.HALOFIRE_ADMIN_PASSWORD || process.env.HALOFIRE_BOOTSTRAP_PASSWORD || (fallbackAllowed ? 'halofire2026' : null);
  if (!bootstrapPassword) {
    throw new Error('HALOFIRE_ADMIN_PASSWORD is required for seed unless HALOFIRE_ALLOW_DEV_DEFAULTS=1');
  }
  const hash = bcrypt.hashSync(bootstrapPassword, 12);
  db.prepare('INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)').run('admin', hash, 'Dallas Steele', 'admin', 'admin@halofireus.com');
}

console.log('[seed] Starting database seed...');

const homeDepotRows = buildHomeDepotSeedRows(PROJECT_ROOT);
db.prepare('DELETE FROM bids WHERE project = ?').run(homeDepotRows.bid.project);
db.prepare('DELETE FROM projects WHERE name = ?').run(homeDepotRows.project.name);
db.prepare('DELETE FROM compliance WHERE project_name = ?').run(homeDepotRows.compliance.project_name);

// ── Seed Bids (from real bid log patterns) ──
const bids = [
  homeDepotRows.bid,
  { project: "Walmart Supercenter - Twin Falls", contractor: "Boise Commercial Builders", value: 342000, status: "Pending", date: "2026-02-20", due_date: "2026-03-15", sqft: 185000, system_type: "Wet/Dry", contact: "Sarah Chen" },
  { project: "St. Luke's Medical - Meridian", contractor: "Hoffman Construction", value: 895000, status: "Won", date: "2026-01-08", due_date: "2026-01-20", sqft: 340000, system_type: "Wet/Preaction", contact: "Tom Bradley" },
  { project: "Micron Office Complex B3", contractor: "Engineered Structures", value: 567000, status: "Lost", date: "2025-12-10", due_date: "2025-12-28", sqft: 220000, system_type: "Wet", contact: "Linda Park" },
  { project: "Amazon Fulfillment - Nampa", contractor: "Turner Construction", value: 1250000, status: "Won", date: "2026-02-01", due_date: "2026-02-15", sqft: 850000, system_type: "ESFR", contact: "James Rodriguez" },
  { project: "Boise State Recreation Center", contractor: "Andersen Construction", value: 445000, status: "Pending", date: "2026-03-01", due_date: "2026-03-20", sqft: 175000, system_type: "Wet", contact: "Emily Watson" },
  { project: "Idaho Power HQ Renovation", contractor: "Petra Inc", value: 278000, status: "Won", date: "2025-11-15", due_date: "2025-12-01", sqft: 95000, system_type: "Wet/Standpipe", contact: "David Kim" },
  { project: "Costco - Caldwell", contractor: "Big-D Construction", value: 198000, status: "Pending", date: "2026-03-05", due_date: "2026-03-25", sqft: 150000, system_type: "ESFR", contact: "Rachel Moore" },
  { project: "Simplot Agribusiness Plant", contractor: "Hensel Phelps", value: 1780000, status: "Won", date: "2025-10-20", due_date: "2025-11-05", sqft: 520000, system_type: "Deluge/Preaction", contact: "Mark Sullivan" },
  { project: "Eagle High School Addition", contractor: "Wright Brothers", value: 165000, status: "Lost", date: "2026-01-25", due_date: "2026-02-10", sqft: 48000, system_type: "Wet", contact: "Karen Olsen" },
  { project: "Fred Meyer - Boise Towne", contractor: "Lease Crutcher Lewis", value: 225000, status: "Won", date: "2025-09-12", due_date: "2025-09-30", sqft: 110000, system_type: "Wet", contact: "Paul Nguyen" },
  { project: "St. Alphonsus ER Expansion", contractor: "Layton Construction", value: 612000, status: "Pending", date: "2026-03-10", due_date: "2026-04-01", sqft: 85000, system_type: "Wet/Preaction", contact: "Dr. Amy Cho" },
  { project: "WinCo Foods - Mountain Home", contractor: "McAlvain Construction", value: 245000, status: "Won", date: "2025-08-15", due_date: "2025-09-01", sqft: 130000, system_type: "ESFR", contact: "Tyler Graham" },
  { project: "Albertsons Distribution Center", contractor: "Okland Construction", value: 2100000, status: "Won", date: "2025-07-20", due_date: "2025-08-10", sqft: 780000, system_type: "ESFR", contact: "Beth Anderson" },
  { project: "Boise Airport Terminal B", contractor: "Mortenson Construction", value: 1450000, status: "Pending", date: "2026-02-28", due_date: "2026-03-30", sqft: 420000, system_type: "Wet/Standpipe", contact: "Greg Phillips" },
];

const insertBid = db.prepare('INSERT INTO bids (project, contractor, value, status, date, due_date, sqft, system_type, contact, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,1)');
const deleteSeedBid = db.prepare('DELETE FROM bids WHERE project = ?');
const bidTx = db.transaction(() => { for (const b of bids) insertBid.run(b.project, b.contractor, b.value, b.status, b.date, b.due_date, b.sqft, b.system_type, b.contact, b.notes || null); });
for (const b of bids) deleteSeedBid.run(b.project);
bidTx();
console.log(`[seed] Inserted ${bids.length} bids`);

// ── Seed Projects ──
const projects = [
  homeDepotRows.project,
  { name: "St. Luke's Medical - Meridian", phase: "Design", progress: 35, budget: 895000, spent: 156800, manager: "Dallas Steele", start_date: "2026-02-15", end_date: "2026-11-30", status: "On Track" },
  { name: "Amazon Fulfillment - Nampa", phase: "Fabrication", progress: 48, budget: 1250000, spent: 387000, manager: "Jake Torres", start_date: "2026-03-01", end_date: "2027-01-15", status: "Ahead" },
  { name: "Simplot Agribusiness Plant", phase: "Testing", progress: 91, budget: 1780000, spent: 1654000, manager: "Dallas Steele", start_date: "2025-06-01", end_date: "2026-04-01", status: "On Track" },
  { name: "Idaho Power HQ Renovation", phase: "Closeout", progress: 96, budget: 278000, spent: 271500, manager: "Maria Santos", start_date: "2025-08-01", end_date: "2026-03-30", status: "On Track" },
  { name: "Fred Meyer - Boise Towne", phase: "Closeout", progress: 100, budget: 225000, spent: 218400, manager: "Maria Santos", start_date: "2025-07-01", end_date: "2026-01-15", status: "Complete" },
  { name: "WinCo Foods - Mountain Home", phase: "Installation", progress: 65, budget: 245000, spent: 142300, manager: "Jake Torres", start_date: "2025-09-15", end_date: "2026-04-30", status: "On Track" },
  { name: "Albertsons Distribution Center", phase: "Installation", progress: 55, budget: 2100000, spent: 978000, manager: "Dallas Steele", start_date: "2025-09-01", end_date: "2026-08-15", status: "On Track" },
];

const insertProject = db.prepare('INSERT INTO projects (name, phase, progress, budget, spent, manager, start_date, end_date, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?)');
const deleteSeedProject = db.prepare('DELETE FROM projects WHERE name = ?');
const projTx = db.transaction(() => { for (const p of projects) insertProject.run(p.name, p.phase, p.progress, p.budget, p.spent, p.manager, p.start_date, p.end_date, p.status, p.notes || null); });
for (const p of projects) deleteSeedProject.run(p.name);
projTx();
console.log(`[seed] Inserted ${projects.length} projects`);

// ── Seed Pricebook (sample from ARGCO, FFF, Victaulic) ──
const priceItems = [
  { item: '1" CPVC Pipe (10ft)', supplier: "ARGCO", price: 12.45, unit: "LF", category: "Pipe" },
  { item: '1-1/4" CPVC Pipe (10ft)', supplier: "ARGCO", price: 15.80, unit: "LF", category: "Pipe" },
  { item: '1-1/2" CPVC Pipe (10ft)', supplier: "ARGCO", price: 19.25, unit: "LF", category: "Pipe" },
  { item: '2" Sch 40 Black Steel (21ft)', supplier: "ARGCO", price: 38.90, unit: "LF", category: "Pipe" },
  { item: '2-1/2" Sch 40 Black Steel (21ft)', supplier: "ARGCO", price: 52.30, unit: "LF", category: "Pipe" },
  { item: '3" Sch 40 Black Steel (21ft)', supplier: "ARGCO", price: 68.50, unit: "LF", category: "Pipe" },
  { item: '4" Sch 40 Black Steel (21ft)', supplier: "ARGCO", price: 95.00, unit: "LF", category: "Pipe" },
  { item: '6" Sch 40 Black Steel (21ft)', supplier: "ARGCO", price: 158.00, unit: "LF", category: "Pipe" },
  { item: '1-1/4" CPVC Tee', supplier: "ARGCO", price: 6.80, unit: "EA", category: "Fittings" },
  { item: '1-1/4" CPVC 90° Elbow', supplier: "ARGCO", price: 5.40, unit: "EA", category: "Fittings" },
  { item: '2" Grooved Tee', supplier: "ARGCO", price: 18.50, unit: "EA", category: "Fittings" },
  { item: '1" Viking Pendent Head (155°F)', supplier: "FFF", price: 8.75, unit: "EA", category: "Heads" },
  { item: '3/4" Viking Pendent Head (155°F)', supplier: "FFF", price: 7.90, unit: "EA", category: "Heads" },
  { item: '3/4" Sidewall Head (175°F)', supplier: "FFF", price: 15.20, unit: "EA", category: "Heads" },
  { item: 'Viking Concealed Head (165°F)', supplier: "FFF", price: 22.50, unit: "EA", category: "Heads" },
  { item: 'ESFR K25.2 Pendent (165°F)', supplier: "FFF", price: 48.00, unit: "EA", category: "Heads" },
  { item: '4" Alarm Check Valve', supplier: "FFF", price: 1250.00, unit: "EA", category: "Valves" },
  { item: '6" Alarm Check Valve', supplier: "FFF", price: 1850.00, unit: "EA", category: "Valves" },
  { item: '4" OS&Y Gate Valve', supplier: "FFF", price: 425.00, unit: "EA", category: "Valves" },
  { item: '2" Victaulic Style 77 Coupling', supplier: "Victaulic", price: 24.30, unit: "EA", category: "Fittings" },
  { item: '3" Victaulic Style 77 Coupling', supplier: "Victaulic", price: 35.60, unit: "EA", category: "Fittings" },
  { item: '4" Victaulic Style 77 Coupling', supplier: "Victaulic", price: 48.90, unit: "EA", category: "Fittings" },
  { item: '6" Victaulic Style 77 Coupling', supplier: "Victaulic", price: 67.80, unit: "EA", category: "Fittings" },
  { item: 'Victaulic Style 607 Valve 4"', supplier: "Victaulic", price: 485.00, unit: "EA", category: "Valves" },
  { item: 'Victaulic Style 607 Valve 6"', supplier: "Victaulic", price: 720.00, unit: "EA", category: "Valves" },
];

const insertPrice = db.prepare('INSERT INTO pricebook (item, supplier, price, unit, category, last_updated) VALUES (?,?,?,?,?,?)');
const priceTx = db.transaction(() => { for (const p of priceItems) insertPrice.run(p.item, p.supplier, p.price, p.unit, p.category, '2026-01-15'); });
priceTx();
console.log(`[seed] Inserted ${priceItems.length} pricebook items`);

// ── Seed Compliance ──
const complianceItems = [
  homeDepotRows.compliance,
  { project_name: "St. Luke's Medical - Meridian", type: "Design Review", due_date: "2026-03-25", status: "Due Soon", authority: "Ada County AHJ" },
  { project_name: "Simplot Agribusiness Plant", type: "Acceptance Test", due_date: "2026-03-18", status: "Due Soon", authority: "Canyon County Fire" },
  { project_name: "Idaho Power HQ", type: "Final Closeout", due_date: "2026-03-30", status: "In Progress", authority: "Boise Fire Dept" },
  { project_name: "Amazon Fulfillment - Nampa", type: "Rough-In Inspection", due_date: "2026-06-15", status: "Upcoming", authority: "Nampa Fire Marshal" },
  { project_name: "Albertsons Distribution Center", type: "Underground Inspection", due_date: "2026-04-10", status: "Upcoming", authority: "Meridian Fire Dept" },
];

const insertComp = db.prepare('INSERT INTO compliance (project_name, type, due_date, status, authority, notes) VALUES (?,?,?,?,?,?)');
const deleteSeedComp = db.prepare('DELETE FROM compliance WHERE project_name = ? AND type = ?');
const compTx = db.transaction(() => { for (const c of complianceItems) insertComp.run(c.project_name, c.type, c.due_date, c.status, c.authority, c.notes || null); });
for (const c of complianceItems) deleteSeedComp.run(c.project_name, c.type);
compTx();
console.log(`[seed] Inserted ${complianceItems.length} compliance items`);

console.log('[seed] Database seeded successfully!');
db.close();
