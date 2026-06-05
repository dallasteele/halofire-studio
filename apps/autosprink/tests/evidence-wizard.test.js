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
    expect(html).toContain('Download resolve audit');
    expect(html).toContain('downloadClaimGateResolveAuditPacket');
    expect(html).toContain('halofire.claim_gate_resolve_audit_packet.v1');
  });

  it('records signed reviewer metadata on evidence-only submissions without clearing the gate', async () => {
    const token = await tokenFor('wizard-admin', 'actual-test-password');
    expect((await gate(token, 'PROFESSIONAL_REVIEW_MISSING')).status).toBe('blocked');

    const res = await request(`${PROJECT_PATH}/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence_type: 'professional_review',
        target_gate_code: 'PROFESSIONAL_REVIEW_MISSING',
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
      target_gate_code: 'PROFESSIONAL_REVIEW_MISSING',
      required_evidence_type: 'professional_review',
      review_packet_href: `${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/review-packet`,
      review_packet_artifact_type: 'halofire.claim_gate_review_packet.v1',
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
    expect(row).toEqual(expect.objectContaining({
      signoff: expect.objectContaining({
        reviewer_name: 'Alex Rivera',
        reviewer_title: 'Fire Protection Engineer',
        signed_at: '2026-06-02T14:30:00.000Z',
      }),
      target_gate_code: 'PROFESSIONAL_REVIEW_MISSING',
      required_evidence_type: 'professional_review',
      review_packet_href: `${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/review-packet`,
      review_packet_artifact_type: 'halofire.claim_gate_review_packet.v1',
      claim_gate_effect: 'no_claims_cleared',
      user_notes: 'Recorded for later gate resolution.',
    }));
    expect((await gate(token, 'PROFESSIONAL_REVIEW_MISSING')).status).toBe('blocked');
  });

  it('rejects signed reviewer evidence when the requested gate does not accept that evidence type', async () => {
    const token = await tokenFor('wizard-admin', 'actual-test-password');

    const res = await request(`${PROJECT_PATH}/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence_type: 'professional_review',
        target_gate_code: 'AUTOSPRINK_EVIDENCE_MISSING',
        source_ref: 'Mismatched signed reviewer packet',
        status: 'present',
        notes: 'Should fail closed.',
        signoff: {
          reviewer_name: 'Jordan Vale',
          reviewer_title: 'Fire Protection Engineer',
          signed_at: '2026-06-03T09:15:00.000Z',
        },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/only accepts allowed evidence types/i);
  });

  it('only offers gate-clearable recorded evidence rows in matching_evidence', async () => {
    const token = await tokenFor('wizard-admin', 'actual-test-password');
    const db = new Database(dbPath);
    const unsignedInsert = db
      .prepare(`INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        HOME_DEPOT_PROJECT_NAME,
        'professional_review',
        'professional-review-packet-3.pdf',
        'Legacy unsigned reviewer packet PR-1881-003',
        'present',
        'Legacy row without signed reviewer metadata.',
      );
    db.close();
    const unsignedEvidenceId = Number(unsignedInsert.lastInsertRowid);

    const signed = await request(`${PROJECT_PATH}/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence_type: 'professional_review',
        source_ref: 'Signed reviewer packet PR-1881-004',
        source_file: 'professional-review-packet-4.pdf',
        status: 'present',
        notes: 'Signed reviewer metadata should make this row reusable.',
        signoff: {
          reviewer_name: 'Taylor Brooks',
          reviewer_title: 'Fire Protection Engineer',
          signed_at: '2026-06-02T16:00:00.000Z',
          organization: 'Halo Fire',
          license_id: 'PE-8192',
        },
      }),
    });
    expect(signed.status).toBe(201);
    const signedBody = await signed.json();

    const res = await request(`${PROJECT_PATH}/evidence-wizard`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const gateRow = body.gates.find((g) => g.code === 'PROFESSIONAL_REVIEW_MISSING');
    expect(gateRow).toBeTruthy();
    expect(gateRow.matching_evidence_count).toBe(0);
    const matchingIds = gateRow.matching_evidence.map((item) => item.id);
    expect(matchingIds).not.toContain(signedBody.id);
    expect(matchingIds).not.toContain(unsignedEvidenceId);
    expect(gateRow.matching_evidence.some((item) => item.source_ref === 'Signed reviewer packet PR-1881-004')).toBe(false);
    const signedEvidenceRows = await (await request(`${PROJECT_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const signedRow = signedEvidenceRows.find((item) => item.id === signedBody.id);
    expect(signedRow).toBeTruthy();
    const signedNotes = JSON.parse(signedRow.notes);
    expect(signedNotes).toEqual(expect.objectContaining({
      kind: 'signed_reviewer_evidence',
      source_ref: 'Signed reviewer packet PR-1881-004',
      claim_gate_effect: 'no_claims_cleared',
      signoff: expect.objectContaining({
        reviewer_name: 'Taylor Brooks',
        reviewer_title: 'Fire Protection Engineer',
        signed_at: '2026-06-02T16:00:00.000Z',
      }),
    }));
    expect(signedNotes.target_gate_code).toBeUndefined();
    expect(signedNotes.resolve_audit_packet_href).toBeUndefined();
    const packetRes = await request(`${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/review-packet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(packetRes.status).toBe(200);
    const packet = await packetRes.json();
    expect(packet).toEqual(expect.objectContaining({
      artifact_type: 'halofire.claim_gate_review_packet.v1',
      project_name: HOME_DEPOT_PROJECT_NAME,
      review_packet_href: `${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/review-packet`,
    }));
    expect(packet.allowed_evidence_types).toContain('professional_review');
  });

  it('rejects record-only signed evidence rows and resolves with explicit signed evidence upload', async () => {
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
    const recordOnlyRow = beforeRows.find((item) => item.id === recordedBody.id);
    expect(recordOnlyRow).toBeTruthy();
    const recordOnlyNotes = JSON.parse(recordOnlyRow.notes);
    expect(recordOnlyNotes).toEqual(expect.objectContaining({
      kind: 'signed_reviewer_evidence',
      source_ref: 'Signed reviewer packet PR-1881-002',
      claim_gate_effect: 'no_claims_cleared',
    }));

    const rejectedReuse = await request(`${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/resolve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence_id: recordedBody.id,
      }),
    });
    expect(rejectedReuse.status).toBe(400);
    const rejectedBody = await rejectedReuse.json();
    expect(rejectedBody.error).toMatch(/record-only|no_claims_cleared|explicit claim-gate resolve/i);
    expect((await gate(token, 'PROFESSIONAL_REVIEW_MISSING')).status).toBe('blocked');

    const afterRejectedRows = await (await request(`${PROJECT_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(afterRejectedRows).toHaveLength(rowCountBeforeResolve);

    const resolve = await request(`${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/resolve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence: {
          evidence_type: 'professional_review',
          source_ref: 'Signed reviewer packet PR-1881-002-explicit',
          source_file: 'professional-review-packet-2-explicit.pdf',
          status: 'present',
          notes: 'Explicit claim-gate resolve upload.',
          signoff: {
            reviewer_name: 'Jamie Chen',
            reviewer_title: 'Fire Protection Engineer',
            signed_at: '2026-06-02T15:45:00.000Z',
            organization: 'Halo Fire',
            license_id: 'PE-4096',
          },
        },
      }),
    });
    expect(resolve.status).toBe(200);
    const resolvedBody = await resolve.json();
    expect(resolvedBody.cleared).toBe(true);
    expect(resolvedBody.resolved_evidence_id).not.toBe(recordedBody.id);
    expect(resolvedBody.resolved_evidence_ref).toBe('Signed reviewer packet PR-1881-002-explicit');
    expect(resolvedBody.resolve_audit_packet_href).toBe(`${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/resolve-audit-packet`);
    expect(resolvedBody.resolve_audit_packet_artifact_type).toBe('halofire.claim_gate_resolve_audit_packet.v1');

    const auditRes = await request(`${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/resolve-audit-packet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(auditRes.status).toBe(200);
    const audit = await auditRes.json();
    expect(audit).toEqual(expect.objectContaining({
      artifact_type: 'halofire.claim_gate_resolve_audit_packet.v1',
      status: 'gate_cleared_with_explicit_signed_evidence',
      project_name: HOME_DEPOT_PROJECT_NAME,
      gate_code: 'PROFESSIONAL_REVIEW_MISSING',
      resolved_evidence_id: resolvedBody.resolved_evidence_id,
      resolved_evidence_ref: 'Signed reviewer packet PR-1881-002-explicit',
      resolved_by: 'wizard-admin',
      claim_gate_effect: 'gate_cleared_after_explicit_signed_validation',
    }));
    expect(audit.claim_gate).toEqual(expect.objectContaining({
      code: 'PROFESSIONAL_REVIEW_MISSING',
      status: 'cleared',
    }));
    expect(audit.resolved_evidence).toEqual(expect.objectContaining({
      id: resolvedBody.resolved_evidence_id,
      evidence_type: 'professional_review',
      has_signed_reviewer_metadata: true,
    }));
    expect(audit.validation_steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'GATE_ALLOWED_EVIDENCE_TYPE_CONFIRMED', status: 'passed' }),
      expect.objectContaining({ code: 'EVIDENCE_STATUS_PRESENT_CONFIRMED', status: 'passed' }),
      expect.objectContaining({ code: 'SIGNED_REVIEWER_METADATA_CONFIRMED', status: 'passed' }),
    ]));
    expect(audit.limitations).toEqual(expect.arrayContaining([
      expect.stringMatching(/does not clear unrelated/i),
    ]));

    const auditQueueRes = await request(`${PROJECT_PATH}/resolver-queue?claimGateAudit=cleared&targetGate=PROFESSIONAL_REVIEW_MISSING`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(auditQueueRes.status).toBe(200);
    const auditQueue = await auditQueueRes.json();
    expect(auditQueue.filters).toEqual(expect.objectContaining({
      claimGateAudit: 'cleared',
      targetGate: 'PROFESSIONAL_REVIEW_MISSING',
    }));
    expect(auditQueue.summary.claim_gate_resolve_audit_cleared).toBeGreaterThanOrEqual(1);
    expect(auditQueue.summary.claim_gate_resolve_audit_ready_for_download).toBeGreaterThanOrEqual(1);
    expect(auditQueue.items).toEqual([
      expect.objectContaining({
        kind: 'claim_gate_resolve_audit',
        code: 'PROFESSIONAL_REVIEW_MISSING',
        status: 'cleared',
        resolved_evidence_id: resolvedBody.resolved_evidence_id,
        audit_packet_action: expect.objectContaining({
          artifact_type: 'halofire.claim_gate_resolve_audit_packet.v1',
          href: `${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/resolve-audit-packet`,
        }),
        claim_gate_effect: 'gate_cleared_after_explicit_signed_validation',
      }),
    ]);

    const settingsRes = await request('/settings.html');
    expect(settingsRes.status).toBe(200);
    const settingsHtml = await settingsRes.text();
    expect(settingsHtml).toContain('Resolved Signed-Reviewer Gates');
    expect(settingsHtml).toContain('loadSettingsResolvedSignedReviewerGates');
    expect(settingsHtml).toContain('data-settings-resolved-gate-row');
    expect(settingsHtml).toContain('data-settings-resolved-gate-code');
    expect(settingsHtml).toContain('data-settings-resolved-gate-audit-href');
    expect(settingsHtml).toContain('data-settings-resolved-gate-audit-download');
    expect(settingsHtml).toContain('claimGateAudit=cleared');
    expect(settingsHtml).toContain('gate_cleared_after_explicit_signed_validation');

    const afterRows = await (await request(`${PROJECT_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(afterRows).toHaveLength(rowCountBeforeResolve + 1);
    const unchangedRecordedRow = afterRows.find((item) => item.id === recordedBody.id);
    expect(unchangedRecordedRow).toBeTruthy();
    expect(JSON.parse(unchangedRecordedRow.notes)).toEqual(expect.objectContaining({
      kind: 'signed_reviewer_evidence',
      claim_gate_effect: 'no_claims_cleared',
    }));

    const resolvedRow = afterRows.find((item) => item.id === resolvedBody.resolved_evidence_id);
    expect(resolvedRow).toBeTruthy();
    const resolvedNotes = JSON.parse(resolvedRow.notes);
    expect(resolvedNotes).toEqual(expect.objectContaining({
      kind: 'signed_reviewer_evidence',
      target_gate_code: 'PROFESSIONAL_REVIEW_MISSING',
      review_packet_href: `${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/review-packet`,
      resolve_audit_packet_href: `${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/resolve-audit-packet`,
      resolve_audit_packet_artifact_type: 'halofire.claim_gate_resolve_audit_packet.v1',
      claim_gate_effect: 'gate_cleared_after_explicit_signed_validation',
    }));
    expect(resolvedNotes.signoff).toEqual(expect.objectContaining({
      reviewer_name: 'Jamie Chen',
      reviewer_title: 'Fire Protection Engineer',
      signed_at: '2026-06-02T15:45:00.000Z',
    }));
    expect((await gate(token, 'PROFESSIONAL_REVIEW_MISSING')).status).toBe('cleared');
  });

  it('keeps the resolved signed reviewer packet context reusable through the evidence-wizard payload and packet downloads', async () => {
    const token = await tokenFor('wizard-admin', 'actual-test-password');

    const recorded = await request(`${PROJECT_PATH}/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence_type: 'ahj_approval',
        target_gate_code: 'AHJ_APPROVAL_MISSING',
        source_ref: 'Signed reviewer packet AHJ-1881-005',
        source_file: 'ahj-approval-packet-5.pdf',
        status: 'present',
        notes: 'Reusable signed reviewer packet for Settings prefill.',
        signoff: {
          reviewer_name: 'Riley Stone',
          reviewer_title: 'Fire Marshal',
          signed_at: '2026-06-03T17:15:00.000Z',
          organization: 'Salt Lake City',
        },
      }),
    });
    expect(recorded.status).toBe(201);
    const recordedBody = await recorded.json();

    const rejectedReuse = await request(`${PROJECT_PATH}/claim-gates/AHJ_APPROVAL_MISSING/resolve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence_id: recordedBody.id,
      }),
    });
    expect(rejectedReuse.status).toBe(400);

    const resolve = await request(`${PROJECT_PATH}/claim-gates/AHJ_APPROVAL_MISSING/resolve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence: {
          evidence_type: 'ahj_approval',
          source_ref: 'Signed reviewer packet AHJ-1881-005-explicit',
          source_file: 'ahj-approval-packet-5-explicit.pdf',
          status: 'present',
          notes: 'Reusable signed reviewer packet for Settings prefill.',
          signoff: {
            reviewer_name: 'Riley Stone',
            reviewer_title: 'Fire Marshal',
            signed_at: '2026-06-03T17:15:00.000Z',
            organization: 'Salt Lake City',
          },
        },
      }),
    });
    expect(resolve.status).toBe(200);
    const resolvedBody = await resolve.json();
    expect(resolvedBody.resolved_evidence_id).not.toBe(recordedBody.id);

    const wizardRes = await request(`${PROJECT_PATH}/evidence-wizard`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(wizardRes.status).toBe(200);
    const wizard = await wizardRes.json();
    const gateRow = wizard.gates.find((item) => item.code === 'AHJ_APPROVAL_MISSING');
    expect(gateRow).toBeTruthy();
    const matchingRow = gateRow.matching_evidence.find((item) => item.id === resolvedBody.resolved_evidence_id);
    expect(matchingRow).toEqual(expect.objectContaining({
      id: resolvedBody.resolved_evidence_id,
      target_gate_code: 'AHJ_APPROVAL_MISSING',
      required_evidence_type: 'ahj_approval',
      review_packet_href: `${PROJECT_PATH}/claim-gates/AHJ_APPROVAL_MISSING/review-packet`,
      review_packet_artifact_type: 'halofire.claim_gate_review_packet.v1',
      resolve_audit_packet_href: resolvedBody.resolve_audit_packet_href,
      resolve_audit_packet_artifact_type: resolvedBody.resolve_audit_packet_artifact_type,
      claim_gate_effect: 'gate_cleared_after_explicit_signed_validation',
      user_notes: 'Reusable signed reviewer packet for Settings prefill.',
      signoff: expect.objectContaining({
        reviewer_name: 'Riley Stone',
        reviewer_title: 'Fire Marshal',
        signed_at: '2026-06-03T17:15:00.000Z',
      }),
    }));

    const reviewPacketRes = await request(matchingRow.review_packet_href, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(reviewPacketRes.status).toBe(200);
    const reviewPacket = await reviewPacketRes.json();
    expect(reviewPacket).toEqual(expect.objectContaining({
      artifact_type: 'halofire.claim_gate_review_packet.v1',
      project_name: HOME_DEPOT_PROJECT_NAME,
      review_packet_href: matchingRow.review_packet_href,
      required_evidence_type: matchingRow.required_evidence_type,
    }));

    const resolveAuditRes = await request(matchingRow.resolve_audit_packet_href, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resolveAuditRes.status).toBe(200);
    const resolveAudit = await resolveAuditRes.json();
    expect(resolveAudit).toEqual(expect.objectContaining({
      artifact_type: 'halofire.claim_gate_resolve_audit_packet.v1',
      gate_code: 'AHJ_APPROVAL_MISSING',
      project_name: HOME_DEPOT_PROJECT_NAME,
      resolved_evidence_id: resolvedBody.resolved_evidence_id,
      resolved_evidence_ref: 'Signed reviewer packet AHJ-1881-005-explicit',
      claim_gate_effect: 'gate_cleared_after_explicit_signed_validation',
    }));
  });
});
