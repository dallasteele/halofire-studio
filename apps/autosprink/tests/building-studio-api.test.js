import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// T14 (API side): sprinkler-bid accepts a multi-space BUILDING drawing and
// returns a CAD model with interior+exterior walls (with opening metadata),
// columns, and per-space heads — the data the studio renders accurately.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3195;
const BASE = `http://127.0.0.1:${PORT}`;
const PROJ = '/api/projects/Test%20Building';
let server; let tempDir; let token;

const BUILDING_SVG = '<svg>'
  + '<polygon data-space data-hazard="ordinary" points="0,0 20,0 20,20 0,20"/>'
  + '<polygon data-space data-hazard="ordinary" points="20,0 40,0 40,20 20,20"/>'
  + '<line data-wall data-wall-type="exterior" x1="0" y1="0" x2="40" y2="0"/>'
  + '<line data-wall data-wall-type="exterior" x1="40" y1="0" x2="40" y2="20"/>'
  + '<line data-wall data-wall-type="exterior" x1="40" y1="20" x2="0" y2="20"/>'
  + '<line data-wall data-wall-type="exterior" x1="0" y1="20" x2="0" y2="0"/>'
  + '<line data-wall data-wall-type="interior" x1="20" y1="0" x2="20" y2="20"/>'
  + '<line data-opening data-opening-type="door" x1="20" y1="8" x2="20" y2="11"/>'
  + '<circle data-column cx="10" cy="10" r="0.5"/>'
  + '</svg>';

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not healthy');
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-bld-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'bld-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'bld-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('T14 building-mode sprinkler-bid', () => {
  it('returns a multi-space building CAD model with interior walls, columns, openings, per-space heads', async () => {
    const res = await fetch(`${BASE}${PROJ}/sprinkler-bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ buildingSvg: BUILDING_SVG }),
    });
    expect(res.status).toBe(200);
    const { bid, cadModel, isBuilding } = await res.json();
    expect(isBuilding).toBe(true);
    // building-shaped CAD model
    expect(cadModel.counts.spaces).toBeGreaterThanOrEqual(2);
    expect(cadModel.counts.interiorWalls).toBeGreaterThanOrEqual(1);
    expect(cadModel.counts.columns).toBeGreaterThanOrEqual(1);
    expect(cadModel.counts.openings).toBeGreaterThanOrEqual(1);
    // solids carry the data the studio needs to render accurately
    const walls = cadModel.solids.filter((s) => s.kind === 'wall');
    expect(walls.some((w) => w.type === 'interior')).toBe(true);
    expect(walls.some((w) => Array.isArray(w.openings) && w.openings.length > 0)).toBe(true);
    expect(cadModel.solids.some((s) => s.kind === 'column')).toBe(true);
    // every space gets heads (full coverage)
    expect(bid.totalHeadCount).toBeGreaterThan(0);
    expect(cadModel.counts.heads).toBeGreaterThan(0);
  });

  it('rejects a building drawing with no spaces', async () => {
    const res = await fetch(`${BASE}${PROJ}/sprinkler-bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ buildingSvg: '<svg><line data-wall data-wall-type="exterior" x1="0" y1="0" x2="10" y2="0"/></svg>' }),
    });
    expect(res.status).toBe(400);
  });
});
