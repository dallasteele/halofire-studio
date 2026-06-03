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
const PORT = 3196;
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
  throw new Error('HaloFire API did not become healthy for evidence-wizard packet tests');
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

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-evidence-wizard-packets-'));
  dbPath = path.join(tempDir, 'halofire.db');
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: dbPath,
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'packet-admin',
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

describe('HaloFire evidence wizard signed reviewer packets', () => {
  it('surfaces a gate review-packet download for regulated evidence lanes', async () => {
    const token = await tokenFor('packet-admin', 'actual-test-password');
    const res = await request(`${PROJECT_PATH}/evidence-wizard`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const autosprink = body.gates.find((gate) => gate.code === 'AUTOSPRINK_EVIDENCE_MISSING');
    expect(autosprink.review_packet_href).toBe(`${PROJECT_PATH}/claim-gates/AUTOSPRINK_EVIDENCE_MISSING/review-packet`);
    expect(autosprink.review_packet_artifact_type).toBe('halofire.claim_gate_review_packet.v1');
    expect(autosprink.requires_signoff_for).toEqual(['autosprink_packet']);
  });

  it('builds a signed reviewer packet for a regulated gate without clearing claims', async () => {
    const token = await tokenFor('packet-admin', 'actual-test-password');
    const res = await request(`${PROJECT_PATH}/claim-gates/AHJ_APPROVAL_MISSING/review-packet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifact_type).toBe('halofire.claim_gate_review_packet.v1');
    expect(body.project_name).toBe(HOME_DEPOT_PROJECT_NAME);
    expect(body.claim_gate.code).toBe('AHJ_APPROVAL_MISSING');
    expect(body.required_signoff_fields).toEqual(['reviewer_name', 'reviewer_title', 'signed_at']);
    expect(body.allowed_evidence_types).toEqual(['ahj_approval']);
    expect(body.required_evidence_type).toBe('ahj_approval');
    expect(body.resolve_route).toBe(`${PROJECT_PATH}/claim-gates/AHJ_APPROVAL_MISSING/resolve`);
    expect(body.record_evidence_route).toBe(`${PROJECT_PATH}/evidence`);
    expect(body.claim_gate_effect).toBe('no_claims_cleared');
    expect(body.blocked_claims).toEqual(expect.arrayContaining(['AHJ-approved', 'permit-ready']));
  });

  it('builds an employee-signoff packet for non-regulated internal review lanes', async () => {
    const token = await tokenFor('packet-admin', 'actual-test-password');
    const res = await request(`${PROJECT_PATH}/claim-gates/BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL/review-packet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.required_signoff_fields).toEqual([]);
    expect(body.required_evidence_type).toBe('employee_signoff');
    expect(body.allowed_evidence_types).toEqual(['employee_signoff']);
    expect(body.required_review_fields).toEqual(expect.arrayContaining(['source_ref', 'notes']));
    expect(body.blocked_claims).toEqual(expect.arrayContaining(['final sqft-based pricing']));
  });
});
