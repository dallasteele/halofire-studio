import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

import {
  HOME_DEPOT_PROJECT_NAME,
  buildHomeDepotEvidenceRows,
  buildHomeDepotClaimGates,
} from '../src/data/evidence-gates.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3198;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_PATH = `/api/projects/${encodeURIComponent(HOME_DEPOT_PROJECT_NAME)}`;

let server;
let tempDir;
let dbPath;

function request(pathname, options = {}) {
  return fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    try {
      const res = await request('/api/health');
      if (res.ok) return;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('HaloFire API did not become healthy for evidence tests');
}

async function tokenFor(username, password) {
  const res = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).token;
}

function seedEvidenceAndGates() {
  const db = new Database(dbPath);
  const insertEvidence = db.prepare(
    `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const row of buildHomeDepotEvidenceRows()) {
    insertEvidence.run(row.projectName, row.evidenceType, row.sourceFile, row.sourceRef, row.status, row.notes);
  }
  const insertGate = db.prepare(
    `INSERT OR REPLACE INTO claim_gates
       (project_name, code, severity, missing_artifact, acceptable_evidence, blocked_claims, next_action, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const gate of buildHomeDepotClaimGates()) {
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
  // a non-admin viewer for authorization checks
  const hash = bcrypt.hashSync('viewer-password', 12);
  db.prepare('INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)').run(
    'evidence-viewer', hash, 'Viewer', 'user', 'viewer@example.test',
  );
  db.close();
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-evidence-api-'));
  dbPath = path.join(tempDir, 'halofire.db');
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: dbPath,
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'evidence-admin',
      HALOFIRE_ADMIN_PASSWORD: 'actual-test-password',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  seedEvidenceAndGates();
});

afterAll(async () => {
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('HaloFire evidence and claim-gate API', () => {
  it('exposes a public summary with real non-sensitive counts (no auth)', async () => {
    const res = await request('/api/public/summary');
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(s.status).toBe('internal-alpha');
    expect(s.claimGates).toBeGreaterThanOrEqual(5);
    expect(typeof s.bidsTracked).toBe('number');
    expect(s.sourceWorkbooks).toBe(4);
  });

  it('requires authentication to read claim gates', async () => {
    const res = await request(`${PROJECT_PATH}/claim-gates`);
    expect(res.status).toBe(401);
  });

  it('returns the fail-closed claim gates with parsed blocked claims', async () => {
    const token = await tokenFor('evidence-admin', 'actual-test-password');
    const res = await request(`${PROJECT_PATH}/claim-gates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const gates = await res.json();
    const codes = gates.map((g) => g.code);
    expect(codes).toEqual(expect.arrayContaining([
      'AUTOSPRINK_EVIDENCE_MISSING',
      'AHJ_APPROVAL_MISSING',
      'PROFESSIONAL_REVIEW_MISSING',
      'MANUFACTURER_MODEL_APPROVAL_MISSING',
      'BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL',
    ]));
    const autosprink = gates.find((g) => g.code === 'AUTOSPRINK_EVIDENCE_MISSING');
    expect(autosprink.status).toBe('blocked');
    expect(autosprink.blocked_claims).toContain('AutoSprink parity');
  });

  it('returns present source evidence rows', async () => {
    const token = await tokenFor('evidence-admin', 'actual-test-password');
    const res = await request(`${PROJECT_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const evidence = await res.json();
    expect(evidence.length).toBeGreaterThanOrEqual(5);
    expect(evidence.some((e) => e.evidence_type === 'proposal_workbook' && e.status === 'present')).toBe(true);
  });

  it('blocks non-admin users from posting evidence', async () => {
    const token = await tokenFor('evidence-viewer', 'viewer-password');
    const res = await request(`${PROJECT_PATH}/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ evidence_type: 'ahj_approval', status: 'present', source_ref: 'sneaky' }),
    });
    expect(res.status).toBe(403);
  });

  it('lets an admin add a new evidence row that persists', async () => {
    const token = await tokenFor('evidence-admin', 'actual-test-password');
    const res = await request(`${PROJECT_PATH}/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence_type: 'employee_note',
        status: 'present',
        source_ref: 'manual entry',
        notes: 'Field verification scheduled.',
      }),
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.id).toBeGreaterThan(0);

    const list = await (await request(`${PROJECT_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(list.some((e) => e.evidence_type === 'employee_note')).toBe(true);
  });

  it('generates a best-effort sprinkler bid + 3D scene without clearing any gate', async () => {
    const token = await tokenFor('evidence-admin', 'actual-test-password');
    const res = await request(`${PROJECT_PATH}/sprinkler-bid`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ markupPct: 30 }),
    });
    expect(res.status).toBe(200);
    const { bid, scene } = await res.json();
    expect(bid.totalAreaSqFt).toBe(121500);
    expect(bid.totalHeadCount).toBeGreaterThan(0);
    expect(bid.pricing.total).toBeGreaterThan(0);
    expect(bid.pricing.markupPct).toBe(30);
    expect(bid.blockedClaims).toContain('AutoSprink parity');
    expect(scene.walls.length).toBe(4);
    expect(scene.heads.length).toBe(bid.totalHeadCount);

    // The generated layout must NOT have cleared the blocking gates.
    const gates = await (await request(`${PROJECT_PATH}/claim-gates`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(gates.find((g) => g.code === 'AUTOSPRINK_EVIDENCE_MISSING').status).toBe('blocked');
  });

  it('does not let best-effort AI evidence clear a blocking professional/AHJ/AutoSprink gate', async () => {
    const token = await tokenFor('evidence-admin', 'actual-test-password');
    await request(`${PROJECT_PATH}/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence_type: 'best_effort_ai_layout',
        status: 'best_effort',
        source_ref: 'internal alpha generated layout',
      }),
    });
    const gates = await (await request(`${PROJECT_PATH}/claim-gates`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    for (const code of ['AUTOSPRINK_EVIDENCE_MISSING', 'AHJ_APPROVAL_MISSING', 'PROFESSIONAL_REVIEW_MISSING', 'MANUFACTURER_MODEL_APPROVAL_MISSING']) {
      expect(gates.find((g) => g.code === code).status).toBe('blocked');
    }
  });
});
