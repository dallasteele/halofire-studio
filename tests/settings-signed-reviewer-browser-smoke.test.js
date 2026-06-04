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
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);
    try {
      await page.goto(`${BASE}/workbench.html`, { waitUntil: 'domcontentloaded' });
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
    const recorded = await api(`${PROJECT_PATH}/evidence`, token, {
      method: 'POST',
      body: JSON.stringify({
        evidence_type: 'professional_review',
        target_gate_code: 'PROFESSIONAL_REVIEW_MISSING',
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
      }),
    });
    await api(`${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/resolve`, token, {
      method: 'POST',
      body: JSON.stringify({ evidence_id: recorded.id }),
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);
    try {
      await page.goto(`${BASE}/workbench.html`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Signed reviewer packet browser-smoke PR-1881-100').waitFor();
      await page.locator(`[data-signed-reviewer-workflow-evidence-id="${recorded.id}"]`).click();
      await page.waitForURL(/settings\.html\?/);
      await page.locator('#wizExistingEvidence').waitFor();
      await page.waitForFunction(
        (evidenceId) => document.getElementById('wizExistingEvidence')?.value === evidenceId,
        String(recorded.id),
      );
      expect(await page.locator('#wizExistingEvidence').inputValue()).toBe(String(recorded.id));
      expect(await page.locator('#wizPacketStatus').innerText()).toContain(`Prefilled from Workbench for evidence #${recorded.id}`);
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

  it('renders resolved signed-reviewer gates in Settings and downloads the resolved-gate audit packet', async () => {
    const token = await adminToken();
    const recorded = await api(`${PROJECT_PATH}/evidence`, token, {
      method: 'POST',
      body: JSON.stringify({
        evidence_type: 'ahj_approval',
        target_gate_code: 'AHJ_APPROVAL_MISSING',
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
      }),
    });
    await api(`${PROJECT_PATH}/claim-gates/AHJ_APPROVAL_MISSING/resolve`, token, {
      method: 'POST',
      body: JSON.stringify({ evidence_id: recorded.id }),
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(`${BASE}/settings.html`, { waitUntil: 'domcontentloaded' });
      const gateRow = page.locator('[data-settings-resolved-gate-code="AHJ_APPROVAL_MISSING"]').first();
      await gateRow.waitFor();
      const gateRowText = await gateRow.innerText();
      expect(gateRowText).toContain('Resolved signed reviewer packet AHJ-1881-900');
      expect(gateRowText).toContain('gate_cleared_after_explicit_signed_validation');
      expect(gateRowText).toContain('no_unrelated_claims_cleared true');
      expect(gateRowText).toContain('halofire.claim_gate_resolve_audit_packet.v1');
      expect(await gateRow.getAttribute('data-settings-resolved-gate-audit-href')).toBe(
        `${PROJECT_PATH}/claim-gates/AHJ_APPROVAL_MISSING/resolve-audit-packet`,
      );

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
});
