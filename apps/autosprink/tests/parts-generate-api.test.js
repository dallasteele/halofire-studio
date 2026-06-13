import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// AS-3: POST /api/parts/generate builds best-effort OpenSCAD via the JS port of
// the canonical W13A emitters and lands every row needs-verification in
// parts_models (flag-don't-gate: missing dims store an honest row, never block).
// GET /api/parity modelsBuilt becomes the REAL generated-row count. Spawns the
// real server on a dedicated port (same harness as parity-ledger-api.test.js).
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3291;
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

function generate(body) {
  return fetch(`${BASE}/api/parts/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-parts-generate-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'parts-generate-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'parts-generate-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('POST /api/parts/generate — real parts coverage (AS-3)', () => {
  it('generates a tee: row with scad + needs-verification', async () => {
    const res = await generate({
      sku: 'TEE-2IN-TEST',
      partType: 'tee',
      nominalIn: 2,
      dims: { odIn: 2, centerToEndIn: 4, branchCenterToEndIn: 3 },
      sourceUrl: 'https://example.com/tee-cutsheet',
    });
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.sku).toBe('TEE-2IN-TEST');
    expect(row.part_type).toBe('tee');
    expect(row.verification_status).toBe('needs-verification');
    expect(row.missing).toEqual([]);
    expect(row.source_url).toBe('https://example.com/tee-cutsheet');
    expect(typeof row.generated_at).toBe('string');
    // The honest parametric scad body (port of apps/cad/src/lib/scad-emitters.ts).
    expect(row.scad).toContain('// Dimensioned parametric, not manufacturer-exact');
    expect(row.scad).toContain('union() {');
    expect(row.scad).toContain('cylinder(h=203.200, r=25.400, center=true);');
  });

  it('missing dims -> 200 with scad null + missing listed (flag, not gate)', async () => {
    const res = await generate({
      sku: 'ELBOW-MISSING-DIMS',
      partType: 'elbow90',
      nominalIn: 1.5,
      dims: { odIn: 1.9 }, // centerToEndIn absent
    });
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.scad).toBeNull();
    expect(row.missing).toEqual(['centerToEndIn']);
    expect(row.verification_status).toBe('needs-verification');
  });

  it('bad dims -> 400 with the RangeError message', async () => {
    const res = await generate({
      sku: 'PIPE-BAD-DIMS',
      partType: 'pipe',
      nominalIn: 2,
      dims: { lengthIn: -10, odIn: 2.375, wallIn: 0.154 },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('must be a finite positive number');
  });

  it('GET /api/parity modelsBuilt reflects the generated count', async () => {
    const res = await fetch(`${BASE}/api/parity`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // One row with scad (the tee). The missing-dims elbow has scad NULL and the
    // bad-dims pipe was rejected, so neither counts.
    expect(body.modelsBuilt).toBe(1);
    // Legacy inventory-based count is kept alongside.
    expect(typeof body.modelsBuiltLegacy).toBe('number');
    // Ledger total stays the component count (unchanged by generation).
    expect(body.ledger.total).toBeGreaterThan(0);
    expect(body.usable).toBe(true);
  });
});
