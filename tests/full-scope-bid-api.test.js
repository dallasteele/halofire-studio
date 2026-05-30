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
// T24: the real ESI takeoff is parsed from this untracked-but-present workbook.
// Skip the realTakeoff assertion on a fresh clone / CI that lacks the file.
const HAVE_WORKBOOK = fs.existsSync(path.join(ROOT, 'Proposal- Home Depot - Rexburg ID.xlsx'));
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

  // T24: the Home Depot calibration carries the REAL ESI takeoff parsed from the
  // proposal workbook (Building 1 SOV block) as an explicit evidence trail.
  // SKIP-IF-ABSENT: untracked workbook may be missing on a fresh clone / CI.
  it.skipIf(!HAVE_WORKBOOK)('enriches Home Depot calibration with the real ESI takeoff (no gate flips)', async () => {
    const res = await post(HOME_DEPOT, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    const cal = body.fullScopeBid.calibration;
    expect(cal).toBeTruthy();

    const rt = cal.realTakeoff;
    expect(rt).toBeTruthy();
    // Real parsed numbers from the submitted takeoff.
    expect(rt.cost.material).toBeCloseTo(396097.57, 2);
    expect(rt.cost.labor).toBeCloseTo(143473.33, 2);
    expect(rt.cost.equipment).toBeCloseTo(36431.44, 2);
    expect(rt.withMarkup.materials).toBeCloseTo(514926.85, 2);
    expect(rt.withMarkup.labor).toBeCloseTo(233876.19, 2);
    expect(rt.withMarkup.sovTotal).toBeCloseTo(758553.04, 2);
    expect(rt.totalPrice).toBeCloseTo(767543.84, 2);
    expect(rt.bidLogTotal).toBe(792543.84);
    expect(rt.markupPct).toBeCloseTo(0.30, 2);

    // Explicit evidence trail: cited Building 1 source cells.
    expect(rt.sourceRefs).toContain('Proposal- Home Depot - Rexburg ID.xlsx#Building 1!N31');
    expect(rt.sourceRefs).toContain('Proposal- Home Depot - Rexburg ID.xlsx#Building 1!U34');

    // Itemized comparison present + labelled informational.
    expect(Array.isArray(cal.byCategory.rows)).toBe(true);
    expect(cal.byCategory.rows.length).toBeGreaterThan(0);
    expect(cal.byCategory.note.toLowerCase()).toContain('not an accuracy or parity claim');

    // Honesty: the real takeoff clears NOTHING. No parity/approval flag anywhere.
    expect(rt.disclaimer.toLowerCase()).not.toContain('parity');
    expect(cal.realTakeoff.parity).toBeUndefined();
    expect(cal.realTakeoff.approved).toBeUndefined();
    expect(body.fullScopeBid.estimate).toBe(true);

    // The auto-estimate stays honestly short (negative delta vs the real total).
    expect(cal.deltaPct).toBeLessThan(0);

    // Gate UNCHANGED: AUTOSPRINK_PARITY stays blocked; realTakeoff clears nothing.
    const parityRes = await fetch(`${BASE}/api/parity`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` },
    });
    expect(parityRes.status).toBe(200);
    const parityBody = await parityRes.json();
    expect(parityBody.gate.status).toBe('blocked');
    expect(parityBody.parityAchieved).not.toBe(true);
  });

  it('a generic project carries NO realTakeoff', async () => {
    const res = await post(GENERIC, { floorPlan: FLOOR_PLAN });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Generic projects get no calibration at all -> no realTakeoff.
    expect(body.fullScopeBid.calibration ?? null).toBeNull();
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
