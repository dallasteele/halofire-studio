import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { COOPERATIVE_1881_PROJECT_NAME } from '../src/data/floorplans.js';
import { createSam31BridgeApp } from '../src/sam31/bridge.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3217;
const BASE = `http://127.0.0.1:${PORT}`;
const COOPERATIVE_1881_PATH = `/api/projects/${encodeURIComponent(COOPERATIVE_1881_PROJECT_NAME)}`;

let bridgeServer;
let bridgeBaseUrl;
let apiServer;
let tempDir;
let token;

function request(pathname, options = {}) {
  return fetch(`${BASE}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try {
      const r = await request('/api/health');
      if (r.ok) return;
    } catch {
      // server is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('HaloFire API did not become healthy');
}

beforeAll(async () => {
  const bridgeApp = createSam31BridgeApp();
  await new Promise((resolve) => {
    bridgeServer = bridgeApp.listen(0, '127.0.0.1', resolve);
  });
  const bridgeAddress = bridgeServer.address();
  bridgeBaseUrl = `http://127.0.0.1:${bridgeAddress.port}`;

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-sam31-status-'));
  apiServer = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: 'sam31-status-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
      OPENCLAW_BRIDGE_URL: bridgeBaseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'sam31-status-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (apiServer && !apiServer.killed) {
    apiServer.kill();
    await new Promise((resolve) => apiServer.once('exit', resolve));
  }
  if (bridgeServer) {
    await new Promise((resolve) => bridgeServer.close(resolve));
  }
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('OpenClaw SAM31 bridge status API', () => {
  it('probes a configured bridge and reports verified reachability without clearing claims', async () => {
    const res = await request('/api/openclaw/sam31/status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_bridge_status',
      status: 'verified_reachable',
      tool_ref: 'pdfExtract:sam',
      bridge_url_configured: true,
      bridge_url: bridgeBaseUrl,
      bridge_reachable: true,
      openclaw_status: 'local-shim',
      sam31_status: 'online',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(body.probe_status_url).toBe(`${bridgeBaseUrl}/status`);
    expect(body.observed_at).toEqual(expect.any(String));
    expect(body.supported_applications).toEqual(expect.arrayContaining(['halo_fire', 'landscout', 'nameforge']));
    expect(body.blocked_claims).toEqual(expect.arrayContaining(['OpenClaw_runtime_verified', 'permit_ready']));
    expect(body.limitations.join(' ')).toMatch(/does not clear/i);
    expect(body.raw_status).toEqual(expect.objectContaining({
      service: 'halofire-sam31-bridge',
      services: expect.objectContaining({
        sam31: expect.objectContaining({ status: 'online' }),
      }),
    }));
  });

  it('runs a SAM31 bridge invocation and persists a best-effort smoke artifact without clearing claims', async () => {
    const res = await request(`${COOPERATIVE_1881_PATH}/openclaw/sam31/smoke-artifact`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdfRef: 'provided-docs:Proposal-Cooperative-1881-Salt-Lake-City-UT-9-18-25.pdf#page=7',
        pdfPageIndex: 7,
        pdfScale: 0.083333,
        targets: ['building_outline', 'walls', 'rooms', 'sprinkler_obstructions'],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_bridge_smoke_artifact',
      status: 'sam31_invocation_verified',
      project_name: COOPERATIVE_1881_PROJECT_NAME,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(body.bridge_status).toEqual(expect.objectContaining({
      status: 'verified_reachable',
      bridge_reachable: true,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(body.invocation).toEqual(expect.objectContaining({
      tool: 'sam_segment_floorplan',
      endpoint: `${bridgeBaseUrl}/codex-bridge/invoke`,
    }));
    expect(body.sam31_request).toEqual(expect.objectContaining({
      service: 'sam-3.1',
      op: 'segment_floorplan',
      pdfRef: 'provided-docs:Proposal-Cooperative-1881-Salt-Lake-City-UT-9-18-25.pdf#page=7',
      pageIndex: 7,
      scale: 0.083333,
    }));
    expect(body.sam31_request.targets).toEqual(expect.arrayContaining(['building_outline', 'sprinkler_obstructions']));
    expect(body.result_summary).toEqual(expect.objectContaining({
      ok: true,
      source: 'sam-3.1-shim',
      runtime: 'halofire-local-sam31-bridge',
      layer_keys: expect.arrayContaining(['building_outline', 'walls', 'rooms']),
    }));
    expect(body.blocked_claims).toEqual(expect.arrayContaining([
      'geometry_accuracy',
      'permit_ready',
      'AutoSprink_parity',
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
    ]));
    expect(body.evidence).toEqual(expect.objectContaining({
      evidence_type: 'openclaw_sam31_bridge_smoke_artifact',
      source_file: 'OPENCLAW_BRIDGE_URL',
      source_ref: `${bridgeBaseUrl}/codex-bridge/invoke`,
      status: 'best_effort',
    }));
    const savedNotes = JSON.parse(body.evidence.notes);
    expect(savedNotes).toEqual(expect.objectContaining({
      kind: 'openclaw_sam31_bridge_smoke_artifact',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(savedNotes.artifact.status).toBe('sam31_invocation_verified');

    const evidenceRes = await request(`${COOPERATIVE_1881_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(evidenceRes.status).toBe(200);
    const evidenceRows = await evidenceRes.json();
    expect(evidenceRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: body.evidence.id,
        evidence_type: 'openclaw_sam31_bridge_smoke_artifact',
        status: 'best_effort',
      }),
    ]));
  });
});
