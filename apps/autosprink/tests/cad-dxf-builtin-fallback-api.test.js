import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The CAD exports (DXF + OpenClaw CAD) are posted the studio's `lastBody`, which
// for the built-in demo projects carries NO svg / floorPlan / dxf (those jobs
// ship with no uploaded drawing). The route used to fall back to a built-in plan
// ONLY for Home Depot, so the live site returned 400 "No floor plan for DXF
// export" for The Cooperative 1881 — DXF/submittal export was dead for that job.
//
// This asserts the server-side built-in fallback now resolves a plan for BOTH
// demo projects (mirroring the sprinkler pipeline's own resolution) while still
// 400-ing an unknown project with no drawing. It also mirrors tests/cad-model.
// test.js export coverage (valid layered AC1009 DXF, head circles, EOF).
//
// HONESTY/flag-don't-gate: the DXF is geometry only. It clears NO AHJ/PE/
// AutoSprink-parity gate and makes no accuracy/parity/approval claim — the
// built-in plans carry their own needs-verification source notes.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3198;
const BASE = `http://127.0.0.1:${PORT}`;
const HOME_DEPOT_NAME = 'Home Depot - Rexburg ID';
const COOP_1881_NAME = 'The Cooperative 1881 - Salt Lake City UT';
const dxfPath = (name) => `/api/projects/${encodeURIComponent(name)}/cad.dxf`;

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-caddxf-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'caddxf-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'caddxf-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// Posts the studio's typical empty `lastBody` (no svg/floorPlan/dxf).
const postDxf = (name) => fetch(`${BASE}${dxfPath(name)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({}),
});

// Assert a response is a real layered AutoCAD R12 DXF (mirrors cad-model.test.js).
function expectValidDxf(text) {
  expect(text).toContain('SECTION');
  expect(text).toContain('$ACADVER');
  expect(text).toContain('AC1009');
  expect(text).toContain('ENTITIES');
  expect(text.trimEnd().endsWith('EOF')).toBe(true);
  for (const layer of ['WALLS', 'MAIN', 'BRANCH', 'DROPS', 'RISER', 'HEADS']) {
    expect(text).toContain(layer);
  }
  // At least one sized head circle was emitted (real network, not an empty doc).
  expect((text.match(/\nCIRCLE\n/g) || []).length).toBeGreaterThan(0);
}

describe('POST /api/projects/:name/cad.dxf — built-in floor-plan fallback', () => {
  it('exports a valid DXF for The Cooperative 1881 with an empty body (the fix)', async () => {
    const res = await postDxf(COOP_1881_NAME);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/dxf');
    expect(res.headers.get('content-disposition')).toContain('.dxf');
    expectValidDxf(await res.text());
  });

  it('still exports a valid DXF for Home Depot (regression)', async () => {
    const res = await postDxf(HOME_DEPOT_NAME);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/dxf');
    expectValidDxf(await res.text());
  });

  it('still 400s an unknown project that ships no drawing (no fabrication)', async () => {
    const res = await postDxf('No Such Project XYZ');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('No floor plan for DXF export');
  });

  it('still honors an explicit floorPlan in the body over the built-in', async () => {
    const res = await fetch(`${BASE}${dxfPath(COOP_1881_NAME)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        floorPlan: {
          name: COOP_1881_NAME,
          units: 'ft',
          rooms: [{ name: 'Bay', polygon: [[0, 0], [60, 0], [60, 40], [0, 40]], hazard: 'light', ceilingHeightFt: 14 }],
        },
      }),
    });
    expect(res.status).toBe(200);
    expectValidDxf(await res.text());
  });
});
