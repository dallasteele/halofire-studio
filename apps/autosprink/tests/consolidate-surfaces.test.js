import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// T9 — surfaces are consolidated to index (landing) -> workbench -> studio.
// The legacy static app.html fake dashboard must be retired: /app.html redirects
// to the real workbench, and the SPA catch-all serves the landing (NOT the old
// dashboard) for unknown routes.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3196;
const BASE = `http://127.0.0.1:${PORT}`;
let server; let tempDir;

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not become healthy');
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-consolidate-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'halofire.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'consolidate-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('T9 consolidated surfaces', () => {
  it('serves the landing (index) at /, not the legacy dashboard', async () => {
    const body = await (await fetch(`${BASE}/`)).text();
    expect(body).toMatch(/Secure Portal/i);
    expect(body).not.toMatch(/Pure Vanilla JS, Zero Dependencies/);
  });

  it('retires the legacy app.html — it now redirects to the workbench', async () => {
    const res = await fetch(`${BASE}/app.html`, { redirect: 'manual' });
    const body = await res.text();
    // Either a 3xx Location redirect or an HTML page that points to /workbench.html.
    const redirects = (res.status >= 300 && res.status < 400) || /\/workbench\.html/.test(body);
    expect(redirects).toBe(true);
    // The old fake dashboard content must be gone.
    expect(body).not.toMatch(/Pure Vanilla JS, Zero Dependencies/);
    expect(body).not.toMatch(/REVENUE/);
  });

  it('serves the landing for unknown SPA routes, not the legacy dashboard', async () => {
    const body = await (await fetch(`${BASE}/some/unknown/route`)).text();
    expect(body).toMatch(/Secure Portal/i);
    expect(body).not.toMatch(/Pure Vanilla JS, Zero Dependencies/);
  });

  it('still serves the real workbench + studio surfaces', async () => {
    const wb = await (await fetch(`${BASE}/workbench.html`)).text();
    expect(wb).toMatch(/Workbench/i);
    const studio = await (await fetch(`${BASE}/autosprink.html`)).text();
    expect(studio).toMatch(/Sprinkler CAD|OpenGeometry/i);
  });
});
