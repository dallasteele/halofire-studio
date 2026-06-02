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
});
