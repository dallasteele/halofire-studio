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
    page.setDefaultTimeout(8000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(`${BASE}/workbench.html`, { waitUntil: 'domcontentloaded' });
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
  }, 30_000);
});
