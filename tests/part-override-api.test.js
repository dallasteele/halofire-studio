import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

// R4: per-component catalog part overrides attached via Settings.
// A user attests a real catalog/manufacturer part for one component — the ONLY
// path to source 'catalog' + manufacturerExact:true. HONESTY/fail-closed:
// attaching a part NEVER clears AUTOSPRINK_PARITY (parityGateStatus stays
// 'blocked'), and a non-mesh (STEP/DWG) format is recorded but NOT web-renderable
// (file stays null). Admin-only writes; non-admin gets 403.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3200;
const BASE = `http://127.0.0.1:${PORT}`;
let server; let tempDir; let dbPath; let token;

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not healthy');
}

function seedViewer() {
  const db = new Database(dbPath);
  const hash = bcrypt.hashSync('viewer-pw', 12);
  db.prepare('INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)').run(
    'parts-viewer', hash, 'Viewer', 'user', 'viewer@example.test',
  );
  db.close();
}

async function login(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return (await res.json()).token;
}

const postOverride = (key, body, tok = token) => fetch(`${BASE}/api/parts/${key}/override`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
  body: JSON.stringify(body),
});

const getParts = async () => {
  const res = await fetch(`${BASE}/api/parts`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-part-override-'));
  dbPath = path.join(tempDir, 'h.db');
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: dbPath,
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'override-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  seedViewer();
  token = await login('admin', 'override-test-pw');
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('R4 POST /api/parts/:key/override — auth + validation', () => {
  it('blocks non-admin users (403)', async () => {
    const viewerToken = await login('parts-viewer', 'viewer-pw');
    const res = await postOverride('head_pendent', { mode: 'link', url: 'https://x/y.stl', format: 'stl' }, viewerToken);
    expect(res.status).toBe(403);
  });

  it('rejects an unknown component key (404)', async () => {
    const res = await postOverride('not_a_real_key', { mode: 'link', url: 'https://x/y.stl', format: 'stl' });
    expect(res.status).toBe(404);
  });

  it('rejects an unsupported field (400)', async () => {
    const res = await postOverride('head_pendent', { mode: 'link', url: 'https://x/y.stl', bogus: 1 });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid mode (400)', async () => {
    const res = await postOverride('head_pendent', { mode: 'teleport', url: 'https://x/y.stl' });
    expect(res.status).toBe(400);
  });

  it('rejects a link override missing its url (400)', async () => {
    const res = await postOverride('head_pendent', { mode: 'link', format: 'stl' });
    expect(res.status).toBe(400);
  });
});

describe('R4 catalog override merges into GET /api/parts', () => {
  it('a web-mesh link override (mfr+license) -> source catalog, manufacturerExact true, file set', async () => {
    const res = await postOverride('head_pendent', {
      mode: 'link',
      url: 'https://catalog.example/head_pendent.stl',
      format: 'stl',
      manufacturer: 'Tyco',
      license: 'TFP-LICENSE-2026',
      notes: 'TY323 pendent',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('catalog');
    expect(body.manufacturerExact).toBe(true);

    const { status, body: parts } = await getParts();
    expect(status).toBe(200);
    const entry = parts.components.find((c) => c.key === 'head_pendent');
    expect(entry).toBeDefined();
    expect(entry.source).toBe('catalog');
    expect(entry.manufacturerExact).toBe(true);
    expect(entry.file).toBe('https://catalog.example/head_pendent.stl');
    expect(entry.present).toBe(true);
    expect(parts.manufacturerExactCount).toBeGreaterThanOrEqual(1);
  });

  it('a non-mesh (STEP/DWG) override -> source catalog but file null (not web-renderable)', async () => {
    const res = await postOverride('head_upright', {
      mode: 'upload',
      filename: 'head_upright.step',
      format: 'step',
      manufacturer: 'Viking',
      license: 'VK-LICENSE-2026',
    });
    expect(res.status).toBe(200);

    const { body: parts } = await getParts();
    const entry = parts.components.find((c) => c.key === 'head_upright');
    expect(entry.source).toBe('catalog');
    // Rule: STEP/DWG is recorded as catalog evidence but is NOT web-renderable.
    expect(entry.file).toBeNull();
    expect(entry.present).toBe(false);
    // Manufacturer + license were both attested, so manufacturerExact is true
    // even though no renderable mesh exists.
    expect(entry.manufacturerExact).toBe(true);
  });

  it('a catalog override WITHOUT a license -> manufacturerExact false (fail-closed)', async () => {
    const res = await postOverride('head_sidewall', {
      mode: 'link',
      url: 'https://catalog.example/head_sidewall.glb',
      format: 'glb',
      manufacturer: 'Reliable',
    });
    expect(res.status).toBe(200);
    const { body: parts } = await getParts();
    const entry = parts.components.find((c) => c.key === 'head_sidewall');
    expect(entry.source).toBe('catalog');
    expect(entry.manufacturerExact).toBe(false); // no license attested
    expect(entry.file).toBe('https://catalog.example/head_sidewall.glb');
  });

  it('CRITICAL: parityGateStatus stays blocked AFTER overrides (gate never clears)', async () => {
    const { body: parts } = await getParts();
    expect(parts.parityGateStatus).toBe('blocked');
    expect(typeof parts.disclaimer).toBe('string');
    expect(parts.disclaimer.length).toBeGreaterThan(0);
  });

  it('keeps the library honest: required components without overrides stay missing', async () => {
    const { body: parts } = await getParts();
    // Some required components remain un-overridden -> still missing/not present.
    const stillMissing = parts.components.filter((c) => c.present !== true);
    expect(stillMissing.length).toBeGreaterThan(0);
    expect(parts.missingCount).toBeGreaterThan(0);
    // Every entry still carries an honest source tag.
    expect(parts.components.every((c) => ['catalog', 'manufacturer', 'generated', 'missing'].includes(c.source))).toBe(true);
    // No entry is manufacturerExact:true unless its source is catalog/manufacturer.
    expect(parts.components.every((c) => c.manufacturerExact !== true || ['catalog', 'manufacturer'].includes(c.source))).toBe(true);
  });
});

describe('R4 DELETE /api/parts/:key/override', () => {
  it('removes an override and the key reverts in GET /api/parts', async () => {
    const res = await fetch(`${BASE}/api/parts/head_pendent/override`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const { body: parts } = await getParts();
    const entry = parts.components.find((c) => c.key === 'head_pendent');
    expect(entry.source).not.toBe('catalog');
    expect(entry.manufacturerExact).not.toBe(true);
  });

  it('returns 404 when deleting a non-existent override', async () => {
    const res = await fetch(`${BASE}/api/parts/head_concealed/override`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});
