import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3271;
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-cholla-heldout-api-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test', HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'cholla-heldout-test-secret-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'cholla-heldout-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'cholla-heldout-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((resolve) => server.once('exit', resolve)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('authenticated Cholla Main House fresh held-out evidence', () => {
  it('rejects anonymous access to client answer evidence', async () => {
    expect((await fetch(`${BASE}/api/evidence/cholla-main-house-pitched-heldout`)).status).toBe(401);
  });

  it('returns the classification pass while placement and downstream gates remain closed', async () => {
    const response = await fetch(`${BASE}/api/evidence/cholla-main-house-pitched-heldout`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'passed', artifactType: 'halofire.cholla-pitched-heldout-comparison.v1',
      heldOutClassificationAcceptance: { status: 'passed', freshBeforeAnswerOpen: true },
      heldOutPlacementAcceptance: { status: 'not-assessed' },
      completedObservations: { sprinklerSchedule: { totalHeads: 45, family: 'residential pendent' } },
      unseenProjectClassificationVerified: true, unseenProjectPlacementVerified: false,
      topViewReady: false, elevationViewReady: false, model3dReady: false,
      hydraulicReplayReady: false, complianceReady: false, fabricationReady: false,
    });
    expect(body.checks.map((check) => check.status)).toEqual(['passed', 'passed', 'qualified-pass']);
    expect(body.adversarialLoop).toMatchObject({ status: 'passed', totalCases: 8 });
  });
});
