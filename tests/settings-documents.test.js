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
            llm_observations: [{
              id: 'llm:obj:riser-room',
              segment_id: 'section:riser-room',
              semantic_label: 'reviewed riser room',
              prompt_ref: 'openclaw.sam31.prompt.identify_objects_vector_3d.v1',
            }],
            vector_overlays: [{
              id: 'vector:riser-room',
              svg_path: 'M 0 0 L 12 0 L 12 8 Z',
              source_llm_observation_ids: ['llm:obj:riser-room'],
            }],
            model_3d_candidates: [{
              id: 'model:riser-room',
              primitive: 'extruded_room_candidate',
              source_llm_observation_ids: ['llm:obj:riser-room'],
            }],
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
      llm_observation_count: 1,
      vector_overlay_count: 1,
      model_3d_candidate_count: 1,
    }));
    expect(index.items[0]).toEqual(expect.objectContaining({
      llm_observation_count: 1,
      llm_observation_ids: ['llm:obj:riser-room'],
      source_llm_observation_ids: ['llm:obj:riser-room'],
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
            llm_observations: [{ id: 'llm:obj:residential-footprint' }],
            vector_overlays: [{ id: 'vector:residential-footprint', source_llm_observation_ids: ['llm:obj:residential-footprint'] }],
            model_3d_candidates: [{ id: 'model:residential-footprint', source_llm_observation_ids: ['llm:obj:residential-footprint'] }],
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
    expect(index.items[0]).toEqual(expect.objectContaining({
      llm_observation_count: 1,
      llm_observation_ids: ['llm:obj:residential-footprint'],
      source_llm_observation_ids: ['llm:obj:residential-footprint'],
    }));

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
            llm_observations: [{ id: 'llm:obj:riser-room' }],
            vector_overlays: [{ id: 'vector:riser-room', source_llm_observation_ids: ['llm:obj:riser-room'] }],
            model_3d_candidates: [{ id: 'model:riser-room', source_llm_observation_ids: ['llm:obj:riser-room'] }],
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
      llm_observation_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(landscout.llm_observation_ids).toEqual(['llm:obj:riser-room']);
    expect(landscout.source_llm_observation_ids).toEqual(['llm:obj:riser-room']);
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
    const nameforgeReview = insertReview.run(
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
    const contractEvidence = db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      projectName,
      'openclaw_sam31_actual_value_resolver_contract',
      'shared-sam31-global-queue-project-sam31-actual-value-resolver-contract-nameforge.json',
      'openclaw://sam31/actual-value-resolver-contract/nameforge',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_actual_value_resolver_contract',
        artifact_type: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
        contract_packet: {
          artifact_type: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
          project_name: projectName,
          requested_consumer: 'nameforge',
          queue_artifact_type: 'openclaw.sam31.actual_value_resolver_queue.v1',
          readback_artifact_type: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
          use_for_claims: false,
          claim_gate_effect: 'no_claims_cleared',
          no_claim_gates_cleared: true,
        },
        supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
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
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(readback.latest_actual_value_resolver_contract_evidence).toEqual(expect.objectContaining({
      evidence_id: Number(contractEvidence.lastInsertRowid),
      evidence_type: 'openclaw_sam31_actual_value_resolver_contract',
      source_ref: 'openclaw://sam31/actual-value-resolver-contract/nameforge',
      requested_consumer: 'nameforge',
      artifact_type: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(readback.source_project_route).toContain('/api/projects/');
    expect(readback.source_project_route).toContain('/openclaw/sam31/actual-value-resolver-queue');
    expect(readback.queue.artifact_type).toBe('openclaw.sam31.actual_value_resolver_queue.v1');
    expect(readback.queue.items).toHaveLength(1);
    expect(readback.queue.items[0]).toEqual(expect.objectContaining({
      consumer: 'nameforge',
      intake_status: 'missing',
      source_pdf_boundary_evidence_id: 184,
      source_openclaw_sam31_consumer_review_evidence_id: Number(nameforgeReview.lastInsertRowid),
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
    }));
    expect(readback.queue.items[0].latest_actual_value_resolver_contract_evidence).toEqual(expect.objectContaining({
      evidence_id: Number(contractEvidence.lastInsertRowid),
      requested_consumer: 'nameforge',
      claim_gate_effect: 'no_claims_cleared',
    }));
    const contractScopedRes = await request(`/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(projectName)}&contractEvidenceId=${contractEvidence.lastInsertRowid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(contractScopedRes.status).toBe(200);
    const contractScopedReadback = await contractScopedRes.json();
    expect(contractScopedReadback).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
      requested_consumer: 'nameforge',
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
      item_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(contractScopedReadback.queue_href).toContain(`contractEvidenceId=${contractEvidence.lastInsertRowid}`);
    expect(contractScopedReadback.queue.items[0]).toEqual(expect.objectContaining({
      consumer: 'nameforge',
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
    }));
    const replacementScopedRes = await request(`/api/openclaw/sam31/actual-value-replacements?projectName=${encodeURIComponent(projectName)}&contractEvidenceId=${contractEvidence.lastInsertRowid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(replacementScopedRes.status).toBe(200);
    const replacementScopedReadback = await replacementScopedRes.json();
    expect(replacementScopedReadback).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_replacement_readback.v1',
      requested_consumer: 'nameforge',
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
      item_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(replacementScopedReadback.source_queue_route).toContain(`contractEvidenceId=${contractEvidence.lastInsertRowid}`);
    expect(replacementScopedReadback.items[0]).toEqual(expect.objectContaining({
      consumer: 'nameforge',
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
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
    expect(readback.sam31_llm_extrapolation_contract).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_resolver_extrapolation_contract.v1',
      source_tool_contract_ref: 'openclaw.sam31_extrapolation_contract',
      source_runtime: 'sam-3.1+llm',
      supports_object_identification: true,
      supports_vector_overlays: true,
      supports_model_3d_candidates: true,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(readback.sam31_llm_extrapolation_contract.produces).toEqual(expect.arrayContaining([
      'llm_observations',
      'vector_overlays',
      'model_3d_candidates',
      'extrapolation_index',
    ]));
    expect(readback.sam31_llm_extrapolation_contract.perception_lanes).toEqual(expect.arrayContaining([
      'object_identification',
      'vector_overlay',
      'model_3d_candidate',
      'spatial_observation',
    ]));
    expect(readback.sam31_llm_extrapolation_contract.supported_applications).toEqual(['halo_fire', 'landscout', 'nameforge']);
    expect(readback.sam31_llm_extrapolation_contract.application_contracts.landscout.blocked_claims).toEqual(expect.arrayContaining([
      'CEO_ready',
      'production_ready',
    ]));
    expect(readback.sam31_llm_extrapolation_contract.application_contracts.nameforge.blocked_claims).toEqual(expect.arrayContaining([
      'brand_ready',
      'trademark_ready',
    ]));
    expect(readback.queue.sam31_llm_extrapolation_contract).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_resolver_extrapolation_contract.v1',
      source_tool_contract_ref: 'openclaw.sam31_extrapolation_contract',
      claim_gate_effect: 'no_claims_cleared',
    }));

    const contractPacketRes = await request(`/api/openclaw/sam31/actual-value-resolver-contract?projectName=${encodeURIComponent(projectName)}&consumer=nameforge`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(contractPacketRes.status).toBe(200);
    const contractPacket = await contractPacketRes.json();
    expect(contractPacket).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
      status: 'ready_for_consumer_contract_download',
      project_name: projectName,
      requested_consumer: 'nameforge',
      queue_artifact_type: 'openclaw.sam31.actual_value_resolver_queue.v1',
      readback_artifact_type: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(contractPacket.queue_readback_href).toContain('/api/openclaw/sam31/actual-value-resolver-queue');
    expect(contractPacket.download_name).toContain('sam31-actual-value-resolver-contract-nameforge.json');
    expect(contractPacket.sam31_llm_extrapolation_contract).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_resolver_extrapolation_contract.v1',
      supports_object_identification: true,
      supports_vector_overlays: true,
      supports_model_3d_candidates: true,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(contractPacket.consumer_pull_endpoint).toEqual(expect.objectContaining({
      consumer: 'nameforge',
      action: 'poll_actual_value_resolver_queue',
      href: expect.stringContaining('consumer=nameforge'),
      produces: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(contractPacket.supported_applications).toEqual(['halo_fire', 'landscout', 'nameforge']);
    expect(contractPacket.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'brand_ready',
      'trademark_ready',
      'production_ready',
    ]));

    const tool = await (await request('/api/openclaw/sam31/tool', {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(tool.halofire_api_actions.actual_value_service_descriptor_evidence).toEqual(expect.objectContaining({
      method: 'POST',
      href_template: '/api/projects/{projectName}/openclaw/sam31/actual-value-service/evidence',
      consumes: 'openclaw.sam31.actual_value_service_descriptor.v1',
      produces: 'openclaw_sam31_actual_value_service_descriptor',
      evidence_record_type: 'openclaw_sam31_actual_value_service_descriptor',
      supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
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
    expect(tool.halofire_api_actions.actual_value_resolver_contract_evidence).toEqual(expect.objectContaining({
      method: 'POST',
      href_template: '/api/projects/{projectName}/openclaw/sam31/actual-value-resolver-contract/evidence',
      consumes: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
      produces: 'openclaw_sam31_actual_value_resolver_contract',
      evidence_record_type: 'openclaw_sam31_actual_value_resolver_contract',
      supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
  });

  it('exposes a shared OpenClaw SAM31 actual-value service descriptor for HaloFire, LandScout, and NameForge', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'Shared SAM31 Service Descriptor Project';
    const res = await request(`/api/openclaw/sam31/actual-value-service?projectName=${encodeURIComponent(projectName)}&consumer=nameforge`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const descriptor = await res.json();
    expect(descriptor).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_service_descriptor.v1',
      status: 'ready_for_shared_consumer_polling',
      project_name: projectName,
      requested_consumer: 'nameforge',
      source_runtime: 'sam-3.1+llm',
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(descriptor.supported_consumers).toEqual(['halo_fire', 'landscout', 'nameforge']);
    expect(descriptor.supported_applications).toEqual(['halo_fire', 'landscout', 'nameforge']);
    expect(descriptor.consumer_service_endpoints.nameforge).toEqual(expect.objectContaining({
      consumer: 'nameforge',
      service_descriptor: expect.objectContaining({
        method: 'GET',
        href: expect.stringContaining('/api/openclaw/sam31/actual-value-service'),
        produces: 'openclaw.sam31.actual_value_service_descriptor.v1',
      }),
      resolver_queue: expect.objectContaining({
        action: 'poll_actual_value_resolver_queue',
        href: expect.stringContaining('/api/openclaw/sam31/actual-value-resolver-queue'),
        produces: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
      }),
      replacement_readback: expect.objectContaining({
        action: 'poll_actual_value_replacement_details',
        href: expect.stringContaining('/api/openclaw/sam31/actual-value-replacements'),
        produces: 'openclaw.sam31.actual_value_replacement_readback.v1',
      }),
      replacement_intake: expect.objectContaining({
        method: 'POST',
        consumes: 'halofire.sam31_actual_value_replacement_intake.v1',
        produces: 'halofire.sam31_actual_value_replacement_intake.v1',
      }),
    }));
    expect(descriptor.shared_see_label_extrapolate_contract).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.see_label_extrapolate_contract.v1',
      source_runtime: 'sam-3.1+llm',
      supports_object_identification: true,
      supports_semantic_labels: true,
      supports_vector_overlays: true,
      supports_model_3d_candidates: true,
      supports_spatial_observations: true,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(descriptor.shared_see_label_extrapolate_contract.produces).toEqual(expect.arrayContaining([
      'object_hypotheses',
      'semantic_labels',
      'vector_overlays',
      'model_3d_candidates',
      'spatial_observations',
      'source_refs',
    ]));
    expect(descriptor.shared_see_label_extrapolate_contract.object_hypothesis_contract.required_fields).toEqual(expect.arrayContaining([
      'id',
      'semantic_label',
      'confidence',
      'source_refs',
    ]));
    expect(descriptor.shared_see_label_extrapolate_contract.vector_overlay_contract.required_fields).toEqual(expect.arrayContaining([
      'id',
      'svg_path_or_vector_ref',
      'source_object_hypothesis_ids',
      'source_refs',
    ]));
    expect(descriptor.shared_see_label_extrapolate_contract.model_3d_candidate_contract.required_fields).toEqual(expect.arrayContaining([
      'id',
      'model_ref_or_primitive',
      'source_object_hypothesis_ids',
      'source_refs',
    ]));
    expect(descriptor.actual_value_replacement_contract.acceptable_actual_evidence).toEqual(expect.arrayContaining([
      '1881 proposal workbook row or sheet reference',
      'reviewed vector overlay SVG or marked-up plan ref',
      'reviewed 3D model candidate ref or model note',
      'screenshot or console evidence for the reviewed SAM31 section',
    ]));
    expect(descriptor.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'fabrication_ready',
      'AutoSprink_parity',
      'brand_ready',
      'production_ready',
    ]));

    const projectRes = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-service?consumer=landscout`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(projectRes.status).toBe(200);
    const projectDescriptor = await projectRes.json();
    expect(projectDescriptor).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_service_descriptor.v1',
      project_name: projectName,
      requested_consumer: 'landscout',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(projectDescriptor.consumer_service_endpoints.landscout.resolver_queue.href).toContain('consumer=landscout');
  });

  it('records the SAM31 actual-value service descriptor as attachable no-claims evidence', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'Shared SAM31 Service Descriptor Evidence Project';

    const res = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-service/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ consumer: 'nameforge' }),
    });
    expect(res.status).toBe(201);
    const saved = await res.json();
    expect(saved).toEqual(expect.objectContaining({
      evidence_type: 'openclaw_sam31_actual_value_service_descriptor',
      status: 'present',
      source_ref: 'openclaw://sam31/actual-value-service/nameforge',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(saved.service_descriptor).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_service_descriptor.v1',
      project_name: projectName,
      requested_consumer: 'nameforge',
      shared_see_label_extrapolate_contract: expect.objectContaining({
        artifact_type: 'openclaw.sam31.see_label_extrapolate_contract.v1',
        supports_object_identification: true,
        supports_vector_overlays: true,
        supports_model_3d_candidates: true,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
      actual_value_replacement_contract: expect.objectContaining({
        artifact_type: 'halofire.sam31_actual_value_replacement_intake_contract.v1',
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
    }));

    const db = new Database(dbPath);
    const row = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(saved.evidence_id);
    db.close();
    expect(row).toEqual(expect.objectContaining({
      project_name: projectName,
      evidence_type: 'openclaw_sam31_actual_value_service_descriptor',
      status: 'present',
      source_ref: 'openclaw://sam31/actual-value-service/nameforge',
    }));
    expect(row.source_file).toContain('sam31-actual-value-service-descriptor-nameforge.json');
    const notes = JSON.parse(row.notes);
    expect(notes).toEqual(expect.objectContaining({
      kind: 'openclaw_sam31_actual_value_service_descriptor',
      artifact_type: 'openclaw.sam31.actual_value_service_descriptor.v1',
      requested_consumer: 'nameforge',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(notes.service_descriptor).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_service_descriptor.v1',
      requested_consumer: 'nameforge',
    }));
    expect(notes.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'brand_ready',
      'production_ready',
    ]));
    expect(notes.limitations.join(' ')).toContain('does not clear');

    const readback = await request(`/api/openclaw/sam31/actual-value-service?projectName=${encodeURIComponent(projectName)}&consumer=nameforge`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(readback.status).toBe(200);
    const descriptor = await readback.json();
    expect(descriptor).toEqual(expect.objectContaining({
      latest_actual_value_service_descriptor_evidence_id: saved.evidence_id,
      saved_actual_value_service_descriptor_count: 1,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(descriptor.latest_actual_value_service_descriptor_evidence).toEqual(expect.objectContaining({
      evidence_id: saved.evidence_id,
      evidence_type: 'openclaw_sam31_actual_value_service_descriptor',
      requested_consumer: 'nameforge',
      source_ref: 'openclaw://sam31/actual-value-service/nameforge',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
  });

  it('opens a consumer resolver queue from saved SAM31 service descriptor evidence', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'Shared SAM31 Service Descriptor Queue Filter Project';
    const db = new Database(dbPath);
    const insertReview = db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertReview.run(
      projectName,
      'openclaw_sam31_consumer_review',
      '1881-sheet-landscout.png',
      'landscout://sam31/reviews/service-descriptor-filter/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 914,
          source_openclaw_sam31_consumer_smoke_evidence_id: 913,
          consumer: 'landscout',
          review_decision: 'needs_actual_value_replacement',
          replacement_values: { semantic_labels: ['reviewed parcel boundary'], source_ref: '1881://sheet-landscout/boundary' },
          use_for_claims: false,
          claim_gate_effect: 'no_claims_cleared',
          no_claim_gates_cleared: true,
        },
      }),
    );
    const nameforgeReview = insertReview.run(
      projectName,
      'openclaw_sam31_consumer_review',
      '1881-sheet-nameforge.png',
      'nameforge://sam31/reviews/service-descriptor-filter/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 924,
          source_openclaw_sam31_consumer_smoke_evidence_id: 923,
          consumer: 'nameforge',
          review_decision: 'needs_actual_value_replacement',
          replacement_values: { semantic_labels: ['reviewed sign zone'], source_ref: '1881://sheet-nameforge/sign-zone' },
          use_for_claims: false,
          claim_gate_effect: 'no_claims_cleared',
          no_claim_gates_cleared: true,
        },
      }),
    );
    db.close();

    const saveDescriptorRes = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-service/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ consumer: 'nameforge' }),
    });
    expect(saveDescriptorRes.status).toBe(201);
    const savedDescriptor = await saveDescriptorRes.json();

    const readbackRes = await request(`/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(projectName)}&serviceDescriptorEvidenceId=${savedDescriptor.evidence_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(readbackRes.status).toBe(200);
    const readback = await readbackRes.json();
    expect(readback).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
      requested_consumer: 'nameforge',
      service_descriptor_evidence_filter_id: savedDescriptor.evidence_id,
      latest_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      saved_actual_value_service_descriptor_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(readback.source_project_route).toContain(`serviceDescriptorEvidenceId=${savedDescriptor.evidence_id}`);
    expect(readback.download_artifacts.filtered_queue_readback.href).toContain(`serviceDescriptorEvidenceId=${savedDescriptor.evidence_id}`);
    expect(readback.download_artifacts.saved_service_descriptor_evidence).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_service_descriptor.v1',
      evidence_id: savedDescriptor.evidence_id,
      source_ref: 'openclaw://sam31/actual-value-service/nameforge',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(readback.latest_actual_value_service_descriptor_evidence).toEqual(expect.objectContaining({
      evidence_id: savedDescriptor.evidence_id,
      requested_consumer: 'nameforge',
      source_ref: 'openclaw://sam31/actual-value-service/nameforge',
    }));
    expect(readback.queue.items).toHaveLength(1);
    expect(readback.queue.items[0]).toEqual(expect.objectContaining({
      consumer: 'nameforge',
      source_openclaw_sam31_consumer_review_evidence_id: Number(nameforgeReview.lastInsertRowid),
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      latest_actual_value_service_descriptor_evidence: expect.objectContaining({
        evidence_id: savedDescriptor.evidence_id,
        requested_consumer: 'nameforge',
      }),
      actual_value_service_descriptor_action: expect.objectContaining({
        artifact_type: 'openclaw.sam31.actual_value_service_descriptor_action.v1',
        action: 'download_actual_value_service_descriptor',
        href: expect.stringContaining('consumer=nameforge'),
        source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
    }));
    expect(readback.queue.items[0].consumer_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        consumer: 'nameforge',
        action: 'poll_actual_value_resolver_queue',
        source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
        actual_value_service_descriptor_action: expect.objectContaining({
          href: expect.stringContaining('consumer=nameforge'),
          source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
        }),
      }),
    ]));
    expect(readback.queue.items[0].actual_value_replacement_prefill).toEqual(expect.objectContaining({
      artifact_type: 'halofire.sam31_actual_value_replacement_prefill.v1',
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      actual_value_service_descriptor_action: expect.objectContaining({
        artifact_type: 'openclaw.sam31.actual_value_service_descriptor_action.v1',
        action: 'download_actual_value_service_descriptor',
        source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
      claim_gate_effect: 'no_claims_cleared',
      use_for_claims: false,
    }));
  });

  it('records SAM31 actual-value replacement evidence with saved service descriptor context', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'Shared SAM31 Service Descriptor Replacement Context Project';
    const db = new Database(dbPath);
    const reviewResult = db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      projectName,
      'openclaw_sam31_consumer_review',
      '1881-sheet-nameforge-record.png',
      'nameforge://sam31/reviews/service-descriptor-record/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 934,
          source_openclaw_sam31_consumer_smoke_evidence_id: 933,
          consumer: 'nameforge',
          review_decision: 'needs_actual_value_replacement',
          replacement_values: {
            semantic_labels: ['reviewed sign face'],
            source_ref: '1881://sheet-nameforge/sign-face',
            llm_observations: [{ id: 'llm:temporary-sign-face' }],
          },
          use_for_claims: false,
          claim_gate_effect: 'no_claims_cleared',
          no_claim_gates_cleared: true,
        },
      }),
    );
    db.close();

    const saveDescriptorRes = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-service/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ consumer: 'nameforge' }),
    });
    expect(saveDescriptorRes.status).toBe(201);
    const savedDescriptor = await saveDescriptorRes.json();

    const queueRes = await request(`/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(projectName)}&serviceDescriptorEvidenceId=${savedDescriptor.evidence_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(queueRes.status).toBe(200);
    const queueReadback = await queueRes.json();
    const queueItem = queueReadback.queue.items[0];
    expect(queueItem).toEqual(expect.objectContaining({
      consumer: 'nameforge',
      source_openclaw_sam31_consumer_review_evidence_id: Number(reviewResult.lastInsertRowid),
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
    }));

    const recordRes = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-replacements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        source_openclaw_sam31_consumer_review_evidence_id: queueItem.source_openclaw_sam31_consumer_review_evidence_id,
        source_pdf_boundary_evidence_id: queueItem.source_pdf_boundary_evidence_id,
        source_openclaw_sam31_consumer_smoke_evidence_id: queueItem.source_openclaw_sam31_consumer_smoke_evidence_id,
        source_openclaw_sam31_actual_value_service_descriptor_evidence_id: queueItem.source_openclaw_sam31_actual_value_service_descriptor_evidence_id,
        actual_value_service_descriptor_action: queueItem.actual_value_service_descriptor_action,
        consumer: queueItem.consumer,
        source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
        source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        replacement_values_source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        source_refs: ['Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6'],
        actual_value_replacement_prefill: queueItem.actual_value_replacement_prefill,
      }),
    });
    expect(recordRes.status).toBe(201);
    const saved = await recordRes.json();
    expect(saved).toEqual(expect.objectContaining({
      artifact_type: 'halofire.sam31_actual_value_replacement_intake.v1',
      evidence_type: 'sam31_actual_value_replacement',
      consumer: 'nameforge',
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      actual_value_service_descriptor_action: expect.objectContaining({
        source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
        action: 'download_actual_value_service_descriptor',
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(saved.actual_value_replacement_prefill).toEqual(expect.objectContaining({
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      actual_value_service_descriptor_action: expect.objectContaining({
        source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      }),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(saved.actual_value_resolver_replay).toEqual(expect.objectContaining({
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      actual_value_service_descriptor_action: expect.objectContaining({
        source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      }),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    const notes = JSON.parse(saved.evidence.notes);
    expect(notes).toEqual(expect.objectContaining({
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      actual_value_service_descriptor_action: expect.objectContaining({
        source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      }),
      claim_gate_effect: 'no_claims_cleared',
    }));

    const readbackRes = await request(`/api/openclaw/sam31/actual-value-replacements?projectName=${encodeURIComponent(projectName)}&consumer=nameforge`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(readbackRes.status).toBe(200);
    const readback = await readbackRes.json();
    expect(readback.items[0]).toEqual(expect.objectContaining({
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      actual_value_service_descriptor_action: expect.objectContaining({
        source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      }),
    }));
    expect(readback.items[0].recorded_actual_value_replacement_evidence).toEqual(expect.objectContaining({
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      actual_value_service_descriptor_action: expect.objectContaining({
        source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      }),
    }));
  });

  it('filters SAM31 actual-value replacement readback by saved service descriptor evidence', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'Shared SAM31 Service Descriptor Replacement Readback Filter Project';
    const db = new Database(dbPath);
    const insertReview = db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertReview.run(
      projectName,
      'openclaw_sam31_consumer_review',
      '1881-sheet-landscout-readback.png',
      'landscout://sam31/reviews/service-descriptor-readback/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 944,
          source_openclaw_sam31_consumer_smoke_evidence_id: 943,
          consumer: 'landscout',
          review_decision: 'needs_actual_value_replacement',
          replacement_values: { semantic_labels: ['reviewed parcel'], source_ref: '1881://sheet-landscout/readback' },
          use_for_claims: false,
          claim_gate_effect: 'no_claims_cleared',
          no_claim_gates_cleared: true,
        },
      }),
    );
    const nameforgeReview = insertReview.run(
      projectName,
      'openclaw_sam31_consumer_review',
      '1881-sheet-nameforge-readback.png',
      'nameforge://sam31/reviews/service-descriptor-readback/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 954,
          source_openclaw_sam31_consumer_smoke_evidence_id: 953,
          consumer: 'nameforge',
          review_decision: 'needs_actual_value_replacement',
          replacement_values: {
            semantic_labels: ['reviewed tenant sign'],
            source_ref: '1881://sheet-nameforge/readback',
            llm_observations: [{ id: 'llm:readback-sign' }],
          },
          use_for_claims: false,
          claim_gate_effect: 'no_claims_cleared',
          no_claim_gates_cleared: true,
        },
      }),
    );
    db.close();

    const saveDescriptorRes = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-service/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ consumer: 'nameforge' }),
    });
    expect(saveDescriptorRes.status).toBe(201);
    const savedDescriptor = await saveDescriptorRes.json();

    const queueReadback = await (await request(`/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(projectName)}&serviceDescriptorEvidenceId=${savedDescriptor.evidence_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(queueReadback.queue.items).toHaveLength(1);
    const queueItem = queueReadback.queue.items[0];
    expect(queueItem.source_openclaw_sam31_consumer_review_evidence_id).toBe(Number(nameforgeReview.lastInsertRowid));

    const recordRes = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-replacements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        source_openclaw_sam31_consumer_review_evidence_id: queueItem.source_openclaw_sam31_consumer_review_evidence_id,
        source_openclaw_sam31_actual_value_service_descriptor_evidence_id: queueItem.source_openclaw_sam31_actual_value_service_descriptor_evidence_id,
        actual_value_service_descriptor_action: queueItem.actual_value_service_descriptor_action,
        actual_value_replacement_prefill: queueItem.actual_value_replacement_prefill,
        consumer: queueItem.consumer,
        source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
        source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        replacement_values_source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        source_refs: ['Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6'],
      }),
    });
    expect(recordRes.status).toBe(201);
    const saved = await recordRes.json();

    const readbackRes = await request(`/api/openclaw/sam31/actual-value-replacements?projectName=${encodeURIComponent(projectName)}&serviceDescriptorEvidenceId=${savedDescriptor.evidence_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(readbackRes.status).toBe(200);
    const readback = await readbackRes.json();
    expect(readback).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_replacement_readback.v1',
      requested_consumer: 'nameforge',
      service_descriptor_evidence_filter_id: savedDescriptor.evidence_id,
      latest_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      saved_actual_value_service_descriptor_count: 1,
      item_count: 1,
      recorded_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(readback.source_queue_route).toContain(`serviceDescriptorEvidenceId=${savedDescriptor.evidence_id}`);
    expect(readback.replacement_readback_href).toContain(`serviceDescriptorEvidenceId=${savedDescriptor.evidence_id}`);
    expect(readback.download_artifacts.filtered_replacement_readback.href).toContain(`serviceDescriptorEvidenceId=${savedDescriptor.evidence_id}`);
    expect(readback.download_artifacts.saved_service_descriptor_evidence).toEqual(expect.objectContaining({
      evidence_id: savedDescriptor.evidence_id,
      source_ref: 'openclaw://sam31/actual-value-service/nameforge',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(readback.latest_actual_value_service_descriptor_evidence).toEqual(expect.objectContaining({
      evidence_id: savedDescriptor.evidence_id,
      requested_consumer: 'nameforge',
    }));
    expect(readback.items).toHaveLength(1);
    expect(readback.items[0]).toEqual(expect.objectContaining({
      consumer: 'nameforge',
      source_openclaw_sam31_consumer_review_evidence_id: Number(nameforgeReview.lastInsertRowid),
      source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      recorded_actual_value_replacement_evidence: expect.objectContaining({
        evidence_id: saved.id,
        source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      }),
      actual_value_service_descriptor_action: expect.objectContaining({
        source_openclaw_sam31_actual_value_service_descriptor_evidence_id: savedDescriptor.evidence_id,
      }),
    }));
  });

  it('records the SAM31 actual-value resolver contract packet as attachable no-claims evidence', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'Shared SAM31 Contract Evidence Project';

    const res = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-resolver-contract/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ consumer: 'landscout' }),
    });
    expect(res.status).toBe(201);
    const saved = await res.json();
    expect(saved).toEqual(expect.objectContaining({
      evidence_type: 'openclaw_sam31_actual_value_resolver_contract',
      status: 'present',
      source_ref: 'openclaw://sam31/actual-value-resolver-contract/landscout',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(saved.contract_packet).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
      project_name: projectName,
      requested_consumer: 'landscout',
      supported_applications: ['halo_fire', 'landscout', 'nameforge'],
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(saved.evidence).toEqual(expect.objectContaining({
      evidence_type: 'openclaw_sam31_actual_value_resolver_contract',
      status: 'present',
      source_ref: 'openclaw://sam31/actual-value-resolver-contract/landscout',
    }));

    const db = new Database(dbPath);
    const row = db.prepare('SELECT * FROM project_evidence WHERE id = ?').get(saved.evidence_id);
    db.close();
    expect(row).toEqual(expect.objectContaining({
      project_name: projectName,
      evidence_type: 'openclaw_sam31_actual_value_resolver_contract',
      status: 'present',
      source_ref: 'openclaw://sam31/actual-value-resolver-contract/landscout',
    }));
    const notes = JSON.parse(row.notes);
    expect(notes).toEqual(expect.objectContaining({
      kind: 'openclaw_sam31_actual_value_resolver_contract',
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(notes.contract_packet).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
      requested_consumer: 'landscout',
      queue_artifact_type: 'openclaw.sam31.actual_value_resolver_queue.v1',
    }));
    expect(notes.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'AutoSprink_parity',
      'brand_ready',
      'production_ready',
    ]));
  });

  it('exposes SAM31 actual-value replacement details with recorded source refs by consumer', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'Shared SAM31 Replacement Detail Project';
    const db = new Database(dbPath);
    const reviewResult = db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      projectName,
      'openclaw_sam31_consumer_review',
      'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      'landscout://sam31/reviews/detail/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 274,
          source_openclaw_sam31_consumer_smoke_evidence_id: 273,
          consumer: 'landscout',
          review_decision: 'replaced',
          accepted_queue_id: 'detail-sam31-landscout',
          persisted_review_packet_ref: 'openclaw://landscout/sam31/product-review/detail-sam31-landscout',
          replacement_ref: 'landscout://sam31/reviews/detail/replacement.json',
          replacement_values: {
            semantic_labels: ['employee reviewed common area'],
            object_hypotheses: [{ id: 'obj:common-area' }],
            vector_overlays: [{ id: 'vector:common-area' }],
            model_3d_candidates: [{ id: 'model:common-area' }],
            source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
          },
          blocked_claims: ['permit_ready', 'fabrication_ready'],
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
      `openclaw_sam31_consumer_review:${reviewResult.lastInsertRowid}`,
      'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
      'present',
      JSON.stringify({
        kind: 'sam31ActualValueReplacement',
        artifact_type: 'halofire.sam31_actual_value_replacement_evidence_note.v1',
        source_pdf_boundary_evidence_id: 274,
        source_openclaw_sam31_consumer_review_evidence_id: reviewResult.lastInsertRowid,
        source_openclaw_sam31_consumer_smoke_evidence_id: 273,
        consumer: 'landscout',
        source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
        source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        replacement_values_source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        source_refs: [
          'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
          'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!B9',
          'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G11',
        ],
        actual_value_replacement_prefill: {
          artifact_type: 'halofire.sam31_actual_value_replacement_prefill.v1',
          source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
          source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
          source_refs: [
            'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
            'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!B9',
          ],
          use_for_claims: false,
          claim_gate_effect: 'no_claims_cleared',
          no_claim_gates_cleared: true,
        },
        acceptable_actual_evidence: ['1881 proposal workbook row or sheet reference'],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }),
    );
    db.close();

    const res = await request(`/api/openclaw/sam31/actual-value-replacements?projectName=${encodeURIComponent(projectName)}&consumer=landscout`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const readback = await res.json();
    expect(readback).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_replacement_readback.v1',
      status: 'actual_value_replacements_recorded',
      project_name: projectName,
      requested_consumer: 'landscout',
      item_count: 1,
      recorded_count: 1,
      pending_count: 0,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(readback.items[0]).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_replacement_detail.v1',
      status: 'actual_value_evidence_recorded',
      consumer: 'landscout',
      source_openclaw_sam31_consumer_review_evidence_id: Number(reviewResult.lastInsertRowid),
      source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
      replacement_values_source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(readback.items[0].source_refs).toEqual(expect.arrayContaining([
      'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
      'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!B9',
      'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G11',
    ]));
    expect(readback.items[0].recorded_actual_value_replacement_evidence).toEqual(expect.objectContaining({
      evidence_type: 'sam31_actual_value_replacement',
      evidence_id: expect.any(Number),
      source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
      source_refs: expect.arrayContaining([
        'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!B9',
      ]),
      claim_gate_effect: 'no_claims_cleared',
    }));

    const tool = await (await request('/api/openclaw/sam31/tool', {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(tool.halofire_api_actions.actual_value_replacement_readback).toEqual(expect.objectContaining({
      method: 'GET',
      href_template: '/api/openclaw/sam31/actual-value-replacements?projectName={projectName}&consumer={consumer}',
      produces: 'openclaw.sam31.actual_value_replacement_readback.v1',
      consumer_action: 'poll_actual_value_replacement_details',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
  });

  it('persists a contract-scoped SAM31 actual-value replacement readback as attachable no-claims evidence', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'Contract Scoped Replacement Readback Evidence Project';
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      projectName,
      'openclaw_sam31_consumer_review',
      '1881-sheet-9.png',
      'nameforge://sam31/reviews/readback-evidence/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 484,
          source_openclaw_sam31_consumer_smoke_evidence_id: 483,
          consumer: 'nameforge',
          review_decision: 'replaced',
          accepted_queue_id: 'readback-evidence-nameforge',
          persisted_review_packet_ref: 'openclaw://nameforge/sam31/product-review/readback-evidence-nameforge',
          replacement_ref: 'nameforge://sam31/reviews/readback-evidence/replacement.json',
          replacement_values: {
            semantic_labels: ['reviewed storefront sign zone'],
            object_hypotheses: [{ id: 'obj:storefront-sign' }],
            vector_overlays: [{ id: 'vector:storefront-sign' }],
            model_3d_candidates: [{ id: 'model:storefront-sign' }],
            source_ref: '1881://sheet-9/storefront-sign',
          },
          blocked_claims: ['permit_ready', 'brand_ready'],
          use_for_claims: false,
          no_claim_gates_cleared: true,
          claim_gate_effect: 'no_claims_cleared',
        },
      }),
    );
    const contractEvidence = db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      projectName,
      'openclaw_sam31_actual_value_resolver_contract',
      'contract-scoped-readback-sam31-actual-value-resolver-contract-nameforge.json',
      'openclaw://sam31/actual-value-resolver-contract/nameforge',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_actual_value_resolver_contract',
        artifact_type: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
        contract_packet: {
          artifact_type: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
          project_name: projectName,
          requested_consumer: 'nameforge',
          queue_artifact_type: 'openclaw.sam31.actual_value_resolver_queue.v1',
          readback_artifact_type: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
          use_for_claims: false,
          claim_gate_effect: 'no_claims_cleared',
          no_claim_gates_cleared: true,
        },
        supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }),
    );
    db.close();

    const res = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-replacements/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contractEvidenceId: Number(contractEvidence.lastInsertRowid) }),
    });
    expect(res.status).toBe(201);
    const saved = await res.json();
    expect(saved).toEqual(expect.objectContaining({
      evidence_type: 'openclaw_sam31_actual_value_replacement_readback',
      status: 'present',
      source_ref: `openclaw://sam31/actual-value-replacements/nameforge/contract-evidence/${contractEvidence.lastInsertRowid}`,
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(saved.replacement_readback).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_replacement_readback.v1',
      requested_consumer: 'nameforge',
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
      item_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));

    const verifyDb = new Database(dbPath);
    const row = verifyDb.prepare('SELECT * FROM project_evidence WHERE id = ?').get(saved.evidence_id);
    verifyDb.close();
    expect(row).toEqual(expect.objectContaining({
      evidence_type: 'openclaw_sam31_actual_value_replacement_readback',
      status: 'present',
      source_ref: `openclaw://sam31/actual-value-replacements/nameforge/contract-evidence/${contractEvidence.lastInsertRowid}`,
    }));
    const notes = JSON.parse(row.notes);
    expect(notes).toEqual(expect.objectContaining({
      kind: 'openclaw_sam31_actual_value_replacement_readback',
      artifact_type: 'openclaw.sam31.actual_value_replacement_readback.v1',
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(notes.replacement_readback.items[0]).toEqual(expect.objectContaining({
      consumer: 'nameforge',
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
    }));
    expect(notes.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'AHJ_approval',
      'professional_approval',
      'AutoSprink_parity',
      'brand_ready',
      'production_ready',
    ]));

    const tool = await (await request('/api/openclaw/sam31/tool', {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(tool.halofire_api_actions.actual_value_replacement_readback_evidence).toEqual(expect.objectContaining({
      method: 'POST',
      href_template: '/api/projects/{projectName}/openclaw/sam31/actual-value-replacements/evidence',
      consumes: 'openclaw.sam31.actual_value_replacement_readback.v1',
      produces: 'openclaw_sam31_actual_value_replacement_readback',
      evidence_record_type: 'openclaw_sam31_actual_value_replacement_readback',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));

    const queueReadbackRes = await request(`/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(projectName)}&contractEvidenceId=${contractEvidence.lastInsertRowid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(queueReadbackRes.status).toBe(200);
    const queueReadback = await queueReadbackRes.json();
    expect(queueReadback).toEqual(expect.objectContaining({
      latest_actual_value_replacement_readback_evidence_id: saved.evidence_id,
      saved_actual_value_replacement_readback_count: 1,
    }));
    expect(queueReadback.latest_actual_value_replacement_readback_evidence).toEqual(expect.objectContaining({
      evidence_id: saved.evidence_id,
      evidence_type: 'openclaw_sam31_actual_value_replacement_readback',
      artifact_type: 'openclaw.sam31.actual_value_replacement_readback.v1',
      requested_consumer: 'nameforge',
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
      item_count: 1,
      download_name: expect.stringContaining('sam31-actual-value-replacement-readback'),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(queueReadback.latest_actual_value_replacement_readback_evidence.replacement_readback).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_replacement_readback.v1',
      requested_consumer: 'nameforge',
      item_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));

    const savedScopedQueueRes = await request(`/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(projectName)}&replacementReadbackEvidenceId=${saved.evidence_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(savedScopedQueueRes.status).toBe(200);
    const savedScopedQueueReadback = await savedScopedQueueRes.json();
    expect(savedScopedQueueReadback).toEqual(expect.objectContaining({
      requested_consumer: 'nameforge',
      replacement_readback_evidence_filter_id: saved.evidence_id,
      contract_evidence_filter_id: Number(contractEvidence.lastInsertRowid),
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
      latest_actual_value_replacement_readback_evidence_id: saved.evidence_id,
      saved_actual_value_replacement_readback_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(savedScopedQueueReadback.queue_href).toContain(`replacementReadbackEvidenceId=${saved.evidence_id}`);
    expect(savedScopedQueueReadback.source_project_route).toContain(`replacementReadbackEvidenceId=${saved.evidence_id}`);
    expect(savedScopedQueueReadback.queue).toEqual(expect.objectContaining({
      requested_consumer: 'nameforge',
      replacement_readback_evidence_filter_id: saved.evidence_id,
      latest_actual_value_replacement_readback_evidence_id: saved.evidence_id,
      saved_actual_value_replacement_readback_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(savedScopedQueueReadback.queue.items[0]).toEqual(expect.objectContaining({
      consumer: 'nameforge',
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(savedScopedQueueReadback.download_artifacts).toEqual(expect.objectContaining({
      filtered_queue_readback: expect.objectContaining({
        artifact_type: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
        href: expect.stringContaining(`replacementReadbackEvidenceId=${saved.evidence_id}`),
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
      saved_replacement_readback_evidence: expect.objectContaining({
        artifact_type: 'openclaw.sam31.actual_value_replacement_readback.v1',
        evidence_id: saved.evidence_id,
        download_name: expect.stringContaining('sam31-actual-value-replacement-readback'),
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
      source_contract_packet: expect.objectContaining({
        artifact_type: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
        evidence_id: Number(contractEvidence.lastInsertRowid),
        href: expect.stringContaining(`contractEvidenceId=${contractEvidence.lastInsertRowid}`),
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
      source_replacement_readback: expect.objectContaining({
        artifact_type: 'openclaw.sam31.actual_value_replacement_readback.v1',
        href: expect.stringContaining(`contractEvidenceId=${contractEvidence.lastInsertRowid}`),
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
    }));
    expect(savedScopedQueueReadback.latest_actual_value_replacement_readback_evidence).toEqual(expect.objectContaining({
      evidence_id: saved.evidence_id,
      download_artifacts: expect.objectContaining({
        filtered_queue_readback: expect.objectContaining({
          href: expect.stringContaining(`replacementReadbackEvidenceId=${saved.evidence_id}`),
          use_for_claims: false,
          claim_gate_effect: 'no_claims_cleared',
        }),
        source_contract_packet: expect.objectContaining({
          evidence_id: Number(contractEvidence.lastInsertRowid),
          href: expect.stringContaining(`contractEvidenceId=${contractEvidence.lastInsertRowid}`),
        }),
      }),
      record_actual_value_replacement_action: expect.objectContaining({
        method: 'POST',
        href: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-replacements`,
        consumes: 'halofire.sam31_actual_value_replacement_intake.v1',
        produces: 'halofire.sam31_actual_value_replacement_intake.v1',
        evidence_record_type: 'sam31_actual_value_replacement',
        source_openclaw_sam31_actual_value_replacement_readback_evidence_id: saved.evidence_id,
        source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
        requested_consumer: 'nameforge',
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }),
    }));
    expect(savedScopedQueueReadback.latest_actual_value_replacement_readback_evidence.record_actual_value_replacement_action.acceptable_actual_evidence).toEqual(expect.arrayContaining([
      '1881 proposal workbook row or sheet reference',
      'reviewed vector overlay SVG or marked-up plan ref',
      'reviewed 3D model candidate ref or model note',
      'screenshot or console evidence for the reviewed SAM31 section',
    ]));

    const filteredContractPacketRes = await request(`/api/openclaw/sam31/actual-value-resolver-contract?projectName=${encodeURIComponent(projectName)}&contractEvidenceId=${contractEvidence.lastInsertRowid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(filteredContractPacketRes.status).toBe(200);
    const filteredContractPacket = await filteredContractPacketRes.json();
    expect(filteredContractPacket).toEqual(expect.objectContaining({
      requested_consumer: 'nameforge',
      contract_evidence_filter_id: Number(contractEvidence.lastInsertRowid),
      queue_readback_href: expect.stringContaining(`contractEvidenceId=${contractEvidence.lastInsertRowid}`),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
  });

  it('records SAM31 actual-value replacements through a typed OpenClaw intake route', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'Typed SAM31 Actual Replacement Project';
    const db = new Database(dbPath);
    const reviewResult = db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      projectName,
      'openclaw_sam31_consumer_review',
      'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      'landscout://sam31/reviews/typed-intake/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 374,
          source_openclaw_sam31_consumer_smoke_evidence_id: 373,
          consumer: 'landscout',
          review_decision: 'replaced',
          accepted_queue_id: 'typed-sam31-landscout',
          persisted_review_packet_ref: 'openclaw://landscout/sam31/product-review/typed-sam31-landscout',
          replacement_ref: 'landscout://sam31/reviews/typed-intake/replacement.json',
          replacement_values: {
            semantic_labels: ['temporary riser room label'],
            object_hypotheses: [{ id: 'obj:temporary-riser-room' }],
            llm_observations: [{ id: 'llm:temporary-riser-room', semantic_label: 'temporary riser room label' }],
            vector_overlays: [{ id: 'vector:temporary-riser-room', source_llm_observation_ids: ['llm:temporary-riser-room'] }],
            model_3d_candidates: [{ id: 'model:temporary-riser-room', source_llm_observation_ids: ['llm:temporary-riser-room'] }],
            source_ref: 'landscout://sam31/temporary/riser-room',
          },
          blocked_claims: ['permit_ready', 'fabrication_ready'],
          use_for_claims: false,
          no_claim_gates_cleared: true,
          claim_gate_effect: 'no_claims_cleared',
        },
      }),
    );
    const contractEvidence = db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      projectName,
      'openclaw_sam31_actual_value_resolver_contract',
      'typed-sam31-actual-value-resolver-contract-landscout.json',
      'openclaw://sam31/actual-value-resolver-contract/landscout/typed-intake',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_actual_value_resolver_contract',
        artifact_type: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
        contract_packet: {
          artifact_type: 'openclaw.sam31.actual_value_resolver_contract_packet.v1',
          project_name: projectName,
          requested_consumer: 'landscout',
          queue_artifact_type: 'openclaw.sam31.actual_value_resolver_queue.v1',
          readback_artifact_type: 'openclaw.sam31.actual_value_resolver_queue_readback.v1',
          use_for_claims: false,
          claim_gate_effect: 'no_claims_cleared',
          no_claim_gates_cleared: true,
        },
        supported_consumers: ['halo_fire', 'landscout', 'nameforge'],
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }),
    );
    db.close();

    const res = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-replacements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        source_openclaw_sam31_consumer_review_evidence_id: reviewResult.lastInsertRowid,
        source_pdf_boundary_evidence_id: 374,
        source_openclaw_sam31_consumer_smoke_evidence_id: 373,
        consumer: 'landscout',
        source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
        source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        replacement_values_source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        source_refs: [
          'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
          'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!B9',
        ],
        actual_value_replacement_prefill: {
          artifact_type: 'halofire.sam31_actual_value_replacement_prefill.v1',
          source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
          source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
          source_refs: [
            'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
          ],
          use_for_claims: false,
          claim_gate_effect: 'no_claims_cleared',
          no_claim_gates_cleared: true,
        },
      }),
    });
    expect(res.status).toBe(201);
    const saved = await res.json();
    expect(saved).toEqual(expect.objectContaining({
      artifact_type: 'halofire.sam31_actual_value_replacement_intake.v1',
      evidence_type: 'sam31_actual_value_replacement',
      evidence_record_type: 'sam31_actual_value_replacement',
      status: 'present',
      consumer: 'landscout',
      source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
      replacement_values_source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
      use_for_claims: false,
    }));
    expect(saved.source_refs).toEqual(expect.arrayContaining([
      'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
      'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!B9',
    ]));
    expect(saved.actual_value_resolver_replay).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.actual_value_resolver_replay.v1',
      source_route: expect.stringContaining('/openclaw/sam31/actual-value-resolver-queue'),
      replay_status: 'recorded',
      item_status: 'actual_value_evidence_recorded',
      intake_status: 'recorded',
      latest_actual_value_replacement_evidence_id: saved.id,
      source_openclaw_sam31_consumer_review_evidence_id: reviewResult.lastInsertRowid,
      source_openclaw_sam31_actual_value_resolver_contract_evidence_id: Number(contractEvidence.lastInsertRowid),
      consumer: 'landscout',
      llm_observation_count: 1,
      llm_observation_ids: ['llm:temporary-riser-room'],
      source_llm_observation_ids: ['llm:temporary-riser-room'],
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(saved.actual_value_resolver_replay.latest_actual_value_resolver_contract_evidence).toEqual(expect.objectContaining({
      evidence_id: Number(contractEvidence.lastInsertRowid),
      evidence_type: 'openclaw_sam31_actual_value_resolver_contract',
      requested_consumer: 'landscout',
      source_ref: 'openclaw://sam31/actual-value-resolver-contract/landscout/typed-intake',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(saved.actual_value_resolver_replay.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'manufacturer_exact',
      'AutoSprink_parity',
    ]));
    expect(saved.evidence).toEqual(expect.objectContaining({
      evidence_type: 'sam31_actual_value_replacement',
      source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
      status: 'present',
    }));

    const readbackRes = await request(`/api/openclaw/sam31/actual-value-replacements?projectName=${encodeURIComponent(projectName)}&consumer=landscout`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(readbackRes.status).toBe(200);
    const readback = await readbackRes.json();
    expect(readback.recorded_count).toBe(1);
    const queueRes = await request(`/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(projectName)}&consumer=landscout`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(queueRes.status).toBe(200);
    const queueReadback = await queueRes.json();
    expect(queueReadback.queue.items[0]).toEqual(expect.objectContaining({
      status: 'actual_value_evidence_recorded',
      intake_status: 'recorded',
      latest_actual_value_replacement_evidence: expect.objectContaining({
        evidence_id: saved.id,
        source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        claim_gate_effect: 'no_claims_cleared',
      }),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(readback.items[0].recorded_actual_value_replacement_evidence).toEqual(expect.objectContaining({
      evidence_id: saved.id,
      artifact_type: 'halofire.sam31_actual_value_replacement_intake.v1',
      source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
      claim_gate_effect: 'no_claims_cleared',
    }));

    const tool = await (await request('/api/openclaw/sam31/tool', {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(tool.halofire_api_actions.actual_value_replacement_intake).toEqual(expect.objectContaining({
      method: 'POST',
      href_template: '/api/projects/{projectName}/openclaw/sam31/actual-value-replacements',
      consumes: 'openclaw.sam31.actual_value_resolver_queue_item.v1',
      produces: 'halofire.sam31_actual_value_replacement_intake.v1',
      evidence_record_type: 'sam31_actual_value_replacement',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
  });

  it('normalizes actual-value replacement vectors and models through the shared SAM31 section-to-artifacts contract', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'Shared SAM31 Section Artifact Replacement Project';
    const db = new Database(dbPath);
    const reviewResult = db.prepare(
      `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      projectName,
      'openclaw_sam31_consumer_review',
      'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      'nameforge://sam31/reviews/section-artifacts/replacement.json',
      'present',
      JSON.stringify({
        kind: 'openclaw_sam31_consumer_review',
        review: {
          artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
          source_application: 'halo_fire',
          source_pdf_boundary_evidence_id: 474,
          source_openclaw_sam31_consumer_smoke_evidence_id: 473,
          consumer: 'nameforge',
          review_decision: 'replaced',
          accepted_queue_id: 'section-artifacts-nameforge',
          persisted_review_packet_ref: 'openclaw://nameforge/sam31/product-review/section-artifacts-nameforge',
          replacement_ref: 'nameforge://sam31/reviews/section-artifacts/replacement.json',
          replacement_values: {
            sections: [{ id: 'section-storefront-sign', semantic_label: 'temporary_sign_zone' }],
            object_hypotheses: [{ id: 'object:storefront-sign', segment_id: 'section-storefront-sign' }],
            vector_overlays: [{ id: 'vector:storefront-sign' }],
            model_3d_candidates: [{ id: 'model3d:storefront-sign' }],
            source_ref: 'nameforge://sam31/temporary/storefront-sign',
          },
          blocked_claims: ['brand_ready', 'production_ready'],
          use_for_claims: false,
          no_claim_gates_cleared: true,
          claim_gate_effect: 'no_claims_cleared',
        },
      }),
    );
    db.close();

    const res = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-replacements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        source_openclaw_sam31_consumer_review_evidence_id: reviewResult.lastInsertRowid,
        source_pdf_boundary_evidence_id: 474,
        source_openclaw_sam31_consumer_smoke_evidence_id: 473,
        consumer: 'nameforge',
        source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
        source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        replacement_values_source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        source_refs: [
          'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
          'nameforge://employee/reviewed/storefront-sign.png',
        ],
        replacement_values: {
          sections: [{
            id: 'section-storefront-sign',
            semantic_label: 'reviewed_storefront_sign_zone',
            polygon: [[0, 0], [100, 0], [100, 32], [0, 32], [0, 0]],
            confidence: 0.74,
          }],
          object_hypotheses: [{
            id: 'object:storefront-sign',
            segment_id: 'section-storefront-sign',
            semantic_label: 'reviewed_storefront_sign',
            confidence: 0.71,
          }],
          llm_observations: [{
            id: 'llm:storefront-sign',
            segment_id: 'section-storefront-sign',
            object_hypothesis_id: 'object:storefront-sign',
            semantic_label: 'reviewed_storefront_sign',
            confidence: 0.69,
          }],
          vector_overlays: [{
            id: 'vector:reviewed-storefront-sign',
            segment_id: 'section-storefront-sign',
            svg_path: 'M 0 0 L 100 0 L 100 32 L 0 32 Z',
            source_refs: ['nameforge://employee/vector/storefront-sign.svg'],
          }],
          model_3d_candidates: [{
            id: 'model3d:reviewed-storefront-sign',
            segment_id: 'section-storefront-sign',
            primitive: 'employee_reviewed_extruded_sign_panel',
            source_refs: ['nameforge://employee/model/storefront-sign.glb'],
          }],
        },
      }),
    });

    expect(res.status).toBe(201);
    const saved = await res.json();
    expect(saved.openclaw_sam31_section_to_artifacts).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_llm_extrapolation_artifact',
      application: 'nameforge',
      section_to_artifacts_contract: expect.objectContaining({
        artifact_type: 'openclaw.sam31.section_to_artifacts_contract.v1',
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(saved.openclaw_sam31_section_to_artifacts.perception_packet.vector_overlays[0]).toEqual(expect.objectContaining({
      id: 'vector:reviewed-storefront-sign',
      artifact_type: 'openclaw.sam31.vector_overlay.v1',
      segment_id: 'section-storefront-sign',
      source_llm_observation_ids: ['llm:storefront-sign'],
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(saved.openclaw_sam31_section_to_artifacts.perception_packet.model_3d_candidates[0]).toEqual(expect.objectContaining({
      id: 'model3d:reviewed-storefront-sign',
      artifact_type: 'openclaw.sam31.model_3d_candidate.v1',
      primitive: 'employee_reviewed_extruded_sign_panel',
      source_llm_observation_ids: ['llm:storefront-sign'],
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(saved.actual_value_resolver_replay).toEqual(expect.objectContaining({
      source_openclaw_sam31_section_to_artifacts_ref: 'openclaw.sam31.section_to_artifacts_contract.v1',
      vector_overlay_count: 1,
      model_3d_candidate_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));

    const readbackRes = await request(`/api/openclaw/sam31/actual-value-replacements?projectName=${encodeURIComponent(projectName)}&consumer=nameforge`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(readbackRes.status).toBe(200);
    const readback = await readbackRes.json();
    expect(readback.items[0].recorded_actual_value_replacement_evidence).toEqual(expect.objectContaining({
      evidence_id: saved.id,
      openclaw_sam31_section_to_artifacts_summary: expect.objectContaining({
        artifact_type: 'openclaw.sam31_llm_extrapolation_artifact',
        section_to_artifacts_contract_ref: 'openclaw.sam31.section_to_artifacts_contract.v1',
        vector_overlay_count: 1,
        model_3d_candidate_count: 1,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
      openclaw_sam31_section_to_artifacts: expect.objectContaining({
        artifact_type: 'openclaw.sam31_llm_extrapolation_artifact',
        application: 'nameforge',
        claim_gate_effect: 'no_claims_cleared',
      }),
    }));
    expect(readback.items[0]).toEqual(expect.objectContaining({
      openclaw_sam31_section_to_artifacts_summary: expect.objectContaining({
        section_to_artifacts_contract_ref: 'openclaw.sam31.section_to_artifacts_contract.v1',
        vector_overlay_count: 1,
        model_3d_candidate_count: 1,
        claim_gate_effect: 'no_claims_cleared',
      }),
      section_to_artifacts_consumer_handoff: expect.objectContaining({
        artifact_type: 'openclaw.sam31.section_to_artifacts_consumer_handoff.v1',
        source_sam31_actual_value_replacement_evidence_id: saved.id,
        source_openclaw_sam31_section_to_artifacts_ref: 'openclaw.sam31.section_to_artifacts_contract.v1',
        vector_overlay_count: 1,
        model_3d_candidate_count: 1,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
    }));
    expect(readback.items[0].section_to_artifacts_consumer_handoff.supported_consumers).toEqual(expect.arrayContaining([
      'halo_fire',
      'landscout',
      'nameforge',
    ]));

    const verifyDb = new Database(dbPath);
    const row = verifyDb.prepare('SELECT * FROM project_evidence WHERE id = ?').get(saved.evidence_id);
    verifyDb.close();
    const notes = JSON.parse(row.notes);
    expect(notes.openclaw_sam31_section_to_artifacts).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_llm_extrapolation_artifact',
      claim_gate_effect: 'no_claims_cleared',
    }));
  });

  it('posts replacement-derived SAM31 section artifacts into LandScout and NameForge consumer intake smokes', async () => {
    const token = await tokenFor('settings-admin', 'actual-test-password');
    const projectName = 'Shared SAM31 Consumer Intake Smoke Project';

    function insertConsumerReview(consumer, evidenceId) {
      const db = new Database(dbPath);
      const result = db.prepare(
        `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        projectName,
        'openclaw_sam31_consumer_review',
        'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
        `${consumer}://sam31/reviews/shared-section-artifacts.json`,
        'present',
        JSON.stringify({
          kind: 'openclaw_sam31_consumer_review',
          review: {
            artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
            source_application: 'halo_fire',
            source_pdf_boundary_evidence_id: evidenceId + 100,
            source_openclaw_sam31_consumer_smoke_evidence_id: evidenceId + 200,
            consumer,
            review_decision: 'replaced',
            accepted_queue_id: `section-artifacts-${consumer}`,
            persisted_review_packet_ref: `openclaw://${consumer}/sam31/product-review/shared-section-artifacts`,
            replacement_ref: `${consumer}://sam31/reviews/shared-section-artifacts.json`,
            replacement_values: {
              sections: [{ id: `section-${consumer}`, semantic_label: `temporary_${consumer}_zone` }],
              object_hypotheses: [{ id: `object:${consumer}`, segment_id: `section-${consumer}` }],
              vector_overlays: [{ id: `vector:${consumer}` }],
              model_3d_candidates: [{ id: `model3d:${consumer}` }],
              source_ref: `${consumer}://sam31/temporary/shared-section-artifacts`,
            },
            blocked_claims: consumer === 'landscout' ? ['survey_grade', 'production_ready'] : ['brand_ready', 'production_ready'],
            use_for_claims: false,
            no_claim_gates_cleared: true,
            claim_gate_effect: 'no_claims_cleared',
          },
        }),
      );
      db.close();
      return Number(result.lastInsertRowid);
    }

    async function postReplacement(consumer, reviewEvidenceId) {
      const res = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-replacements`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          source_openclaw_sam31_consumer_review_evidence_id: reviewEvidenceId,
          source_pdf_boundary_evidence_id: reviewEvidenceId + 100,
          source_openclaw_sam31_consumer_smoke_evidence_id: reviewEvidenceId + 200,
          consumer,
          source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
          source_ref: `Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#${consumer}!A1`,
          replacement_values_source_ref: `Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#${consumer}!A1`,
          source_refs: [
            `Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#${consumer}!A1`,
            `${consumer}://employee/reviewed/shared-section.png`,
          ],
          replacement_values: {
            sections: [{
              id: `section-${consumer}`,
              semantic_label: `reviewed_${consumer}_zone`,
              polygon: [[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]],
              confidence: 0.76,
            }],
            object_hypotheses: [{
              id: `object:${consumer}`,
              segment_id: `section-${consumer}`,
              semantic_label: `reviewed_${consumer}_asset`,
              confidence: 0.73,
            }],
            llm_observations: [{
              id: `llm:${consumer}`,
              segment_id: `section-${consumer}`,
              object_hypothesis_id: `object:${consumer}`,
              semantic_label: `reviewed_${consumer}_asset`,
              confidence: 0.7,
            }],
            vector_overlays: [{
              id: `vector:${consumer}`,
              segment_id: `section-${consumer}`,
              svg_path: 'M 0 0 L 10 0 L 10 8 L 0 8 Z',
              source_refs: [`${consumer}://employee/vector/shared-section.svg`],
            }],
            model_3d_candidates: [{
              id: `model3d:${consumer}`,
              segment_id: `section-${consumer}`,
              primitive: `reviewed_${consumer}_extrusion`,
              source_refs: [`${consumer}://employee/model/shared-section.glb`],
            }],
          },
        }),
      });
      expect(res.status).toBe(201);
      return res.json();
    }

    const consumers = ['landscout', 'nameforge'];
    const replacements = {};
    const consumerIntakeSmokes = {};
    for (const [index, consumer] of consumers.entries()) {
      const reviewEvidenceId = insertConsumerReview(consumer, index + 700);
      replacements[consumer] = await postReplacement(consumer, reviewEvidenceId);
    }

    for (const consumer of consumers) {
      const queueRes = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/actual-value-resolver-queue?consumer=${consumer}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(queueRes.status).toBe(200);
      const queue = await queueRes.json();
      expect(queue.items).toHaveLength(1);
      const item = queue.items[0];
      expect(item.section_to_artifacts_consumer_handoff).toEqual(expect.objectContaining({
        artifact_type: 'openclaw.sam31.section_to_artifacts_consumer_handoff.v1',
        source_sam31_actual_value_replacement_evidence_id: replacements[consumer].evidence_id,
        vector_overlay_count: 1,
        model_3d_candidate_count: 1,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }));
      expect(item.consumer_actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          consumer,
          action: 'post_section_to_artifacts_consumer_handoff',
          method: 'POST',
          href: `/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke`,
          consumes: 'openclaw.sam31.section_to_artifacts_consumer_handoff.v1',
          produces: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
          source_sam31_actual_value_replacement_evidence_id: replacements[consumer].evidence_id,
          use_for_claims: false,
          claim_gate_effect: 'no_claims_cleared',
        }),
      ]));

      const smokeRes = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          consumer,
          source_sam31_actual_value_replacement_evidence_id: replacements[consumer].evidence_id,
        }),
      });
      expect(smokeRes.status).toBe(201);
      const smoke = await smokeRes.json();
      expect(smoke).toEqual(expect.objectContaining({
        evidence_type: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
        artifact_type: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
        consumer,
        consumer_adapter: `openclaw.sam31.consumer_review_queue.${consumer}.v1`,
        observed_vector_overlay_count: 1,
        observed_model_3d_candidate_count: 1,
        observed_segment_count: 1,
        observed_object_hypothesis_count: 1,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(smoke.posted_handoff.supported_consumers).toEqual(expect.arrayContaining([
        'halo_fire',
        'landscout',
        'nameforge',
      ]));
      consumerIntakeSmokes[consumer] = smoke;
    }

    const savedSmokeScopedQueueRes = await request(`/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(projectName)}&consumerIntakeSmokeEvidenceId=${consumerIntakeSmokes.nameforge.evidence_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(savedSmokeScopedQueueRes.status).toBe(200);
    const savedSmokeScopedQueue = await savedSmokeScopedQueueRes.json();
    expect(savedSmokeScopedQueue).toEqual(expect.objectContaining({
      requested_consumer: 'nameforge',
      consumer_intake_smoke_evidence_filter_id: consumerIntakeSmokes.nameforge.evidence_id,
      latest_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
      saved_section_to_artifacts_consumer_intake_smoke_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(savedSmokeScopedQueue.queue_href).toContain(`consumerIntakeSmokeEvidenceId=${consumerIntakeSmokes.nameforge.evidence_id}`);
    expect(savedSmokeScopedQueue.source_project_route).toContain(`consumerIntakeSmokeEvidenceId=${consumerIntakeSmokes.nameforge.evidence_id}`);
    expect(savedSmokeScopedQueue.queue).toEqual(expect.objectContaining({
      requested_consumer: 'nameforge',
      consumer_intake_smoke_evidence_filter_id: consumerIntakeSmokes.nameforge.evidence_id,
      latest_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
      saved_section_to_artifacts_consumer_intake_smoke_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(savedSmokeScopedQueue.latest_section_to_artifacts_consumer_intake_smoke_evidence).toEqual(expect.objectContaining({
      evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
      evidence_type: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
      artifact_type: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
      consumer: 'nameforge',
      consumer_adapter: 'openclaw.sam31.consumer_review_queue.nameforge.v1',
      observed_vector_overlay_count: 1,
      observed_model_3d_candidate_count: 1,
      observed_segment_count: 1,
      observed_object_hypothesis_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(savedSmokeScopedQueue.queue.items).toHaveLength(1);
    expect(savedSmokeScopedQueue.queue.items[0]).toEqual(expect.objectContaining({
      consumer: 'nameforge',
      source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
      latest_section_to_artifacts_consumer_intake_smoke_evidence: expect.objectContaining({
        evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
        consumer: 'nameforge',
      }),
      next_action: expect.stringContaining('Open the saved SAM31 section-to-artifacts consumer intake smoke evidence'),
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(savedSmokeScopedQueue.queue.items[0].consumer_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        consumer: 'nameforge',
        action: 'download_saved_section_to_artifacts_consumer_intake_smoke',
        method: 'GET',
        href: expect.stringContaining(`consumerIntakeSmokeEvidenceId=${consumerIntakeSmokes.nameforge.evidence_id}`),
        produces: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
        source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
      expect.objectContaining({
        consumer: 'nameforge',
        action: 'download_halofire_consumer_intake_smoke_followup_packet',
        method: 'GET',
        href: expect.stringContaining(`/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/${consumerIntakeSmokes.nameforge.evidence_id}/followup-packet`),
        consumes: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
        produces: 'halofire.sam31_consumer_intake_smoke_followup_packet.v1',
        source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
    ]));
    expect(savedSmokeScopedQueue.download_artifacts).toEqual(expect.objectContaining({
      saved_section_to_artifacts_consumer_intake_smoke_evidence: expect.objectContaining({
        artifact_type: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
        evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
        source_ref: expect.stringContaining('nameforge'),
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
      halofire_consumer_intake_smoke_followup_packet: expect.objectContaining({
        artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_packet.v1',
        evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
        href: expect.stringContaining(`/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/${consumerIntakeSmokes.nameforge.evidence_id}/followup-packet`),
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
      filtered_queue_readback: expect.objectContaining({
        href: expect.stringContaining(`consumerIntakeSmokeEvidenceId=${consumerIntakeSmokes.nameforge.evidence_id}`),
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
    }));

    const followupPacketRes = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/${consumerIntakeSmokes.nameforge.evidence_id}/followup-packet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(followupPacketRes.status).toBe(200);
    const followupPacket = await followupPacketRes.json();
    expect(followupPacket).toEqual(expect.objectContaining({
      artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_packet.v1',
      status: 'requires_employee_sprinkler_followup_review',
      project_name: projectName,
      source_consumer: 'nameforge',
      target_application: 'halo_fire',
      source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
      source_sam31_actual_value_replacement_evidence_id: replacements.nameforge.evidence_id,
      observed_vector_overlay_count: 1,
      observed_model_3d_candidate_count: 1,
      observed_segment_count: 1,
      observed_object_hypothesis_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(followupPacket.supported_sprinkler_review_lanes).toEqual(expect.arrayContaining([
      'room_boundary_visual_audit',
      'obstruction_or_clash_review',
      'vector_overlay_generation',
      'model_3d_candidate_generation',
    ]));
    expect(followupPacket.issue_seeds).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_queue_item.v1',
        issue_type: 'sam31_consumer_intake_room_boundary_visual_audit',
        supported_sprinkler_review_lane: 'room_boundary_visual_audit',
        source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
        claim_gate_effect: 'no_claims_cleared',
      }),
      expect.objectContaining({
        artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_queue_item.v1',
        issue_type: 'sam31_consumer_intake_obstruction_clash_review',
        supported_sprinkler_review_lane: 'obstruction_or_clash_review',
        source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
        claim_gate_effect: 'no_claims_cleared',
      }),
    ]));
    expect(followupPacket.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
        evidence_type: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
      }),
    ]));
    expect(followupPacket.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'manufacturer_exact',
      'AutoSprink_parity',
    ]));

    const followupReviewRes = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/${consumerIntakeSmokes.nameforge.evidence_id}/followup-packet/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        review_decision: 'accepted_internal_alpha_followup',
        reviewer_name: 'HaloFire Employee',
        review_ref: 'halofire://sam31/consumer-intake-smoke/nameforge/followup-review.json',
        marked_up_screenshot_ref: 'halofire://sam31/consumer-intake-smoke/nameforge/marked-up.png',
        issue_decisions: [
          {
            issue_type: 'sam31_consumer_intake_room_boundary_visual_audit',
            supported_sprinkler_review_lane: 'room_boundary_visual_audit',
            decision: 'accepted_for_internal_alpha_room_boundary_review',
            reviewed_values: {
              corrected_room_polygons: [
                { room: 'Office 101', polygon: [[0, 0], [10, 0], [10, 12], [0, 12]] },
              ],
            },
          },
          {
            issue_type: 'sam31_consumer_intake_obstruction_clash_review',
            supported_sprinkler_review_lane: 'obstruction_or_clash_review',
            decision: 'accepted_for_internal_alpha_obstruction_review',
            reviewed_values: {
              obstruction_candidates: [
                { label: 'duct', bbox: [1, 2, 3, 4], confidence: 0.68 },
              ],
            },
          },
        ],
      }),
    });
    expect(followupReviewRes.status).toBe(201);
    const followupReview = await followupReviewRes.json();
    expect(followupReview).toEqual(expect.objectContaining({
      evidence_type: 'halofire_sam31_consumer_intake_smoke_followup_review_decision',
      artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_review_decision.v1',
      status: 'present',
      source_packet_artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_packet.v1',
      source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
      review_decision: 'accepted_internal_alpha_followup',
      review_ref: 'halofire://sam31/consumer-intake-smoke/nameforge/followup-review.json',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(followupReview.resolver_queue_rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_resolver_queue_item.v1',
        status: 'ready_for_internal_alpha_sprinkler_review',
        issue_type: 'sam31_consumer_intake_room_boundary_visual_audit',
        supported_sprinkler_review_lane: 'room_boundary_visual_audit',
        source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: followupReview.id,
        source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
      expect.objectContaining({
        artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_resolver_queue_item.v1',
        status: 'ready_for_internal_alpha_sprinkler_review',
        issue_type: 'sam31_consumer_intake_obstruction_clash_review',
        supported_sprinkler_review_lane: 'obstruction_or_clash_review',
        source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: followupReview.id,
        source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
    ]));

    const reviewedSmokeScopedQueueRes = await request(`/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(projectName)}&consumerIntakeSmokeEvidenceId=${consumerIntakeSmokes.nameforge.evidence_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(reviewedSmokeScopedQueueRes.status).toBe(200);
    const reviewedSmokeScopedQueue = await reviewedSmokeScopedQueueRes.json();
    expect(reviewedSmokeScopedQueue.queue.items[0]).toEqual(expect.objectContaining({
      latest_halofire_sam31_consumer_intake_smoke_followup_review_decision: expect.objectContaining({
        evidence_id: followupReview.id,
        artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_review_decision.v1',
        review_decision: 'accepted_internal_alpha_followup',
        claim_gate_effect: 'no_claims_cleared',
      }),
      sam31_consumer_intake_smoke_followup_resolver_queue_items: expect.arrayContaining([
        expect.objectContaining({
          artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_resolver_queue_item.v1',
          supported_sprinkler_review_lane: 'room_boundary_visual_audit',
          source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: followupReview.id,
        }),
        expect.objectContaining({
          artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_resolver_queue_item.v1',
          supported_sprinkler_review_lane: 'obstruction_or_clash_review',
          source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: followupReview.id,
        }),
      ]),
    }));
    expect(reviewedSmokeScopedQueue.summary.sam31_consumer_intake_smoke_followup_reviews_recorded).toBeGreaterThanOrEqual(1);
    expect(reviewedSmokeScopedQueue.summary.sam31_consumer_intake_smoke_followup_resolver_queue_items).toBeGreaterThanOrEqual(2);
    expect(reviewedSmokeScopedQueue.queue.items[0].consumer_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'download_halofire_consumer_intake_smoke_sprinkler_review_packet',
        method: 'GET',
        consumes: 'halofire.sam31_consumer_intake_smoke_followup_resolver_queue_item.v1',
        produces: 'halofire.sam31_sprinkler_review_packet.v1',
        source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
        source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: followupReview.id,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
    ]));

    const sprinklerPacketRes = await request(`/api/projects/${encodeURIComponent(projectName)}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/${consumerIntakeSmokes.nameforge.evidence_id}/sprinkler-review-packet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(sprinklerPacketRes.status).toBe(200);
    const sprinklerPacket = await sprinklerPacketRes.json();
    expect(sprinklerPacket).toEqual(expect.objectContaining({
      artifact_type: 'halofire.sam31_sprinkler_review_packet.v1',
      source: 'halofire.sam31_consumer_intake_smoke_followup_resolver_queue_item.v1',
      status: 'requires_employee_sprinkler_review',
      source_section_to_artifacts_consumer_intake_smoke_evidence_id: consumerIntakeSmokes.nameforge.evidence_id,
      source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: followupReview.id,
      source_sam31_actual_value_replacement_evidence_id: consumerIntakeSmokes.nameforge.source_sam31_actual_value_replacement_evidence_id,
      source_openclaw_sam31_consumer_review_evidence_id: consumerIntakeSmokes.nameforge.source_openclaw_sam31_consumer_review_evidence_id,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(sprinklerPacket.supported_sprinkler_review_lanes).toEqual(expect.arrayContaining([
      'room_boundary_visual_audit',
      'obstruction_or_clash_review',
    ]));
    expect(sprinklerPacket.issue_seeds).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifact_type: 'halofire.sam31_sprinkler_review_queue_item.v1',
        issue_type: 'sam31_consumer_intake_room_boundary_visual_audit',
        supported_sprinkler_review_lane: 'room_boundary_visual_audit',
        source_followup_resolver_queue_item_artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_resolver_queue_item.v1',
        source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: followupReview.id,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
      expect.objectContaining({
        artifact_type: 'halofire.sam31_sprinkler_review_queue_item.v1',
        issue_type: 'sam31_consumer_intake_obstruction_clash_review',
        supported_sprinkler_review_lane: 'obstruction_or_clash_review',
        source_followup_resolver_queue_item_artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_resolver_queue_item.v1',
        source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: followupReview.id,
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
    ]));
    expect(sprinklerPacket.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'fabrication_ready',
      'AHJ_approval',
      'professional_approval',
      'manufacturer_exact',
      'AutoSprink_parity',
      'engineering_grade',
    ]));

    const tool = await (await request('/api/openclaw/sam31/tool', {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(tool.halofire_api_actions.section_to_artifacts_consumer_intake_smoke).toEqual(expect.objectContaining({
      method: 'POST',
      href_template: '/api/projects/{projectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke',
      consumes: 'openclaw.sam31.section_to_artifacts_consumer_handoff.v1',
      produces: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
      evidence_record_type: 'openclaw_sam31_section_to_artifacts_consumer_intake_smoke',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(tool.halofire_api_actions.consumer_intake_smoke_followup_packet).toEqual(expect.objectContaining({
      method: 'GET',
      href_template: '/api/projects/{projectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/{evidenceId}/followup-packet',
      consumes: 'openclaw.sam31.section_to_artifacts_consumer_intake_smoke.v1',
      produces: 'halofire.sam31_consumer_intake_smoke_followup_packet.v1',
      target_application: 'halo_fire',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(tool.halofire_api_actions.consumer_intake_smoke_followup_review).toEqual(expect.objectContaining({
      method: 'POST',
      href_template: '/api/projects/{projectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/{evidenceId}/followup-packet/review',
      consumes: 'halofire.sam31_consumer_intake_smoke_followup_packet.v1',
      produces: 'halofire.sam31_consumer_intake_smoke_followup_review_decision.v1',
      downstream_resolver_artifact_type: 'halofire.sam31_consumer_intake_smoke_followup_resolver_queue_item.v1',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(tool.halofire_api_actions.consumer_intake_smoke_sprinkler_review_packet).toEqual(expect.objectContaining({
      method: 'GET',
      href_template: '/api/projects/{projectName}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/{evidenceId}/sprinkler-review-packet',
      consumes: 'halofire.sam31_consumer_intake_smoke_followup_resolver_queue_item.v1',
      produces: 'halofire.sam31_sprinkler_review_packet.v1',
      target_application: 'halo_fire',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
  });
});
