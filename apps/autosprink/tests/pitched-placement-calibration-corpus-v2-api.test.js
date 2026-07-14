import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3278;
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-pitched-calibration-v2-api-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test', HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'pitched-calibration-v2-secret-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'pitched-calibration-v2-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'pitched-calibration-v2-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((resolve) => server.once('exit', resolve)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('authenticated pitched placement calibration corpus revision two', () => {
  it('rejects anonymous access to answer-exposed calibration evidence', async () => {
    expect((await fetch(`${BASE}/api/evidence/pitched-placement-calibration-corpus-v2`)).status).toBe(401);
  });

  it('returns the three-project selector without promoting fresh placement', async () => {
    const response = await fetch(`${BASE}/api/evidence/pitched-placement-calibration-corpus-v2`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'passed', artifactType: 'halofire.pitched-placement-calibration-corpus.v2',
      receiptSha256: '1f2cee5fcd31e2966679dcbb54afd002e7e5bb0ce80bae170ac8131787c55a72',
      strategySelectorReadyForFreshHoldout: true, unseenProjectPlacementVerified: false,
      complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    });
    expect(body.trainingProjects).toHaveLength(3);
    expect(body.largeVaultStrategies.map((strategy) => strategy.layoutFamily)).toEqual([
      'large-symmetric-two-plane-vault-four-along', 'large-symmetric-two-plane-vault-two-along',
    ]);
    expect(body.contrastiveLearning).toMatchObject({ causalRuleClaimed: false });
    expect(body.adversarialLoop).toMatchObject({ status: 'passed', attemptedCases: 18 });
  });
});
