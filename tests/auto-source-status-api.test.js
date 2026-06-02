import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// S5: GET /api/auto-source/status — read-only observability of the autonomous
// part-sourcing run. Auth required (NOT admin-only). HONESTY/fail-closed: with no
// status file it returns 200 status:"never-run" + parityGateStatus blocked; when a
// crafted file claims a cleared gate the endpoint RE-FORCES parityGateStatus
// 'blocked' + manufacturerExactCount 0. Never 500s.
const ROOT = path.resolve(import.meta.dirname, '..');
const STATUS_PATH = path.join(ROOT, 'out', 'auto-source-status.json');
const PORT = 3203;
const BASE = `http://127.0.0.1:${PORT}`;
let server; let tempDir; let token;

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not healthy');
}

function removeStatusFile() {
  try { fs.rmSync(STATUS_PATH, { force: true }); } catch { /* ignore */ }
}

beforeAll(async () => {
  removeStatusFile();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-autosource-api-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'autosource-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'autosource-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  removeStatusFile();
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

afterEach(() => { removeStatusFile(); });

describe('S5 GET /api/auto-source/status', () => {
  it('requires auth', async () => {
    const res = await fetch(`${BASE}/api/auto-source/status`);
    expect(res.status).toBe(401);
  });

  it('with no status file returns 200 status:"never-run" + parityGateStatus blocked', async () => {
    removeStatusFile();
    const res = await fetch(`${BASE}/api/auto-source/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('never-run');
    expect(body.parityGateStatus).toBe('blocked');
    expect(body.manufacturerExactCount).toBe(0);
    expect(typeof body.note).toBe('string');
    expect(body.sourceAcquisitionLedger.map((row) => row.family_ref)).toEqual([
      'family:pipe_steel_sch40_2p0in',
      'family:fitting_tee_2p0in',
      'family:valve_check_2p5in',
    ]);
    expect(body.sourceAcquisitionLedger.every((row) => row.status_tier === 'missing_catalog_source')).toBe(true);
  });

  it('RE-FORCES parityGateStatus blocked + manufacturerExactCount 0 from a tampered file', async () => {
    fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
    fs.writeFileSync(STATUS_PATH, JSON.stringify({
      lastRunAt: '2026-05-29T00:00:00.000Z',
      durationMs: 1234,
      bridgeUrl: 'http://127.0.0.1:15000',
      openclawReachable: true,
      openclawStatus: 'online',
      invokeAttempted: true,
      report: { foundCount: 9, createdCount: 0, generatedCount: 0, missingCount: 0 },
      functionalCoverage: { present: 9, total: 9, complete: true },
      // tampered honesty claims:
      manufacturerExactCount: 9,
      parityGateStatus: 'clear',
      disclaimer: 'tampered',
    }));

    const res = await fetch(`${BASE}/api/auto-source/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // RE-FORCED regardless of file contents:
    expect(body.parityGateStatus).toBe('blocked');
    expect(body.manufacturerExactCount).toBe(0);
    // legit observability fields still pass through:
    expect(body.report.foundCount).toBe(9);
    expect(body.openclawReachable).toBe(true);
    expect(body.lastRunAt).toBe('2026-05-29T00:00:00.000Z');
  });

  it('adds catalog vendor/source acquisition items to the project resolver queue without clearing claims', async () => {
    removeStatusFile();
    const res = await fetch(`${BASE}/api/projects/Home%20Depot%20-%20Rexburg%20ID/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const catalogItems = body.items.filter((item) => item.kind === 'catalog_vendor_acquisition');

    expect(catalogItems).toHaveLength(3);
    expect(body.summary.catalog_source_needed).toBe(3);
    expect(body.summary.catalog_review_needed).toBe(0);
    expect(catalogItems.map((item) => item.input_defaults.family_ref)).toEqual([
      'family:pipe_steel_sch40_2p0in',
      'family:fitting_tee_2p0in',
      'family:valve_check_2p5in',
    ]);
    expect(catalogItems[0]).toEqual(expect.objectContaining({
      status: 'catalog_source_needed',
      source_evidence_type: 'catalog_source_acquisition',
      claim_gate_effect: 'no_claims_cleared',
      next_action: expect.stringMatching(/manufacturer|vendor|catalog/i),
      ai_fallback: expect.stringMatching(/OpenClaw|step\.parts|vendor/i),
    }));
    expect(catalogItems[0].acceptable_evidence).toEqual(expect.arrayContaining([
      'manufacturer catalog page or vendor product page URL',
      'license or terms for downloaded CAD/BIM/STEP artifact',
    ]));
    expect(catalogItems[0].blocked_claims).toEqual(
      expect.arrayContaining(['manufacturer_exact', 'AutoSprink_parity', 'fabrication_ready']),
    );
    expect(catalogItems[0].actions[0].href).toContain('/settings.html?');
    expect(catalogItems[0].actions[0].href).toContain('component=pipe_sch40');
  });

  it('adds official-flow intake resolver items with documented defaults or exact intake blockers', async () => {
    const homeDepotRes = await fetch(`${BASE}/api/projects/Home%20Depot%20-%20Rexburg%20ID/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(homeDepotRes.status).toBe(200);
    const homeDepotBody = await homeDepotRes.json();
    const homeDepotItem = homeDepotBody.items.find((item) => item.kind === 'official_flow_intake');

    expect(homeDepotItem).toEqual(expect.objectContaining({
      status: 'official_flow_available',
      source_evidence_type: 'official_flow_intake',
      claim_gate_effect: 'no_claims_cleared',
      next_action: expect.stringMatching(/preliminary hydraulic replay|professional hydraulic/i),
      ai_fallback: expect.stringMatching(/preliminary hydraulic replay/i),
    }));
    expect(homeDepotItem.input_defaults).toEqual(expect.objectContaining({
      staticPsi: 76,
      residualPsi: 69,
      flowingGpm: 1226,
      source_status: 'documented_bid_package_values',
    }));
    expect(homeDepotItem.input_defaults.source_refs).toEqual(
      expect.arrayContaining(['Proposal- Home Depot - Rexburg ID.xlsx#Job Information!B3:B7']),
    );
    expect(homeDepotItem.acceptable_evidence).toEqual(expect.arrayContaining([
      'official flow test report or water supply data sheet',
      'licensed professional hydraulic calculation review',
    ]));
    expect(homeDepotItem.blocked_claims).toEqual(
      expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity', 'engineering_grade']),
    );
    expect(homeDepotBody.summary.official_flow_available).toBe(1);

    const coopRes = await fetch(`${BASE}/api/projects/The%20Cooperative%201881%20-%20Salt%20Lake%20City%20UT/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(coopRes.status).toBe(200);
    const coopBody = await coopRes.json();
    const coopItem = coopBody.items.find((item) => item.kind === 'official_flow_intake');
    expect(coopItem).toEqual(expect.objectContaining({
      status: 'official_flow_needed',
      source_evidence_type: 'official_flow_intake',
      next_action: expect.stringMatching(/Attach official flow test|water supply/i),
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(coopItem.input_defaults).toEqual(expect.objectContaining({
      source_status: 'missing_official_flow_values',
      project_head_count: 1420,
    }));
    expect(coopBody.summary.official_flow_needed).toBe(1);
  });

  it('records official-flow intake evidence and updates the resolver queue without clearing claims', async () => {
    const projectName = 'The Cooperative 1881 - Salt Lake City UT';
    const createRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        staticPsi: 72,
        residualPsi: 61,
        flowingGpm: 980,
        flowDataDate: '2026-05-30',
        waterModelRequired: 'employee-entered placeholder until official water model is attached',
        source_file: 'field-flow-report.pdf',
        source_ref: 'field-flow-report.pdf#page=1',
        reviewer_name: 'HaloFire Estimator',
        notes: 'Temporary employee-entered values for internal-alpha hydraulic replay only.',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.evidence.evidence_type).toBe('official_flow_intake');
    expect(created.evidence.status).toBe('present');
    expect(created.intake).toEqual(expect.objectContaining({
      staticPsi: 72,
      residualPsi: 61,
      flowingGpm: 980,
      source_ref: 'field-flow-report.pdf#page=1',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(created.intake.blocked_claims).toEqual(
      expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity']),
    );

    const queueRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(queueRes.status).toBe(200);
    const queue = await queueRes.json();
    const item = queue.items.find((row) => row.kind === 'official_flow_intake');
    expect(item).toEqual(expect.objectContaining({
      status: 'official_flow_evidence_recorded',
      evidence_id: created.id,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(item.input_defaults).toEqual(expect.objectContaining({
      source_status: 'employee_recorded_official_flow_intake',
      staticPsi: 72,
      residualPsi: 61,
      flowingGpm: 980,
    }));
    expect(queue.summary.official_flow_evidence_recorded).toBe(1);

    const artifactRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/${created.id}/replay-artifact`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(artifactRes.status).toBe(200);
    const artifact = await artifactRes.json();
    expect(artifact).toEqual(expect.objectContaining({
      artifact_type: 'official_flow_hydraulic_replay_artifact',
      status: 'best_effort_internal_alpha',
      source_evidence_id: created.id,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(artifact.official_flow_input).toEqual(expect.objectContaining({
      staticPsi: 72,
      residualPsi: 61,
      flowingGpm: 980,
      source_ref: 'field-flow-report.pdf#page=1',
    }));
    expect(artifact.hydraulic_summary).toEqual(expect.objectContaining({
      estimate: true,
      sourcePsiBasis: 'residualPsi',
    }));
    expect(typeof artifact.hydraulic_summary.requiredSourcePsi).toBe('number');
    expect(Array.isArray(artifact.issue_list)).toBe(true);
    expect(artifact.issue_list).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'PROFESSIONAL_HYDRAULIC_REVIEW_MISSING',
        severity: 'blocking',
      }),
    ]));
    expect(artifact.blocked_claims).toEqual(
      expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity']),
    );

    const persistRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/${created.id}/replay-artifact`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(persistRes.status).toBe(201);
    const persisted = await persistRes.json();
    expect(persisted).toEqual(expect.objectContaining({
      message: expect.stringMatching(/claims still blocked/i),
      artifact: expect.objectContaining({
        artifact_type: 'official_flow_hydraulic_replay_artifact',
        source_evidence_id: created.id,
        claim_gate_effect: 'no_claims_cleared',
      }),
      evidence: expect.objectContaining({
        evidence_type: 'official_flow_hydraulic_replay_artifact',
        status: 'best_effort',
        source_ref: `official-flow:${created.id}:hydraulic-replay`,
      }),
    }));
    const notes = JSON.parse(persisted.evidence.notes);
    expect(notes).toEqual(expect.objectContaining({
      kind: 'official_flow_hydraulic_replay_artifact',
      source_evidence_id: created.id,
      artifact_type: 'official_flow_hydraulic_replay_artifact',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(notes.blocked_claims).toEqual(
      expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity']),
    );

    const evidenceRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(evidenceRes.status).toBe(200);
    const evidenceRows = await evidenceRes.json();
    expect(evidenceRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: persisted.id,
        evidence_type: 'official_flow_hydraulic_replay_artifact',
        status: 'best_effort',
      }),
    ]));

    const persistedArtifactRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/evidence/${persisted.id}/official-flow-hydraulic-replay-artifact`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(persistedArtifactRes.status).toBe(200);
    const persistedArtifact = await persistedArtifactRes.json();
    expect(persistedArtifact).toEqual(expect.objectContaining({
      artifact_type: 'official_flow_hydraulic_replay_artifact',
      status: 'best_effort_internal_alpha',
      evidence_id: persisted.id,
      source_evidence_id: created.id,
      claim_gate_effect: 'no_claims_cleared',
    }));
  });
});
