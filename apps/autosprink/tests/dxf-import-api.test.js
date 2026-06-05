import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// T21: the sprinkler-bid pipeline must accept DXF drawings end-to-end —
// `dxf` (single-space floor plan) and `buildingDxf` (multi-space building) —
// parallel to the existing `svg` / `buildingSvg` paths, driving the 3D model
// through the running system. floorPlanFromDxf/buildingFromDxf already exist +
// are unit-tested; this asserts they are WIRED into the API.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3198;
const BASE = `http://127.0.0.1:${PORT}`;
const PROJ = '/api/projects/DXF%20Test';

let server; let tempDir; let token;

/** Minimal DXF with a single ENTITIES section. */
function dxf(...entityBlocks) {
  return ['0', 'SECTION', '2', 'ENTITIES', ...entityBlocks, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}
function lwpolyline(verts, layer = 'PLAN') {
  const out = ['0', 'LWPOLYLINE', '8', layer, '90', String(verts.length), '70', '1'];
  for (const [x, y] of verts) out.push('10', String(x), '20', String(y));
  return out;
}
function line([x1, y1], [x2, y2], layer) {
  return ['0', 'LINE', '8', layer, '10', String(x1), '20', String(y1), '11', String(x2), '21', String(y2)];
}
function circle([cx, cy], r, layer = 'COLUMN') {
  return ['0', 'CIRCLE', '8', layer, '10', String(cx), '20', String(cy), '40', String(r)];
}

// A 60x40 single-space floor plan (closed LWPOLYLINE).
const FLOOR_DXF = dxf(...lwpolyline([[0, 0], [60, 0], [60, 40], [0, 40]], 'PLAN'));

// A 2-space building on default layer names (ROOMS / WALLS-EXT / WALLS-INT / DOOR / COLUMN).
const BUILDING_DXF = dxf(
  ...lwpolyline([[0, 0], [20, 0], [20, 20], [0, 20]], 'ROOMS'),
  ...lwpolyline([[20, 0], [40, 0], [40, 20], [20, 20]], 'ROOMS'),
  ...line([0, 0], [40, 0], 'WALLS-EXT'),
  ...line([40, 0], [40, 20], 'WALLS-EXT'),
  ...line([40, 20], [0, 20], 'WALLS-EXT'),
  ...line([0, 20], [0, 0], 'WALLS-EXT'),
  ...line([20, 0], [20, 20], 'WALLS-INT'),
  ...line([20, 8], [20, 11], 'DOOR'),
  ...circle([10, 10], 0.75, 'COLUMN'),
);

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not healthy');
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-dxf-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'dxf-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'dxf-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const post = (body) => fetch(`${BASE}${PROJ}/sprinkler-bid`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});

describe('T21 DXF import wired into sprinkler-bid', () => {
  it('accepts a single-space `dxf` floor plan and returns a 3D model + bid', async () => {
    const res = await post({ dxf: FLOOR_DXF, unitsPerDrawingUnit: 1 });
    expect(res.status).toBe(200);
    const { bid, cadModel, isBuilding } = await res.json();
    expect(isBuilding).toBe(false);
    expect(bid.totalHeadCount).toBeGreaterThan(0);
    expect(cadModel.counts.heads).toBeGreaterThan(0);
    expect(cadModel.counts.walls).toBeGreaterThanOrEqual(4);
  });

  it('accepts a multi-space `buildingDxf` and returns a building CAD model', async () => {
    const res = await post({ buildingDxf: BUILDING_DXF });
    expect(res.status).toBe(200);
    const { bid, cadModel, isBuilding } = await res.json();
    expect(isBuilding).toBe(true);
    expect(cadModel.counts.spaces).toBeGreaterThanOrEqual(2);
    expect(cadModel.counts.interiorWalls).toBeGreaterThanOrEqual(1);
    expect(cadModel.counts.columns).toBeGreaterThanOrEqual(1);
    expect(bid.totalHeadCount).toBeGreaterThan(0);
  });

  it('rejects an empty/garbage dxf without 500ing', async () => {
    const res = await post({ dxf: 'not a dxf' });
    expect(res.status).toBe(400);
  });
});
