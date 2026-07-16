import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3286;
const BASE = `http://127.0.0.1:${PORT}`;
let server; let tempDir; let token; let serverStderr = '';

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try { const response = await fetch(`${BASE}/api/health`); if (response.ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server not healthy');
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-pitched-calibration-v5-api-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'), JWT_SECRET: 'pitched-calibration-v5-secret-more-than-32-characters', HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'pitched-calibration-v5-pw', HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (chunk) => { serverStderr += chunk.toString(); });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'pitched-calibration-v5-pw' }) })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((resolve) => server.once('exit', resolve)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('authenticated BGC failure and pitched calibration revision five', () => {
  it('trusts only the loopback proxy path for forwarded client rate-limit identity', async () => {
    const response = await fetch(`${BASE}/api/health`, { headers: { 'X-Forwarded-For': '203.0.113.10' } });
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(serverStderr).not.toContain('ERR_ERL_UNEXPECTED_X_FORWARDED_FOR');
  });

  it('rejects anonymous access to every answer-exposed BGC route', async () => {
    expect((await fetch(`${BASE}/api/evidence/boys-girls-club-pitched-heldout-comparison`)).status).toBe(401);
    expect((await fetch(`${BASE}/api/evidence/bgc-source-plan-section-3d-registration`)).status).toBe(401);
    expect((await fetch(`${BASE}/api/evidence/pitched-placement-calibration-corpus-v5`)).status).toBe(401);
  });

  it('returns the truthful BGC failed comparison and visual topology proof', async () => {
    const response = await fetch(`${BASE}/api/evidence/boys-girls-club-pitched-heldout-comparison`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({ status: 'passed', artifactType: 'halofire.boys-girls-club-pitched-heldout-comparison.v1', receiptSha256: '37fee9c38560e2a98507844e390658c865f4cc9c24d277c7859d5c9f544b6b57', blindPrediction: { headCount: 12 }, approved: { headCount: 64 }, asBuilt: { headCount: 64 }, result: { status: 'failed', headCountDelta: -52, topologyMatched: false, v4OutOfEnvelopePromotionGuardWorked: true }, candidatePlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
    expect(body.comparisonSvg).toContain('HISTORICAL FAILED BLIND V4 — NOT A SPRINKLER LAYOUT');
    expect(body.comparisonSvg).toContain('synthetic 8 × 8 dot graphic has been retired');
    expect(body.comparisonSvg).not.toContain('<circle');
    expect(body.adversarialLoop).toMatchObject({ status: 'passed', attemptedCases: 12 });
  });

  it('returns the source-bound actual-PDF plan, section, and 3D graph', async () => {
    const response = await fetch(`${BASE}/api/evidence/bgc-source-plan-section-3d-registration`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'passed',
      artifactType: 'halofire.bgc-source-plan-section-3d-registration.v1',
      receiptSha256: '1d1f1ecb1e0fb17a8f81c5ff048f146647a0a3db191008dafdab08668f5a355d',
      detectors: { asBuilt: { guardedUprightCount: 64 }, ahjApproved: { guardedUprightCount: 64 }, branchFeedAxis: { segmentCount: 16, branchFeedCount: 8 } },
      geometryGraph: { nodeCount: 90, edgeCount: 89 },
      sourcePlanCoordinatesVerified: true,
      sourceBranchHalfAdjacencyVerified: true,
      sourceBranchFeedTopologyVerified: true,
      sourceCrossMainPlanAxisVerified: true,
      pipeSizeVerified: true,
      roofSurfaceTargetProjectionVerified: true,
      exactInstalledPipeElevationVerified: false,
      exactCrossMainPieceOrderVerified: false,
      exactFittingTakeoutVerified: false,
      manufacturerPartSolidVerified: false,
      exactBracketGeometryVerified: false,
      exactThreadGeometryVerified: false,
      threadEngagementAndToleranceVerified: false,
      matingFitVerified: false,
      pipeDirectionVerified: false,
      pipeGradeVerified: false,
      complianceReady: false,
      fabricationReady: false,
      fieldReleaseReady: false,
      vpsReleaseReady: false,
      adversarialLoop: { status: 'passed', attemptedCases: 27 },
    });
    expect(new Set(Object.values(body.viewBindings).map((view) => view.geometryGraphSha256)).size).toBe(1);
  });

  it('returns v5 with the calibrated-domain hard gate and preserved failure', async () => {
    const response = await fetch(`${BASE}/api/evidence/pitched-placement-calibration-corpus-v5`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({ status: 'passed', artifactType: 'halofire.pitched-placement-calibration-corpus.v5', receiptSha256: 'eff4a856d825707acb6a9c3135daa1d28e68246f5f11ade3bd88ba30284fe687', trainingProjectCount: 6, largeVaultStrategyCount: 5, strategySelectorReadyForFreshHoldout: true, unseenProjectPlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
    expect(body.newTrainingProject.answerExposedFeatures).toMatchObject({ completedHeadCount: 64, topology: { alongRidgeStations: 8, acrossSlopeStations: 8 }, exactStationCoordinatesReady: false });
    expect(body.calibratedDomain).toMatchObject({ maxLeaveOneOutNearestDistance: 3.918118, causalRuleClaimed: false, codeLimit: false });
    expect(body.failedHoldoutControl).toMatchObject({ failurePreserved: true, topologyFailure: true, countFailure: true, v4OutOfEnvelopePromotionGuardWorked: true });
    expect(body.adversarialLoop).toMatchObject({ status: 'passed', attemptedCases: 15, selectorAttemptedCases: 4 });
  });
});
