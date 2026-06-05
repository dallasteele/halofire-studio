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
});
