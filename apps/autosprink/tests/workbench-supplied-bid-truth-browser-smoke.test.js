import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3232;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'supplied-bid-truth-browser-smoke-pw';
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-supplied-bid-truth-browser-smoke-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'supplied-bid-truth-browser-smoke-jwt-secret',
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

describe('Workbench supplied bid-truth browser smoke', () => {
  it('downloads the review packet and records a fail-closed employee replacement from the workbench', async () => {
    const token = await adminToken();
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(12000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);

    try {
      await page.goto(`${BASE}/official-flow.html`, { waitUntil: 'domcontentloaded' });
      await page.locator('#projectTarget').selectOption(PROJECT_NAME);
      await page.locator('#supplied-document-bid-truth').waitFor();
      await page.getByText('supplied_document_bid_truth - EMPLOYEE_REVIEW_NEEDED').waitFor();
      expect(await page.locator('#supplied-document-bid-truth').innerText()).toContain('Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx');

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('[data-supplied-document-bid-truth-packet]').click(),
      ]);
      const downloadPath = await download.path();
      expect(download.suggestedFilename()).toContain('supplied-bid-truth-employee-review-packet');
      expect(downloadPath).toBeTruthy();
      const packet = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));
      expect(packet).toEqual(expect.objectContaining({
        artifact_type: 'halofire.supplied_document_bid_truth_review_packet.v1',
        project_name: PROJECT_NAME,
        source_evidence_type: 'supplied_document_bid_truth',
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(packet.project_truth).toEqual(expect.objectContaining({
        source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
        square_feet: 170654,
        total_man_hours: 3301.5,
      }));

      await page.getByText('Record employee bid-truth replacement').click();
      await page.locator('#suppliedBidTruthReviewer').fill('HaloFire browser smoke reviewer');
      await page.locator('#suppliedBidTruthDecision').selectOption('replaced_temporary_values');
      await page.locator('#suppliedBidTruthReplacementRef').fill('1881://employee-bid-truth/browser-smoke-001');
      await page.locator('#suppliedBidTruthSourceFile').fill('employee-bid-truth-browser-smoke.json');
      await page.locator('#suppliedBidTruthSourceRefs').fill(JSON.stringify([
        'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        'employee://bid-truth/browser-smoke-001',
      ], null, 2));
      await page.locator('#suppliedBidTruthReplacementValues').fill(JSON.stringify({
        square_feet: 170654,
        total_man_hours: 3301.5,
        construction_days: 108,
        flow_data_available: false,
        notes: 'Browser-smoke replacement values for internal alpha only.',
      }, null, 2));
      await page.locator('#suppliedBidTruthNotes').fill('Browser smoke replacement; no claim gates cleared.');
      await page.locator('[data-supplied-document-bid-truth-save]').click();

      await page.waitForFunction(() => {
        const text = document.getElementById('suppliedBidTruthStatus')?.textContent || '';
        return text.includes('Saved supplied_document_bid_truth_replacement evidence #');
      });
      expect(await page.locator('#suppliedBidTruthStatus').innerText()).toContain('claims still blocked');

      await page.getByText('supplied_document_bid_truth - EMPLOYEE_REPLACEMENT_RECORDED').waitFor();
      const laneText = await page.locator('#supplied-document-bid-truth').innerText();
      expect(laneText).toContain('latest_supplied_document_bid_truth_replacement');
      expect(laneText).toContain('1881://employee-bid-truth/browser-smoke-001');
      expect(laneText).toContain('no_claims_cleared');

      const queue = await api(`${PROJECT_PATH}/resolver-queue`, token);
      const item = queue.items.find((row) => row.kind === 'supplied_document_bid_truth');
      expect(item).toEqual(expect.objectContaining({
        status: 'employee_replacement_recorded',
        claim_gate_effect: 'no_claims_cleared',
      }));
      expect(item.latest_supplied_document_bid_truth_replacement).toEqual(expect.objectContaining({
        replacement_ref: '1881://employee-bid-truth/browser-smoke-001',
        claim_gate_effect: 'no_claims_cleared',
      }));
      expect(queue.summary.supplied_document_bid_truth_review_needed).toBe(0);
      expect(queue.summary.supplied_document_bid_truth_replacements_recorded).toBe(1);
      expect(queue.summary.supplied_document_bid_truth_claims_cleared).toBe(0);

      const evidence = await api(`${PROJECT_PATH}/evidence`, token);
      const replacementRow = evidence.find((row) => (
        row.evidence_type === 'supplied_document_bid_truth_replacement'
        && row.source_ref === '1881://employee-bid-truth/browser-smoke-001'
      ));
      expect(replacementRow).toBeTruthy();
      expect(replacementRow.status).toBe('best_effort');
      expect(replacementRow.notes).toContain('no_claims_cleared');
    } finally {
      await page.close();
    }
  }, 45_000);

  it('shows supplied bid-truth downstream defaults on generated bid results and downloads the packet', async () => {
    const token = await adminToken();
    await api(`${PROJECT_PATH}/pdf-boundary-decision`, token, {
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
        source_ref: '1881 supplied bid-truth downstream browser smoke boundary decision',
        selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
        selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
        source_refs: [
          '1881://proposal-cooperative/sheet-7',
          '1881://operator-scale/sheet-7/0.0833',
          'candidate:1881-sheet-7-outline',
        ],
        notes: 'Boundary decision saved for supplied bid-truth downstream browser smoke.',
      }),
    });
    const replacement = await api(`${PROJECT_PATH}/resolver-packets/supplied-document-bid-truth/replacements`, token, {
      method: 'POST',
      body: JSON.stringify({
        reviewer_name: 'HaloFire browser smoke downstream reviewer',
        review_decision: 'replaced_temporary_values',
        replacement_ref: '1881://employee-bid-truth/downstream-browser-smoke-001',
        source_file: 'employee-bid-truth-downstream-browser-smoke.json',
        source_refs: [
          'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
          'employee://bid-truth/downstream-browser-smoke-001',
        ],
        replacement_values: {
          square_feet: 88000,
          head_count: 733,
          total_man_hours: 1775.5,
          construction_days: 41,
          flow_data_available: false,
        },
        notes: 'Downstream defaults browser smoke replacement.',
      }),
    });

    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(12000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);

    try {
      await page.goto(`${BASE}/official-flow.html`, { waitUntil: 'domcontentloaded' });
      await page.locator('#projectTarget').selectOption(PROJECT_NAME);
      await page.locator('#genBtn').click();
      await page.locator('#bidTruthDefaultsCard').waitFor();
      const cardText = await page.locator('#bidTruthDefaultsCard').innerText();
      expect(cardText).toContain('supplied bid-truth downstream defaults - employee_replacement_applied');
      expect(cardText).toContain('source_evidence_type supplied_document_bid_truth_replacement');
      expect(cardText).toContain(`source_supplied_document_bid_truth_replacement_evidence_id ${replacement.evidence.id}`);
      expect(cardText).toContain('Applied defaults: square_feet 88000');
      expect(cardText).toContain('head_count 733');
      expect(cardText).toContain('construction_days 41');
      expect(cardText).toContain('replacement_ref 1881://employee-bid-truth/downstream-browser-smoke-001');
      expect(cardText).toContain('source_file employee-bid-truth-downstream-browser-smoke.json');
      expect(cardText).toContain('source_refs');
      expect(cardText).toContain('Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6');
      expect(cardText).toContain('employee://bid-truth/downstream-browser-smoke-001');
      expect(cardText).toContain('claim_gate_effect no_claims_cleared');
      expect(cardText).toContain('Engine result: totalAreaSqFt 88000');

      let savedLayout = null;
      const started = Date.now();
      while (Date.now() - started < 8000) {
        const evidenceRows = await api(`${PROJECT_PATH}/evidence`, token);
        savedLayout = evidenceRows.find((row) => (
          row.evidence_type === 'best_effort_ai_layout'
          && row.notes.includes('1881://employee-bid-truth/downstream-browser-smoke-001')
        ));
        if (savedLayout) break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      expect(savedLayout).toBeTruthy();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('#projectTarget').selectOption(PROJECT_NAME);
      await page.locator(`#evidence-${savedLayout.id}`).waitFor({ state: 'attached' });
      const evidenceText = await page.locator(`#evidence-${savedLayout.id}`).innerText();
      expect(evidenceText).toContain('best_effort_ai_layout');
      expect(evidenceText).toContain('replacement_ref 1881://employee-bid-truth/downstream-browser-smoke-001');
      expect(evidenceText).toContain('source_file employee-bid-truth-downstream-browser-smoke.json');
      expect(evidenceText).toContain('Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6');
      expect(evidenceText).toContain('employee://bid-truth/downstream-browser-smoke-001');
      expect(evidenceText).toContain('selected_1881_context');
      expect(evidenceText).toContain('selected_sheet_ref 1881://proposal-cooperative/sheet-7');
      expect(evidenceText).toContain('selected_scale_ref 1881://operator-scale/sheet-7/0.0833');
      expect(evidenceText).toContain('selected_boundary_candidate_ref candidate:1881-sheet-7-outline');
      await page.locator('#genBtn').click();
      await page.locator('#bidTruthDefaultsCard').waitFor();

      const savedLayoutDownload = page.locator(`[data-replay-bid-artifact-evidence-id="${savedLayout.id}"]`).first();
      await savedLayoutDownload.waitFor({ state: 'attached' });
      const [savedLayoutArtifactDownload] = await Promise.all([
        page.waitForEvent('download'),
        savedLayoutDownload.click(),
      ]);
      const savedLayoutArtifactPath = await savedLayoutArtifactDownload.path();
      expect(savedLayoutArtifactDownload.suggestedFilename()).toContain('saved-layout-readback');
      expect(savedLayoutArtifactPath).toBeTruthy();
      const savedLayoutArtifact = JSON.parse(fs.readFileSync(savedLayoutArtifactPath, 'utf8'));
      expect(savedLayoutArtifact).toEqual(expect.objectContaining({
        artifact_type: 'halofire.best_effort_ai_layout.saved_readback_bundle.v1',
        source_artifact_type: 'halofire.best_effort_ai_layout.supplied_document_bid_truth_defaults.v1',
        project_name: PROJECT_NAME,
        evidence_id: savedLayout.id,
        source_evidence_type: 'supplied_document_bid_truth_replacement',
        source_supplied_document_bid_truth_replacement_evidence_id: replacement.evidence.id,
        replacement_ref: '1881://employee-bid-truth/downstream-browser-smoke-001',
        source_file: 'employee-bid-truth-downstream-browser-smoke.json',
        selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
        selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(savedLayoutArtifact.source_refs).toEqual([
        'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        'employee://bid-truth/downstream-browser-smoke-001',
      ]);
      expect(savedLayoutArtifact.employee_decision).toEqual(expect.objectContaining({
        selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
        selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
        claim_gate_effect: 'no_claims_cleared',
      }));
      expect(savedLayoutArtifact.project_truth).toEqual(expect.objectContaining({
        square_feet: 88000,
        head_count: 733,
        total_man_hours: 1775.5,
        construction_days: 41,
        source_status: 'employee_replacement_recorded',
      }));

      const savedLayoutHandoff = page.locator(`[data-replay-sam31-actual-value-handoff-evidence-id="${savedLayout.id}"]`).first();
      await savedLayoutHandoff.waitFor({ state: 'attached' });
      const [savedLayoutHandoffDownload] = await Promise.all([
        page.waitForEvent('download'),
        savedLayoutHandoff.click(),
      ]);
      const savedLayoutHandoffPath = await savedLayoutHandoffDownload.path();
      expect(savedLayoutHandoffDownload.suggestedFilename()).toContain('actual-value-handoff');
      expect(savedLayoutHandoffPath).toBeTruthy();
      const savedLayoutHandoffPacket = JSON.parse(fs.readFileSync(savedLayoutHandoffPath, 'utf8'));
      expect(savedLayoutHandoffPacket).toEqual(expect.objectContaining({
        artifact_type: 'openclaw.sam31.actual_value_handoff_packet.v1',
        source_replay_evidence_id: savedLayout.id,
        source_replay_artifact_type: 'halofire.best_effort_ai_layout.saved_readback_bundle.v1',
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(savedLayoutHandoffPacket.source_replay_packet).toEqual(expect.objectContaining({
        source_supplied_document_bid_truth_replacement_evidence_id: replacement.evidence.id,
        replacement_ref: '1881://employee-bid-truth/downstream-browser-smoke-001',
        source_file: 'employee-bid-truth-downstream-browser-smoke.json',
        selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
        selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
      }));
      expect(savedLayoutHandoffPacket.source_replay_packet.project_truth).toEqual(expect.objectContaining({
        square_feet: 88000,
        head_count: 733,
        total_man_hours: 1775.5,
        construction_days: 41,
        source_status: 'employee_replacement_recorded',
      }));
      expect(savedLayoutHandoffPacket.source_refs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          evidence_id: savedLayout.id,
          evidence_type: 'best_effort_ai_layout',
          artifact_type: 'halofire.best_effort_ai_layout.saved_readback_bundle.v1',
          claim_gate_effect: 'no_claims_cleared',
        }),
        'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        'employee://bid-truth/downstream-browser-smoke-001',
      ]));
      expect(savedLayoutHandoffPacket.source_refs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          evidence_type: 'halofire.pdf_boundary_employee_decision.v1',
          selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
          selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
          selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
          claim_gate_effect: 'no_claims_cleared',
        }),
      ]));

      const savedLayoutReplacement = page.locator(`[data-replay-sam31-actual-value-replacement-evidence-id="${savedLayout.id}"]`).first();
      await savedLayoutReplacement.waitFor({ state: 'attached' });
      await savedLayoutReplacement.click();
      await page.waitForFunction((layoutEvidenceId) => {
        const status = document.getElementById(`replaySam31ActualValueReplacementStatus-${layoutEvidenceId}`);
        return Boolean(status?.dataset.sam31ActualValueReplacementEvidenceId)
          && status?.dataset.sourceReplayEvidenceId === layoutEvidenceId
          && status?.dataset.claimGateEffect === 'no_claims_cleared';
      }, String(savedLayout.id));
      const savedLayoutReplacementEvidenceId = String(await page.locator(`#replaySam31ActualValueReplacementStatus-${savedLayout.id}`).getAttribute('data-sam31-actual-value-replacement-evidence-id') || '');
      expect(savedLayoutReplacementEvidenceId).toMatch(/^\d+$/);
      await page.locator(`#evidence-${savedLayoutReplacementEvidenceId}`).waitFor({ state: 'attached' });
      const savedLayoutReplacementText = await page.locator(`#evidence-${savedLayoutReplacementEvidenceId}`).innerText();
      expect(savedLayoutReplacementText).toContain('sam31_actual_value_replacement');
      expect(savedLayoutReplacementText).toContain(`source_replay_evidence_id ${savedLayout.id}`);
      expect(savedLayoutReplacementText).toContain(`source_supplied_document_bid_truth_replacement_evidence_id ${replacement.evidence.id}`);
      expect(savedLayoutReplacementText).toContain('employee://bid-truth/downstream-browser-smoke-001');
      expect(savedLayoutReplacementText).toContain('selected_1881_context');
      expect(savedLayoutReplacementText).toContain('selected_sheet_ref 1881://proposal-cooperative/sheet-7');
      expect(savedLayoutReplacementText).toContain('selected_scale_ref 1881://operator-scale/sheet-7/0.0833');
      expect(savedLayoutReplacementText).toContain('selected_boundary_candidate_ref candidate:1881-sheet-7-outline');
      expect(savedLayoutReplacementText).toContain('project_truth square_feet 88000');
      expect(savedLayoutReplacementText).toContain('source_status employee_replacement_recorded');
      expect(savedLayoutReplacementText).toContain('claim_gate_effect no_claims_cleared');

      const savedLayoutReplacementReadback = await api(`${PROJECT_PATH}/openclaw/sam31/actual-value-replacements/evidence`, token, {
        method: 'POST',
        body: JSON.stringify({
          consumer: 'halo_fire',
          sourceReplayEvidenceId: savedLayout.id,
        }),
      });
      expect(savedLayoutReplacementReadback).toEqual(expect.objectContaining({
        evidence_type: 'openclaw_sam31_actual_value_replacement_readback',
        source_replay_evidence_filter_id: savedLayout.id,
        source_replay_evidence_id: savedLayout.id,
        source_supplied_document_bid_truth_replacement_evidence_id: replacement.evidence.id,
        selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
        selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
        claim_gate_effect: 'no_claims_cleared',
      }));
      expect(savedLayoutReplacementReadback.project_truth).toEqual(expect.objectContaining({
        square_feet: 88000,
        head_count: 733,
        total_man_hours: 1775.5,
        construction_days: 41,
        source_status: 'employee_replacement_recorded',
      }));
      await page.goto(`${BASE}/official-flow.html`, { waitUntil: 'domcontentloaded' });
      await page.locator('#projectTarget').selectOption(PROJECT_NAME);
      await page.locator(`#evidence-${savedLayoutReplacementReadback.evidence_id}`).waitFor({ state: 'attached' });
      const savedLayoutReplacementReadbackText = await page.locator(`#evidence-${savedLayoutReplacementReadback.evidence_id}`).innerText();
      expect(savedLayoutReplacementReadbackText).toContain(`source_replay_evidence_filter_id ${savedLayout.id}`);
      expect(savedLayoutReplacementReadbackText).toContain(`source_supplied_document_bid_truth_replacement_evidence_id ${replacement.evidence.id}`);
      expect(savedLayoutReplacementReadbackText).toContain('selected_1881_context');
      expect(savedLayoutReplacementReadbackText).toContain('selected_sheet_ref 1881://proposal-cooperative/sheet-7');
      expect(savedLayoutReplacementReadbackText).toContain('selected_scale_ref 1881://operator-scale/sheet-7/0.0833');
      expect(savedLayoutReplacementReadbackText).toContain('selected_boundary_candidate_ref candidate:1881-sheet-7-outline');
      expect(savedLayoutReplacementReadbackText).toContain('project_truth square_feet 88000');
      const defaultReadbackReplacement = page.locator(`[data-sam31-actual-value-default-replacement-intake="${savedLayoutReplacementReadback.evidence_id}"]`).first();
      await defaultReadbackReplacement.waitFor({ state: 'attached' });
      await defaultReadbackReplacement.click();
      let defaultReadbackReplacementStatus = {};
      for (let attempt = 0; attempt < 24; attempt += 1) {
        defaultReadbackReplacementStatus = await page.locator('#sam31ActualValueQueueStatus').evaluate((status) => ({
          text: status.textContent,
          dataset: { ...status.dataset },
        }));
        if (
          defaultReadbackReplacementStatus.dataset.sourceOpenclawSam31ActualValueReplacementReadbackEvidenceId === String(savedLayoutReplacementReadback.evidence_id)
          && defaultReadbackReplacementStatus.dataset.sam31ActualValueReplacementEvidenceId
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      expect(defaultReadbackReplacementStatus.dataset).toEqual(expect.objectContaining({
        sourceOpenclawSam31ActualValueReplacementReadbackEvidenceId: String(savedLayoutReplacementReadback.evidence_id),
      }));
      expect(defaultReadbackReplacementStatus.dataset.sam31ActualValueReplacementEvidenceId).toMatch(/^\d+$/);
      const defaultReadbackReplacementEvidenceId = String(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-sam31-actual-value-replacement-evidence-id') || '');
      const defaultReadbackRows = await api(`${PROJECT_PATH}/evidence`, token);
      const defaultReadbackRow = defaultReadbackRows.find((row) => row.id === Number(defaultReadbackReplacementEvidenceId));
      expect(defaultReadbackRow).toBeTruthy();
      const defaultReadbackNotes = JSON.parse(defaultReadbackRow.notes);
      expect(defaultReadbackNotes).toEqual(expect.objectContaining({
        source_replay_evidence_id: savedLayout.id,
        source_openclaw_sam31_actual_value_replacement_readback_evidence_id: savedLayoutReplacementReadback.evidence_id,
        source_supplied_document_bid_truth_replacement_evidence_id: replacement.evidence.id,
        selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
        selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(defaultReadbackNotes.project_truth).toEqual(expect.objectContaining({
        square_feet: 88000,
        head_count: 733,
        total_man_hours: 1775.5,
        construction_days: 41,
        source_status: 'employee_replacement_recorded',
      }));
      expect(defaultReadbackNotes.actual_value_replacement_prefill.project_truth).toEqual(expect.objectContaining({
        square_feet: 88000,
        source_status: 'employee_replacement_recorded',
      }));
      expect(defaultReadbackNotes.source_refs).toEqual(expect.arrayContaining([
        'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        'employee://bid-truth/downstream-browser-smoke-001',
      ]));

      await page.locator(`#evidence-${defaultReadbackReplacementEvidenceId}`).waitFor({ state: 'attached' });
      const defaultReadbackSmokeButton = page.locator(`[data-readback-sam31-consumer-intake-smoke-source-replacement-evidence-id="${defaultReadbackReplacementEvidenceId}"]`).first();
      await defaultReadbackSmokeButton.waitFor({ state: 'attached' });
      expect(await defaultReadbackSmokeButton.getAttribute('data-source-openclaw-sam31-actual-value-replacement-readback-evidence-id')).toBe(String(savedLayoutReplacementReadback.evidence_id));
      expect(await defaultReadbackSmokeButton.getAttribute('data-source-replay-evidence-id')).toBe(String(savedLayout.id));
      expect(await defaultReadbackSmokeButton.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(defaultReadbackReplacementEvidenceId));
      await defaultReadbackSmokeButton.click();
      let defaultReadbackSmokeStatus = {};
      for (let attempt = 0; attempt < 20; attempt += 1) {
        defaultReadbackSmokeStatus = await page.locator('#sam31ActualValueQueueStatus').evaluate((status) => ({
          text: status.textContent,
          dataset: { ...status.dataset },
        }));
        if (
          defaultReadbackSmokeStatus.dataset.sourceSam31ActualValueReplacementEvidenceId === String(defaultReadbackReplacementEvidenceId)
          && defaultReadbackSmokeStatus.dataset.sourceOpenclawSam31ActualValueReplacementReadbackEvidenceId === String(savedLayoutReplacementReadback.evidence_id)
          && defaultReadbackSmokeStatus.dataset.sam31ConsumerIntakeSmokeEvidenceId
          && defaultReadbackSmokeStatus.dataset.claimGateEffect === 'no_claims_cleared'
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      expect(defaultReadbackSmokeStatus.dataset).toEqual(expect.objectContaining({
        sourceSam31ActualValueReplacementEvidenceId: String(defaultReadbackReplacementEvidenceId),
        sourceOpenclawSam31ActualValueReplacementReadbackEvidenceId: String(savedLayoutReplacementReadback.evidence_id),
        claimGateEffect: 'no_claims_cleared',
      }));
      expect(defaultReadbackSmokeStatus.dataset.sam31ConsumerIntakeSmokeEvidenceId).toMatch(/^\d+$/);
      const defaultReadbackSmokeEvidenceId = String(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-sam31-consumer-intake-smoke-evidence-id') || '');
      expect(defaultReadbackSmokeEvidenceId).toMatch(/^\d+$/);
      const defaultReadbackSmokeRows = await api(`${PROJECT_PATH}/evidence`, token);
      const defaultReadbackSmokeRow = defaultReadbackSmokeRows.find((row) => row.id === Number(defaultReadbackSmokeEvidenceId));
      expect(defaultReadbackSmokeRow).toBeTruthy();
      const defaultReadbackSmokeNotes = JSON.parse(defaultReadbackSmokeRow.notes);
      expect(defaultReadbackSmokeNotes).toEqual(expect.objectContaining({
        source_replay_evidence_id: savedLayout.id,
        source_sam31_actual_value_replacement_evidence_id: Number(defaultReadbackReplacementEvidenceId),
        source_openclaw_sam31_actual_value_replacement_readback_evidence_id: savedLayoutReplacementReadback.evidence_id,
        source_supplied_document_bid_truth_replacement_evidence_id: replacement.evidence.id,
        selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
        selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(defaultReadbackSmokeNotes.project_truth).toEqual(expect.objectContaining({
        square_feet: 88000,
        source_status: 'employee_replacement_recorded',
      }));

      const defaultReadbackDefaultFollowup = page.locator(`[data-replay-sam31-consumer-intake-smoke-default-followup-review="${defaultReadbackSmokeEvidenceId}"]`).first();
      await defaultReadbackDefaultFollowup.waitFor({ state: 'attached' });
      expect(await defaultReadbackDefaultFollowup.getAttribute('data-source-replay-evidence-id')).toBe(String(savedLayout.id));
      expect(await defaultReadbackDefaultFollowup.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(defaultReadbackReplacementEvidenceId));
      expect(await defaultReadbackDefaultFollowup.getAttribute('data-source-openclaw-sam31-actual-value-replacement-readback-evidence-id')).toBe(String(savedLayoutReplacementReadback.evidence_id));
      await defaultReadbackDefaultFollowup.click();
      await page.waitForFunction((smokeEvidenceId) => {
        const status = document.getElementById(`sam31ConsumerIntakeSmokeFollowupReview-${smokeEvidenceId}-status`);
        const nextAction = document.querySelector(`[data-replay-sam31-consumer-intake-smoke-default-sprinkler-review="${smokeEvidenceId}"]`);
        return status?.dataset.halofireSam31ConsumerIntakeSmokeFollowupReviewEvidenceId
          && nextAction
          && status?.dataset.downloadedSprinklerReviewPacket === 'true'
          && status?.dataset.sourceOpenclawSam31ActualValueReplacementReadbackEvidenceId
          && status?.dataset.claimGateEffect === 'no_claims_cleared';
      }, String(defaultReadbackSmokeEvidenceId));
      const defaultReadbackFollowupReviewEvidenceId = String(await page.locator(`#sam31ConsumerIntakeSmokeFollowupReview-${defaultReadbackSmokeEvidenceId}-status`).getAttribute('data-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id') || '');
      expect(defaultReadbackFollowupReviewEvidenceId).toMatch(/^\d+$/);
      expect(await page.locator(`#sam31ConsumerIntakeSmokeFollowupReview-${defaultReadbackSmokeEvidenceId}-status`).getAttribute('data-source-openclaw-sam31-actual-value-replacement-readback-evidence-id')).toBe(String(savedLayoutReplacementReadback.evidence_id));
      const defaultReadbackFollowupRows = await api(`${PROJECT_PATH}/evidence`, token);
      const defaultReadbackFollowupRow = defaultReadbackFollowupRows.find((row) => row.id === Number(defaultReadbackFollowupReviewEvidenceId));
      expect(defaultReadbackFollowupRow).toBeTruthy();
      const defaultReadbackFollowupNotes = JSON.parse(defaultReadbackFollowupRow.notes);
      expect(defaultReadbackFollowupNotes.review).toEqual(expect.objectContaining({
        source_replay_evidence_id: savedLayout.id,
        source_sam31_actual_value_replacement_evidence_id: Number(defaultReadbackReplacementEvidenceId),
        source_openclaw_sam31_actual_value_replacement_readback_evidence_id: savedLayoutReplacementReadback.evidence_id,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));

      const defaultReadbackDefaultSprinkler = page.locator(`[data-replay-sam31-consumer-intake-smoke-default-sprinkler-review="${defaultReadbackSmokeEvidenceId}"]`).first();
      await defaultReadbackDefaultSprinkler.waitFor({ state: 'attached' });
      expect(await defaultReadbackDefaultSprinkler.getAttribute('data-source-openclaw-sam31-actual-value-replacement-readback-evidence-id')).toBe(String(savedLayoutReplacementReadback.evidence_id));
      expect(await defaultReadbackDefaultSprinkler.getAttribute('data-source-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id')).toBe(defaultReadbackFollowupReviewEvidenceId);
      const [defaultReadbackReplayInputsDownload] = await Promise.all([
        page.waitForEvent('download'),
        defaultReadbackDefaultSprinkler.click(),
      ]);
      const defaultReadbackReplayInputsPath = await defaultReadbackReplayInputsDownload.path();
      expect(defaultReadbackReplayInputsDownload.suggestedFilename()).toContain('preliminary-replay-inputs');
      expect(defaultReadbackReplayInputsPath).toBeTruthy();
      const defaultReadbackReplayInputs = JSON.parse(fs.readFileSync(defaultReadbackReplayInputsPath, 'utf8'));
      expect(defaultReadbackReplayInputs).toEqual(expect.objectContaining({
        artifact_type: 'halofire.sam31_sprinkler_review_preliminary_replay_inputs.v1',
        source_section_to_artifacts_consumer_intake_smoke_evidence_id: Number(defaultReadbackSmokeEvidenceId),
        source_replay_evidence_id: savedLayout.id,
        source_sam31_actual_value_replacement_evidence_id: Number(defaultReadbackReplacementEvidenceId),
        source_openclaw_sam31_actual_value_replacement_readback_evidence_id: savedLayoutReplacementReadback.evidence_id,
        source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: Number(defaultReadbackFollowupReviewEvidenceId),
        source_supplied_document_bid_truth_replacement_evidence_id: replacement.evidence.id,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(defaultReadbackReplayInputs.project_truth).toEqual(expect.objectContaining({
        square_feet: 88000,
        source_status: 'employee_replacement_recorded',
      }));

      const defaultReadbackDefaultReplayFollowup = page.locator(`[data-replay-sam31-consumer-intake-smoke-default-preliminary-replay-followup="${defaultReadbackSmokeEvidenceId}"]`).first();
      await defaultReadbackDefaultReplayFollowup.waitFor({ state: 'attached' });
      expect(await defaultReadbackDefaultReplayFollowup.getAttribute('data-source-replay-evidence-id')).toBe(String(savedLayout.id));
      expect(await defaultReadbackDefaultReplayFollowup.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(defaultReadbackReplacementEvidenceId));
      expect(await defaultReadbackDefaultReplayFollowup.getAttribute('data-source-openclaw-sam31-actual-value-replacement-readback-evidence-id')).toBe(String(savedLayoutReplacementReadback.evidence_id));
      expect(await defaultReadbackDefaultReplayFollowup.getAttribute('data-source-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id')).toBe(defaultReadbackFollowupReviewEvidenceId);
      await defaultReadbackDefaultReplayFollowup.click();
      await page.waitForFunction((smokeEvidenceId) => {
        const status = document.getElementById(`sam31ConsumerIntakeSmokePreliminaryReplayFollowup-${smokeEvidenceId}-status`);
        return status?.dataset.halofireSam31PreliminaryReplayFollowupEvidenceId
          && status?.dataset.downloadedPreliminaryReplayArtifact === 'true'
          && status?.dataset.sourceOpenclawSam31ActualValueReplacementReadbackEvidenceId
          && status?.dataset.claimGateEffect === 'no_claims_cleared';
      }, String(defaultReadbackSmokeEvidenceId));
      const defaultReadbackReplayFollowupEvidenceId = String(await page.locator(`#sam31ConsumerIntakeSmokePreliminaryReplayFollowup-${defaultReadbackSmokeEvidenceId}-status`).getAttribute('data-halofire-sam31-preliminary-replay-followup-evidence-id') || '');
      expect(defaultReadbackReplayFollowupEvidenceId).toMatch(/^\d+$/);
      expect(await page.locator(`#sam31ConsumerIntakeSmokePreliminaryReplayFollowup-${defaultReadbackSmokeEvidenceId}-status`).getAttribute('data-source-openclaw-sam31-actual-value-replacement-readback-evidence-id')).toBe(String(savedLayoutReplacementReadback.evidence_id));
      const defaultReadbackReplayFollowupRows = await api(`${PROJECT_PATH}/evidence`, token);
      const defaultReadbackReplayFollowupRow = defaultReadbackReplayFollowupRows.find((row) => row.id === Number(defaultReadbackReplayFollowupEvidenceId));
      expect(defaultReadbackReplayFollowupRow).toBeTruthy();
      const defaultReadbackReplayFollowupNotes = JSON.parse(defaultReadbackReplayFollowupRow.notes);
      expect(defaultReadbackReplayFollowupNotes.followup).toEqual(expect.objectContaining({
        source_replay_evidence_id: savedLayout.id,
        source_sam31_actual_value_replacement_evidence_id: Number(defaultReadbackReplacementEvidenceId),
        source_openclaw_sam31_actual_value_replacement_readback_evidence_id: savedLayoutReplacementReadback.evidence_id,
        source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: Number(defaultReadbackFollowupReviewEvidenceId),
        source_halofire_sam31_sprinkler_review_decision_evidence_id: Number(await page.locator(`#sam31ConsumerIntakeSmokePreliminaryReplayFollowup-${defaultReadbackSmokeEvidenceId}-status`).getAttribute('data-source-halofire-sam31-sprinkler-review-decision-evidence-id') || 0),
        source_supplied_document_bid_truth_replacement_evidence_id: replacement.evidence.id,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(defaultReadbackReplayFollowupNotes.followup.project_truth).toEqual(expect.objectContaining({
        square_feet: 88000,
        source_status: 'employee_replacement_recorded',
      }));

      const savedLayoutSmokeButton = page.locator(`[data-replay-sam31-consumer-intake-smoke-source-replacement-evidence-id="${savedLayoutReplacementEvidenceId}"]`).first();
      await savedLayoutSmokeButton.waitFor({ state: 'attached' });
      expect(await savedLayoutSmokeButton.getAttribute('data-source-replay-evidence-id')).toBe(String(savedLayout.id));
      expect(await savedLayoutSmokeButton.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(savedLayoutReplacementEvidenceId));
      await savedLayoutSmokeButton.click();
      await page.waitForFunction((replacementEvidenceId) => {
        const status = document.getElementById('sam31ActualValueQueueStatus');
        return status?.dataset.sourceSam31ActualValueReplacementEvidenceId === replacementEvidenceId
          && Boolean(status?.dataset.sam31ConsumerIntakeSmokeEvidenceId)
          && status?.dataset.claimGateEffect === 'no_claims_cleared';
      }, String(savedLayoutReplacementEvidenceId));
      const savedLayoutSmokeEvidenceId = String(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-sam31-consumer-intake-smoke-evidence-id') || '');
      expect(savedLayoutSmokeEvidenceId).toMatch(/^\d+$/);
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-source-replay-evidence-id')).toBe(String(savedLayout.id));
      await page.locator(`#evidence-${savedLayoutSmokeEvidenceId}`).waitFor({ state: 'attached' });
      const savedLayoutSmokeText = await page.locator(`#evidence-${savedLayoutSmokeEvidenceId}`).innerText();
      expect(savedLayoutSmokeText).toContain('openclaw_sam31_section_to_artifacts_consumer_intake_smoke');
      expect(savedLayoutSmokeText).toContain(`source_replay_evidence_id ${savedLayout.id}`);
      expect(savedLayoutSmokeText).toContain(`source_sam31_actual_value_replacement_evidence_id ${savedLayoutReplacementEvidenceId}`);
      expect(savedLayoutSmokeText).toContain('selected_1881_context');
      const savedLayoutSmokeRows = await api(`${PROJECT_PATH}/evidence`, token);
      const savedLayoutSmokeRow = savedLayoutSmokeRows.find((row) => row.id === Number(savedLayoutSmokeEvidenceId));
      expect(savedLayoutSmokeRow).toBeTruthy();
      const savedLayoutSmokeNotes = JSON.parse(savedLayoutSmokeRow.notes);
      expect(savedLayoutSmokeNotes).toEqual(expect.objectContaining({
        source_replay_evidence_id: savedLayout.id,
        source_sam31_actual_value_replacement_evidence_id: Number(savedLayoutReplacementEvidenceId),
        source_supplied_document_bid_truth_replacement_evidence_id: replacement.evidence.id,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(savedLayoutSmokeNotes.source_refs).toEqual(expect.arrayContaining([
        'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        'employee://bid-truth/downstream-browser-smoke-001',
      ]));
      expect(savedLayoutSmokeNotes.project_truth).toEqual(expect.objectContaining({
        square_feet: 88000,
        head_count: 733,
        total_man_hours: 1775.5,
        construction_days: 41,
        source_status: 'employee_replacement_recorded',
      }));

      const savedLayoutDefaultFollowup = page.locator(`[data-replay-sam31-consumer-intake-smoke-default-followup-review="${savedLayoutSmokeEvidenceId}"]`).first();
      await savedLayoutDefaultFollowup.waitFor({ state: 'attached' });
      expect(await savedLayoutDefaultFollowup.getAttribute('data-source-replay-evidence-id')).toBe(String(savedLayout.id));
      expect(await savedLayoutDefaultFollowup.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(savedLayoutReplacementEvidenceId));
      await savedLayoutDefaultFollowup.click();
      await page.waitForFunction((smokeEvidenceId) => {
        const status = document.getElementById(`sam31ConsumerIntakeSmokeFollowupReview-${smokeEvidenceId}-status`);
        const nextAction = document.querySelector(`[data-replay-sam31-consumer-intake-smoke-default-sprinkler-review="${smokeEvidenceId}"]`);
        return status?.dataset.halofireSam31ConsumerIntakeSmokeFollowupReviewEvidenceId
          && nextAction
          && status?.dataset.downloadedSprinklerReviewPacket === 'true'
          && status?.dataset.claimGateEffect === 'no_claims_cleared';
      }, String(savedLayoutSmokeEvidenceId));
      const savedLayoutFollowupReviewEvidenceId = String(await page.locator(`#sam31ConsumerIntakeSmokeFollowupReview-${savedLayoutSmokeEvidenceId}-status`).getAttribute('data-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id') || '');
      expect(savedLayoutFollowupReviewEvidenceId).toMatch(/^\d+$/);

      const savedLayoutDefaultSprinkler = page.locator(`[data-replay-sam31-consumer-intake-smoke-default-sprinkler-review="${savedLayoutSmokeEvidenceId}"]`).first();
      await savedLayoutDefaultSprinkler.waitFor({ state: 'attached' });
      expect(await savedLayoutDefaultSprinkler.getAttribute('data-source-replay-evidence-id')).toBe(String(savedLayout.id));
      expect(await savedLayoutDefaultSprinkler.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(savedLayoutReplacementEvidenceId));
      expect(await savedLayoutDefaultSprinkler.getAttribute('data-source-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id')).toBe(String(savedLayoutFollowupReviewEvidenceId));
      const [savedLayoutReplayInputsDownload] = await Promise.all([
        page.waitForEvent('download'),
        savedLayoutDefaultSprinkler.click(),
      ]);
      const savedLayoutReplayInputsPath = await savedLayoutReplayInputsDownload.path();
      expect(savedLayoutReplayInputsDownload.suggestedFilename()).toContain('preliminary-replay-inputs');
      expect(savedLayoutReplayInputsPath).toBeTruthy();
      const savedLayoutReplayInputs = JSON.parse(fs.readFileSync(savedLayoutReplayInputsPath, 'utf8'));
      expect(savedLayoutReplayInputs).toEqual(expect.objectContaining({
        artifact_type: 'halofire.sam31_sprinkler_review_preliminary_replay_inputs.v1',
        source_section_to_artifacts_consumer_intake_smoke_evidence_id: Number(savedLayoutSmokeEvidenceId),
        source_replay_evidence_id: savedLayout.id,
        source_sam31_actual_value_replacement_evidence_id: Number(savedLayoutReplacementEvidenceId),
        source_halofire_sam31_consumer_intake_smoke_followup_review_evidence_id: Number(savedLayoutFollowupReviewEvidenceId),
        source_supplied_document_bid_truth_replacement_evidence_id: replacement.evidence.id,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(savedLayoutReplayInputs.source_refs).toEqual(expect.arrayContaining([
        'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        'employee://bid-truth/downstream-browser-smoke-001',
      ]));

      const savedLayoutDefaultReplayFollowup = page.locator(`[data-replay-sam31-consumer-intake-smoke-default-preliminary-replay-followup="${savedLayoutSmokeEvidenceId}"]`).first();
      await savedLayoutDefaultReplayFollowup.waitFor({ state: 'attached' });
      expect(await savedLayoutDefaultReplayFollowup.getAttribute('data-source-replay-evidence-id')).toBe(String(savedLayout.id));
      expect(await savedLayoutDefaultReplayFollowup.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(savedLayoutReplacementEvidenceId));
      expect(await savedLayoutDefaultReplayFollowup.getAttribute('data-source-halofire-sam31-consumer-intake-smoke-followup-review-evidence-id')).toBe(String(savedLayoutFollowupReviewEvidenceId));
      await savedLayoutDefaultReplayFollowup.click();
      await page.waitForFunction((smokeEvidenceId) => {
        const status = document.getElementById(`sam31ConsumerIntakeSmokePreliminaryReplayFollowup-${smokeEvidenceId}-status`);
        return status?.dataset.halofireSam31PreliminaryReplayFollowupEvidenceId
          && status?.dataset.downloadedPreliminaryReplayArtifact === 'true'
          && status?.dataset.claimGateEffect === 'no_claims_cleared';
      }, String(savedLayoutSmokeEvidenceId));
      const savedLayoutReplayFollowupEvidenceId = String(await page.locator(`#sam31ConsumerIntakeSmokePreliminaryReplayFollowup-${savedLayoutSmokeEvidenceId}-status`).getAttribute('data-halofire-sam31-preliminary-replay-followup-evidence-id') || '');
      expect(savedLayoutReplayFollowupEvidenceId).toMatch(/^\d+$/);
      const replayFollowupRows = await api(`${PROJECT_PATH}/evidence`, token);
      const savedLayoutReplayFollowupRow = replayFollowupRows.find((row) => row.id === Number(savedLayoutReplayFollowupEvidenceId));
      expect(savedLayoutReplayFollowupRow).toBeTruthy();
      const savedLayoutReplayFollowupNotes = JSON.parse(savedLayoutReplayFollowupRow.notes);
      expect(savedLayoutReplayFollowupNotes.followup).toEqual(expect.objectContaining({
        source_replay_evidence_id: savedLayout.id,
        source_sam31_actual_value_replacement_evidence_id: Number(savedLayoutReplacementEvidenceId),
        source_supplied_document_bid_truth_replacement_evidence_id: replacement.evidence.id,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(savedLayoutReplayFollowupNotes.followup.project_truth).toEqual(expect.objectContaining({
        square_feet: 88000,
        head_count: 733,
        total_man_hours: 1775.5,
        construction_days: 41,
        source_status: 'employee_replacement_recorded',
      }));

      const savedLayoutDefaultPacketReview = page.locator(`[data-replay-sam31-consumer-intake-smoke-default-packet-review="${savedLayoutSmokeEvidenceId}"]`).first();
      await savedLayoutDefaultPacketReview.waitFor({ state: 'attached' });
      expect(await savedLayoutDefaultPacketReview.getAttribute('data-source-halofire-sam31-preliminary-replay-followup-evidence-id')).toBe(savedLayoutReplayFollowupEvidenceId);
      await savedLayoutDefaultPacketReview.click();
      await page.waitForFunction((smokeEvidenceId) => {
        const status = document.getElementById(`sam31ConsumerIntakeSmokeReplayFollowupPacketReview-${smokeEvidenceId}-status`);
        return status?.dataset.halofireSam31FollowupPacketReviewEvidenceId
          && status?.dataset.downloadedReplayFollowupPacket === 'true'
          && status?.dataset.reviewedReplayFollowupPacket === 'true'
          && status?.dataset.claimGateEffect === 'no_claims_cleared';
      }, String(savedLayoutSmokeEvidenceId));
      const savedLayoutPacketReviewEvidenceId = String(await page.locator(`#sam31ConsumerIntakeSmokeReplayFollowupPacketReview-${savedLayoutSmokeEvidenceId}-status`).getAttribute('data-halofire-sam31-followup-packet-review-evidence-id') || '');
      expect(savedLayoutPacketReviewEvidenceId).toMatch(/^\d+$/);
      const packetReviewRows = await api(`${PROJECT_PATH}/evidence`, token);
      const savedLayoutPacketReviewRow = packetReviewRows.find((row) => row.id === Number(savedLayoutPacketReviewEvidenceId));
      expect(savedLayoutPacketReviewRow).toBeTruthy();
      const savedLayoutPacketReviewNotes = JSON.parse(savedLayoutPacketReviewRow.notes);
      expect(savedLayoutPacketReviewNotes.review).toEqual(expect.objectContaining({
        source_replay_evidence_id: savedLayout.id,
        source_sam31_actual_value_replacement_evidence_id: Number(savedLayoutReplacementEvidenceId),
        source_supplied_document_bid_truth_replacement_evidence_id: replacement.evidence.id,
        source_followup_decision_evidence_id: Number(savedLayoutReplayFollowupEvidenceId),
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(savedLayoutPacketReviewNotes.review.project_truth).toEqual(expect.objectContaining({
        square_feet: 88000,
        head_count: 733,
        total_man_hours: 1775.5,
        construction_days: 41,
        source_status: 'employee_replacement_recorded',
      }));

      const savedLayoutDefaultApprovalUpload = page.locator(`[data-replay-sam31-consumer-intake-smoke-default-approval-upload="${savedLayoutPacketReviewEvidenceId}"]`).first();
      await savedLayoutDefaultApprovalUpload.waitFor({ state: 'attached' });
      expect(await savedLayoutDefaultApprovalUpload.getAttribute('data-source-replay-evidence-id')).toBe(String(savedLayout.id));
      expect(await savedLayoutDefaultApprovalUpload.getAttribute('data-source-sam31-actual-value-replacement-evidence-id')).toBe(String(savedLayoutReplacementEvidenceId));
      expect(await savedLayoutDefaultApprovalUpload.getAttribute('data-source-halofire-sam31-followup-packet-review-evidence-id')).toBe(savedLayoutPacketReviewEvidenceId);
      await savedLayoutDefaultApprovalUpload.click();
      await page.waitForFunction((packetReviewEvidenceId) => {
        const status = document.getElementById(`sam31ApprovalUploadDefaultStatus-${packetReviewEvidenceId}`);
        return status?.dataset.sam31ApprovalUploadEvidenceId
          && status?.dataset.downloadedGateValidationPacket === 'true'
          && status?.dataset.claimGateEffect === 'no_claims_cleared';
      }, String(savedLayoutPacketReviewEvidenceId));
      const savedLayoutApprovalUploadEvidenceId = String(await page.locator(`#sam31ApprovalUploadDefaultStatus-${savedLayoutPacketReviewEvidenceId}`).getAttribute('data-sam31-approval-upload-evidence-id') || '');
      expect(savedLayoutApprovalUploadEvidenceId).toMatch(/^\d+$/);
      const approvalUploadRows = await api(`${PROJECT_PATH}/evidence`, token);
      const savedLayoutApprovalUploadRow = approvalUploadRows.find((row) => row.id === Number(savedLayoutApprovalUploadEvidenceId));
      expect(savedLayoutApprovalUploadRow).toBeTruthy();
      const savedLayoutApprovalUploadNotes = JSON.parse(savedLayoutApprovalUploadRow.notes);
      expect(savedLayoutApprovalUploadNotes.intake).toEqual(expect.objectContaining({
        source_replay_evidence_id: savedLayout.id,
        source_sam31_actual_value_replacement_evidence_id: Number(savedLayoutReplacementEvidenceId),
        source_supplied_document_bid_truth_replacement_evidence_id: replacement.evidence.id,
        source_packet_review_decision_evidence_id: Number(savedLayoutPacketReviewEvidenceId),
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(savedLayoutApprovalUploadNotes.intake.project_truth).toEqual(expect.objectContaining({
        square_feet: 88000,
        head_count: 733,
        total_man_hours: 1775.5,
        construction_days: 41,
        source_status: 'employee_replacement_recorded',
      }));

      await page.locator('#genBtn').click();
      await page.locator('#bidTruthDefaultsCard').waitFor();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('[data-supplied-bid-truth-downstream-download]').click(),
      ]);
      const downloadPath = await download.path();
      expect(download.suggestedFilename()).toContain('supplied-bid-truth-downstream-defaults');
      expect(downloadPath).toBeTruthy();
      const packet = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));
      expect(packet).toEqual(expect.objectContaining({
        artifact_type: 'halofire.supplied_document_bid_truth_downstream_defaults_packet.v1',
        project_name: PROJECT_NAME,
        source_evidence_type: 'supplied_document_bid_truth_replacement',
        source_replacement_evidence_id: replacement.evidence.id,
        source_supplied_document_bid_truth_replacement_evidence_id: replacement.evidence.id,
        replacement_ref: '1881://employee-bid-truth/downstream-browser-smoke-001',
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(packet.project_truth).toEqual(expect.objectContaining({
        square_feet: 88000,
        head_count: 733,
        total_man_hours: 1775.5,
        construction_days: 41,
        source_status: 'employee_replacement_recorded',
      }));

      await page.locator('[data-supplied-document-bid-truth-focus-replacement]').click();
      expect(await page.locator('#suppliedBidTruthReplacementRef').inputValue()).toBe(
        '1881://employee-bid-truth/downstream-browser-smoke-001',
      );
      expect(await page.locator('#suppliedBidTruthSourceFile').inputValue()).toBe(
        'employee-bid-truth-downstream-browser-smoke.json',
      );
      expect(JSON.parse(await page.locator('#suppliedBidTruthSourceRefs').inputValue())).toEqual([
        'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        'employee://bid-truth/downstream-browser-smoke-001',
      ]);
      expect(JSON.parse(await page.locator('#suppliedBidTruthReplacementValues').inputValue())).toEqual({
        square_feet: 88000,
        head_count: 733,
        total_man_hours: 1775.5,
        construction_days: 41,
        flow_data_available: false,
      });
    } finally {
      await page.close();
    }
  }, 90_000);

  it('re-saves downstream defaults follow-up edits and keeps the card and queue synchronized', async () => {
    const token = await adminToken();
    const replacement = await api(`${PROJECT_PATH}/resolver-packets/supplied-document-bid-truth/replacements`, token, {
      method: 'POST',
      body: JSON.stringify({
        reviewer_name: 'HaloFire browser smoke sync reviewer',
        review_decision: 'replaced_temporary_values',
        replacement_ref: '1881://employee-bid-truth/downstream-sync-browser-smoke-001',
        source_file: 'employee-bid-truth-downstream-sync-browser-smoke.json',
        source_refs: [
          'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
          'employee://bid-truth/downstream-sync-browser-smoke-001',
        ],
        replacement_values: {
          square_feet: 88000,
          head_count: 733,
          total_man_hours: 1775.5,
          construction_days: 41,
          flow_data_available: false,
        },
        notes: 'Downstream sync browser smoke replacement.',
      }),
    });

    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(12000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);

    try {
      await page.goto(`${BASE}/official-flow.html`, { waitUntil: 'domcontentloaded' });
      await page.locator('#projectTarget').selectOption(PROJECT_NAME);
      await page.locator('#genBtn').click();
      await page.locator('#bidTruthDefaultsCard').waitFor();
      expect(await page.locator('#bidTruthDefaultsCard').innerText()).toContain(
        `source_supplied_document_bid_truth_replacement_evidence_id ${replacement.evidence.id}`,
      );

      await page.locator('[data-supplied-document-bid-truth-focus-replacement]').click();
      await page.locator('#suppliedBidTruthReviewer').fill('HaloFire browser smoke sync reviewer updated');
      await page.locator('#suppliedBidTruthReplacementRef').fill('1881://employee-bid-truth/downstream-sync-browser-smoke-002');
      await page.locator('#suppliedBidTruthSourceFile').fill('employee-bid-truth-downstream-sync-browser-smoke-updated.json');
      await page.locator('#suppliedBidTruthSourceRefs').fill(JSON.stringify([
        'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        'employee://bid-truth/downstream-sync-browser-smoke-002',
      ], null, 2));
      await page.locator('#suppliedBidTruthReplacementValues').fill(JSON.stringify({
        square_feet: 91001,
        head_count: 744,
        total_man_hours: 1888.25,
        construction_days: 47,
        flow_data_available: false,
      }, null, 2));
      await page.locator('#suppliedBidTruthNotes').fill('Updated downstream sync browser smoke replacement; no claim gates cleared.');
      await page.locator('[data-supplied-document-bid-truth-save]').click();

      await page.waitForFunction(() => {
        const text = document.getElementById('bidTruthDefaultsCard')?.textContent || '';
        return text.includes('Applied defaults: square_feet 91001')
          && text.includes('head_count 744')
          && text.includes('construction_days 47')
          && text.includes('Engine result: totalAreaSqFt 91001');
      });

      const cardText = await page.locator('#bidTruthDefaultsCard').innerText();
      expect(cardText).toContain('Applied defaults: square_feet 91001');
      expect(cardText).toContain('head_count 744');
      expect(cardText).toContain('total_man_hours 1888.25');
      expect(cardText).toContain('construction_days 47');
      expect(cardText).toContain('replacement_ref 1881://employee-bid-truth/downstream-sync-browser-smoke-002');
      expect(cardText).toContain('source_file employee-bid-truth-downstream-sync-browser-smoke-updated.json');
      expect(cardText).toContain('Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6');
      expect(cardText).toContain('employee://bid-truth/downstream-sync-browser-smoke-002');
      expect(cardText).toContain('Engine result: totalAreaSqFt 91001');

      const queue = await api(`${PROJECT_PATH}/resolver-queue`, token);
      const item = queue.items.find((row) => row.kind === 'supplied_document_bid_truth');
      expect(item).toEqual(expect.objectContaining({
        status: 'employee_replacement_recorded',
        claim_gate_effect: 'no_claims_cleared',
      }));
      expect(item.latest_supplied_document_bid_truth_replacement).toEqual(expect.objectContaining({
        replacement_ref: '1881://employee-bid-truth/downstream-sync-browser-smoke-002',
        claim_gate_effect: 'no_claims_cleared',
      }));
      expect(item.latest_supplied_document_bid_truth_replacement?.source_file).toBe(
        'employee-bid-truth-downstream-sync-browser-smoke-updated.json',
      );

      const evidence = await api(`${PROJECT_PATH}/evidence`, token);
      const replacementRows = evidence.filter((row) => row.evidence_type === 'supplied_document_bid_truth_replacement');
      expect(replacementRows.length).toBeGreaterThanOrEqual(2);
      const latestRow = replacementRows.find((row) => row.source_ref === '1881://employee-bid-truth/downstream-sync-browser-smoke-002');
      expect(latestRow).toBeTruthy();
      expect(latestRow.status).toBe('best_effort');
    } finally {
      await page.close();
    }
  }, 30_000);
});
