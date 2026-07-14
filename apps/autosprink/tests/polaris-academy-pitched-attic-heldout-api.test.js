import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let server; let tempDir; let token; let base;

function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const { port } = socket.address();
      socket.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    if (server.exitCode != null) throw new Error(`server exited before health: ${server.exitCode}`);
    try { const response = await fetch(`${base}/api/health`); if (response.ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server not healthy');
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-polaris-heldout-api-'));
  base = `http://127.0.0.1:${await freePort()}`;
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: new URL(base).port, NODE_ENV: 'test', HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'polaris-heldout-test-secret-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'polaris-heldout-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'polaris-heldout-test-pw' }),
  });
  token = (await response.json()).token;
});

afterAll(async () => {
  if (server && server.exitCode == null) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('authenticated Polaris Academy pitched-attic heldout comparison', () => {
  it('rejects anonymous access to client answer evidence', async () => {
    expect((await fetch(`${base}/api/evidence/polaris-academy-pitched-attic-heldout-comparison`)).status).toBe(401);
  });

  it('serves only the authenticated Studio code and evidence allowlist', async () => {
    expect((await fetch(`${base}/api/studio/modules/floorplans.js`)).status).toBe(401);
    expect((await fetch(`${base}/src/data/floorplans.js`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(403);
    const moduleResponse = await fetch(`${base}/api/studio/modules/floorplans.js`, { headers: { Authorization: `Bearer ${token}` } });
    expect(moduleResponse.status).toBe(200);
    expect(moduleResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(moduleResponse.headers.get('content-type')).toContain('application/javascript');
    expect(await moduleResponse.text()).toContain('export function homeDepotRexburgFloorPlan');
    const evidenceResponse = await fetch(`${base}/api/studio/evidence/plan-levels.cooperative-1881.json`, { headers: { Authorization: `Bearer ${token}` } });
    expect(evidenceResponse.status).toBe(200);
    expect(evidenceResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(await evidenceResponse.json()).toMatchObject({ project: 'The Cooperative 1881 - Salt Lake City UT', bidId: '1881' });
    expect((await fetch(`${base}/api/studio/evidence/not-allowlisted.json`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(404);
  });

  it('serves top, elevation, and 3D proof while preserving the failed placement gate', async () => {
    const response = await fetch(`${base}/api/evidence/polaris-academy-pitched-attic-heldout-comparison`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'passed', artifactType: 'halofire.polaris-pitched-attic-heldout-comparison.v1',
      sourceOnlyCommit: 'caa5723d89d6bacad255acb35ddffa71592c3391',
      sourceOnlyResult: { generatedHeadCount: 0, candidatePlacementReady: false },
      approvedAndAsBuilt: { rasterParity: true, totalHeadCount: 158, pipeCount: 186, fittingCount: 98 },
      result: { status: 'passed-domain-guard-failed-placement-coverage', wrongDomainGuardWorked: true, unseenProjectPlacementVerified: false },
      pitchedAtticCalibrationReady: true, pitchedAtticSelectorReadyForFreshHoldout: false,
      pitchedAtticHeadLayoutReady: false, wholeRoofModelReady: false, hydraulicCalculationReady: false,
      unseenProjectPlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
      adversarialLoop: { status: 'passed', attemptedCases: 16 },
    });
    expect(body.approvedAndAsBuilt.systems).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'pendent', count: 81 }),
      expect.objectContaining({ kind: 'upright', count: 77 }),
    ]));
    expect(body.views.topSvg.match(/<circle /g)).toHaveLength(158);
    expect(body.views.elevationSvg.match(/<circle /g)).toHaveLength(158);
    expect(body.views.model3dSvg.match(/<circle /g)).toHaveLength(158);
  });
});
