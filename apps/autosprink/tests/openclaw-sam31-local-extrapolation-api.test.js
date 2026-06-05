import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { COOPERATIVE_1881_PROJECT_NAME } from '../src/data/floorplans.js';
import { createSam31BridgeApp } from '../src/sam31/bridge.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3218;
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
      const response = await request('/api/health');
      if (response.ok) return;
    } catch {
      // API is still starting.
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

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-sam31-local-extrapolate-'));
  apiServer = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: 'sam31-local-extrapolate-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
      OPENCLAW_BRIDGE_URL: bridgeBaseUrl,
      OPENCLAW_SAM31_EXTRAPOLATE_URL: '',
      OPENCLAW_PERCEPTION_URL: '',
      OPENCLAW_API_URL: '',
      HAL_API_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'sam31-local-extrapolate-test-pw' }),
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

describe('OpenClaw SAM31 local bridge extrapolation persistence', () => {
  it('persists the local bridge /vision/sam31/extrapolate artifact as replayable evidence', async () => {
    const boundaryRes = await request(`${COOPERATIVE_1881_PATH}/pdf-boundary-decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdfPageIndex: 8,
        pdfScale: 0.08,
        pdfExtract: 'sam31-local-bridge-extrapolate-outline',
        source_file: 'Proposal-Cooperative-1881-Salt-Lake-City-UT-9-18-25.pdf',
        source_ref: '1881 plan PDF sheet 8 / local bridge SAM31 extrapolate queue action',
        candidate: {
          mode: 'outline',
          label: 'Local bridge SAM31 extrapolate outline',
          status: 'candidate',
          bbox: { x: 10, y: 20, width: 500, height: 300 },
          segmentCount: 11,
        },
      }),
    });
    expect(boundaryRes.status).toBe(201);
    const boundary = await boundaryRes.json();

    const artifactRes = await request(
      `${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${boundary.id}/openclaw/sam31/extrapolation-artifact`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    expect(artifactRes.status).toBe(201);
    const artifact = await artifactRes.json();

    expect(artifact.openclaw_endpoint).toBe(`${bridgeBaseUrl}/vision/sam31/extrapolate`);
    expect(artifact.source_runtime).toBe('halofire-local-sam31-bridge');
    expect(artifact.bid_truth).toEqual(expect.objectContaining({
      project: 'The Cooperative 1881 - Salt Lake City UT',
      head_count: 1420,
      square_feet: 170654,
      bid_total: 538792.35,
    }));
    expect(artifact.product_review_queue_item).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.product_review_queue_item.v1',
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(artifact.missing_evidence_rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'HALOFIRE_1881_ROOM_BOUNDARY_EMPLOYEE_REVIEW_MISSING',
        next_action: expect.stringMatching(/employee/i),
        claim_gate_effect: 'no_claims_cleared',
      }),
      expect.objectContaining({
        code: 'HALOFIRE_1881_PROFESSIONAL_AHJ_APPROVAL_MISSING',
        blocked_claims: expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review']),
        claim_gate_effect: 'no_claims_cleared',
      }),
    ]));
    expect(artifact.evidence).toEqual(expect.objectContaining({
      evidence_type: 'openclaw_sam31_extrapolation_artifact',
      source_file: 'OPENCLAW_BRIDGE_URL',
      source_ref: `${bridgeBaseUrl}/vision/sam31/extrapolate`,
      status: 'best_effort',
    }));
    const notes = JSON.parse(artifact.evidence.notes);
    expect(notes.artifact.bid_truth.head_count).toBe(1420);
    expect(notes.artifact.missing_evidence_rows.map((row) => row.code)).toEqual(expect.arrayContaining([
      'HALOFIRE_1881_ROOM_BOUNDARY_EMPLOYEE_REVIEW_MISSING',
      'HALOFIRE_1881_PROFESSIONAL_AHJ_APPROVAL_MISSING',
    ]));

    const queueRes = await request(`${COOPERATIVE_1881_PATH}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(queueRes.status).toBe(200);
    const queue = await queueRes.json();
    const item = queue.items.find((row) => row.evidence_id === boundary.id);
    expect(item.latest_openclaw_sam31_extrapolation_artifact).toEqual(expect.objectContaining({
      evidence_id: artifact.id,
      source_pdf_boundary_evidence_id: boundary.id,
      bid_truth: expect.objectContaining({ head_count: 1420 }),
      missing_evidence_row_count: 2,
      missing_evidence_rows: expect.arrayContaining([
        expect.objectContaining({ code: 'HALOFIRE_1881_ROOM_BOUNDARY_EMPLOYEE_REVIEW_MISSING' }),
        expect.objectContaining({ code: 'HALOFIRE_1881_PROFESSIONAL_AHJ_APPROVAL_MISSING' }),
      ]),
      product_review_queue_item: expect.objectContaining({
        use_for_claims: false,
        claim_gate_effect: 'no_claims_cleared',
      }),
      claim_gate_effect: 'no_claims_cleared',
    }));
  });
});
