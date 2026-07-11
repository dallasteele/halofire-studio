import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3229;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'settings-browser-smoke-pw';
const PROJECT_NAME = 'Home Depot - Rexburg ID';
const PROJECT_PATH = `/api/projects/${encodeURIComponent(PROJECT_NAME)}`;

let server;
let serverExited = false;
let tempDir;
let browser;

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    // Fail fast if our spawned server died (e.g. EADDRINUSE from a stale
    // orphaned server.js still squatting on the port). Without this check a
    // stale listener answers /api/health and silently poisons every test
    // with its old code + old DB, producing misleading locator timeouts.
    if (serverExited) {
      throw new Error(`spawned server exited early — is a stale process already listening on port ${PORT}?`);
    }
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-settings-browser-smoke-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'settings-browser-smoke-jwt-secret-more-than-32-chars',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: PASSWORD,
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverExited = false;
  server.once('exit', () => { serverExited = true; });
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

describe('Settings signed reviewer browser smoke', () => {
  it('opens the blocked claim-gate workflow from Workbench and keeps resolve-audit fail-closed', async () => {
    const token = await adminToken();
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);
    try {
      await page.goto(`${BASE}/official-flow.html`, { waitUntil: 'domcontentloaded' });
      const blockedGateButton = page.locator('[data-claim-gate-signed-reviewer-workflow="PROFESSIONAL_REVIEW_MISSING"]').first();
      await blockedGateButton.waitFor();
      await blockedGateButton.click();
      await page.waitForURL(/settings\.html\?/);
      await page.locator('#wizGate').waitFor();
      await page.waitForFunction(
        (gateCode) => document.getElementById('wizGate')?.value === gateCode,
        'PROFESSIONAL_REVIEW_MISSING',
      );
      expect(await page.locator('#wizGate').inputValue()).toBe('PROFESSIONAL_REVIEW_MISSING');
      expect(await page.locator('#wizExistingEvidence').inputValue()).toBe('');
      await page.waitForFunction(() => {
        const text = document.getElementById('wizPacketStatus')?.textContent || '';
        return text.includes('available after explicit gate resolve');
      });
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('available after explicit gate resolve');
      expect(await page.locator('#wizResolveAudit').isDisabled()).toBe(true);

      await page.locator('#wizReviewPacket').click();
      await page.waitForFunction(() => {
        const text = document.getElementById('wizPacketStatus')?.textContent || '';
        return text.includes('Downloaded halofire.claim_gate_review_packet.v1');
      });
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('claim_gate_effect no_claims_cleared');
      expect(await page.locator('#wizResolveAudit').isDisabled()).toBe(true);
    } finally {
      await page.close();
    }
  }, 30_000);

  it('opens from Workbench and proves prefilled packet downloads stay source-linked', async () => {
    const token = await adminToken();
    const resolveResult = await api(`${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/resolve`, token, {
      method: 'POST',
      body: JSON.stringify({
        evidence: {
          evidence_type: 'professional_review',
          source_ref: 'Signed reviewer packet browser-smoke PR-1881-100',
          source_file: 'browser-smoke-professional-review.pdf',
          status: 'present',
          notes: 'Browser smoke signed reviewer packet.',
          signoff: {
            reviewer_name: 'Casey Morgan',
            reviewer_title: 'Fire Protection Engineer',
            signed_at: '2026-06-03T21:00:00.000Z',
            organization: 'Halo Fire',
            license_id: 'PE-BROWSER-100',
          },
        },
      }),
    });
    const recorded = { id: resolveResult.resolved_evidence_id };

    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);
    try {
      await page.goto(`${BASE}/official-flow.html`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Signed reviewer packet browser-smoke PR-1881-100').waitFor();
      const savedRow = page.locator(`#evidence-${recorded.id}`).first();
      await savedRow.waitFor();
      await savedRow.locator(`[data-signed-reviewer-workflow-evidence-id="${recorded.id}"]`).first().click();
      await page.waitForURL(/settings\.html\?/);
      await page.locator('#wizExistingEvidence').waitFor();
      await page.waitForFunction(
        (evidenceId) => document.getElementById('wizExistingEvidence')?.value === evidenceId,
        String(recorded.id),
      );
      expect(await page.locator('#wizExistingEvidence').inputValue()).toBe(String(recorded.id));
      expect(await page.locator('#wizPacketStatus').innerText()).toContain(`Read-only accepted signed reviewer evidence #${recorded.id}`);
      expect(await page.locator('#wizPacketStatus').getAttribute('data-signed-reviewer-prefill-evidence-id')).toBe(String(recorded.id));
      expect(await page.locator('#wizPacketStatus').getAttribute('data-signed-reviewer-prefill-gate')).toBe('PROFESSIONAL_REVIEW_MISSING');
      expect(await page.locator('#wizPacketStatus').getAttribute('data-signed-reviewer-review-packet-href')).toBe(
        `${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/review-packet`,
      );
      expect(await page.locator('#wizPacketStatus').getAttribute('data-signed-reviewer-resolve-audit-href')).toBe(
        `${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/resolve-audit-packet`,
      );

      await page.locator('#wizReviewPacket').click();
      await page.waitForFunction(() => document.getElementById('wizPacketStatus')?.textContent?.includes('Downloaded halofire.claim_gate_review_packet.v1'));
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('claim_gate_effect no_claims_cleared');

      await page.locator('#wizResolveAudit').click();
      await page.waitForFunction(() => document.getElementById('wizPacketStatus')?.textContent?.includes('Downloaded halofire.claim_gate_resolve_audit_packet.v1'));
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('gate_cleared_after_explicit_signed_validation');
    } finally {
      await page.close();
    }
  }, 30_000);

  it('persists generic blocked-gate Settings prefill after resolving signed evidence from Workbench', async () => {
    const token = await adminToken();
    const projectName = `Settings Generic Prefill ${Date.now()}`;
    const projectPath = `/api/projects/${encodeURIComponent(projectName)}`;
    const gateCode = 'PROFESSIONAL_REVIEW_MISSING';
    const sourceRef = 'pe-review://settings-browser-smoke/generic-prefill-persist';

    await api(`${projectPath}/claim-gates`, token);

    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);

    try {
      await page.goto(`${BASE}/official-flow.html?project=${encodeURIComponent(projectName)}`, { waitUntil: 'domcontentloaded' });
      const blockedGateButton = page.locator(`[data-claim-gate-signed-reviewer-workflow="${gateCode}"]`).first();
      await blockedGateButton.waitFor();
      await blockedGateButton.click();

      await page.waitForURL((url) => url.pathname === '/settings.html' && url.hash === '#wizSignoff');
      await page.locator('#wizGate').waitFor();
      await page.waitForFunction(
        (expectedGate) => document.getElementById('wizGate')?.value === expectedGate,
        gateCode,
      );
      const preSubmitHref = new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash;
      expect(preSubmitHref).toContain(`gate=${gateCode}`);
      expect(preSubmitHref).not.toContain('uploadPacketHref=');

      await page.locator('#wizSourceRef').fill(sourceRef);
      await page.locator('#wizSourceFile').fill('generic-prefill-persist-professional-review.pdf');
      await page.locator('#wizReviewerName').fill('Generic Prefill Resolver');
      await page.locator('#wizReviewerTitle').fill('Licensed PE');
      await page.locator('#wizSignedAt').fill('2026-06-05T12:10');
      await page.locator('#wizOrganization').fill('Halo Fire');
      await page.locator('#wizLicenseId').fill('PE-GENERIC-PREFILL-001');
      await page.locator('#wizAction').selectOption('resolve');
      await page.locator('#wizSubmit').click();
      await page.waitForFunction(() => document.getElementById('wizMsg')?.textContent?.includes('gate resolved with accepted evidence'));

      const evidenceRows = await api(`${projectPath}/evidence`, token);
      const saved = evidenceRows.find((row) => row.evidence_type === 'professional_review'
        && row.source_ref === sourceRef);
      expect(saved).toBeTruthy();
      const savedNotes = JSON.parse(saved.notes);
      expect(savedNotes.kind).toBe('signed_reviewer_evidence');
      expect(savedNotes.claim_gate_effect).toBe('gate_cleared_after_explicit_signed_validation');
      expect(savedNotes.settings_prefill_href).toBe(preSubmitHref);

      await page.goto(`${BASE}/official-flow.html?project=${encodeURIComponent(projectName)}#evidence-${saved.id}`, {
        waitUntil: 'domcontentloaded',
      });
      const savedRow = page.locator(`#evidence-${saved.id}`).first();
      await savedRow.waitFor();
      expect(await savedRow.innerText()).toContain('settings_prefill_href');
      expect(await savedRow.innerText()).toContain('Open accepted evidence read-only');
      const inspectHref = await savedRow.locator('[data-signed-reviewer-workflow-href]').getAttribute('data-signed-reviewer-workflow-href');
      expect(inspectHref).toContain(`gate=${gateCode}`);
      expect(inspectHref).toContain(`evidenceId=${saved.id}`);
      expect(inspectHref).toContain('action=inspect');

      await savedRow.locator('[data-signed-reviewer-workflow-evidence-id]').first().click();
      await page.waitForURL((url) => url.pathname === '/settings.html' && url.hash === '#wizSignoff');
      await page.waitForFunction(
        (expectedGate) => document.getElementById('wizGate')?.value === expectedGate,
        gateCode,
      );
      expect(page.url()).toContain(`gate=${gateCode}`);
      expect(page.url()).not.toContain('uploadPacketHref=');
      expect(await page.locator('#wizGate').inputValue()).toBe(gateCode);
      expect(await page.locator('#wizPacketStatus').innerText()).toContain(`Read-only accepted signed reviewer evidence #${saved.id}`);
    } finally {
      await page.close();
    }
  }, 30_000);

  it('persists generic blocked-gate Settings prefill after record-only signed evidence from Workbench', async () => {
    const token = await adminToken();
    const projectName = `Settings Record Only Prefill ${Date.now()}`;
    const projectPath = `/api/projects/${encodeURIComponent(projectName)}`;
    const gateCode = 'AHJ_APPROVAL_MISSING';
    const targetEvidenceType = 'ahj_approval';
    const sourceRef = 'ahj://settings-browser-smoke/record-only-prefill-persist';

    await api(`${projectPath}/claim-gates`, token);

    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);

    try {
      await page.goto(`${BASE}/official-flow.html?project=${encodeURIComponent(projectName)}`, { waitUntil: 'domcontentloaded' });
      const blockedGateButton = page.locator(`[data-claim-gate-signed-reviewer-workflow="${gateCode}"]`).first();
      await blockedGateButton.waitFor();
      await blockedGateButton.click();

      await page.waitForURL((url) => url.pathname === '/settings.html' && url.hash === '#wizSignoff');
      await page.locator('#wizGate').waitFor();
      await page.waitForFunction(
        (expectedGate) => document.getElementById('wizGate')?.value === expectedGate,
        gateCode,
      );
      const preSubmitHref = new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash;
      expect(preSubmitHref).toContain(`gate=${gateCode}`);
      expect(preSubmitHref).not.toContain('uploadPacketHref=');
      expect(preSubmitHref).not.toContain('evidenceId=');

      await page.locator('#wizSourceRef').fill(sourceRef);
      await page.locator('#wizSourceFile').fill('generic-prefill-persist-ahj-record-only.pdf');
      await page.locator('#wizReviewerName').fill('Record Only Prefill Reviewer');
      await page.locator('#wizReviewerTitle').fill('Fire Marshal');
      await page.locator('#wizSignedAt').fill('2026-06-05T12:40');
      await page.locator('#wizOrganization').fill('Halo Fire');
      await page.locator('#wizLicenseId').fill('AHJ-GENERIC-PREFILL-001');
      await page.locator('#wizAction').selectOption('record');
      await page.locator('#wizSubmit').click();
      await page.waitForFunction(() => document.getElementById('wizMsg')?.textContent?.includes('evidence recorded only'));

      const evidenceRows = await api(`${projectPath}/evidence`, token);
      const saved = evidenceRows.find((row) => row.evidence_type === targetEvidenceType
        && row.source_ref === sourceRef);
      expect(saved).toBeTruthy();
      const savedNotes = JSON.parse(saved.notes);
      expect(savedNotes.kind).toBe('signed_reviewer_evidence');
      expect(savedNotes.target_gate_code).toBe(gateCode);
      expect(savedNotes.claim_gate_effect).toBe('no_claims_cleared');
      expect(savedNotes.settings_prefill_href).toBe(preSubmitHref);

      const gates = await api(`${projectPath}/claim-gates`, token);
      expect(gates.find((gate) => gate.code === gateCode).status).toBe('blocked');

      await page.goto(`${BASE}/official-flow.html?project=${encodeURIComponent(projectName)}#evidence-${saved.id}`, {
        waitUntil: 'domcontentloaded',
      });
      const savedRow = page.locator(`#evidence-${saved.id}`).first();
      await savedRow.waitFor();
      expect(await savedRow.innerText()).toContain('settings_prefill_href');
      expect(await savedRow.innerText()).toContain('Open recorded evidence read-only');
      expect(await savedRow.innerText()).toContain('claim_gate_effect no_claims_cleared');
      const inspectHref = await savedRow.locator('[data-signed-reviewer-workflow-href]').getAttribute('data-signed-reviewer-workflow-href');
      expect(inspectHref).toContain(`gate=${gateCode}`);
      expect(inspectHref).toContain(`evidenceId=${saved.id}`);
      expect(inspectHref).toContain('action=inspect');
      expect(inspectHref).not.toContain('uploadPacketHref=');

      await page.reload({ waitUntil: 'domcontentloaded' });
      const savedRowAfterRefresh = page.locator(`#evidence-${saved.id}`).first();
      await savedRowAfterRefresh.waitFor();
      expect(await savedRowAfterRefresh.innerText()).toContain('Open recorded evidence read-only');
      await savedRowAfterRefresh.locator('[data-signed-reviewer-workflow-evidence-id]').first().click();
      await page.waitForURL((url) => url.pathname === '/settings.html' && url.hash === '#wizSignoff');
      await page.waitForFunction(
        (expectedGate) => document.getElementById('wizGate')?.value === expectedGate,
        gateCode,
      );
      expect(page.url()).toContain(`evidenceId=${saved.id}`);
      expect(page.url()).toContain('action=inspect');
      expect(page.url()).not.toContain('uploadPacketHref=');
      expect(await page.locator('#wizGate').inputValue()).toBe(gateCode);
      expect(await page.locator('#wizType').inputValue()).toBe(targetEvidenceType);
      expect(await page.locator('#wizSourceRef').inputValue()).toBe(sourceRef);
      expect(await page.locator('#wizPacketStatus').innerText()).toContain(`Read-only recorded signed reviewer evidence #${saved.id}`);
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('claim_gate_effect no_claims_cleared');
      expect(await page.locator('#wizSubmit').isDisabled()).toBe(true);
      expect(await page.locator('#wizResolveAudit').isDisabled()).toBe(true);
    } finally {
      await page.close();
    }
  }, 30_000);

  it('persists generic manufacturer signed-reviewer resolve prefill from Workbench after refresh', async () => {
    const token = await adminToken();
    const projectName = `Settings Manufacturer Prefill ${Date.now()}`;
    const projectPath = `/api/projects/${encodeURIComponent(projectName)}`;
    const gateCode = 'MANUFACTURER_MODEL_APPROVAL_MISSING';
    const targetEvidenceType = 'manufacturer_approval';
    const sourceRef = 'manufacturer://settings-browser-smoke/generic-prefill-persist';

    await api(`${projectPath}/claim-gates`, token);

    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);

    try {
      await page.goto(`${BASE}/official-flow.html?project=${encodeURIComponent(projectName)}`, { waitUntil: 'domcontentloaded' });
      const blockedGateButton = page.locator(`[data-claim-gate-signed-reviewer-workflow="${gateCode}"]`).first();
      await blockedGateButton.waitFor();
      await blockedGateButton.click();

      await page.waitForURL((url) => url.pathname === '/settings.html' && url.hash === '#wizSignoff');
      await page.locator('#wizGate').waitFor();
      await page.waitForFunction(
        (expectedGate) => document.getElementById('wizGate')?.value === expectedGate,
        gateCode,
      );
      const preSubmitHref = new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash;
      expect(preSubmitHref).toContain(`gate=${gateCode}`);
      expect(preSubmitHref).not.toContain('uploadPacketHref=');

      await page.locator('#wizSourceRef').fill(sourceRef);
      await page.locator('#wizSourceFile').fill('generic-prefill-persist-manufacturer-approval.pdf');
      await page.locator('#wizReviewerName').fill('Manufacturer Prefill Resolver');
      await page.locator('#wizReviewerTitle').fill('Manufacturer Approval Reviewer');
      await page.locator('#wizSignedAt').fill('2026-06-05T13:05');
      await page.locator('#wizOrganization').fill('Halo Fire');
      await page.locator('#wizLicenseId').fill('MFG-GENERIC-PREFILL-001');
      await page.locator('#wizAction').selectOption('resolve');
      await page.locator('#wizSubmit').click();
      await page.waitForFunction(() => document.getElementById('wizMsg')?.textContent?.includes('gate resolved with accepted evidence'));

      const evidenceRows = await api(`${projectPath}/evidence`, token);
      const saved = evidenceRows.find((row) => row.evidence_type === targetEvidenceType
        && row.source_ref === sourceRef);
      expect(saved).toBeTruthy();
      const savedNotes = JSON.parse(saved.notes);
      expect(savedNotes.kind).toBe('signed_reviewer_evidence');
      expect(savedNotes.target_gate_code).toBe(gateCode);
      expect(savedNotes.required_evidence_type).toBe(targetEvidenceType);
      expect(savedNotes.claim_gate_effect).toBe('gate_cleared_after_explicit_signed_validation');
      expect(savedNotes.settings_prefill_href).toBe(preSubmitHref);

      const gates = await api(`${projectPath}/claim-gates`, token);
      expect(gates.find((gate) => gate.code === gateCode).status).toBe('cleared');

      await page.goto(`${BASE}/official-flow.html?project=${encodeURIComponent(projectName)}#evidence-${saved.id}`, {
        waitUntil: 'domcontentloaded',
      });
      const savedRow = page.locator(`#evidence-${saved.id}`).first();
      await savedRow.waitFor();
      expect(await savedRow.innerText()).toContain('settings_prefill_href');
      expect(await savedRow.innerText()).toContain('Open accepted evidence read-only');
      expect(await savedRow.innerText()).toContain('claim_gate_effect gate_cleared_after_explicit_signed_validation');
      const inspectHref = await savedRow.locator('[data-signed-reviewer-workflow-href]').getAttribute('data-signed-reviewer-workflow-href');
      expect(inspectHref).toContain(`gate=${gateCode}`);
      expect(inspectHref).toContain(`evidenceId=${saved.id}`);
      expect(inspectHref).toContain('action=inspect');
      expect(inspectHref).not.toContain('uploadPacketHref=');

      await page.reload({ waitUntil: 'domcontentloaded' });
      const savedRowAfterRefresh = page.locator(`#evidence-${saved.id}`).first();
      await savedRowAfterRefresh.waitFor();
      expect(await savedRowAfterRefresh.innerText()).toContain('Open accepted evidence read-only');
      await savedRowAfterRefresh.locator('[data-signed-reviewer-workflow-evidence-id]').first().click();
      await page.waitForURL((url) => url.pathname === '/settings.html' && url.hash === '#wizSignoff');
      await page.waitForFunction(
        (expectedGate) => document.getElementById('wizGate')?.value === expectedGate,
        gateCode,
      );
      expect(page.url()).toContain(`evidenceId=${saved.id}`);
      expect(page.url()).toContain('action=inspect');
      expect(page.url()).not.toContain('uploadPacketHref=');
      expect(await page.locator('#wizGate').inputValue()).toBe(gateCode);
      expect(await page.locator('#wizType').inputValue()).toBe(targetEvidenceType);
      expect(await page.locator('#wizSourceRef').inputValue()).toBe(sourceRef);
      expect(await page.locator('#wizPacketStatus').innerText()).toContain(`Read-only accepted signed reviewer evidence #${saved.id}`);
      expect(await page.locator('#wizSubmit').isDisabled()).toBe(true);
      expect(await page.locator('#wizResolveAudit').isDisabled()).toBe(false);
    } finally {
      await page.close();
    }
  }, 30_000);

  it('prefills record-only signed evidence from official-flow review decision context', async () => {
    const token = await adminToken();
    const targetGateCode = 'AUTOSPRINK_EVIDENCE_MISSING';
    const targetEvidenceType = 'autosprink_packet';
    const targetSourceRef = 'autosprink://settings-browser-smoke/pending';
    const contextNotes = {
      kind: 'official_flow_professional_ahj_review_decision',
      artifact_type: 'halofire.official_flow_professional_ahj_review_decision.v1',
      source_replay_evidence_id: 4900,
      professional_review_ref: 'pe-review://settings-browser-smoke/pending',
      ahj_review_ref: 'ahj://settings-browser-smoke/pending',
      autosprink_export_ref: 'autosprink://settings-browser-smoke/pending',
      source_refs: [
        {
          evidence_type: 'official_flow_hydraulic_replay_artifact',
          evidence_id: 4900,
          source_ref: 'official-flow-replay:settings-browser-smoke',
        },
      ],
      decision: {
        source_replay_evidence_id: 4900,
        professional_review_ref: 'pe-review://settings-browser-smoke/pending',
        ahj_review_ref: 'ahj://settings-browser-smoke/pending',
        autosprink_export_ref: 'autosprink://settings-browser-smoke/pending',
        claim_gate_effect: 'no_claims_cleared',
      },
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
      claims_cleared_count: 0,
    };
    const context = await api(`${PROJECT_PATH}/evidence`, token, {
      method: 'POST',
      body: JSON.stringify({
        evidence_type: 'official_flow_professional_ahj_review_decision',
        source_ref: 'official-flow-review-decision:settings-browser-smoke',
        source_file: 'settings-browser-smoke-official-flow-review.json',
        status: 'fail_closed_review_recorded',
        notes: JSON.stringify(contextNotes),
      }),
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);

    try {
      await page.goto(
        `${BASE}/settings.html?project=${encodeURIComponent(PROJECT_NAME)}&gate=${targetGateCode}&evidenceId=${context.id}#wizSignoff`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.locator('#wizGate').waitFor();
      await page.waitForFunction(
        (evidenceId) => document.getElementById('wizPacketStatus')?.dataset.officialFlowContextEvidenceId === evidenceId,
        String(context.id),
      );

      expect(await page.locator('#wizGate').inputValue()).toBe(targetGateCode);
      expect(await page.locator('#wizType').inputValue()).toBe(targetEvidenceType);
      expect(await page.locator('#wizExistingEvidence').inputValue()).toBe('');
      expect(await page.locator('#wizAction').inputValue()).toBe('record');
      expect(await page.locator('#wizSourceRef').inputValue()).toBe(targetSourceRef);
      expect(await page.locator('#wizPacketStatus').innerText()).toContain(
        `Prefilled from official-flow review decision evidence #${context.id}`,
      );
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('no claims cleared');
      expect(await page.locator('#wizPacketStatus').getAttribute('data-official-flow-context-evidence-id')).toBe(String(context.id));
      expect(await page.locator('#wizNotes').inputValue()).toContain(`source_official_flow_review_decision_evidence_id ${context.id}`);
      expect(await page.locator('#wizNotes').inputValue()).toContain('source_replay_evidence_id 4900');
      expect(await page.locator('#wizNotes').inputValue()).toContain('claim_gate_effect no_claims_cleared');
      expect(await page.locator('#wizResolveAudit').isDisabled()).toBe(true);

      await page.locator('#wizReviewerName').fill('Codex Settings Smoke');
      await page.locator('#wizReviewerTitle').fill('Fire Protection Engineer');
      await page.locator('#wizSignedAt').fill('2026-06-04T20:30');
      await page.locator('#wizOrganization').fill('Halo Fire');
      await page.locator('#wizLicenseId').fill('PE-CODEX-SETTING-SMOKE');
      await page.locator('#wizSubmit').click();
      await page.waitForFunction(() => document.getElementById('wizMsg')?.textContent?.includes('evidence recorded only'));

      const evidenceRows = await api(`${PROJECT_PATH}/evidence`, token);
      const saved = evidenceRows.find((row) => row.evidence_type === targetEvidenceType
        && row.source_ref === targetSourceRef);
      expect(saved).toBeTruthy();
      const savedNotes = JSON.parse(saved.notes);
      expect(savedNotes.kind).toBe('signed_reviewer_evidence');
      expect(savedNotes.target_gate_code).toBe(targetGateCode);
      expect(savedNotes.required_evidence_type).toBe(targetEvidenceType);
      expect(savedNotes.claim_gate_effect).toBe('no_claims_cleared');
      expect(savedNotes.user_notes).toContain(`source_official_flow_review_decision_evidence_id ${context.id}`);
      expect(savedNotes.signoff).toEqual(expect.objectContaining({
        reviewer_name: 'Codex Settings Smoke',
        reviewer_title: 'Fire Protection Engineer',
        license_id: 'PE-CODEX-SETTING-SMOKE',
      }));

      const gates = await api(`${PROJECT_PATH}/claim-gates`, token);
      const targetGate = gates.find((gate) => gate.code === targetGateCode);
      expect(targetGate.status).toBe('blocked');
    } finally {
      await page.close();
    }
  }, 30_000);

  it('prefills signed reviewer fields from an official-flow signed-evidence upload packet href', async () => {
    const token = await adminToken();
    const projectName = `Settings Upload Packet ${Date.now()}`;
    const targetGateCode = 'AHJ_APPROVAL_MISSING';
    const targetEvidenceType = 'ahj_approval';
    const targetSourceRef = 'ahj://settings-upload-packet/pending';
    const intake = await api(`/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/intake`, token, {
      method: 'POST',
      body: JSON.stringify({
        staticPsi: 72,
        residualPsi: 60,
        flowingGpm: 930,
        flowDataDate: '2026-06-05',
        waterModelRequired: 'Settings upload packet smoke values for internal-alpha replay only.',
        source_file: 'settings-upload-packet-official-flow.pdf',
        source_ref: 'settings-upload-packet-official-flow.pdf#page=1',
        notes: 'Settings upload packet smoke; no regulated claims cleared.',
      }),
    });
    const replay = await api(`/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/${intake.id}/replay-artifact`, token, {
      method: 'POST',
      body: JSON.stringify({
        floorPlan: {
          name: projectName,
          units: 'ft',
          rooms: [
            {
              id: 'settings-upload-packet-room-1',
              name: 'Settings Upload Packet Room',
              polygon: [[0, 0], [40, 0], [40, 30], [0, 30]],
              ceilingHeightFt: 12,
              hazard: 'ordinary',
            },
          ],
        },
      }),
    });
    const decision = await api(`/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow-replay/${replay.id}/review-decision`, token, {
      method: 'POST',
      body: JSON.stringify({
        reviewer_name: 'Settings Upload Packet Reviewer',
        reviewer_title: 'Internal Alpha Reviewer',
        professional_review_ref: 'pe-review://settings-upload-packet/pending',
        ahj_review_ref: targetSourceRef,
        autosprink_export_ref: 'autosprink://settings-upload-packet/pending',
        manufacturer_model_approval_ref: 'manufacturer://settings-upload-packet/pending',
        review_decision: 'recorded_evidence_refs_fail_closed',
        notes: 'Settings upload packet decision; no claim gates cleared here.',
      }),
    });
    const uploadPacketHref = `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow-review-decision/${decision.id}/signed-evidence-upload-packet?targetGate=${targetGateCode}&evidenceType=${targetEvidenceType}`;
    const uploadPacket = await api(uploadPacketHref, token);
    expect(uploadPacket.settings_prefill_href).toContain('uploadPacketHref=');

    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);

    try {
      await page.goto(
        `${BASE}/settings.html?project=${encodeURIComponent(projectName)}&gate=${targetGateCode}&evidenceId=${decision.id}&action=resolve&uploadPacketHref=${encodeURIComponent(uploadPacketHref)}#wizSignoff`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.locator('#wizGate').waitFor();
      await page.waitForFunction(
        (packetHref) => document.getElementById('wizPacketStatus')?.dataset.officialFlowUploadPacketHref === packetHref,
        uploadPacketHref,
      );

      expect(await page.locator('#wizGate').inputValue()).toBe(targetGateCode);
      expect(await page.locator('#wizType').inputValue()).toBe(targetEvidenceType);
      expect(await page.locator('#wizExistingEvidence').inputValue()).toBe('');
      expect(await page.locator('#wizAction').inputValue()).toBe('resolve');
      expect(await page.locator('#wizSourceRef').inputValue()).toBe(targetSourceRef);
      expect(await page.locator('#wizSourceFile').inputValue()).toBe('settings-upload-packet-official-flow.pdf');
      expect(await page.locator('#wizNotes').inputValue()).toContain(`source_official_flow_review_decision_evidence_id ${decision.id}`);
      expect(await page.locator('#wizNotes').inputValue()).toContain(`source_replay_evidence_id ${replay.id}`);
      expect(await page.locator('#wizNotes').inputValue()).toContain('claim_gate_effect requires_real_signed_evidence');
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('Prefilled from halofire.official_flow_signed_evidence_upload_packet.v1');
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('requires_real_signed_evidence');
      expect(await page.locator('#wizPacketStatus').getAttribute('data-official-flow-upload-packet-artifact-type')).toBe('halofire.official_flow_signed_evidence_upload_packet.v1');
      expect(await page.locator('#wizPacketStatus').getAttribute('data-official-flow-upload-packet-claim-gate-effect')).toBe('requires_real_signed_evidence');
      expect(await page.locator('#wizPacketStatus').getAttribute('data-official-flow-upload-packet-no-claim-gates-cleared')).toBe('true');
      expect(await page.locator('#wizResolveAudit').isDisabled()).toBe(true);

      await page.locator('#wizReviewerName').fill('Settings Upload Packet Resolver');
      await page.locator('#wizReviewerTitle').fill('AHJ Reviewer');
      await page.locator('#wizSignedAt').fill('2026-06-05T09:25');
      await page.locator('#wizOrganization').fill('Halo Fire');
      await page.locator('#wizLicenseId').fill('AHJ-UPLOAD-PACKET-SMOKE');
      await page.locator('#wizSubmit').click();
      await page.waitForFunction(() => document.getElementById('wizMsg')?.textContent?.includes('gate resolved with accepted evidence'));

      const evidenceRows = await api(`/api/projects/${encodeURIComponent(projectName)}/evidence`, token);
      const saved = evidenceRows.find((row) => row.evidence_type === targetEvidenceType
        && row.source_ref === targetSourceRef);
      expect(saved).toBeTruthy();
      const savedNotes = JSON.parse(saved.notes);
      expect(savedNotes.kind).toBe('signed_reviewer_evidence');
      expect(savedNotes.claim_gate_effect).toBe('gate_cleared_after_explicit_signed_validation');
      expect(savedNotes.settings_prefill_href).toContain('uploadPacketHref=');
      expect(savedNotes.settings_prefill_href).toContain(encodeURIComponent(uploadPacketHref));

      const gates = await api(`/api/projects/${encodeURIComponent(projectName)}/claim-gates`, token);
      expect(gates.find((gate) => gate.code === targetGateCode).status).toBe('cleared');

      await page.goto(`${BASE}/official-flow.html?project=${encodeURIComponent(projectName)}#evidence-${saved.id}`, {
        waitUntil: 'domcontentloaded',
      });
      const savedRow = page.locator(`#evidence-${saved.id}`).first();
      await savedRow.waitFor();
      expect(await savedRow.innerText()).toContain('Open accepted evidence read-only');
      const inspectHref = await savedRow.locator('[data-signed-reviewer-workflow-href]').getAttribute('data-signed-reviewer-workflow-href');
      expect(inspectHref).toContain(`gate=${targetGateCode}`);
      expect(inspectHref).toContain(`evidenceId=${saved.id}`);
      expect(inspectHref).toContain('action=inspect');

      await page.reload({ waitUntil: 'domcontentloaded' });
      const savedRowAfterRefresh = page.locator(`#evidence-${saved.id}`).first();
      await savedRowAfterRefresh.waitFor();
      expect(await savedRowAfterRefresh.innerText()).toContain('Open accepted evidence read-only');
      await savedRowAfterRefresh.locator('[data-signed-reviewer-workflow-evidence-id]').first().click();
      await page.waitForURL((url) => url.pathname === '/settings.html' && url.hash === '#wizSignoff');
      await page.waitForFunction(
        (expectedGate) => document.getElementById('wizGate')?.value === expectedGate,
        targetGateCode,
      );
      expect(page.url()).not.toContain('uploadPacketHref=');
      expect(page.url()).toContain(`evidenceId=${saved.id}`);
      expect(page.url()).toContain('action=inspect');
      expect(await page.locator('#wizGate').inputValue()).toBe(targetGateCode);
      expect(await page.locator('#wizType').inputValue()).toBe(targetEvidenceType);
      expect(await page.locator('#wizSourceRef').inputValue()).toBe(targetSourceRef);
      expect(await page.locator('#wizPacketStatus').innerText()).toContain(`Read-only accepted signed reviewer evidence #${saved.id}`);
    } finally {
      await page.close();
    }
  }, 30_000);

  it('resolves a gate from official-flow signed reviewer resolve context with real signed evidence', async () => {
    const token = await adminToken();
    const targetGateCode = 'PROFESSIONAL_REVIEW_MISSING';
    const targetEvidenceType = 'professional_review';
    const targetSourceRef = 'pe-review://settings-browser-smoke/official-flow-resolve';
    const contextNotes = {
      kind: 'official_flow_professional_ahj_review_decision',
      artifact_type: 'halofire.official_flow_professional_ahj_review_decision.v1',
      source_replay_evidence_id: 5900,
      professional_review_ref: targetSourceRef,
      ahj_review_ref: 'ahj://settings-browser-smoke/official-flow-resolve',
      autosprink_export_ref: 'autosprink://settings-browser-smoke/official-flow-resolve',
      source_refs: [
        {
          evidence_type: 'official_flow_hydraulic_replay_artifact',
          evidence_id: 5900,
          source_ref: 'official-flow-replay:settings-browser-smoke-resolve',
        },
      ],
      decision: {
        source_replay_evidence_id: 5900,
        professional_review_ref: targetSourceRef,
        ahj_review_ref: 'ahj://settings-browser-smoke/official-flow-resolve',
        autosprink_export_ref: 'autosprink://settings-browser-smoke/official-flow-resolve',
        claim_gate_effect: 'no_claims_cleared',
      },
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
      claims_cleared_count: 0,
    };
    const context = await api(`${PROJECT_PATH}/evidence`, token, {
      method: 'POST',
      body: JSON.stringify({
        evidence_type: 'official_flow_professional_ahj_review_decision',
        source_ref: 'official-flow-review-decision:settings-browser-smoke-resolve',
        source_file: 'settings-browser-smoke-official-flow-resolve.json',
        status: 'fail_closed_review_recorded',
        notes: JSON.stringify(contextNotes),
      }),
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);

    try {
      await page.goto(
        `${BASE}/settings.html?project=${encodeURIComponent(PROJECT_NAME)}&gate=${targetGateCode}&evidenceId=${context.id}&action=resolve#wizSignoff`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.locator('#wizGate').waitFor();
      await page.waitForFunction(
        (evidenceId) => document.getElementById('wizPacketStatus')?.dataset.officialFlowContextEvidenceId === evidenceId,
        String(context.id),
      );

      expect(await page.locator('#wizGate').inputValue()).toBe(targetGateCode);
      expect(await page.locator('#wizType').inputValue()).toBe(targetEvidenceType);
      expect(await page.locator('#wizExistingEvidence').inputValue()).toBe('');
      expect(await page.locator('#wizAction').inputValue()).toBe('resolve');
      expect(await page.locator('#wizSourceRef').inputValue()).toBe(targetSourceRef);
      expect(await page.locator('#wizPacketStatus').innerText()).toContain(
        `Prefilled from official-flow review decision evidence #${context.id}`,
      );
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('action=resolve');
      expect(await page.locator('#wizPacketStatus').getAttribute('data-official-flow-context-evidence-id')).toBe(String(context.id));
      expect(await page.locator('#wizPacketStatus').getAttribute('data-official-flow-context-action')).toBe('resolve');
      expect(await page.locator('#wizNotes').inputValue()).toContain(`source_official_flow_review_decision_evidence_id ${context.id}`);
      expect(await page.locator('#wizNotes').inputValue()).toContain('source_replay_evidence_id 5900');
      expect(await page.locator('#wizNotes').inputValue()).toContain('claim_gate_effect requires_real_signed_evidence');
      expect(await page.locator('#wizResolveAudit').isDisabled()).toBe(true);

      await page.locator('#wizReviewerName').fill('Codex Resolve Smoke');
      await page.locator('#wizReviewerTitle').fill('Fire Protection Engineer');
      await page.locator('#wizSignedAt').fill('2026-06-04T21:10');
      await page.locator('#wizOrganization').fill('Halo Fire');
      await page.locator('#wizLicenseId').fill('PE-CODEX-SETTING-RESOLVE');
      await page.locator('#wizSubmit').click();
      await page.waitForFunction(() => document.getElementById('wizMsg')?.textContent?.includes('gate resolved with accepted evidence'));

      const evidenceRows = await api(`${PROJECT_PATH}/evidence`, token);
      const saved = evidenceRows.find((row) => row.evidence_type === targetEvidenceType
        && row.source_ref === targetSourceRef);
      expect(saved).toBeTruthy();
      const savedNotes = JSON.parse(saved.notes);
      expect(savedNotes.kind).toBe('signed_reviewer_evidence');
      expect(savedNotes.target_gate_code).toBe(targetGateCode);
      expect(savedNotes.required_evidence_type).toBe(targetEvidenceType);
      expect(savedNotes.claim_gate_effect).toBe('gate_cleared_after_explicit_signed_validation');
      expect(savedNotes.user_notes).toContain(`source_official_flow_review_decision_evidence_id ${context.id}`);
      expect(savedNotes.signoff).toEqual(expect.objectContaining({
        reviewer_name: 'Codex Resolve Smoke',
        reviewer_title: 'Fire Protection Engineer',
        license_id: 'PE-CODEX-SETTING-RESOLVE',
      }));

      const gates = await api(`${PROJECT_PATH}/claim-gates`, token);
      const targetGate = gates.find((gate) => gate.code === targetGateCode);
      expect(targetGate.status).toBe('cleared');
      expect(String(targetGate.resolved_evidence_ref || '')).toBe(targetSourceRef);

      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('#settingsResolvedSignedReviewerGates .note'))
          .some((node) => node.textContent?.includes('PROFESSIONAL_REVIEW_MISSING')),
      );
      const resolvedGateText = await page.locator('#settingsResolvedSignedReviewerGates').innerText();
      expect(resolvedGateText).toContain('PROFESSIONAL_REVIEW_MISSING');
      expect(resolvedGateText).toContain('gate_cleared_after_explicit_signed_validation');

      const auditButton = page.locator('[data-settings-resolved-gate-audit-download]').first();
      await auditButton.click();
      await page.waitForFunction(
        () => {
          const text = document.getElementById('settingsResolvedSignedReviewerGatesMsg')?.textContent || '';
          return text.includes('downloaded halofire.claim_gate_resolve_audit_packet.v1');
        },
      );
      expect(await page.locator('#settingsResolvedSignedReviewerGatesMsg').innerText()).toContain(
        'claim_gate_effect gate_cleared_after_explicit_signed_validation',
      );
    } finally {
      await page.close();
    }
  }, 30_000);

  it('renders resolved signed-reviewer gates in Settings and downloads the resolved-gate audit packet', async () => {
    const token = await adminToken();
    await api(`${PROJECT_PATH}/claim-gates/AHJ_APPROVAL_MISSING/resolve`, token, {
      method: 'POST',
      body: JSON.stringify({
        evidence: {
          evidence_type: 'ahj_approval',
          source_ref: 'Resolved signed reviewer packet AHJ-1881-900',
          source_file: 'resolved-signed-reviewer-ahj.pdf',
          status: 'present',
          notes: 'Resolved signed reviewer browser smoke packet.',
          signoff: {
            reviewer_name: 'Jordan Lee',
            reviewer_title: 'Fire Marshal',
            signed_at: '2026-06-03T22:10:00.000Z',
            organization: 'Salt Lake City',
          },
        },
      }),
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);

    try {
      await page.goto(`${BASE}/settings.html`, { waitUntil: 'domcontentloaded' });
      const gateRow = page.locator('[data-settings-resolved-gate-code="AHJ_APPROVAL_MISSING"]').first();
      await gateRow.waitFor();
      const gateRowText = await gateRow.innerText();
      expect(gateRowText).toContain('Resolved signed reviewer packet AHJ-1881-900');
      expect(gateRowText).toContain('gate_cleared_after_explicit_signed_validation');
      expect(gateRowText).toContain('no_unrelated_claims_cleared true');
      expect(gateRowText).toContain('halofire.claim_gate_resolve_audit_packet.v1');
      expect(gateRowText).toContain('Open accepted evidence read-only');
      expect(await gateRow.getAttribute('data-settings-resolved-gate-audit-href')).toBe(
        `${PROJECT_PATH}/claim-gates/AHJ_APPROVAL_MISSING/resolve-audit-packet`,
      );
      expect(await gateRow.getAttribute('data-settings-resolved-gate-evidence-id')).toBeTruthy();

      await gateRow.locator('[data-settings-resolved-gate-inspect]').click();
      await page.waitForURL((url) => url.pathname === '/settings.html' && url.hash === '#wizSignoff');
      await page.waitForFunction(
        () => Boolean(document.getElementById('wizPacketStatus')?.dataset.signedReviewerReadonlyEvidenceId),
      );
      expect(page.url()).toContain('action=inspect');
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('Read-only accepted signed reviewer evidence');
      expect(await page.locator('#wizGate').inputValue()).toBe('AHJ_APPROVAL_MISSING');
      expect(await page.locator('#wizSubmit').isDisabled()).toBe(true);

      await gateRow.locator('[data-settings-resolved-gate-audit-download]').click();
      await page.waitForFunction(() => {
        const text = document.getElementById('settingsResolvedSignedReviewerGatesMsg')?.textContent || '';
        return text.includes('downloaded halofire.claim_gate_resolve_audit_packet.v1');
      });
      expect(await page.locator('#settingsResolvedSignedReviewerGatesMsg').innerText()).toContain(
        'claim_gate_effect gate_cleared_after_explicit_signed_validation',
      );
    } finally {
      await page.close();
    }
  }, 30_000);

  it('renders room-boundary override actions in Settings and downloads the override packet', async () => {
    const token = await adminToken();
    const boundary = await api(`${PROJECT_PATH}/pdf-boundary-decision`, token, {
      method: 'POST',
      body: JSON.stringify({
        pdfPageIndex: 7,
        pdfScale: 0.0833,
        pdfExtract: 'outline',
        candidate: {
          id: 'candidate:settings-1881-sheet-7-outline',
          mode: 'outline',
          bbox: { minX: 0, minY: 0, maxX: 120, maxY: 85, widthFt: 120, heightFt: 85, areaSqft: 10200 },
          blockedClaims: ['geometry_accuracy', 'AutoSprink_parity'],
        },
        source_file: 'Proposal- Home Depot - Rexburg ID.xlsx',
        source_ref: 'Home Depot settings browser-smoke boundary decision for floor-plan override',
        selected_sheet_ref: 'home-depot://sheet-7',
        selected_scale_ref: 'home-depot://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:settings-1881-sheet-7-outline',
        source_refs: [
          'home-depot://sheet-7',
          'home-depot://operator-scale/sheet-7/0.0833',
          'candidate:settings-1881-sheet-7-outline',
        ],
        notes: 'Settings browser-smoke boundary decision for floor-plan override.',
      }),
    });
    const review = await api(`${PROJECT_PATH}/resolver-packets/pdf-boundary/${boundary.evidence.id}/reviews`, token, {
      method: 'POST',
      body: JSON.stringify({
        review_decision: 'corrected',
        reviewer_name: 'Settings Boundary Browser Smoke Reviewer',
        marked_up_plan_ref: 'home-depot://markup/settings-sheet-7-room-boundary-correction',
        corrected_room_polygons: [
          {
            id: 'room:settings-1881-lobby',
            label: 'Lobby',
            polygon: [[0, 0], [28, 0], [28, 18], [0, 18]],
            source_refs: ['home-depot://markup/settings-sheet-7-room-boundary-correction'],
          },
        ],
        issue_list: [
          {
            issue_type: 'room_boundary_mismatch',
            severity: 'blocking',
            source_ref: 'home-depot://sheet-7',
            observed: 'Original outline overcaptured the corridor wall band.',
            expected: 'Replay should use the corrected employee-reviewed room polygon only.',
            required_action: 'Use the corrected room polygon for internal-alpha replay only.',
          },
        ],
        notes: 'Corrected settings browser-smoke room-boundary review packet for override download.',
      }),
    });

    const projectPath = PROJECT_PATH;
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(8000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);

    try {
      await page.goto(`${BASE}/settings.html`, { waitUntil: 'domcontentloaded' });
      const overrideNote = page.locator('#settingsRoomBoundaryFloorPlanOverrides .note')
        .filter({ hasText: `source_review_evidence_id ${review.id}` })
        .first();
      await overrideNote.waitFor();
      const overrideRow = overrideNote.locator('[data-room-boundary-floor-plan-override-action-index]').first();
      await page.evaluate(() => {
        const originalCreateObjectURL = URL.createObjectURL.bind(URL);
        const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
        window.__lastRoomBoundaryOverrideBlobText = null;
        URL.createObjectURL = (blob) => {
          blob.text().then((text) => {
            window.__lastRoomBoundaryOverrideBlobText = text;
          });
          return originalCreateObjectURL(blob);
        };
        URL.revokeObjectURL = (href) => originalRevokeObjectURL(href);
      });

      await overrideRow.click();
      await page.waitForTimeout(1000);
      const statusText = await page.locator('#roomBoundaryFloorPlanOverrideMsg').innerText();
      expect(statusText).toContain('downloaded halofire.room_boundary_floor_plan_override_action_packet.v1');
      const packet = JSON.parse(await page.evaluate(async () => {
        const started = Date.now();
        while (!window.__lastRoomBoundaryOverrideBlobText) {
          if (Date.now() - started > 5000) throw new Error('override blob text not captured');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return window.__lastRoomBoundaryOverrideBlobText;
      }));

      expect(packet.artifact_type).toBe('halofire.room_boundary_floor_plan_override_action_packet.v1');
      expect(packet.source_evidence_id).toBe(boundary.evidence.id);
      expect(packet.source_review_evidence_id).toBe(review.id);
      expect(packet.floor_plan_override_source).toBe('latest_employee_review_packet');
      expect(packet.request_body).toEqual(expect.objectContaining({
        room_boundary_source: 'latest_employee_review_packet',
        source_evidence_id: boundary.evidence.id,
        source_review_evidence_id: review.id,
      }));
      expect(statusText).toContain('claim gates remain blocked');
      expect(packet.floor_plan_override).toEqual(expect.objectContaining({
        source_evidence_id: boundary.evidence.id,
        source_review_evidence_id: review.id,
        corrected_room_polygon_count: 1,
      }));
      expect(packet.action_href).toBe(`${projectPath}/sprinkler-bid`);
    } finally {
      await page.close();
    }
  }, 30_000);
});
