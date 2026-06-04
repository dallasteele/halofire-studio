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

      const handoffButton = page.locator(`[data-replay-sam31-actual-value-handoff-evidence-id="${savedReplayEvidenceId}"]`);
      await handoffButton.waitFor({ state: 'attached' });
      const [handoffDownload] = await Promise.all([
        page.waitForEvent('download'),
        handoffButton.click(),
      ]);
      const handoffDownloadPath = await handoffDownload.path();
      expect(handoffDownload.suggestedFilename()).toContain('actual-value-handoff');
      expect(handoffDownloadPath).toBeTruthy();
      const handoff = JSON.parse(fs.readFileSync(handoffDownloadPath, 'utf8'));
      expect(handoff.artifact_type).toBe('openclaw.sam31.actual_value_handoff_packet.v1');
      expect(handoff.source_replay_evidence_id).toBe(Number(savedReplayEvidenceId));
      expect(handoff.source_replay_packet).toEqual(expect.objectContaining({
        source_evidence_id: savedBoundary.evidence.id,
        source_review_evidence_id: review.id,
        corrected_room_polygon_count: 2,
      }));
      expect(handoff.source_refs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          evidence_id: Number(savedReplayEvidenceId),
          evidence_type: 'best_effort_ai_layout',
          claim_gate_effect: 'no_claims_cleared',
        }),
        expect.objectContaining({
          evidence_id: savedBoundary.evidence.id,
          evidence_type: 'pdf_boundary_decision',
        }),
      ]));
      expect(handoff.claim_gate_effect).toBe('no_claims_cleared');
      expect(handoff.no_claim_gates_cleared).toBe(true);

      const replacementButton = page.locator(`[data-replay-sam31-actual-value-replacement-evidence-id="${savedReplayEvidenceId}"]`);
      await replacementButton.waitFor({ state: 'attached' });
      await replacementButton.click();
      await page.waitForFunction((replayEvidenceId) => {
        const status = document.getElementById(`replaySam31ActualValueReplacementStatus-${replayEvidenceId}`);
        return Boolean(status?.dataset.sam31ActualValueReplacementEvidenceId)
          && status?.dataset.sourceReplayEvidenceId === replayEvidenceId
          && status?.dataset.claimGateEffect === 'no_claims_cleared';
      }, String(savedReplayEvidenceId));

      const replacementDataset = await page.evaluate((replayEvidenceId) => {
        const status = document.getElementById(`replaySam31ActualValueReplacementStatus-${replayEvidenceId}`);
        return {
          sam31ActualValueReplacementEvidenceId: status?.dataset.sam31ActualValueReplacementEvidenceId,
          sourceReplayEvidenceId: status?.dataset.sourceReplayEvidenceId,
          claimGateEffect: status?.dataset.claimGateEffect,
          actualValueHandoffHref: status?.dataset.actualValueHandoffHref,
          sam31ActualValueReplacementReadbackHref: status?.dataset.sam31ActualValueReplacementReadbackHref,
        };
      }, String(savedReplayEvidenceId));
      const replacementEvidenceId = String(replacementDataset.sam31ActualValueReplacementEvidenceId || '');
      expect(replacementEvidenceId).toMatch(/^\d+$/);
      expect(replacementDataset.sourceReplayEvidenceId).toBe(String(savedReplayEvidenceId));
      expect(replacementDataset.claimGateEffect).toBe('no_claims_cleared');
      expect(replacementDataset.actualValueHandoffHref)
        .toBe(`${PROJECT_PATH}/evidence/${savedReplayEvidenceId}/openclaw/sam31/actual-value-handoff`);
      expect(replacementDataset.sam31ActualValueReplacementReadbackHref)
        .toBe(`/api/openclaw/sam31/actual-value-replacements?projectName=${encodeURIComponent(PROJECT_NAME)}&sourceReplayEvidenceId=${savedReplayEvidenceId}`);

      await page.locator(`#evidence-${replacementEvidenceId}`).waitFor({ state: 'attached' });
      const replacementRow = await page.locator(`#evidence-${replacementEvidenceId}`).innerText();
      expect(replacementRow).toContain('sam31_actual_value_replacement');
      expect(replacementRow).toContain(`source_replay_evidence_id ${savedReplayEvidenceId}`);
      expect(replacementRow).toContain('claim_gate_effect no_claims_cleared');

      const queue = page.locator('#sam31ActualValueQueue');
      await page.waitForFunction((expectedHref) => {
        return document.getElementById('sam31ActualValueQueue')?.dataset.sam31ActualValueResolverQueueHref === expectedHref;
      }, `/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(PROJECT_NAME)}&sourceReplayEvidenceId=${savedReplayEvidenceId}`);
      expect(await queue.getAttribute('data-sam31-actual-value-resolver-queue-href'))
        .toBe(`/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(PROJECT_NAME)}&sourceReplayEvidenceId=${savedReplayEvidenceId}`);
      expect(await queue.getAttribute('data-sam31-actual-value-replacement-readback-href'))
        .toBe(`/api/openclaw/sam31/actual-value-replacements?projectName=${encodeURIComponent(PROJECT_NAME)}&sourceReplayEvidenceId=${savedReplayEvidenceId}`);
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-sam31-actual-value-resolver-queue-href'))
        .toBe(`/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(PROJECT_NAME)}&sourceReplayEvidenceId=${savedReplayEvidenceId}`);
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-source-replay-evidence-id')).toBe(String(savedReplayEvidenceId));

      const replaySmokeButton = page.locator(`[data-replay-sam31-consumer-intake-smoke-source-replacement-evidence-id="${replacementEvidenceId}"]`);
      await replaySmokeButton.waitFor({ state: 'attached' });
      expect(await replaySmokeButton.getAttribute('data-source-replay-evidence-id')).toBe(String(savedReplayEvidenceId));
      expect(await replaySmokeButton.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(replacementEvidenceId));
      expect(await replaySmokeButton.getAttribute('data-replay-sam31-consumer-intake-smoke-consumer')).toBe('halo_fire');
      await replaySmokeButton.click();
      await page.waitForFunction((replacementId) => {
        const status = document.getElementById('sam31ActualValueQueueStatus');
        return status?.dataset.sourceSam31ActualValueReplacementEvidenceId === replacementId
          && Boolean(status?.dataset.sam31ConsumerIntakeSmokeEvidenceId);
      }, String(replacementEvidenceId));

      const smokeEvidenceId = String(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-sam31-consumer-intake-smoke-evidence-id') || '');
      expect(smokeEvidenceId).toMatch(/^\d+$/);
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-source-replay-evidence-id')).toBe(String(savedReplayEvidenceId));
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(replacementEvidenceId));
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');

      await page.locator(`#evidence-${smokeEvidenceId}`).waitFor({ state: 'attached' });
      const smokeRow = await page.locator(`#evidence-${smokeEvidenceId}`).innerText();
      expect(smokeRow).toContain('openclaw_sam31_section_to_artifacts_consumer_intake_smoke');
      expect(smokeRow).toContain(`source_replay_evidence_id ${savedReplayEvidenceId}`);
      expect(smokeRow).toContain(`source_sam31_actual_value_replacement_evidence_id ${replacementEvidenceId}`);
      expect(smokeRow).toContain('claim_gate_effect no_claims_cleared');

      const followup = page.locator(`[data-sam31-consumer-intake-smoke-followup-packet="${smokeEvidenceId}"]`).first();
      await followup.waitFor({ state: 'attached' });
      expect(await followup.getAttribute('data-sam31-consumer-intake-smoke-followup-packet-href')).toBe(
        `${PROJECT_PATH}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/${smokeEvidenceId}/followup-packet`,
      );

      const sprinkler = page.locator(`[data-sam31-consumer-intake-smoke-sprinkler-review-packet="${smokeEvidenceId}"]`).first();
      await sprinkler.waitFor({ state: 'attached' });
      expect(await sprinkler.getAttribute('data-sam31-consumer-intake-smoke-sprinkler-review-packet-href')).toBe(
        `${PROJECT_PATH}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/${smokeEvidenceId}/sprinkler-review-packet`,
      );

      const defaultFollowup = page.locator(`[data-replay-sam31-consumer-intake-smoke-default-followup-review="${smokeEvidenceId}"]`).first();
      await defaultFollowup.waitFor({ state: 'attached' });
      expect(await defaultFollowup.getAttribute('data-source-replay-evidence-id')).toBe(String(savedReplayEvidenceId));
      expect(await defaultFollowup.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(replacementEvidenceId));
      expect(await defaultFollowup.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
      await defaultFollowup.click();
      await page.waitForFunction((smokeId) => {
        const status = document.getElementById(`sam31ConsumerIntakeSmokeFollowupReview-${smokeId}-status`);
        return status?.dataset.halofireSam31ConsumerIntakeSmokeFollowupReviewEvidenceId
          && status?.dataset.downloadedSprinklerReviewPacket === 'true';
      }, String(smokeEvidenceId));

      const defaultStatus = page.locator(`#sam31ConsumerIntakeSmokeFollowupReview-${smokeEvidenceId}-status`);
      const followupReviewEvidenceId = String(await defaultStatus.getAttribute('data-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id') || '');
      expect(followupReviewEvidenceId).toMatch(/^\d+$/);
      expect(await defaultStatus.getAttribute('data-source-replay-evidence-id')).toBe(String(savedReplayEvidenceId));
      expect(await defaultStatus.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(replacementEvidenceId));
      expect(await defaultStatus.getAttribute('data-sam31-consumer-intake-smoke-evidence-id')).toBe(String(smokeEvidenceId));
      expect(await defaultStatus.getAttribute('data-downloaded-sprinkler-review-packet')).toBe('true');
      expect(await defaultStatus.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');

      await page.locator(`#evidence-${followupReviewEvidenceId}`).waitFor({ state: 'attached' });
      const followupReviewRow = await page.locator(`#evidence-${followupReviewEvidenceId}`).innerText();
      expect(followupReviewRow).toContain('halofire_sam31_consumer_intake_smoke_followup_review_decision');
      expect(followupReviewRow).toContain(`source_replay_evidence_id ${savedReplayEvidenceId}`);
      expect(followupReviewRow).toContain(`source_sam31_actual_value_replacement_evidence_id ${replacementEvidenceId}`);
      expect(followupReviewRow).toContain('claim_gate_effect no_claims_cleared');

      await sprinkler.click();
      await page.waitForFunction(() => document.getElementById('sam31ActualValueQueueStatus')?.textContent?.includes('Downloaded HaloFire SAM31 consumer intake smoke sprinkler review packet'));
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-source-replay-evidence-id')).toBe(String(savedReplayEvidenceId));
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(replacementEvidenceId));
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-source-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id')).toBe(String(followupReviewEvidenceId));
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');

      const defaultSprinkler = page.locator(`[data-replay-sam31-consumer-intake-smoke-default-sprinkler-review="${smokeEvidenceId}"]`).first();
      await defaultSprinkler.waitFor({ state: 'attached' });
      expect(await defaultSprinkler.getAttribute('data-source-replay-evidence-id')).toBe(String(savedReplayEvidenceId));
      expect(await defaultSprinkler.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(replacementEvidenceId));
      expect(await defaultSprinkler.getAttribute('data-source-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id')).toBe(String(followupReviewEvidenceId));
      expect(await defaultSprinkler.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
      await defaultSprinkler.click();
      await page.waitForFunction((smokeId) => {
        const status = document.getElementById(`sam31ConsumerIntakeSmokeSprinklerReview-${smokeId}-status`);
        return status?.dataset.halofireSam31SprinklerReviewDecisionEvidenceId
          && status?.dataset.downloadedPreliminaryReplayInputs === 'true';
      }, String(smokeEvidenceId));

      const sprinklerStatus = page.locator(`#sam31ConsumerIntakeSmokeSprinklerReview-${smokeEvidenceId}-status`);
      const sprinklerDecisionEvidenceId = String(await sprinklerStatus.getAttribute('data-halofire-sam31-sprinkler-review-decision-evidence-id') || '');
      expect(sprinklerDecisionEvidenceId).toMatch(/^\d+$/);
      expect(await sprinklerStatus.getAttribute('data-source-replay-evidence-id')).toBe(String(savedReplayEvidenceId));
      expect(await sprinklerStatus.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(replacementEvidenceId));
      expect(await sprinklerStatus.getAttribute('data-source-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id')).toBe(String(followupReviewEvidenceId));
      expect(await sprinklerStatus.getAttribute('data-sam31-consumer-intake-smoke-evidence-id')).toBe(String(smokeEvidenceId));
      expect(await sprinklerStatus.getAttribute('data-downloaded-preliminary-replay-inputs')).toBe('true');
      expect(await sprinklerStatus.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');

      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-source-halofire-sam31-sprinkler-review-decision-evidence-id')).toBe(String(sprinklerDecisionEvidenceId));
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-downloaded-preliminary-replay-inputs')).toBe('true');
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');

      const defaultReplayFollowup = page.locator(`[data-replay-sam31-consumer-intake-smoke-default-preliminary-replay-followup="${smokeEvidenceId}"]`).first();
      await defaultReplayFollowup.waitFor({ state: 'attached' });
      expect(await defaultReplayFollowup.getAttribute('data-source-replay-evidence-id')).toBe(String(savedReplayEvidenceId));
      expect(await defaultReplayFollowup.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(replacementEvidenceId));
      expect(await defaultReplayFollowup.getAttribute('data-source-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id')).toBe(String(followupReviewEvidenceId));
      expect(await defaultReplayFollowup.getAttribute('data-source-halofire-sam31-sprinkler-review-decision-evidence-id')).toBe(String(sprinklerDecisionEvidenceId));
      expect(await defaultReplayFollowup.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
      await defaultReplayFollowup.click();
      await page.waitForFunction((smokeId) => {
        const status = document.getElementById(`sam31ConsumerIntakeSmokePreliminaryReplayFollowup-${smokeId}-status`);
        return status?.dataset.halofireSam31PreliminaryReplayFollowupEvidenceId
          && status?.dataset.downloadedPreliminaryReplayArtifact === 'true'
          && Number(status?.dataset.packetQueueItemCount || '0') >= 1;
      }, String(smokeEvidenceId));

      const replayFollowupStatus = page.locator(`#sam31ConsumerIntakeSmokePreliminaryReplayFollowup-${smokeEvidenceId}-status`);
      const replayFollowupEvidenceId = String(await replayFollowupStatus.getAttribute('data-halofire-sam31-preliminary-replay-followup-evidence-id') || '');
      expect(replayFollowupEvidenceId).toMatch(/^\d+$/);
      expect(await replayFollowupStatus.getAttribute('data-source-replay-evidence-id')).toBe(String(savedReplayEvidenceId));
      expect(await replayFollowupStatus.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(replacementEvidenceId));
      expect(await replayFollowupStatus.getAttribute('data-source-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id')).toBe(String(followupReviewEvidenceId));
      expect(await replayFollowupStatus.getAttribute('data-source-halofire-sam31-sprinkler-review-decision-evidence-id')).toBe(String(sprinklerDecisionEvidenceId));
      expect(await replayFollowupStatus.getAttribute('data-downloaded-preliminary-replay-artifact')).toBe('true');
      expect(await replayFollowupStatus.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');

      await page.locator(`#evidence-${replayFollowupEvidenceId}`).waitFor({ state: 'attached' });
      const replayFollowupRow = await page.locator(`#evidence-${replayFollowupEvidenceId}`).innerText();
      expect(replayFollowupRow).toContain('halofire_sam31_sprinkler_preliminary_replay_followup_decision');
      expect(replayFollowupRow).toContain(`source_replay_evidence_id ${savedReplayEvidenceId}`);
      expect(replayFollowupRow).toContain(`source_sam31_actual_value_replacement_evidence_id ${replacementEvidenceId}`);
      expect(replayFollowupRow).toContain('halofire.sam31_obstruction_clash_packet_queue_item.v1');
      expect(replayFollowupRow).toContain('claim_gate_effect no_claims_cleared');

      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-source-halofire-sam31-preliminary-replay-followup-evidence-id')).toBe(String(replayFollowupEvidenceId));
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-downloaded-preliminary-replay-artifact')).toBe('true');
      expect(Number(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-packet-queue-item-count') || '0')).toBeGreaterThanOrEqual(1);
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
    } finally {
      await page.close();
    }
  }, 30_000);
});
