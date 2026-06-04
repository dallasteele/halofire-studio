import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3230;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'pdf-boundary-browser-smoke-pw';
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-pdf-boundary-browser-smoke-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'pdf-boundary-browser-smoke-jwt-secret-more-than-32-chars',
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

describe('Workbench PDF boundary decision browser smoke', () => {
  it('saves employee-selected 1881 sheet refs from Workbench and reloads them from persisted evidence', async () => {
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
        source_ref: '1881 browser-smoke initial boundary decision',
        selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
        selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
        source_refs: [
          '1881://proposal-cooperative/sheet-7',
          '1881://operator-scale/sheet-7/0.0833',
          'candidate:1881-sheet-7-outline',
        ],
        notes: 'Initial browser-smoke boundary decision.',
      }),
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(`${BASE}/workbench.html`, { waitUntil: 'domcontentloaded' });
      await page.locator('#projectTarget').selectOption(PROJECT_NAME);
      const saveButton = page.locator(`[data-pdf-boundary-decision-save-evidence-id="${savedBoundary.evidence.id}"]`);
      await saveButton.waitFor({ state: 'attached' });
      await page.locator(`summary:has-text("Save employee PDF boundary decision")`).first().click();
      await page.locator(`#selectedSheetRef-${savedBoundary.evidence.id}`).fill('1881://proposal-cooperative/sheet-8');
      await page.locator(`#selectedScaleRef-${savedBoundary.evidence.id}`).fill('1881://operator-scale/sheet-8/0.125');
      await page.locator(`#selectedBoundaryCandidateRef-${savedBoundary.evidence.id}`).fill('candidate:1881-sheet-8-wall-layer');
      await page.locator(`#pdfBoundaryDecisionNotes-${savedBoundary.evidence.id}`).fill(
        'Browser smoke updated the employee-selected 1881 boundary decision; claim gates remain blocked.',
      );
      await saveButton.click();

      let updated = null;
      const started = Date.now();
      while (Date.now() - started < 8000) {
        const evidence = await api(`${PROJECT_PATH}/evidence`, token);
        updated = evidence.find((row) => row.notes?.includes('Browser smoke updated the employee-selected 1881 boundary decision'));
        if (updated) break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      expect(updated).toBeTruthy();
      expect(updated.selected_sheet_ref).toBe('1881://proposal-cooperative/sheet-8');
      expect(updated.selected_scale_ref).toBe('1881://operator-scale/sheet-8/0.125');
      expect(updated.selected_boundary_candidate_ref).toBe('candidate:1881-sheet-8-wall-layer');
      expect(updated.employee_decision).toEqual(expect.objectContaining({
        selected_sheet_ref: '1881://proposal-cooperative/sheet-8',
        selected_scale_ref: '1881://operator-scale/sheet-8/0.125',
        selected_boundary_candidate_ref: 'candidate:1881-sheet-8-wall-layer',
        claim_gate_effect: 'no_claims_cleared',
      }));

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('#projectTarget').selectOption(PROJECT_NAME);
      const refreshedEvidenceId = updated.id;
      const refreshedSaveButton = page.locator(`[data-pdf-boundary-decision-save-evidence-id="${refreshedEvidenceId}"]`);
      await refreshedSaveButton.waitFor({ state: 'attached' });
      await page.locator(`summary:has-text("Save employee PDF boundary decision")`).first().click();
      expect(await page.locator(`#selectedSheetRef-${refreshedEvidenceId}`).inputValue()).toBe('1881://proposal-cooperative/sheet-8');
      expect(await page.locator(`#selectedScaleRef-${refreshedEvidenceId}`).inputValue()).toBe('1881://operator-scale/sheet-8/0.125');
      expect(await page.locator(`#selectedBoundaryCandidateRef-${refreshedEvidenceId}`).inputValue()).toBe('candidate:1881-sheet-8-wall-layer');
    } finally {
      await page.close();
    }
  }, 30_000);
});
