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
  it('resolves a ready SAM31 approval validation decision and downloads the claim-gate audit packet', async () => {
    const token = await adminToken();
    const gateCode = 'AHJ_APPROVAL_MISSING';
    const approvalUpload = await api(`${PROJECT_PATH}/evidence`, token, {
      method: 'POST',
      body: JSON.stringify({
        evidence_type: 'halofire_sam31_approval_upload_intake',
        source_ref: 'signed-ahj://1881/sam31/ahj-approval-real-001',
        source_file: 'sam31-ahj-approval-real-001.pdf',
        status: 'present',
        notes: JSON.stringify({
          kind: 'halofire_sam31_approval_upload_intake',
          artifact_type: 'halofire.sam31_approval_upload_intake.v1',
          intake: {
            artifact_type: 'halofire.sam31_approval_upload_intake.v1',
            status: 'uploaded_pending_gate_validation',
            project_name: PROJECT_NAME,
            code: 'HALOFIRE_SAM31_AHJ_APPROVAL_UPLOAD_MISSING',
            target_approval_lane: 'AHJ_approval',
            evidence_type: 'ahj_approval',
            required_evidence_type: 'AHJ_signed_approval_or_plan_check_record',
            gate_code: gateCode,
            source_ref: 'signed-ahj://1881/sam31/ahj-approval-real-001',
            source_file: 'sam31-ahj-approval-real-001.pdf',
            source_packet_review_decision_evidence_id: 0,
            source_followup_decision_evidence_id: 0,
            source_pdf_boundary_evidence_id: null,
            selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
            selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
            selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
            packet_index: 0,
            signoff: {
              reviewer_name: 'Pat Licensed',
              reviewer_title: 'Fire Marshal',
              signed_at: '2026-06-04T09:15:00.000Z',
              organization: 'Salt Lake City',
              license_id: 'AHJ-SAM31-1881',
            },
            gate_validation_action: {
              method: 'POST',
              href: `${PROJECT_PATH}/claim-gates/${gateCode}/resolve`,
              request_body: { evidence_id: null },
            },
            source_refs: [
              {
                evidence_type: 'ahj_approval',
                source_ref: 'signed-ahj://1881/sam31/ahj-approval-real-001',
                source_file: 'sam31-ahj-approval-real-001.pdf',
                status: 'present',
                claim_gate_effect: 'no_claims_cleared',
              },
              {
                evidence_type: 'selected_1881_context',
                selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
                selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
                selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
                claim_gate_effect: 'no_claims_cleared',
              },
            ],
            blocked_claims: ['AHJ_approval', 'permit_ready'],
            use_for_claims: false,
            claim_gate_effect: 'no_claims_cleared',
            no_claim_gates_cleared: true,
            limitations: [
              'Seeded browser-smoke SAM31 approval upload intake for real validation follow-through.',
              'This upload intake does not clear claims until a validation decision explicitly resolves the gate.',
            ],
          },
          claim_gate_effect: 'no_claims_cleared',
          use_for_claims: false,
        }),
      }),
    });

    const approvalValidationDecision = await api(`${PROJECT_PATH}/evidence/${approvalUpload.id}/openclaw/sam31/approval-upload/gate-validation-decision`, token, {
      method: 'POST',
      body: JSON.stringify({
        validation_decision: 'real_signed_evidence_validated',
        validation_ref: 'approval-validation://1881/sam31/ahj-approval-real-001',
        reviewer_name: 'Pat Licensed',
        reviewer_title: 'Fire Marshal',
        signed_at: '2026-06-04T09:16:00.000Z',
        organization: 'Salt Lake City',
        license_id: 'AHJ-SAM31-1881',
        notes: 'Browser smoke real signed evidence validation for one-click audit follow-through.',
      }),
    });
    expect(approvalValidationDecision.claim_gate_effect).toBe('ready_for_explicit_gate_resolve');
    const readyQueue = await api(`${PROJECT_PATH}/resolver-queue?sam31ApprovalValidation=ready_for_explicit_gate_resolve`, token);
    expect(readyQueue.summary.sam31_approval_validation_ready_for_gate_resolve).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(readyQueue.items)).toContain(`"evidence_id":${approvalValidationDecision.evidence_id}`);

    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(8000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(`${BASE}/workbench.html`, { waitUntil: 'domcontentloaded' });
      await page.locator('#projectTarget').selectOption(PROJECT_NAME);
      await page.locator('[data-resolver-queue-filter="sam31ApprovalValidation=ready_for_explicit_gate_resolve"]').click();
      const resolveButton = page.locator(`[data-sam31-approval-upload-resolve-evidence-id="${approvalValidationDecision.evidence_id}"]`).first();
      await resolveButton.waitFor({ state: 'attached' });
      expect(await resolveButton.getAttribute('data-sam31-approval-upload-resolve-gate-code')).toBe(gateCode);
      const statusId = await resolveButton.getAttribute('data-sam31-approval-upload-resolve-status-id');
      expect(statusId).toMatch(/^sam31ApprovalUploadResolveStatus-/);

      const [auditDownload] = await Promise.all([
        page.waitForEvent('download'),
        resolveButton.click(),
      ]);
      const auditDownloadPath = await auditDownload.path();
      expect(auditDownload.suggestedFilename()).toContain('resolve-audit-packet');
      expect(auditDownloadPath).toBeTruthy();
      const auditPacket = JSON.parse(fs.readFileSync(auditDownloadPath, 'utf8'));
      expect(auditPacket).toEqual(expect.objectContaining({
        artifact_type: 'halofire.claim_gate_resolve_audit_packet.v1',
        status: 'gate_cleared_with_explicit_signed_evidence',
        project_name: PROJECT_NAME,
        gate_code: gateCode,
        resolved_evidence_id: approvalValidationDecision.evidence_id,
        resolved_evidence_ref: 'approval-validation://1881/sam31/ahj-approval-real-001',
        selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
        selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
        claim_gate_effect: 'gate_cleared_after_explicit_signed_validation',
      }));
      expect(auditPacket.source_refs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          evidence_type: 'selected_1881_context',
          selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
          selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
          selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
        }),
      ]));

      const resolveStatus = page.locator(`#${statusId}`);
      await page.waitForFunction((targetId) => {
        const status = document.getElementById(targetId);
        return status?.dataset.downloadedResolveAuditPacket === 'true'
          && status?.dataset.filteredClaimGateAuditQueue === 'true';
      }, statusId);
      expect(await resolveStatus.getAttribute('data-resolved-evidence-id')).toBe(String(approvalValidationDecision.evidence_id));
      expect(await resolveStatus.getAttribute('data-claim-gate-resolve-audit-href')).toBe(`${PROJECT_PATH}/claim-gates/${gateCode}/resolve-audit-packet`);
      expect(await resolveStatus.getAttribute('data-claim-gate-effect')).toBe('gate_cleared_after_explicit_signed_validation');
      const resolveStatusText = await resolveStatus.innerText();
      expect(resolveStatusText).toContain('selected_1881_context');
      expect(resolveStatusText).toContain('1881://proposal-cooperative/sheet-7');

      await page.waitForFunction((decisionEvidenceId) => {
        const text = document.getElementById('resolverQueue')?.innerText || '';
        return text.includes('claimGateAuditQuickFilter')
          && text.includes('claimGateAudit=cleared')
          && text.includes(`resolved_evidence_id ${decisionEvidenceId}`)
          && text.includes('halofire.claim_gate_resolve_audit_packet.v1');
      }, String(approvalValidationDecision.evidence_id));

      const saveAuditEvidence = page.locator(`[data-claim-gate-resolve-audit-save-evidence-id="${approvalValidationDecision.evidence_id}"]`).first();
      await saveAuditEvidence.waitFor({ state: 'attached' });
      expect(await saveAuditEvidence.getAttribute('data-claim-gate-resolve-audit-gate-code')).toBe(gateCode);
      expect(await saveAuditEvidence.getAttribute('data-claim-gate-resolve-audit-href')).toBe(`${PROJECT_PATH}/claim-gates/${gateCode}/resolve-audit-packet`);

      await saveAuditEvidence.click();
      const auditSaveStatus = page.locator(`#claimGateResolveAuditSaveStatus-${approvalValidationDecision.evidence_id}`);
      await page.waitForFunction((decisionEvidenceId) => {
        const status = document.getElementById(`claimGateResolveAuditSaveStatus-${decisionEvidenceId}`);
        return status?.dataset.claimGateResolveAuditEvidenceId
          && status?.dataset.resolvedEvidenceId === decisionEvidenceId
          && status?.dataset.noUnrelatedClaimsCleared === 'true';
      }, String(approvalValidationDecision.evidence_id));
      const savedAuditEvidenceId = await auditSaveStatus.getAttribute('data-claim-gate-resolve-audit-evidence-id');
      expect(savedAuditEvidenceId).toBeTruthy();
      expect(await auditSaveStatus.getAttribute('data-claim-gate-effect')).toBe('gate_cleared_after_explicit_signed_validation');
      expect(await auditSaveStatus.getAttribute('data-source-resolved-evidence-ref')).toBe('approval-validation://1881/sam31/ahj-approval-real-001');

      const savedAuditRow = page.locator(`#evidence-${savedAuditEvidenceId}`);
      await savedAuditRow.waitFor({ state: 'attached' });
      const savedAuditText = await savedAuditRow.innerText();
      expect(savedAuditText).toContain('claim_gate_resolve_audit_packet');
      expect(savedAuditText).toContain('halofire.claim_gate_resolve_audit_packet.v1');
      expect(savedAuditText).toContain(`resolved_evidence_id ${approvalValidationDecision.evidence_id}`);
      expect(savedAuditText).toContain('resolved_evidence_ref approval-validation://1881/sam31/ahj-approval-real-001');
      expect(savedAuditText).toContain('claim_gate_effect gate_cleared_after_explicit_signed_validation');
      expect(savedAuditText).toContain('no_unrelated_claims_cleared true');

      const saveAuditActualValue = page.locator(`[data-claim-gate-audit-actual-value-readback-evidence-id="${savedAuditEvidenceId}"]`).first();
      await saveAuditActualValue.waitFor({ state: 'attached' });
      expect(await saveAuditActualValue.getAttribute('data-source-resolved-evidence-id')).toBe(String(approvalValidationDecision.evidence_id));
      expect(await saveAuditActualValue.getAttribute('data-no-unrelated-claims-cleared')).toBe('true');

      await saveAuditActualValue.click();
      const auditActualValueStatus = page.locator(`#claimGateAuditActualValueStatus-${savedAuditEvidenceId}`);
      await page.waitForFunction((auditEvidenceId) => {
        const status = document.getElementById(`claimGateAuditActualValueStatus-${auditEvidenceId}`);
        return status?.dataset.sam31ActualValueReplacementReadbackEvidenceId
          && status?.dataset.sourceClaimGateResolveAuditEvidenceId === auditEvidenceId
          && status?.dataset.claimGateEffect === 'no_claims_cleared'
          && status?.dataset.noUnrelatedClaimsCleared === 'true';
      }, String(savedAuditEvidenceId));
      const auditReadbackEvidenceId = await auditActualValueStatus.getAttribute('data-sam31-actual-value-replacement-readback-evidence-id');
      expect(auditReadbackEvidenceId).toMatch(/^\d+$/);
      expect(await auditActualValueStatus.getAttribute('data-source-resolved-evidence-id')).toBe(String(approvalValidationDecision.evidence_id));
      expect(await auditActualValueStatus.getAttribute('data-source-claim-gate-effect')).toBe('gate_cleared_after_explicit_signed_validation');

      const auditReadbackRow = page.locator(`#evidence-${auditReadbackEvidenceId}`);
      await auditReadbackRow.waitFor({ state: 'attached' });
      const auditReadbackText = await auditReadbackRow.innerText();
      expect(auditReadbackText).toContain('openclaw_sam31_actual_value_replacement_readback');
      expect(auditReadbackText).toContain(`source_claim_gate_resolve_audit_evidence_id ${savedAuditEvidenceId}`);
      expect(auditReadbackText).toContain(`source_resolved_evidence_id ${approvalValidationDecision.evidence_id}`);
      expect(auditReadbackText).toContain('source_claim_gate_effect gate_cleared_after_explicit_signed_validation');
      expect(auditReadbackText).toContain('claim_gate_effect no_claims_cleared');
      expect(auditReadbackText).toContain('no_unrelated_claims_cleared true');

      const recordExactReplacement = page.locator(`[data-sam31-actual-value-evidence-record-context="${auditReadbackEvidenceId}"]`).first();
      await recordExactReplacement.waitFor({ state: 'attached' });
      await recordExactReplacement.click();
      await page.waitForFunction((expected) => {
        const status = document.getElementById('sam31ActualValueQueueStatus');
        const queue = document.getElementById('sam31ActualValueQueue');
        return status?.dataset.replacementReadbackEvidenceFilterId === expected.auditReadbackEvidenceId
          && status?.dataset.sourceClaimGateResolveAuditEvidenceId === expected.savedAuditEvidenceId
          && status?.dataset.sourceResolvedEvidenceId === expected.approvalValidationEvidenceId
          && status?.dataset.sourceClaimGateEffect === 'gate_cleared_after_explicit_signed_validation'
          && status?.dataset.claimGateEffect === 'no_claims_cleared'
          && status?.dataset.noUnrelatedClaimsCleared === 'true'
          && queue?.dataset.sourceClaimGateResolveAuditEvidenceId === expected.savedAuditEvidenceId;
      }, {
        auditReadbackEvidenceId,
        savedAuditEvidenceId,
        approvalValidationEvidenceId: String(approvalValidationDecision.evidence_id),
      });
      const actualValueQueueText = await page.locator('#sam31ActualValueQueue').innerText();
      expect(actualValueQueueText).toContain(`replacement_readback_evidence_filter_id ${auditReadbackEvidenceId}`);
      expect(actualValueQueueText).toContain(`source_claim_gate_resolve_audit_evidence_id ${savedAuditEvidenceId}`);
      expect(actualValueQueueText).toContain(`source_resolved_evidence_id ${approvalValidationDecision.evidence_id}`);
      expect(actualValueQueueText).toContain('source_claim_gate_effect gate_cleared_after_explicit_signed_validation');
      expect(actualValueQueueText).toContain('claim_gate_effect no_claims_cleared');
      expect(actualValueQueueText).toContain('no_unrelated_claims_cleared true');

      const defaultReplacement = page.locator(`[data-sam31-actual-value-default-replacement-intake="${auditReadbackEvidenceId}"]`).first();
      await defaultReplacement.waitFor({ state: 'attached' });
      const [defaultReplayDownload] = await Promise.all([
        page.waitForEvent('download'),
        defaultReplacement.click(),
      ]);
      const defaultReplayPath = await defaultReplayDownload.path();
      expect(defaultReplayDownload.suggestedFilename()).toContain('default-actual-value-replay');
      expect(defaultReplayPath).toBeTruthy();
      const defaultReplay = JSON.parse(fs.readFileSync(defaultReplayPath, 'utf8'));
      expect(defaultReplay).toEqual(expect.objectContaining({
        artifact_type: 'openclaw.sam31.actual_value_resolver_replay.v1',
        replay_status: 'default_internal_alpha_intake_saved',
        source_openclaw_sam31_actual_value_replacement_readback_evidence_id: Number(auditReadbackEvidenceId),
        source_claim_gate_resolve_audit_evidence_id: Number(savedAuditEvidenceId),
        claim_gate_effect: 'no_claims_cleared',
        use_for_claims: false,
      }));
      await page.waitForFunction((expected) => {
        const status = document.getElementById('sam31ActualValueQueueStatus');
        return Boolean(status?.dataset.sam31ActualValueReplacementEvidenceId)
          && status?.dataset.sourceOpenclawSam31ActualValueReplacementReadbackEvidenceId === expected.auditReadbackEvidenceId
          && status?.dataset.sourceClaimGateResolveAuditEvidenceId === expected.savedAuditEvidenceId
          && status?.dataset.sourceResolvedEvidenceId === expected.approvalValidationEvidenceId
          && status?.dataset.sourceClaimGateEffect === 'gate_cleared_after_explicit_signed_validation'
          && status?.dataset.claimGateEffect === 'no_claims_cleared'
          && status?.dataset.noUnrelatedClaimsCleared === 'true';
      }, {
        auditReadbackEvidenceId,
        savedAuditEvidenceId,
        approvalValidationEvidenceId: String(approvalValidationDecision.evidence_id),
      });
      const defaultReplacementEvidenceId = await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-sam31-actual-value-replacement-evidence-id');
      expect(defaultReplacementEvidenceId).toMatch(/^\d+$/);
      await page.locator(`#evidence-${defaultReplacementEvidenceId}`).waitFor({ state: 'attached' });
      const defaultReplacementText = await page.locator(`#evidence-${defaultReplacementEvidenceId}`).innerText();
      expect(defaultReplacementText).toContain('sam31_actual_value_replacement');
      expect(defaultReplacementText).toContain(`source_openclaw_sam31_actual_value_replacement_readback_evidence_id ${auditReadbackEvidenceId}`);
      expect(defaultReplacementText).toContain(`source_claim_gate_resolve_audit_evidence_id ${savedAuditEvidenceId}`);
      expect(defaultReplacementText).toContain(`source_resolved_evidence_id ${approvalValidationDecision.evidence_id}`);
      expect(defaultReplacementText).toContain('source_claim_gate_effect gate_cleared_after_explicit_signed_validation');
      expect(defaultReplacementText).toContain('no_unrelated_claims_cleared true');
      expect(defaultReplacementText).toContain('claim_gate_effect no_claims_cleared');
      expect(defaultReplacementText).toContain('openclaw.sam31.section_to_artifacts_consumer_handoff.v1');
      expect(defaultReplacementText).toContain('source_sam31_actual_value_replacement_evidence_id');

      const defaultReplacementSmoke = page.locator(
        `[data-replay-sam31-consumer-intake-smoke-source-replacement-evidence-id="${defaultReplacementEvidenceId}"]`,
      ).first();
      await defaultReplacementSmoke.waitFor({ state: 'attached' });
      expect(await defaultReplacementSmoke.getAttribute('data-source-sam31-actual-value-replacement-evidence-id'))
        .toBe(String(defaultReplacementEvidenceId));
      expect(await defaultReplacementSmoke.getAttribute('data-replay-sam31-consumer-intake-smoke-consumer'))
        .toBe('halo_fire');
    } finally {
      await page.close();
    }
  }, 30_000);

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

      const replaySmokeButton = page.locator(`[data-replay-sam31-consumer-intake-smoke-source-replacement-evidence-id="${replacementEvidenceId}"]`).first();
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
      expect(await defaultSprinkler.getAttribute('data-selected-sheet-ref')).toBe('1881://proposal-cooperative/sheet-7');
      expect(await defaultSprinkler.getAttribute('data-selected-scale-ref')).toBe('1881://operator-scale/sheet-7/0.0833');
      expect(await defaultSprinkler.getAttribute('data-selected-boundary-candidate-ref')).toBe('candidate:1881-sheet-7-outline');
      expect(await defaultSprinkler.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
      const [defaultSprinklerInputsDownload] = await Promise.all([
        page.waitForEvent('download'),
        defaultSprinkler.click(),
      ]);
      const defaultSprinklerInputsPath = await defaultSprinklerInputsDownload.path();
      expect(defaultSprinklerInputsDownload.suggestedFilename()).toContain('preliminary-replay-inputs');
      expect(defaultSprinklerInputsPath).toBeTruthy();
      const defaultSprinklerInputs = JSON.parse(fs.readFileSync(defaultSprinklerInputsPath, 'utf8'));
      expect(defaultSprinklerInputs).toEqual(expect.objectContaining({
        artifact_type: 'halofire.sam31_sprinkler_review_preliminary_replay_inputs.v1',
        source_replay_evidence_id: Number(savedReplayEvidenceId),
        source_sam31_actual_value_replacement_evidence_id: Number(replacementEvidenceId),
        source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: Number(followupReviewEvidenceId),
        selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
        selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
        claim_gate_effect: 'no_claims_cleared',
      }));
      expect(defaultSprinklerInputs.source_refs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
          selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
          selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
        }),
      ]));
      await page.waitForFunction((smokeId) => {
        const status = document.getElementById(`sam31ConsumerIntakeSmokeSprinklerReview-${smokeId}-status`);
        return status?.dataset.halofireSam31SprinklerReviewDecisionEvidenceId
          && status?.dataset.selectedSheetRef === '1881://proposal-cooperative/sheet-7'
          && status?.dataset.selectedScaleRef === '1881://operator-scale/sheet-7/0.0833'
          && status?.dataset.selectedBoundaryCandidateRef === 'candidate:1881-sheet-7-outline'
          && status?.dataset.downloadedPreliminaryReplayInputs === 'true';
      }, String(smokeEvidenceId));

      const sprinklerStatus = page.locator(`#sam31ConsumerIntakeSmokeSprinklerReview-${smokeEvidenceId}-status`);
      const sprinklerDecisionEvidenceId = String(await sprinklerStatus.getAttribute('data-halofire-sam31-sprinkler-review-decision-evidence-id') || '');
      expect(sprinklerDecisionEvidenceId).toMatch(/^\d+$/);
      expect(await sprinklerStatus.getAttribute('data-source-replay-evidence-id')).toBe(String(savedReplayEvidenceId));
      expect(await sprinklerStatus.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(replacementEvidenceId));
      expect(await sprinklerStatus.getAttribute('data-source-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id')).toBe(String(followupReviewEvidenceId));
      expect(await sprinklerStatus.getAttribute('data-sam31-consumer-intake-smoke-evidence-id')).toBe(String(smokeEvidenceId));
      expect(await sprinklerStatus.getAttribute('data-selected-sheet-ref')).toBe('1881://proposal-cooperative/sheet-7');
      expect(await sprinklerStatus.getAttribute('data-selected-scale-ref')).toBe('1881://operator-scale/sheet-7/0.0833');
      expect(await sprinklerStatus.getAttribute('data-selected-boundary-candidate-ref')).toBe('candidate:1881-sheet-7-outline');
      expect(await sprinklerStatus.getAttribute('data-downloaded-preliminary-replay-inputs')).toBe('true');
      expect(await sprinklerStatus.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
      const sprinklerStatusText = await sprinklerStatus.innerText();
      expect(sprinklerStatusText).toContain('selected_1881_context');
      expect(sprinklerStatusText).toContain('1881://proposal-cooperative/sheet-7');

      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-source-halofire-sam31-sprinkler-review-decision-evidence-id')).toBe(String(sprinklerDecisionEvidenceId));
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-selected-sheet-ref')).toBe('1881://proposal-cooperative/sheet-7');
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-selected-scale-ref')).toBe('1881://operator-scale/sheet-7/0.0833');
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-selected-boundary-candidate-ref')).toBe('candidate:1881-sheet-7-outline');
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

      const defaultPacketReview = page.locator(`[data-replay-sam31-consumer-intake-smoke-default-packet-review="${smokeEvidenceId}"]`).first();
      await defaultPacketReview.waitFor({ state: 'attached' });
      expect(await defaultPacketReview.getAttribute('data-source-replay-evidence-id')).toBe(String(savedReplayEvidenceId));
      expect(await defaultPacketReview.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(replacementEvidenceId));
      expect(await defaultPacketReview.getAttribute('data-source-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id')).toBe(String(followupReviewEvidenceId));
      expect(await defaultPacketReview.getAttribute('data-source-halofire-sam31-sprinkler-review-decision-evidence-id')).toBe(String(sprinklerDecisionEvidenceId));
      expect(await defaultPacketReview.getAttribute('data-source-halofire-sam31-preliminary-replay-followup-evidence-id')).toBe(String(replayFollowupEvidenceId));
      expect(await defaultPacketReview.getAttribute('data-packet-index')).toBe('0');
      expect(await defaultPacketReview.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
      await defaultPacketReview.click();
      await page.waitForFunction((smokeId) => {
        const status = document.getElementById(`sam31ConsumerIntakeSmokeReplayFollowupPacketReview-${smokeId}-status`);
        return status?.dataset.halofireSam31FollowupPacketReviewEvidenceId
          && status?.dataset.downloadedReplayFollowupPacket === 'true'
          && status?.dataset.reviewedReplayFollowupPacket === 'true';
      }, String(smokeEvidenceId));

      const packetReviewStatus = page.locator(`#sam31ConsumerIntakeSmokeReplayFollowupPacketReview-${smokeEvidenceId}-status`);
      const packetReviewEvidenceId = String(await packetReviewStatus.getAttribute('data-halofire-sam31-followup-packet-review-evidence-id') || '');
      expect(packetReviewEvidenceId).toMatch(/^\d+$/);
      expect(await packetReviewStatus.getAttribute('data-source-replay-evidence-id')).toBe(String(savedReplayEvidenceId));
      expect(await packetReviewStatus.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(replacementEvidenceId));
      expect(await packetReviewStatus.getAttribute('data-source-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id')).toBe(String(followupReviewEvidenceId));
      expect(await packetReviewStatus.getAttribute('data-source-halofire-sam31-sprinkler-review-decision-evidence-id')).toBe(String(sprinklerDecisionEvidenceId));
      expect(await packetReviewStatus.getAttribute('data-source-halofire-sam31-preliminary-replay-followup-evidence-id')).toBe(String(replayFollowupEvidenceId));
      expect(await packetReviewStatus.getAttribute('data-packet-index')).toBe('0');
      expect(await packetReviewStatus.getAttribute('data-downloaded-replay-followup-packet')).toBe('true');
      expect(await packetReviewStatus.getAttribute('data-reviewed-replay-followup-packet')).toBe('true');
      expect(await packetReviewStatus.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');

      await page.locator(`#evidence-${packetReviewEvidenceId}`).waitFor({ state: 'attached' });
      const packetReviewRow = await page.locator(`#evidence-${packetReviewEvidenceId}`).innerText();
      expect(packetReviewRow).toContain('halofire_sam31_sprinkler_followup_packet_review_decision');
      expect(packetReviewRow).toContain(`source_replay_evidence_id ${savedReplayEvidenceId}`);
      expect(packetReviewRow).toContain(`source_sam31_actual_value_replacement_evidence_id ${replacementEvidenceId}`);
      expect(packetReviewRow).toContain(`source_halofire_sam31_preliminary_replay_followup_evidence_id ${replayFollowupEvidenceId}`);
      expect(packetReviewRow).toContain('packet_index 0');
      expect(packetReviewRow).toContain('claim_gate_effect no_claims_cleared');

      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-source-halofire-sam31-followup-packet-review-evidence-id')).toBe(String(packetReviewEvidenceId));
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-downloaded-replay-followup-packet')).toBe('true');
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-reviewed-replay-followup-packet')).toBe('true');
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');

      const defaultApprovalUpload = page.locator(`[data-replay-sam31-consumer-intake-smoke-default-approval-upload="${packetReviewEvidenceId}"]`).first();
      await defaultApprovalUpload.waitFor({ state: 'attached' });
      expect(await defaultApprovalUpload.getAttribute('data-sam31-approval-upload-smoke-evidence-id')).toBe(String(smokeEvidenceId));
      expect(await defaultApprovalUpload.getAttribute('data-sam31-approval-upload-sprinkler-review-evidence-id')).toBe(String(sprinklerDecisionEvidenceId));
      expect(await defaultApprovalUpload.getAttribute('data-sam31-approval-upload-followup-evidence-id')).toBe(String(replayFollowupEvidenceId));
      expect(await defaultApprovalUpload.getAttribute('data-sam31-approval-upload-packet-index')).toBe('0');
      expect(await defaultApprovalUpload.getAttribute('data-sam31-approval-upload-code')).toBe('HALOFIRE_SAM31_PROFESSIONAL_APPROVAL_UPLOAD_MISSING');
      expect(await defaultApprovalUpload.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
      await defaultApprovalUpload.click();
      await page.waitForFunction((packetReviewId) => {
        const status = document.getElementById(`sam31ApprovalUploadDefaultStatus-${packetReviewId}`);
        return status?.dataset.sam31ApprovalUploadEvidenceId
          && status?.dataset.downloadedGateValidationPacket === 'true'
          && status?.dataset.claimGateEffect === 'no_claims_cleared';
      }, String(packetReviewEvidenceId));

      const approvalUploadStatus = page.locator(`#sam31ApprovalUploadDefaultStatus-${packetReviewEvidenceId}`);
      const approvalUploadEvidenceId = String(await approvalUploadStatus.getAttribute('data-sam31-approval-upload-evidence-id') || '');
      expect(approvalUploadEvidenceId).toMatch(/^\d+$/);
      expect(await approvalUploadStatus.getAttribute('data-source-replay-evidence-id')).toBe(String(savedReplayEvidenceId));
      expect(await approvalUploadStatus.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(replacementEvidenceId));
      expect(await approvalUploadStatus.getAttribute('data-source-halofire-sam31-followup-packet-review-evidence-id')).toBe(String(packetReviewEvidenceId));
      expect(await approvalUploadStatus.getAttribute('data-source-halofire-sam31-preliminary-replay-followup-evidence-id')).toBe(String(replayFollowupEvidenceId));
      expect(await approvalUploadStatus.getAttribute('data-downloaded-gate-validation-packet')).toBe('true');
      expect(await approvalUploadStatus.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');

      await page.locator(`#evidence-${approvalUploadEvidenceId}`).waitFor({ state: 'attached' });
      const approvalUploadRow = await page.locator(`#evidence-${approvalUploadEvidenceId}`).innerText();
      expect(approvalUploadRow).toContain('professional_review');
      expect(approvalUploadRow).toContain(`source_packet_review_decision_evidence_id ${packetReviewEvidenceId}`);
      expect(approvalUploadRow).toContain('uploaded_pending_gate_validation');
      expect(approvalUploadRow).toContain('claim_gate_effect no_claims_cleared');

      const approvalValidation = page.locator(`[data-sam31-approval-upload-default-validation-packet="${approvalUploadEvidenceId}"]`).first();
      await approvalValidation.waitFor({ state: 'attached' });
      const approvalValidationQueueHref = `/api/projects/${encodeURIComponent(PROJECT_NAME)}/resolver-queue?sam31ApprovalValidation=pending`;
      expect(await approvalValidation.getAttribute('data-sam31-approval-upload-evidence-id')).toBe(String(approvalUploadEvidenceId));
      expect(await approvalValidation.getAttribute('data-source-halofire-sam31-followup-packet-review-evidence-id')).toBe(String(packetReviewEvidenceId));
      expect(await approvalValidation.getAttribute('data-source-halofire-sam31-preliminary-replay-followup-evidence-id')).toBe(String(replayFollowupEvidenceId));
      expect(await approvalValidation.getAttribute('data-sam31-approval-validation-filter-href')).toBe(`${approvalValidationQueueHref}&targetGate=PROFESSIONAL_REVIEW_MISSING`);
      expect(await approvalValidation.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
      await approvalValidation.click();
      await page.waitForFunction((approvalUploadId) => {
        const status = document.getElementById(`sam31ApprovalUploadValidationStatus-${approvalUploadId}`);
        return status?.dataset.sam31ApprovalUploadEvidenceId === approvalUploadId
          && status?.dataset.downloadedGateValidationPacket === 'true'
          && status?.dataset.filteredSam31ApprovalValidationQueue === 'true'
          && status?.dataset.claimGateEffect === 'no_claims_cleared';
      }, approvalUploadEvidenceId);

      const approvalValidationStatus = page.locator(`#sam31ApprovalUploadValidationStatus-${approvalUploadEvidenceId}`);
      expect(await approvalValidationStatus.getAttribute('data-sam31-approval-validation-filter-href')).toBe(`${approvalValidationQueueHref}&targetGate=PROFESSIONAL_REVIEW_MISSING`);
      expect(await approvalValidationStatus.getAttribute('data-source-halofire-sam31-followup-packet-review-evidence-id')).toBe(String(packetReviewEvidenceId));
      expect(await approvalValidationStatus.getAttribute('data-source-halofire-sam31-preliminary-replay-followup-evidence-id')).toBe(String(replayFollowupEvidenceId));
      const resolverQueueText = await page.locator('#resolverQueue').innerText();
      expect(resolverQueueText).toContain('sam31ApprovalValidationQuickFilter');
      expect(resolverQueueText).toContain('sam31ApprovalValidation=pending');
      expect(resolverQueueText).toContain('sam31_approval_validation_pending');
      expect(resolverQueueText).toContain(`latest_approval_upload_intake evidence #${approvalUploadEvidenceId}`);
      expect(resolverQueueText).toContain('Review uploaded approval evidence');

      const approvalUploadReview = page.locator(`[data-sam31-approval-upload-review-evidence-id="${approvalUploadEvidenceId}"]`).first();
      await approvalUploadReview.waitFor({ state: 'attached' });
      expect(await approvalUploadReview.getAttribute('data-sam31-approval-upload-review-gate-code')).toBe('PROFESSIONAL_REVIEW_MISSING');
      expect(await approvalUploadReview.getAttribute('data-sam31-approval-upload-review-gate-validation-packet-href')).toContain(`/evidence/${approvalUploadEvidenceId}/openclaw/sam31/approval-upload/gate-validation-packet`);
      expect(await approvalUploadReview.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
      expect(await approvalUploadReview.getAttribute('data-selected-sheet-ref')).toBe('1881://proposal-cooperative/sheet-7');
      expect(await approvalUploadReview.getAttribute('data-selected-scale-ref')).toBe('1881://operator-scale/sheet-7/0.0833');
      expect(await approvalUploadReview.getAttribute('data-selected-boundary-candidate-ref')).toBe('candidate:1881-sheet-7-outline');
      await approvalUploadReview.click();
      await page.waitForFunction((approvalUploadId) => {
        const status = document.getElementById(`sam31ApprovalUploadReviewStatus-${approvalUploadId}`);
        return status?.dataset.sam31ApprovalUploadEvidenceId === approvalUploadId
          && status?.dataset.downloadedGateValidationPacket === 'true'
          && status?.dataset.reviewedUploadedApprovalEvidence === 'true'
          && status?.dataset.selectedSheetRef === '1881://proposal-cooperative/sheet-7'
          && status?.dataset.selectedScaleRef === '1881://operator-scale/sheet-7/0.0833'
          && status?.dataset.selectedBoundaryCandidateRef === 'candidate:1881-sheet-7-outline'
          && status?.dataset.claimGateEffect === 'no_claims_cleared';
      }, approvalUploadEvidenceId);
      const approvalUploadReviewStatus = page.locator(`#sam31ApprovalUploadReviewStatus-${approvalUploadEvidenceId}`);
      expect(await approvalUploadReviewStatus.getAttribute('data-sam31-approval-upload-review-gate-code')).toBe('PROFESSIONAL_REVIEW_MISSING');
      expect(await approvalUploadReviewStatus.getAttribute('data-sam31-approval-upload-review-resolve-href')).toContain('/claim-gates/PROFESSIONAL_REVIEW_MISSING/resolve');
      expect(await approvalUploadReviewStatus.getAttribute('data-selected-sheet-ref')).toBe('1881://proposal-cooperative/sheet-7');
      expect(await approvalUploadReviewStatus.getAttribute('data-selected-scale-ref')).toBe('1881://operator-scale/sheet-7/0.0833');
      expect(await approvalUploadReviewStatus.getAttribute('data-selected-boundary-candidate-ref')).toBe('candidate:1881-sheet-7-outline');
      const approvalUploadReviewStatusText = await approvalUploadReviewStatus.innerText();
      expect(approvalUploadReviewStatusText).toContain('selected_1881_context');
      expect(approvalUploadReviewStatusText).toContain('1881://proposal-cooperative/sheet-7');

      const approvalValidationDecisionSave = page.locator(`[data-sam31-approval-upload-validation-decision-save-evidence-id="${approvalUploadEvidenceId}"]`).first();
      await approvalValidationDecisionSave.waitFor({ state: 'attached' });
      expect(await approvalValidationDecisionSave.getAttribute('data-sam31-approval-upload-validation-target-gate-code')).toBe('PROFESSIONAL_REVIEW_MISSING');
      expect(await page.locator(`#sam31ApprovalValidationDecision-${approvalUploadEvidenceId}`).inputValue()).toBe('default_internal_alpha_placeholder_rejected');
      await approvalValidationDecisionSave.click();
      await page.waitForFunction((approvalUploadId) => {
        const status = document.getElementById(`sam31ApprovalValidationDecisionStatus-${approvalUploadId}`);
        return status?.dataset.sourceHalofireSam31ApprovalUploadEvidenceId === approvalUploadId
          && status?.dataset.validationDecision === 'default_internal_alpha_placeholder_rejected'
          && status?.dataset.claimGateEffect === 'no_claims_cleared'
          && status?.dataset.noClaimGatesCleared === 'true';
      }, approvalUploadEvidenceId);
      const approvalValidationDecisionStatus = page.locator(`#sam31ApprovalValidationDecisionStatus-${approvalUploadEvidenceId}`);
      const approvalValidationDecisionEvidenceId = String(await approvalValidationDecisionStatus.getAttribute('data-sam31-approval-upload-validation-decision-evidence-id') || '');
      expect(approvalValidationDecisionEvidenceId).toMatch(/^\d+$/);
      expect(await approvalValidationDecisionStatus.getAttribute('data-sam31-approval-upload-validation-target-gate-code')).toBe('PROFESSIONAL_REVIEW_MISSING');
      expect(await approvalValidationDecisionStatus.getAttribute('data-resolve-action-href')).toBe('');
      expect(await page.locator(`#evidence-${approvalValidationDecisionEvidenceId}`).innerText()).toContain('halofire.sam31_approval_upload_validation_decision.v1');
      expect(await page.locator(`#evidence-${approvalValidationDecisionEvidenceId}`).innerText()).toContain('default_internal_alpha_placeholder_rejected');
      await page.waitForFunction((decisionEvidenceId) => {
        const text = document.getElementById('resolverQueue')?.innerText || '';
        return text.includes(`latest_approval_upload_validation_decision evidence #${decisionEvidenceId}`)
          && text.includes('default_internal_alpha_placeholder_rejected')
          && text.includes('sam31_approval_validation_placeholder_no_claims');
      }, approvalValidationDecisionEvidenceId);
      const resolverQueueAfterValidationDecisionText = await page.locator('#resolverQueue').innerText();
      expect(resolverQueueAfterValidationDecisionText).toContain('gate_validation_status validation_decision_no_claims_cleared');
      expect(resolverQueueAfterValidationDecisionText).toContain('Gate resolve blocked until real_signed_evidence_validated validation decision');

      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-source-halofire-sam31-approval-upload-evidence-id')).toBe(String(approvalUploadEvidenceId));
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-downloaded-gate-validation-packet')).toBe('true');
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
    } finally {
      await page.close();
    }
  }, 30_000);
});
