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
const PORT = 3199;
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
  throw new Error('HaloFire API did not become healthy for resolve-gate tests');
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
  const hash = bcrypt.hashSync('viewer-password', 12);
  db.prepare('INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)').run(
    'gate-viewer', hash, 'Viewer', 'user', 'viewer@example.test',
  );
  db.close();
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-resolve-gate-'));
  dbPath = path.join(tempDir, 'halofire.db');
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: dbPath,
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'gate-admin',
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

const RESOLVE_PATH = (code) => `${PROJECT_PATH}/claim-gates/${code}/resolve`;

async function gate(token, code) {
  const gates = await (await request(`${PROJECT_PATH}/claim-gates`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  return gates.find((g) => g.code === code);
}

describe('HaloFire resolve-gate API (evidence-gated)', () => {
  it('lets an admin clear AUTOSPRINK_EVIDENCE_MISSING with a real autosprink_packet evidence row', async () => {
    const token = await tokenFor('gate-admin', 'actual-test-password');
    expect((await gate(token, 'AUTOSPRINK_EVIDENCE_MISSING')).status).toBe('blocked');

    const res = await request(RESOLVE_PATH('AUTOSPRINK_EVIDENCE_MISSING'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence: {
          evidence_type: 'autosprink_packet',
          source_ref: 'AutoSprink export packet #HD-REX-001',
          source_file: 'home-depot-rexburg.sprink',
          notes: 'Signed AutoSprink comparison packet received from design partner.',
          signoff: {
            reviewer_name: 'Dana Ortiz',
            reviewer_title: 'Design Manager',
            signed_at: '2026-06-01T22:15:00.000Z',
            organization: 'Halo Fire',
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cleared).toBe(true);

    const cleared = await gate(token, 'AUTOSPRINK_EVIDENCE_MISSING');
    expect(cleared.status).toBe('cleared');
    expect(cleared.resolved_by).toBe('gate-admin');
    expect(cleared.resolved_evidence_ref).toBe('AutoSprink export packet #HD-REX-001');

    // the evidence row must now exist with status 'present'
    const evidence = await (await request(`${PROJECT_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const row = evidence.find((e) => e.evidence_type === 'autosprink_packet' && e.status === 'present');
    expect(row).toBeTruthy();
    const notes = JSON.parse(row.notes);
    expect(notes.kind).toBe('signed_reviewer_evidence');
    expect(notes.target_gate_code).toBe('AUTOSPRINK_EVIDENCE_MISSING');
    expect(notes.required_evidence_type).toBe('autosprink_packet');
    expect(notes.review_packet_href).toBe(`${PROJECT_PATH}/claim-gates/AUTOSPRINK_EVIDENCE_MISSING/review-packet`);
    expect(notes.review_packet_artifact_type).toBe('halofire.claim_gate_review_packet.v1');
    expect(notes.resolve_audit_packet_href).toBe(`${PROJECT_PATH}/claim-gates/AUTOSPRINK_EVIDENCE_MISSING/resolve-audit-packet`);
    expect(notes.resolve_audit_packet_artifact_type).toBe('halofire.claim_gate_resolve_audit_packet.v1');
    expect(notes.claim_gate_effect).toBe('gate_cleared_after_explicit_signed_validation');
    expect(notes.signoff).toEqual(expect.objectContaining({
      reviewer_name: 'Dana Ortiz',
      reviewer_title: 'Design Manager',
      signed_at: '2026-06-01T22:15:00.000Z',
      organization: 'Halo Fire',
    }));
  });

  it('forbids non-admin users from resolving a gate', async () => {
    const token = await tokenFor('gate-viewer', 'viewer-password');
    const res = await request(RESOLVE_PATH('AHJ_APPROVAL_MISSING'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence: { evidence_type: 'ahj_approval', source_ref: 'sneaky' },
      }),
    });
    expect(res.status).toBe(403);

    const adminToken = await tokenFor('gate-admin', 'actual-test-password');
    expect((await gate(adminToken, 'AHJ_APPROVAL_MISSING')).status).toBe('blocked');
  });

  it('rejects best_effort_ai_layout evidence and leaves the gate blocked', async () => {
    const token = await tokenFor('gate-admin', 'actual-test-password');
    const res = await request(RESOLVE_PATH('PROFESSIONAL_REVIEW_MISSING'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence: {
          evidence_type: 'best_effort_ai_layout',
          source_ref: 'internal alpha generated layout',
        },
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect((await gate(token, 'PROFESSIONAL_REVIEW_MISSING')).status).toBe('blocked');
  });

  it('rejects best_effort status even with an approved evidence_type, leaving the gate blocked', async () => {
    const token = await tokenFor('gate-admin', 'actual-test-password');
    const res = await request(RESOLVE_PATH('MANUFACTURER_MODEL_APPROVAL_MISSING'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence: {
          evidence_type: 'manufacturer_approval',
          status: 'best_effort',
          source_ref: 'guessed model selection',
        },
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect((await gate(token, 'MANUFACTURER_MODEL_APPROVAL_MISSING')).status).toBe('blocked');
  });

  it('rejects regulated gate evidence without signed reviewer metadata and leaves the gate blocked', async () => {
    const token = await tokenFor('gate-admin', 'actual-test-password');
    const res = await request(RESOLVE_PATH('AHJ_APPROVAL_MISSING'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence: {
          evidence_type: 'ahj_approval',
          source_ref: 'AHJ packet #R-42',
        },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/signoff/i);
    expect((await gate(token, 'AHJ_APPROVAL_MISSING')).status).toBe('blocked');
  });

  it('rejects saved signed-reviewer evidence that is explicitly record-only/no_claims_cleared', async () => {
    const token = await tokenFor('gate-admin', 'actual-test-password');
    const recordOnly = await request(`${PROJECT_PATH}/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence_type: 'ahj_approval',
        source_ref: 'internal-alpha://ahj-placeholder/pending-real-approval',
        source_file: 'internal-alpha-ahj-placeholder.json',
        status: 'present',
        target_gate_code: 'AHJ_APPROVAL_MISSING',
        notes: 'Record-only AHJ placeholder from official-flow signed reviewer workflow; no claims cleared.',
        signoff: {
          reviewer_name: 'HaloFire Internal Alpha',
          reviewer_title: 'Placeholder Reviewer - Replace With AHJ Approval',
          signed_at: '2026-06-04T22:00:00.000Z',
          organization: 'HaloFire Internal Alpha',
        },
      }),
    });
    expect(recordOnly.status).toBe(201);
    const { id } = await recordOnly.json();

    const evidence = await (await request(`${PROJECT_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const row = evidence.find((item) => item.id === id);
    expect(row).toBeTruthy();
    expect(JSON.parse(row.notes).claim_gate_effect).toBe('no_claims_cleared');

    const res = await request(RESOLVE_PATH('AHJ_APPROVAL_MISSING'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ evidence_id: id }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no_claims_cleared|record-only|explicit claim-gate resolve/i);
    expect((await gate(token, 'AHJ_APPROVAL_MISSING')).status).toBe('blocked');
  });

  it('rejects a resolve with missing evidence (400)', async () => {
    const token = await tokenFor('gate-admin', 'actual-test-password');
    const res = await request(RESOLVE_PATH('AHJ_APPROVAL_MISSING'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await gate(token, 'AHJ_APPROVAL_MISSING')).status).toBe('blocked');
  });
});
