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
});
