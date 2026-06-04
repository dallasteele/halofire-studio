import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3231;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'room-boundary-floor-plan-override-browser-smoke-pw';
const PROJECT_NAME = 'The Cooperative 1881 - Salt Lake City UT';
const PROJECT_PATH = `/api/projects/${encodeURIComponent(PROJECT_NAME)}`;

let server;
let tempDir;
let browser;

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server not healthy');
}

async function api(pathname, token, options = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${pathname} failed ${response.status}: ${text}`);
  return body;
}

async function adminToken() {
  const body = await api('/api/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: PASSWORD }),
  });
  return body.token;
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-room-boundary-override-browser-smoke-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'room-boundary-floor-plan-override-browser-smoke-jwt-secret',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: PASSWORD,
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  if (browser) await browser.close();
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('Workbench room-boundary floor-plan override browser smoke', () => {
  it('downloads a persisted floor-plan override action packet from corrected 1881 review evidence', async () => {
    const token = await adminToken();
    const savedBoundary = await api(`${PROJECT_PATH}/pdf-boundary-decision`, token, {
      method: 'POST',
      body: JSON.stringify({
        pdfPageIndex: 7,
        pdfScale: 0.0833,
        pdfExtract: 'outline',
        candidate: {
          id: 'candidate:1881-sheet-7-outline',
          mode: 'outline',
          bbox: { minX: 0, minY: 0, maxX: 120, maxY: 85, widthFt: 120, heightFt: 85, areaSqft: 10200 },
          blockedClaims: ['geometry_accuracy', 'AutoSprink_parity'],
        },
        source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
        source_ref: '1881 browser-smoke boundary decision for floor-plan override',
        selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
        selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
        source_refs: [
          '1881://proposal-cooperative/sheet-7',
          '1881://operator-scale/sheet-7/0.0833',
          'candidate:1881-sheet-7-outline',
        ],
        notes: 'Initial browser-smoke boundary decision for floor-plan override.',
      }),
    });

    const review = await api(`${PROJECT_PATH}/resolver-packets/pdf-boundary/${savedBoundary.evidence.id}/reviews`, token, {
      method: 'POST',
      body: JSON.stringify({
        review_decision: 'corrected',
        reviewer_name: 'Boundary Browser Smoke Reviewer',
        marked_up_plan_ref: '1881://markup/sheet-7-room-boundary-correction',
        corrected_room_polygons: [
          {
            id: 'room:1881-lobby',
            label: 'Lobby',
            polygon: [
              [0, 0],
              [28, 0],
              [28, 18],
              [0, 18],
            ],
            source_refs: ['1881://markup/sheet-7-room-boundary-correction'],
          },
          {
            id: 'room:1881-corridor',
            label: 'Corridor',
            polygon: [
              [28, 0],
              [54, 0],
              [54, 12],
              [28, 12],
            ],
            source_refs: ['1881://markup/sheet-7-room-boundary-correction'],
          },
        ],
        issue_list: [
          {
            issue_type: 'room_boundary_mismatch',
            severity: 'blocking',
            source_ref: '1881://proposal-cooperative/sheet-7',
            observed: 'Original outline overcaptured the corridor wall band.',
            expected: 'Replay should use two corrected employee-reviewed room polygons only.',
            required_action: 'Use the corrected room polygons for internal-alpha replay only.',
          },
        ],
        notes: 'Corrected browser-smoke room-boundary review packet for floor-plan override download.',
      }),
    });

    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(8000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(`${BASE}/workbench.html`, { waitUntil: 'domcontentloaded' });
      await page.locator('#projectTarget').selectOption(PROJECT_NAME);
      const overrideButton = page.locator(`[data-floor-plan-override-action-evidence-id="${savedBoundary.evidence.id}"]`);
      await overrideButton.waitFor({ state: 'attached' });
      await page.getByText('floor_plan_override_status internal_alpha_floor_plan_override_ready').waitFor();
      await page.getByText(`source_review_evidence_id ${review.id}`).waitFor();

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        overrideButton.click(),
      ]);
      const downloadPath = await download.path();
      expect(download.suggestedFilename()).toContain('floor-plan-override-action');
      expect(downloadPath).toBeTruthy();
      const packet = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));

      expect(packet.artifact_type).toBe('halofire.room_boundary_floor_plan_override_action_packet.v1');
      expect(packet.source_evidence_id).toBe(savedBoundary.evidence.id);
      expect(packet.source_review_evidence_id).toBe(review.id);
      expect(packet.floor_plan_override_source).toBe('latest_employee_review_packet');
      expect(packet.claim_gate_effect).toBe('no_claims_cleared');
      expect(packet.request_body).toEqual(expect.objectContaining({
        room_boundary_source: 'latest_employee_review_packet',
        source_evidence_id: savedBoundary.evidence.id,
        source_review_evidence_id: review.id,
        claim_gate_effect: 'no_claims_cleared',
      }));
      expect(packet.request_body.employee_decision).toEqual(expect.objectContaining({
        selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
        selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
      }));
      expect(packet.request_body.corrected_room_polygons).toHaveLength(2);
      expect(packet.request_body.corrected_room_polygons[0]).toEqual(expect.objectContaining({
        id: 'room:1881-lobby',
      }));
      expect(packet.request_body.floor_plan_override).toEqual(expect.objectContaining({
        room_boundary_source: 'latest_employee_review_packet',
        source_evidence_id: savedBoundary.evidence.id,
        source_review_evidence_id: review.id,
        corrected_room_polygon_count: 2,
      }));
      expect(packet.source_refs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          evidence_id: savedBoundary.evidence.id,
          evidence_type: 'pdf_boundary_decision',
        }),
        expect.objectContaining({
          evidence_id: review.id,
          evidence_type: 'room_boundary_review_packet',
        }),
        expect.objectContaining({
          evidence_id: savedBoundary.evidence.id,
          selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
          selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
          selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
        }),
      ]));

      const replayButton = page.locator(`[data-resolver-replay-bid-evidence-id="${savedBoundary.evidence.id}"]`);
      await replayButton.waitFor({ state: 'attached' });

      const [clientReplayDownload] = await Promise.all([
        page.waitForEvent('download'),
        replayButton.click(),
      ]);
      const clientReplayDownloadPath = await clientReplayDownload.path();
      expect(clientReplayDownload.suggestedFilename()).toContain('replay-bid-artifact');
      expect(clientReplayDownloadPath).toBeTruthy();
      const clientReplayArtifact = JSON.parse(fs.readFileSync(clientReplayDownloadPath, 'utf8'));
      expect(clientReplayArtifact.artifact_type).toBe('room_boundary_replay_bid_artifact');
      expect(clientReplayArtifact.source_evidence_id).toBe(savedBoundary.evidence.id);
      expect(clientReplayArtifact.source_review_evidence_id).toBe(review.id);
      expect(clientReplayArtifact.floor_plan_override).toEqual(expect.objectContaining({
        room_boundary_source: 'latest_employee_review_packet',
        source_evidence_id: savedBoundary.evidence.id,
        source_review_evidence_id: review.id,
        corrected_room_polygon_count: 2,
      }));
      expect(clientReplayArtifact.claim_gate_effect).toBe('no_claims_cleared');
      expect(clientReplayArtifact.blocked_claims).toEqual(expect.arrayContaining([
        'geometry_accuracy',
        'AutoSprink_parity',
        'permit_ready',
      ]));

      await page.waitForFunction((boundaryEvidenceId) => {
        const status = document.getElementById(`replayBidStatus-${boundaryEvidenceId}`);
        return Boolean(status?.dataset.roomBoundaryReplayEvidenceId);
      }, String(savedBoundary.evidence.id));

      const replayStatus = page.locator(`#replayBidStatus-${savedBoundary.evidence.id}`);
      const savedReplayEvidenceId = await replayStatus.getAttribute('data-room-boundary-replay-evidence-id');
      expect(savedReplayEvidenceId).toMatch(/^\d+$/);
      expect(await replayStatus.getAttribute('data-room-boundary-source')).toBe('latest_employee_review_packet');
      expect(await replayStatus.getAttribute('data-source-review-evidence-id')).toBe(String(review.id));
      expect(await replayStatus.getAttribute('data-replay-bid-artifact-href'))
        .toBe(`${PROJECT_PATH}/evidence/${savedReplayEvidenceId}/replay-bid-artifact`);

      const savedReplayArtifactButton = page.locator(`[data-replay-bid-artifact-evidence-id="${savedReplayEvidenceId}"]`);
      await savedReplayArtifactButton.waitFor({ state: 'attached' });
      const [savedReplayDownload] = await Promise.all([
        page.waitForEvent('download'),
        savedReplayArtifactButton.click(),
      ]);
      const savedReplayDownloadPath = await savedReplayDownload.path();
      expect(savedReplayDownload.suggestedFilename()).toContain('replay-bid-artifact');
      expect(savedReplayDownloadPath).toBeTruthy();
      const savedReplayArtifact = JSON.parse(fs.readFileSync(savedReplayDownloadPath, 'utf8'));
      expect(savedReplayArtifact.artifact_type).toBe('room_boundary_replay_bid_artifact');
      expect(savedReplayArtifact.source_evidence_id).toBe(savedBoundary.evidence.id);
      expect(savedReplayArtifact.source_review_evidence_id).toBe(review.id);
      expect(savedReplayArtifact.floor_plan_override).toEqual(expect.objectContaining({
        room_boundary_source: 'latest_employee_review_packet',
        source_evidence_id: savedBoundary.evidence.id,
        source_review_evidence_id: review.id,
        corrected_room_polygon_count: 2,
      }));
      expect(savedReplayArtifact.corrected_room_polygon_count).toBe(2);
      expect(savedReplayArtifact.claim_gate_effect).toBe('no_claims_cleared');
      expect(savedReplayArtifact.blocked_claims).toEqual(expect.arrayContaining([
        'geometry_accuracy',
        'AutoSprink_parity',
        'permit_ready',
      ]));
    } finally {
      await page.close();
    }
  }, 30_000);
});
