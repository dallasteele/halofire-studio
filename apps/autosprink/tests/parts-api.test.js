import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// R2: GET /api/parts returns the part-mesh manifest. Auth is required.
// HONESTY/fail-closed: manufacturerExactCount===0, parityGateStatus==='blocked',
// a disclaimer is present, and NO entry is manufacturerExact:true.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3197;
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

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-parts-api-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'parts-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'parts-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('R2 GET /api/parts', () => {
  it('requires auth', async () => {
    const res = await fetch(`${BASE}/api/parts`);
    expect(res.status).toBe(401);
  });

  it('returns a fail-closed manifest: no manufacturer-exact, gate blocked', async () => {
    const res = await fetch(`${BASE}/api/parts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.components)).toBe(true);
    expect(body.components.length).toBeGreaterThan(0);
    expect(body.manufacturerExactCount).toBe(0);
    expect(body.parityGateStatus).toBe('blocked');
    expect(typeof body.disclaimer).toBe('string');
    expect(body.disclaimer.length).toBeGreaterThan(0);
    // honesty: never claim manufacturer-exact on any entry
    expect(body.components.every((e) => e.manufacturerExact !== true)).toBe(true);
    // every entry carries an honest source tag
    expect(body.components.every((e) => ['catalog', 'generated', 'missing'].includes(e.source))).toBe(true);
  });
});
