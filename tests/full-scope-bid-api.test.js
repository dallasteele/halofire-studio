import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// T22: the sprinkler-bid pipeline must now carry a best-effort FULL-SCOPE bid
// (bare materials + assumed system components + assumed soft costs) alongside
// the existing artifacts, fully honesty-flagged. For the built-in Home Depot
// project it also carries an INFORMATIONAL calibration delta vs the real
// submitted ESI bid-log total ($792,543.84) — never an accuracy/parity claim
// and never a gate clearance. This asserts the wiring + the fail-closed flags.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const HOME_DEPOT_NAME = 'Home Depot - Rexburg ID';
const GENERIC = '/api/projects/FullScope%20Test';
const HOME_DEPOT = `/api/projects/${encodeURIComponent(HOME_DEPOT_NAME)}`;

let server; let tempDir; let token;

// A 60x40 single-space floor plan (closed loop), enough to drive a real bid.
const FLOOR_PLAN = {
  name: 'FullScope Test',
  units: 'ft',
  rooms: [{
    name: 'Main',
    hazard: 'ordinary',
    ceilingHeightFt: 12,
    polygon: [[0, 0], [60, 0], [60, 40], [0, 40]],
  }],
};

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not healthy');
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-fullscope-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'fullscope-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'fullscope-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const post = (proj, body) => fetch(`${BASE}${proj}/sprinkler-bid`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});

describe('T22 full-scope bid wired into sprinkler-bid', () => {
  it('returns a honesty-flagged full-scope bid alongside existing artifacts', async () => {
    const res = await post(GENERIC, { floorPlan: FLOOR_PLAN });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Back-compat: every existing field is still present + unchanged in shape.
    expect(body.bid).toBeTruthy();
    expect(body.bid.totalHeadCount).toBeGreaterThan(0);
    expect(body.cadModel).toBeTruthy();
    expect(body.cadModel.counts.heads).toBeGreaterThan(0);
    expect(body.hydraulics).toBeTruthy();
    expect(body.isBuilding).toBe(false);

    // New: the full-scope estimate.
    const fsb = body.fullScopeBid;
    expect(fsb).toBeTruthy();
    expect(fsb.error).toBeUndefined();
    expect(fsb.estimate).toBe(true);
    expect(typeof fsb.disclaimer).toBe('string');
    expect(fsb.disclaimer.toLowerCase()).toContain('best-effort');

    // System-component lines: non-empty, and every non-pricebook line is
    // flagged fallback_estimate (no pricebook resolution -> all fallback here).
    expect(Array.isArray(fsb.systemComponentLines)).toBe(true);
    expect(fsb.systemComponentLines.length).toBeGreaterThan(0);
    for (const line of fsb.systemComponentLines) {
      expect(['pricebook', 'fallback_estimate']).toContain(line.priceSource);
      if (line.priceSource !== 'pricebook') {
        expect(line.priceSource).toBe('fallback_estimate');
      }
    }

    // Soft-cost lines: each is an explicit assumption.
    expect(Array.isArray(fsb.softCostLines)).toBe(true);
    expect(fsb.softCostLines.length).toBeGreaterThan(0);
    for (const line of fsb.softCostLines) {
      expect(line.priceSource).toBe('soft_cost_assumption');
    }

    // Totals roll up consistently and add scope on top of bare materials.
    expect(typeof fsb.bareMaterialsTotal).toBe('number');
    expect(fsb.fullScopeTotal).toBeGreaterThanOrEqual(fsb.bareMaterialsTotal);
    expect(fsb.fullScopeTotal).toBeGreaterThan(0);

    // Generic project gets NO calibration block.
    expect(fsb.calibration ?? null).toBeNull();

    // Nothing flips a gate: no parity/approved truthy flag on the full-scope bid.
    expect(fsb.parity).toBeUndefined();
    expect(fsb.approved).not.toBe(true);
    expect(fsb.submittalReady).not.toBe(true);
  });

  it('attaches an informational Home Depot calibration delta (not a parity claim)', async () => {
    const res = await post(HOME_DEPOT, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    const fsb = body.fullScopeBid;
    expect(fsb).toBeTruthy();
    expect(fsb.error).toBeUndefined();

    const cal = fsb.calibration;
    expect(cal).toBeTruthy();
    expect(cal.referenceTotal).toBe(792543.84);
    expect(cal.fullScopeTotal).toBe(fsb.fullScopeTotal);
    expect(typeof cal.deltaUsd).toBe('number');
    expect(typeof cal.deltaPct).toBe('number');
    expect(cal.deltaUsd).toBeCloseTo(fsb.fullScopeTotal - 792543.84, 1);
    // Honesty: explicitly NOT an accuracy or parity claim.
    expect(cal.note.toLowerCase()).toContain('not an accuracy or parity claim');

    // Calibration is informational only — it must not introduce any gate flag.
    expect(cal.parity).toBeUndefined();
    expect(cal.approved).toBeUndefined();
    expect(fsb.estimate).toBe(true);
  });

  it('does not flip any gate: /submittal stays submittalReady=false', async () => {
    const res = await fetch(`${BASE}${HOME_DEPOT}/submittal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const pkg = await res.json();
    expect(pkg.gateStatus).toBeTruthy();
    expect(pkg.gateStatus.submittalReady).toBe(false);
  });
});
