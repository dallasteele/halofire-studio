import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3234;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'catalog-source-browser-smoke-pw';
const PROJECT_NAME = 'Home Depot - Rexburg ID';
const PROJECT_PATH = `/api/projects/${encodeURIComponent(PROJECT_NAME)}`;
const FAMILY_REF = 'family:pipe_steel_sch40_2p0in';

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-catalog-source-browser-smoke-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'catalog-source-browser-smoke-jwt-secret-more-than-32-chars',
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

describe('Workbench catalog source browser smoke', () => {
  it('records catalog source evidence with source-linked no-claims-cleared readback', async () => {
    const token = await adminToken();
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(`${BASE}/workbench.html?project=${encodeURIComponent(PROJECT_NAME)}#catalogSourceAcquisition`, {
        waitUntil: 'domcontentloaded',
      });
      const recordButton = page.locator(`[data-catalog-source-record-family-ref="${FAMILY_REF}"]`).first();
      await recordButton.waitFor();
      const statusId = await recordButton.getAttribute('data-catalog-source-record-status-id');
      await recordButton.click();

      const status = page.locator(`[id="${statusId}"]`);
      await page.waitForFunction(
        (targetStatusId) => {
          const node = document.getElementById(targetStatusId);
          return node?.dataset.catalogSourceEvidenceId && node?.textContent?.includes('claim gates still blocked');
        },
        statusId,
      );

      const evidenceId = await status.getAttribute('data-catalog-source-evidence-id');
      expect(evidenceId).toMatch(/^\d+$/);
      expect(await status.getAttribute('data-catalog-source-family-ref')).toBe(FAMILY_REF);
      expect(await status.getAttribute('data-catalog-source-component-key')).toBe('pipe_sch40');
      expect(await status.getAttribute('data-claim-gate-effect')).toBe('no_claims_cleared');
      expect(await status.getAttribute('data-no-claim-gates-cleared')).toBe('true');
      expect(await status.innerText()).toContain(`Recorded catalog_source_acquisition evidence #${evidenceId}`);
      expect(await status.innerText()).toContain('claim gates still blocked');

      const evidenceRows = await api(`${PROJECT_PATH}/evidence`, token);
      const saved = evidenceRows.find((row) => String(row.id) === evidenceId);
      expect(saved).toEqual(expect.objectContaining({
        evidence_type: 'catalog_source_acquisition',
        source_ref: FAMILY_REF,
        source_file: 'pipe_sch40',
        status: 'present',
      }));
      const notes = JSON.parse(saved.notes);
      expect(notes).toEqual(expect.objectContaining({
        kind: 'sourceAcquisitionLedger',
        schema: 'halofire.catalog_source_acquisition_ledger_row.v1',
        family_ref: FAMILY_REF,
        component_key: 'pipe_sch40',
        nominal_size_in: 2,
        status_tier: 'missing_catalog_source',
        manufacturer_exact: false,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
        recorded_from: 'workbench.catalog_vendor_acquisition',
      }));
      expect(notes.blocked_claims).toEqual(expect.arrayContaining([
        'manufacturer_exact',
        'AutoSprink_parity',
        'fabrication_ready',
        'permit_ready',
        'AHJ_approval',
        'PE_review',
      ]));

      const gates = await api(`${PROJECT_PATH}/claim-gates`, token);
      expect(gates.find((gate) => gate.code === 'MANUFACTURER_MODEL_APPROVAL_MISSING')).toEqual(
        expect.objectContaining({ status: 'blocked' }),
      );
      expect(gates.find((gate) => gate.code === 'AUTOSPRINK_EVIDENCE_MISSING')).toEqual(
        expect.objectContaining({ status: 'blocked' }),
      );
    } finally {
      await page.close();
    }
  }, 30_000);

  it('validates signed catalog approval evidence with explicit target-gate readback only', async () => {
    const token = await adminToken();
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(`${BASE}/workbench.html?project=${encodeURIComponent(PROJECT_NAME)}#catalogSourceAcquisition`, {
        waitUntil: 'domcontentloaded',
      });
      const approvalButton = page.locator(`[data-catalog-source-approval-family-ref="${FAMILY_REF}"]`).first();
      await approvalButton.waitFor({ state: 'attached' });
      await approvalButton.evaluate((button) => {
        const details = button.closest('details');
        if (details) details.open = true;
      });
      const rowKey = await approvalButton.getAttribute('data-catalog-source-approval-row-key');
      const statusId = `catalogApprovalValidationStatus-${rowKey}`;
      const sourceRef = 'manufacturer://catalog-source-browser-smoke/pipe-sch40-2in/signed-model-approval';
      await page.locator(`[id="catalogApprovalSourceRef-${rowKey}"]`).fill(sourceRef);
      await page.locator(`[id="catalogApprovalSourceFile-${rowKey}"]`).fill('catalog-source-browser-smoke-manufacturer-approval.pdf');
      await page.locator(`[id="catalogApprovalReviewerName-${rowKey}"]`).fill('Codex Catalog Approval Smoke');
      await page.locator(`[id="catalogApprovalReviewerTitle-${rowKey}"]`).fill('Manufacturer Technical Reviewer');
      await page.locator(`[id="catalogApprovalSignedAt-${rowKey}"]`).fill('2026-06-05T05:45:00.000Z');
      await page.locator(`[id="catalogApprovalOrganization-${rowKey}"]`).fill('Halo Fire');
      await page.locator(`[id="catalogApprovalLicenseId-${rowKey}"]`).fill('MFG-CATALOG-SMOKE-001');
      await page.locator(`[id="catalogApprovalNotes-${rowKey}"]`).fill('Browser smoke signed manufacturer approval. Explicit target-gate validation only.');
      await approvalButton.click();

      const status = page.locator(`[id="${statusId}"]`);
      await page.waitForFunction(
        (targetStatusId) => {
          const node = document.getElementById(targetStatusId);
          return node?.dataset.catalogApprovalValidationEvidenceId
            && node?.dataset.claimGateEffect === 'gate_cleared_after_explicit_signed_validation';
        },
        statusId,
      );

      const evidenceId = await status.getAttribute('data-catalog-approval-validation-evidence-id');
      expect(evidenceId).toMatch(/^\d+$/);
      expect(await status.getAttribute('data-catalog-approval-validation-family-ref')).toBe(FAMILY_REF);
      expect(await status.getAttribute('data-catalog-approval-validation-gate-code')).toBe('MANUFACTURER_MODEL_APPROVAL_MISSING');
      expect(await status.getAttribute('data-catalog-approval-validation-source-ref')).toBe(sourceRef);
      expect(await status.getAttribute('data-claim-gate-effect')).toBe('gate_cleared_after_explicit_signed_validation');
      expect(await status.getAttribute('data-no-unrelated-claim-gates-cleared')).toBe('true');
      expect(await status.innerText()).toContain(`Validated catalog approval gate MANUFACTURER_MODEL_APPROVAL_MISSING with evidence #${evidenceId}`);
      expect(await status.innerText()).toContain('unrelated claim gates still blocked');

      const evidenceRows = await api(`${PROJECT_PATH}/evidence`, token);
      const saved = evidenceRows.find((row) => String(row.id) === evidenceId);
      expect(saved).toEqual(expect.objectContaining({
        evidence_type: 'manufacturer_approval',
        source_ref: sourceRef,
        source_file: 'catalog-source-browser-smoke-manufacturer-approval.pdf',
        status: 'present',
      }));
      const notes = JSON.parse(saved.notes);
      expect(notes).toEqual(expect.objectContaining({
        kind: 'catalog_source_approval_validation',
        family_ref: FAMILY_REF,
        component_key: 'pipe_sch40',
        approval_ref_field: 'manufacturer_model_approval_ref',
        target_gate_code: 'MANUFACTURER_MODEL_APPROVAL_MISSING',
        source_ref: sourceRef,
        claim_gate_effect: 'gate_cleared_after_explicit_signed_validation',
      }));
      expect(notes.signoff).toEqual(expect.objectContaining({
        reviewer_name: 'Codex Catalog Approval Smoke',
        reviewer_title: 'Manufacturer Technical Reviewer',
        license_id: 'MFG-CATALOG-SMOKE-001',
      }));

      const gates = await api(`${PROJECT_PATH}/claim-gates`, token);
      expect(gates.find((gate) => gate.code === 'MANUFACTURER_MODEL_APPROVAL_MISSING')).toEqual(
        expect.objectContaining({ status: 'cleared' }),
      );
      expect(gates.find((gate) => gate.code === 'AUTOSPRINK_EVIDENCE_MISSING')).toEqual(
        expect.objectContaining({ status: 'blocked' }),
      );
      expect(gates.find((gate) => gate.code === 'AHJ_APPROVAL_MISSING')).toEqual(
        expect.objectContaining({ status: 'blocked' }),
      );
    } finally {
      await page.close();
    }
  }, 30_000);
});
