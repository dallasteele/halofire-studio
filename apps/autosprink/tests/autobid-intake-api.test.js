import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// AB2 intake API: settings round-trip (password write-only), status surface, and
// the bid->evidence link. Spawns the real server on a dedicated port (codebase
// convention). NO network mail is touched here — only the config/status routes.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3252;
const BASE = `http://127.0.0.1:${PORT}`;
let server; let tempDir; let token; let dbPath;

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not healthy');
}

function authed(extra = {}) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra };
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-intake-api-'));
  dbPath = path.join(tempDir, 'h.db');
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: dbPath,
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'intake-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'intake-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('AB2 intake API — auth', () => {
  it('requires auth on intake settings', async () => {
    expect((await fetch(`${BASE}/api/settings/intake-email`)).status).toBe(401);
  });
  it('requires auth on intake status', async () => {
    expect((await fetch(`${BASE}/api/autobid/intake/status`)).status).toBe(401);
  });
});

describe('AB2 intake API — settings round-trip never returns the password', () => {
  it('starts unconfigured', async () => {
    const cfg = await (await fetch(`${BASE}/api/settings/intake-email`, { headers: authed() })).json();
    expect(cfg.configured).toBe(false);
    expect(cfg.password_set).toBe(false);
    expect('password' in cfg).toBe(false);
  });

  it('saves config and reports configured, but never echoes the password', async () => {
    const res = await fetch(`${BASE}/api/settings/intake-email`, {
      method: 'POST', headers: authed(),
      body: JSON.stringify({
        host: 'imap.example.test', port: 993,
        username: 'bids@halofire.test', password: 'super-secret-app-password', enabled: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The POST response must NOT contain the password either.
    expect('password' in body).toBe(false);
    expect(body.password_set).toBe(true);
    expect(body.configured).toBe(true);
    expect(JSON.stringify(body)).not.toContain('super-secret-app-password');

    const cfg = await (await fetch(`${BASE}/api/settings/intake-email`, { headers: authed() })).json();
    expect(cfg.host).toBe('imap.example.test');
    expect(cfg.port).toBe(993);
    expect(cfg.username).toBe('bids@halofire.test');
    expect(cfg.enabled).toBe(true);
    expect(cfg.password_set).toBe(true);
    expect('password' in cfg).toBe(false);
    expect(JSON.stringify(cfg)).not.toContain('super-secret-app-password');
  });

  it('updates non-secret fields without clearing the stored password', async () => {
    await fetch(`${BASE}/api/settings/intake-email`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ enabled: false }),
    });
    const cfg = await (await fetch(`${BASE}/api/settings/intake-email`, { headers: authed() })).json();
    expect(cfg.enabled).toBe(false);
    expect(cfg.password_set).toBe(true); // password preserved across an enabled-only update
  });

  it('rejects an unauthenticated write (auth gate before the admin gate)', async () => {
    const res = await fetch(`${BASE}/api/settings/intake-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'evil.test' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects unsupported fields with 400', async () => {
    const res = await fetch(`${BASE}/api/settings/intake-email`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ bogus: 'x' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('AB2 intake API — status surface', () => {
  it('reports configured/enabled and an empty recent list before any poll', async () => {
    const status = await (await fetch(`${BASE}/api/autobid/intake/status`, { headers: authed() })).json();
    expect(status.configured).toBe(true);
    expect(Array.isArray(status.recent)).toBe(true);
    expect(status.last_poll_at).toBeNull();
  });
});

describe('AB2 intake API — bid evidence link', () => {
  it('returns an empty evidence list for a manually-created bid', async () => {
    const c = await (await fetch(`${BASE}/api/clients`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ name: 'Evidence Co' }),
    })).json();
    const b = await (await fetch(`${BASE}/api/bid-requests`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ client_id: c.id, title: 'Manual bid' }),
    })).json();
    const res = await fetch(`${BASE}/api/bid-requests/${b.id}/evidence`, { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bid_request_id).toBe(b.id);
    expect(Array.isArray(body.evidence)).toBe(true);
    expect(body.evidence).toHaveLength(0);
  });

  it('404s for an unknown bid', async () => {
    const res = await fetch(`${BASE}/api/bid-requests/999999/evidence`, { headers: authed() });
    expect(res.status).toBe(404);
  });
});
