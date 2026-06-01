import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import {
  HOME_DEPOT_PROJECT_NAME,
  buildHomeDepotEvidenceRows,
  buildHomeDepotClaimGates,
} from '../src/data/evidence-gates.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3197;
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
  throw new Error('HaloFire API did not become healthy for evidence-wizard tests');
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
  db.close();
}

async function gate(token, code) {
  const res = await request(`${PROJECT_PATH}/claim-gates`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const gates = await res.json();
  return gates.find((g) => g.code === code);
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-evidence-wizard-'));
  dbPath = path.join(tempDir, 'halofire.db');
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: dbPath,
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'wizard-admin',
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

describe('HaloFire evidence wizard slice', () => {
  it('serves gate-specific wizard metadata for the project', async () => {
    const token = await tokenFor('wizard-admin', 'actual-test-password');
    const res = await request(`${PROJECT_PATH}/evidence-wizard`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.project_name).toBe(HOME_DEPOT_PROJECT_NAME);
    expect(body.can_write).toBe(true);
    expect(body.summary.blocked).toBeGreaterThanOrEqual(1);

    const autosprink = body.gates.find((g) => g.code === 'AUTOSPRINK_EVIDENCE_MISSING');
    expect(autosprink.allowed_evidence_types).toEqual(['autosprink_packet']);
    expect(autosprink.can_resolve).toBe(true);
    expect(autosprink.blocked_claims).toContain('AutoSprink parity');

    const sqft = body.gates.find((g) => g.code === 'BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL');
    expect(sqft.allowed_evidence_types).toEqual(['employee_signoff']);
    expect(sqft.can_resolve).toBe(true);
  });

  it('rejects evidence that does not match the gate-specific allowed types', async () => {
    const token = await tokenFor('wizard-admin', 'actual-test-password');
    const res = await request(`${PROJECT_PATH}/claim-gates/AUTOSPRINK_EVIDENCE_MISSING/resolve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence: {
          evidence_type: 'manufacturer_approval',
          source_ref: 'wrong artifact',
        },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/allowed evidence types/i);
    expect((await gate(token, 'AUTOSPRINK_EVIDENCE_MISSING')).status).toBe('blocked');
  });

  it('keeps the settings surface wired to the employee-facing evidence wizard', async () => {
    const res = await request('/settings.html');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/Evidence Wizard/i);
    expect(html).toMatch(/Resolve gate/i);
    expect(html).toMatch(/Record evidence only/i);
  });
});
