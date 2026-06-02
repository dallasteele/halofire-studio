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
    expect(autosprink.requires_signoff_for).toEqual(['autosprink_packet']);
    expect(autosprink.blocked_claims).toContain('AutoSprink parity');

    const sqft = body.gates.find((g) => g.code === 'BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL');
    expect(sqft.allowed_evidence_types).toEqual(['employee_signoff']);
    expect(sqft.can_resolve).toBe(true);
    expect(sqft.requires_signoff_for).toEqual([]);
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
    expect(html).toContain('id="wizSignoff"');
    expect(html).toContain('id="wizReviewerName"');
    expect(html).toContain('id="wizReviewerTitle"');
    expect(html).toContain('id="wizSignedAt"');
    expect(html).toContain('id="wizOrganization"');
    expect(html).toContain('id="wizLicenseId"');
    expect(html).toContain('requires_signoff_for');
    expect(html).toContain('evidence.signoff');
  });

  it('records signed reviewer metadata on evidence-only submissions without clearing the gate', async () => {
    const token = await tokenFor('wizard-admin', 'actual-test-password');
    expect((await gate(token, 'PROFESSIONAL_REVIEW_MISSING')).status).toBe('blocked');

    const res = await request(`${PROJECT_PATH}/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence_type: 'professional_review',
        source_ref: 'Signed reviewer packet PR-1881-001',
        source_file: 'professional-review-packet.pdf',
        status: 'present',
        notes: 'Recorded for later gate resolution.',
        signoff: {
          reviewer_name: 'Alex Rivera',
          reviewer_title: 'Fire Protection Engineer',
          signed_at: '2026-06-02T14:30:00.000Z',
          organization: 'Halo Fire',
          license_id: 'PE-2048',
        },
      }),
    });
    expect(res.status).toBe(201);

    const evidence = await (await request(`${PROJECT_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const row = evidence.find((item) => item.source_ref === 'Signed reviewer packet PR-1881-001');
    expect(row).toBeTruthy();
    expect(row.evidence_type).toBe('professional_review');
    expect(row.status).toBe('present');
    const storedNotes = JSON.parse(row.notes);
    expect(storedNotes).toEqual(expect.objectContaining({
      kind: 'signed_reviewer_evidence',
      evidence_type: 'professional_review',
      source_ref: 'Signed reviewer packet PR-1881-001',
      claim_gate_effect: 'no_claims_cleared',
      user_notes: 'Recorded for later gate resolution.',
    }));
    expect(storedNotes.signoff).toEqual(expect.objectContaining({
      reviewer_name: 'Alex Rivera',
      reviewer_title: 'Fire Protection Engineer',
      signed_at: '2026-06-02T14:30:00.000Z',
      organization: 'Halo Fire',
      license_id: 'PE-2048',
    }));
    expect((await gate(token, 'PROFESSIONAL_REVIEW_MISSING')).status).toBe('blocked');
  });

  it('resolves a regulated gate from an already-recorded signed evidence row without duplicating it', async () => {
    const token = await tokenFor('wizard-admin', 'actual-test-password');

    const recorded = await request(`${PROJECT_PATH}/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence_type: 'professional_review',
        source_ref: 'Signed reviewer packet PR-1881-002',
        source_file: 'professional-review-packet-2.pdf',
        status: 'present',
        notes: 'Recorded first, resolve later.',
        signoff: {
          reviewer_name: 'Jamie Chen',
          reviewer_title: 'Fire Protection Engineer',
          signed_at: '2026-06-02T15:45:00.000Z',
          organization: 'Halo Fire',
          license_id: 'PE-4096',
        },
      }),
    });
    expect(recorded.status).toBe(201);
    const recordedBody = await recorded.json();

    const beforeRows = await (await request(`${PROJECT_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const rowCountBeforeResolve = beforeRows.length;

    const resolve = await request(`${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/resolve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence_id: recordedBody.id,
      }),
    });
    expect(resolve.status).toBe(200);
    const resolvedBody = await resolve.json();
    expect(resolvedBody.cleared).toBe(true);
    expect(resolvedBody.resolved_evidence_id).toBe(recordedBody.id);
    expect(resolvedBody.resolved_evidence_ref).toBe('Signed reviewer packet PR-1881-002');

    const afterRows = await (await request(`${PROJECT_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(afterRows).toHaveLength(rowCountBeforeResolve);
    const resolvedRow = afterRows.find((item) => item.id === recordedBody.id);
    expect(resolvedRow).toBeTruthy();
    const resolvedNotes = JSON.parse(resolvedRow.notes);
    expect(resolvedNotes.signoff).toEqual(expect.objectContaining({
      reviewer_name: 'Jamie Chen',
      reviewer_title: 'Fire Protection Engineer',
      signed_at: '2026-06-02T15:45:00.000Z',
    }));
    expect((await gate(token, 'PROFESSIONAL_REVIEW_MISSING')).status).toBe('cleared');
  });
});
