import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const ADMIN_PASSWORD = 'polaris-studio-browser-admin-password';
let server; let browser; let context; let page; let tempDir; let base;

function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const { port } = socket.address();
      socket.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    if (server.exitCode != null) throw new Error(`server exited before health: ${server.exitCode}`);
    try { const response = await fetch(`${base}/api/health`); if (response.ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server not healthy');
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-polaris-studio-browser-'));
  base = `http://127.0.0.1:${await freePort()}`;
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: new URL(base).port, NODE_ENV: 'test', HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'polaris-studio-browser-secret-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: ADMIN_PASSWORD,
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: base,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1 });
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'admin', password: ADMIN_PASSWORD } });
  expect(login.status()).toBe(200);
  page = await context.newPage();
}, 30_000);

afterAll(async () => {
  await browser?.close();
  if (server && server.exitCode == null) {
    server.kill();
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('Polaris held-out comparison on the authenticated Studio surface', () => {
  it('renders the top, elevation, and 3D evidence with the failed placement gate visible', async () => {
    const consoleErrors = [];
    const pageErrors = [];
    const failedResponses = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => { if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() }); });
    const navigation = await page.goto(`${base}/autosprink.html`, { waitUntil: 'networkidle' });
    try {
      await page.waitForFunction(() => typeof window.__hfRoofGeometry?.showCalibrationViews === 'function', null, { timeout: 15_000 });
    } catch {
      throw new Error(JSON.stringify({ status: navigation?.status(), url: page.url(), title: await page.title(), consoleErrors, pageErrors, failedResponses }));
    }
    await page.evaluate(() => window.__hfRoofGeometry.showCalibrationViews());
    const evidence = page.locator('#hfPolarisHeldoutComparisonEvidence');
    await evidence.waitFor({ state: 'visible' });
    const text = await evidence.textContent();
    expect(text).toContain('DOMAIN GUARD PASSED');
    expect(text).toContain('PLACEMENT FAILED');
    expect(text).toContain('81 pendents + 77 attic uprights');
    expect(await evidence.locator('svg').count()).toBe(3);
    expect(await evidence.locator('circle').count()).toBe(474);
    const outputDir = path.resolve(ROOT, '../..', 'output', 'playwright', 'polaris-heldout-studio');
    fs.mkdirSync(outputDir, { recursive: true });
    await evidence.screenshot({ path: path.join(outputDir, 'authenticated-studio-evidence.png') });
    expect(consoleErrors).toEqual([]);
  }, 60_000);
});
