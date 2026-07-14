import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3293;
const BASE = `http://127.0.0.1:${PORT}`;
const PROJECT = 'LDS Meeting House - Winter Garden FL';
let server; let tempDir; let token;

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    try { const response = await fetch(`${BASE}/api/health`); if (response.ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server not healthy');
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-wg-source-building-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'halofire.db'),
      JWT_SECRET: 'winter-garden-source-building-test-secret',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: 'winter-garden-test-password',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'winter-garden-test-password' }),
  });
  token = (await login.json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((resolve) => server.once('exit', resolve)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('GET /api/projects/:name/source-building-model', () => {
  it('requires login', async () => {
    const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(PROJECT)}/source-building-model`);
    expect(response.status).toBe(401);
  });

  it('serves sealed source-only 3D geometry, rendered views, and brain knowledge provenance', async () => {
    const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(PROJECT)}/source-building-model`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('passed');
    expect(body.receiptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.counts).toEqual({ rooms: 56, roofSurfaces: 11, pitchedRoofSurfaces: 10, verticalFeatures: 1 });
    expect(body.operationalKnowledge.preflightStatus).toBe('passed');
    expect(body.operationalKnowledge.sources).toContain('halofire-master/00_MASTER_MOC.md');
    expect(body.operationalKnowledge.workflowGuardrails).toContain('primary-independent-and-adversarial-verification-loops-are-internal');
    expect(body.operationalKnowledge.applications).toHaveLength(13);
    expect(body.operationalKnowledge.companyFlowRecall.status).toBe('passed');
    expect(body.operationalKnowledge.coverage.lifecycleStages).toContain('closeout-service');
    expect(body.views.topSvg).toContain('<svg');
    expect(body.views.isometricSvg).toContain('<svg');
    expect(body.geometryGrounded).toBe(true);
    expect(body.operationalKnowledgeGrounded).toBe(true);
    expect(body.complianceReady).toBe(false);
    expect(body.fabricationReady).toBe(false);
  });

  it('fails closed for an unsealed project', async () => {
    const response = await fetch(`${BASE}/api/projects/Unknown/source-building-model`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(404);
    expect((await response.json()).complianceReady).toBe(false);
  });
});

describe('GET /api/projects/:name/source-spec-hazard', () => {
  it('requires login', async () => {
    const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(PROJECT)}/source-spec-hazard`);
    expect(response.status).toBe(401);
  });

  it('serves the source-bound spec criteria, applied brain rules, and partial fail-closed zoning', async () => {
    const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(PROJECT)}/source-spec-hazard`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('passed');
    expect(body.criteria.sourceBinding).toMatchObject({
      document: 'WG Specs.pdf',
      sha256: '2ceb110a0ab68f69a266e01d2c1274ac1a49c45f16958179cab78055a5192008',
      section: '21 1313 Wet-Pipe Sprinkler Systems',
      criteriaPage: 647,
      answerKey: false,
    });
    expect(body.counts).toEqual({ totalRooms: 56, sourceClassifiedRooms: 31, unresolvedRooms: 25, byHazard: { 'Light Hazard': 30, 'Ordinary Hazard Group 2': 1 } });
    expect(body.operationalKnowledge.applications).toHaveLength(13);
    expect(body.internalVerification).toMatchObject({ primary: { status: 'passed' }, independent: { status: 'passed' }, adversarial: { status: 'passed' } });
    expect(body.operationalKnowledgeGrounded).toBe(true);
    expect(body.sourceSpecGrounded).toBe(true);
    expect(body.partialHazardZoningGrounded).toBe(true);
    expect(body.wholeBuildingHazardZoningComplete).toBe(false);
    expect(body.headLayoutReady).toBe(false);
    expect(body.complianceReady).toBe(false);
    expect(body.fabricationReady).toBe(false);
    expect(body.fieldReleaseReady).toBe(false);
  });
});

describe('GET /api/projects/:name/source-space-registry', () => {
  it('requires login', async () => {
    const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(PROJECT)}/source-space-registry`);
    expect(response.status).toBe(401);
  });

  it('serves A101 identities and A151 ceilings without promoting fragmented boundaries', async () => {
    const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(PROJECT)}/source-space-registry`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('passed');
    expect(body.counts).toEqual({ sourceRoomIdentities: 54, uniqueAnchorComponentRooms: 50, anchorComponentBlockedRooms: 4, ceilingRegisteredComponentRooms: 14, sprinklerCandidateReadyRooms: 0 });
    expect(body.spaces.find((space) => space.roomNumber === '147').roomName).toBe('ROSTRUM');
    expect(body.spaces.find((space) => space.roomNumber === '148').roomName).toBe('CHAPEL');
    expect(body.internalVerification).toMatchObject({ primary: { status: 'passed' }, independent: { status: 'passed' }, adversarial: { status: 'passed' } });
    expect(body.operationalKnowledge.companyFlowRecall.status).toBe('passed');
    expect(body.sprinklerCandidateReady).toBe(false);
    expect(body.complianceReady).toBe(false);
    expect(body.fabricationReady).toBe(false);
  });
});

describe('GET /api/projects/:name/source-space-topology', () => {
  it('requires login', async () => {
    const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(PROJECT)}/source-space-topology`);
    expect(response.status).toBe(401);
  });

  it('serves the internally verified protection envelopes without promoting the residual', async () => {
    const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(PROJECT)}/source-space-topology`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('passed');
    expect(body.counts).toMatchObject({ sourceProtectionZones: 45, assignedRoomIdentities: 54, topologyReadyRoomIdentities: 53, topologyBlockedRoomIdentities: 1, sprinklerCandidateReadyRooms: 0 });
    expect(body.unresolvedRoomNumbers).toEqual(['146']);
    expect(body.internalVerification).toMatchObject({ primary: { status: 'passed' }, independent: { status: 'passed' }, adversarial: { status: 'passed' } });
    expect(body.identityZoneAssignmentComplete).toBe(true);
    expect(body.wholeBuildingTopologyComplete).toBe(false);
    expect(body.wholeBuildingHeadLayoutReady).toBe(false);
    expect(body.complianceReady).toBe(false);
  });
});

describe('GET /api/projects/:name/source-sprinkler-candidates', () => {
  it('requires login', async () => {
    const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(PROJECT)}/source-sprinkler-candidates`);
    expect(response.status).toBe(401);
  });

  it('serves the two source-only preliminary flat candidates and keeps pitched layout fail-closed', async () => {
    const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(PROJECT)}/source-sprinkler-candidates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('passed');
    expect(body.counts).toEqual({
      sourceRoomIdentities: 54, candidateRooms: 2, candidateHeads: 2, blockedRooms: 52,
      slopedCeilingRooms: 3, slopedCeilingCandidateRooms: 0,
    });
    expect(body.candidates.map((entry) => entry.roomNumber)).toEqual(['120', '143']);
    expect(body.internalVerification).toMatchObject({ primary: { status: 'passed' }, independent: { status: 'passed' }, adversarial: { status: 'passed' } });
    expect(body.partialCandidateGeometryGrounded).toBe(true);
    expect(body.wholeBuildingHeadLayoutReady).toBe(false);
    expect(body.pitchedRoofHeadLayoutReady).toBe(false);
    expect(body.complianceReady).toBe(false);
    expect(body.fabricationReady).toBe(false);
  });
});

describe('GET /api/projects/:name/source-sprinkler-candidate-proof.png', () => {
  it('keeps the client drawing proof behind login', async () => {
    const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(PROJECT)}/source-sprinkler-candidate-proof.png`);
    expect(response.status).toBe(401);
    const staticLeak = await fetch(`${BASE}/src/data/proofs/winter-garden-source-sprinkler-candidate-proof.png`);
    expect(staticLeak.status).toBe(403);
  });

  it('serves the receipt-bound PNG privately to an authenticated employee', async () => {
    const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(PROJECT)}/source-sprinkler-candidate-proof.png`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.length).toBeGreaterThan(1_000_000);
  });
});
