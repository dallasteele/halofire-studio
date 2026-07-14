import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3273;
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-pitched-calibration-api-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test', HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'pitched-calibration-test-secret-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'pitched-calibration-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'pitched-calibration-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((resolve) => server.once('exit', resolve)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('authenticated pitched placement calibration corpus evidence', () => {
  it('rejects anonymous access to answer-exposed calibration', async () => {
    expect((await fetch(`${BASE}/api/evidence/pitched-placement-calibration-corpus`)).status).toBe(401);
  });

  it('returns the two-family calibration while keeping fresh placement and compliance blocked', async () => {
    const response = await fetch(`${BASE}/api/evidence/pitched-placement-calibration-corpus`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'passed', artifactType: 'halofire.pitched-placement-calibration-corpus.v1',
      mode: 'answer-exposed-multi-project-empirical-calibration',
      strategySelectorReadyForFreshHoldout: true, unseenProjectPlacementVerified: false,
      complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
      transferPolicy: { empiricalPriorOnly: true, codeLimit: false, answerExposed: true, unseenProjectHoldoutRequired: true },
      adversarialLoop: { status: 'passed', attemptedCases: 15 },
    });
    expect(body.trainingProjects).toHaveLength(2);
    expect(body.trainingProjects[1].answerExposedFeatures).toMatchObject({ completedHeadCount: 12, topology: { columns: 3, rows: 4 }, ridgeHeadColumnPresent: true });
    expect(body.failedHoldoutControls[1]).toMatchObject({ failurePreserved: true, nowUsedForCalibration: true });
  });
});
