import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { COOPERATIVE_1881_PROJECT_NAME } from '../src/data/floorplans.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3297;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_PATH = `/api/projects/${encodeURIComponent(COOPERATIVE_1881_PROJECT_NAME)}`;
let server;
let tempDir;

function request(pathname, options = {}) {
  return fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      const response = await request('/api/health');
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('HaloFire API did not become healthy for submitted calibration tests');
}

async function tokenForAdmin() {
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'calibration-admin', password: 'calibration-password' }),
  });
  expect(response.status).toBe(200);
  return (await response.json()).token;
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-submitted-calibration-api-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'halofire.db'),
      JWT_SECRET: 'submitted-calibration-test-secret-over-32-chars',
      HALOFIRE_ADMIN_USER: 'calibration-admin',
      HALOFIRE_ADMIN_PASSWORD: 'calibration-password',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
});

afterAll(async () => {
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('AutoBid submitted sprinkler calibration API', () => {
  it('requires authentication', async () => {
    expect((await request(`${PROJECT_PATH}/submitted-sprinkler-calibration`)).status).toBe(401);
  });

  it('returns registered FP-8 top/elevation evidence with a non-roof protection basis', async () => {
    const token = await tokenForAdmin();
    const response = await request(`${PROJECT_PATH}/submitted-sprinkler-calibration`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({ heads: 297, pipeSegments: 254, hydraulicNodes: 17, pitchedRoofNodes: 0 });
    expect(result.protectionBasis).toMatchObject({
      roofForm: 'source-bound-pitched-roof',
      submittedLevel8Mode: 'flat-ceiling-and-sky-balcony-reference',
      projectLevel8LayoutMayBeBlindlyProjectedToRoof: false,
      atticSprinklerRequirementEstablished: false,
    });
    expect(result.roofRelations).toHaveLength(17);
    expect(result.views.topSvg).toContain('Submitted FP-8 registered top view');
    expect(result.views.elevationSvg).toContain('Submitted DA-3 registered elevation view');
    expect(result.complianceReady).toBe(false);
    expect(result.claimStatus).toBe('completed-bid-calibration-validated-not-code-compliance-or-approval');
  });

  it('does not substitute another project into the Cooperative calibration', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Unknown/submitted-sprinkler-calibration', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('submitted_calibration_not_found');
  });

  it('serves the authenticated Dillon 3:12 completed-bid calibration without claiming compliance', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Dillon%20Residence/submitted-sloped-ceiling-calibration', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('passed');
    expect(result.counts.submittedScheduleHeads).toBe(52);
    expect(result.counts.vectorCandidates).toBe(51);
    expect(result.counts.unresolvedHeadSymbols).toBe(1);
    expect(result.counts.positiveAnnotationProximityMatches).toBeGreaterThanOrEqual(3);
    expect(result.slopeEvidenceReady).toBe(true);
    expect(result.fullSlopeSurfaceRegistrationReady).toBe(true);
    expect(result.generatedLayoutParityReady).toBe(true);
    expect(result.parityMetrics).toMatchObject({ precision: 1, recall: 1 });
    expect(result.generatedHeads).toHaveLength(2);
    expect(result.model3dVerification).toMatchObject({ status: 'passed', geometryGrounded: true, absoluteElevationReady: true, complianceReady: false });
    expect(result.parityMetrics.maxPlanErrorFt).toBeLessThanOrEqual(3);
    expect(result.model3dVerification.counts).toEqual({ surfaces: 4, heads: 2, pipes: 1, nonFlatHeadElevations: 2, hydraulicNodesJoined: 5 });
    expect(result.model3dVerification).toMatchObject({ hydraulicDatumJoined: true, protectedRegionHeadNodeMappingReady: false });
    expect(result.hydraulicDatumJoin.activeNodes).toHaveLength(5);
    expect(result.complianceReady).toBe(false);
    expect(result.view.submittedTopSvg).toContain('Dillon submitted FP-1 heads registered to RCP 3:12 annotation screens');
    expect(result.view.generatedTopSvg).toContain('Generated Dillon slope-aware top view');
    expect(result.view.generatedElevationSvg).toContain('Generated Dillon 3:12 absolute project elevation view');
  });
});
