import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3293;
const BASE = `http://127.0.0.1:${PORT}`;
const PROJECT = 'LDS Meeting House - Winter Garden FL';
let server; let tempDir; let token;

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    try { const response = await fetch(`${BASE}/api/health`); if (response.ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server not healthy');
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-wg-source-building-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'halofire.db'),
      JWT_SECRET: 'winter-garden-source-building-test-secret',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: 'winter-garden-test-password',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'winter-garden-test-password' }),
  });
  token = (await login.json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((resolve) => server.once('exit', resolve)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('GET /api/projects/:name/source-building-model', () => {
  it('requires login', async () => {
    const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(PROJECT)}/source-building-model`);
    expect(response.status).toBe(401);
  });

  it('serves sealed source-only 3D geometry, rendered views, and brain knowledge provenance', async () => {
    const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(PROJECT)}/source-building-model`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('passed');
    expect(body.receiptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.counts).toEqual({ rooms: 56, roofSurfaces: 11, pitchedRoofSurfaces: 10, verticalFeatures: 1 });
    expect(body.operationalKnowledge.preflightStatus).toBe('passed');
    expect(body.operationalKnowledge.sources).toContain('halofire/bid-process-knowledge.md');
    expect(body.operationalKnowledge.workflowGuardrails).toContain('primary-independent-and-adversarial-verification-loops-are-internal');
    expect(body.views.topSvg).toContain('<svg');
    expect(body.views.isometricSvg).toContain('<svg');
    expect(body.geometryGrounded).toBe(true);
    expect(body.operationalKnowledgeGrounded).toBe(true);
    expect(body.complianceReady).toBe(false);
    expect(body.fabricationReady).toBe(false);
  });

  it('fails closed for an unsealed project', async () => {
    const response = await fetch(`${BASE}/api/projects/Unknown/source-building-model`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(404);
    expect((await response.json()).complianceReady).toBe(false);
  });
});
