import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3199;
const BASE_URL = `http://127.0.0.1:${PORT}`;

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
  throw new Error('HaloFire API did not become healthy for settings-documents tests');
}

const tokenCache = new Map();
async function tokenFor(username, password) {
  // Cache tokens (one login per user) and retry briefly so the suite is robust
  // when many spawned-server tests run in parallel under CPU contention.
  if (tokenCache.has(username)) return tokenCache.get(username);
  let lastStatus = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    lastStatus = res.status;
    if (res.status === 200) {
      const token = (await res.json()).token;
      tokenCache.set(username, token);
      return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  expect(lastStatus).toBe(200);
}

function seedViewer() {
  const db = new Database(dbPath);
  const hash = bcrypt.hashSync('viewer-password', 12);
  db.prepare('INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)').run(
    'settings-viewer', hash, 'Viewer', 'user', 'viewer@example.test',
  );
  db.close();
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-settings-api-'));
  dbPath = path.join(tempDir, 'halofire.db');
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: dbPath,
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'settings-admin',
      HALOFIRE_ADMIN_PASSWORD: 'actual-test-password',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  seedViewer();
});

afterAll(async () => {
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('HaloFire settings + documentation upload/link API', () => {
  it('requires authentication to list documents', async () => {
    const res = await request('/api/settings/documents');
    expect(res.status).toBe(401);
  });

  it('lists every required doc slot as missing before any link/upload', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const res = await request('/api/settings/documents', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const docs = await res.json();
    const types = docs.map((d) => d.doc_type);
    expect(types).toEqual(expect.arrayContaining([
      'catalogs',
      'manufacturer_cut_sheets',
      'ahj_approval',
      'autosprink_reference',
      'openscad_binary',
      'pricebook_updates',
    ]));
    for (const doc of docs) {
      expect(doc.status).toBe('missing');
      expect(doc.satisfied).toBe(false);
    }
  });

  it('blocks non-admin users from posting a document', async () => {
    const token = await tokenFor('settings-viewer', 'viewer-password');
    const res = await request('/api/settings/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ doc_type: 'catalogs', mode: 'link', url: 'https://example.test/catalog' }),
    });
    expect(res.status).toBe(403);
  });

  it('lets an admin LINK a doc; the slot becomes satisfied + a present project_evidence row exists', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const res = await request('/api/settings/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        doc_type: 'catalogs',
        mode: 'link',
        url: 'https://manufacturer.test/catalog.pdf',
        notes: 'Vendor catalog index',
      }),
    });
    expect(res.status).toBe(200);
    const created = await res.json();
    expect(created.id).toBeGreaterThan(0);
    expect(created.evidence_id).toBeGreaterThan(0);

    const list = await (await request('/api/settings/documents', {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const slot = list.find((d) => d.doc_type === 'catalogs');
    expect(slot.status).toBe('satisfied');
    expect(slot.satisfied).toBe(true);

    // A corresponding present project_evidence row must exist (read it back via the row).
    const db = new Database(dbPath);
    const evidence = db
      .prepare("SELECT * FROM project_evidence WHERE evidence_type = ? AND status = 'present'")
      .all('catalogs');
    db.close();
    expect(evidence.length).toBeGreaterThanOrEqual(1);
    expect(evidence.some((e) => e.source_ref === 'https://manufacturer.test/catalog.pdf')).toBe(true);
  });

  it('rejects an unknown doc_type and a link with no url', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const bad = await request('/api/settings/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ doc_type: 'not_a_real_slot', mode: 'link', url: 'https://x.test' }),
    });
    expect(bad.status).toBe(400);

    const noUrl = await request('/api/settings/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ doc_type: 'catalogs', mode: 'link' }),
    });
    expect(noUrl.status).toBe(400);
  });

  it('does NOT auto-clear regulated claim gates when a catalog is uploaded', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    // Seed a fail-closed gate for a project, then upload a catalog and confirm it stays blocked.
    const db = new Database(dbPath);
    db.prepare(
      `INSERT OR REPLACE INTO claim_gates
         (project_name, code, severity, missing_artifact, acceptable_evidence, blocked_claims, next_action, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('Settings Project', 'AUTOSPRINK_EVIDENCE_MISSING', 'blocking', 'AutoSprink packet',
      'autosprink_packet', JSON.stringify(['AutoSprink parity']), 'Obtain packet', 'blocked');
    db.close();

    await request('/api/settings/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ doc_type: 'manufacturer_cut_sheets', mode: 'link', url: 'https://x.test/cut.pdf' }),
    });

    const gates = await (await request(
      `/api/projects/${encodeURIComponent('Settings Project')}/claim-gates`,
      { headers: { Authorization: `Bearer ${token}` } },
    )).json();
    expect(gates.find((g) => g.code === 'AUTOSPRINK_EVIDENCE_MISSING').status).toBe('blocked');
  });

  it('reports tool/dependency status with an openscad_installed boolean', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const res = await request('/api/settings/dependencies', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const deps = await res.json();
    expect(typeof deps.openscad_installed).toBe('boolean');
    expect(deps).toHaveProperty('sam_gateway');
    expect(deps).toHaveProperty('autosprink_reference');
  });

  it('indexes SAM31 actual-value work items for employee evidence follow-up without clearing claims', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'Settings Project';
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      projectName,
      'openclaw_sam31_consumer_review',
      '1881-sheet-7.png',
      'landscout://sam31/reviews/settings-test/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 44,
          source_openclaw_sam31_consumer_smoke_evidence_id: 43,
          consumer: 'landscout',
          review_decision: 'replaced',
          accepted_queue_id: 'settings-sam31-landscout',
          persisted_review_packet_ref: 'openclaw://landscout/sam31/product-review/settings-sam31-landscout',
          replacement_ref: 'landscout://sam31/reviews/settings-test/replacement.json',
          replacement_values: {
            semantic_labels: ['employee reviewed riser room'],
            object_hypotheses: [{ id: 'obj:riser-room', semantic_label: 'reviewed riser room' }],
            vector_overlays: [{ id: 'vector:riser-room', svg_path: 'M 0 0 L 12 0 L 12 8 Z' }],
            model_3d_candidates: [{ id: 'model:riser-room', primitive: 'extruded_room_candidate' }],
            source_ref: '1881://sheet-7/riser-room',
            confidence: 0.81,
          },
          blocked_claims: ['permit_ready', 'fabrication_ready', 'AHJ_approval'],
          use_for_claims: false,
          no_claim_gates_cleared: true,
          claim_gate_effect: 'no_claims_cleared',
        },
      }),
    );
    db.close();

    const res = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-work-items`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const index = await res.json();
    expect(index).toEqual(expect.objectContaining({
      artifact_type: 'halofire.sam31_actual_value_work_item_index.v1',
      status: 'requires_employee_actual_value_update',
      project_name: projectName,
      item_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(index.items[0]).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_work_item_packet.v1',
      status: 'requires_employee_actual_value_update',
      consumer: 'landscout',
      source_pdf_boundary_evidence_id: 44,
      source_openclaw_sam31_consumer_review_evidence_id: expect.any(Number),
      source_openclaw_sam31_consumer_smoke_evidence_id: 43,
      replacement_values_source_ref: '1881://sheet-7/riser-room',
      employee_actual_value_next_action: expect.stringContaining('Replace SAM31 best guesses with actual HaloFire documentation values'),
      download_href: expect.stringContaining('/actual-value-work-item'),
      evidence_record_type: 'sam31_actual_value_replacement',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(index.items[0].replacement_summary).toEqual(expect.objectContaining({
      semantic_label_count: 1,
      object_hypothesis_count: 1,
      vector_overlay_count: 1,
      model_3d_candidate_count: 1,
    }));
    expect(index.items[0].acceptable_actual_evidence).toEqual(expect.arrayContaining([
      '1881 proposal workbook row or sheet reference',
      'reviewed vector overlay SVG or marked-up plan ref',
      'reviewed 3D model candidate ref or model note',
    ]));
    expect(index.items[0].blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'manufacturer_exact',
      'AutoSprink_parity',
    ]));
  });

  it('prefills SAM31 actual-value replacement evidence from Cooperative 1881 source refs without clearing claims', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'The Cooperative 1881 - Salt Lake City UT';
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      projectName,
      'openclaw_sam31_consumer_review',
      'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      'landscout://sam31/reviews/cooperative-1881/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 144,
          source_openclaw_sam31_consumer_smoke_evidence_id: 143,
          consumer: 'landscout',
          review_decision: 'replaced',
          accepted_queue_id: 'cooperative-1881-sam31-landscout',
          persisted_review_packet_ref: 'openclaw://landscout/sam31/product-review/cooperative-1881-sam31-landscout',
          replacement_ref: 'landscout://sam31/reviews/cooperative-1881/replacement.json',
          replacement_values: {
            semantic_labels: ['employee reviewed residential footprint'],
            object_hypotheses: [{ id: 'obj:residential-footprint' }],
            vector_overlays: [{ id: 'vector:residential-footprint' }],
            model_3d_candidates: [{ id: 'model:residential-footprint' }],
          },
          blocked_claims: ['permit_ready', 'fabrication_ready'],
          use_for_claims: false,
          no_claim_gates_cleared: true,
          claim_gate_effect: 'no_claims_cleared',
        },
      }),
    );
    db.close();

    const res = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-work-items`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const index = await res.json();
    expect(index.items[0].actual_value_replacement_prefill).toEqual(expect.objectContaining({
      artifact_type: 'halofire.sam31_actual_value_replacement_prefill.v1',
      status: 'prefill_from_supplied_1881_source_refs',
      source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
      replacement_values_source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(index.items[0].actual_value_replacement_prefill.source_refs).toEqual(expect.arrayContaining([
      'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
      'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!B9',
      'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G11',
    ]));

    const queueRes = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(queueRes.status).toBe(200);
    const queue = await queueRes.json();
    expect(queue.items[0].actual_value_replacement_prefill).toEqual(expect.objectContaining({
      artifact_type: 'halofire.sam31_actual_value_replacement_prefill.v1',
      source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
      claim_gate_effect: 'no_claims_cleared',
    }));
  });

  it('builds a shared SAM31 actual-value resolver queue with intake status for HaloFire, LandScout, and NameForge', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'Shared SAM31 Actual Queue Project';
    const db = new Database(dbPath);
    const insertReview = db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const landscoutReview = insertReview.run(
      projectName,
      'openclaw_sam31_consumer_review',
      '1881-sheet-7.png',
      'landscout://sam31/reviews/shared/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 74,
          source_openclaw_sam31_consumer_smoke_evidence_id: 73,
          consumer: 'landscout',
          review_decision: 'replaced',
          accepted_queue_id: 'shared-sam31-landscout',
          persisted_review_packet_ref: 'openclaw://landscout/sam31/product-review/shared-sam31-landscout',
          replacement_ref: 'landscout://sam31/reviews/shared/replacement.json',
          replacement_values: {
            semantic_labels: ['employee reviewed riser room'],
            object_hypotheses: [{ id: 'obj:riser-room' }],
            vector_overlays: [{ id: 'vector:riser-room' }],
            model_3d_candidates: [{ id: 'model:riser-room' }],
            source_ref: '1881://sheet-7/riser-room',
          },
          blocked_claims: ['permit_ready', 'fabrication_ready'],
          use_for_claims: false,
          no_claim_gates_cleared: true,
          claim_gate_effect: 'no_claims_cleared',
        },
      }),
    );
    insertReview.run(
      projectName,
      'openclaw_sam31_consumer_review',
      '1881-sheet-8.png',
      'nameforge://sam31/reviews/shared/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 84,
          source_openclaw_sam31_consumer_smoke_evidence_id: 83,
          consumer: 'nameforge',
          review_decision: 'replaced',
          accepted_queue_id: 'shared-sam31-nameforge',
          persisted_review_packet_ref: 'openclaw://nameforge/sam31/product-review/shared-sam31-nameforge',
          replacement_ref: 'nameforge://sam31/reviews/shared/replacement.json',
          replacement_values: {
            semantic_labels: ['reviewed monument sign zone'],
            object_hypotheses: [{ id: 'obj:monument-sign' }],
            vector_overlays: [{ id: 'vector:monument-sign' }],
            model_3d_candidates: [{ id: 'model:monument-sign' }],
            source_ref: '1881://sheet-8/monument-sign',
          },
          blocked_claims: ['permit_ready', 'AHJ_approval'],
          use_for_claims: false,
          no_claim_gates_cleared: true,
          claim_gate_effect: 'no_claims_cleared',
        },
      }),
    );
    db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      projectName,
      'sam31_actual_value_replacement',
      `openclaw_sam31_consumer_review:${landscoutReview.lastInsertRowid}`,
      '1881://sheet-7/riser-room',
      'present',
      JSON.stringify({
        kind: 'sam31ActualValueReplacement',
        artifact_type: 'halofire.sam31_actual_value_replacement_evidence_note.v1',
        source_pdf_boundary_evidence_id: 74,
        source_openclaw_sam31_consumer_review_evidence_id: landscoutReview.lastInsertRowid,
        source_openclaw_sam31_consumer_smoke_evidence_id: 73,
        consumer: 'landscout',
        replacement_values_source_ref: '1881://sheet-7/riser-room',
        acceptable_actual_evidence: ['1881 proposal workbook row or sheet reference'],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }),
    );
    db.close();

    const res = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const queue = await res.json();
    expect(queue).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_resolver_queue.v1',
      status: 'actual_value_replacements_pending',
      project_name: projectName,
      item_count: 2,
      pending_count: 1,
      recorded_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(queue.supported_consumers).toEqual(expect.arrayContaining(['halo_fire', 'landscout', 'nameforge']));
    expect(queue.acceptable_actual_evidence).toEqual(expect.arrayContaining([
      '1881 proposal workbook row or sheet reference',
      'reviewed vector overlay SVG or marked-up plan ref',
      'reviewed 3D model candidate ref or model note',
    ]));
    const landscout = queue.items.find((item) => item.consumer === 'landscout');
    const nameforge = queue.items.find((item) => item.consumer === 'nameforge');
    expect(landscout).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_resolver_queue_item.v1',
      status: 'actual_value_evidence_recorded',
      consumer: 'landscout',
      source_runtime: 'sam-3.1+llm',
      source_pdf_boundary_evidence_id: 74,
      source_openclaw_sam31_consumer_review_evidence_id: Number(landscoutReview.lastInsertRowid),
      evidence_record_type: 'sam31_actual_value_replacement',
      intake_status: 'recorded',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(landscout.latest_actual_value_replacement_evidence).toEqual(expect.objectContaining({
      evidence_type: 'sam31_actual_value_replacement',
      evidence_id: expect.any(Number),
      source_ref: '1881://sheet-7/riser-room',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(nameforge).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_resolver_queue_item.v1',
      status: 'requires_employee_actual_value_update',
      consumer: 'nameforge',
      source_runtime: 'sam-3.1+llm',
      source_pdf_boundary_evidence_id: 84,
      evidence_record_type: 'sam31_actual_value_replacement',
      intake_status: 'missing',
      latest_actual_value_replacement_evidence: null,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(nameforge.next_action).toContain('Record sam31_actual_value_replacement evidence');
    expect(nameforge.download_href).toContain('/actual-value-work-item');
    expect(nameforge.consumer_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ consumer: 'halo_fire', action: 'poll_actual_value_resolver_queue' }),
      expect.objectContaining({ consumer: 'landscout', action: 'poll_actual_value_resolver_queue' }),
      expect.objectContaining({ consumer: 'nameforge', action: 'poll_actual_value_resolver_queue' }),
    ]));
  });

  it('exposes a global OpenClaw SAM31 actual-value resolver queue readback for consumer polling', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'Shared SAM31 Global Queue Project';
    const db = new Database(dbPath);
    const insertReview = db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertReview.run(
      projectName,
      'openclaw_sam31_consumer_review',
      '1881-sheet-7.png',
      'landscout://sam31/reviews/global/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 174,
          source_openclaw_sam31_consumer_smoke_evidence_id: 173,
          consumer: 'landscout',
          review_decision: 'replaced',
          accepted_queue_id: 'global-sam31-landscout',
          persisted_review_packet_ref: 'openclaw://landscout/sam31/product-review/global-sam31-landscout',
          replacement_ref: 'landscout://sam31/reviews/global/replacement.json',
          replacement_values: {
            semantic_labels: ['reviewed riser room'],
            object_hypotheses: [{ id: 'obj:riser-room' }],
            vector_overlays: [{ id: 'vector:riser-room' }],
            model_3d_candidates: [{ id: 'model:riser-room' }],
            source_ref: '1881://sheet-7/riser-room',
          },
          blocked_claims: ['permit_ready'],
          use_for_claims: false,
          no_claim_gates_cleared: true,
          claim_gate_effect: 'no_claims_cleared',
        },
      }),
    );
    insertReview.run(
      projectName,
      'openclaw_sam31_consumer_review',
      '1881-sheet-8.png',
      'nameforge://sam31/reviews/global/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 184,
          source_openclaw_sam31_consumer_smoke_evidence_id: 183,
          consumer: 'nameforge',
          review_decision: 'replaced',
          accepted_queue_id: 'global-sam31-nameforge',
          persisted_review_packet_ref: 'openclaw://nameforge/sam31/product-review/global-sam31-nameforge',
          replacement_ref: 'nameforge://sam31/reviews/global/replacement.json',
          replacement_values: {
            semantic_labels: ['reviewed monument sign zone'],
            object_hypotheses: [{ id: 'obj:monument-sign' }],
            vector_overlays: [{ id: 'vector:monument-sign' }],
            model_3d_candidates: [{ id: 'model:monument-sign' }],
            source_ref: '1881://sheet-8/monument-sign',
          },
          blocked_claims: ['permit_ready'],
          use_for_claims: false,
          no_claim_gates_cleared: true,
          claim_gate_effect: 'no_claims_cleared',
        },
      }),
    );
    db.close();

    const res = await request(`/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(projectName)}&consumer=nameforge`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const readback = await res.json();
    expect(readback).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
      status: 'actual_value_replacements_pending',
      project_name: projectName,
      requested_consumer: 'nameforge',
      item_count: 1,
      pending_count: 1,
      recorded_count: 0,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(readback.source_project_route).toContain('/api/projects/');
    expect(readback.source_project_route).toContain('/openclaw/sam31/actual-value-resolver-queue');
    expect(readback.queue.artifact_type).toBe('openclaw.sam31.actual_value_resolver_queue.v1');
    expect(readback.queue.items).toHaveLength(1);
    expect(readback.queue.items[0]).toEqual(expect.objectContaining({
      consumer: 'nameforge',
      intake_status: 'missing',
      source_pdf_boundary_evidence_id: 184,
    }));
    expect(readback.consumer_pull_endpoints).toEqual(expect.objectContaining({
      halo_fire: expect.objectContaining({ method: 'GET', consumes: 'openclaw.sam31.actual_value_resolver_queue.v1' }),
      landscout: expect.objectContaining({ href: expect.stringContaining('consumer=landscout') }),
      nameforge: expect.objectContaining({ href: expect.stringContaining('consumer=nameforge') }),
    }));
    expect(readback.acceptable_actual_evidence).toEqual(expect.arrayContaining([
      '1881 proposal workbook row or sheet reference',
      'reviewed vector overlay SVG or marked-up plan ref',
      'reviewed 3D model candidate ref or model note',
    ]));

    const tool = await (await request('/api/openclaw/sam31/tool', {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(tool.halofire_api_actions.actual_value_resolver_queue).toEqual(expect.objectContaining({
      method: 'GET',
      href_template: '/api/openclaw/sam31/actual-value-resolver-queue?projectName={projectName}&consumer={consumer}',
      project_route_template: '/api/projects/{projectName}/openclaw/sam31/actual-value-resolver-queue?consumer={consumer}',
      produces: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
      queue_artifact_type: 'openclaw.sam31.actual_value_resolver_queue.v1',
      consumer_action: 'poll_actual_value_resolver_queue',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
  });
});
