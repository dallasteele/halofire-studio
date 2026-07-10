import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3243;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'workbench-route-contract-browser-pw';
const PROJECT = 'The Cooperative 1881 - Salt Lake City UT';

let server;
let tempDir;
let browser;

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('route-contract smoke server did not become healthy');
}

async function login() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`route-contract login failed: ${response.status}`);
  return (await response.json()).token;
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-workbench-route-contract-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'route-contract.db'),
      JWT_SECRET: 'workbench-route-contract-jwt-secret-more-than-32-chars',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: PASSWORD,
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: BASE,
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

describe('Workbench route contract', () => {
  it('exposes dashboard handoff and lands on the estimator evidence surface', async () => {
    const token = await login();
    const context = await browser.newContext();
    await context.addCookies([{ name: 'halofire_session', value: token, url: BASE }]);
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);

    try {
      const projectQuery = encodeURIComponent(PROJECT);
      await page.goto(`${BASE}/workbench.html?project=${projectQuery}`, { waitUntil: 'domcontentloaded' });
      const route = page.locator('#estimatorReviewRoute');
      await route.waitFor();
      expect(await page.locator('body').getAttribute('data-hf-route-contract')).toBe('dashboard-handoff');
      expect(await page.locator('body').getAttribute('data-hf-review-route')).toBe('/official-flow.html');
      expect(await route.getAttribute('data-route-state')).toBe('explicit-handoff');
      expect(await route.innerText()).toContain('separate evidence surface');

      const href = await page.locator('#estimatorReviewRouteLink').getAttribute('href');
      const reviewUrl = new URL(href, BASE);
      expect(reviewUrl.pathname).toBe('/official-flow.html');
      expect(reviewUrl.searchParams.get('project')).toBe(PROJECT);
      expect(reviewUrl.hash).toBe('#officialFlowAttachmentIntake');

      await page.goto(reviewUrl.toString(), { waitUntil: 'domcontentloaded' });
      expect(await page.locator('body').getAttribute('data-hf-route-contract')).toBe('estimator-review');
      expect(await page.locator('body').getAttribute('data-hf-route-owner')).toBe('estimator');
      for (const selector of ['#projectTarget', '#resolverQueue', '#catalogSourceAcquisition', '#officialFlowAttachmentIntake']) {
        await page.locator(selector).waitFor({ state: 'attached' });
      }
      expect(await page.locator('#projectTarget').inputValue()).toBe(PROJECT);
    } finally {
      await context.close();
    }
  }, 40_000);
});
