import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// P7 (API/engine surface): the sprinkler-bid pipeline now ALSO surfaces the
// full hydraulic NETWORK balance + the NFPA-13 geometric compliance check, and
// a new /submittal endpoint emits a downloadable submittal package. Fail-closed:
// nothing here flips a gate — AUTOSPRINK_PARITY stays blocked, submittalReady
// stays false, and the geometric compliance check always carries its honesty note.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3196;
const BASE = `http://127.0.0.1:${PORT}`;
const PROJ = '/api/projects/P7%20Surface';
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-p7-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'p7-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'p7-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function postBid(body) {
  return fetch(`${BASE}${PROJ}/sprinkler-bid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

// A single-room floor plan drives the LEGACY path that produces a
// cadModel.rooms[0].network — the only path where the full network balance runs.
const FLOOR_PLAN = {
  name: 'P7 Plan', units: 'ft',
  rooms: [{ name: 'Bay', hazard: 'ordinary', polygon: [[0, 0], [60, 0], [60, 40], [0, 40]] }],
};

describe('P7 studio surface — network balance + compliance + submittal', () => {
  it('sprinkler-bid surfaces compliance + the full hydraulic network balance (floorPlan path)', async () => {
    const res = await postBid({ floorPlan: FLOOR_PLAN });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Compliance: geometric best-effort check with findings + a boolean pass.
    expect(body.compliance).toBeTruthy();
    expect(Array.isArray(body.compliance.findings)).toBe(true);
    expect(typeof body.compliance.passed).toBe('boolean');

    // Full hydraulic network balance (NOT the existing single-path estimate).
    expect(body.hydraulicNetwork).toBeTruthy();
    expect(body.hydraulicNetwork.error).toBeUndefined();
    expect(typeof body.hydraulicNetwork.requiredSourcePsi).toBe('number');
    expect(typeof body.hydraulicNetwork.totalDemandGpm).toBe('number');
    // It carries its own fail-closed disclaimer.
    expect(typeof body.hydraulicNetwork.disclaimer).toBe('string');
    expect(body.hydraulicNetwork.disclaimer.length).toBeGreaterThan(0);
  });

  it('building path surfaces compliance but skips the full balance honestly (no per-room network)', async () => {
    const res = await postBid({ buildingSvg: BUILDING_SVG });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.compliance).toBeTruthy();
    expect(Array.isArray(body.compliance.findings)).toBe(true);
    // No fabricated network for the building path: it reports a graceful skip,
    // it does NOT invent hydraulic numbers.
    expect(body.hydraulicNetwork).toBeTruthy();
    expect(typeof body.hydraulicNetwork.error).toBe('string');
  });

  it('compliance ALWAYS carries the NFPA13_REVIEW_NOTE honesty warning — a geometric pass is NOT approval', async () => {
    const res = await postBid({ buildingSvg: BUILDING_SVG });
    const { compliance } = await res.json();
    const note = compliance.findings.find((f) => f.code === 'NFPA13_REVIEW_NOTE');
    expect(note).toBeTruthy();
    expect(note.severity).toBe('warn');
    // Even when geometrically "passed", the package is not AHJ/PE/permit-ready.
    expect(typeof compliance.note).toBe('string');
    expect(compliance.note.length).toBeGreaterThan(0);
  });

  it('back-compat: the original fields (bid, cadModel, hydraulics, isBuilding) are still present', async () => {
    const res = await postBid({ buildingSvg: BUILDING_SVG });
    const body = await res.json();
    expect(body.bid).toBeTruthy();
    expect(body.cadModel).toBeTruthy();
    expect(body).toHaveProperty('hydraulics');
    expect(body.isBuilding).toBe(true);
    expect(body.bid.totalHeadCount).toBeGreaterThan(0);
  });

  it('POST /submittal returns a downloadable package with honesty flags false and AUTOSPRINK_PARITY blocked', async () => {
    const res = await fetch(`${BASE}${PROJ}/submittal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ buildingSvg: BUILDING_SVG }),
    });
    expect(res.status).toBe(200);
    // Attachment so the browser downloads it.
    const disposition = res.headers.get('content-disposition') || '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('submittal');

    const pkg = await res.json();
    // Header honesty flags — all literally false.
    expect(pkg.header.stamped).toBe(false);
    expect(pkg.header.ahjApproved).toBe(false);
    expect(pkg.header.peReviewed).toBe(false);
    expect(pkg.header.permitReady).toBe(false);
    // The submittal can never satisfy a regulated gate.
    expect(pkg.gateStatus.submittalReady).toBe(false);
    // The AUTOSPRINK_PARITY gate stays blocked (no real evidence row).
    const parity = pkg.gateStatus.blockedGates.find((g) => g.code === 'AUTOSPRINK_PARITY_INCOMPLETE');
    expect(parity).toBeTruthy();
    expect(parity.status).toBe('blocked');
    // Carries the submittal disclaimer.
    expect(typeof pkg.disclaimer).toBe('string');
    expect(pkg.disclaimer.length).toBeGreaterThan(0);
  });

  it('submittal also works on the legacy single-floorPlan SVG path', async () => {
    const res = await fetch(`${BASE}${PROJ}/submittal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ svg: '<svg><rect x="0" y="0" width="30" height="30"/></svg>' }),
    });
    // Either a 200 package or a graceful 400 if the bare rect yields no rooms;
    // it must NEVER 500 and must NEVER report submittalReady true.
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      const pkg = await res.json();
      expect(pkg.gateStatus.submittalReady).toBe(false);
    }
  });
});
