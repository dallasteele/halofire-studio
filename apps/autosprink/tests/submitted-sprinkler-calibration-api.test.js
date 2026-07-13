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
    expect((await request('/api/projects/Dillon%20Residence/submitted-sloped-ceiling-bluebeam.pdf')).status).toBe(401);
    expect((await request('/api/projects/Dillon%20Residence/submitted-sloped-ceiling-bluebeam.fdf')).status).toBe(401);
    expect((await request('/api/projects/Dillon%20Residence/floor-by-floor-model')).status).toBe(401);
    expect((await request('/api/projects/Dillon%20Residence/completed-bid-geometry')).status).toBe(401);
    expect((await request('/api/projects/Dillon%20Residence/vertical-registration')).status).toBe(401);
    expect((await request('/api/projects/Dillon%20Residence/structural-roof-surfaces')).status).toBe(401);
  });

  it('serves registered structural roof footprints without inventing 3D planes', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Dillon%20Residence/structural-roof-surfaces', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('passed');
    expect(result.counts).toMatchObject({ registeredFacePatches: 33, unresolvedToyFacePatches: 15, structurallyResolvedPlanes: 0 });
    expect(result.model.footprints).toHaveLength(33);
    expect(result.model.surfaces3d).toEqual([]);
    expect(result.topView.svg).toContain('0 new planes promoted to 3D');
    expect(result.completeRoofPlanes).toBe(false);
    expect(result.complianceReady).toBe(false);
  });

  it('serves only source-supported 3D sprinkler Z and omits unresolved elements', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Dillon%20Residence/vertical-registration', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({ totalHeads: 76, sourceAssignedHeads: 35, unresolvedHeads: 41, totalPipeSegments: 67, sourceAssignedPipeSegments: 8, unresolvedPipeSegments: 59 });
    expect(result.model3d.heads).toHaveLength(35);
    expect(result.model3d.pipes).toHaveLength(8);
    expect(result.elevationView.svg).toContain('unresolved elements are omitted');
    expect(result.complete).toBe(false);
    expect(result.complianceReady).toBe(false);
  });

  it('serves per-sheet completed bid heads and pipe vectors registered to the actual DWGs', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Dillon%20Residence/completed-bid-geometry', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({ declaredHeads: 77, detectedHeads: 76, unresolvedHeads: 1, pipeSegments: 67 });
    expect(result.sheets[0].schedule).toMatchObject({ declaredTotal: 52, detected: { total: 51 }, complete: false, unresolvedCount: 1 });
    expect(result.sheets[1].schedule).toMatchObject({ declaredTotal: 25, detected: { total: 25 }, complete: true, unresolvedCount: 0 });
    expect(result.views.planViews[0].svg).toContain('51/52 heads');
    expect(result.views.planViews[1].svg).toContain('25/25 heads');
    expect(result.verticalGeometryReady).toBe(false);
    expect(result.complianceReady).toBe(false);
  });

  it('serves the sealed source-DWG floor-by-floor model and views', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Dillon%20Residence/floor-by-floor-model', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('passed');
    expect(result.receiptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.counts).toEqual({ levels: 3, wallSolids: 563, sourceEntities: 13225 });
    expect(result.model.levels.map((level) => level.projectFloorElevationFt)).toEqual([1524.5, 1537, 1503]);
    expect(result.model.levels[2].coordinateFrame).toBe('toy-garage-local');
    expect(result.views.topViews).toHaveLength(3);
    expect(result.views.elevationSvg).toContain('exterior elevation sheet absent');
    expect(result.views.isometricSvg).toContain('extruded floor by floor');
    expect(result.geometryGrounded).toBe(true);
    expect(result.complianceReady).toBe(false);
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
    expect(result.counts).toMatchObject({ vectorCandidates: 51, fp1VectorCandidates: 51, fp2ContinuationCandidates: 0, unresolvedHeadSymbols: 1 });
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.detectedVectorCandidates).toBe(51);
    expect(result.coverage.unresolved[0]).toContain('FP-2 is a separate 25-head upper-level schedule');
    expect(result.continuationHeads).toEqual([]);
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

  it('downloads a layered two-page Bluebeam-compatible vector PDF', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Dillon%20Residence/submitted-sloped-ceiling-bluebeam.pdf', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('Dillon-Residence-sloped-ceiling-calibration.pdf');
    expect(response.headers.get('x-halofire-artifact-sha256')).toMatch(/^[0-9a-f]{64}$/);
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 8).toString('ascii')).toBe('%PDF-1.7');
    const raw = buffer.toString('latin1');
    expect(raw).toContain('/Type /OCG /Name (SOURCE_GEOMETRY)');
    expect(raw).toContain('/Type /OCG /Name (GENERATED_LAYOUT)');
    expect(raw).toContain('/Type /OCG /Name (VERIFICATION_EVIDENCE)');
  });

  it('downloads a deterministic FDF overlay for the original FP-1 sheet', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Dillon%20Residence/submitted-sloped-ceiling-bluebeam.fdf', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/vnd.fdf');
    expect(response.headers.get('content-disposition')).toContain('Dillon-Residence-FP1-generated-slope-overlay.fdf');
    const buffer = Buffer.from(await response.arrayBuffer()); const raw = buffer.toString('ascii');
    expect(buffer.subarray(0, 8).toString('ascii')).toBe('%FDF-1.2');
    expect((raw.match(/\/Subtype \/PolyLine/g) || [])).toHaveLength(4);
    expect((raw.match(/\/Subj \(Generated sprinkler head\)/g) || [])).toHaveLength(2);
    expect(raw).toContain('/Subj (Generated slope-following branch)');
  });
});
