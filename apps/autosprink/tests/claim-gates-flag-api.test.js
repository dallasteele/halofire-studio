import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// W16B: every claim gate in the API response carries a verification flag —
// usable:true always (flag-don't-gate). Bare-array shape preserved.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3271;
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-gate-flag-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'gate-flag-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'gate-flag-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('GET /api/projects/:name/claim-gates — verification flags', () => {
  it('every gate is usable with a needs-verification flag (never a bare wall)', async () => {
    const res = await fetch(`${BASE}/api/projects/FlagProject/claim-gates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const gates = await res.json();
    expect(Array.isArray(gates)).toBe(true); // back-compat shape preserved
    expect(gates.length).toBeGreaterThan(0);
    for (const g of gates) {
      expect(g.usable).toBe(true);
      expect(['needs-verification', 'human-verified']).toContain(g.verificationStatus);
      expect(typeof g.flag_label).toBe('string');
    }
    const ahj = gates.find((g) => g.code === 'AHJ_APPROVAL_MISSING');
    expect(ahj).toBeTruthy();
    expect(ahj.verificationStatus).toBe('needs-verification');
    expect(ahj.flag_label).toContain('NEEDS VERIFICATION');
    expect(ahj.flag_residual).toContain('AHJ');
  });
});
