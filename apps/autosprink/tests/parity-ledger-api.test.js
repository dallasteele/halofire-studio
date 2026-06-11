import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// W14D: GET /api/parity reports a verification LEDGER, not a permanent blocked
// gate (flag-don't-gate doctrine). Spawns the real server on a dedicated port.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3261;
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-parity-ledger-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'parity-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'parity-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('GET /api/parity — verification ledger (un-gated)', () => {
  it('returns a usable ledger, not a blocked gate', async () => {
    const res = await fetch(`${BASE}/api/parity`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Doctrine: usable, ledger-framed, never a top-level block.
    expect(body.usable).toBe(true);
    expect(body.status).toBe('ledger');

    // Ledger shape.
    expect(body.ledger).toBeTruthy();
    expect(typeof body.ledger.total).toBe('number');
    expect(typeof body.ledger.humanVerified).toBe('number');
    expect(typeof body.ledger.needsVerification).toBe('number');
    expect(typeof body.ledger.coveragePct).toBe('number');
    expect(body.ledger.total).toBeGreaterThan(0);
    expect(body.ledger.humanVerified + body.ledger.needsVerification).toBe(body.ledger.total);

    // Human-readable summary string is present.
    expect(typeof body.ledgerSummary).toBe('string');
    expect(body.ledgerSummary).toContain('human-verified');

    // Functional matrix still present (back-compat).
    expect(body.matrix).toBeTruthy();
  });
});
