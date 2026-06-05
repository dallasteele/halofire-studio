import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3236;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'official-flow-browser-smoke-pw';
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-official-flow-browser-smoke-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'official-flow-browser-smoke-jwt-secret-more-than-32-chars',
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

describe('Workbench official-flow browser smoke', () => {
  it('imports the Cooperative 1881 default official-flow attachment packet from the Workbench', async () => {
    const token = await adminToken();
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(10_000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(`${BASE}/workbench.html?project=${encodeURIComponent(PROJECT_NAME)}#officialFlowAttachmentIntake`, {
        waitUntil: 'domcontentloaded',
      });
      const details = page.locator('#officialFlowAttachmentIntake').first();
      await details.waitFor();
      await details.evaluate((node) => { node.open = true; });
      const button = page.locator('[data-official-flow-default-attachment-intake-import="1"]').first();
      await button.click();
      const status = page.locator('#officialFlowAttachmentIntakeStatus');
      await page.waitForFunction(() => {
        const node = document.querySelector('#officialFlowAttachmentIntakeStatus');
        return Number(node?.dataset.defaultOfficialFlowPacketEvidenceId || 0) > 0;
      });
      expect(await status.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
      expect(await status.getAttribute('data-no-claim-gates-cleared')).toBe('true');
      expect(await status.innerText()).toContain('Imported default 1881 official-flow packet');

      const packetEvidenceId = Number(await status.getAttribute('data-default-official-flow-packet-evidence-id'));
      const intakeEvidenceId = Number(await status.getAttribute('data-default-official-flow-intake-evidence-id'));
      expect(packetEvidenceId).toBeGreaterThan(0);
      expect(intakeEvidenceId).toBeGreaterThan(0);

      await page.locator(`#evidence-${packetEvidenceId}`).waitFor();
      await page.locator(`#evidence-${intakeEvidenceId}`).waitFor();
      const intakeText = await page.locator(`#evidence-${intakeEvidenceId}`).innerText();
      expect(intakeText).toContain('official_flow_intake');
      expect(intakeText).toContain('Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx');

      const gates = await api(`${PROJECT_PATH}/claim-gates`, token);
      expect(gates.find((gate) => gate.code === 'PROFESSIONAL_REVIEW_MISSING')).toEqual(expect.objectContaining({ status: 'blocked' }));
      expect(gates.find((gate) => gate.code === 'AHJ_APPROVAL_MISSING')).toEqual(expect.objectContaining({ status: 'blocked' }));
      expect(gates.find((gate) => gate.code === 'AUTOSPRINK_EVIDENCE_MISSING')).toEqual(expect.objectContaining({ status: 'blocked' }));
    } finally {
      await page.close();
    }
  }, 40_000);

  it('keeps official-flow review decisions visible after refresh with signed-reviewer next actions', async () => {
    const token = await adminToken();
    const intake = await api(`${PROJECT_PATH}/resolver-packets/official-flow/intake`, token, {
      method: 'POST',
      body: JSON.stringify({
        staticPsi: 72,
        residualPsi: 61,
        flowingGpm: 980,
        flowDataDate: '2026-06-01',
        waterModelRequired: 'Disposable browser smoke values for internal-alpha replay only.',
        source_file: 'official-flow-browser-smoke.pdf',
        source_ref: 'official-flow-browser-smoke.pdf#page=2',
        notes: 'Official-flow browser smoke intake; no regulated claims cleared.',
      }),
    });
    const persisted = await api(`${PROJECT_PATH}/resolver-packets/official-flow/${intake.id}/replay-artifact`, token, {
      method: 'POST',
    });
    const replayEvidenceId = String(persisted.id);
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(10_000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(`${BASE}/workbench.html?project=${encodeURIComponent(PROJECT_NAME)}#official-flow-replay-review`, {
        waitUntil: 'domcontentloaded',
      });
      const details = page.locator('#official-flow-replay-review details').first();
      await details.waitFor();
      await details.evaluate((node) => { node.open = true; });
      await page.locator(`#officialFlowProfessionalReviewRef-${replayEvidenceId}`).fill('pe-review://official-flow/browser-smoke');
      await page.locator(`#officialFlowAhjReviewRef-${replayEvidenceId}`).fill('ahj://official-flow/browser-smoke');
      await page.locator(`#officialFlowManufacturerApprovalRef-${replayEvidenceId}`).fill('manufacturer://official-flow/browser-smoke');
      await page.locator(`#officialFlowAutosprinkExportRef-${replayEvidenceId}`).fill('autosprink://official-flow/browser-smoke');
      await page.locator(`#officialFlowReviewDecision-${replayEvidenceId}-reviewer`).fill('HaloFire Employee');

      const button = page.locator(`[data-official-flow-review-decision-evidence-id="${replayEvidenceId}"]`).first();
      await button.click();
      await page.waitForFunction(() => {
        const node = document.querySelector('#officialFlowReviewDecisionResults [data-official-flow-review-decision-evidence-id]');
        return node?.dataset.claimGateEffect === 'no_claims_cleared';
      });

      const readback = page.locator('#officialFlowReviewDecisionResults [data-official-flow-review-decision-evidence-id]').first();
      const decisionEvidenceId = await readback.getAttribute('data-official-flow-review-decision-evidence-id');
      expect(decisionEvidenceId).toMatch(/^\d+$/);
      expect(await readback.getAttribute('data-source-official-flow-replay-evidence-id')).toBe(replayEvidenceId);
      expect(await readback.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
      expect(await readback.getAttribute('data-no-claim-gates-cleared')).toBe('true');
      expect(await readback.getAttribute('data-professional-signed-reviewer-href')).toContain(`officialFlowReviewDecisionEvidenceId=${decisionEvidenceId}`);
      expect(await readback.getAttribute('data-ahj-signed-reviewer-href')).toContain('targetGate=AHJ_APPROVAL_MISSING');
      expect(await readback.getAttribute('data-manufacturer-signed-reviewer-href')).toContain('targetGate=MANUFACTURER_MODEL_APPROVAL_MISSING');
      expect(await readback.getAttribute('data-autosprink-signed-reviewer-href')).toContain('targetGate=AUTOSPRINK_EVIDENCE_MISSING');
      expect(await readback.innerText()).toContain(`Saved official_flow_professional_ahj_review_decision evidence #${decisionEvidenceId}`);
      expect(await readback.innerText()).toContain('claim gates remain blocked');

      await page.locator(`#evidence-${decisionEvidenceId}`).waitFor();
      const decisionRowText = await page.locator(`#evidence-${decisionEvidenceId}`).innerText();
      expect(decisionRowText).toContain('official_flow_professional_ahj_review_decision');
      expect(decisionRowText).toContain('official_flow_signed_reviewer_validation rows');
      expect(decisionRowText).toContain('Upload real signed evidence & resolve gate');

      const gates = await api(`${PROJECT_PATH}/claim-gates`, token);
      expect(gates.find((gate) => gate.code === 'PROFESSIONAL_REVIEW_MISSING')).toEqual(
        expect.objectContaining({ status: 'blocked' }),
      );
      expect(gates.find((gate) => gate.code === 'AHJ_APPROVAL_MISSING')).toEqual(
        expect.objectContaining({ status: 'blocked' }),
      );
      expect(gates.find((gate) => gate.code === 'AUTOSPRINK_EVIDENCE_MISSING')).toEqual(
        expect.objectContaining({ status: 'blocked' }),
      );
      expect(gates.find((gate) => gate.code === 'MANUFACTURER_MODEL_APPROVAL_MISSING')).toEqual(
        expect.objectContaining({ status: 'blocked' }),
      );
    } finally {
      await page.close();
    }
  }, 40_000);

  it('keeps default 1881 replay provenance and review-packet follow-through visible after refresh', async () => {
    const token = await adminToken();
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(10_000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(`${BASE}/workbench.html?project=${encodeURIComponent(PROJECT_NAME)}#officialFlowAttachmentIntake`, {
        waitUntil: 'domcontentloaded',
      });
      const intakeDetails = page.locator('#officialFlowAttachmentIntake').first();
      await intakeDetails.waitFor();
      await intakeDetails.evaluate((node) => { node.open = true; });
      await page.locator('[data-official-flow-default-attachment-intake-import="1"]').first().click();

      const intakeStatus = page.locator('#officialFlowAttachmentIntakeStatus');
      await page.waitForFunction(() => {
        const node = document.querySelector('#officialFlowAttachmentIntakeStatus');
        return Number(node?.dataset.defaultOfficialFlowPacketEvidenceId || 0) > 0
          && Number(node?.dataset.defaultOfficialFlowIntakeEvidenceId || 0) > 0;
      });

      const packetEvidenceId = Number(await intakeStatus.getAttribute('data-default-official-flow-packet-evidence-id'));
      const intakeEvidenceId = Number(await intakeStatus.getAttribute('data-default-official-flow-intake-evidence-id'));
      expect(packetEvidenceId).toBeGreaterThan(0);
      expect(intakeEvidenceId).toBeGreaterThan(0);

      const persistButton = page.locator(`[data-official-flow-persist-review-packet-evidence-id="${intakeEvidenceId}"]`).first();
      await persistButton.waitFor();
      await persistButton.click();

      const replayStatus = page.locator(`#officialFlowReplayStatus-${intakeEvidenceId}`);
      await page.waitForFunction((id) => {
        const node = document.querySelector(`#officialFlowReplayStatus-${id}`);
        return Boolean(node?.textContent?.includes('Saved official_flow_hydraulic_replay_artifact evidence #'));
      }, intakeEvidenceId);
      const replayStatusText = await replayStatus.innerText();
      const replayEvidenceId = Number((replayStatusText.match(/evidence #(\d+)/) || [])[1]);
      expect(replayEvidenceId).toBeGreaterThan(0);

      const replayRow = page.locator(`#evidence-${replayEvidenceId}`).first();
      await replayRow.waitFor();
      const replayRowText = await replayRow.innerText();
      expect(replayRowText).toContain(`source_attachment_intake_packet_evidence_id ${packetEvidenceId}`);
      expect(replayRowText).toContain('source_attachment_intake_row_index 0');
      expect(replayRowText).toContain('Download professional/AHJ review packet');

      await page.reload({ waitUntil: 'domcontentloaded' });
      const replayRowAfterRefresh = page.locator(`#evidence-${replayEvidenceId}`).first();
      await replayRowAfterRefresh.waitFor();
      const replayRowAfterRefreshText = await replayRowAfterRefresh.innerText();
      expect(replayRowAfterRefreshText).toContain(`source_attachment_intake_packet_evidence_id ${packetEvidenceId}`);
      expect(replayRowAfterRefreshText).toContain('source_attachment_intake_row_index 0');
      expect(replayRowAfterRefreshText).toContain('Download professional/AHJ review packet');

      const reviewDetails = page.locator('#official-flow-replay-review details').first();
      await reviewDetails.waitFor();
      await reviewDetails.evaluate((node) => { node.open = true; });
      await page.locator(`#officialFlowReviewDecision-${replayEvidenceId}-reviewer`).fill('HaloFire Employee');
      await page.locator(`#officialFlowProfessionalReviewRef-${replayEvidenceId}`).fill('pe-review://default-1881/source-linked-flow');
      await page.locator(`#officialFlowAhjReviewRef-${replayEvidenceId}`).fill('ahj://default-1881/source-linked-flow');
      await page.locator(`#officialFlowAutosprinkExportRef-${replayEvidenceId}`).fill('autosprink://default-1881/source-linked-flow');
      await page.locator(`[data-official-flow-review-decision-evidence-id="${replayEvidenceId}"]`).first().click();
      await page.waitForFunction(() => {
        const node = document.querySelector('#officialFlowReviewDecisionResults [data-official-flow-review-decision-evidence-id]');
        return node?.dataset.claimGateEffect === 'no_claims_cleared';
      });

      const readback = page.locator('#officialFlowReviewDecisionResults [data-official-flow-review-decision-evidence-id]').first();
      const decisionEvidenceId = Number(await readback.getAttribute('data-official-flow-review-decision-evidence-id'));
      expect(decisionEvidenceId).toBeGreaterThan(0);
      expect(await readback.getAttribute('data-source-official-flow-replay-evidence-id')).toBe(String(replayEvidenceId));
      expect(await readback.getAttribute('data-source-attachment-intake-packet-evidence-id')).toBe(String(packetEvidenceId));
      expect(await readback.getAttribute('data-source-attachment-intake-row-index')).toBe('0');
      expect(await readback.innerText()).toContain(`source_attachment_intake_packet_evidence_id ${packetEvidenceId}`);
      expect(await readback.innerText()).toContain('source_attachment_intake_row_index 0');

      const decisionRow = page.locator(`#evidence-${decisionEvidenceId}`).first();
      await decisionRow.waitFor();
      const decisionRowText = await decisionRow.innerText();
      expect(decisionRowText).toContain(`source_attachment_intake_packet_evidence_id ${packetEvidenceId}`);
      expect(decisionRowText).toContain('source_attachment_intake_row_index 0');
      expect(decisionRowText).toContain('official_flow_signed_reviewer_validation rows');
      expect(decisionRowText).toContain('Download signed evidence upload packet');

      const uploadPacketDownload = page.waitForEvent('download');
      await decisionRow.locator('[data-official-flow-signed-evidence-upload-packet-gate-code="AHJ_APPROVAL_MISSING"]').first().click();
      const uploadPacketDownloadFile = await uploadPacketDownload;
      const uploadPacket = JSON.parse((await fs.promises.readFile(await uploadPacketDownloadFile.path())).toString('utf8'));
      expect(uploadPacket).toEqual(expect.objectContaining({
        artifact_type: 'halofire.official_flow_signed_evidence_upload_packet.v1',
        status: 'requires_real_signed_evidence',
        source_review_decision_evidence_id: decisionEvidenceId,
        source_replay_evidence_id: replayEvidenceId,
        source_attachment_intake_packet_evidence_id: packetEvidenceId,
        source_attachment_intake_row_index: 0,
        target_gate_code: 'AHJ_APPROVAL_MISSING',
        required_evidence_type: 'ahj_approval',
        claim_gate_effect: 'requires_real_signed_evidence',
        no_claim_gates_cleared: true,
        claims_cleared_count: 0,
      }));
      expect(uploadPacket.required_upload_fields).toEqual(expect.arrayContaining([
        'signoff.reviewer_name',
        'signoff.reviewer_title',
        'signoff.signed_at',
      ]));
      expect(uploadPacket.provenance).toEqual(expect.objectContaining({
        source_review_decision_evidence_id: decisionEvidenceId,
        source_replay_evidence_id: replayEvidenceId,
        source_attachment_intake_packet_evidence_id: packetEvidenceId,
        source_attachment_intake_row_index: 0,
      }));

      await page.reload({ waitUntil: 'domcontentloaded' });
      const decisionRowAfterRefresh = page.locator(`#evidence-${decisionEvidenceId}`).first();
      await decisionRowAfterRefresh.waitFor();
      const decisionRowAfterRefreshText = await decisionRowAfterRefresh.innerText();
      expect(decisionRowAfterRefreshText).toContain(`source_attachment_intake_packet_evidence_id ${packetEvidenceId}`);
      expect(decisionRowAfterRefreshText).toContain('source_attachment_intake_row_index 0');
      expect(decisionRowAfterRefreshText).toContain('Download signed evidence upload packet');
    } finally {
      await page.close();
    }
  }, 40_000);
});
