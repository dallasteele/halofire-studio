import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3272;
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-midvale-heldout-api-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test', HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'midvale-heldout-test-secret-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'midvale-heldout-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'midvale-heldout-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((resolve) => server.once('exit', resolve)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('authenticated Midvale Clubhouse fresh heldout evidence', () => {
  it('rejects anonymous access to the stamped answer comparison', async () => {
    expect((await fetch(`${BASE}/api/evidence/midvale-clubhouse-pitched-heldout-comparison`)).status).toBe(401);
  });

  it('returns a verified comparison artifact whose heldout placement result remains failed', async () => {
    const response = await fetch(`${BASE}/api/evidence/midvale-clubhouse-pitched-heldout-comparison`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'passed', artifactType: 'halofire.midvale-clubhouse-pitched-heldout-comparison.v1',
      approvedEvidence: { primary: { status: 'passed', detectedCount: 12 }, independent: { status: 'passed', detectedDropAssemblyCount: 12 } },
      prediction: { headCount: 8, uniqueColumnCount: 4, uniqueRowCount: 2 },
      approved: { headCount: 12, uniqueColumnCount: 3, uniqueRowCount: 4 },
      result: { status: 'failed', occupiedSlopedCeilingClassificationVerified: true, exactPlacementPatternVerified: false, countDelta: -4 },
      sourceOnlyClassifierVerified: true, unseenProjectPlacementVerified: false,
      topViewComparisonReady: true, elevationClassificationComparisonReady: true, partialModel3dComparisonReady: true,
      hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    });
    expect(body.comparisons.map((entry) => entry.parityPassed)).toEqual([false, false, false]);
    expect(body.overlaySvg.match(/data-approved-id=/g)).toHaveLength(12);
    expect(body.overlaySvg.match(/data-predicted-id=/g)).toHaveLength(8);
    expect(body.adversarialLoop).toMatchObject({ status: 'passed', attemptedCases: 14 });
  });
});
