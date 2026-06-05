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
      expect(decisionRowText).toContain('Upload real signed evidence & resolve PROFESSIONAL_REVIEW_MISSING');
      expect(decisionRowText).toContain('Upload real signed evidence & resolve AHJ_APPROVAL_MISSING');
      expect(decisionRowText).toContain('Upload real signed evidence & resolve MANUFACTURER_MODEL_APPROVAL_MISSING');
      expect(decisionRowText).toContain('Upload real signed evidence & resolve AUTOSPRINK_EVIDENCE_MISSING');

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

      await decisionRowAfterRefresh.locator('[data-official-flow-signed-reviewer-resolve-workflow][data-official-flow-signed-reviewer-resolve-gate-code="AHJ_APPROVAL_MISSING"]').first().click();
      await page.waitForURL((url) => url.pathname === '/settings.html' && url.hash === '#wizSignoff');
      await page.waitForFunction(
        () => document.getElementById('wizPacketStatus')?.dataset.officialFlowUploadPacketHref,
      );
      expect(page.url()).toContain('action=resolve');
      expect(page.url()).toContain('gate=AHJ_APPROVAL_MISSING');
      expect(page.url()).toContain('uploadPacketHref=');
      expect(await page.locator('#wizType').inputValue()).toBe('ahj_approval');
      expect(await page.locator('#wizSourceRef').inputValue()).toBe('ahj://default-1881/source-linked-flow');
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('Prefilled from halofire.official_flow_signed_evidence_upload_packet.v1');
    } finally {
      await page.close();
    }
  }, 40_000);

  it('opens official-flow SAM31 placeholder replacement into Settings with read-only source chain context', async () => {
    const token = await adminToken();
    const intake = await api(`${PROJECT_PATH}/resolver-packets/official-flow/intake`, token, {
      method: 'POST',
      body: JSON.stringify({
        staticPsi: 74,
        residualPsi: 63,
        flowingGpm: 1005,
        flowDataDate: '2026-06-05',
        source_file: 'official-flow-placeholder-settings.pdf',
        source_ref: 'official-flow-placeholder-settings.pdf#page=4',
        notes: 'Official-flow placeholder replacement Settings smoke; no regulated claims cleared.',
      }),
    });
    const replay = await api(`${PROJECT_PATH}/resolver-packets/official-flow/${intake.id}/replay-artifact`, token, {
      method: 'POST',
    });
    const decision = await api(`${PROJECT_PATH}/resolver-packets/official-flow-replay/${replay.id}/review-decision`, token, {
      method: 'POST',
      body: JSON.stringify({
        reviewer_name: 'HaloFire Workbench Reviewer',
        reviewer_title: 'Internal Alpha Reviewer',
        professional_review_ref: 'pe-review://official-flow/placeholder-settings',
        ahj_review_ref: 'ahj://official-flow/placeholder-settings',
        autosprink_export_ref: 'autosprink://official-flow/placeholder-settings',
        manufacturer_model_approval_ref: 'manufacturer://official-flow/placeholder-settings',
        review_decision: 'recorded_evidence_refs_fail_closed',
        notes: 'Decision source for placeholder replacement Settings smoke; no claim gates cleared.',
      }),
    });
    const upload = await api(`${PROJECT_PATH}/resolver-packets/official-flow-review-decision/${decision.id}/sam31/default-approval-upload`, token, {
      method: 'POST',
      body: JSON.stringify({
        targetGate: 'PROFESSIONAL_REVIEW_MISSING',
        evidenceType: 'professional_review',
      }),
    });
    const validation = await api(`${PROJECT_PATH}/evidence/${upload.id}/openclaw/sam31/approval-upload/gate-validation-decision`, token, {
      method: 'POST',
      body: JSON.stringify({
        validation_decision: 'default_internal_alpha_placeholder_rejected',
        validation_ref: `approval-validation://sam31/official-flow/${upload.id}`,
        reviewer_name: 'HaloFire Workbench Reviewer',
        reviewer_title: 'Internal Alpha Reviewer',
        notes: 'Placeholder upload rejected for real signed evidence replacement; no claims cleared.',
        selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
        selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:1881-official-flow-placeholder-settings',
      }),
    });

    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(10_000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(`${BASE}/workbench.html?project=${encodeURIComponent(PROJECT_NAME)}#resolverQueue`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#resolverQueue');
      await page.locator('[data-resolver-queue-filter="officialFlowSignedReviewer=pending&targetGate=PROFESSIONAL_REVIEW_MISSING&evidenceType=professional_review"]').first().click();
      await page.waitForFunction((expected) => {
        const text = document.querySelector('#resolverQueue')?.textContent || '';
        return text.includes(`review_decision_evidence #${expected.decisionId}`)
          && text.includes(`latest_sam31_approval_upload_intake evidence #${expected.uploadId}`)
          && Boolean(document.querySelector(`[data-official-flow-sam31-approval-upload-placeholder-replacement-workflow="${expected.validationId}"]`));
      }, {
        decisionId: decision.id,
        uploadId: upload.id,
        validationId: validation.id,
      });

      const replacement = page.locator(`[data-official-flow-sam31-approval-upload-placeholder-replacement-workflow="${validation.id}"]`).first();
      await replacement.waitFor();
      expect(await replacement.getAttribute('data-source-official-flow-review-decision-evidence-id')).toBe(String(decision.id));
      expect(await replacement.getAttribute('data-source-halofire-sam31-approval-upload-evidence-id')).toBe(String(upload.id));
      expect(await replacement.getAttribute('data-selected-sheet-ref')).toBe('1881://proposal-cooperative/sheet-7');
      expect(await replacement.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');

      await replacement.click();
      await page.waitForURL((url) => url.pathname === '/settings.html' && url.hash === '#wizSignoff');
      await page.waitForFunction((expected) => {
        const status = document.getElementById('wizPacketStatus');
        return status?.dataset.sourceOfficialFlowReviewDecisionEvidenceId === expected.decisionId
          && status?.dataset.sourceHalofireSam31ApprovalUploadEvidenceId === expected.uploadId
          && status?.dataset.sourceHalofireSam31ApprovalUploadValidationDecisionEvidenceId === expected.validationId;
      }, {
        decisionId: String(decision.id),
        uploadId: String(upload.id),
        validationId: String(validation.id),
      });

      expect(page.url()).toContain(`sourceOfficialFlowReviewDecisionEvidenceId=${decision.id}`);
      expect(page.url()).toContain(`sourceHalofireSam31ApprovalUploadEvidenceId=${upload.id}`);
      expect(page.url()).toContain(`sourceHalofireSam31ApprovalUploadValidationDecisionEvidenceId=${validation.id}`);
      expect(await page.locator('#wizGate').inputValue()).toBe('PROFESSIONAL_REVIEW_MISSING');
      expect(await page.locator('#wizType').inputValue()).toBe('professional_review');
      expect(await page.locator('#wizAction').inputValue()).toBe('record');
      expect(await page.locator('#wizSourceRef').inputValue()).toBe('pe-review://official-flow/placeholder-settings');
      const packetStatus = page.locator('#wizPacketStatus');
      expect(await packetStatus.getAttribute('data-placeholder-replacement')).toBe('official_flow_sam31_approval_upload');
      expect(await packetStatus.getAttribute('data-selected-sheet-ref')).toBe('1881://proposal-cooperative/sheet-7');
      expect(await packetStatus.getAttribute('data-selected-scale-ref')).toBe('1881://operator-scale/sheet-7/0.0833');
      expect(await packetStatus.getAttribute('data-selected-boundary-candidate-ref')).toBe('candidate:1881-official-flow-placeholder-settings');
      expect(await packetStatus.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
      expect(await page.locator('#wizNotes').inputValue()).toContain(`source_official_flow_review_decision_evidence_id ${decision.id}`);
      expect(await page.locator('#wizNotes').inputValue()).toContain(`source_halofire_sam31_approval_upload_evidence_id ${upload.id}`);
      expect(await page.locator('#wizNotes').inputValue()).toContain(`source_halofire_sam31_approval_upload_validation_decision_evidence_id ${validation.id}`);
      expect(await page.locator('#wizNotes').inputValue()).toContain('claim_gate_effect no_claims_cleared');
      expect(await packetStatus.innerText()).toContain('Replace the default/internal-alpha placeholder with real signed evidence');
    } finally {
      await page.close();
    }
  }, 40_000);

  it('shows cleared official-flow signed-reviewer rows with resolve-audit proof instead of upload-pending actions', async () => {
    const token = await adminToken();
    const projectName = 'Home Depot - Rexburg ID';
    const created = await api(`/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/intake`, token, {
      method: 'POST',
      body: JSON.stringify({
        staticPsi: 73,
        residualPsi: 62,
        flowingGpm: 990,
        flowDataDate: '2026-06-05',
        waterModelRequired: 'Workbench cleared reviewer row smoke values for internal-alpha replay only.',
        source_file: 'official-flow-cleared-workbench.pdf',
        source_ref: 'official-flow-cleared-workbench.pdf#page=2',
        notes: 'Workbench cleared reviewer row smoke; no regulated claims cleared until explicit signed evidence resolve.',
      }),
    });

    const replay = await api(`/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/${created.id}/replay-artifact`, token, {
      method: 'POST',
    });

    const decision = await api(`/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow-replay/${replay.id}/review-decision`, token, {
      method: 'POST',
      body: JSON.stringify({
        reviewer_name: 'HaloFire Workbench Reviewer',
        reviewer_title: 'Internal Alpha Reviewer',
        professional_review_ref: 'pe-review://official-flow/workbench-cleared',
        ahj_review_ref: 'ahj://official-flow/workbench-cleared',
        autosprink_export_ref: 'autosprink://official-flow/workbench-cleared',
        manufacturer_model_approval_ref: 'manufacturer://official-flow/workbench-cleared',
        review_decision: 'recorded_evidence_refs_fail_closed',
        notes: 'Workbench cleared reviewer row decision; no claim gates cleared here.',
      }),
    });

    const resolved = await api(`/api/projects/${encodeURIComponent(projectName)}/claim-gates/MANUFACTURER_MODEL_APPROVAL_MISSING/resolve`, token, {
      method: 'POST',
      body: JSON.stringify({
        evidence: {
          evidence_type: 'manufacturer_approval',
          source_ref: 'manufacturer://official-flow/workbench-cleared',
          source_file: 'official-flow-cleared-workbench-manufacturer-approval.pdf',
          status: 'present',
          notes: [
            'Workbench cleared reviewer row signed manufacturer resolve.',
            `source_official_flow_review_decision_evidence_id ${decision.id}`,
          ].join('\n'),
          signoff: {
            reviewer_name: 'Maya Workbench',
            reviewer_title: 'Manufacturer Representative',
            signed_at: '2026-06-05T08:45:00.000Z',
            organization: 'Halo Fire Vendor Desk',
            license_id: 'MFG-WORKBENCH-CLEARED-1',
          },
        },
      }),
    });
    expect(resolved.cleared).toBe(true);

    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(10_000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(`${BASE}/workbench.html?project=${encodeURIComponent(projectName)}#resolverQueue`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#resolverQueue');
      await page.locator('[data-resolver-queue-filter="officialFlowSignedReviewer=pending&targetGate=MANUFACTURER_MODEL_APPROVAL_MISSING&evidenceType=manufacturer_approval"]').first().click();

      const queue = page.locator('#resolverQueue');
      await page.waitForFunction((decisionId) => {
        const node = document.querySelector('#resolverQueue');
        return node?.textContent?.includes(`review_decision_evidence #${decisionId}`);
      }, decision.id);
      const queueText = await queue.innerText();
      expect(queueText).toContain('MANUFACTURER_MODEL_APPROVAL_MISSING');
      expect(queueText).toContain(`review_decision_evidence #${decision.id}`);
      expect(queueText).toContain('gate_cleared_after_explicit_signed_validation');
      expect(queueText).toContain('halofire.claim_gate_resolve_audit_packet.v1');
      expect(queueText).toContain('Open accepted evidence read-only');
      await expect(queue.locator('[data-official-flow-signed-evidence-upload-packet-gate-code="MANUFACTURER_MODEL_APPROVAL_MISSING"]').count()).resolves.toBe(0);
      await expect(queue.locator('[data-official-flow-signed-reviewer-resolve-workflow][data-official-flow-signed-reviewer-resolve-gate-code="MANUFACTURER_MODEL_APPROVAL_MISSING"]').count()).resolves.toBe(0);

      const auditButton = queue.locator('[data-official-flow-signed-reviewer-resolve-audit-gate-code="MANUFACTURER_MODEL_APPROVAL_MISSING"]').first();
      expect(await auditButton.getAttribute('data-official-flow-signed-reviewer-resolve-audit-evidence-id')).toBe(String(resolved.resolved_evidence_id));
      expect(await auditButton.getAttribute('data-official-flow-signed-reviewer-resolve-audit-href')).toMatch(/MANUFACTURER_MODEL_APPROVAL_MISSING\/resolve-audit-packet/);

      const clearedManufacturerRow = queue.locator('div').filter({ hasText: 'MANUFACTURER_MODEL_APPROVAL_MISSING manufacturer_approval gate_cleared_after_explicit_signed_validation' }).first();
      await clearedManufacturerRow.locator('[data-signed-reviewer-workflow-gate-code="MANUFACTURER_MODEL_APPROVAL_MISSING"]').click();
      await page.waitForURL((url) => url.pathname === '/settings.html' && url.hash === '#wizSignoff');
      await page.waitForFunction(
        (resolvedEvidenceId) => document.getElementById('wizPacketStatus')?.dataset.signedReviewerReadonlyEvidenceId === resolvedEvidenceId,
        String(resolved.resolved_evidence_id),
      );
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('Read-only accepted signed reviewer evidence');
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('halofire.claim_gate_resolve_audit_packet.v1');
      expect(await page.locator('#wizPacketStatus').getAttribute('data-signed-reviewer-claim-gate-effect')).toBe('gate_cleared_after_explicit_signed_validation');
      expect(await page.locator('#wizPacketStatus').getAttribute('data-signed-reviewer-resolve-audit-href')).toMatch(/MANUFACTURER_MODEL_APPROVAL_MISSING\/resolve-audit-packet/);
      expect(page.url()).toContain('action=inspect');
      expect(page.url()).not.toContain('uploadPacketHref=');
      expect(await page.locator('#wizGate').inputValue()).toBe('MANUFACTURER_MODEL_APPROVAL_MISSING');
      expect(await page.locator('#wizSubmit').isDisabled()).toBe(true);
    } finally {
      await page.close();
    }
  }, 40_000);
});
