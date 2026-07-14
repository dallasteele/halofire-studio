import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3284;
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-pitched-calibration-v3-api-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test', HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'pitched-calibration-v3-secret-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'pitched-calibration-v3-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'pitched-calibration-v3-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((resolve) => server.once('exit', resolve)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('authenticated pitched placement topology calibration revision three', () => {
  it('rejects anonymous access to answer-exposed topology calibration evidence', async () => {
    expect((await fetch(`${BASE}/api/evidence/pitched-placement-calibration-corpus-v3`)).status).toBe(401);
  });

  it('returns the four-project selector while preserving the next fresh-holdout gate', async () => {
    const response = await fetch(`${BASE}/api/evidence/pitched-placement-calibration-corpus-v3`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'passed', artifactType: 'halofire.pitched-placement-calibration-corpus.v3',
      receiptSha256: 'c9865fa6713ea4eea83f0e5afbe8587205f6d2a150f4bbc6dcc1e10f6fe32101',
      strategySelectorReadyForFreshHoldout: true, unseenProjectPlacementVerified: false,
      complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    });
    expect(body.trainingProjects).toHaveLength(4);
    expect(body.largeVaultStrategies.map((strategy) => strategy.layoutFamily)).toEqual([
      'large-symmetric-two-plane-vault-four-along',
      'large-symmetric-two-plane-vault-two-along',
      'large-symmetric-two-plane-vault-three-along-four-across-obstructed-ridge',
    ]);
    expect(body.failedHoldoutControls.at(-1)).toMatchObject({ failurePreserved: true, equalCountTopologyFailure: true });
    expect(body.contrastiveLearning).toMatchObject({ causalRuleClaimed: false });
    expect(body.adversarialLoop).toMatchObject({ status: 'passed', attemptedCases: 21 });
  });
});
