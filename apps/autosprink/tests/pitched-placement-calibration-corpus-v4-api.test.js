import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3285;
const BASE = `http://127.0.0.1:${PORT}`;
let server; let tempDir; let token;

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try { const response = await fetch(`${BASE}/api/health`); if (response.ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server not healthy');
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-pitched-calibration-v4-api-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test', HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'pitched-calibration-v4-secret-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'pitched-calibration-v4-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'pitched-calibration-v4-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((resolve) => server.once('exit', resolve)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('authenticated Winter Garden failure and pitched calibration revision four', () => {
  it('rejects anonymous access to both answer-exposed evidence routes', async () => {
    expect((await fetch(`${BASE}/api/evidence/winter-garden-meetinghouse-pitched-heldout-comparison`)).status).toBe(401);
    expect((await fetch(`${BASE}/api/evidence/pitched-placement-calibration-corpus-v4`)).status).toBe(401);
  });

  it('returns the truthful Winter Garden failed comparison', async () => {
    const response = await fetch(`${BASE}/api/evidence/winter-garden-meetinghouse-pitched-heldout-comparison`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'passed', artifactType: 'halofire.winter-garden-pitched-heldout-comparison.v1',
      receiptSha256: '3b98e28a00d007835675c0cc43f79c6bdadd56daf78c733072f040b023620116',
      result: { status: 'failed', countDelta: -3, exactPlacementPatternVerified: false, sourceProtectionZoneGeometryVerified: false },
      unseenProjectPlacementVerified: false, sourceProtectionZoneGeometryVerified: false,
      complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    });
    expect(body.approvedEvidence.primary).toMatchObject({ detectedCount: 9, threshold: 2.5 });
    expect(body.approved.topology).toEqual({ alongRidgeStations: 3, acrossSlopeStations: 3 });
    expect(body.adversarialLoop).toMatchObject({ status: 'passed', attemptedCases: 22 });
    expect(body.overlaySvg).toContain('FAILED: count, topology, and source span');
  });

  it('returns v4 while preserving the next fresh-holdout and clear-span gates', async () => {
    const response = await fetch(`${BASE}/api/evidence/pitched-placement-calibration-corpus-v4`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'passed', artifactType: 'halofire.pitched-placement-calibration-corpus.v4',
      receiptSha256: '6a37f16060e6dfc24358c83967f6ebf5b0964ddcbcf38368a72ce849ab3a4621',
      strategySelectorReadyForFreshHoldout: true, unseenProjectPlacementVerified: false,
      complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    });
    expect(body.trainingProjects).toHaveLength(5);
    expect(body.transferPolicy).toMatchObject({ clearSpanDisambiguationRequired: true, empiricalPriorOnly: true, codeLimit: false });
    expect(body.failedHoldoutControls.at(-1)).toMatchObject({ failurePreserved: true, countFailure: true, topologyFailure: true, sourceSpanFailure: true });
    expect(body.adversarialLoop).toMatchObject({ status: 'passed', attemptedCases: 23, selectorAttemptedCases: 2 });
  });
});
