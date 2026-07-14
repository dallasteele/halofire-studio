import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3276;
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-moses-lake-heldout-api-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test', HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'moses-lake-heldout-test-secret-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'moses-lake-heldout-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'moses-lake-heldout-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((resolve) => server.once('exit', resolve)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('authenticated Moses Lake Stake Center fresh heldout evidence', () => {
  it('rejects anonymous access to the approved and as-built comparison', async () => {
    expect((await fetch(`${BASE}/api/evidence/moses-lake-stake-center-pitched-heldout-comparison`)).status).toBe(401);
  });

  it('returns a verified comparison artifact whose fresh placement result remains failed', async () => {
    const response = await fetch(`${BASE}/api/evidence/moses-lake-stake-center-pitched-heldout-comparison`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'passed', artifactType: 'halofire.moses-lake-stake-center-pitched-heldout-comparison.v1',
      approvedEvidence: {
        primary: { status: 'passed', detectedCount: 6 },
        independent: { status: 'passed', detectedCount: 6 },
        asBuiltParity: { status: 'passed', detectedCount: 6, centersEqualApproved: true },
      },
      prediction: { headCount: 12, uniqueAlongRidgeStations: 4, uniqueAcrossSlopeStations: 3 },
      approved: { headCount: 6, uniqueAlongRidgeStations: 2, uniqueAcrossSlopeStations: 3 },
      result: { status: 'failed', occupiedSlopedCeilingClassificationVerified: true, exactPlacementPatternVerified: false, countDelta: 6 },
      sourceOnlyClassifierVerified: true, unseenProjectPlacementVerified: false,
      topViewComparisonReady: true, elevationClassificationComparisonReady: true, partialModel3dComparisonReady: true,
      hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    });
    expect(body.comparisons.map((entry) => entry.parityPassed)).toEqual([false, false, false]);
    expect(body.overlaySvg.match(/data-approved-id=/g)).toHaveLength(6);
    expect(body.overlaySvg.match(/data-predicted-id=/g)).toHaveLength(12);
    expect(body.adversarialLoop).toMatchObject({ status: 'passed', attemptedCases: 17 });
  });
});
