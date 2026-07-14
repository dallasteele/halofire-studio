import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3267;
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-reger-beam-api-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test', HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'reger-beam-test-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'reger-beam-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'reger-beam-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((resolve) => server.once('exit', resolve)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('authenticated Reger-Flores box-beam calibration evidence', () => {
  it('rejects anonymous access to client calibration evidence', async () => {
    expect((await fetch(`${BASE}/api/evidence/reger-flores-box-beam-calibration`)).status).toBe(401);
  });

  it('returns sealed visual proof while keeping fresh acceptance and compliance closed', async () => {
    const response = await fetch(`${BASE}/api/evidence/reger-flores-box-beam-calibration`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'passed', artifactType: 'halofire.reger-flores-box-beam-evidence.v1',
      freshHoldoutRequired: true, unseenProjectPlacementVerified: false, complianceReady: false, fabricationReady: false,
    });
    expect(body.views.counts).toEqual({ heads: 6, ceilingPlanes: 2, beamPartitions: 2, protectionCells: 6 });
    expect(body.views.topSvg.match(/data-head-id=/g)).toHaveLength(6);
    expect(body.views.model3dSvg).toContain('Partial-room calibration model');
    expect(body.adversarialLoop).toMatchObject({ status: 'passed', totalCases: 7 });
  });
});
